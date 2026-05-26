import assert from "node:assert/strict";
import test from "node:test";
import {
  checkPostgresRowCoverage,
  parsePostgresSchemaColumns,
  parsePostgresSchemaTables,
  validatePostgresRowCoverage,
  validatePostgresRowReferences,
  validatePostgresRequiredValues,
} from "./postgresSchemaCheck.mjs";
import { createDemoStore } from "./server.mjs";
import { mapStoreToPostgresRows } from "./postgresMapper.mjs";
import { postgresTableNames } from "./postgresMapper.mjs";

test("schema parser reads PostgreSQL tables and columns", () => {
  const tables = parsePostgresSchemaTables(`
create table projects (
  id text primary key,
  name text not null,
  payload jsonb not null default '{}'::jsonb
);

create table audit_events (
  id text primary key,
  project_id text references projects(id)
);
`);

  assert.deepEqual(tables.projects, ["id", "name", "payload"]);
  assert.deepEqual(tables.audit_events, ["id", "project_id"]);
});

test("schema parser marks not-null and primary-key columns as required", () => {
  const columns = parsePostgresSchemaColumns(`
create table projects (
  id text primary key,
  name text not null,
  product_line text
);
`);

  assert.deepEqual(columns.projects, [
    { name: "id", notNull: true },
    { name: "name", notNull: true },
    { name: "product_line", notNull: false },
  ]);
});

test("schema coverage check accepts the current mapper", () => {
  const sql = `
create table projects (
  id text primary key,
  name text not null,
  product_line text,
  owner_user_id text not null,
  current_phase_id text,
  status text not null,
  archived_at timestamptz,
  archived_by_user_id text,
  cloned_from_project_id text,
  source_exported_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
);
`;
  const errors = validatePostgresRowCoverage(parsePostgresSchemaTables(sql), {
    projects: [
      {
        id: "project-1",
        name: "Project",
        product_line: null,
        owner_user_id: "user-project-manager",
        current_phase_id: null,
        status: "IN_PROGRESS",
        archived_at: null,
        archived_by_user_id: null,
        cloned_from_project_id: null,
        source_exported_at: null,
        created_at: null,
        updated_at: null,
      },
    ],
  });

  assert.deepEqual(errors, []);
});

test("schema coverage check reports missing columns", () => {
  const errors = validatePostgresRowCoverage(
    { projects: ["id", "name", "status"] },
    { projects: [{ id: "project-1", name: "Project" }] },
  );

  assert.deepEqual(errors, ["mapper missing column projects.status"]);
});

test("schema required value check reports null required values", () => {
  const errors = validatePostgresRequiredValues(
    {
      gate_requirements: [
        { name: "id", notNull: true },
        { name: "work_package_id", notNull: true },
      ],
    },
    {
      gate_requirements: [{ id: "req-1", work_package_id: null }],
    },
  );

  assert.deepEqual(errors, ["gate_requirements[0].work_package_id is required by schema"]);
});

test("row reference check accepts the current PostgreSQL mapper output", () => {
  const rows = mapStoreToPostgresRows(createDemoStore());

  assert.deepEqual(validatePostgresRowReferences(rows), []);
});

test("row reference check reports missing foreign-key targets", () => {
  const errors = validatePostgresRowReferences({
    projects: [{ id: "project-1" }],
    phases: [],
    gates: [{ id: "gate-1", project_id: "project-1", phase_id: "missing-phase" }],
  });

  assert.deepEqual(errors, ["gates[0].phase_id references missing phases.id missing-phase"]);
});

test("current database schema is covered by PostgreSQL row mapper", async () => {
  const sql = await import("node:fs").then((fs) => fs.readFileSync("schemas/database.sql", "utf8"));
  const emptyRows = Object.fromEntries(postgresTableNames.map((table) => [table, []]));
  assert.deepEqual(validatePostgresRowCoverage(parsePostgresSchemaTables(sql), emptyRows), []);
});
