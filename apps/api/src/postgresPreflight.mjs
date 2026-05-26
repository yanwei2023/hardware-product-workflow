import { spawnSync } from "node:child_process";
import path from "node:path";
import { verifyPostgresImportBundle } from "./postgresImportBundle.mjs";

function redactDatabaseUrl(value) {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.password) {
      url.password = "***";
    }
    return url.toString();
  } catch {
    return value.replace(/:\/\/([^:@]+):([^@]+)@/, "://$1:***@");
  }
}

function detectPsql() {
  const result = spawnSync("psql", ["--version"], { encoding: "utf8" });
  if (result.error) {
    return {
      available: false,
      version: null,
      error: result.error.message,
    };
  }
  return {
    available: result.status === 0,
    version: (result.stdout || result.stderr).trim() || null,
    error: result.status === 0 ? null : (result.stderr || result.stdout).trim(),
  };
}

export function checkPostgresPreflight({
  databaseUrl = process.env.DATABASE_URL || "",
  outputDir = "data/postgres-import",
  strict = false,
  psql = detectPsql(),
} = {}) {
  const resolvedOutputDir = path.resolve(outputDir);
  const importBundle = verifyPostgresImportBundle(resolvedOutputDir);
  const checks = {
    databaseUrl: {
      configured: Boolean(databaseUrl),
      value: redactDatabaseUrl(databaseUrl),
    },
    psql,
    importBundle,
  };
  const blockers = [];

  if (!checks.databaseUrl.configured) {
    blockers.push("DATABASE_URL is not configured");
  }
  if (!checks.psql.available) {
    blockers.push(`psql is not available${checks.psql.error ? `: ${checks.psql.error}` : ""}`);
  }
  if (!checks.importBundle.valid) {
    blockers.push(...checks.importBundle.errors.map((error) => `import bundle: ${error}`));
  }

  return {
    ready: blockers.length === 0,
    strict,
    blockers,
    checks,
    nextSteps:
      blockers.length === 0
        ? [
            checks.importBundle.files ? `psql "$DATABASE_URL" -f ${checks.importBundle.files.schema}` : 'psql "$DATABASE_URL" -f schemas/database.sql',
            checks.importBundle.files ? `psql "$DATABASE_URL" -f ${checks.importBundle.files.seed}` : 'psql "$DATABASE_URL" -f data/postgres-import/postgres-seed.sql',
          ]
        : [
            "Run npm run db:prepare-import -- /tmp/hardware-flow-postgres-import",
            "Run npm run db:verify-import-bundle -- /tmp/hardware-flow-postgres-import",
            "Set DATABASE_URL and install PostgreSQL client tools if needed.",
          ],
  };
}
