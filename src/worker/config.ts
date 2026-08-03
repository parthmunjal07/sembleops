import { parseProjectAllowlist } from "../engine/projects.js";

export interface WorkerConfig {
  hubUrl: string;
  token: string;
  projectsRoot: string;
  allowedProjects: string[];
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const rawHubUrl = (env["HUB_URL"] ?? "http://localhost:4747").replace(/\/$/, "");
  let parsedHubUrl: URL;
  try {
    parsedHubUrl = new URL(rawHubUrl);
  } catch {
    throw new Error("worker: HUB_URL must be a valid http(s) URL");
  }
  if (!["http:", "https:"].includes(parsedHubUrl.protocol)) {
    throw new Error("worker: HUB_URL must use http or https");
  }
  if (parsedHubUrl.username || parsedHubUrl.password || parsedHubUrl.search || parsedHubUrl.hash) {
    throw new Error("worker: HUB_URL must not contain credentials, a query, or a fragment");
  }
  if (parsedHubUrl.protocol !== "https:" && !isLoopbackHostname(parsedHubUrl.hostname)) {
    throw new Error("worker: HTTPS is required when HUB_URL is not loopback");
  }

  const token = env["WORKER_TOKEN"];
  if (!token) throw new Error("worker: WORKER_TOKEN is required (same value the hub has)");
  if (token.length < 32) throw new Error("worker: WORKER_TOKEN must be at least 32 characters");

  const projectsRoot = env["WORKER_PROJECTS_ROOT"];
  if (!projectsRoot) throw new Error("worker: WORKER_PROJECTS_ROOT is required");

  const allowedProjects = parseProjectAllowlist(env["WORKER_ALLOWED_PROJECTS"]);
  if (allowedProjects.length === 0) {
    throw new Error("worker: WORKER_ALLOWED_PROJECTS must name at least one project");
  }

  return { hubUrl: rawHubUrl, token, projectsRoot, allowedProjects };
}
