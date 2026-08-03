// The migrator reads SQL relative to the compiled file, so mirror migrations
// into dist after TypeScript compilation.
import { cpSync, mkdirSync } from "node:fs";

mkdirSync("dist/db/migrations", { recursive: true });
cpSync("src/db/migrations", "dist/db/migrations", { recursive: true });
console.log("database migrations copied into dist/");
