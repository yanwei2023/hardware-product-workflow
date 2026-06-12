import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { readPostgresDatabaseRows } from "./postgresDatabaseReader.mjs";
import { validatePostgresExportRows } from "./postgresExportReport.mjs";
import { mapStoreToPostgresRows, postgresTableNames, renderPostgresMirrorSql } from "./postgresMapper.mjs";
import { comparePostgresRows } from "./postgresStoreComparison.mjs";
import { validateStoreObject } from "./storeDoctor.mjs";

function runPsqlFile(databaseUrl, filePath) {
  return spawnSync(
    "psql",
    ["--dbname", databaseUrl, "--set", "ON_ERROR_STOP=1", "--file", filePath],
    { encoding: "utf8" },
  );
}

function redact(value, databaseUrl) {
  let text = String(value || "");
  if (!databaseUrl) {
    return text;
  }
  text = text.replaceAll(databaseUrl, "[REDACTED_DATABASE_URL]");
  try {
    const password = new URL(databaseUrl).password;
    if (password) {
      text = text.replaceAll(password, "***");
    }
  } catch {
    // Full-value redaction above still protects malformed connection strings.
  }
  return text;
}

function summarizeExecution(result, databaseUrl) {
  const status = Number.isInteger(result?.status) ? result.status : null;
  const error = result?.error?.message ? redact(result.error.message, databaseUrl) : null;
  return {
    ok: status === 0 && !error,
    status,
    signal: result?.signal || null,
    stdout: redact(result?.stdout, databaseUrl).trim(),
    stderr: redact(result?.stderr, databaseUrl).trim(),
    error,
  };
}

export function synchronizeStoreToPostgres({
  store,
  databaseUrl = process.env.DATABASE_URL || "",
  outputDir = "data/postgres-store-sync",
  confirm = false,
  runner = runPsqlFile,
  queryRunner,
} = {}) {
  const resolvedOutputDir = path.resolve(outputDir);
  const sqlPath = path.join(resolvedOutputDir, "postgres-store-sync.sql");
  const storeErrors = validateStoreObject(store);
  if (storeErrors.length > 0) {
    return {
      ready: false,
      confirmed: confirm,
      executed: false,
      ok: false,
      outputDir: resolvedOutputDir,
      sqlPath,
      counts: null,
      errors: storeErrors,
      execution: null,
      verification: null,
    };
  }
  let rows;
  try {
    rows = mapStoreToPostgresRows(store);
  } catch (error) {
    return {
      ready: false,
      confirmed: confirm,
      executed: false,
      ok: false,
      sqlPath,
      counts: null,
      errors: [error instanceof Error ? error.message : String(error)],
      execution: null,
      verification: null,
    };
  }

  const validation = validatePostgresExportRows(rows);
  if (!validation.valid) {
    return {
      ready: false,
      confirmed: confirm,
      executed: false,
      ok: false,
      sqlPath,
      counts: validation.counts,
      errors: validation.errors,
      execution: null,
      verification: null,
    };
  }

  fs.mkdirSync(resolvedOutputDir, { recursive: true });
  fs.writeFileSync(sqlPath, renderPostgresMirrorSql(rows));
  const plan = {
    mode: "EXACT_MIRROR",
    tableCount: postgresTableNames.length,
    upsertRowCount: Object.values(validation.counts).reduce((sum, count) => sum + count, 0),
    pruneDatabaseOnlyRows: true,
  };

  if (!confirm) {
    return {
      ready: true,
      confirmed: false,
      executed: false,
      ok: true,
      outputDir: resolvedOutputDir,
      sqlPath,
      counts: validation.counts,
      plan,
      errors: [],
      execution: null,
      verification: null,
      nextStep: `Run npm run db:sync-store -- ${resolvedOutputDir} --confirm`,
    };
  }

  if (!databaseUrl) {
    return {
      ready: false,
      confirmed: true,
      executed: false,
      ok: false,
      outputDir: resolvedOutputDir,
      sqlPath,
      counts: validation.counts,
      plan,
      errors: ["DATABASE_URL is required to synchronize the store"],
      execution: null,
      verification: null,
    };
  }

  const execution = summarizeExecution(runner(databaseUrl, sqlPath), databaseUrl);
  if (!execution.ok) {
    return {
      ready: true,
      confirmed: true,
      executed: true,
      ok: false,
      outputDir: resolvedOutputDir,
      sqlPath,
      counts: validation.counts,
      plan,
      errors: [execution.error || execution.stderr || "psql failed to synchronize the store"],
      execution,
      verification: null,
    };
  }

  const database = readPostgresDatabaseRows({ databaseUrl, ...(queryRunner ? { runner: queryRunner } : {}) });
  if (!database.ok) {
    return {
      ready: true,
      confirmed: true,
      executed: true,
      ok: false,
      outputDir: resolvedOutputDir,
      sqlPath,
      counts: validation.counts,
      plan,
      errors: database.errors,
      execution,
      verification: { ok: false, comparison: null, execution: database.execution },
    };
  }

  const comparison = comparePostgresRows(rows, database.rows);
  return {
    ready: true,
    confirmed: true,
    executed: true,
    ok: comparison.inSync,
    outputDir: resolvedOutputDir,
    sqlPath,
    counts: validation.counts,
    plan,
    errors: comparison.inSync ? [] : ["PostgreSQL still differs from the JSON store after synchronization"],
    execution,
    verification: { ok: comparison.inSync, comparison, execution: database.execution },
  };
}

