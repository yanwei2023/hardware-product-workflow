import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDemoStore } from "./server.mjs";
import { mapStoreToPostgresRows, renderPostgresMirrorSql } from "./postgresMapper.mjs";
import {
  synchronizeStoreToPostgres,
  verifyPostgresStoreSyncReport,
  writePostgresStoreSyncReport,
} from "./postgresStoreSync.mjs";

const databaseUrl = "postgresql://workflow:sync-secret@localhost:5432/workflow";

function queryRunnerFor(rows) {
  return () => ({ status: 0, signal: null, stdout: `${JSON.stringify(rows)}\n`, stderr: "" });
}

test("PostgreSQL mirror SQL upserts parent-first and prunes child-first in one transaction", () => {
  const rows = mapStoreToPostgresRows(createDemoStore());
  const sql = renderPostgresMirrorSql(rows);

  assert.match(sql, /^-- Generated exact-mirror synchronization/m);
  assert.match(sql, /BEGIN;[\s\S]*pg_advisory_xact_lock[\s\S]*COMMIT;/);
  assert.equal(sql.indexOf("INSERT INTO projects") < sql.indexOf("INSERT INTO phases"), true);
  assert.equal(sql.indexOf("DELETE FROM audit_events") < sql.indexOf("DELETE FROM projects"), true);
  assert.match(sql, /DELETE FROM projects WHERE id NOT IN \('project-smart-controller'\);/);
});

test("PostgreSQL mirror SQL clears tables that are empty in the store", () => {
  const rows = mapStoreToPostgresRows(createDemoStore());
  assert.equal(rows.agent_findings.length, 0);

  const sql = renderPostgresMirrorSql(rows);

  assert.match(sql, /-- agent_findings: 0 rows/);
  assert.match(sql, /DELETE FROM agent_findings;/);
});

