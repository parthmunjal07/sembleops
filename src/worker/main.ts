// Optional local worker: connects outbound to a self-hosted hub, claims queued
// developer jobs, and executes them only in explicitly allowlisted projects.
// It opens no inbound ports.
// Start with: npm run worker  (needs HUB_URL + WORKER_TOKEN in .env or env)

import { existsSync, readFileSync } from "node:fs";
import { parse } from "yaml";
import { PersonasFileSchema } from "../config/schema.js";
import { executeDelegationJob, type Delegation } from "../engine/delegations.js";
import { configureProjectAccess, listProjects } from "../engine/projects.js";
import { detectRuntimes } from "../runtime/cli.js";
import { loadWorkerConfig } from "./config.js";

const POLL_MS = 8_000;

async function main(): Promise<void> {
  if (existsSync(".env")) process.loadEnvFile(".env");

  const { hubUrl, token, projectsRoot, allowedProjects } = loadWorkerConfig();
  configureProjectAccess(projectsRoot, allowedProjects);

  const personas = PersonasFileSchema.parse(parse(readFileSync("config/personas.yaml", "utf8"))).personas;
  const runtimes = detectRuntimes(["claude-code", "codex"]);
  if (runtimes.length === 0) {
    console.error("worker: no CLI runtime available (install codex or claude)");
    process.exit(1);
  }
  console.log(
    `worker: up — hub=${hubUrl}, runtimes=[${runtimes.map((r) => r.kind).join(", ")}], projects=${projectsRoot}`,
  );

  const post = (path: string, body: unknown) =>
    fetch(`${hubUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-token": token },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });

  let busy = false;
  const tick = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      const res = await post("/api/worker/claim", { agent: "dex", projects: listProjects(projectsRoot) });
      if (!res.ok) {
        console.error(`worker: claim failed (${res.status})`);
        return;
      }
      const { job } = (await res.json()) as { job: Delegation | null };
      if (!job) return;

      console.log(`worker: running [${job.project}] ${job.title}`);
      const payload = await executeDelegationJob(job, personas, runtimes, {
        workspaceDir: "data/worker-workspace",
        timeoutMs: 5 * 60_000,
        devTimeoutMs: 20 * 60_000,
        projectsRoot,
      });
      const done = await post("/api/worker/complete", { id: job.id, ...payload });
      console.log(
        `worker: ${payload.ok ? "finished" : "failed"} ${job.title} (report ${done.status})`,
      );
    } catch (err) {
      console.error("worker: hub unreachable,", (err as Error).message);
    } finally {
      busy = false;
    }
  };

  await tick();
  setInterval(() => void tick(), POLL_MS);
}

main().catch((err) => {
  console.error("worker failed to start:", err);
  process.exit(1);
});
