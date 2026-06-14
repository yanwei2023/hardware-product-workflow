import fs from "node:fs";
import path from "node:path";
import { readPostgresDatabaseRows } from "./postgresDatabaseReader.mjs";
import { validatePostgresExportRows } from "./postgresExportReport.mjs";
import { mapStoreToPostgresRows, postgresTableNames } from "./postgresMapper.mjs";

function normalizeValue(value, key = "") {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((itemKey) => value[itemKey] !== undefined)
        .map((itemKey) => [itemKey, normalizeValue(value[itemKey], itemKey)]),
    );
  }
  if (typeof value === "string" && key.endsWith("_at")) {
    const timestamp = Date.parse(value);
    if (!Number.isNaN(timestamp)) {
      return new Date(timestamp).toISOString();
    }
  }
  return value;
}

function valuesEqual(left, right, key = "") {
  return JSON.stringify(normalizeValue(left, key)) === JSON.stringify(normalizeValue(right, key));
}

function changedFields(expected, actual) {
  return [...new Set([...Object.keys(expected || {}), ...Object.keys(actual || {})])]
    .sort()
    .filter((field) => !valuesEqual(expected?.[field], actual?.[field], field));
}

export function comparePostgresRows(expectedRows, actualRows) {
  const tables = {};
  let missingInDatabaseCount = 0;
  let missingInStoreCount = 0;
  let changedRowCount = 0;

  for (const table of postgresTableNames) {
    const expectedById = new Map((expectedRows[table] || []).map((row) => [row.id, row]));
    const actualById = new Map((actualRows[table] || []).map((row) => [row.id, row]));
    const missingInDatabase = [...expectedById.keys()].filter((id) => !actualById.has(id)).sort();
    const missingInStore = [...actualById.keys()].filter((id) => !expectedById.has(id)).sort();
    const changed = [...expectedById.keys()]
      .filter((id) => actualById.has(id))
      .map((id) => ({ id, fields: changedFields(expectedById.get(id), actualById.get(id)) }))
      .filter((item) => item.fields.length > 0)
      .sort((left, right) => String(left.id).localeCompare(String(right.id)));

    missingInDatabaseCount += missingInDatabase.length;
    missingInStoreCount += missingInStore.length;
    changedRowCount += changed.length;
    tables[table] = {
      inSync: missingInDatabase.length === 0 && missingInStore.length === 0 && changed.length === 0,
      expectedCount: expectedById.size,
      actualCount: actualById.size,
      missingInDatabase,
      missingInStore,
      changed,
    };
  }

  return {
    inSync: missingInDatabaseCount === 0 && missingInStoreCount === 0 && changedRowCount === 0,
    summary: {
      tableCount: postgresTableNames.length,
      driftedTableCount: Object.values(tables).filter((table) => !table.inSync).length,
      missingInDatabaseCount,
      missingInStoreCount,
      changedRowCount,
    },
    tables,
  };
}

export function compareStoreWithPostgres({
  store,
  databaseUrl = process.env.DATABASE_URL || "",
  runner,
} = {}) {
  let expectedRows;
  try {
    expectedRows = mapStoreToPostgresRows(store);
  } catch (error) {
    return {
      ok: false,
      inSync: false,
      errors: [error instanceof Error ? error.message : String(error)],
      comparison: null,
      execution: null,
    };
  }

  const expectedValidation = validatePostgresExportRows(expectedRows);
  if (!expectedValidation.valid) {
    return {
      ok: false,
      inSync: false,
      errors: expectedValidation.errors,
      comparison: null,
      execution: null,
    };
  }

  const database = readPostgresDatabaseRows({ databaseUrl, ...(runner ? { runner } : {}) });
  if (!database.ok) {
    return {
      ok: false,
      inSync: false,
      errors: database.errors,
      comparison: null,
      execution: database.execution,
    };
  }

  const comparison = comparePostgresRows(expectedRows, database.rows);
  return {
    ok: true,
    inSync: comparison.inSync,
    errors: [],
    comparison,
    execution: database.execution,
  };
}

