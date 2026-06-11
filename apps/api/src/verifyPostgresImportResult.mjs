import path from "node:path";
import { postgresImportResultFileName, verifyPostgresImportResultReport } from "./postgresImportReport.mjs";

const inputPath = process.argv[2] || path.join("data/postgres-import", postgresImportResultFileName);
const result = verifyPostgresImportResultReport(inputPath);

console.log(JSON.stringify(result, null, 2));

if (!result.valid) {
  process.exitCode = 1;
}
