import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildPostgresImportManifest } from "./postgresImportBundle.mjs";
import { executePostgresImport } from "./postgresImporter.mjs";

function makeBundle() {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-import-execute-"));
  const files = {
    schema: path.join(outputDir, "database.sql"),
    rows: path.join(outputDir, "postgres-rows.json"),
    seed: path.join(outputDir, "postgres-seed.sql"),
    report: path.join(outputDir, "postgres-export-report.json"),
  };
  const manifest = buildPostgresImportManifest({
    outputDir,
    schemaPath: files.schema,
    rowsPath: files.rows,
    seedPath: files.seed,
    reportPath: files.report,
    report: { valid: true, errors: [], counts: { projects: 1 } },
  });

  fs.writeFileSync(files.schema, "create table projects (id text primary key);\n");
  fs.writeFileSync(files.rows, '{"projects":[]}\n');
  fs.writeFileSync(files.seed, "BEGIN;\nINSERT INTO projects (id) VALUES ('project-1')\nON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id;\nCOMMIT;\n");
  fs.writeFileSync(files.report, '{"valid":true,"errors":[],"counts":{"projects":1}}\n');
  fs.writeFileSync(path.join(outputDir, "postgres-import-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { outputDir, files };
}

const availablePsql = { available: true, version: "psql (PostgreSQL) 16.0", error: null };

test("PostgreSQL importer previews a valid import without executing psql", () => {
  const { outputDir, files } = makeBundle();
  let callCount = 0;
  const result = executePostgresImport({
    databaseUrl: "postgres://user:secret@localhost/hardware_flow",
    outputDir,
    psql: availablePsql,
    runner: () => {
      callCount += 1;
      return { status: 0 };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.executed, false);
  assert.equal(callCount, 0);
  assert.deepEqual(result.plan, [
    { stage: "schema", filePath: files.schema },
    { stage: "seed", filePath: files.seed },
  ]);
  assert.equal(result.preflight.checks.databaseUrl.value.includes("secret"), false);
  fs.rmSync(outputDir, { recursive: true, force: true });
});

test("PostgreSQL importer executes schema and seed after confirmation", () => {
  const { outputDir, files } = makeBundle();
  const calls = [];
  const result = executePostgresImport({
    databaseUrl: "postgres://localhost/hardware_flow",
    outputDir,
    confirm: true,
    psql: availablePsql,
    runner: (databaseUrl, filePath) => {
      calls.push({ databaseUrl, filePath });
      return { status: 0, stdout: `${path.basename(filePath)} ok\n`, stderr: "" };
    },
    queryRunner: () => ({ status: 0, stdout: '{"projects":1}\n', stderr: "" }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.executed, true);
  assert.deepEqual(calls.map((item) => item.filePath), [files.schema, files.seed]);
  assert.deepEqual(result.executions.map((item) => item.stage), ["schema", "seed", "verification"]);
  assert.deepEqual(result.verification.actualCounts, { projects: 1 });
  fs.rmSync(outputDir, { recursive: true, force: true });
});

test("PostgreSQL importer fails when imported row counts do not match the manifest", () => {
  const { outputDir } = makeBundle();
  const result = executePostgresImport({
    databaseUrl: "postgres://localhost/hardware_flow",
    outputDir,
    confirm: true,
    psql: availablePsql,
    runner: () => ({ status: 0, stdout: "ok\n", stderr: "" }),
    queryRunner: () => ({ status: 0, stdout: '{"projects":2}\n', stderr: "" }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedStage, "verification");
  assert.deepEqual(result.verification.discrepancies, [{ table: "projects", expected: 1, actual: 2 }]);
  fs.rmSync(outputDir, { recursive: true, force: true });
});

test("PostgreSQL importer stops when schema execution fails", () => {
  const { outputDir } = makeBundle();
  let callCount = 0;
  const result = executePostgresImport({
    databaseUrl: "postgres://localhost/hardware_flow",
    outputDir,
    confirm: true,
    psql: availablePsql,
    runner: () => {
      callCount += 1;
      return { status: 1, stdout: "", stderr: "schema failed" };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedStage, "schema");
  assert.equal(callCount, 1);
  assert.equal(result.executions[0].stderr, "schema failed");
  fs.rmSync(outputDir, { recursive: true, force: true });
});

test("PostgreSQL importer redacts connection secrets from psql output", () => {
  const { outputDir } = makeBundle();
  const databaseUrl = "postgres://user:secret@localhost/hardware_flow";
  const result = executePostgresImport({
    databaseUrl,
    outputDir,
    confirm: true,
    psql: availablePsql,
    runner: () => ({
      status: 1,
      stderr: `connection failed for ${databaseUrl}: password secret rejected`,
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.executions[0].stderr.includes(databaseUrl), false);
  assert.equal(result.executions[0].stderr.includes("secret"), false);
  assert.match(result.executions[0].stderr, /REDACTED_DATABASE_URL/);
  fs.rmSync(outputDir, { recursive: true, force: true });
});

test("PostgreSQL importer refuses execution when preflight is blocked", () => {
  const result = executePostgresImport({
    databaseUrl: "",
    outputDir: "/tmp/missing-hardware-flow-import-execute",
    confirm: true,
    psql: { available: false, version: null, error: "missing" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.executed, false);
  assert.equal(result.blockers.includes("DATABASE_URL is not configured"), true);
});
