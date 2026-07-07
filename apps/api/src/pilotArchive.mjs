import fs from "node:fs";
import path from "node:path";
import { getStorePath, loadStoreFromDisk } from "./persistence.mjs";
import { assertValidPostgresExport } from "./postgresExportReport.mjs";
import { buildPostgresImportManifest, verifyPostgresImportBundle } from "./postgresImportBundle.mjs";
import { mapStoreToPostgresRows, renderPostgresSeedSql } from "./postgresMapper.mjs";
import {
  firstPilotAcceptanceCriteria,
  firstPilotBoundaries,
  firstPilotRunbookSteps,
  pilotArchiveIndex,
  pilotDeploymentDrill,
  pilotFeedbackLedger,
  pilotHandoffWalkthrough,
  pilotIssueReport,
  pilotM6Closeout,
  pilotOpsAlerts,
  pilotRollbackCard,
  pilotTrialScope,
} from "./pilotPlan.mjs";
import {
  createDemoStore,
  getDemoProject,
  getGateApprovalPack,
  getGateReviewPack,
  getOpsSummaryStatus,
  getPilotM7BacklogStatus,
  getPilotChecklistStatus,
  getPilotLaunchStatus,
  getPilotReadinessStatus,
  getProjectRiskRegister,
  getProjectSnapshot,
  getRuntimeConfigStatus,
  getStorageDoctorStatus,
  getStorageStatus,
  renderGateReviewPackMarkdown,
  renderPilotM7BacklogMarkdown,
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
- 结果报告：\`${postgresImport.resultReportPath || "-"}\`
- 结果复核：\`${postgresImport.commands?.verifyResult || "-"}\`
- Store 恢复预览：\`${postgresImport.commands?.restoreStorePreview || "-"}\`
- Store 恢复执行：\`${postgresImport.commands?.restoreStoreExecute || "-"}\`

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

function renderPilotDeploymentDrillMarkdown(manifest) {
  const drill = manifest.deploymentDrill || {};
  const dataProtection = manifest.dataProtection || {};
  const stepRows = (drill.steps || [])
    .map((item, index) => `${index + 1}. ${item.title}\n   - 命令/动作：\`${item.command}\`\n   - 留存证据：${item.evidence}`)
    .join("\n");
  const evidenceRows = (drill.requiredEvidence || []).map((item) => `- ${item}`).join("\n") || "- 暂无证据要求。";

  return `# 内部试点部署演练清单

生成时间：${manifest.generatedAt}

## 默认策略

- 运行时写入源：JSON store
- PostgreSQL 策略：${drill.postgresDefaultPolicy === "migration_verification_only" ? "仅作为迁移验证材料" : drill.postgresDefaultPolicy || "-"}
- Store：\`${dataProtection.storePath || "-"}\`
- 备份：\`${dataProtection.backupPath || "-"}\`
- 回滚卡片：\`${manifest.files?.rollbackCardMarkdown || "pilot-rollback-card.md"}\`

## 演练步骤

${stepRows || "暂无演练步骤。"}

## 必留证据

${evidenceRows}

## 通过条件

- \`/ready\` 返回 200。
- \`/storage/doctor\` 显示 store 有效。
- \`/runtime/network\` 显示可用的局域网访问地址。
- 试点访问码保管人明确。
- 检查点或 \`.bak\` 恢复路径明确。
- PostgreSQL 默认策略已记录；未执行严格数据库写入演练时，不把 \`DATABASE_URL\` 或 \`psql\` 缺失视为阻塞。
`;
}

