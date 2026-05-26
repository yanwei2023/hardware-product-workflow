import path from "node:path";
import { verifyPostgresImportBundle } from "./postgresImportBundle.mjs";

const outputDir = path.resolve(process.argv[2] || "data/postgres-import");
const result = verifyPostgresImportBundle(outputDir);

console.log(JSON.stringify(result, null, 2));

if (!result.valid) {
  process.exitCode = 1;
}
