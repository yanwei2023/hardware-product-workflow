import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildPostgresImportResultReport,
  verifyPostgresImportResultReport,
  writePostgresImportResultReport,
} from "./postgresImportReport.mjs";

function successfulResult(outputDir) {
  const counts = { projects: 1, agent_jobs: 2 };
  return {
    ready: true,
    confirmed: true,
    executed: true,
    ok: true,
    failedStage: null,
    blockers: [],
    preflight: {
      checks: {
        databaseUrl: { configured: true, value: "postgres://user:***@localhost/hardware_flow" },
        importBundle: {
          outputDir,
          manifestPath: path.join(outputDir, "postgres-import-manifest.json"),
          valid: true,
          counts,
          files: { schema: "schemas/database.sql", seed: path.join(outputDir, "postgres-seed.sql") },
        },
      },
    },
    executions: [
      { stage: "schema", filePath: "schemas/database.sql", ok: true, status: 0, stdout: "schema details" },
      { stage: "seed", filePath: path.join(outputDir, "postgres-seed.sql"), ok: true, status: 0 },
      { stage: "verification", filePath: null, ok: true, status: 0 },
    ],
    verification: {
      ok: true,
      expectedCounts: counts,
      actualCounts: { ...counts },
      discrepancies: [],
      error: null,
    },
  };
}

test("PostgreSQL import result report stores compact redacted execution evidence", () => {
  const outputDir = "/tmp/hardware-flow-report";
  const report = buildPostgresImportResultReport(successfulResult(outputDir), {
    outputDir,
    reportPath: path.join(outputDir, "result.json"),
    generatedAt: new Date("2026-06-12T08:00:00.000Z"),
  });

  assert.equal(report.generatedAt, "2026-06-12T08:00:00.000Z");
  assert.equal(report.outcome.ok, true);
  assert.equal(report.database.value, "postgres://user:***@localhost/hardware_flow");
  assert.equal("stdout" in report.executions[0], false);
  assert.deepEqual(report.verification.actualCounts, { projects: 1, agent_jobs: 2 });
});

test("PostgreSQL import result verifier accepts successful count-verified reports", () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-import-result-"));
  fs.writeFileSync(
    path.join(outputDir, "postgres-import-manifest.json"),
    `${JSON.stringify({ outputDir, counts: { projects: 1, agent_jobs: 2 } }, null, 2)}\n`,
  );
  const report = writePostgresImportResultReport(successfulResult(outputDir), {
    outputDir,
    generatedAt: new Date("2026-06-12T08:00:00.000Z"),
  });

  const verification = verifyPostgresImportResultReport(report.reportPath);

  assert.equal(verification.valid, true);
  assert.deepEqual(verification.errors, []);
  assert.equal(verification.outcome.ok, true);
  fs.rmSync(outputDir, { recursive: true, force: true });
});

test("PostgreSQL import result verifier rejects failed and unredacted reports", () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-import-result-"));
  fs.writeFileSync(
    path.join(outputDir, "postgres-import-manifest.json"),
    `${JSON.stringify({ outputDir, counts: { projects: 1, agent_jobs: 2 } }, null, 2)}\n`,
  );
  const reportPath = path.join(outputDir, "postgres-import-result.json");
  const report = buildPostgresImportResultReport(successfulResult(outputDir), { outputDir, reportPath });
  report.database.value = "postgres://user:secret@localhost/hardware_flow";
  report.outcome.ok = false;
  report.outcome.failedStage = "verification";
  report.verification.ok = false;
  report.verification.discrepancies = [{ table: "projects", expected: 1, actual: 0 }];
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  const verification = verifyPostgresImportResultReport(reportPath);

  assert.equal(verification.valid, false);
  assert.equal(verification.errors.includes("database connection password is not redacted"), true);
  assert.equal(verification.errors.includes("import outcome is not successful: verification"), true);
  assert.equal(verification.errors.includes("row count verification contains discrepancies"), true);
  fs.rmSync(outputDir, { recursive: true, force: true });
});

test("PostgreSQL import result verifier recomputes counts and bundle execution paths", () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-import-result-"));
  const reportPath = path.join(outputDir, "postgres-import-result.json");
  fs.writeFileSync(
    path.join(outputDir, "postgres-import-manifest.json"),
    `${JSON.stringify({ outputDir, counts: { projects: 1, agent_jobs: 2 } }, null, 2)}\n`,
  );
  const report = buildPostgresImportResultReport(successfulResult(outputDir), { outputDir, reportPath });
  report.executions.find((item) => item.stage === "seed").filePath = "/tmp/tampered-seed.sql";
  report.verification.actualCounts.projects = 99;
  report.verification.ok = true;
  report.verification.discrepancies = [];
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  const verification = verifyPostgresImportResultReport(reportPath);

  assert.equal(verification.valid, false);
  assert.equal(verification.errors.includes("seed execution file does not match the import bundle"), true);
  assert.equal(verification.errors.includes("verification actual counts do not match expected counts"), true);
  fs.rmSync(outputDir, { recursive: true, force: true });
});

test("PostgreSQL import result verifier reports missing files", () => {
  const verification = verifyPostgresImportResultReport("/tmp/missing-hardware-flow-import-result.json");

  assert.equal(verification.valid, false);
  assert.match(verification.errors[0], /report is missing/);
});

test("PostgreSQL import CLI writes an audit report when preflight is blocked", () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-import-cli-report-"));
  const result = spawnSync(process.execPath, ["apps/api/src/postgresImportCli.mjs", outputDir, "--confirm"], {
    cwd: path.resolve("."),
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: "" },
  });
  const reportPath = path.join(outputDir, "postgres-import-result.json");

  assert.equal(result.status, 1);
  assert.equal(fs.existsSync(reportPath), true);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.equal(report.outcome.ok, false);
  assert.equal(report.outcome.executed, false);
  assert.equal(report.outcome.blockers.some((item) => item.includes("DATABASE_URL")), true);
  fs.rmSync(outputDir, { recursive: true, force: true });
});
