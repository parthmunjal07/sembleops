import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  configuredModels,
  openAiApiKey,
  openAiApiKeyAvailable,
} from "../src/runtime/openaiConfig.js";

const MODEL_ENV = "SEMBLEOPS_TEST_OPENAI_MODELS";

afterEach(() => {
  delete process.env["OPENAI_API_KEY"];
  delete process.env["TRANSCRIPTION_API_KEY"];
  delete process.env[MODEL_ENV];
});

test("standard OpenAI credentials take precedence over the legacy migration variable", () => {
  process.env["OPENAI_API_KEY"] = "standard-key";
  process.env["TRANSCRIPTION_API_KEY"] = "legacy-key";

  assert.equal(openAiApiKey(), "standard-key");
  assert.equal(openAiApiKeyAvailable(), true);
});

test("legacy OpenAI credentials remain available during migration", () => {
  process.env["TRANSCRIPTION_API_KEY"] = "legacy-key";

  assert.equal(openAiApiKey(), "legacy-key");
  assert.equal(openAiApiKeyAvailable(), true);
});

test("model overrides are read lazily, trimmed, and deduplicated", () => {
  assert.deepEqual(configuredModels(MODEL_ENV, ["default-model"]), ["default-model"]);

  process.env[MODEL_ENV] = " model-a,model-b,model-a ";
  assert.deepEqual(configuredModels(MODEL_ENV, ["default-model"]), ["model-a", "model-b"]);
});
