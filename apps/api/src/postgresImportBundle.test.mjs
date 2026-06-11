import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildPostgresImportManifest, verifyPostgresImportBundle } from "./postgresImportBundle.mjs";

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
  assert.equal(manifest.commands.preflight, "npm run db:preflight -- /tmp/hardware-flow-import --strict");
  assert.equal(manifest.commands.preview, "npm run db:import -- /tmp/hardware-flow-import");
  assert.equal(manifest.commands.execute, "npm run db:import -- /tmp/hardware-flow-import --confirm");
  assert.equal(
    manifest.commands.verifyResult,
    "npm run db:verify-import-result -- /tmp/hardware-flow-import/postgres-import-result.json",
  );
});

test("PostgreSQL import bundle verifier accepts a complete bundle", () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-import-bundle-"));
  const rowsPath = path.join(outputDir, "postgres-rows.json");
  const seedPath = path.join(outputDir, "postgres-seed.sql");
  const reportPath = path.join(outputDir, "postgres-export-report.json");
  const manifestPath = path.join(outputDir, "postgres-import-manifest.json");
  const schemaPath = path.join(outputDir, "database.sql");

  const manifest = buildPostgresImportManifest({
    outputDir,
    sourceStorePath: "/tmp/store.json",
    schemaPath,
    rowsPath,
    seedPath,
    reportPath,
    report: {
      valid: true,
      errors: [],
      counts: { projects: 1 },
    },
  });

  fs.writeFileSync(schemaPath, "create table projects (id text primary key);\n");
  fs.writeFileSync(rowsPath, '{"projects":[]}\n');
  fs.writeFileSync(seedPath, "BEGIN;\nINSERT INTO projects (id) VALUES ('project-1')\nON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id;\nCOMMIT;\n");
  fs.writeFileSync(reportPath, '{"valid":true,"errors":[],"counts":{"projects":1}}\n');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const result = verifyPostgresImportBundle(outputDir);

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.counts, { projects: 1 });
  fs.rmSync(outputDir, { recursive: true, force: true });
});

test("PostgreSQL import bundle verifier reports missing manifest", () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-import-bundle-"));
  const result = verifyPostgresImportBundle(outputDir);

  assert.equal(result.valid, false);
  assert.match(result.errors[0], /manifest file is missing/);
  fs.rmSync(outputDir, { recursive: true, force: true });
});

test("PostgreSQL import bundle verifier reports unsafe seed files", () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-import-bundle-"));
  const rowsPath = path.join(outputDir, "postgres-rows.json");
  const seedPath = path.join(outputDir, "postgres-seed.sql");
  const reportPath = path.join(outputDir, "postgres-export-report.json");
  const manifestPath = path.join(outputDir, "postgres-import-manifest.json");
  const schemaPath = path.join(outputDir, "database.sql");
  const manifest = buildPostgresImportManifest({
    outputDir,
    schemaPath,
    rowsPath,
    seedPath,
    reportPath,
    report: { valid: true, errors: [], counts: {} },
  });

  fs.writeFileSync(schemaPath, "create table projects (id text primary key);\n");
  fs.writeFileSync(rowsPath, "{}\n");
  fs.writeFileSync(seedPath, "select 1;\n");
  fs.writeFileSync(reportPath, '{"valid":true,"errors":[]}\n');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const result = verifyPostgresImportBundle(outputDir);

  assert.equal(result.valid, false);
  assert.equal(result.errors.includes("seed SQL must include BEGIN and COMMIT"), true);
  assert.equal(result.errors.includes("seed SQL must include idempotent upserts"), true);
  fs.rmSync(outputDir, { recursive: true, force: true });
});
