import fs from "node:fs";
import path from "node:path";
import { getStorePath, loadStoreFromDisk } from "./persistence.mjs";
import { assertValidPostgresExport } from "./postgresExportReport.mjs";
import { buildPostgresImportManifest, verifyPostgresImportBundle } from "./postgresImportBundle.mjs";
import { mapStoreToPostgresRows, renderPostgresSeedSql } from "./postgresMapper.mjs";
import { firstPilotAcceptanceCriteria, firstPilotBoundaries, firstPilotRunbookSteps, pilotIssueReport, pilotRollbackCard } from "./pilotPlan.mjs";
import {
  createDemoStore,
  getDemoProject,
  getGateApprovalPack,
  getGateReviewPack,
  getOpsSummaryStatus,
  getPilotChecklistStatus,
  getPilotLaunchStatus,
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
  const acceptanceRows = (manifest.acceptanceCriteria || []).map((item) => `- ${item}`).join("\n") || "- 暂无验收标准。";
  const boundaryRows = (manifest.boundaries || []).map((item) => `- ${item}`).join("\n") || "- 暂无额外边界。";
  const runbookRows = (manifest.runbookSteps || []).map((item, index) => `${index + 1}. ${item}`).join("\n") || "暂无试点流程。";
  const issueReport = manifest.issueReport || {};

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

## 试点问题上报

- 上报模板：\`${issueReport.templatePath || "-"}\`
- 严重度规则：${issueReport.severityGuide || "-"}
- 必填字段：${(issueReport.requiredFields || []).join("、") || "-"}

## 第一轮验收标准

${acceptanceRows}

## 建议试点流程

${runbookRows}

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
- 受控预览：\`${postgresImport.commands?.preview || "-"}\`
- 受控导入：\`${postgresImport.commands?.execute || "-"}\`

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

function renderPilotBriefMarkdown(manifest) {
  const blockers = manifest.operations?.blockerCount
    ? [`- 运维阻塞：${manifest.operations.blockerCount}`]
    : ["- 无运维阻塞"];
  const warnings = manifest.operations?.warningCount
    ? [`- 运维提醒：${manifest.operations.warningCount}`]
    : ["- 无运维提醒"];
  const nextActions = (manifest.operations?.nextActions || []).map((item) => `- ${item}`);
  const commandRows = Object.entries(manifest.commands || {}).map(([label, command]) => `- ${label}: ${command}`);
  const diagnosticRows = Object.entries(manifest.diagnostics || {}).map(([label, endpoint]) => `- ${label}: ${endpoint}`);

  return `# 内部试点现场简报

生成时间：${manifest.generatedAt}

- 项目：${manifest.project.name}（${manifest.project.id}）
- 当前阶段：${manifest.project.currentPhaseName || manifest.project.currentPhaseId}
- 当前阶段门：${manifest.project.currentGateName || manifest.project.currentGateId || "-"}
- 阶段门状态：${manifest.readiness.currentGateReadiness || manifest.readiness.currentGateStatus || "-"}
- 试点必需项：${manifest.readiness.checklistRequiredDone}/${manifest.readiness.checklistRequiredTotal}
- 试点待处理：${manifest.readiness.checklistPending}
- Store：${manifest.readiness.storageValid ? "READY" : "BLOCKED"}
- PostgreSQL 导入包：${manifest.readiness.postgresImportValid ? "READY" : "BLOCKED"}

## 阻塞

${blockers.join("\n")}

## 提醒

${warnings.join("\n")}

## 下一步

${nextActions.length ? nextActions.join("\n") : "- 暂无额外动作。"}

## 命令

${commandRows.length ? commandRows.join("\n") : "- 暂无命令。"}

## 诊断链接

${diagnosticRows.length ? diagnosticRows.join("\n") : "- 暂无诊断链接。"}
`;
}

function renderPilotIssueReportMarkdown(manifest) {
  const diagnosticsRows = Object.entries(manifest.diagnostics || {})
    .map(([label, endpoint]) => `- ${label}: \`${endpoint}\``)
    .join("\n");
  const fieldRows = (manifest.issueReport?.requiredFields || [])
    .map((field) => `- ${field}: `)
    .join("\n");
  const dataProtection = manifest.dataProtection || {};

  return `# 内部试点问题上报模板

> 试点成员遇到阻塞、数据异常、页面报错或流程疑问时，复制本模板填写。页面顶部错误提示中的请求 ID、服务版本和发生时间请原样保留。

## 基本信息

${fieldRows}

## 严重度

- S1：数据损坏、无法启动、阶段门错误放行或无法回滚。
- S2：核心流程阻塞，包括工作包生成、审核、风险处理、阶段门批准或导出失败。
- S3：页面可用性、文案、性能、局域网访问或非关键导出问题。

## 现场诊断

优先打开以下端点并把结果随问题一起归档：

${diagnosticsRows}

## 数据保护

- Store: \`${dataProtection.storePath || "-"}\`
- 备份: \`${dataProtection.backupPath || "-"}\`
- 最近检查点: \`${dataProtection.latestCheckpoint?.filePath || "-"}\`
- 检查命令: \`${dataProtection.storeDoctorCommand || "-"}\`
- 回滚命令: \`${dataProtection.restoreBackupCommand || "-"}\`

## 处理记录

- 临时处置:
- 负责人:
- 下一步:
- 是否已进入待办或风险台账:
`;
}

