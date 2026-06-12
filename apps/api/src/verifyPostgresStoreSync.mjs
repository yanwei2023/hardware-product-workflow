import path from "node:path";
import { verifyPostgresStoreSyncReport } from "./postgresStoreSync.mjs";

const reportPath = path.resolve(process.argv[2] || "data/postgres-store-sync/postgres-store-sync-result.json");
const result = verifyPostgresStoreSyncReport(reportPath);
console.log(JSON.stringify(result, null, 2));

if (!result.valid) {
  process.exitCode = 1;
}
