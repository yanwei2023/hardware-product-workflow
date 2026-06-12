import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDemoStore } from "./server.mjs";
import { exportPostgresDatabaseRows } from "./postgresDatabaseExport.mjs";
import { buildPostgresRowsQuery, readPostgresDatabaseRows } from "./postgresDatabaseReader.mjs";
import { mapStoreToPostgresRows, postgresTableNames } from "./postgresMapper.mjs";
import { pullStoreFromPostgres } from "./postgresStorePull.mjs";
import { validateStoreFile } from "./storeDoctor.mjs";

const databaseUrl = "postgresql://workflow:secret-value@localhost:5432/workflow";

function makeRows() {
  return mapStoreToPostgresRows(createDemoStore());
}

function successfulRunner(rows = makeRows()) {
  return (_url, _query) => ({ status: 0, signal: null, stdout: `${JSON.stringify(rows)}\n`, stderr: "" });
}

test("PostgreSQL live reader builds a deterministic query for every mapped table", () => {
  const query = buildPostgresRowsQuery();

  for (const table of postgresTableNames) {
    assert.match(query, new RegExp(`'${table}'`));
    assert.match(query, new RegExp(`FROM ${table} source_row`));
  }
  assert.match(query, /ORDER BY source_row\.id/);
});

test("PostgreSQL live reader rejects invalid table identifiers", () => {
  assert.throws(() => buildPostgresRowsQuery(["projects; DROP TABLE projects"]), /invalid table name/);
});

test("PostgreSQL live reader parses and validates exported rows", () => {
  let receivedUrl = null;
  let receivedQuery = null;
  const result = readPostgresDatabaseRows({
    databaseUrl,
    runner(url, query) {
      receivedUrl = url;
      receivedQuery = query;
      return successfulRunner()(url, query);
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.counts.projects, 1);
  assert.equal(result.rows.projects[0].id, "project-smart-controller");
  assert.equal(result.execution.stdout, "");
  assert.equal(receivedUrl, databaseUrl);
  assert.match(receivedQuery, /json_build_object/);
});

test("PostgreSQL live reader requires a database URL", () => {
  const result = readPostgresDatabaseRows({ databaseUrl: "" });

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, ["DATABASE_URL is required to read PostgreSQL rows"]);
});

test("PostgreSQL live reader redacts connection details from failures", () => {
  const result = readPostgresDatabaseRows({
    databaseUrl,
    runner: () => ({
      status: 2,
      signal: null,
      stdout: "",
      stderr: `could not connect to ${databaseUrl} using secret-value`,
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes(databaseUrl), false);
  assert.equal(JSON.stringify(result).includes("secret-value"), false);
  assert.match(result.errors[0], /REDACTED_DATABASE_URL/);
});

test("PostgreSQL live reader rejects malformed JSON output", () => {
  const result = readPostgresDatabaseRows({
    databaseUrl,
    runner: () => ({ status: 0, signal: null, stdout: "not-json\n", stderr: "" }),
  });

  assert.equal(result.ok, false);
  assert.match(result.errors[0], /unable to parse PostgreSQL rows/);
});

test("PostgreSQL live reader rejects missing tables", () => {
  const rows = makeRows();
  delete rows.agent_jobs;
  const result = readPostgresDatabaseRows({ databaseUrl, runner: successfulRunner(rows) });

  assert.equal(result.ok, false);
  assert.equal(result.errors.includes("PostgreSQL export is missing table agent_jobs"), true);
});

test("PostgreSQL store pull previews without writing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-live-pull-"));
  const outputPath = path.join(dir, "store.json");
  const result = pullStoreFromPostgres({ databaseUrl, outputPath, runner: successfulRunner() });

  assert.equal(result.ok, true);
  assert.equal(result.written, false);
  assert.equal(result.activeProjectId, "project-smart-controller");
  assert.equal(fs.existsSync(outputPath), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("PostgreSQL live export writes validated rows for audit and recovery", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-live-export-"));
  const outputPath = path.join(dir, "postgres-live-rows.json");
  const result = exportPostgresDatabaseRows({ databaseUrl, outputPath, runner: successfulRunner() });

  assert.equal(result.ok, true);
  assert.equal(result.written, true);
  assert.equal(result.counts.projects, 1);
  assert.equal(JSON.parse(fs.readFileSync(outputPath, "utf8")).projects[0].id, "project-smart-controller");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("PostgreSQL live export does not write invalid rows", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-live-export-"));
  const outputPath = path.join(dir, "postgres-live-rows.json");
  const rows = makeRows();
  delete rows.projects;
  const result = exportPostgresDatabaseRows({ databaseUrl, outputPath, runner: successfulRunner(rows) });

  assert.equal(result.ok, false);
  assert.equal(result.written, false);
  assert.equal(fs.existsSync(outputPath), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("PostgreSQL store pull writes a validated store and preserves a backup", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-live-pull-"));
  const outputPath = path.join(dir, "store.json");
  fs.writeFileSync(outputPath, '{"previous":true}\n');

  const result = pullStoreFromPostgres({
    databaseUrl,
    outputPath,
    confirm: true,
    runner: successfulRunner(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.written, true);
  assert.equal(validateStoreFile(outputPath).valid, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(`${outputPath}.bak`, "utf8")), { previous: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("PostgreSQL store pull rejects invalid runtime references before writing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-live-pull-"));
  const outputPath = path.join(dir, "store.json");
  const rows = makeRows();
  rows.work_packages[0].phase_id = "missing-phase";

  const result = pullStoreFromPostgres({
    databaseUrl,
    outputPath,
    confirm: true,
    runner: successfulRunner(rows),
  });

  assert.equal(result.ok, false);
  assert.equal(result.written, false);
  assert.equal(fs.existsSync(outputPath), false);
  assert.equal(result.errors.some((error) => error.includes("phase_id")), true);
  fs.rmSync(dir, { recursive: true, force: true });
});
