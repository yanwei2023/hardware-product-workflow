import path from "node:path";
import { verifyPostgresStoreComparisonReport } from "./postgresStoreComparison.mjs";

const reportPath = path.resolve(process.argv[2] || "data/postgres-store-comparison.json");
const result = verifyPostgresStoreComparisonReport(reportPath);
console.log(JSON.stringify(result, null, 2));

if (!result.valid) {
  process.exitCode = 1;
}
