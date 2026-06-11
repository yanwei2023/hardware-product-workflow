import fs from "node:fs";
import path from "node:path";

export const postgresImportResultFileName = "postgres-import-result.json";
export const postgresImportPreviewFileName = "postgres-import-preview.json";

function compactExecution(execution = {}) {
  return {
    stage: execution.stage || null,
    filePath: execution.filePath || null,
    ok: execution.ok === true,
    status: execution.status ?? null,
    signal: execution.signal || null,
    error: execution.error || null,
    stderr: execution.stderr || "",
  };
}

function countDiscrepancies(expectedCounts = {}, actualCounts = {}) {
  const tables = new Set([...Object.keys(expectedCounts), ...Object.keys(actualCounts)]);
  return [...tables]
    .filter((table) => Number(expectedCounts[table]) !== Number(actualCounts[table]))
    .map((table) => ({ table, expected: expectedCounts[table] ?? null, actual: actualCounts[table] ?? null }));
}

export function buildPostgresImportResultReport(result, { generatedAt = new Date(), outputDir, reportPath } = {}) {
  const generatedAtIso = generatedAt instanceof Date ? generatedAt.toISOString() : String(generatedAt);
  const resolvedOutputDir = path.resolve(outputDir || result?.preflight?.checks?.importBundle?.outputDir || ".");
  const resolvedReportPath = path.resolve(reportPath || path.join(resolvedOutputDir, postgresImportResultFileName));
  const database = result?.preflight?.checks?.databaseUrl || { configured: false, value: null };
  const importBundle = result?.preflight?.checks?.importBundle || {};

  return {
    generatedAt: generatedAtIso,
    reportPath: resolvedReportPath,
    outputDir: resolvedOutputDir,
    database,
    bundle: {
      manifestPath: importBundle.manifestPath || null,
      valid: importBundle.valid === true,
      counts: importBundle.counts || {},
      files: importBundle.files || {},
    },
    outcome: {
      ready: result?.ready === true,
      confirmed: result?.confirmed === true,
      executed: result?.executed === true,
      ok: result?.ok === true,
      failedStage: result?.failedStage || null,
      blockers: result?.blockers || [],
    },
    executions: (result?.executions || []).map(compactExecution),
    verification: result?.verification
      ? {
          ok: result.verification.ok === true,
          expectedCounts: result.verification.expectedCounts || {},
          actualCounts: result.verification.actualCounts || null,
          discrepancies: result.verification.discrepancies || [],
          error: result.verification.error || null,
        }
      : null,
  };
}

export function writePostgresImportResultReport(result, options = {}) {
  const report = buildPostgresImportResultReport(result, options);
  fs.mkdirSync(path.dirname(report.reportPath), { recursive: true });
  fs.writeFileSync(report.reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export function verifyPostgresImportResultReport(reportPath) {
  const resolvedReportPath = path.resolve(reportPath);
  const errors = [];
  if (!fs.existsSync(resolvedReportPath)) {
    return { valid: false, reportPath: resolvedReportPath, errors: [`import result report is missing: ${resolvedReportPath}`] };
  }

  let report;
  try {
    report = JSON.parse(fs.readFileSync(resolvedReportPath, "utf8"));
  } catch (error) {
    return {
      valid: false,
      reportPath: resolvedReportPath,
      errors: [`import result report JSON is invalid: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  if (!report.generatedAt || Number.isNaN(Date.parse(report.generatedAt))) {
    errors.push("generatedAt must be a valid timestamp");
  }
  if (report.reportPath !== resolvedReportPath) {
    errors.push("reportPath does not match the verified file");
  }
  if (report.database?.value && /:\/\/[^:@/]+:[^@/]+@/.test(report.database.value) && !report.database.value.includes(":***@")) {
    errors.push("database connection password is not redacted");
  }
  if (report.outcome?.executed !== true || report.outcome?.confirmed !== true) {
    errors.push("report does not describe a confirmed import execution");
  }
  if (report.outcome?.ok !== true) {
    errors.push(`import outcome is not successful${report.outcome?.failedStage ? `: ${report.outcome.failedStage}` : ""}`);
  }
  const executionStages = (report.executions || []).map((item) => item.stage);
  for (const stage of ["schema", "seed", "verification"]) {
    if (!executionStages.includes(stage)) {
      errors.push(`execution stage is missing: ${stage}`);
    }
  }
  if ((report.executions || []).some((item) => item.ok !== true)) {
    errors.push("one or more execution stages failed");
  }
  const schemaExecution = (report.executions || []).find((item) => item.stage === "schema");
  const seedExecution = (report.executions || []).find((item) => item.stage === "seed");
  if (schemaExecution && schemaExecution.filePath !== report.bundle?.files?.schema) {
    errors.push("schema execution file does not match the import bundle");
  }
  if (seedExecution && seedExecution.filePath !== report.bundle?.files?.seed) {
    errors.push("seed execution file does not match the import bundle");
  }
  if (report.verification?.ok !== true) {
    errors.push("row count verification did not pass");
  }
  if ((report.verification?.discrepancies || []).length > 0) {
    errors.push("row count verification contains discrepancies");
  }
  if (countDiscrepancies(report.bundle?.counts || {}, report.verification?.expectedCounts || {}).length > 0) {
    errors.push("verification expected counts do not match bundle counts");
  }
  if (countDiscrepancies(report.verification?.expectedCounts || {}, report.verification?.actualCounts || {}).length > 0) {
    errors.push("verification actual counts do not match expected counts");
  }

  const manifestPath = report.bundle?.manifestPath;
  if (!manifestPath || !fs.existsSync(manifestPath)) {
    errors.push(`referenced import manifest is missing: ${manifestPath || "-"}`);
  } else {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (path.resolve(manifest.outputDir || ".") !== path.resolve(report.outputDir || ".")) {
        errors.push("report outputDir does not match the import manifest");
      }
      if (countDiscrepancies(manifest.counts || {}, report.bundle?.counts || {}).length > 0) {
        errors.push("report bundle counts do not match the import manifest");
      }
    } catch (error) {
      errors.push(`referenced import manifest JSON is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    valid: errors.length === 0,
    reportPath: resolvedReportPath,
    errors,
    generatedAt: report.generatedAt || null,
    database: report.database || null,
    bundle: report.bundle || null,
    outcome: report.outcome || null,
    verification: report.verification || null,
  };
}