export function writePostgresStoreComparisonReport(result, {
  reportPath,
  sourceStorePath,
  generatedAt = new Date(),
} = {}) {
  const resolvedReportPath = path.resolve(reportPath || "data/postgres-store-comparison.json");
  const report = {
    generatedAt: generatedAt instanceof Date ? generatedAt.toISOString() : String(generatedAt),
    reportPath: resolvedReportPath,
    sourceStorePath: sourceStorePath ? path.resolve(sourceStorePath) : null,
    ok: result.ok,
    inSync: result.inSync,
    errors: result.errors,
    comparison: result.comparison,
    execution: result.execution,
  };
  fs.mkdirSync(path.dirname(resolvedReportPath), { recursive: true });
  fs.writeFileSync(resolvedReportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export function verifyPostgresStoreComparisonReport(reportPath) {
  const resolvedReportPath = path.resolve(reportPath);
  if (!fs.existsSync(resolvedReportPath)) {
    return {
      valid: false,
      reportPath: resolvedReportPath,
      errors: [`PostgreSQL store comparison report is missing: ${resolvedReportPath}`],
    };
  }

  let report;
  try {
    report = JSON.parse(fs.readFileSync(resolvedReportPath, "utf8"));
  } catch (error) {
    return {
      valid: false,
      reportPath: resolvedReportPath,
      errors: [`PostgreSQL store comparison report JSON is invalid: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  const errors = [];
  if (!report.generatedAt || Number.isNaN(Date.parse(report.generatedAt))) {
    errors.push("generatedAt must be a valid timestamp");
  }
  if (report.reportPath !== resolvedReportPath) {
    errors.push("reportPath does not match the verified file");
  }
  if (/postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@/.test(JSON.stringify(report))) {
    errors.push("report contains an unredacted PostgreSQL credential");
  }
  if (report.ok !== true) {
    errors.push("comparison execution was not successful");
  }
  if (report.inSync !== true) {
    errors.push("store and PostgreSQL are not in sync");
  }
  if (report.comparison?.inSync !== true) {
    errors.push("comparison details are not in sync");
  }

  const tables = report.comparison?.tables || {};
  const tableEntries = Object.entries(tables);
  if (tableEntries.length !== postgresTableNames.length || postgresTableNames.some((table) => !tables[table])) {
    errors.push("comparison does not contain every mapped PostgreSQL table");
  } else {
    const tableHasDrift = (table) =>
      (table.missingInDatabase?.length || 0) > 0 ||
      (table.missingInStore?.length || 0) > 0 ||
      (table.changed?.length || 0) > 0;
    const summary = {
      tableCount: tableEntries.length,
      driftedTableCount: tableEntries.filter(([, table]) => tableHasDrift(table)).length,
      missingInDatabaseCount: tableEntries.reduce((count, [, table]) => count + (table.missingInDatabase?.length || 0), 0),
      missingInStoreCount: tableEntries.reduce((count, [, table]) => count + (table.missingInStore?.length || 0), 0),
      changedRowCount: tableEntries.reduce((count, [, table]) => count + (table.changed?.length || 0), 0),
    };
    for (const [tableName, table] of tableEntries) {
      const hasDrift = tableHasDrift(table);
      if (table.inSync === hasDrift) {
        errors.push(`comparison table ${tableName} inSync does not match its details`);
      }
      const expectedActualCount = Number(table.expectedCount) - (table.missingInDatabase?.length || 0) + (table.missingInStore?.length || 0);
      if (Number(table.actualCount) !== expectedActualCount) {
        errors.push(`comparison table ${tableName} counts do not match its missing rows`);
      }
    }
    for (const [key, value] of Object.entries(summary)) {
      if (report.comparison?.summary?.[key] !== value) {
        errors.push(`comparison summary ${key} does not match table details`);
      }
    }
    if (summary.driftedTableCount !== 0) {
      errors.push("comparison table details contain drift");
    }
  }

  return {
    valid: errors.length === 0,
    reportPath: resolvedReportPath,
    errors,
    generatedAt: report.generatedAt || null,
    sourceStorePath: report.sourceStorePath || null,
    summary: report.comparison?.summary || null,
  };
}
