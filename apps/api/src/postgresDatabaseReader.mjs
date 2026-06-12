import { spawnSync } from "node:child_process";
import { validatePostgresExportRows } from "./postgresExportReport.mjs";
import { postgresTableNames } from "./postgresMapper.mjs";

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
    // A malformed URL is still protected by full-value redaction above.
  }
  return text;
}

function summarizeExecution(result, databaseUrl) {
  const status = Number.isInteger(result?.status) ? result.status : null;
  const error = result?.error?.message ? redactExecutionText(result.error.message, databaseUrl) : null;
  return {
    ok: status === 0 && !error,
    status,
    signal: result?.signal || null,
    stdout: redactExecutionText(result?.stdout, databaseUrl).trim(),
    stderr: redactExecutionText(result?.stderr, databaseUrl).trim(),
    error,
  };
}

export function buildPostgresRowsQuery(tableNames = postgresTableNames) {
  if (tableNames.length === 0 || tableNames.some((table) => !/^[a-z_]+$/.test(table))) {
    throw new Error("PostgreSQL row export contains an invalid table name");
  }
  const argumentsSql = tableNames
    .flatMap((table) => [
      `'${table}'`,
      `COALESCE((SELECT json_agg(row_to_json(source_row) ORDER BY source_row.id) FROM ${table} source_row), '[]'::json)`,
    ])
    .join(",\n  ");
  return `SELECT json_build_object(\n  ${argumentsSql}\n)::text AS rows;`;
}

export function readPostgresDatabaseRows({
  databaseUrl = process.env.DATABASE_URL || "",
  runner = runPsqlQuery,
} = {}) {
  if (!databaseUrl) {
    return {
      ok: false,
      rows: null,
      counts: null,
      errors: ["DATABASE_URL is required to read PostgreSQL rows"],
      execution: null,
    };
  }

  let query;
  try {
    query = buildPostgresRowsQuery();
  } catch (error) {
    return {
      ok: false,
      rows: null,
      counts: null,
      errors: [error instanceof Error ? error.message : String(error)],
      execution: null,
    };
  }

  const execution = summarizeExecution(runner(databaseUrl, query), databaseUrl);
  if (!execution.ok) {
    return {
      ok: false,
      rows: null,
      counts: null,
      errors: [execution.error || execution.stderr || "psql failed to read PostgreSQL rows"],
      execution: { ...execution, stdout: "" },
    };
  }

  let rows;
  try {
    const jsonLine = execution.stdout.split("\n").map((line) => line.trim()).filter(Boolean).at(-1);
    rows = JSON.parse(jsonLine || "{}");
  } catch (error) {
    return {
      ok: false,
      rows: null,
      counts: null,
      errors: [`unable to parse PostgreSQL rows: ${error instanceof Error ? error.message : String(error)}`],
      execution: { ...execution, stdout: "" },
    };
  }

  const validation = validatePostgresExportRows(rows);
  return {
    ok: validation.valid,
    rows: validation.valid ? rows : null,
    counts: validation.counts,
    errors: validation.errors,
    execution: { ...execution, stdout: "" },
  };
}
