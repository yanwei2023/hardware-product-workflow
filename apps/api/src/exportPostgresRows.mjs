import fs from "node:fs";
import path from "node:path";
import { createDemoStore } from "./server.mjs";
import { getStorePath, loadStoreFromDisk } from "./persistence.mjs";
import { mapStoreToPostgresRows } from "./postgresMapper.mjs";
import { assertValidPostgresExport } from "./postgresExportReport.mjs";

const outputPath = process.argv[2] || path.resolve("data/postgres-rows.json");
const store = loadStoreFromDisk() || createDemoStore();
const rows = mapStoreToPostgresRows(store);
const report = assertValidPostgresExport(rows);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(rows, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      sourceStorePath: getStorePath(),
      outputPath,
      valid: report.valid,
      counts: report.counts,
    },
    null,
    2,
  ),
);
