// Delegation queue + runner: Marco assigns, workers execute on a CLI runtime.
// Asynchronous by default: enqueue work, then review it when complete.

import type Database from "better-sqlite3";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Persona } from "../config/schema.js";
import { workerPrompt } from "../agents/souls.js";
import type { AgentRuntime, RunOptions } from "../runtime/types.js";
import { sanitizeOutput } from "../shared/style.js";
import { resolveProject } from "./projects.js";

export interface Delegation {
  id: string;
  created_at: string;
  agent: string;
  title: string;
  instructions: string;
  status: "queued" | "running" | "needs_review" | "reviewed" | "dismissed" | "error";
  runtime: string | null;
  session_id: string | null;
  result: string | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  cost_usd: number | null;
  project: string | null;
  diff: string | null;
  thread_id: string | null;
  parent_id: string | null;
  verify_requested: number;
  mission_id: string | null;
  content_idea_id: string | null;
  content_run_kind: "context" | "verification" | null;
  content_request_id: string | null;
}

export interface ContentHandoff {
  request_id: string;
  content_idea_id: string;
  status: "routing" | "complete" | "error";
  mission_id: string;
  created_at: string;
  updated_at: string;
  response_json: string | null;
  error: string | null;
}

export type ContentHandoffStart =
  | { kind: "started" | "existing"; handoff: ContentHandoff; active: null }
  | { kind: "active"; handoff: ContentHandoff | null; active: Delegation | null }
  | { kind: "request_conflict"; handoff: ContentHandoff; active: null };

const nowIso = (): string => new Date().toISOString();

// Runaway caps only (plus reasoning headroom on gpt-5 models). Length is
// controlled by the worker prompt's word budget; the collapsed Appendix
// section may legitimately carry depth beyond the readable body.
const OUTPUT_BUDGETS: Record<string, number | undefined> = {
  sam: 1000,
  paige: 1000,
  penny: 1800,
  dex: undefined,
};

const DIFF_CAP = 80_000; // chars — review card, not a full patch viewer

/** Snapshot the working tree after a Dex run: status + diff + untracked files. */
function captureWorkingTreeDiff(cwd: string): string | null {
  if (!existsSync(join(cwd, ".git"))) return "(not a git repository — changes not diffable)";
  const git = (args: string[]) =>
    spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).stdout ?? "";
  const status = git(["status", "--porcelain"]).trim();
  if (status.length === 0) return "(no working-tree changes)";
  const diff = git(["diff"]).trim();
  const untracked = status
    .split(/\r?\n/)
    .filter((l) => l.startsWith("??"))
    .map((l) => l.slice(3))
    .join("\n");
  let out = `# git status --porcelain\n${status}\n`;
  if (untracked.length > 0) out += `\n# new (untracked) files\n${untracked}\n`;
  if (diff.length > 0) out += `\n# git diff\n${diff}`;
  return out.length > DIFF_CAP ? out.slice(0, DIFF_CAP) + "\n…(truncated)" : out;
}

export class DelegationStore {
  constructor(private readonly db: Database.Database) {}

  enqueue(
    agent: string,
    title: string,
    instructions: string,
    project: string | null = null,
    opts: {
      parentId?: string;
      verifyRequested?: boolean;
      missionId?: string;
      contentIdeaId?: string;
      contentRunKind?: "context" | "verification";
      contentRequestId?: string;
    } = {},
  ): Delegation {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO delegations
           (id, created_at, agent, title, instructions, project, parent_id,
            verify_requested, mission_id, content_idea_id, content_run_kind, content_request_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        nowIso(),
        agent,
        title,
        instructions,
        project,
        opts.parentId ?? null,
        opts.verifyRequested ? 1 : 0,
        opts.missionId ?? null,
        opts.contentIdeaId ?? null,
        opts.contentRunKind ?? null,
        opts.contentRequestId ?? null,
      );
    return this.get(id)!;
  }

  childrenOf(id: string): Delegation[] {
    return this.db
      .prepare("SELECT * FROM delegations WHERE parent_id = ? ORDER BY created_at ASC")
      .all(id) as Delegation[];
  }

  byMission(missionId: string): Delegation[] {
    return this.db
      .prepare("SELECT * FROM delegations WHERE mission_id = ? ORDER BY created_at ASC")
      .all(missionId) as Delegation[];
  }

  byContentIdea(contentIdeaId: string): Delegation[] {
    return this.db
      .prepare(
        "SELECT * FROM delegations WHERE content_idea_id = ? ORDER BY created_at DESC",
      )
      .all(contentIdeaId) as Delegation[];
  }

