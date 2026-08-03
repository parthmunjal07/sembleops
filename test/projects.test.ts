import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
  configureProjectAccess,
  listProjects,
  parseProjectAllowlist,
  resolveProject,
} from "../src/engine/projects.js";

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "sembleops-projects-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

test("project discovery is deny-by-default and exposes only allowlisted direct children", () => {
  const root = temporaryRoot();
  mkdirSync(join(root, "allowed"));
  mkdirSync(join(root, "not-allowed"));

  configureProjectAccess(root, ["allowed"]);

  assert.deepEqual(listProjects(root), ["allowed"]);
  assert.equal(resolveProject(root, "allowed"), realpathSync.native(join(root, "allowed")));
  assert.equal(resolveProject(root, "not-allowed"), null);
  assert.equal(resolveProject(root, "../allowed"), null);
  assert.equal(resolveProject(root, "allowed/child"), null);
});

test("an empty allowlist disables project access", () => {
  const root = temporaryRoot();
  mkdirSync(join(root, "project"));

  configureProjectAccess(root, []);

  assert.deepEqual(listProjects(root), []);
  assert.equal(resolveProject(root, "project"), null);
});

test("symlinks and Windows junctions cannot escape the project root", () => {
  const root = temporaryRoot();
  const outside = temporaryRoot();
  const linked = join(root, "linked");
  symlinkSync(outside, linked, process.platform === "win32" ? "junction" : "dir");

  configureProjectAccess(root, ["linked"]);

  assert.deepEqual(listProjects(root), []);
  assert.equal(resolveProject(root, "linked"), null);
});

test("environment allowlists accept names but discard paths and duplicates", () => {
  assert.deepEqual(
    parseProjectAllowlist("alpha, beta,../escape,alpha,nested/project, .hidden"),
    ["alpha", "beta"],
  );
});
