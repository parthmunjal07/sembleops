// CLI-backed runtimes: headless Claude Code and Codex.
// Prompts go via stdin (no shell-quoting hazards); processes are killed hard
// on timeout as runaway protection.

import { spawn, spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chatText } from "./openaiChat.js";
import { openAiApiKeyAvailable } from "./openaiConfig.js";
import type { AgentRuntime, RunOptions, RunResult } from "./types.js";

function codexProfile(write: boolean): { model: string; reasoning: string } {
  return write
    ? {
        model: process.env["SEMBLEOPS_DEX_CODEX_MODEL"] ?? "gpt-5.5",
        reasoning: process.env["SEMBLEOPS_DEX_CODEX_REASONING"] ?? "high",
      }
    : {
        model: process.env["SEMBLEOPS_CODEX_MODEL"] ?? "gpt-5-mini",
        reasoning: process.env["SEMBLEOPS_CODEX_REASONING"] ?? "low",
      };
}

function which(cmd: string): string | null {
  const probe = process.platform === "win32" ? "where.exe" : "which";
  const res = spawnSync(probe, [cmd], { encoding: "utf8" });
  if (res.status !== 0) return null;
  const first = res.stdout.split(/\r?\n/).find((l) => l.trim().length > 0);
  return first?.trim() ?? null;
}

function killTree(pid: number): void {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"]);
  } else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

function runCli(
  command: string,
  args: string[],
  prompt: string,
  opts: { cwd: string; timeoutMs: number },
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolvePromise) => {
    // .cmd shims on Windows need a shell; the prompt goes via stdin so the
    // command line itself stays static and quoting-safe.
    const child = spawn([command, ...args].join(" "), {
      cwd: opts.cwd,
      shell: true,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) killTree(child.pid);
    }, opts.timeoutMs);
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stdout, stderr, timedOut });
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

export class ClaudeCodeRuntime implements AgentRuntime {
  readonly kind = "claude-code" as const;
  private readonly path = which("claude");

  available(): boolean {
    return this.path !== null;
  }

  async run(prompt: string, opts: RunOptions): Promise<RunResult> {
    // Write mode grants file edits without prompts — never full skip-permissions
    // That stronger mode belongs only inside a separate container boundary.
    const args = ["-p", "--output-format", "json"];
    if (opts.write) args.push("--permission-mode", "acceptEdits");
    const res = await runCli("claude", args, prompt, opts);
    if (res.timedOut) return { ok: false, text: "", sessionId: null, costUsd: null, error: "timeout" };
    try {
      const parsed = JSON.parse(res.stdout) as {
        result?: string;
        is_error?: boolean;
        session_id?: string;
        total_cost_usd?: number;
      };
      if (parsed.is_error) {
        return {
          ok: false,
          text: parsed.result ?? "",
          sessionId: parsed.session_id ?? null,
          costUsd: parsed.total_cost_usd ?? null,
          error: parsed.result ?? "runtime reported error",
        };
      }
      return {
        ok: true,
        text: parsed.result ?? "",
        sessionId: parsed.session_id ?? null,
        costUsd: parsed.total_cost_usd ?? null,
      };
    } catch {
      const err = (res.stderr || res.stdout).slice(0, 500);
      return res.code === 0 && res.stdout.trim().length > 0
        ? { ok: true, text: res.stdout.trim(), sessionId: null, costUsd: null }
        : { ok: false, text: "", sessionId: null, costUsd: null, error: err || `exit ${res.code}` };
    }
  }
}

export class CodexRuntime implements AgentRuntime {
  readonly kind = "codex" as const;
  private readonly path = which("codex");

  available(): boolean {
    return this.path !== null;
  }

  async run(prompt: string, opts: RunOptions): Promise<RunResult> {
    // --output-last-message gives just the agent's final answer; raw stdout is
    // a full transcript with banners and token counts.
    const outFile = join(
      opts.write ? tmpdir() : opts.cwd,
      `codex-out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`,
    );
    // Dex edits code, so it gets the stronger model/reasoning profile.
    // Read-only agents are review-card workers, so force them out of the
    // user's global high-reasoning Codex config.
    const { model, reasoning } = codexProfile(Boolean(opts.write));
    // --full-auto = workspace-write sandbox: edits stay inside cwd.
    const args = ["exec", "--skip-git-repo-check"];
    args.push("--model", model, "-c", `model_reasoning_effort="${reasoning}"`);
    if (opts.write) args.push("--full-auto");
    args.push("--output-last-message", `"${outFile}"`, "-");
    const res = await runCli("codex", args, prompt, opts);
    let last = "";
    try {
      last = readFileSync(outFile, "utf8").trim();
      rmSync(outFile, { force: true });
    } catch {
      /* no last-message file — fall through to stdout */
    }
    if (res.timedOut) return { ok: false, text: "", sessionId: null, costUsd: null, error: "timeout" };
    if (res.code !== 0 || (last.length === 0 && res.stdout.trim().length === 0)) {
      return {
        ok: false,
        text: "",
        sessionId: null,
        costUsd: null,
        error: (res.stderr || res.stdout).slice(0, 500) || `exit ${res.code}`,
      };
    }
    return {
      ok: true,
      text: last.length > 0 ? last : res.stdout.trim(),
      sessionId: null,
      costUsd: null,
      runtimeLabel: `codex:${model}:${reasoning}`,
    };
  }
}

export class ApiChatRuntime implements AgentRuntime {
  readonly kind = "api-openai" as const;

  available(): boolean {
    return openAiApiKeyAvailable();
  }

  async run(prompt: string, opts: RunOptions): Promise<RunResult> {
    if (opts.write) {
      return {
        ok: false,
        text: "",
        sessionId: null,
        costUsd: null,
        error: "api-openai runtime cannot execute write-mode (Dex) jobs",
      };
    }
    const res = await chatText(prompt, opts.timeoutMs, opts.maxOutputTokens);
    return res.ok
      ? {
          ok: true,
          text: res.text,
          sessionId: null,
          costUsd: null,
          runtimeLabel: res.model ? `api-openai:${res.model}` : "api-openai",
          inputTokens: res.inputTokens ?? null,
          outputTokens: res.outputTokens ?? null,
        }
      : { ok: false, text: "", sessionId: null, costUsd: null, error: res.error ?? "chat failed" };
  }
}

/** Build the runtime list from config order; unavailable ones drop out. */
export function detectRuntimes(kinds?: string[]): AgentRuntime[] {
  const wanted = kinds && kinds.length > 0 ? kinds : ["claude-code", "codex"];
  const all: Record<string, AgentRuntime> = {
    "claude-code": new ClaudeCodeRuntime(),
    codex: new CodexRuntime(),
    "api-openai": new ApiChatRuntime(),
  };
  return wanted
    .map((k) => all[k])
    .filter((r): r is AgentRuntime => r !== undefined && r.available());
}
