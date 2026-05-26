import assert from "node:assert/strict";
import test from "node:test";
import { buildPostgresImportManifest } from "./postgresImportBundle.mjs";

test("PostgreSQL import manifest includes validated files and psql commands", () => {
  const manifest = buildPostgresImportManifest({
    generatedAt: new Date("2026-05-26T08:00:00.000Z"),
    outputDir: "/tmp/hardware-flow-import",
    sourceStorePath: "/tmp/store.json",
    schemaPath: "schemas/database.sql",
    rowsPath: "/tmp/hardware-flow-import/postgres-rows.json",
    seedPath: "/tmp/hardware-flow-import/postgres-seed.sql",
    reportPath: "/tmp/hardware-flow-import/postgres-export-report.json",
    report: {
      valid: true,
      errors: [],
      counts: { projects: 1 },
    },
  });

  assert.equal(manifest.generatedAt, "2026-05-26T08:00:00.000Z");
  assert.equal(manifest.valid, true);
  assert.deepEqual(manifest.counts, { projects: 1 });
  assert.equal(manifest.files.rows, "/tmp/hardware-flow-import/postgres-rows.json");
  assert.equal(manifest.psql.requiredEnv, "DATABASE_URL");
  assert.equal(manifest.psql.createSchema, 'psql "$DATABASE_URL" -f schemas/database.sql');
  assert.equal(manifest.psql.importSeed, 'psql "$DATABASE_URL" -f /tmp/hardware-flow-import/postgres-seed.sql');
});
