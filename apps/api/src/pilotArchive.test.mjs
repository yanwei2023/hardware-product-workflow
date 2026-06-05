import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const tempStoreDir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-pilot-store-"));
process.env.HARDWARE_FLOW_STORE_PATH = path.join(tempStoreDir, "store.json");
process.env.HARDWARE_FLOW_ACCESS_LOG = "0";

const { preparePilotArchive } = await import("./pilotArchive.mjs");

test("pilot archive writes review, risk, runtime, and import artifacts", () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-pilot-archive-"));

  const result = preparePilotArchive(outputDir);
  const manifestPath = path.join(outputDir, "pilot-archive-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  assert.equal(result.outputDir, outputDir);
  assert.equal(result.manifestPath, manifestPath);
  assert.equal(typeof manifest.project.id, "string");
  assert.equal(manifest.project.id.length > 0, true);
  assert.equal(manifest.readiness.storageValid, true);
  assert.equal(manifest.readiness.postgresImportValid, true);
  assert.equal(manifest.readiness.checklistRequiredTotal > 0, true);
  assert.equal(manifest.files.handoffMarkdown, "pilot-handoff.md");
  assert.equal(manifest.files.snapshotJson, "project-snapshot.json");
  assert.equal(manifest.files.riskRegisterMarkdown, "risk-register.md");
  assert.equal(manifest.files.gateReviewPackMarkdown, "gate-review-pack.md");
  assert.equal(manifest.files.pilotReadinessJson, "pilot-readiness.json");
  assert.equal(manifest.files.pilotChecklistJson, "pilot-checklist.json");
  assert.equal(manifest.files.opsSummaryJson, "ops-summary.json");
  assert.equal(manifest.readiness.opsSummaryReady, true);
  assert.equal(typeof manifest.operations.blockerCount, "number");
  assert.equal(typeof manifest.operations.warningCount, "number");
  assert.equal(typeof manifest.operations.httpServerErrors, "number");
  assert.equal(typeof manifest.operations.httpClientErrors, "number");
  assert.equal(typeof manifest.operations.storageReady, "boolean");
  assert.equal(Array.isArray(manifest.operations.nextActions), true);
  assert.equal(manifest.commands.check, "npm run pilot:check");
  assert.equal(manifest.commands.rehearse, "npm run pilot:rehearse");
  assert.equal(manifest.commands.archive, "npm run pilot:archive -- /tmp/hardware-flow-pilot-archive");
  assert.equal(manifest.dataProtection.storePath, process.env.HARDWARE_FLOW_STORE_PATH);
  assert.ok(manifest.dataProtection.backupPath.endsWith("store.json.bak"));
  assert.equal(manifest.dataProtection.storeDoctorCommand, "npm run store:doctor");
  assert.equal(manifest.dataProtection.restoreBackupCommand, "npm run store:restore-backup");
  assert.equal(Array.isArray(manifest.checklist.requiredPending), true);
  assert.equal(manifest.checklist.requiredPending.some((item) => item.key === "checkpoint"), true);
  assert.equal(manifest.checklist.requiredPending.every((item) => item.title && item.action), true);
  assert.equal(manifest.diagnostics.readiness, "/pilot/readiness");
  assert.equal(manifest.diagnostics.opsSummary, "/ops/summary");
  assert.equal(manifest.diagnostics.metrics, "/metrics");
  assert.equal(manifest.diagnostics.storageStatus, "/storage/status");
  assert.equal(manifest.diagnostics.storageDoctor, "/storage/doctor");
  assert.equal(manifest.postgresImport.manifestPath, "postgres-import/postgres-import-manifest.json");
  assert.equal(manifest.postgresImport.psql.requiredEnv, "DATABASE_URL");
  assert.equal(manifest.postgresImport.psql.createSchema, "psql \"$DATABASE_URL\" -f schemas/database.sql");
  assert.equal(
    manifest.postgresImport.psql.importSeed,
    `psql "$DATABASE_URL" -f ${path.join(outputDir, "postgres-import", "postgres-seed.sql")}`,
  );
  assert.equal(fs.existsSync(path.join(outputDir, manifest.files.snapshotJson)), true);
  assert.equal(fs.existsSync(path.join(outputDir, manifest.files.handoffMarkdown)), true);
  assert.equal(fs.existsSync(path.join(outputDir, manifest.files.gateReviewPackMarkdown)), true);
  assert.equal(fs.existsSync(path.join(outputDir, manifest.files.pilotReadinessJson)), true);
  assert.equal(fs.existsSync(path.join(outputDir, manifest.files.pilotChecklistJson)), true);
  assert.equal(fs.existsSync(path.join(outputDir, manifest.files.opsSummaryJson)), true);
  assert.equal(fs.existsSync(path.join(outputDir, manifest.postgresImport.manifestPath)), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(outputDir, manifest.files.opsSummaryJson), "utf8")).pilot.links.metrics, "/metrics");
  const handoffMarkdown = fs.readFileSync(path.join(outputDir, "pilot-handoff.md"), "utf8");
  assert.match(handoffMarkdown, /内部试点交接页/);
  assert.match(handoffMarkdown, /\/ops\/summary/);
  assert.match(handoffMarkdown, /试点命令/);
  assert.match(handoffMarkdown, /npm run pilot:rehearse/);
  assert.match(handoffMarkdown, /数据保护和回滚/);
  assert.match(handoffMarkdown, /npm run store:doctor/);
  assert.match(handoffMarkdown, /npm run store:restore-backup/);
  assert.match(handoffMarkdown, /PostgreSQL 导入包/);
  assert.match(handoffMarkdown, /未完成必需项/);
  assert.match(handoffMarkdown, /试点前创建数据检查点/);
  assert.match(handoffMarkdown, /下一步：项目 -> 本地数据状态 -> 创建检查点/);
  assert.match(handoffMarkdown, /postgres-import\/postgres-import-manifest\.json/);
  assert.match(handoffMarkdown, /表计数：/);
  assert.match(handoffMarkdown, /一次性命令：`psql "\$DATABASE_URL" -f schemas\/database\.sql && psql "\$DATABASE_URL" -f /);
  assert.match(fs.readFileSync(path.join(outputDir, "project-snapshot.md"), "utf8"), /项目快照/);
  assert.match(fs.readFileSync(path.join(outputDir, "risk-register.md"), "utf8"), /风险台账/);

  fs.rmSync(outputDir, { recursive: true, force: true });
});

test.after(() => {
  fs.rmSync(tempStoreDir, { recursive: true, force: true });
});
