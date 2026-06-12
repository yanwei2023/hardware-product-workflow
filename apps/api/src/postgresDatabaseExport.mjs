import fs from "node:fs";
import path from "node:path";
import { readPostgresDatabaseRows } from "./postgresDatabaseReader.mjs";

export function exportPostgresDatabaseRows({
  databaseUrl = process.env.DATABASE_URL || "",
  outputPath = "data/postgres-live-rows.json",
  runner,
} = {}) {
  const resolvedOutputPath = path.resolve(outputPath);
  const database = readPostgresDatabaseRows({ databaseUrl, ...(runner ? { runner } : {}) });
  if (!database.ok) {
    return {
      ok: false,
      written: false,
      outputPath: resolvedOutputPath,
      counts: database.counts,
      errors: database.errors,
      execution: database.execution,
    };
  }

  fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  fs.writeFileSync(resolvedOutputPath, `${JSON.stringify(database.rows, null, 2)}\n`);
  return {
    ok: true,
    written: true,
    outputPath: resolvedOutputPath,
    counts: database.counts,
    errors: [],
    execution: database.execution,
  };
}
