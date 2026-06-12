import fs from "node:fs";
import path from "node:path";
import { getStorePath, saveStoreToDisk } from "./persistence.mjs";
import { mapPostgresRowsToStore, postgresTableNames } from "./postgresMapper.mjs";
import { validateStoreObject } from "./storeDoctor.mjs";

export function restoreStoreFromPostgresRows({
  rowsPath,
  outputPath = getStorePath(),
  activeProjectId = null,
  confirm = false,
} = {}) {
  const resolvedRowsPath = path.resolve(rowsPath || "data/postgres-import/postgres-rows.json");
  const resolvedOutputPath = path.resolve(outputPath);
  if (!fs.existsSync(resolvedRowsPath)) {
    return {
      ok: false,
      confirmed: confirm,
      written: false,
      rowsPath: resolvedRowsPath,
      outputPath: resolvedOutputPath,
      errors: [`PostgreSQL rows file is missing: ${resolvedRowsPath}`],
    };
  }

  let rows;
  try {
    rows = JSON.parse(fs.readFileSync(resolvedRowsPath, "utf8"));
  } catch (error) {
    return {
      ok: false,
      confirmed: confirm,
      written: false,
      rowsPath: resolvedRowsPath,
      outputPath: resolvedOutputPath,
      errors: [`PostgreSQL rows JSON is invalid: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  return restoreStoreFromPostgresRowsData({
    rows,
    rowsPath: resolvedRowsPath,
    outputPath: resolvedOutputPath,
    activeProjectId,
    confirm,
  });
}

export function restoreStoreFromPostgresRowsData({
  rows,
  rowsPath = null,
  outputPath = getStorePath(),
  activeProjectId = null,
  confirm = false,
} = {}) {
  const resolvedOutputPath = path.resolve(outputPath);
  const missingTables = postgresTableNames.filter((table) => !Array.isArray(rows?.[table]));
  if (missingTables.length > 0) {
    return {
      ok: false,
      confirmed: confirm,
      written: false,
      rowsPath,
      outputPath: resolvedOutputPath,
      errors: missingTables.map((table) => `PostgreSQL rows are missing table array: ${table}`),
    };
  }

  let store;
  try {
    store = mapPostgresRowsToStore(rows, { activeProjectId });
  } catch (error) {
    return {
      ok: false,
      confirmed: confirm,
      written: false,
      rowsPath,
      outputPath: resolvedOutputPath,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
  const errors = validateStoreObject(store);
  if (activeProjectId && store.activeProjectId !== activeProjectId) {
    errors.unshift(`requested active project does not exist: ${activeProjectId}`);
  }
  const counts = Object.fromEntries(postgresTableNames.map((table) => [table, rows[table].length]));
  if (errors.length > 0) {
    return {
      ok: false,
      confirmed: confirm,
      written: false,
      rowsPath,
      outputPath: resolvedOutputPath,
      activeProjectId: store.activeProjectId,
      counts,
      errors,
    };
  }

  if (confirm) {
    saveStoreToDisk(store, { storePath: resolvedOutputPath });
  }

  return {
    ok: true,
    confirmed: confirm,
    written: confirm,
    rowsPath,
    outputPath: resolvedOutputPath,
    activeProjectId: store.activeProjectId,
    counts,
    errors: [],
    nextStep: confirm ? null : `Re-run with --confirm to write ${resolvedOutputPath}`,
  };
}