export function writePostgresStoreSyncReport(result, {
  reportPath = path.join(result.outputDir || "data/postgres-store-sync", "postgres-store-sync-result.json"),
  generatedAt = new Date(),
} = {}) {
  const resolvedReportPath = path.resolve(reportPath);
  const report = {
    generatedAt: generatedAt instanceof Date ? generatedAt.toISOString() : String(generatedAt),
    reportPath: resolvedReportPath,
    ready: result.ready,
    confirmed: result.confirmed,
    executed: result.executed,
    ok: result.ok,
    outputDir: result.outputDir || path.dirname(resolvedReportPath),
    sqlPath: result.sqlPath,
    counts: result.counts,
    plan: result.plan || null,
    errors: result.errors,
    execution: result.execution,
    verification: result.verification,
    nextStep: result.nextStep || null,
  };
  fs.mkdirSync(path.dirname(resolvedReportPath), { recursive: true });
  fs.writeFileSync(resolvedReportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export function verifyPostgresStoreSyncReport(reportPath) {
  const resolvedReportPath = path.resolve(reportPath);
  if (!fs.existsSync(resolvedReportPath)) {
    return {
      valid: false,
      reportPath: resolvedReportPath,
      errors: [`PostgreSQL store sync report is missing: ${resolvedReportPath}`],
    };
  }

  let report;
  try {
    report = JSON.parse(fs.readFileSync(resolvedReportPath, "utf8"));
  } catch (error) {
    return {
      valid: false,
      reportPath: resolvedReportPath,
      errors: [`PostgreSQL store sync report JSON is invalid: ${error instanceof Error ? error.message : String(error)}`],
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
  if (report.ready !== true || report.confirmed !== true || report.executed !== true || report.ok !== true) {
    errors.push("report does not describe a successful confirmed synchronization");
  }
  if ((report.errors || []).length > 0) {
    errors.push("synchronization report contains errors");
  }
  if (report.plan?.mode !== "EXACT_MIRROR" || report.plan?.pruneDatabaseOnlyRows !== true) {
    errors.push("synchronization plan is not an exact mirror");
  }
  if (report.plan?.tableCount !== postgresTableNames.length) {
    errors.push("synchronization plan table count is incomplete");
  }
  const expectedUpsertCount = Object.values(report.counts || {}).reduce((sum, count) => sum + Number(count || 0), 0);
  if (report.plan?.upsertRowCount !== expectedUpsertCount) {
    errors.push("synchronization plan row count does not match report counts");
  }
  if (report.execution?.ok !== true || report.execution?.status !== 0) {
    errors.push("synchronization SQL execution did not succeed");
  }
  if (report.verification?.ok !== true || report.verification?.comparison?.inSync !== true) {
    errors.push("post-synchronization verification did not pass");
  }
  const summary = report.verification?.comparison?.summary;
  const comparisonTables = report.verification?.comparison?.tables || {};
  if (
    Object.keys(comparisonTables).length !== postgresTableNames.length ||
    postgresTableNames.some((table) => !comparisonTables[table])
  ) {
    errors.push("post-synchronization comparison is missing mapped tables");
  } else if (
    Object.values(comparisonTables).some(
      (table) =>
        table.inSync !== true ||
        (table.missingInDatabase?.length || 0) > 0 ||
        (table.missingInStore?.length || 0) > 0 ||
        (table.changed?.length || 0) > 0,
    )
  ) {
    errors.push("post-synchronization table details contain drift");
  }
  if (
    !summary ||
    summary.tableCount !== postgresTableNames.length ||
    summary.driftedTableCount !== 0 ||
    summary.missingInDatabaseCount !== 0 ||
    summary.missingInStoreCount !== 0 ||
    summary.changedRowCount !== 0
  ) {
    errors.push("post-synchronization comparison summary contains drift");
  }

  if (!report.sqlPath || !fs.existsSync(report.sqlPath)) {
    errors.push(`synchronization SQL file is missing: ${report.sqlPath || "-"}`);
  } else {
    const sql = fs.readFileSync(report.sqlPath, "utf8");
    if (!sql.includes("BEGIN;") || !sql.includes("COMMIT;") || !sql.includes("pg_advisory_xact_lock")) {
      errors.push("synchronization SQL is missing its transaction or advisory lock");
    }
    for (const table of postgresTableNames) {
      if (!sql.includes(`DELETE FROM ${table}`)) {
        errors.push(`synchronization SQL is missing exact-mirror cleanup for ${table}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    reportPath: resolvedReportPath,
    errors,
    generatedAt: report.generatedAt || null,
    sqlPath: report.sqlPath || null,
    counts: report.counts || null,
    summary: summary || null,
  };
}
