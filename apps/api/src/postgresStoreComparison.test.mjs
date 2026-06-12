import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDemoStore } from "./server.mjs";
import { mapStoreToPostgresRows } from "./postgresMapper.mjs";
import {
  comparePostgresRows,
  compareStoreWithPostgres,
  verifyPostgresStoreComparisonReport,
  writePostgresStoreComparisonReport,
} from "./postgresStoreComparison.mjs";

const databaseUrl = "postgresql://workflow:comparison-secret@localhost:5432/workflow";

function makeRows() {
  return mapStoreToPostgresRows(createDemoStore());
}

function runnerFor(rows) {
  return () => ({ status: 0, signal: null, stdout: `${JSON.stringify(rows)}\n`, stderr: "" });
}

test("PostgreSQL store comparison accepts semantically equal rows", () => {
  const expected = makeRows();
  const actual = JSON.parse(JSON.stringify(expected));
  actual.projects[0] = Object.fromEntries(Object.entries(actual.projects[0]).reverse());
  actual.projects[0].created_at = "1970-01-01 00:00:00+00";

  const result = comparePostgresRows(expected, actual);

  assert.equal(result.inSync, true);
  assert.equal(result.summary.driftedTableCount, 0);
});

test("PostgreSQL store comparison reports missing, extra, and changed rows", () => {
  const expected = makeRows();
  const actual = JSON.parse(JSON.stringify(expected));
  actual.phases.shift();
  actual.projects.push({ ...actual.projects[0], id: "project-database-only" });
  actual.work_packages[0].status = "LOCKED";
  actual.work_packages[0].due_at = "2026-07-01";

  const result = comparePostgresRows(expected, actual);

  assert.equal(result.inSync, false);
  assert.equal(result.summary.driftedTableCount, 3);
  assert.equal(result.summary.missingInDatabaseCount, 1);
  assert.equal(result.summary.missingInStoreCount, 1);
  assert.equal(result.summary.changedRowCount, 1);
  assert.deepEqual(result.tables.phases.missingInDatabase, [expected.phases[0].id]);
  assert.deepEqual(result.tables.projects.missingInStore, ["project-database-only"]);
  assert.deepEqual(result.tables.work_packages.changed[0].fields, ["due_at", "status"]);
});

test("PostgreSQL store comparison reads and compares a live database snapshot", () => {
  const store = createDemoStore();
  const result = compareStoreWithPostgres({
    store,
    databaseUrl,
    runner: runnerFor(mapStoreToPostgresRows(store)),
  });

  assert.equal(result.ok, true);
  assert.equal(result.inSync, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.execution.stdout, "");
});

test("PostgreSQL store comparison distinguishes a valid drift result from execution failure", () => {
  const store = createDemoStore();
  const rows = mapStoreToPostgresRows(store);
  rows.notifications.push({
    id: "notification-database-only",
    project_id: store.activeProjectId,
    user_id: "user-project-manager",
    title: "database only",
    message: "",
    type: "INFO",
    status: "UNREAD",
    object_type: null,
    object_id: null,
    created_at: "2026-06-12T00:00:00.000Z",
    read_at: null,
  });

  const result = compareStoreWithPostgres({ store, databaseUrl, runner: runnerFor(rows) });

  assert.equal(result.ok, true);
  assert.equal(result.inSync, false);
  assert.deepEqual(result.comparison.tables.notifications.missingInStore, ["notification-database-only"]);
});

test("PostgreSQL store comparison propagates redacted database failures", () => {
  const result = compareStoreWithPostgres({
    store: createDemoStore(),
    databaseUrl,
    runner: () => ({
      status: 2,
      signal: null,
      stdout: "",
      stderr: `connection failed for ${databaseUrl} comparison-secret`,
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.inSync, false);
  assert.equal(JSON.stringify(result).includes("comparison-secret"), false);
});

test("PostgreSQL store comparison report is compact, persistent, and secret-free", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-comparison-"));
  const reportPath = path.join(dir, "comparison.json");
  const result = compareStoreWithPostgres({
    store: createDemoStore(),
    databaseUrl,
    runner: runnerFor(makeRows()),
  });
  const report = writePostgresStoreComparisonReport(result, {
    reportPath,
    sourceStorePath: path.join(dir, "store.json"),
    generatedAt: new Date("2026-06-12T08:00:00.000Z"),
  });

  assert.equal(report.inSync, true);
  assert.equal(report.generatedAt, "2026-06-12T08:00:00.000Z");
  assert.equal(fs.existsSync(reportPath), true);
  assert.equal(JSON.stringify(report).includes(databaseUrl), false);
  assert.equal(JSON.stringify(report).includes("comparison-secret"), false);
  assert.equal(verifyPostgresStoreComparisonReport(reportPath).valid, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("PostgreSQL store comparison verifier rejects drift and tampered summaries", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-comparison-"));
  const reportPath = path.join(dir, "comparison.json");
  const rows = makeRows();
  rows.work_packages[0].status = "LOCKED";
  const result = compareStoreWithPostgres({
    store: createDemoStore(),
    databaseUrl,
    runner: runnerFor(rows),
  });
  writePostgresStoreComparisonReport(result, { reportPath });

  const driftVerification = verifyPostgresStoreComparisonReport(reportPath);
  assert.equal(driftVerification.valid, false);
  assert.equal(driftVerification.errors.includes("store and PostgreSQL are not in sync"), true);

  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  report.inSync = true;
  report.comparison.inSync = true;
  report.comparison.tables.work_packages.inSync = true;
  report.comparison.summary.changedRowCount = 0;
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const tamperedVerification = verifyPostgresStoreComparisonReport(reportPath);
  assert.equal(tamperedVerification.valid, false);
  assert.equal(tamperedVerification.errors.includes("comparison summary changedRowCount does not match table details"), true);
  assert.equal(
    tamperedVerification.errors.includes("comparison table work_packages inSync does not match its details"),
    true,
  );
  fs.rmSync(dir, { recursive: true, force: true });
});