test("PostgreSQL store synchronization previews an auditable exact-mirror plan", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-sync-"));
  let executionCount = 0;
  const result = synchronizeStoreToPostgres({
    store: createDemoStore(),
    outputDir: dir,
    runner: () => {
      executionCount += 1;
      return { status: 0 };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.executed, false);
  assert.equal(result.plan.mode, "EXACT_MIRROR");
  assert.equal(result.plan.pruneDatabaseOnlyRows, true);
  assert.equal(result.plan.tableCount, 16);
  assert.equal(executionCount, 0);
  assert.equal(fs.existsSync(result.sqlPath), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("PostgreSQL store synchronization confirms execution and verifies all rows", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-sync-"));
  const store = createDemoStore();
  const rows = mapStoreToPostgresRows(store);
  const calls = [];
  const result = synchronizeStoreToPostgres({
    store,
    databaseUrl,
    outputDir: dir,
    confirm: true,
    runner(url, filePath) {
      calls.push({ url, filePath });
      return { status: 0, signal: null, stdout: "BEGIN\nCOMMIT\n", stderr: "" };
    },
    queryRunner: queryRunnerFor(rows),
  });

  assert.equal(result.ok, true);
  assert.equal(result.executed, true);
  assert.equal(result.verification.ok, true);
  assert.equal(result.verification.comparison.summary.driftedTableCount, 0);
  assert.deepEqual(calls, [{ url: databaseUrl, filePath: path.join(dir, "postgres-store-sync.sql") }]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("PostgreSQL store synchronization rejects invalid stores before writing SQL", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-sync-"));
  const store = createDemoStore();
  store.projects.push({ ...store.projects[0] });
  const result = synchronizeStoreToPostgres({ store, outputDir: dir });

  assert.equal(result.ok, false);
  assert.equal(result.ready, false);
  assert.equal(result.errors.some((error) => error.includes("duplicate id")), true);
  assert.equal(fs.existsSync(result.sqlPath), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("PostgreSQL store synchronization requires DATABASE_URL only for confirmed execution", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-sync-"));
  const result = synchronizeStoreToPostgres({
    store: createDemoStore(),
    databaseUrl: "",
    outputDir: dir,
    confirm: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.executed, false);
  assert.deepEqual(result.errors, ["DATABASE_URL is required to synchronize the store"]);
  assert.equal(fs.existsSync(result.sqlPath), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("PostgreSQL store synchronization redacts execution failures", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-sync-"));
  const result = synchronizeStoreToPostgres({
    store: createDemoStore(),
    databaseUrl,
    outputDir: dir,
    confirm: true,
    runner: () => ({
      status: 2,
      signal: null,
      stdout: "",
      stderr: `failed ${databaseUrl} sync-secret`,
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.executed, true);
  assert.equal(JSON.stringify(result).includes(databaseUrl), false);
  assert.equal(JSON.stringify(result).includes("sync-secret"), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("PostgreSQL store synchronization fails when post-write verification drifts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-sync-"));
  const store = createDemoStore();
  const rows = mapStoreToPostgresRows(store);
  rows.projects[0].status = "DATABASE_CHANGED";
  const result = synchronizeStoreToPostgres({
    store,
    databaseUrl,
    outputDir: dir,
    confirm: true,
    runner: () => ({ status: 0, signal: null, stdout: "COMMIT\n", stderr: "" }),
    queryRunner: queryRunnerFor(rows),
  });

  assert.equal(result.ok, false);
  assert.equal(result.verification.ok, false);
  assert.deepEqual(result.verification.comparison.tables.projects.changed[0].fields, ["status"]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("PostgreSQL store synchronization writes a compact secret-free report", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-sync-"));
  const store = createDemoStore();
  const result = synchronizeStoreToPostgres({
    store,
    databaseUrl,
    outputDir: dir,
    confirm: true,
    runner: () => ({ status: 0, signal: null, stdout: "COMMIT\n", stderr: "" }),
    queryRunner: queryRunnerFor(mapStoreToPostgresRows(store)),
  });
  const report = writePostgresStoreSyncReport(result, {
    reportPath: path.join(dir, "result.json"),
    generatedAt: new Date("2026-06-12T09:00:00.000Z"),
  });

  assert.equal(report.ok, true);
  assert.equal(report.generatedAt, "2026-06-12T09:00:00.000Z");
  assert.equal(JSON.stringify(report).includes(databaseUrl), false);
  assert.equal(JSON.stringify(report).includes("sync-secret"), false);
  assert.equal(fs.existsSync(report.reportPath), true);
  assert.equal(verifyPostgresStoreSyncReport(report.reportPath).valid, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("PostgreSQL store sync verifier rejects previews and tampered SQL", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-sync-"));
  const previewResult = synchronizeStoreToPostgres({ store: createDemoStore(), outputDir: dir });
  const preview = writePostgresStoreSyncReport(previewResult, {
    reportPath: path.join(dir, "preview.json"),
  });

  const previewVerification = verifyPostgresStoreSyncReport(preview.reportPath);
  assert.equal(previewVerification.valid, false);
  assert.equal(
    previewVerification.errors.includes("report does not describe a successful confirmed synchronization"),
    true,
  );

  const store = createDemoStore();
  const result = synchronizeStoreToPostgres({
    store,
    databaseUrl,
    outputDir: dir,
    confirm: true,
    runner: () => ({ status: 0, signal: null, stdout: "COMMIT\n", stderr: "" }),
    queryRunner: queryRunnerFor(mapStoreToPostgresRows(store)),
  });
  const report = writePostgresStoreSyncReport(result, { reportPath: path.join(dir, "result.json") });
  fs.writeFileSync(result.sqlPath, "BEGIN;\nCOMMIT;\n");

  const tamperedVerification = verifyPostgresStoreSyncReport(report.reportPath);
  assert.equal(tamperedVerification.valid, false);
  assert.equal(
    tamperedVerification.errors.includes("synchronization SQL is missing its transaction or advisory lock"),
    true,
  );
  assert.equal(
    tamperedVerification.errors.includes("synchronization SQL is missing exact-mirror cleanup for projects"),
    true,
  );
  fs.rmSync(dir, { recursive: true, force: true });
});