function renderPilotRollbackCardMarkdown(manifest) {
  const rollback = manifest.rollbackCard || {};
  const dataProtection = manifest.dataProtection || {};
  const steps = (rollback.steps || []).map((item, index) => `${index + 1}. ${item}`).join("\n") || "暂无回滚步骤。";
  const evidenceRows = (rollback.requiredEvidence || []).map((item) => `- ${item}`).join("\n") || "- 暂无证据要求。";

  return `# 内部试点回滚卡片

> ${rollback.severityGuide || "出现数据、放行或恢复风险时使用。"}

## 当前数据保护

- Store: \`${dataProtection.storePath || "-"}\`
- 备份: \`${dataProtection.backupPath || "-"}\`
- 备份状态: ${dataProtection.backupExists ? dataProtection.backupValid ? "READY" : "BLOCKED" : "MISSING"}
- 最近检查点: \`${dataProtection.latestCheckpoint?.filePath || "-"}\`
- 检查点数量: ${dataProtection.checkpointCount || 0}
- 检查命令: \`${dataProtection.storeDoctorCommand || "-"}\`
- 备份恢复命令: \`${dataProtection.restoreBackupCommand || "-"}\`

## 执行步骤

${steps}

## 必留证据

${evidenceRows}

## 诊断端点

- /storage/doctor
- /ops/summary
- /pilot/launch
- /ready
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
    commands: manifest.commands,
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
  const pilotLaunch = getPilotLaunchStatus();
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
    briefMarkdown: path.join(resolvedOutputDir, "pilot-brief.md"),
    snapshotJson: path.join(resolvedOutputDir, "project-snapshot.json"),
    snapshotMarkdown: path.join(resolvedOutputDir, "project-snapshot.md"),
    riskRegisterJson: path.join(resolvedOutputDir, "risk-register.json"),
    riskRegisterMarkdown: path.join(resolvedOutputDir, "risk-register.md"),
    runtimeConfigJson: path.join(resolvedOutputDir, "runtime-config.json"),
    storageStatusJson: path.join(resolvedOutputDir, "storage-status.json"),
    storageDoctorJson: path.join(resolvedOutputDir, "storage-doctor.json"),
    pilotReadinessJson: path.join(resolvedOutputDir, "pilot-readiness.json"),
    pilotLaunchJson: path.join(resolvedOutputDir, "pilot-launch-summary.json"),
    pilotChecklistJson: path.join(resolvedOutputDir, "pilot-checklist.json"),
    opsSummaryJson: path.join(resolvedOutputDir, "ops-summary.json"),
    issueReportMarkdown: path.join(resolvedOutputDir, "pilot-issue-report.md"),
    rollbackCardMarkdown: path.join(resolvedOutputDir, "pilot-rollback-card.md"),
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
      storageReady: opsSummary.storage?.valid || false,
      networkReady: opsSummary.network?.ready || false,
      nextActions: opsSummary.nextActions || [],
    },
    launch: {
      decision: pilotLaunch.decision,
      canStart: pilotLaunch.canStart,
      requiredPending: pilotLaunch.summary.requiredPending,
      blockers: pilotLaunch.summary.blockers,
      warnings: pilotLaunch.summary.warnings,
    },
    commands: pilotReadiness.commands || {},
    acceptanceCriteria: firstPilotAcceptanceCriteria,
    boundaries: firstPilotBoundaries,
    runbookSteps: firstPilotRunbookSteps,
    issueReport: {
      templatePath: pilotIssueReport.templateName,
      severityGuide: pilotIssueReport.severityGuide,
      requiredFields: pilotIssueReport.requiredFields,
    },
    rollbackCard: {
      templatePath: pilotRollbackCard.templateName,
      severityGuide: pilotRollbackCard.severityGuide,
      steps: pilotRollbackCard.steps,
      requiredEvidence: pilotRollbackCard.requiredEvidence,
    },
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
      launch: pilotReadiness.links?.launch || "/pilot/launch",
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
      commands: postgresImport.commands,
    },
  };

  writeText(files.handoffMarkdown, renderPilotHandoffMarkdown(manifest));
  writeText(files.briefMarkdown, renderPilotBriefMarkdown(manifest));
  writeText(files.issueReportMarkdown, renderPilotIssueReportMarkdown(manifest));
  writeText(files.rollbackCardMarkdown, renderPilotRollbackCardMarkdown(manifest));
  writeJson(files.snapshotJson, snapshot);
  writeText(files.snapshotMarkdown, renderProjectSnapshotMarkdown(snapshot));
  writeJson(files.riskRegisterJson, riskRegister);
  writeText(files.riskRegisterMarkdown, renderRiskRegisterMarkdown(riskRegister));
  writeJson(files.runtimeConfigJson, runtimeConfig);
  writeJson(files.storageStatusJson, storageStatus);
  writeJson(files.storageDoctorJson, storageDoctor);
  writeJson(files.pilotReadinessJson, pilotReadiness);
  writeJson(files.pilotLaunchJson, pilotLaunch);
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
