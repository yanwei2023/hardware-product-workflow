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
  assert.equal(manifest.files.snapshotJson, "project-snapshot.json");
  assert.equal(manifest.files.riskRegisterMarkdown, "risk-register.md");
  assert.equal(manifest.files.gateReviewPackMarkdown, "gate-review-pack.md");
  assert.equal(manifest.postgresImport.manifestPath, "postgres-import/postgres-import-manifest.json");
  assert.equal(fs.existsSync(path.join(outputDir, manifest.files.snapshotJson)), true);
  assert.equal(fs.existsSync(path.join(outputDir, manifest.files.gateReviewPackMarkdown)), true);
  assert.equal(fs.existsSync(path.join(outputDir, manifest.postgresImport.manifestPath)), true);
  assert.match(fs.readFileSync(path.join(outputDir, "project-snapshot.md"), "utf8"), /项目快照/);
  assert.match(fs.readFileSync(path.join(outputDir, "risk-register.md"), "utf8"), /风险台账/);

  fs.rmSync(outputDir, { recursive: true, force: true });
});

test.after(() => {
  fs.rmSync(tempStoreDir, { recursive: true, force: true });
});
