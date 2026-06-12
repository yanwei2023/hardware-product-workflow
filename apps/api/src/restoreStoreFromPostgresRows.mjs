import path from "node:path";
import { getStorePath } from "./persistence.mjs";
import { restoreStoreFromPostgresRows } from "./postgresStoreRestore.mjs";

const args = process.argv.slice(2);
const confirm = args.includes("--confirm");
const outputFlagIndex = args.indexOf("--output");
const activeProjectFlagIndex = args.indexOf("--active-project");
const outputPath = outputFlagIndex >= 0 ? args[outputFlagIndex + 1] : getStorePath();
const activeProjectId = activeProjectFlagIndex >= 0 ? args[activeProjectFlagIndex + 1] : null;
const excludedIndexes = new Set();
if (outputFlagIndex >= 0) {
  excludedIndexes.add(outputFlagIndex);
  excludedIndexes.add(outputFlagIndex + 1);
}
if (activeProjectFlagIndex >= 0) {
  excludedIndexes.add(activeProjectFlagIndex);
  excludedIndexes.add(activeProjectFlagIndex + 1);
}
const rowsPathArg = args.find((arg, index) => arg !== "--confirm" && !excludedIndexes.has(index));
const result = restoreStoreFromPostgresRows({
  rowsPath: path.resolve(rowsPathArg || "data/postgres-import/postgres-rows.json"),
  outputPath,
  activeProjectId,
  confirm,
});

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}