function renderPilotFeedbackLedgerMarkdown(manifest) {
  const ledger = manifest.feedbackLedger || {};
  const fieldRows = (ledger.fields || []).map((item) => `- ${item}`).join("\n") || "- 暂无字段。";
  const categoryRows = (ledger.categories || []).map((item) => `- ${item}`).join("\n") || "- 暂无分类。";
  const priorityRows = (ledger.priorities || []).map((item) => `- ${item}`).join("\n") || "- 暂无优先级。";
  const statusRows = (ledger.statuses || []).map((item) => `- ${item}`).join("\n") || "- 暂无状态。";

  return `# 内部试点反馈台账

生成时间：${manifest.generatedAt}

## 使用说明

- 单个故障或阻塞先填写 \`${manifest.files?.issueReportMarkdown || "pilot-issue-report.md"}\`。
- 会后把所有问题、建议和观察项汇总到本台账。
- 默认后续节点：${ledger.defaultMilestone || "M7"}。
- P0/P1 需要在试点复盘会上明确负责人和下一步。

## 字段

${fieldRows}

## 分类

${categoryRows}

## 优先级

${priorityRows}

## 状态

${statusRows}

## 严重度规则

${ledger.severityGuide || "-"}

## 台账模板

| 编号 | 来源 | 反馈类型 | 严重度 | 优先级 | 状态 | 摘要 | 复现或证据 | 负责人 | 后续节点 | 下一步 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PF-001 | 试点会议/问题上报 | 流程适配 | S2 | P1 | OPEN | 示例：阶段门材料字段不够 | 请求 ID、截图或归档文件路径 | 待定 | ${ledger.defaultMilestone || "M7"} | 复盘会确认是否进入 M7 |
`;
}

function renderPilotTrialScopeMarkdown(manifest) {
  const scope = manifest.trialScope || {};
  const roleRows = (scope.roles || []).map((item) => `- ${item}`).join("\n") || "- 暂无角色。";
  const prerequisiteRows = (scope.prerequisites || []).map((item) => `- ${item}`).join("\n") || "- 暂无前置条件。";
  const excludedRows = (scope.excludedScopes || []).map((item) => `- ${item}`).join("\n") || "- 暂无排除项。";
  const pendingRows = (scope.pendingDecisions || []).map((item) => `- ${item}`).join("\n") || "- 暂无待确认事项。";

  return `# 内部试点范围与运行策略

生成时间：${manifest.generatedAt}

## 决策

- 参与人数：${scope.participantRange || "-"} 人。
- 试点项目：${scope.projectRecommendation || "-"}。
- 阶段范围：${scope.phaseRange || "-"}。
- 默认运行时写入源：JSON store。
- PostgreSQL 策略：${scope.postgresPolicy === "migration_verification_only" ? "仅作为迁移验证材料" : scope.postgresPolicy || "-"}。

## 参与角色

${roleRows}

## 前置条件

${prerequisiteRows}

## 不纳入本轮

${excludedRows}

## 待确认

${pendingRows}
`;
}

function renderPilotOpsAlertsMarkdown(manifest) {
  const alerts = manifest.opsAlerts || {};
  const operations = manifest.operations || {};
  const endpointRows = (alerts.watchEndpoints || []).map((item) => `- \`${item}\``).join("\n") || "- 暂无端点。";
  const ruleRows = (alerts.rules || [])
    .map(
      (item) =>
        `| ${item.code} | ${item.severity} | \`${item.endpoint}\` | ${item.metric ? `\`${item.metric}\`` : "-"} | ${item.trigger} | ${item.action} |`,
    )
    .join("\n");

  return `# 内部试点运维告警建议

生成时间：${manifest.generatedAt}

## 当前摘要

- 运维阻塞：${operations.blockerCount ?? 0}
- 运维提醒：${operations.warningCount ?? 0}
- HTTP 4xx：${operations.httpClientErrors ?? 0}
- HTTP 5xx：${operations.httpServerErrors ?? 0}
- Store ready：${operations.storageReady ? "READY" : "BLOCKED"}
- Network ready：${operations.networkReady ? "READY" : "BLOCKED"}

## 观察端点

${endpointRows}

## 建议规则

| 代码 | 严重度 | 来源 | 指标 | 触发条件 | 动作 |
| --- | --- | --- | --- | --- | --- |
${ruleRows}

## 升级规则

${alerts.escalation || "-"}

## 使用方式

- 试点主持人每个关键操作前后查看 \`/ops/summary\`。
- 页面出现错误时保留请求 ID、服务版本和截图。
- \`RUNTIME_PERSISTENCE\`、\`READY_DOWN\`、\`HTTP_5XX\` 按 S1 处理，先暂停写入再诊断。
- 默认 JSON 试点中，\`DATABASE_URL\` 或 \`psql\` 缺失只记录为 PostgreSQL 演练条件不足，不阻塞业务试点。
`;
}

