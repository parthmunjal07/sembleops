// Project access is deny-by-default. A project must be an explicitly allowed,
// real direct child directory of the configured root. Symlinks and Windows
// junctions are rejected so an allowed-looking name cannot escape the root.

import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

const PROJECT_NAME = /^[^./\\][^/\\]*$/;
const allowlists = new Map<string, ReadonlySet<string>>();

function canonicalDirectory(path: string): string | null {
  try {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
    return realpathSync.native(path);
  } catch {
    return null;
  }
}

function canonicalRoot(projectsRoot: string): string | null {
  return canonicalDirectory(resolve(projectsRoot));
}

function key(path: string): string {
  return process.platform === "win32" ? path.toLocaleLowerCase("en-US") : path;
}

function validProjectName(name: string): boolean {
  return PROJECT_NAME.test(name) && name !== ".." && name.trim() === name;
}

/**
 * Register the only direct child directory names that agent jobs may access.
 * An empty list intentionally disables project execution.
 */
export function configureProjectAccess(projectsRoot: string, allowedProjects: readonly string[]): void {
  const root = canonicalRoot(projectsRoot);
  if (!root) {
    // Preserve the deny-by-default registration even when a removable or
    // not-yet-mounted root is unavailable during startup.
    allowlists.set(key(resolve(projectsRoot)), new Set());
    return;
  }
  const allowed = new Set(allowedProjects.filter(validProjectName));
  allowlists.set(key(root), allowed);
}

/** Parse a comma-separated project allowlist from an environment variable. */
export function parseProjectAllowlist(value: string | undefined): string[] {
  if (!value) return [];
  return [...new Set(value.split(",").map((name) => name.trim()).filter(validProjectName))];
}

function configuredAllowlist(projectsRoot: string): ReadonlySet<string> {
  const root = canonicalRoot(projectsRoot);
  if (!root) return new Set();
  return allowlists.get(key(root)) ?? new Set();
}

function isContainedDirectChild(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel.length > 0 && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`) && !rel.includes(sep);
}

export function listProjects(projectsRoot: string): string[] {
  const root = canonicalRoot(projectsRoot);
  if (!root) return [];
  const allowed = configuredAllowlist(root);
  if (allowed.size === 0) return [];

  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && allowed.has(entry.name))
      .map((entry) => entry.name)
      .filter((name) => resolveProject(root, name) !== null)
      .sort();
  } catch {
    return [];
  }
}

/** Exact allowlisted-name match only; returns the canonical absolute path or null. */
export function resolveProject(projectsRoot: string, name: string): string | null {
  if (!validProjectName(name)) return null;
  const root = canonicalRoot(projectsRoot);
  if (!root || !configuredAllowlist(root).has(name)) return null;

  const candidate = canonicalDirectory(resolve(root, name));
  if (!candidate || !isContainedDirectChild(root, candidate)) return null;
  return candidate;
}