  contentRuns(): Delegation[] {
    return this.db
      .prepare(
        "SELECT * FROM delegations WHERE content_idea_id IS NOT NULL ORDER BY created_at DESC",
      )
      .all() as Delegation[];
  }

  byContentRequestId(requestId: string): Delegation | undefined {
    return this.db
      .prepare("SELECT * FROM delegations WHERE content_request_id = ?")
      .get(requestId) as Delegation | undefined;
  }

  activeContentRun(
    contentIdeaId: string,
    kind: "context" | "verification",
  ): Delegation | undefined {
    return this.db
      .prepare(
        `SELECT * FROM delegations
         WHERE content_idea_id = ? AND content_run_kind = ?
           AND status IN ('queued', 'running')
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(contentIdeaId, kind) as Delegation | undefined;
  }

  /**
   * Reserve one Marco routing for an idea. The lookup and insert share an
   * immediate SQLite transaction so two HTTP requests cannot both pass the
   * active-work check before either writes its reservation.
   */
  beginContentHandoff(
    requestId: string,
    contentIdeaId: string,
    missionId: string,
  ): ContentHandoffStart {
    return this.db.transaction((): ContentHandoffStart => {
      const existing = this.contentHandoff(requestId);
      if (existing) {
        return existing.content_idea_id === contentIdeaId
          ? { kind: "existing", handoff: existing, active: null }
          : { kind: "request_conflict", handoff: existing, active: null };
      }

      const routing = this.db
        .prepare(
          `SELECT * FROM content_handoffs
           WHERE content_idea_id = ? AND status = 'routing'
           ORDER BY created_at DESC LIMIT 1`,
        )
        .get(contentIdeaId) as ContentHandoff | undefined;
      if (routing) return { kind: "active", handoff: routing, active: null };

      const active = this.db
        .prepare(
          `SELECT * FROM delegations
           WHERE content_idea_id = ? AND status IN ('queued', 'running', 'needs_review')
           ORDER BY created_at DESC LIMIT 1`,
        )
        .get(contentIdeaId) as Delegation | undefined;
      if (active) {
        const handoff = active.mission_id
          ? (this.db
              .prepare("SELECT * FROM content_handoffs WHERE mission_id = ?")
              .get(active.mission_id) as ContentHandoff | undefined)
          : undefined;
        return { kind: "active", handoff: handoff ?? null, active };
      }

      const now = nowIso();
      this.db
        .prepare(
          `INSERT INTO content_handoffs
             (request_id, content_idea_id, status, mission_id, created_at, updated_at)
           VALUES (?, ?, 'routing', ?, ?, ?)`,
        )
        .run(requestId, contentIdeaId, missionId, now, now);
      return { kind: "started", handoff: this.contentHandoff(requestId)!, active: null };
    }).immediate();
  }

  contentHandoff(requestId: string): ContentHandoff | undefined {
    return this.db
      .prepare("SELECT * FROM content_handoffs WHERE request_id = ?")
      .get(requestId) as ContentHandoff | undefined;
  }

  completeContentHandoff(requestId: string, responseJson: string): ContentHandoff {
    this.db
      .prepare(
        `UPDATE content_handoffs
         SET status = 'complete', response_json = ?, error = NULL, updated_at = ?
         WHERE request_id = ? AND status = 'routing'`,
      )
      .run(responseJson, nowIso(), requestId);
    return this.contentHandoff(requestId)!;
  }

  failContentHandoff(requestId: string, error: string): ContentHandoff {
    this.db
      .prepare(
        `UPDATE content_handoffs
         SET status = 'error', error = ?, updated_at = ?
         WHERE request_id = ? AND status = 'routing'`,
      )
      .run(error.slice(0, 2_000), nowIso(), requestId);
    return this.contentHandoff(requestId)!;
  }

  /** Recover the narrow crash window between Marco writing its log and the API
   * recording the response. Prefer preserving already-created work to routing
   * and paying for it a second time. */
  recoverContentHandoffs(): { completed: number; failed: number } {
    const rows = this.db
      .prepare("SELECT * FROM content_handoffs WHERE status = 'routing'")
      .all() as ContentHandoff[];
    let completed = 0;
    let failed = 0;
    for (const handoff of rows) {
      const logged = this.db
        .prepare("SELECT reply, actions FROM marco_log WHERE mission_id = ? ORDER BY id DESC LIMIT 1")
        .get(handoff.mission_id) as { reply: string; actions: string } | undefined;
      if (logged) {
        this.completeContentHandoff(
          handoff.request_id,
          JSON.stringify({ reply: logged.reply, actions: JSON.parse(logged.actions) }),
        );
        completed += 1;
        continue;
      }
      const children = this.byMission(handoff.mission_id);
      if (children.length > 0) {
        const actions = children.map((job) => ({
          type: "delegate" as const,
          agent: job.agent,
          title: job.title,
          detail: job.instructions,
          id: job.id,
        }));
        this.completeContentHandoff(
          handoff.request_id,
          JSON.stringify({
            reply: "Marco routed this idea before the hub restarted.",
            actions,
          }),
        );
        completed += 1;
        continue;
      }
      this.failContentHandoff(
        handoff.request_id,
        "Marco routing was interrupted before any agent work was created.",
      );
      failed += 1;
    }
    return { completed, failed };
  }

  /** Local runners vanish on restart; expose an explicit retry instead of risking a second paid run. */
  markInterrupted(excludeAgents: string[] = []): number {
    const notIn = excludeAgents.length > 0
      ? `AND agent NOT IN (${excludeAgents.map(() => "?").join(",")})`
      : "";
    const result = this.db
      .prepare(
        `UPDATE delegations
         SET status = 'error', error = ?, finished_at = ?
         WHERE status = 'running' ${notIn}`,
      )
      .run("Interrupted by a hub restart. Retry when ready.", nowIso(), ...excludeAgents);
    return result.changes;
  }

  get(id: string): Delegation | undefined {
    return this.db.prepare("SELECT * FROM delegations WHERE id = ?").get(id) as
      | Delegation
      | undefined;
  }

  list(statuses: Delegation["status"][]): Delegation[] {
    const ph = statuses.map(() => "?").join(",");
    return this.db
      .prepare(`SELECT * FROM delegations WHERE status IN (${ph}) ORDER BY created_at DESC`)
      .all(...statuses) as Delegation[];
  }

  claimNext(excludeAgents: string[] = []): Delegation | undefined {
    const notIn = excludeAgents.length > 0
      ? `AND agent NOT IN (${excludeAgents.map(() => "?").join(",")})`
      : "";
    const row = this.db
      .prepare(`SELECT * FROM delegations WHERE status = 'queued' ${notIn} ORDER BY created_at ASC LIMIT 1`)
      .get(...excludeAgents) as Delegation | undefined;
    if (!row) return undefined;
    this.db
      .prepare("UPDATE delegations SET status = 'running', started_at = ? WHERE id = ?")
      .run(nowIso(), row.id);
    return this.get(row.id);
  }

  /** Claim the next queued job for one agent (remote worker protocol). */
  claimNextFor(agent: string): Delegation | undefined {
    const row = this.db
      .prepare("SELECT * FROM delegations WHERE status = 'queued' AND agent = ? ORDER BY created_at ASC LIMIT 1")
      .get(agent) as Delegation | undefined;
    if (!row) return undefined;
    this.db
      .prepare("UPDATE delegations SET status = 'running', started_at = ? WHERE id = ?")
      .run(nowIso(), row.id);
    return this.get(row.id);
  }

  finish(
    id: string,
    r: {
      ok: boolean;
      text: string;
      sessionId: string | null;
      costUsd: number | null;
      error?: string;
      runtime: string;
      diff?: string | null;
    },
  ): void {
    this.db
      .prepare(
        `UPDATE delegations SET status = ?, runtime = ?, session_id = ?, result = ?, error = ?,
         finished_at = ?, cost_usd = ?, diff = ? WHERE id = ?`,
      )
      .run(
        r.ok ? "needs_review" : "error",
        r.runtime,
        r.sessionId,
        r.ok ? sanitizeOutput(r.text) : null, // Sanitize prose; keep the code diff verbatim.
        r.ok ? null : (r.error ?? "unknown error"),
        nowIso(),
        r.costUsd,
        r.diff ?? null,
        id,
      );
  }

  setStatus(id: string, status: "reviewed" | "dismissed" | "queued"): void {
    this.db.prepare("UPDATE delegations SET status = ? WHERE id = ?").run(status, id);
  }

  setThreadId(id: string, threadId: string): void {
    this.db.prepare("UPDATE delegations SET thread_id = ? WHERE id = ?").run(threadId, id);
  }

  byThreadId(threadId: string): Delegation | undefined {
    return this.db
      .prepare("SELECT * FROM delegations WHERE thread_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(threadId) as Delegation | undefined;
  }

  recordCost(d: Delegation, costUsd: number | null, runtime: string): void {
    this.recordUsage(d, costUsd, runtime, null, null);
  }

  recordUsage(
    d: Delegation,
    costUsd: number | null,
    runtime: string,
    inputTokens: number | null = null,
    outputTokens: number | null = null,
  ): void {
    this.db
      .prepare(
        "INSERT INTO cost_ledger (at, task_id, session_id, agent, runtime, input_tokens, output_tokens, cost_usd_list, raw) VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?)",
      )
      .run(nowIso(), d.agent, runtime, inputTokens, outputTokens, costUsd, JSON.stringify({ delegation_id: d.id }));
  }
}

export interface ExecutePayload {
  ok: boolean;
  text: string;
  sessionId: string | null;
  costUsd: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  error?: string;
  runtime: string;
  diff?: string | null;
}

/**
 * Run one delegation to completion. Shared by the in-process runner and the
 * remote home worker (which posts the payload back to the hub).
 */
export async function executeDelegationJob(
  job: Pick<Delegation, "id" | "agent" | "title" | "instructions" | "project">,
  personas: Record<string, Persona>,
  runtimes: AgentRuntime[],
  opts: { workspaceDir: string; timeoutMs: number; devTimeoutMs: number; projectsRoot: string },
): Promise<ExecutePayload> {
  const persona = personas[job.agent];
  const runtime = runtimes[0];
  if (!persona || !runtime) {
    return {
      ok: false,
      text: "",
      sessionId: null,
      costUsd: null,
      error: persona ? "no agent runtime available (out of capacity)" : `unknown agent: ${job.agent}`,
      runtime: runtime?.kind ?? "none",
    };
  }

  // Dex runs write-enabled inside the allowlisted project; everyone else
  // runs read-only in the isolated workspace.
  const isDev = job.agent === "dex";
  let cwd = resolve(opts.workspaceDir);
  if (isDev) {
    const projectPath = job.project ? resolveProject(opts.projectsRoot, job.project) : null;
    if (!projectPath) {
      return {
        ok: false,
        text: "",
        sessionId: null,
        costUsd: null,
        error: `project not in allowlist: ${job.project ?? "(none)"}`,
        runtime: runtime.kind,
      };
    }
    cwd = projectPath;
  }

  const runOpts: RunOptions = {
    cwd,
    timeoutMs: isDev ? opts.devTimeoutMs : opts.timeoutMs,
    write: isDev,
  };
  // Length control lives in the worker prompt (word budget + appendix rule).
  // The API cap is runaway protection only, sized with reasoning headroom.
  const maxOutputTokens = OUTPUT_BUDGETS[job.agent];
  if (maxOutputTokens !== undefined) runOpts.maxOutputTokens = maxOutputTokens;
  const prompt = workerPrompt(job.agent, persona, job.title, job.instructions);
  // Try the primary runtime, then configured alternates for new tasks.
  let last = await runtime.run(prompt, runOpts);
  let used: string = last.runtimeLabel ?? runtime.kind;
  for (const alt of runtimes.slice(1)) {
    if (last.ok) break;
    last = await alt.run(prompt, runOpts);
    used = last.runtimeLabel ?? alt.kind;
  }
  const diff = isDev ? captureWorkingTreeDiff(cwd) : null;
  return { ...last, runtime: used, diff };
}

export class DelegationRunner {
  private timer: NodeJS.Timeout | null = null;
  private busy = 0;

  constructor(
    private readonly store: DelegationStore,
    private readonly runtimes: AgentRuntime[],
    private readonly personas: Record<string, Persona>,
    private readonly opts: {
      workspaceDir: string;
      timeoutMs: number;
      devTimeoutMs: number;
      projectsRoot: string;
      concurrency: number;
      /** Agents this hub never runs itself (claimed by a remote worker). */
      skipAgents?: string[];
      /** Called after a job reaches needs_review or error (delivery hook). */
      onFinish?: (job: Delegation) => void;
    },
  ) {
    mkdirSync(resolve(opts.workspaceDir), { recursive: true });
  }

  start(intervalMs = 5_000): void {
    this.timer = setInterval(() => void this.pump(), intervalMs);
    this.timer.unref();
    void this.pump();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async pump(): Promise<void> {
    while (this.busy < this.opts.concurrency) {
      const job = this.store.claimNext(this.opts.skipAgents ?? []);
      if (!job) return;
      this.busy++;
      void this.execute(job).finally(() => {
        this.busy--;
      });
    }
  }

  private async execute(job: Delegation): Promise<void> {
    const payload = await executeDelegationJob(job, this.personas, this.runtimes, this.opts);
    this.store.finish(job.id, payload);
    this.store.recordUsage(
      job,
      payload.costUsd,
      payload.runtime,
      payload.inputTokens ?? null,
      payload.outputTokens ?? null,
    );
    const finished = this.store.get(job.id);
    if (finished && this.opts.onFinish) this.opts.onFinish(finished);
  }
}
