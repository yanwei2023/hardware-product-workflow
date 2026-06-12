import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDemoStore } from "./server.mjs";
import { mapStoreToPostgresRows } from "./postgresMapper.mjs";
import { restoreStoreFromPostgresRows } from "./postgresStoreRestore.mjs";
import { validateStoreFile } from "./storeDoctor.mjs";

function makeRowsFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-rows-restore-"));
  const rowsPath = path.join(dir, "postgres-rows.json");
  fs.writeFileSync(rowsPath, `${JSON.stringify(mapStoreToPostgresRows(createDemoStore()), null, 2)}\n`);
  return { dir, rowsPath, outputPath: path.join(dir, "restored-store.json") };
}

test("PostgreSQL rows restore previews a valid store without writing", () => {
  const { dir, rowsPath, outputPath } = makeRowsFile();
  const result = restoreStoreFromPostgresRows({ rowsPath, outputPath });

  assert.equal(result.ok, true);
  assert.equal(result.written, false);
  assert.equal(result.activeProjectId, "project-smart-controller");
  assert.equal(result.counts.projects, 1);
  assert.equal(fs.existsSync(outputPath), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("PostgreSQL rows restore writes a doctor-valid store after confirmation", () => {
  const { dir, rowsPath, outputPath } = makeRowsFile();
  const result = restoreStoreFromPostgresRows({ rowsPath, outputPath, confirm: true });

  assert.equal(result.ok, true);
  assert.equal(result.written, true);
  assert.equal(validateStoreFile(outputPath).valid, true);
  assert.equal(JSON.parse(fs.readFileSync(outputPath, "utf8")).activeProjectId, "project-smart-controller");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("PostgreSQL rows restore preserves the previous output as a backup", () => {
  const { dir, rowsPath, outputPath } = makeRowsFile();
  fs.writeFileSync(outputPath, '{"previous":true}\n');

  const result = restoreStoreFromPostgresRows({ rowsPath, outputPath, confirm: true });

  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(`${outputPath}.bak`, "utf8")), { previous: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("PostgreSQL rows restore rejects broken references without writing", () => {
  const { dir, rowsPath, outputPath } = makeRowsFile();
  const rows = JSON.parse(fs.readFileSync(rowsPath, "utf8"));
  rows.work_packages[0].phase_id = "missing-phase";
  fs.writeFileSync(rowsPath, `${JSON.stringify(rows, null, 2)}\n`);

  const result = restoreStoreFromPostgresRows({ rowsPath, outputPath, confirm: true });

  assert.equal(result.ok, false);
  assert.equal(result.written, false);
  assert.equal(result.errors.some((item) => item.includes("workPackage.phaseId")), true);
  assert.equal(fs.existsSync(outputPath), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("PostgreSQL rows restore requires every mapped table array", () => {
  const { dir, rowsPath, outputPath } = makeRowsFile();
  const rows = JSON.parse(fs.readFileSync(rowsPath, "utf8"));
  delete rows.agent_jobs;
  fs.writeFileSync(rowsPath, `${JSON.stringify(rows, null, 2)}\n`);

  const result = restoreStoreFromPostgresRows({ rowsPath, outputPath });

  assert.equal(result.ok, false);
  assert.equal(result.errors.includes("PostgreSQL rows are missing table array: agent_jobs"), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("PostgreSQL rows restore rejects unknown explicit active projects", () => {
  const { dir, rowsPath, outputPath } = makeRowsFile();
  const result = restoreStoreFromPostgresRows({
    rowsPath,
    outputPath,
    activeProjectId: "missing-project",
    confirm: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.errors.includes("requested active project does not exist: missing-project"), true);
  assert.equal(fs.existsSync(outputPath), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("PostgreSQL rows restore rejects broken agent job run references", () => {
  const { dir, rowsPath, outputPath } = makeRowsFile();
  const rows = JSON.parse(fs.readFileSync(rowsPath, "utf8"));
  rows.agent_jobs.push({
    id: "agent-job-broken",
    project_id: "project-smart-controller",
    work_package_id: "wp-evt_exit-evt_test_report",
    agent_key: "test_agent",
    input_refs: [],
    draft_markdown: null,
    requested_by_user_id: "user-project-manager",
    status: "COMPLETED",
    created_at: "2026-06-12T01:00:00.000Z",
    started_at: "2026-06-12T01:01:00.000Z",
    completed_at: "2026-06-12T01:02:00.000Z",
    result_status_code: 200,
    agent_run_id: "missing-run",
    error: "",
  });
  fs.writeFileSync(rowsPath, `${JSON.stringify(rows, null, 2)}\n`);

  const result = restoreStoreFromPostgresRows({ rowsPath, outputPath, confirm: true });

  assert.equal(result.ok, false);
  assert.equal(result.errors.some((item) => item.includes("agentJob.agentRunId")), true);
  assert.equal(fs.existsSync(outputPath), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("PostgreSQL rows restore rejects invalid serialized jsonb values", () => {
  const { dir, rowsPath, outputPath } = makeRowsFile();
  const rows = JSON.parse(fs.readFileSync(rowsPath, "utf8"));
  rows.artifact_versions[0].content_json = "{invalid-json";
  fs.writeFileSync(rowsPath, `${JSON.stringify(rows, null, 2)}\n`);

  const result = restoreStoreFromPostgresRows({ rowsPath, outputPath, confirm: true });

  assert.equal(result.ok, false);
  assert.equal(result.errors.some((item) => item.includes("invalid serialized PostgreSQL JSON value")), true);
  assert.equal(fs.existsSync(outputPath), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("PostgreSQL rows restore CLI honors positional rows and explicit output paths", () => {
  const { dir, rowsPath, outputPath } = makeRowsFile();
  const result = spawnSync(
    process.execPath,
    ["apps/api/src/restoreStoreFromPostgresRows.mjs", rowsPath, "--output", outputPath, "--confirm"],
    { cwd: path.resolve("."), encoding: "utf8" },
  );

  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).written, true);
  assert.equal(validateStoreFile(outputPath).valid, true);
  fs.rmSync(dir, { recursive: true, force: true });
});
