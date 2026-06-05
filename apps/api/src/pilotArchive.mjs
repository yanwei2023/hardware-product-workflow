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

const firstPilotBoundaries = [
  "用户登录和单点登录不作为第一轮内部试点验收项。",
  "PostgreSQL 运行时读写不作为第一轮内部试点验收项，当前仅提供导出、导入包和 preflight。",
  "文件上传和附件存储不作为第一轮内部试点验收项。",
  "真实大模型调用和异步 Agent 队列不作为第一轮内部试点验收项。",
  "飞书、企业微信或邮件通知不作为第一轮内部试点验收项。",
  "生产级 TLS、反向代理、数据库备份和灾备不作为第一轮内部试点验收项。",
  "多人高并发编辑冲突处理不作为第一轮内部试点验收项。",
];

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(filePath, value) {
  fs.writeFileSync(filePath, value.endsWith("\n") ? value : `${value}\n`);
}

function relative(outputDir, filePath) {
  return path.relative(outputDir, filePath);
}

function renderPilotHandoffMarkdown(manifest) {
  const readiness = manifest.readiness;
  const operations = manifest.operations;
  const postgresImport = manifest.postgresImport || {};
  const postgresCounts =
    Object.entries(postgresImport.counts || {})
      .map(([label, count]) => `${label}=${count}`)
      .join(", ") || "-";
  const postgresErrors = (postgresImport.errors || []).map((item) => `- ${item}`).join("\n") || "- 无";
  const requiredPendingRows =
    (manifest.checklist?.requiredPending || [])
      .map(
        (item) =>
          `- ${item.title}：${item.done}/${item.total}，${item.detail}${item.action ? ` 下一步：${item.action}` : ""}`,
      )
      .join("\n") || "- 无未完成必需项。";
  const diagnosticsRows = Object.entries(manifest.diagnostics || {})
    .map(([label, endpoint]) => `| ${label} | \`${endpoint}\` |`)
    .join("\n");
  const fileRows = Object.entries(manifest.files || {})
    .map(([label, filePath]) => `| ${label} | \`${filePath}\` |`)
    .join("\n");
  const nextActions = (operations.nextActions || []).map((item) => `- ${item}`).join("\n") || "- 暂无额外动作。";
  const commandRows = Object.entries(manifest.commands || {})
    .map(([label, command]) => `| ${label} | \`${command}\` |`)
    .join("\n");
  const dataProtection = manifest.dataProtection || {};
  const latestCheckpoint = dataProtection.latestCheckpoint;
  const boundaryRows = (manifest.boundaries || []).map((item) => `- ${item}`).join("\n") || "- 暂无额外边界。";

  return `# 内部试点交接页

生成时间：${manifest.generatedAt}

## 项目

- 项目：${manifest.project.name}（${manifest.project.id}）
- 状态：${manifest.project.status}
- 当前阶段：${manifest.project.currentPhaseName || manifest.project.currentPhaseId}
- 当前阶段门：${manifest.project.currentGateName || manifest.project.currentGateId || "-"}

## 就绪摘要

- Store 校验：${readiness.storageValid ? "READY" : "BLOCKED"}
- PostgreSQL 导入包：${readiness.postgresImportValid ? "READY" : "BLOCKED"}
- 运维摘要：${readiness.opsSummaryReady ? "READY" : "BLOCKED"}
- 当前阶段门：${readiness.currentGateReadiness || readiness.currentGateStatus || "-"}
- 阶段门阻塞：${readiness.blockerCount}
- 试点必需项：${readiness.checklistRequiredDone}/${readiness.checklistRequiredTotal}
- 试点待处理：${readiness.checklistPending}

## 运维摘要

- 运维阻塞：${operations.blockerCount}
- 运维提醒：${operations.warningCount}
- HTTP 4xx：${operations.httpClientErrors}
- HTTP 5xx：${operations.httpServerErrors}
- Store ready：${operations.storageReady ? "READY" : "BLOCKED"}
- Network ready：${operations.networkReady ? "READY" : "BLOCKED"}

## 下一步动作

${nextActions}

## 试点命令

| 名称 | 命令 |
| --- | --- |
${commandRows}

## 未完成必需项

${requiredPendingRows}

## 数据保护和回滚

- Store：\`${dataProtection.storePath || "-"}\`
- 备份：${dataProtection.backupExists ? "READY" : "MISSING"}${dataProtection.backupPath ? `（\`${dataProtection.backupPath}\`）` : ""}
- 备份校验：${dataProtection.backupValid ? "READY" : dataProtection.backupExists ? "BLOCKED" : "-"}
- 最近检查点：${latestCheckpoint ? `\`${latestCheckpoint.fileName}\`（${latestCheckpoint.updatedAt || "-"}）` : "暂无"}
- 最近检查点路径：\`${latestCheckpoint?.filePath || "-"}\`
- 备份恢复命令：\`${dataProtection.restoreBackupCommand || "-"}\`
- 检查命令：\`${dataProtection.storeDoctorCommand || "-"}\`

## 第一轮试点边界

${boundaryRows}

## PostgreSQL 导入包

- 状态：${postgresImport.valid ? "READY" : "BLOCKED"}
- 目录：\`${postgresImport.outputDir || "-"}\`
- Manifest：\`${postgresImport.manifestPath || "-"}\`
- 表计数：${postgresCounts}
- 错误：
${postgresErrors}
- 建表命令：\`${postgresImport.psql?.createSchema || "-"}\`
- 导入命令：\`${postgresImport.psql?.importSeed || "-"}\`
- 一次性命令：\`${postgresImport.psql?.oneShot || "-"}\`

## 诊断端点

| 名称 | 端点 |
| --- | --- |
${diagnosticsRows}

## 归档文件

| 名称 | 文件 |
| --- | --- |
${fileRows}
`;
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
    psql: manifest.psql,
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
  const requiredPendingChecklistItems = (pilotChecklist.items || [])
    .filter((item) => item.severity === "REQUIRED" && item.status !== "DONE")
    .map((item) => ({
      key: item.key,
      title: item.title,
      status: item.status,
      done: item.done,
      total: item.total,
      detail: item.detail,
      action: item.action,
    }));
  const opsSummary = getOpsSummaryStatus();
  const sourceStore = loadStoreFromDisk() || createDemoStore();

  const files = {
    handoffMarkdown: path.join(resolvedOutputDir, "pilot-handoff.md"),
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

  if (reviewPack) {
    files.gateReviewPackJson = path.join(resolvedOutputDir, "gate-review-pack.json");
    files.gateReviewPackMarkdown = path.join(resolvedOutputDir, "gate-review-pack.md");
  }

  if (approvalPack) {
    files.gateApprovalPackJson = path.join(resolvedOutputDir, "gate-approval-pack.json");
    files.gateApprovalPackMarkdown = path.join(resolvedOutputDir, "gate-approval-pack.md");
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
    operations: {
      blockerCount: opsSummary.blockers?.length || 0,
      warningCount: opsSummary.warnings?.length || 0,
      httpServerErrors: opsSummary.http?.serverErrors || 0,
      httpClientErrors: opsSummary.http?.clientErrors || 0,
      storageReady: opsSummary.storage?.ready || false,
      networkReady: opsSummary.network?.ready || false,
      nextActions: opsSummary.nextActions || [],
    },
    commands: pilotReadiness.commands || {},
    boundaries: firstPilotBoundaries,
    dataProtection: {
      storePath: storageStatus.storePath,
      backupPath: storageStatus.backupPath || storageDoctor.backupPath,
      backupExists: storageStatus.backupExists,
      backupValid: storageDoctor.backupValid,
      latestCheckpoint: storageStatus.checkpoints?.[0] || null,
      checkpointCount: storageStatus.checkpoints?.length || 0,
      storeDoctorCommand: "npm run store:doctor",
      restoreBackupCommand: "npm run store:restore-backup",
    },
    checklist: {
      requiredPending: requiredPendingChecklistItems,
    },
    diagnostics: {
      readiness: pilotReadiness.links?.readiness || "/pilot/readiness",
      checklist: pilotReadiness.links?.checklist || "/pilot/checklist",
      opsSummary: pilotReadiness.links?.opsSummary || "/ops/summary",
      metrics: pilotReadiness.links?.metrics || "/metrics",
      runtimeConfig: pilotReadiness.links?.runtimeConfig || "/runtime/config",
      runtimeNetwork: pilotReadiness.links?.runtimeNetwork || "/runtime/network",
      storageStatus: pilotReadiness.links?.storageStatus || "/storage/status",
      storageDoctor: pilotReadiness.links?.storageDoctor || "/storage/doctor",
    },
    files: Object.fromEntries(Object.entries(files).map(([key, filePath]) => [key, relative(resolvedOutputDir, filePath)])),
    postgresImport: {
      outputDir: relative(resolvedOutputDir, postgresImport.outputDir),
      manifestPath: relative(resolvedOutputDir, postgresImport.manifestPath),
      valid: postgresImport.verification.valid,
      counts: postgresImport.verification.counts,
      errors: postgresImport.verification.errors,
      psql: postgresImport.psql,
    },
  };

  writeText(files.handoffMarkdown, renderPilotHandoffMarkdown(manifest));
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
    writeJson(files.gateReviewPackJson, reviewPack);
    writeText(files.gateReviewPackMarkdown, renderGateReviewPackMarkdown(reviewPack));
  }

  if (approvalPack) {
    writeJson(files.gateApprovalPackJson, approvalPack);
    writeText(files.gateApprovalPackMarkdown, renderGateReviewPackMarkdown(approvalPack.reviewPack));
  }

  writeJson(manifestPath, manifest);

  return {
    outputDir: resolvedOutputDir,
    manifestPath,
    manifest,
  };
}
