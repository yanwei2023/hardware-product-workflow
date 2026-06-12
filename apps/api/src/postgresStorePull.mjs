import { getStorePath } from "./persistence.mjs";
import { readPostgresDatabaseRows } from "./postgresDatabaseReader.mjs";
import { restoreStoreFromPostgresRowsData } from "./postgresStoreRestore.mjs";

export function pullStoreFromPostgres({
  databaseUrl = process.env.DATABASE_URL || "",
  outputPath = getStorePath(),
  activeProjectId = null,
  confirm = false,
  runner,
} = {}) {
  const database = readPostgresDatabaseRows({ databaseUrl, ...(runner ? { runner } : {}) });
  if (!database.ok) {
    return {
      ok: false,
      confirmed: confirm,
      written: false,
      outputPath,
      activeProjectId: null,
      counts: database.counts,
      errors: database.errors,
      execution: database.execution,
    };
  }

  return {
    ...restoreStoreFromPostgresRowsData({
      rows: database.rows,
      rowsPath: "postgresql://live-read",
      outputPath,
      activeProjectId,
      confirm,
    }),
    execution: database.execution,
  };
}