function renderPilotArchiveIndexMarkdown(manifest) {
  const index = manifest.archiveIndex || {};
  const primaryRows = (index.primaryReadOrder || [])
    .map((item, itemIndex) => `${itemIndex + 1}. \`${item.file}\`：${item.purpose}`)
    .join("\n") || "暂无阅读顺序。";
  const situationRows = (index.bySituation || [])
    .map((item) => `| ${item.situation} | ${item.files.map((file) => `\`${file}\``).join("、")} |`)
    .join("\n");
  const fileRows = Object.entries(manifest.files || {})
    .map(([label, filePath]) => `| ${label} | \`${filePath}\` |`)
    .join("\n");

  return `# 内部试点归档包总目录

生成时间：${manifest.generatedAt}

## 先看这几个

${primaryRows}

## 按场景找文件

| 场景 | 文件 |
| --- | --- |
${situationRows}

## 当前状态快照

- 启动判定：${manifest.launch?.decision || "-"}
- 运维阻塞：${manifest.operations?.blockerCount ?? 0}
- 运维提醒：${manifest.operations?.warningCount ?? 0}
- 当前阶段门：${manifest.readiness?.currentGateReadiness || manifest.readiness?.currentGateStatus || "-"}
- 试点必需项：${manifest.readiness?.checklistRequiredDone ?? 0}/${manifest.readiness?.checklistRequiredTotal ?? 0}

## 完整文件清单

| 名称 | 文件 |
| --- | --- |
${fileRows}
`;
}

function renderPilotHandoffWalkthroughMarkdown(manifest) {
  const walkthrough = manifest.handoffWalkthrough || {};
  const stepRows = (walkthrough.steps || [])
    .map(
      (item, index) =>
        `${index + 1}. ${item.title}\n   - 动作：${item.action}\n   - 文件：${item.files.map((file) => `\`${file}\``).join("、")}\n   - 留存证据：${item.evidence}`,
    )
    .join("\n");
  const evidenceRows = (walkthrough.requiredEvidence || []).map((item) => `- ${item}`).join("\n") || "- 暂无证据要求。";

  return `# 内部试点交接走查清单

生成时间：${manifest.generatedAt}

## 适用场景

非核心开发同事或试点主持人第一次拿到归档包时，用这份清单走一遍“能不能自己找到材料、启动试点、记录问题、执行回滚和进入复盘”。

## 走查步骤

${stepRows || "暂无走查步骤。"}

## 必留证据

${evidenceRows}

## 当前判定参考

- 启动判定：${manifest.launch?.decision || "-"}
- 运维阻塞：${manifest.operations?.blockerCount ?? 0}
- 运维提醒：${manifest.operations?.warningCount ?? 0}
- 试点必需项：${manifest.readiness?.checklistRequiredDone ?? 0}/${manifest.readiness?.checklistRequiredTotal ?? 0}

## 结论

- 走查主持人:
- 操作者:
- 结论: PASS / PASS_WITH_NOTES / BLOCKED
- 需要调整的材料:
- 下一步:
`;
}

function renderPilotM6CloseoutMarkdown(manifest) {
  const closeout = manifest.m6Closeout || {};
  const criteriaRows = (closeout.criteria || [])
    .map((item) => `| ${item.title} | ${item.status} | ${item.evidence} |`)
    .join("\n");
  const decisionRows = (closeout.remainingDecisions || []).map((item) => `- ${item}`).join("\n") || "- 暂无剩余决策。";

  return `# M6 收尾判定

生成时间：${manifest.generatedAt}

## 建议结论

${closeout.recommendedDecision || "PASS_WITH_NOTES"}

