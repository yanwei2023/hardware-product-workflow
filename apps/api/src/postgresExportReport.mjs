import fs from "node:fs";
import path from "node:path";
import { postgresTableNames } from "./postgresMapper.mjs";
import {
  parsePostgresSchemaColumns,
  parsePostgresSchemaTables,
  validatePostgresRequiredValues,
  validatePostgresRowCoverage,
  validatePostgresRowReferences,
} from "./postgresSchemaCheck.mjs";

const defaultSchemaPath = path.resolve("schemas/database.sql");

export function countPostgresRows(rows) {
  return Object.fromEntries(Object.entries(rows).map(([table, items]) => [table, Array.isArray(items) ? items.length : 0]));
}

export function validatePostgresExportRows(rows, schemaSql = fs.readFileSync(defaultSchemaPath, "utf8")) {
  const missingTables = postgresTableNames.filter((table) => !Array.isArray(rows[table]));
  const errors = missingTables.map((table) => `PostgreSQL export is missing table ${table}`);

  if (missingTables.length === 0) {
    errors.push(
      ...validatePostgresRowCoverage(parsePostgresSchemaTables(schemaSql), rows),
      ...validatePostgresRequiredValues(parsePostgresSchemaColumns(schemaSql), rows),
      ...validatePostgresRowReferences(rows),
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    counts: countPostgresRows(rows),
  };
}

export function assertValidPostgresExport(rows, schemaSql) {
  const report = validatePostgresExportRows(rows, schemaSql);
  if (!report.valid) {
    throw new Error(`PostgreSQL export validation failed:\n${report.errors.join("\n")}`);
  }
  return report;
}
