import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildPostgresImportManifest } from "./postgresImportBundle.mjs";
import { checkPostgresPreflight } from "./postgresPreflight.mjs";

function makeBundle() {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-preflight-"));
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
    report: { valid: true, errors: [], counts: { projects: 1 } },
  });

  fs.writeFileSync(schemaPath, "create table projects (id text primary key);\n");
  fs.writeFileSync(rowsPath, '{"projects":[]}\n');
  fs.writeFileSync(seedPath, "BEGIN;\nINSERT INTO projects (id) VALUES ('project-1')\nON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id;\nCOMMIT;\n");
  fs.writeFileSync(reportPath, '{"valid":true,"errors":[],"counts":{"projects":1}}\n');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return outputDir;
}

test("PostgreSQL preflight reports ready when URL, psql, and bundle are available", () => {
  const outputDir = makeBundle();
  const result = checkPostgresPreflight({
    databaseUrl: "postgres://user:secret@localhost:5432/hardware_flow",
    outputDir,
    psql: { available: true, version: "psql (PostgreSQL) 16.0", error: null },
  });

  assert.equal(result.ready, true);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.checks.databaseUrl.value, "postgres://user:***@localhost:5432/hardware_flow");
  assert.equal(result.nextSteps[0], `psql "$DATABASE_URL" -f ${path.join(outputDir, "database.sql")}`);
  fs.rmSync(outputDir, { recursive: true, force: true });
});

test("PostgreSQL preflight reports blockers without throwing", () => {
  const result = checkPostgresPreflight({
    databaseUrl: "",
    outputDir: "/tmp/missing-hardware-flow-import",
    psql: { available: false, version: null, error: "spawn psql ENOENT" },
  });

  assert.equal(result.ready, false);
  assert.equal(result.blockers.includes("DATABASE_URL is not configured"), true);
  assert.equal(result.blockers.some((blocker) => blocker.includes("psql is not available")), true);
  assert.equal(result.blockers.some((blocker) => blocker.includes("manifest file is missing")), true);
});
