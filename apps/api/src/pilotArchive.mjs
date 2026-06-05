import fs from "node:fs";
import path from "node:path";
import { getStorePath, loadStoreFromDisk } from "./persistence.mjs";
import { assertValidPostgresExport } from "./postgresExportReport.mjs";
import { buildPostgresImportManifest, verifyPostgresImportBundle } from "./postgresImportBundle.mjs";
import { mapStoreToPostgresRows, renderPostgresSeedSql } from "./postgresMapper.mjs";
import {
  createDemoStore,
  getDemoProject,
  getGateApprovalPack,
  getGateReviewPack,
  getOpsSummaryStatus,
  getPilotChecklistStatus,
  getPilotReadinessStatus,
  getProjectRiskRegister,
  getProjectSnapshot,
  getRuntimeConfigStatus,
  getStorageDoctorStatus,
  getStorageStatus,
  renderGateReviewPackMarkdown,
  renderProjectSnapshotMarkdown,
  renderRiskRegisterMarkdown,
} from "./server.mjs";

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(filePath, value) {
  fs.writeFileSync(filePath, value.endsWith("\n") ? value : `${value}\n`);
}

function relative(outputDir, filePath) {
  return path.relative(outputDir, filePath);
}

function writePostgresImportBundle(outputDir, store) {
  const postgresDir = path.join(outputDir, "postgres-import");
  const schemaPath = "schemas/database.sql";
  const rowsPath = path.join(postgresDir, "postgres-rows.json");
  const seedPath = path.join(postgresDir, "postgres-seed.sql");
  const reportPath = path.join(postgresDir, "postgres-export-report.json");
  const manifestPath = path.join(postgresDir, "postgres-import-manifest.json");

  fs.mkdirSync(postgresDir, { recursive: true });

  const rows = mapStoreToPostgresRows(store);
  const report = assertValidPostgresExport(rows);
  const manifest = buildPostgresImportManifest({
    outputDir: postgresDir,
    sourceStorePath: getStorePath(),
    schemaPath,
    rowsPath,
    seedPath,
    reportPath,
    report,
  });

  writeJson(rowsPath, rows);
  writeText(seedPath, renderPostgresSeedSql(rows));
  writeJson(reportPath, {
    sourceStorePath: getStorePath(),
    ...report,
  });
  writeJson(manifestPath, manifest);

  return {
    outputDir: postgresDir,
    manifestPath,
    verification: verifyPostgresImportBundle(postgresDir),
  };
}