## 判定标准

| 标准 | 状态 | 证据 |
| --- | --- | --- |
${criteriaRows}

## 当前归档状态

- 启动判定：${manifest.launch?.decision || "-"}
- 运维阻塞：${manifest.operations?.blockerCount ?? 0}
- 运维提醒：${manifest.operations?.warningCount ?? 0}
- 试点必需项：${manifest.readiness?.checklistRequiredDone ?? 0}/${manifest.readiness?.checklistRequiredTotal ?? 0}
- 归档入口：\`${manifest.files?.archiveIndexMarkdown || "pilot-archive-index.md"}\`
- 交接走查：\`${manifest.files?.handoffWalkthroughMarkdown || "pilot-handoff-walkthrough.md"}\`
- 回滚路径：\`${manifest.files?.rollbackCardMarkdown || "pilot-rollback-card.md"}\`

## 剩余决策

${decisionRows}

## 收尾记录

- 判定人:
- 判定时间:
- 结论: PASS / PASS_WITH_NOTES / BLOCKED
- 进入 M7 的事项:
- 暂缓事项:
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
    resultReportPath: path.join(postgresDir, "postgres-import-result.json"),
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
  const m7Backlog = getPilotM7BacklogStatus();
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
    deploymentDrillMarkdown: path.join(resolvedOutputDir, "pilot-deployment-drill.md"),
    deploymentDrillJson: path.join(resolvedOutputDir, "pilot-deployment-drill.json"),
    feedbackLedgerMarkdown: path.join(resolvedOutputDir, "pilot-feedback-ledger.md"),
    feedbackLedgerJson: path.join(resolvedOutputDir, "pilot-feedback-ledger.json"),
    m7BacklogMarkdown: path.join(resolvedOutputDir, "pilot-m7-backlog.md"),
    m7BacklogJson: path.join(resolvedOutputDir, "pilot-m7-backlog.json"),
    trialScopeMarkdown: path.join(resolvedOutputDir, "pilot-trial-scope.md"),
    trialScopeJson: path.join(resolvedOutputDir, "pilot-trial-scope.json"),
    opsAlertsMarkdown: path.join(resolvedOutputDir, "pilot-ops-alerts.md"),
    opsAlertsJson: path.join(resolvedOutputDir, "pilot-ops-alerts.json"),
    archiveIndexMarkdown: path.join(resolvedOutputDir, "pilot-archive-index.md"),
    archiveIndexJson: path.join(resolvedOutputDir, "pilot-archive-index.json"),
    handoffWalkthroughMarkdown: path.join(resolvedOutputDir, "pilot-handoff-walkthrough.md"),
    handoffWalkthroughJson: path.join(resolvedOutputDir, "pilot-handoff-walkthrough.json"),
    m6CloseoutMarkdown: path.join(resolvedOutputDir, "pilot-m6-closeout.md"),
    m6CloseoutJson: path.join(resolvedOutputDir, "pilot-m6-closeout.json"),
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
    deploymentDrill: {
      templatePath: pilotDeploymentDrill.templateName,
      defaultRuntimeSource: pilotDeploymentDrill.defaultRuntimeSource,
      postgresDefaultPolicy: pilotDeploymentDrill.postgresDefaultPolicy,
      steps: pilotDeploymentDrill.steps,
      requiredEvidence: pilotDeploymentDrill.requiredEvidence,
    },
    feedbackLedger: {
      templatePath: pilotFeedbackLedger.templateName,
      defaultMilestone: pilotFeedbackLedger.defaultMilestone,
      fields: pilotFeedbackLedger.fields,
      categories: pilotFeedbackLedger.categories,
      priorities: pilotFeedbackLedger.priorities,
      statuses: pilotFeedbackLedger.statuses,
      severityGuide: pilotFeedbackLedger.severityGuide,
      triage: pilotFeedbackLedger.triage,
      m7Backlog: pilotFeedbackLedger.m7Backlog,
    },
    m7Backlog,
    trialScope: {
      templatePath: pilotTrialScope.templateName,
      participantRange: pilotTrialScope.participantRange,
      projectRecommendation: pilotTrialScope.projectRecommendation,
      phaseRange: pilotTrialScope.phaseRange,
      defaultRuntimeSource: pilotTrialScope.defaultRuntimeSource,
      postgresPolicy: pilotTrialScope.postgresPolicy,
      roles: pilotTrialScope.roles,
      prerequisites: pilotTrialScope.prerequisites,
      excludedScopes: pilotTrialScope.excludedScopes,
      pendingDecisions: pilotTrialScope.pendingDecisions,
    },
    opsAlerts: {
      templatePath: pilotOpsAlerts.templateName,
      watchEndpoints: pilotOpsAlerts.watchEndpoints,
      rules: pilotOpsAlerts.rules,
      escalation: pilotOpsAlerts.escalation,
    },
    archiveIndex: {
      templatePath: pilotArchiveIndex.templateName,
      primaryReadOrder: pilotArchiveIndex.primaryReadOrder,
      bySituation: pilotArchiveIndex.bySituation,
    },
    handoffWalkthrough: {
      templatePath: pilotHandoffWalkthrough.templateName,
      steps: pilotHandoffWalkthrough.steps,
      requiredEvidence: pilotHandoffWalkthrough.requiredEvidence,
    },
    m6Closeout: {
      templatePath: pilotM6Closeout.templateName,
      recommendedDecision: pilotM6Closeout.recommendedDecision,
      criteria: pilotM6Closeout.criteria,
      remainingDecisions: pilotM6Closeout.remainingDecisions,
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
      feedbackPlan: pilotReadiness.links?.feedbackPlan || "/pilot/feedback-plan",
      feedbackTriage: pilotReadiness.links?.feedbackTriage || "/pilot/feedback-triage",
      m7Backlog: pilotReadiness.links?.m7Backlog || "/pilot/m7-backlog",
      m7BacklogMarkdown: pilotReadiness.links?.m7BacklogMarkdown || "/pilot/m7-backlog.md",
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
      resultReportPath: relative(resolvedOutputDir, postgresImport.resultReportPath),
    },
  };

  writeText(files.handoffMarkdown, renderPilotHandoffMarkdown(manifest));
  writeText(files.briefMarkdown, renderPilotBriefMarkdown(manifest));
  writeText(files.issueReportMarkdown, renderPilotIssueReportMarkdown(manifest));
  writeText(files.rollbackCardMarkdown, renderPilotRollbackCardMarkdown(manifest));
  writeText(files.deploymentDrillMarkdown, renderPilotDeploymentDrillMarkdown(manifest));
  writeJson(files.deploymentDrillJson, manifest.deploymentDrill);
  writeText(files.feedbackLedgerMarkdown, renderPilotFeedbackLedgerMarkdown(manifest));
  writeJson(files.feedbackLedgerJson, manifest.feedbackLedger);
  writeText(files.m7BacklogMarkdown, renderPilotM7BacklogMarkdown(manifest.m7Backlog));
  writeJson(files.m7BacklogJson, manifest.m7Backlog);
  writeText(files.trialScopeMarkdown, renderPilotTrialScopeMarkdown(manifest));
  writeJson(files.trialScopeJson, manifest.trialScope);
  writeText(files.opsAlertsMarkdown, renderPilotOpsAlertsMarkdown(manifest));
  writeJson(files.opsAlertsJson, manifest.opsAlerts);
  writeText(files.archiveIndexMarkdown, renderPilotArchiveIndexMarkdown(manifest));
  writeJson(files.archiveIndexJson, manifest.archiveIndex);
  writeText(files.handoffWalkthroughMarkdown, renderPilotHandoffWalkthroughMarkdown(manifest));
  writeJson(files.handoffWalkthroughJson, manifest.handoffWalkthrough);
  writeText(files.m6CloseoutMarkdown, renderPilotM6CloseoutMarkdown(manifest));
  writeJson(files.m6CloseoutJson, manifest.m6Closeout);
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
