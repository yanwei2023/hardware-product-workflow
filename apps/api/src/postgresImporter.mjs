import { spawnSync } from "node:child_process";
import path from "node:path";
import { checkPostgresPreflight } from "./postgresPreflight.mjs";

function runPsql(databaseUrl, filePath) {
  return spawnSync(
    "psql",
    ["--dbname", databaseUrl, "--set", "ON_ERROR_STOP=1", "--file", filePath],
    { encoding: "utf8" },
  );
}

function runPsqlQuery(databaseUrl, query) {
  return spawnSync(
    "psql",
    ["--dbname", databaseUrl, "--set", "ON_ERROR_STOP=1", "--tuples-only", "--no-align", "--quiet", "--command", query],
    { encoding: "utf8" },
  );
}

function redactExecutionText(value, databaseUrl) {
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
    // The preflight reports malformed connection details; keep fallback redaction limited to the full value.
  }
  return text;
}

function summarizeExecution(stage, filePath, result, databaseUrl) {
  const status = Number.isInteger(result?.status) ? result.status : null;
  const error = result?.error?.message ? redactExecutionText(result.error.message, databaseUrl) : null;
  return {
    stage,
    filePath,
    ok: status === 0 && !error,
    status,
    signal: result?.signal || null,
    stdout: redactExecutionText(result?.stdout, databaseUrl).trim(),
    stderr: redactExecutionText(result?.stderr, databaseUrl).trim(),
    error,
  };
}

function buildCountQuery(counts) {
  const tables = Object.keys(counts || {});
  if (tables.some((table) => !/^[a-z_]+$/.test(table))) {
    throw new Error("import manifest contains an invalid PostgreSQL table name");
  }
  const argumentsSql = tables.flatMap((table) => [`'${table}'`, `(SELECT count(*) FROM ${table})`]).join(", ");
  return `SELECT json_build_object(${argumentsSql})::text AS counts;`;
}

function verifyImportedCounts(expectedCounts, result, databaseUrl) {
  const execution = summarizeExecution("verification", null, result, databaseUrl);
  if (!execution.ok) {
    return { ...execution, expectedCounts, actualCounts: null, discrepancies: [] };
  }

  let actualCounts;
  try {
    const jsonLine = execution.stdout.split("\n").map((line) => line.trim()).filter(Boolean).at(-1) || "{}";
    actualCounts = JSON.parse(jsonLine);
  } catch (error) {
    return {
      ...execution,
      ok: false,
      error: `unable to parse PostgreSQL count verification: ${error instanceof Error ? error.message : String(error)}`,
      expectedCounts,
      actualCounts: null,
      discrepancies: [],
    };
  }

  const discrepancies = Object.entries(expectedCounts || {})
    .filter(([table, expected]) => Number(actualCounts[table]) !== Number(expected))
    .map(([table, expected]) => ({ table, expected, actual: actualCounts[table] ?? null }));

  return {
    ...execution,
    ok: discrepancies.length === 0,
    expectedCounts,
    actualCounts,
    discrepancies,
  };
}

export function executePostgresImport({
  databaseUrl = process.env.DATABASE_URL || "",
  outputDir = "data/postgres-import",
  confirm = false,
  psql,
  runner = runPsql,
  queryRunner = runPsqlQuery,
} = {}) {
  const resolvedOutputDir = path.resolve(outputDir);
  const preflight = checkPostgresPreflight({ databaseUrl, outputDir: resolvedOutputDir, strict: true, ...(psql ? { psql } : {}) });
  const files = preflight.checks.importBundle.files || {};
  const plan = [
    { stage: "schema", filePath: files.schema || null },
    { stage: "seed", filePath: files.seed || null },
  ];

  if (!preflight.ready) {
    return {
      ready: false,
      confirmed: confirm,
      executed: false,
      ok: false,
      blockers: preflight.blockers,
      preflight,
      plan,
      executions: [],
    };
  }

  if (!confirm) {
    return {
      ready: true,
      confirmed: false,
      executed: false,
      ok: true,
      blockers: [],
      preflight,
      plan,
      executions: [],
      nextStep: `Run npm run db:import -- ${resolvedOutputDir} --confirm`,
    };
  }

  const executions = [];
  for (const item of plan) {
    const execution = summarizeExecution(item.stage, item.filePath, runner(databaseUrl, item.filePath), databaseUrl);
    executions.push(execution);
    if (!execution.ok) {
      return {
        ready: true,
        confirmed: true,
        executed: true,
        ok: false,
        failedStage: item.stage,
        blockers: [],
        preflight,
        plan,
        executions,
      };
    }
  }

  let verification;
  try {
    const query = buildCountQuery(preflight.checks.importBundle.counts || {});
    verification = verifyImportedCounts(
      preflight.checks.importBundle.counts || {},
      queryRunner(databaseUrl, query),
      databaseUrl,
    );
  } catch (error) {
    verification = {
      stage: "verification",
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      expectedCounts: preflight.checks.importBundle.counts || {},
      actualCounts: null,
      discrepancies: [],
    };
  }
  executions.push(verification);
  if (!verification.ok) {
    return {
      ready: true,
      confirmed: true,
      executed: true,
      ok: false,
      failedStage: "verification",
      blockers: [],
      preflight,
      plan,
      executions,
      verification,
    };
  }

  return {
    ready: true,
    confirmed: true,
    executed: true,
    ok: true,
    failedStage: null,
    blockers: [],
    preflight,
    plan,
    executions,
    verification,
  };
}
