import path from "node:path";
import { createDemoStore } from "./server.mjs";
import { loadStoreFromDisk } from "./persistence.mjs";
import { synchronizeStoreToPostgres, writePostgresStoreSyncReport } from "./postgresStoreSync.mjs";

const args = process.argv.slice(2);
const confirm = args.includes("--confirm");
const outputDirArg = args.find((arg) => arg !== "--confirm") || "data/postgres-store-sync";
const outputDir = path.resolve(outputDirArg);
const store = loadStoreFromDisk() || createDemoStore();
const result = synchronizeStoreToPostgres({ store, outputDir, confirm });
const report = writePostgresStoreSyncReport(result, {
  reportPath: path.join(outputDir, confirm ? "postgres-store-sync-result.json" : "postgres-store-sync-preview.json"),
});

console.log(JSON.stringify(report, null, 2));
if (!result.ok) {
  process.exitCode = 1;
}
