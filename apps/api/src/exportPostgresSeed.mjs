import fs from "node:fs";
import path from "node:path";
import { createDemoStore } from "./server.mjs";
import { getStorePath, loadStoreFromDisk } from "./persistence.mjs";
import { mapStoreToPostgresRows, postgresTableNames, renderPostgresSeedSql } from "./postgresMapper.mjs";

const outputPath = process.argv[2] || path.resolve("data/postgres-seed.sql");
const store = loadStoreFromDisk() || createDemoStore();
const rows = mapStoreToPostgresRows(store);
const missingTables = postgresTableNames.filter((table) => !Array.isArray(rows[table]));

if (missingTables.length > 0) {
  throw new Error(`PostgreSQL seed export is missing tables: ${missingTables.join(", ")}`);
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, renderPostgresSeedSql(rows));

const counts = Object.fromEntries(Object.entries(rows).map(([table, items]) => [table, items.length]));
console.log(
  JSON.stringify(
    {
      sourceStorePath: getStorePath(),
      outputPath,
      counts,
    },
    null,
    2,
  ),
);
