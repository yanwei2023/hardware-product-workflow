import path from "node:path";
import { executePostgresImport } from "./postgresImporter.mjs";

const args = process.argv.slice(2);
const confirm = args.includes("--confirm");
const outputDirArg = args.find((arg) => arg !== "--confirm");
const outputDir = path.resolve(outputDirArg || "data/postgres-import");
const result = executePostgresImport({ outputDir, confirm });

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}
