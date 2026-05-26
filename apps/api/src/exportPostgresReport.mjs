import { createDemoStore } from "./server.mjs";
import { getStorePath, loadStoreFromDisk } from "./persistence.mjs";
import { mapStoreToPostgresRows } from "./postgresMapper.mjs";
import { validatePostgresExportRows } from "./postgresExportReport.mjs";

const store = loadStoreFromDisk() || createDemoStore();
const rows = mapStoreToPostgresRows(store);
const report = validatePostgresExportRows(rows);

console.log(
  JSON.stringify(
    {
      sourceStorePath: getStorePath(),
      ...report,
    },
    null,
    2,
  ),
);

if (!report.valid) {
  process.exitCode = 1;
}
