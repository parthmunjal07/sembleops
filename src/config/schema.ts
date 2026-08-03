import { z } from "zod";

// ---- Personas (config/personas.yaml) ----

export const PersonaSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  promise: z.string().min(1),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  silhouette: z.string().min(1),
  pressure: z.enum(["low", "medium", "high"]),
  tone: z.string().min(1),
  speaks_when: z.string().optional(),
  firmness: z.enum(["gentle", "direct", "firm", "operator-mode"]).optional(),
  scope: z.string().optional(),
  required_for: z.string().optional(),
  sources: z.string().optional(),
});

export const PersonasFileSchema = z
  .object({
    personas: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/), PersonaSchema),
  })
  .superRefine((file, ctx) => {
    // Exactly one high-pressure accountability agent is allowed.
    const high = Object.entries(file.personas).filter(([, p]) => p.pressure === "high");
    if (high.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `exactly one persona may be high-pressure, found ${high.length} (${high.map(([slug]) => slug).join(", ")})`,
        path: ["personas"],
      });
    }
  });

export type Persona = z.infer<typeof PersonaSchema>;
export type PersonasFile = z.infer<typeof PersonasFileSchema>;

// ---- Deployment config (config/sembleops.yaml) ----

const TimeHHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM");

const DeploymentModeSchema = z.union([
  z.enum(["local", "cloud"]),
  // Compatibility for installations created before this mode was renamed.
  z.literal("home").transform(() => "local" as const),
]);

const ProjectName = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[^./\\][^/\\]*$/, "expected a direct child directory name, not a path");

export const NodeConfigSchema = z.object({
  node: DeploymentModeSchema,
  timezone: z.string().min(1),
  quiet_hours: z.object({
    start: TimeHHMM,
    end: TimeHHMM,
  }),
  discord: z.object({
    token_env: z.string().min(1),
    owner_user_id_env: z.string().min(1),
    channel: z.string().default("inbox"),
  }),
  server: z.object({
    port: z.number().int().positive(),
    host: z.string().default("127.0.0.1"),
    // Authentication may be omitted only for loopback-only local mode.
    auth_token_env: z.string().default("HUB_ACCESS_TOKEN"),
    worker_token_env: z.string().default("WORKER_TOKEN"),
  }),
  coding: z.object({
    // The root is only a boundary; no child is accessible unless its exact
    // directory name also appears in allowed_projects.
    projects_root: z.string().min(1),
    allowed_projects: z.array(ProjectName).max(200).default([]),
    // local: the hub runs developer jobs itself. remote: jobs queue until an
    // outbound worker (npm run worker) claims them.
    dex_mode: z.enum(["local", "remote"]).default("local"),
  }),
  storage: z.object({
    db_path: z.string().min(1),
    transcripts_dir: z.string().min(1),
    artifacts_dir: z.string().min(1),
  }),
  nag: z.object({
    snooze_cap: z.number().int().positive(),
    blocked_recheck_hours: z.number().int().positive(),
    morning_brief: TimeHHMM,
    evening_reckoning: TimeHHMM,
  }),
  runtimes: z
    .array(
      z.object({
        kind: z.enum(["claude-code", "codex", "api-openai"]),
        default: z.boolean().optional(),
      }),
    )
    .min(1),
});

export type NodeConfig = z.infer<typeof NodeConfigSchema>;
