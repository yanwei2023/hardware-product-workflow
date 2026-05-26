import fs from "node:fs";
import path from "node:path";
import { createDemoStore } from "./server.mjs";
import { getStorePath, loadStoreFromDisk } from "./persistence.mjs";
import { mapStoreToPostgresRows, renderPostgresSeedSql } from "./postgresMapper.mjs";
import { assertValidPostgresExport } from "./postgresExportReport.mjs";

const outputPath = process.argv[2] || path.resolve("data/postgres-seed.sql");
const store = loadStoreFromDisk() || createDemoStore();
const rows = mapStoreToPostgresRows(store);
const report = assertValidPostgresExport(rows);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, renderPostgresSeedSql(rows));

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
