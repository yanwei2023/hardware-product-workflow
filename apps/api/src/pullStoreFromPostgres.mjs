import { getStorePath } from "./persistence.mjs";
import { pullStoreFromPostgres } from "./postgresStorePull.mjs";

const args = process.argv.slice(2);
const confirm = args.includes("--confirm");
const outputFlagIndex = args.indexOf("--output");
const activeProjectFlagIndex = args.indexOf("--active-project");
const outputPath = outputFlagIndex >= 0 ? args[outputFlagIndex + 1] : getStorePath();
const activeProjectId = activeProjectFlagIndex >= 0 ? args[activeProjectFlagIndex + 1] : null;

const result = pullStoreFromPostgres({ outputPath, activeProjectId, confirm });
console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}
