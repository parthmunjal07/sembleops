import assert from "node:assert/strict";
import { test } from "node:test";
import { loadWorkerConfig } from "../src/worker/config.js";

const TOKEN = "w".repeat(32);

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    HUB_URL: "https://hub.example.test",
    WORKER_TOKEN: TOKEN,
    WORKER_PROJECTS_ROOT: "/projects",
    WORKER_ALLOWED_PROJECTS: "alpha,beta",
    ...overrides,
  };
}

test("worker config requires an independent strong secret", () => {
  assert.throws(
    () => loadWorkerConfig(environment({ WORKER_TOKEN: "" })),
    /WORKER_TOKEN is required/,
  );
  assert.throws(
    () => loadWorkerConfig(environment({ WORKER_TOKEN: "short" })),
    /at least 32 characters/,
  );
});

test("worker config requires an explicit root and valid project allowlist", () => {
  assert.throws(
    () => loadWorkerConfig(environment({ WORKER_PROJECTS_ROOT: "" })),
    /WORKER_PROJECTS_ROOT is required/,
  );
  assert.throws(
    () => loadWorkerConfig(environment({ WORKER_ALLOWED_PROJECTS: "../escape,nested/path" })),
    /must name at least one project/,
  );
});

test("worker refuses plaintext remote hubs and URLs that may leak credentials", () => {
  assert.throws(
    () => loadWorkerConfig(environment({ HUB_URL: "http://hub.example.test" })),
    /HTTPS is required/,
  );
  assert.throws(
    () => loadWorkerConfig(environment({ HUB_URL: "https://user:secret@hub.example.test" })),
    /must not contain credentials/,
  );
  assert.throws(
    () => loadWorkerConfig(environment({ HUB_URL: "https://hub.example.test?token=secret" })),
    /must not contain credentials/,
  );
});

test("worker permits plaintext only for loopback development", () => {
  const loaded = loadWorkerConfig(environment({ HUB_URL: "http://127.0.0.1:4747/" }));
  assert.equal(loaded.hubUrl, "http://127.0.0.1:4747");
  assert.deepEqual(loaded.allowedProjects, ["alpha", "beta"]);
});
