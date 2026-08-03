import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import {
  NodeConfigSchema,
  PersonasFileSchema,
  type NodeConfig,
  type PersonasFile,
} from "./schema.js";

export interface SembleopsConfig {
  node: NodeConfig;
  personas: PersonasFile["personas"];
}

function loadYaml(path: string): unknown {
  return parse(readFileSync(path, "utf8"));
}

export function loadConfig(rootDir: string = process.cwd()): SembleopsConfig {
  const nodePath = resolve(rootDir, process.env["SEMBLEOPS_CONFIG"] ?? "config/sembleops.yaml");
  const personasPath = resolve(rootDir, "config/personas.yaml");

  const node = NodeConfigSchema.parse(loadYaml(nodePath));
  const personasFile = PersonasFileSchema.parse(loadYaml(personasPath));

  return { node, personas: personasFile.personas };
}
