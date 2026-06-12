import path from "node:path";
import { exportPostgresDatabaseRows } from "./postgresDatabaseExport.mjs";

const outputPath = path.resolve(process.argv[2] || "data/postgres-live-rows.json");
const result = exportPostgresDatabaseRows({ outputPath });
console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}
