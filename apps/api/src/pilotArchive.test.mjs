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
  assert.equal(manifest.diagnostics.readiness, "/pilot/readiness");
  assert.equal(manifest.diagnostics.opsSummary, "/ops/summary");
  assert.equal(manifest.diagnostics.metrics, "/metrics");
  assert.equal(manifest.diagnostics.storageStatus, "/storage/status");
  assert.equal(manifest.diagnostics.storageDoctor, "/storage/doctor");
  assert.equal(manifest.postgresImport.manifestPath, "postgres-import/postgres-import-manifest.json");
  assert.equal(fs.existsSync(path.join(outputDir, manifest.files.snapshotJson)), true);
  assert.equal(fs.existsSync(path.join(outputDir, manifest.files.handoffMarkdown)), true);
  assert.equal(fs.existsSync(path.join(outputDir, manifest.files.gateReviewPackMarkdown)), true);
  assert.equal(fs.existsSync(path.join(outputDir, manifest.files.pilotReadinessJson)), true);
  assert.equal(fs.existsSync(path.join(outputDir, manifest.files.pilotChecklistJson)), true);
  assert.equal(fs.existsSync(path.join(outputDir, manifest.files.opsSummaryJson)), true);
  assert.equal(fs.existsSync(path.join(outputDir, manifest.postgresImport.manifestPath)), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(outputDir, manifest.files.opsSummaryJson), "utf8")).pilot.links.metrics, "/metrics");
  assert.match(fs.readFileSync(path.join(outputDir, "pilot-handoff.md"), "utf8"), /内部试点交接页/);
  assert.match(fs.readFileSync(path.join(outputDir, "pilot-handoff.md"), "utf8"), /\/ops\/summary/);
  assert.match(fs.readFileSync(path.join(outputDir, "project-snapshot.md"), "utf8"), /项目快照/);
  assert.match(fs.readFileSync(path.join(outputDir, "risk-register.md"), "utf8"), /风险台账/);

  fs.rmSync(outputDir, { recursive: true, force: true });
});

test.after(() => {
  fs.rmSync(tempStoreDir, { recursive: true, force: true });
});
