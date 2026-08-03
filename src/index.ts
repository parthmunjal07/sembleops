// SembleOps boot: the coordinator routes, configured runtimes execute, and the
// deterministic task engine tracks commitments.

import { existsSync } from "node:fs";
import { Marco } from "./agents/marco.js";
import { verificationInstructions } from "./agents/souls.js";
import { loadConfig } from "./config/load.js";
import { migrate, openDb } from "./db/migrate.js";
import { delegationFinishNotifier, SembleopsBot } from "./discord/bot.js";
import { DelegationRunner, DelegationStore, type Delegation } from "./engine/delegations.js";
import { ContentIdeaStore } from "./engine/contentIdeas.js";
import { configureProjectAccess, listProjects } from "./engine/projects.js";
import { Scheduler } from "./engine/scheduler.js";
import { TaskStore } from "./engine/store.js";
import { detectRuntimes } from "./runtime/cli.js";
import { assertServerSecurity, buildServer } from "./server/api.js";

async function main(): Promise<void> {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const config = loadConfig();
  assertServerSecurity(config);
  configureProjectAccess(
    config.node.coding.projects_root,
    config.node.coding.allowed_projects,
  );
  console.log(
    `sembleops booting — node=${config.node.node}, tz=${config.node.timezone}, ` +
      `personas=[${Object.keys(config.personas).join(", ")}]`,
  );

  const db = openDb(config.node.storage.db_path);
  const ran = migrate(db);
  if (ran.length > 0) console.log(`db: applied migrations ${ran.join(", ")}`);

  const runtimes = detectRuntimes(config.node.runtimes.map((r) => r.kind));
  console.log(
    runtimes.length > 0
      ? `runtimes: ${runtimes.map((r) => r.kind).join(", ")}`
      : "runtimes: NONE — delegation disabled, capture-only mode",
  );
  const dexRemote = config.node.coding.dex_mode === "remote";
  if (dexRemote) console.log("developer agent: remote mode — jobs queue for the outbound worker");

  const store = new TaskStore(db);
  const contentIdeas = new ContentIdeaStore(db);
  const delegations = new DelegationStore(db);
  const recoveredHandoffs = delegations.recoverContentHandoffs();
  if (recoveredHandoffs.completed > 0 || recoveredHandoffs.failed > 0) {
    console.log(
      `content handoffs: recovered ${recoveredHandoffs.completed}, `
        + `marked interrupted ${recoveredHandoffs.failed}`,
    );
  }
  const interruptedDelegations = delegations.markInterrupted(dexRemote ? ["dex"] : []);
  if (interruptedDelegations > 0) {
    console.log(`delegations: marked ${interruptedDelegations} interrupted local job(s) for retry`);
  }
  const reminderDefaults = {
    timezone: config.node.timezone,
    quiet_hours: config.node.quiet_hours,
    morning_brief: config.node.nag.morning_brief,
    evening_reckoning: config.node.nag.evening_reckoning,
  };
  const getReminderSettings = () => store.getReminderSettings(reminderDefaults);

  const scheduler = new Scheduler(store, config.node.quiet_hours, config.node.nag.blocked_recheck_hours, {
    timezone: config.node.timezone,
    morningBrief: config.node.nag.morning_brief,
    eveningReckoning: config.node.nag.evening_reckoning,
  }, getReminderSettings);
  scheduler.start();

  const notifyFinish = delegationFinishNotifier(store);
  const workerState = { lastSeen: null as string | null, projects: [] as string[] };

  // A finished delegation flagged for
  // verification automatically hands its output to Paige. Deterministic code,
  // and identical whether the job ran here or on the outbound worker.
  const chainAndNotify = (job: Delegation): void => {
    notifyFinish(job);
    if (
      job.verify_requested === 1 &&
      job.agent !== "paige" &&
      job.status === "needs_review" &&
      job.result
    ) {
      const child = delegations.enqueue(
        "paige",
        `Verify: ${job.title}`,
        verificationInstructions(job),
        null,
        {
          parentId: job.id,
          ...(job.mission_id && { missionId: job.mission_id }),
          ...(job.content_idea_id && {
            contentIdeaId: job.content_idea_id,
            contentRunKind: "verification" as const,
          }),
        },
      );
      if (job.thread_id) delegations.setThreadId(child.id, job.thread_id);
      console.log(`pipeline: paige verification queued for "${job.title}"`);
    }
  };

  const runner = new DelegationRunner(delegations, runtimes, config.personas, {
    workspaceDir: `${config.node.storage.artifacts_dir}/workspaces`,
    timeoutMs: 5 * 60_000, // per-task runaway protection
    devTimeoutMs: 20 * 60_000, // real coding tasks need room
    projectsRoot: config.node.coding.projects_root,
    concurrency: 2,
    ...(dexRemote && { skipAgents: ["dex"] }),
    onFinish: chainAndNotify,
  });
  runner.start();

  const dexOnline = (): boolean =>
    !dexRemote ||
    (workerState.lastSeen !== null && Date.now() - Date.parse(workerState.lastSeen) < 60_000);

  const getProjects = (): string[] =>
    dexRemote ? workerState.projects : listProjects(config.node.coding.projects_root);

  const marco = new Marco(
    db,
    store,
    delegations,
    runtimes,
    config.personas,
    () => getReminderSettings().morning_brief,
    getProjects,
    dexOnline,
  );

  const server = buildServer({
    store,
    contentIdeas,
    delegations,
    marco,
    config,
    runtimeKinds: runtimes.map((r) => r.kind),
    workerState,
    onDelegationFinish: chainAndNotify,
  });
  const port = config.node.server.port;
  await server.listen({ port, host: config.node.server.host });
  console.log(`hub up — http://localhost:${port} (host ${config.node.server.host})`);

  const bot = new SembleopsBot({
    store,
    delegations,
    marco,
    config,
    hubUrl: `http://localhost:${port}`,
  });
  await bot.start().catch((err) => {
    // The engine must not die because Discord can't connect.
    console.error("discord: failed to start —", (err as Error).message);
    return false;
  });
}

main().catch((err) => {
  console.error("boot failed:", err);
  process.exit(1);
});
