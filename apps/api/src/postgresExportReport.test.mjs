import assert from "node:assert/strict";
import test from "node:test";
import { createDemoStore } from "./server.mjs";
import { mapStoreToPostgresRows } from "./postgresMapper.mjs";
import { assertValidPostgresExport, countPostgresRows, validatePostgresExportRows } from "./postgresExportReport.mjs";

test("PostgreSQL export report accepts the current mapper output", () => {
  const rows = mapStoreToPostgresRows(createDemoStore());
  const report = validatePostgresExportRows(rows);

  assert.equal(report.valid, true);
  assert.deepEqual(report.errors, []);
  assert.equal(report.counts.projects, 1);
  assert.equal(report.counts.gate_requirements, 22);
});

test("PostgreSQL export report counts only array tables", () => {
  assert.deepEqual(countPostgresRows({ projects: [{ id: "project-1" }], phases: null }), {
    projects: 1,
    phases: 0,
  });
});

test("PostgreSQL export report rejects missing tables", () => {
  const report = validatePostgresExportRows({ projects: [] }, "create table projects (id text primary key);\n");

  assert.equal(report.valid, false);
  assert.equal(report.errors.some((error) => error === "PostgreSQL export is missing table phases"), true);
});

test("PostgreSQL export assertion throws with validation details", () => {
  const rows = mapStoreToPostgresRows(createDemoStore());
  rows.gates[0] = { ...rows.gates[0], phase_id: "missing-phase" };

  assert.throws(() => assertValidPostgresExport(rows), /gates\[0\]\.phase_id references missing phases\.id missing-phase/);
});
