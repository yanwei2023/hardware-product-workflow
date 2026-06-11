import fs from "node:fs";
import path from "node:path";
import { createDemoStore } from "./server.mjs";
import { getStorePath, loadStoreFromDisk } from "./persistence.mjs";
import { assertValidPostgresExport } from "./postgresExportReport.mjs";
import { buildPostgresImportManifest } from "./postgresImportBundle.mjs";
import { mapStoreToPostgresRows, renderPostgresSeedSql } from "./postgresMapper.mjs";

const outputDir = path.resolve(process.argv[2] || "data/postgres-import");
const schemaPath = "schemas/database.sql";
const rowsPath = path.join(outputDir, "postgres-rows.json");
const seedPath = path.join(outputDir, "postgres-seed.sql");
const reportPath = path.join(outputDir, "postgres-export-report.json");
const manifestPath = path.join(outputDir, "postgres-import-manifest.json");

const store = loadStoreFromDisk() || createDemoStore();
const rows = mapStoreToPostgresRows(store);
const report = assertValidPostgresExport(rows);
const manifest = buildPostgresImportManifest({
  outputDir,
  sourceStorePath: getStorePath(),
  schemaPath,
  rowsPath,
  seedPath,
  reportPath,
  report,
});

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(rowsPath, `${JSON.stringify(rows, null, 2)}\n`);
fs.writeFileSync(seedPath, renderPostgresSeedSql(rows));
fs.writeFileSync(
  reportPath,
  `${JSON.stringify(
    {
      sourceStorePath: getStorePath(),
      ...report,
    },
    null,
    2,
  )}\n`,
);
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      outputDir,
      manifestPath,
      valid: report.valid,
      counts: report.counts,
      psql: manifest.psql,
      commands: manifest.commands,
    },
    null,
    2,
  ),
);
