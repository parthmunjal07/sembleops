// AgentRuntime is the vendor-portability seam.
// Implementations run a prompt to completion on a subscription CLI and
// return text + whatever cost/session metadata the runtime reports.

export interface RunResult {
  ok: boolean;
  text: string;
  sessionId: string | null;
  costUsd: number | null;
  runtimeLabel?: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  error?: string;
}

export interface RunOptions {
  cwd: string;
  timeoutMs: number;
  /** true = agent may edit files in cwd (Dex). false = draft/reasoning only. */
  write?: boolean;
  /** Optional output budget for lightweight review-card workers. */
  maxOutputTokens?: number;
}

export interface AgentRuntime {
  readonly kind: "claude-code" | "codex" | "api-openai";
  available(): boolean;
  run(prompt: string, opts: RunOptions): Promise<RunResult>;
}