export function preparePilotArchive(outputDir = "/tmp/hardware-flow-pilot-archive") {
  const resolvedOutputDir = path.resolve(outputDir);
  fs.mkdirSync(resolvedOutputDir, { recursive: true });

  const activeProject = getDemoProject();
  const projectId = activeProject.project.id;
  const currentGateId = activeProject.currentGate?.id || activeProject.gates.find((gate) => gate.phaseId === activeProject.project.currentPhaseId)?.id || null;
  const snapshot = getProjectSnapshot(projectId);
  const riskRegister = getProjectRiskRegister(projectId);
  const reviewPack = currentGateId ? getGateReviewPack(currentGateId) : null;
  const approvalPack = currentGateId ? getGateApprovalPack(currentGateId) : null;
  const runtimeConfig = getRuntimeConfigStatus();
  const storageStatus = getStorageStatus();
  const storageDoctor = getStorageDoctorStatus();
  const pilotReadiness = getPilotReadinessStatus();
  const pilotChecklist = getPilotChecklistStatus();
  const opsSummary = getOpsSummaryStatus();
  const sourceStore = loadStoreFromDisk() || createDemoStore();

  const files = {
    snapshotJson: path.join(resolvedOutputDir, "project-snapshot.json"),
    snapshotMarkdown: path.join(resolvedOutputDir, "project-snapshot.md"),
    riskRegisterJson: path.join(resolvedOutputDir, "risk-register.json"),
    riskRegisterMarkdown: path.join(resolvedOutputDir, "risk-register.md"),
    runtimeConfigJson: path.join(resolvedOutputDir, "runtime-config.json"),
    storageStatusJson: path.join(resolvedOutputDir, "storage-status.json"),
    storageDoctorJson: path.join(resolvedOutputDir, "storage-doctor.json"),
    pilotReadinessJson: path.join(resolvedOutputDir, "pilot-readiness.json"),
    pilotChecklistJson: path.join(resolvedOutputDir, "pilot-checklist.json"),
    opsSummaryJson: path.join(resolvedOutputDir, "ops-summary.json"),
  };

  writeJson(files.snapshotJson, snapshot);
  writeText(files.snapshotMarkdown, renderProjectSnapshotMarkdown(snapshot));
  writeJson(files.riskRegisterJson, riskRegister);
  writeText(files.riskRegisterMarkdown, renderRiskRegisterMarkdown(riskRegister));
  writeJson(files.runtimeConfigJson, runtimeConfig);
  writeJson(files.storageStatusJson, storageStatus);
  writeJson(files.storageDoctorJson, storageDoctor);
  writeJson(files.pilotReadinessJson, pilotReadiness);
  writeJson(files.pilotChecklistJson, pilotChecklist);
  writeJson(files.opsSummaryJson, opsSummary);

  if (reviewPack) {
    files.gateReviewPackJson = path.join(resolvedOutputDir, "gate-review-pack.json");
    files.gateReviewPackMarkdown = path.join(resolvedOutputDir, "gate-review-pack.md");
    writeJson(files.gateReviewPackJson, reviewPack);
    writeText(files.gateReviewPackMarkdown, renderGateReviewPackMarkdown(reviewPack));
  }

  if (approvalPack) {
    files.gateApprovalPackJson = path.join(resolvedOutputDir, "gate-approval-pack.json");
    files.gateApprovalPackMarkdown = path.join(resolvedOutputDir, "gate-approval-pack.md");
    writeJson(files.gateApprovalPackJson, approvalPack);
    writeText(files.gateApprovalPackMarkdown, renderGateReviewPackMarkdown(approvalPack.reviewPack));
  }

  const postgresImport = writePostgresImportBundle(resolvedOutputDir, sourceStore);
  const manifestPath = path.join(resolvedOutputDir, "pilot-archive-manifest.json");
  const manifest = {
    generatedAt: new Date().toISOString(),
    outputDir: resolvedOutputDir,
    sourceStorePath: getStorePath(),
    project: {
      id: activeProject.project.id,
      name: activeProject.project.name,
      status: activeProject.project.status,
      currentPhaseId: activeProject.project.currentPhaseId,
      currentPhaseName: activeProject.currentPhase?.name || null,
      currentGateId,
      currentGateName: reviewPack?.gate?.name || null,
    },
    readiness: {
      storageValid: storageDoctor.valid,
      postgresImportValid: postgresImport.verification.valid,
      opsSummaryReady: opsSummary.ready,
      currentGateStatus: reviewPack?.gate?.status || null,
      currentGateReadiness: reviewPack?.readiness?.status || null,
      blockerCount: reviewPack?.summary?.blockerCount || 0,
      checklistRequiredDone: pilotChecklist.summary.requiredDone,
      checklistRequiredTotal: pilotChecklist.summary.requiredTotal,
      checklistPending: pilotChecklist.summary.pending,
    },
    files: Object.fromEntries(Object.entries(files).map(([key, filePath]) => [key, relative(resolvedOutputDir, filePath)])),
    postgresImport: {
      outputDir: relative(resolvedOutputDir, postgresImport.outputDir),
      manifestPath: relative(resolvedOutputDir, postgresImport.manifestPath),
      valid: postgresImport.verification.valid,
      counts: postgresImport.verification.counts,
      errors: postgresImport.verification.errors,
    },
  };

  writeJson(manifestPath, manifest);

  return {
    outputDir: resolvedOutputDir,
    manifestPath,
    manifest,
  };
}
