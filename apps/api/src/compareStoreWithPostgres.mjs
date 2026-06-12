import path from "node:path";
import { createDemoStore } from "./server.mjs";
import { getStorePath, loadStoreFromDisk } from "./persistence.mjs";
import { compareStoreWithPostgres, writePostgresStoreComparisonReport } from "./postgresStoreComparison.mjs";

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const reportFlagIndex = args.indexOf("--report");
const reportPath = path.resolve(
  reportFlagIndex >= 0 ? args[reportFlagIndex + 1] : "data/postgres-store-comparison.json",
);
const sourceStorePath = getStorePath();
const store = loadStoreFromDisk() || createDemoStore();
const result = compareStoreWithPostgres({ store });
const report = writePostgresStoreComparisonReport(result, { reportPath, sourceStorePath });

console.log(JSON.stringify(report, null, 2));

if (!result.ok) {
  process.exitCode = 1;
} else if (strict && !result.inSync) {
  process.exitCode = 2;
}
