// Marco Maestro — the front door. Every conversation goes through him;
// he routes to Larry (commitments) and the workers (delegations).

import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Persona } from "../config/schema.js";
import { defaultNagTime, parseCapture } from "../engine/capture.js";
import type { DelegationStore } from "../engine/delegations.js";
import type { TaskStore } from "../engine/store.js";
import type { AgentRuntime } from "../runtime/types.js";
import { chatJson } from "../runtime/openaiChat.js";
import { sanitizeOutput } from "../shared/style.js";
import { heuristicRoute, marcoPrompt, parseMarcoDecision, type MarcoDecision } from "./souls.js";

export interface RoutedAction {
  type: "commitment" | "delegate";
  agent: string;
  title: string;
  detail: string; // echo line (commitment) or instructions summary (delegate)
  id: string; // task id or delegation id
}

export interface MarcoResponse {
  reply: string;
  actions: RoutedAction[];
}

export interface MarcoHandleOptions {
  /** Supplied by durable workflows that need to group retries around one route. */
  missionId?: string;
  /** Provenance copied to every delegation Marco creates for a content idea. */
  contentIdeaId?: string;
  contentRunKind?: "context";
  /** Concise mission label when the routing prompt itself is an internal brief. */
  logUserText?: string;
  /** Content Studio handoffs are agent work, never Larry commitments. */
  delegatesOnly?: boolean;
}

export class Marco {
  constructor(
    private readonly db: Database.Database,
    private readonly tasks: TaskStore,
    private readonly delegations: DelegationStore,
    private readonly runtimes: AgentRuntime[],
    private readonly personas: Record<string, Persona>,
    private readonly getMorningBrief: () => string,
    /** Project names Dex may target: local folder scan, or the home worker's report. */
    private readonly getProjects: () => string[],
    private readonly isDexOnline: () => boolean = () => true,
  ) {}

  async handle(userText: string, options: MarcoHandleOptions = {}): Promise<MarcoResponse> {
    const decision = await this.route(userText);
    // Enforce output style rules on everything the model produced.
    decision.reply = sanitizeOutput(decision.reply);
    for (const a of decision.actions) {
      a.title = sanitizeOutput(a.title);
      if (a.instructions) a.instructions = sanitizeOutput(a.instructions);
    }
    const applyDecision = this.db.transaction((): MarcoResponse => {
      const actions: RoutedAction[] = [];
      // One routing = one mission: sibling delegations share it so the UI can
      // Render multi-agent work as a single combined packet.
      const missionId = options.missionId ?? randomUUID();
      let delegated = 0;
      let skippedCommitments = 0;

      for (const action of decision.actions) {
        if (action.type === "commitment") {
          if (options.delegatesOnly) {
            skippedCommitments += 1;
            continue;
          }
          const parsed = parseCapture(action.title);
          const task = this.tasks.createTask({
            title: parsed.title,
            source: "text",
            due_at: parsed.due_at,
            next_nag_at: parsed.due_at ?? defaultNagTime(this.getMorningBrief()).toISOString(),
          });
          actions.push({
            type: "commitment",
            agent: "larry",
            title: parsed.title,
            detail: parsed.echo,
            id: task.id,
          });
        } else if (action.type === "delegate" && action.agent) {
          // Dex requires a valid allowlisted project — reject rather than guess.
          if (action.agent === "dex") {
            const valid = action.project && this.getProjects().includes(action.project);
            if (!valid) {
              decision.reply += ` (I couldn't match "${action.project ?? "?"}" to a project folder, so I didn't start that coding task.)`;
              continue;
            }
          }
          const instructions = action.instructions ?? action.title;
          const d = this.delegations.enqueue(
            action.agent,
            action.title,
            instructions,
            action.agent === "dex" ? (action.project ?? null) : null,
            {
              verifyRequested: Boolean(action.verify) && action.agent !== "paige",
              missionId,
              ...(options.contentIdeaId && options.contentRunKind
                ? {
                    contentIdeaId: options.contentIdeaId,
                    contentRunKind: options.contentRunKind,
                  }
                : {}),
            },
          );
          delegated += 1;
          if (action.agent === "dex" && !this.isDexOnline()) {
            decision.reply +=
              " Your machine is offline right now, so Dex will start as soon as it comes back online.";
          }
          actions.push({
            type: "delegate",
            agent: action.agent,
            title: action.project ? `[${action.project}] ${action.title}` : action.title,
            detail: instructions,
            id: d.id,
          });
        }
      }

      if (options.delegatesOnly && skippedCommitments > 0) {
        const agents = [
          ...new Set(actions.filter((a) => a.type === "delegate").map((a) => a.agent)),
        ];
        decision.reply = agents.length > 0
          ? `I routed this idea to ${agents.join(" and ")}.`
          : "I could not identify a useful agent handoff for this idea yet.";
      }

      this.db
        .prepare(
          "INSERT INTO marco_log (at, user_text, reply, actions, mission_id) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          new Date().toISOString(),
          options.logUserText ?? userText,
          decision.reply,
          JSON.stringify(actions),
          delegated > 0 || options.missionId ? missionId : null,
        );

      return { reply: decision.reply, actions };
    });
    return applyDecision.immediate();
  }

  goalForMission(missionId: string): { user_text: string; reply: string; at: string } | null {
    return (
      (this.db
        .prepare("SELECT user_text, reply, at FROM marco_log WHERE mission_id = ? LIMIT 1")
        .get(missionId) as { user_text: string; reply: string; at: string } | undefined) ?? null
    );
  }

  log(limit = 50): Array<{ id: number; at: string; user_text: string; reply: string; actions: RoutedAction[] }> {
    const rows = this.db
      .prepare("SELECT * FROM marco_log ORDER BY id DESC LIMIT ?")
      .all(limit) as Array<{ id: number; at: string; user_text: string; reply: string; actions: string }>;
    return rows.map((r) => ({ ...r, actions: JSON.parse(r.actions) as RoutedAction[] }));
  }

  private async route(userText: string): Promise<MarcoDecision> {
    const prompt = marcoPrompt(this.personas, userText, this.getProjects());

    // Routing is latency-critical UX: try the direct API first (~1-3s),
    // fall back to the CLI runtime (~30s+), then to the safe heuristic.
    const started = Date.now();
    const fast = await chatJson(prompt);
    if (fast.ok) {
      console.log(`marco: routed via ${fast.model} in ${Date.now() - started}ms`);
      this.db
        .prepare(
          "INSERT INTO cost_ledger (at, agent, runtime, input_tokens, output_tokens, cost_usd_list, raw) VALUES (?, 'marco', ?, ?, ?, NULL, ?)",
        )
        .run(
          new Date().toISOString(),
          `openai:${fast.model}`,
          fast.inputTokens ?? null,
          fast.outputTokens ?? null,
          JSON.stringify({ purpose: "routing" }),
        );
      const parsed = parseMarcoDecision(fast.text);
      if (parsed) return parsed;
      return { reply: fast.text.slice(0, 600), actions: [] };
    }
    console.warn(`marco: fast route unavailable (${fast.error}), falling back to CLI runtime`);

    const runtime = this.runtimes[0];
    if (!runtime) return heuristicRoute(userText);
    const res = await runtime.run(prompt, {
      cwd: process.cwd(),
      timeoutMs: 90_000,
    });
    if (!res.ok) return heuristicRoute(userText);
    const parsed = parseMarcoDecision(res.text);
    if (!parsed) {
      // Marco answered conversationally instead of routing — pass it through.
      return { reply: res.text.slice(0, 600), actions: [] };
    }
    return parsed;
  }
}
