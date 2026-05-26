import fs from "node:fs";
import path from "node:path";
import { createDemoStore } from "./server.mjs";
import { getStorePath, loadStoreFromDisk } from "./persistence.mjs";
import { mapStoreToPostgresRows } from "./postgresMapper.mjs";

const outputPath = process.argv[2] || path.resolve("data/postgres-rows.json");
const store = loadStoreFromDisk() || createDemoStore();
const rows = mapStoreToPostgresRows(store);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(rows, null, 2)}\n`);

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
