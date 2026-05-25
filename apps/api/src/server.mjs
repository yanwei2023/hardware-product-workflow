import http from "node:http";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildProjectFromTemplate, getHardwarePhaseTemplate } from "./templateEngine.mjs";
import {
  getArtifactTemplateRegistry,
  loadArtifactTemplateByKey,
  loadArtifactTemplateByType,
} from "./artifactTemplateStore.mjs";
import { validateArtifactMarkdown } from "./artifactValidator.mjs";
import { deleteStoreFromDisk, getStorePath, loadStoreFromDisk, saveStoreToDisk } from "./persistence.mjs";
import {
  canAcceptRisk,
  canCloseRisk,
  canApproveGate,
  canApproveWorkPackage,
  canReviewWorkPackage,
  findUser,
  getDemoUsers,
} from "./permissionStore.mjs";

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || "127.0.0.1";
const workspaceRoot = path.resolve(import.meta.dirname, "../../..");
const staticRoot = path.join(workspaceRoot, "apps/static");
const allowedReviewDecisions = new Set(["APPROVE", "APPROVE_WITH_CONDITIONS", "REQUEST_REVISION", "REJECT"]);
const allowedRiskStatuses = new Set(["OPEN", "ACCEPTED", "CLOSED"]);
const allowedRiskSeverities = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const closedWorkPackageStatuses = new Set(["HUMAN_APPROVED", "LOCKED", "REJECTED", "CANCELLED"]);

function validationError(message, details = {}) {
  return {
    statusCode: 400,
    body: {
      error: message,
      ...details,
    },
  };
}

function dateOnly(value = new Date()) {
  return new Date(value).toISOString().slice(0, 10);
}

function daysUntil(dateValue, fromValue = new Date()) {
  const target = Date.parse(`${dateValue}T00:00:00.000Z`);
  const from = Date.parse(`${dateOnly(fromValue)}T00:00:00.000Z`);
  return Math.round((target - from) / 86400000);
}

function workPackageScheduleStatus(workPackage, today = new Date()) {
  if (!workPackage.dueAt) {
    return "UNSCHEDULED";
  }
  if (closedWorkPackageStatuses.has(workPackage.status)) {
    return "DONE";
  }
  const remainingDays = daysUntil(workPackage.dueAt, today);
  if (remainingDays < 0) {
    return "OVERDUE";
  }
  if (remainingDays <= 3) {
    return "DUE_SOON";
  }
  return "ON_TRACK";
}

export function createDemoStore() {
  const projectId = "project-smart-controller";
  const project = {
    id: projectId,
    name: "智能控制器项目",
    currentPhaseId: "phase-evt_exit",
    status: "IN_PROGRESS",
  };
  const generated = buildProjectFromTemplate(project);

  return {
    activeProjectId: project.id,
    projects: [project],
    phases: generated.phases,
    gates: generated.gates,
    rolePairs: generated.rolePairs,
    gateRequirements: generated.gateRequirements,
    workPackages: generated.workPackages,
    artifactVersions: [
      {
        id: "artifact-evt-test-plan-draft",
        workPackageId: "wp-evt_exit-evt_test_plan",
        artifactType: "TEST_PLAN",
        status: "PENDING_REVIEW",
        version: "0.1",
        createdByActor: "agent:test_agent",
        content: {
          title: "EVT 测试计划草稿",
          summary: "由 Test Agent 根据需求和历史模板生成，等待测试负责人审核。",
          templateKey: "test_plan_v0_1",
          validation: {
            status: "PASSED",
            missingSections: [],
            emptySections: [],
          },
        },
      },
    ],
    reviews: [],
    risks: [
      {
        id: "risk-thermal-margin",
        projectId,
        phaseId: "phase-evt_exit",
        title: "热设计裕量不足",
        severity: "HIGH",
        status: "OPEN",
      },
    ],
    agentRuns: [],
    agentFindings: [],
    evidenceRefs: [],
    gateApprovalPacks: [],
    auditEvents: [],
    notifications: [],
  };
}

let store = loadStoreFromDisk() || createDemoStore();
ensureStoreShape();
saveStoreToDisk(store);

function persistStore() {
  saveStoreToDisk(store);
}

function ensureStoreShape() {
  store.notifications ||= [];
  store.evidenceRefs ||= [];
  store.gateApprovalPacks ||= [];
}

export function getStorageStatus() {
  const storePath = getStorePath();
  const exists = fs.existsSync(storePath);
  const stat = exists ? fs.statSync(storePath) : null;
  return {
    storePath,
    exists,
    sizeBytes: stat?.size || 0,
    updatedAt: stat?.mtime?.toISOString() || null,
    activeProjectId: store.activeProjectId,
    projectCount: store.projects.length,
    auditEventCount: store.auditEvents.length,
    gateApprovalPackCount: store.gateApprovalPacks?.length || 0,
    notificationCount: store.notifications?.length || 0,
  };
}

export function resetDemoStore() {
  deleteStoreFromDisk();
  store = createDemoStore();
  persistStore();
  return getActiveProjectView();
}

function writeJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  res.end(JSON.stringify(body, null, 2));
}

function writeText(res, statusCode, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "content-type": contentType,
    "access-control-allow-origin": "*",
  });
  res.end(body);
}

function renderGateReviewPackMarkdown(pack) {
  const evidenceRows = pack.evidence
    .map(
      (item) =>
        `| ${item.requiredWorkPackageTitle} | ${item.requiredArtifactType} | ${item.workPackageStatus} | ${item.latestArtifactStatus} | ${item.manualEvidenceCount} | ${item.reviewerUserId || "-"} | ${item.approvedReviewDecision || "-"} | ${item.approvedReviewConditions?.length ? item.approvedReviewConditions.join("; ") : "-"} | ${item.approvedReviewComment || "-"} | ${item.approvedReviewConditionsCompletedAt ? "DONE" : item.approvedReviewConditions?.length ? "OPEN" : "-"} | ${item.approvedReviewConditionsCompletedByUserId || "-"} | ${item.approvedReviewConditionsCompletionComment || "-"} | ${item.ready ? "READY" : "BLOCKED"} |`,
    )
    .join("\n");
  const riskRows = pack.risks.length
    ? pack.risks
        .map(
          (risk) =>
            `| ${risk.title} | ${risk.severity} | ${risk.status} | ${risk.blocksGate ? "YES" : "NO"} | ${risk.mitigationStatus || "-"} | ${risk.mitigationOwnerUserId || "-"} | ${risk.mitigationDueAt || "-"} | ${risk.mitigationCompletionComment || "-"} |`,
        )
        .join("\n")
    : "| 无 | - | - | NO | - | - | - | - |";
  const blockerRows = pack.blockers.length
    ? pack.blockers.map((blocker) => `- ${blocker.code}: ${blocker.message}`).join("\n")
    : "- 无";

  return `# ${pack.gate.name} 审核包

项目：${pack.project?.name || "-"}
阶段：${pack.phase?.name || "-"}
阶段门状态：${pack.gate.status}
就绪状态：${pack.readiness.status}
批准人：${pack.gate.approvedByUserId || "-"}
批准时间：${pack.gate.approvedAt || "-"}
批准说明：${pack.gate.approvalComment || "-"}

## 摘要

- 必需证据：${pack.summary.readyEvidenceCount}/${pack.summary.requiredEvidenceCount}
- 阻塞项：${pack.summary.blockerCount}
- 阻塞风险：${pack.summary.openBlockingRiskCount}
- 可批准：${pack.summary.readyForApproval ? "是" : "否"}

## 必需证据

| 工作包 | 交付物类型 | 工作包状态 | 最新交付物状态 | 人工证据 | 审核人 | 审核决定 | 批准条件 | 审核说明 | 条款状态 | 条款完成人 | 条款完成说明 | 结论 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
${evidenceRows}

## 风险

| 风险 | 严重度 | 状态 | 阻塞阶段门 | 缓解状态 | 缓解负责人 | 缓解截止 | 缓解完成说明 |
|---|---|---|---|---|---|---|---|
${riskRows}

## 阻塞项

${blockerRows}
`;
}

function renderProjectSnapshotMarkdown(snapshot) {
  const phaseRows = snapshot.phases
    .map((phase) => `| ${phase.sequence} | ${phase.name} | ${phase.status} |`)
    .join("\n");
  const workPackageRows = snapshot.workPackages
    .map(
      (item) =>
        `| ${item.phaseName} | ${item.title} | ${item.requiredArtifactType} | ${item.status} | ${item.dueAt || "-"} | ${item.scheduleStatus || "-"} | ${item.ownerUserId || "-"} |`,
    )
    .join("\n");
  const riskRows = snapshot.risks.length
    ? snapshot.risks
        .map(
          (risk) =>
            `| ${risk.phaseName} | ${risk.title} | ${risk.severity} | ${risk.status} | ${risk.mitigationStatus || "-"} | ${risk.mitigationOwnerUserId || "-"} | ${risk.mitigationDueAt || "-"} | ${risk.mitigation || "-"} | ${risk.mitigationCompletionComment || "-"} | ${risk.decisionComment || "-"} |`,
        )
        .join("\n")
    : "| 无 | - | - | - | - | - | - | - | - | - |";
  const auditRows = snapshot.auditEvents.length
    ? snapshot.auditEvents
        .slice(-12)
        .map((event) => `| ${event.createdAt} | ${event.eventType} | ${event.actorType}:${event.actorId} | ${event.objectType}:${event.objectId} |`)
        .join("\n")
    : "| 无 | - | - | - |";
  const notificationRows = snapshot.notifications.length
    ? snapshot.notifications
        .slice(-12)
        .map((item) => `| ${item.createdAt} | ${item.userId} | ${item.status} | ${item.title} |`)
        .join("\n")
    : "| 无 | - | - | - |";
  const evidenceRefRows = snapshot.evidenceRefs.length
    ? snapshot.evidenceRefs
        .slice(-12)
        .map((item) => {
          const workPackage = snapshot.workPackages.find((workPackage) => workPackage.id === item.workPackageId);
          return `| ${item.createdAt} | ${workPackage?.title || item.workPackageId} | ${item.label} | ${item.ref} |`;
        })
        .join("\n")
    : "| 无 | - | - | - |";
  const gateApprovalPackRows = snapshot.gateApprovalPacks.length
    ? snapshot.gateApprovalPacks
        .slice(-12)
        .map((item) => {
          const gate = snapshot.gates.find((gate) => gate.id === item.gateId);
          return `| ${item.approvedAt} | ${gate?.name || item.gateId} | ${item.approvedByUserId} | ${item.approvalComment || "-"} |`;
        })
        .join("\n")
    : "| 无 | - | - | - |";

  return `# ${snapshot.project.name} 项目快照

项目状态：${snapshot.project.status}
当前阶段：${snapshot.currentPhase?.name || "-"}
当前阶段门：${snapshot.currentGate?.name || "-"} / ${snapshot.currentGate?.status || "-"}
导出时间：${snapshot.exportedAt}

## 汇总

- 阶段：${snapshot.summary.phaseCount}
- 工作包：${snapshot.summary.workPackageCount}
- 已批准工作包：${snapshot.summary.approvedWorkPackageCount}
- 逾期工作包：${snapshot.summary.overdueWorkPackageCount}
- 临期工作包：${snapshot.summary.dueSoonWorkPackageCount}
- 风险：${snapshot.summary.riskCount}
- 打开高风险：${snapshot.summary.openHighRiskCount}
- 证据引用：${snapshot.summary.evidenceRefCount}
- 批准包归档：${snapshot.summary.gateApprovalPackCount}
- 站内通知：${snapshot.summary.notificationCount}
- 审计事件：${snapshot.summary.auditEventCount}

## 阶段

| 序号 | 阶段 | 状态 |
|---|---|---|
${phaseRows}

## 工作包

| 阶段 | 工作包 | 交付物类型 | 状态 | 截止日期 | 计划状态 | 负责人 |
|---|---|---|---|---|---|---|
${workPackageRows}

## 风险

| 阶段 | 风险 | 严重度 | 状态 | 缓解状态 | 缓解负责人 | 缓解截止 | 缓解措施 | 缓解完成说明 | 处置说明 |
|---|---|---|---|---|---|---|---|---|---|
${riskRows}

## 最近证据引用

| 时间 | 工作包 | 标题 | 引用 |
|---|---|---|---|
${evidenceRefRows}

## 阶段门批准包

| 批准时间 | 阶段门 | 批准人 | 批准说明 |
|---|---|---|---|
${gateApprovalPackRows}

## 最近通知

| 时间 | 用户 | 状态 | 标题 |
|---|---|---|---|
${notificationRows}

## 最近审计

| 时间 | 事件 | 操作者 | 对象 |
|---|---|---|---|
${auditRows}
`;
}

function renderWorkPackageMarkdown(detail) {
  const latestArtifact = detail.artifacts.at(-1) || null;
  const latestAgentRun = detail.agentRuns.at(-1) || null;
  const validation = latestArtifact?.content?.validation || latestAgentRun?.validation || null;
  const reviewRows = detail.reviews.length
    ? detail.reviews
        .map(
          (review) =>
            `| ${review.reviewedAt} | ${review.reviewerUserId} | ${review.decision} | ${review.comment || "-"} | ${review.conditions?.length ? review.conditions.join("; ") : "-"} | ${review.conditionsCompletedAt ? "DONE" : review.conditions?.length ? "OPEN" : "-"} | ${review.conditionsCompletedByUserId || "-"} | ${review.conditionsCompletionComment || "-"} |`,
        )
        .join("\n")
    : "| 无 | - | - | - | - | - | - | - |";
  const evidenceRows = detail.evidenceRefs.length
    ? detail.evidenceRefs
        .map((item) => `| ${item.createdAt} | ${item.label} | ${item.ref} | ${item.createdByUserId} |`)
        .join("\n")
    : "| 无 | - | - | - |";
  const activityRows = detail.auditEvents.length
    ? detail.auditEvents
        .map((event) => `| ${event.createdAt} | ${event.eventType} | ${event.actorType}:${event.actorId} | ${JSON.stringify(event.payload || {})} |`)
        .join("\n")
    : "| 无 | - | - | - |";
  const missingSections = validation?.missingSections?.length ? validation.missingSections.join("、") : "无";
  const emptySections = validation?.emptySections?.length ? validation.emptySections.join("、") : "无";
  const draft = latestArtifact?.content?.draftMarkdown || latestArtifact?.content?.summary || "暂无草稿。";

  return `# ${detail.workPackage.title} 工作包

项目 ID：${detail.workPackage.projectId}
工作包 ID：${detail.workPackage.id}
状态：${detail.workPackage.status}
交付物类型：${detail.workPackage.requiredArtifactType}
交付物模板：${detail.workPackage.artifactTemplateKey || "-"}
截止日期：${detail.workPackage.dueAt || "-"}
计划状态：${detail.scheduleStatus || "-"}
负责人：${detail.rolePair?.humanUserId || "-"}
Agent：${detail.rolePair?.agentKey || "-"}

## 最新交付物

- 交付物 ID：${latestArtifact?.id || "-"}
- 状态：${latestArtifact?.status || "-"}
- 版本：${latestArtifact?.version || "-"}
- 创建者：${latestArtifact?.createdByActor || "-"}

## 模板校验

- 状态：${validation?.status || "未校验"}
- 缺失项：${missingSections}
- 空内容项：${emptySections}

## 审核记录

| 时间 | 审核人 | 决定 | 备注 | 批准条件 | 条款状态 | 条款完成人 | 条款完成说明 |
|---|---|---|---|---|---|---|---|
${reviewRows}

## 证据引用

| 时间 | 标题 | 引用 | 添加人 |
|---|---|---|---|
${evidenceRows}

## 活动记录

| 时间 | 事件 | 操作者 | 详情 |
|---|---|---|---|
${activityRows}

## Agent 输出草稿

${draft}
`;
}

function renderRiskRegisterMarkdown(register) {
  const riskRows = register.risks.length
    ? register.risks
        .map(
          (risk) =>
            `| ${risk.phaseName} | ${risk.title} | ${risk.severity} | ${risk.status} | ${risk.blocksGate ? "是" : "否"} | ${risk.mitigationStatus || "-"} | ${risk.mitigationOwnerUserId || "-"} | ${risk.mitigationDueAt || "-"} | ${risk.mitigation || "-"} | ${risk.mitigationCompletionComment || "-"} | ${risk.decisionUserId || "-"} | ${risk.decisionComment || "-"} |`,
        )
        .join("\n")
    : "| 无 | - | - | - | - | - | - | - | - | - | - | - |";

  return `# ${register.project.name} 风险台账

导出时间：${register.exportedAt}
项目 ID：${register.project.id}

## 汇总

- 风险总数：${register.summary.totalRiskCount}
- 打开风险：${register.summary.openRiskCount}
- 阻塞阶段门风险：${register.summary.openBlockingRiskCount}
- 已接受风险：${register.summary.acceptedRiskCount}
- 已关闭风险：${register.summary.closedRiskCount}

## 风险明细

| 阶段 | 风险 | 严重度 | 状态 | 阻塞阶段门 | 缓解状态 | 缓解负责人 | 缓解截止 | 缓解措施 | 缓解完成说明 | 处置人 | 处置说明 |
|---|---|---|---|---|---|---|---|---|---|---|---|
${riskRows}
`;
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    const parseError = new Error("请求体不是合法 JSON");
    parseError.statusCode = 400;
    parseError.details = error instanceof Error ? error.message : String(error);
    throw parseError;
  }
}

function audit(eventType, actorType, actorId, objectType, objectId, payload = {}) {
  store.auditEvents.push({
    id: randomUUID(),
    projectId: currentProject()?.id || null,
    eventType,
    actorType,
    actorId,
    objectType,
    objectId,
    payload,
    createdAt: new Date().toISOString(),
  });
}

function notifyUser(userId, notification) {
  if (!userId || !findUser(userId)) {
    return null;
  }

  const item = {
    id: randomUUID(),
    projectId: notification.projectId || currentProject()?.id || null,
    userId,
    title: notification.title,
    message: notification.message || "",
    type: notification.type || "INFO",
    status: "UNREAD",
    objectType: notification.objectType || null,
    objectId: notification.objectId || null,
    createdAt: new Date().toISOString(),
  };
  store.notifications.push(item);
  return item;
}

function notifyRole(roleName, notification) {
  return getDemoUsers()
    .filter((user) => user.roles.includes(roleName))
    .map((user) => notifyUser(user.userId, notification))
    .filter(Boolean);
}

function currentProject() {
  return store.projects.find((project) => project.id === store.activeProjectId) || store.projects[0];
}

function currentGate() {
  return store.gates.find((gate) => gate.phaseId === currentProject().currentPhaseId) || null;
}

function currentGateCheck() {
  const gate = currentGate();
  return gate ? checkGate(gate.id) : null;
}

export function checkGate(gateId) {
  const gate = store.gates.find((item) => item.id === gateId);
  if (!gate) {
    return null;
  }

  if (gate.status === "APPROVED") {
    return {
      gateId,
      status: "APPROVED",
      blockers: [],
    };
  }

  const blockers = [];
  const requirements = store.gateRequirements.filter((item) => item.gateId === gateId);

  for (const requirement of requirements) {
    const workPackage = store.workPackages.find(
      (item) =>
        item.phaseId === gate.phaseId &&
        item.title === requirement.requiredWorkPackageTitle &&
        item.requiredArtifactType === requirement.requiredArtifactType,
    );

    if (!workPackage) {
      blockers.push({
        code: "MISSING_WORK_PACKAGE",
        message: `缺少必需工作包：${requirement.requiredWorkPackageTitle}`,
      });
      continue;
    }

    const approvedArtifact = store.artifactVersions.find(
      (item) =>
        item.workPackageId === workPackage.id &&
        item.artifactType === requirement.requiredArtifactType &&
        (item.status === "APPROVED" || item.status === "LOCKED"),
    );

    if (!approvedArtifact) {
      blockers.push({
        code: "MISSING_ARTIFACT",
        message: `交付物尚未被人类批准：${requirement.requiredArtifactType}`,
        relatedObjectId: workPackage.id,
      });
    }

    const approvedReview = store.reviews.find(
      (item) =>
        item.workPackageId === workPackage.id &&
        (item.decision === "APPROVE" || item.decision === "APPROVE_WITH_CONDITIONS"),
    );

    if (!approvedReview) {
      blockers.push({
        code: "REVIEW_NOT_APPROVED",
        message: `工作包尚未通过人类审核：${workPackage.title}`,
        relatedObjectId: workPackage.id,
      });
    }
  }

  for (const risk of store.risks) {
    const blocksGate =
      risk.phaseId === gate.phaseId &&
      (risk.severity === "HIGH" || risk.severity === "CRITICAL") &&
      risk.status !== "CLOSED" &&
      risk.status !== "ACCEPTED";

    if (blocksGate) {
      blockers.push({
        code: "OPEN_HIGH_RISK",
        message: `高风险未关闭或未被人类接受：${risk.title}`,
        relatedObjectId: risk.id,
      });
    }
  }

  for (const finding of store.agentFindings) {
    const workPackage = store.workPackages.find((item) => item.id === finding.workPackageId);
    const blocksGate =
      workPackage?.phaseId === gate.phaseId &&
      (finding.severity === "HIGH" || finding.severity === "CRITICAL") &&
      finding.status === "OPEN";

    if (blocksGate) {
      blockers.push({
        code: "UNRESOLVED_AGENT_FINDING",
        message: `Agent 高风险发现尚未处理：${finding.message}`,
        relatedObjectId: finding.id,
      });
    }
  }

  const status = blockers.length > 0 ? "BLOCKED" : "READY";
  gate.status = status === "READY" ? "GATE_READY" : "GATE_BLOCKED";
  const phase = store.phases.find((item) => item.id === gate.phaseId);
  if (phase) {
    phase.status = gate.status;
  }
  persistStore();

  return {
    gateId,
    status,
    blockers,
  };
}

export function getActiveProjectView() {
  const project = currentProject();
  const gate = currentGate();
  const phaseIds = new Set(store.phases.filter((item) => item.projectId === project.id).map((item) => item.id));
  const workPackageIds = new Set(store.workPackages.filter((item) => item.projectId === project.id).map((item) => item.id));
  const workPackages = store.workPackages.filter((item) => item.projectId === project.id);
  return {
    project,
    projects: store.projects,
    projectSummaries: store.projects.map((item) => ({
      ...item,
      currentPhaseName: store.phases.find((phase) => phase.id === item.currentPhaseId)?.name || item.currentPhaseId,
    })),
    activeProjectId: store.activeProjectId,
    phases: store.phases.filter((item) => item.projectId === project.id),
    gates: store.gates.filter((item) => item.projectId === project.id),
    rolePairs: store.rolePairs.filter((item) => item.projectId === project.id),
    workPackages: workPackages.map((item) => ({
      ...item,
      scheduleStatus: workPackageScheduleStatus(item),
    })),
    artifactVersions: store.artifactVersions.filter((item) => workPackageIds.has(item.workPackageId)),
    reviews: store.reviews.filter((item) => workPackageIds.has(item.workPackageId)),
    evidenceRefs: (store.evidenceRefs || []).filter((item) => workPackageIds.has(item.workPackageId)),
    gateApprovalPacks: (store.gateApprovalPacks || []).filter((item) => item.projectId === project.id),
    risks: store.risks.filter((item) => item.projectId === project.id && phaseIds.has(item.phaseId)),
    agentRuns: store.agentRuns.filter((item) => workPackageIds.has(item.workPackageId)),
    agentFindings: store.agentFindings.filter((item) => workPackageIds.has(item.workPackageId)),
    auditEvents: store.auditEvents.filter((event) => !event.projectId || event.projectId === project.id),
    latestGateCheck: gate ? checkGate(gate.id) : null,
    scheduleSummary: {
      overdueWorkPackageCount: workPackages.filter((item) => workPackageScheduleStatus(item) === "OVERDUE").length,
      dueSoonWorkPackageCount: workPackages.filter((item) => workPackageScheduleStatus(item) === "DUE_SOON").length,
      unscheduledWorkPackageCount: workPackages.filter((item) => workPackageScheduleStatus(item) === "UNSCHEDULED").length,
    },
  };
}

export function getDemoProject() {
  return getActiveProjectView();
}

export function getProjectSnapshot(projectId) {
  const project = store.projects.find((item) => item.id === projectId);
  if (!project) {
    return null;
  }

  const phaseIds = new Set(store.phases.filter((item) => item.projectId === project.id).map((item) => item.id));
  const phases = store.phases.filter((item) => item.projectId === project.id).sort((a, b) => a.sequence - b.sequence);
  const gates = store.gates.filter((item) => item.projectId === project.id);
  const gateIds = new Set(gates.map((item) => item.id));
  const rolePairs = store.rolePairs.filter((item) => item.projectId === project.id);
  const workPackages = store.workPackages.filter((item) => item.projectId === project.id);
  const workPackageIds = new Set(workPackages.map((item) => item.id));
  const evidenceRefs = (store.evidenceRefs || []).filter((item) => workPackageIds.has(item.workPackageId));
  const gateApprovalPacks = (store.gateApprovalPacks || []).filter((item) => item.projectId === project.id);
  const risks = store.risks.filter((item) => item.projectId === project.id && phaseIds.has(item.phaseId));
  const currentPhase = phases.find((item) => item.id === project.currentPhaseId) || null;
  const currentGate = currentPhase ? gates.find((item) => item.phaseId === currentPhase.id) || null : null;
  const auditEvents = store.auditEvents.filter((event) => !event.projectId || event.projectId === project.id);
  const notifications = (store.notifications || []).filter((item) => item.projectId === project.id);

  return {
    exportedAt: new Date().toISOString(),
    project,
    currentPhase,
    currentGate,
    summary: {
      phaseCount: phases.length,
      workPackageCount: workPackages.length,
      approvedWorkPackageCount: workPackages.filter((item) => item.status === "HUMAN_APPROVED" || item.status === "LOCKED").length,
      overdueWorkPackageCount: workPackages.filter((item) => workPackageScheduleStatus(item) === "OVERDUE").length,
      dueSoonWorkPackageCount: workPackages.filter((item) => workPackageScheduleStatus(item) === "DUE_SOON").length,
      riskCount: risks.length,
      openHighRiskCount: risks.filter(
        (risk) =>
          (risk.severity === "HIGH" || risk.severity === "CRITICAL") &&
          risk.status !== "CLOSED" &&
          risk.status !== "ACCEPTED",
      ).length,
      evidenceRefCount: evidenceRefs.length,
      gateApprovalPackCount: gateApprovalPacks.length,
      notificationCount: notifications.length,
      auditEventCount: auditEvents.length,
    },
    phases,
    gates,
    gateRequirements: store.gateRequirements.filter((item) => gateIds.has(item.gateId)),
    rolePairs,
    workPackages: workPackages.map((workPackage) => {
      const rolePair = rolePairs.find((item) => item.id === workPackage.rolePairId) || null;
      return {
        ...workPackage,
        phaseName: phases.find((phase) => phase.id === workPackage.phaseId)?.name || workPackage.phaseId,
        ownerUserId: rolePair?.humanUserId || null,
        agentKey: rolePair?.agentKey || null,
        scheduleStatus: workPackageScheduleStatus(workPackage),
      };
    }),
    artifactVersions: store.artifactVersions.filter((item) => workPackageIds.has(item.workPackageId)),
    reviews: store.reviews.filter((item) => workPackageIds.has(item.workPackageId)),
    evidenceRefs,
    gateApprovalPacks,
    risks: risks.map((risk) => ({
      ...risk,
      phaseName: phases.find((phase) => phase.id === risk.phaseId)?.name || risk.phaseId,
    })),
    agentRuns: store.agentRuns.filter((item) => workPackageIds.has(item.workPackageId)),
    agentFindings: store.agentFindings.filter((item) => workPackageIds.has(item.workPackageId)),
    notifications,
    auditEvents,
  };
}

export function getProjectRiskRegister(projectId) {
  const project = store.projects.find((item) => item.id === projectId);
  if (!project) {
    return null;
  }

  const phases = store.phases.filter((item) => item.projectId === project.id);
  const phaseIds = new Set(phases.map((item) => item.id));
  const risks = store.risks
    .filter((item) => item.projectId === project.id && phaseIds.has(item.phaseId))
    .map((risk) => ({
      ...risk,
      phaseName: phases.find((phase) => phase.id === risk.phaseId)?.name || risk.phaseId,
      decisionUserId: risk.closedByUserId || risk.acceptedByUserId || null,
      decisionComment: risk.closedComment || risk.acceptedComment || "",
      blocksGate:
        (risk.severity === "HIGH" || risk.severity === "CRITICAL") &&
        risk.status !== "CLOSED" &&
        risk.status !== "ACCEPTED",
    }))
    .sort((a, b) => {
      const phaseA = phases.find((phase) => phase.id === a.phaseId)?.sequence || 0;
      const phaseB = phases.find((phase) => phase.id === b.phaseId)?.sequence || 0;
      return phaseA - phaseB || a.title.localeCompare(b.title);
    });

  return {
    exportedAt: new Date().toISOString(),
    project,
    summary: {
      totalRiskCount: risks.length,
      openRiskCount: risks.filter((risk) => risk.status === "OPEN").length,
      openBlockingRiskCount: risks.filter((risk) => risk.blocksGate).length,
      acceptedRiskCount: risks.filter((risk) => risk.status === "ACCEPTED").length,
      closedRiskCount: risks.filter((risk) => risk.status === "CLOSED").length,
    },
    risks,
  };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function pushIfMissing(errors, condition, message, details = {}) {
  if (!condition) {
    errors.push({ message, ...details });
  }
}

export function validateProjectSnapshotImport(input = {}) {
  const snapshot = input.snapshot || input;
  const errors = [];
  const warnings = [];

  if (!snapshot || typeof snapshot !== "object") {
    return {
      valid: false,
      canImport: false,
      errors: [{ message: "快照必须是对象" }],
      warnings,
      summary: null,
    };
  }

  const project = snapshot.project || null;
  pushIfMissing(errors, project && typeof project === "object", "快照缺少 project 对象");
  pushIfMissing(errors, Boolean(project?.id), "project.id 不能为空");
  pushIfMissing(errors, Boolean(project?.name), "project.name 不能为空");
  pushIfMissing(errors, Boolean(project?.currentPhaseId), "project.currentPhaseId 不能为空");

  const phases = asArray(snapshot.phases);
  const gates = asArray(snapshot.gates);
  const rolePairs = asArray(snapshot.rolePairs);
  const workPackages = asArray(snapshot.workPackages);
  const gateRequirements = asArray(snapshot.gateRequirements);
  const artifactVersions = asArray(snapshot.artifactVersions);
  const reviews = asArray(snapshot.reviews);
  const evidenceRefs = asArray(snapshot.evidenceRefs);
  const gateApprovalPacks = asArray(snapshot.gateApprovalPacks);
  const risks = asArray(snapshot.risks);
  const agentRuns = asArray(snapshot.agentRuns);
  const agentFindings = asArray(snapshot.agentFindings);
  const notifications = asArray(snapshot.notifications);
  const auditEvents = asArray(snapshot.auditEvents);

  pushIfMissing(errors, Array.isArray(snapshot.phases), "phases 必须是数组");
  pushIfMissing(errors, Array.isArray(snapshot.gates), "gates 必须是数组");
  pushIfMissing(errors, Array.isArray(snapshot.rolePairs), "rolePairs 必须是数组");
  pushIfMissing(errors, Array.isArray(snapshot.workPackages), "workPackages 必须是数组");

  if (project?.id && store.projects.some((item) => item.id === project.id)) {
    errors.push({
      message: "项目 ID 已存在，不能直接导入",
      projectId: project.id,
    });
  }

  const phaseIds = new Set(phases.map((item) => item.id));
  const gateIds = new Set(gates.map((item) => item.id));
  const rolePairIds = new Set(rolePairs.map((item) => item.id));
  const workPackageIds = new Set(workPackages.map((item) => item.id));

  if (project?.currentPhaseId) {
    pushIfMissing(errors, phaseIds.has(project.currentPhaseId), "project.currentPhaseId 未指向快照内阶段", {
      currentPhaseId: project.currentPhaseId,
    });
  }

  for (const phase of phases) {
    pushIfMissing(errors, phase.projectId === project?.id, "阶段 projectId 与项目不一致", {
      phaseId: phase.id,
      projectId: phase.projectId,
    });
  }

  for (const gate of gates) {
    pushIfMissing(errors, gate.projectId === project?.id, "阶段门 projectId 与项目不一致", {
      gateId: gate.id,
      projectId: gate.projectId,
    });
    pushIfMissing(errors, phaseIds.has(gate.phaseId), "阶段门 phaseId 未指向快照内阶段", {
      gateId: gate.id,
      phaseId: gate.phaseId,
    });
  }

  for (const rolePair of rolePairs) {
    pushIfMissing(errors, rolePair.projectId === project?.id, "角色配对 projectId 与项目不一致", {
      rolePairId: rolePair.id,
      projectId: rolePair.projectId,
    });
    if (rolePair.humanUserId && !findUser(rolePair.humanUserId)) {
      warnings.push({
        message: "角色负责人不在当前演示用户列表中，导入后可能无法审批",
        rolePairId: rolePair.id,
        humanUserId: rolePair.humanUserId,
      });
    }
  }

  for (const workPackage of workPackages) {
    pushIfMissing(errors, workPackage.projectId === project?.id, "工作包 projectId 与项目不一致", {
      workPackageId: workPackage.id,
      projectId: workPackage.projectId,
    });
    pushIfMissing(errors, phaseIds.has(workPackage.phaseId), "工作包 phaseId 未指向快照内阶段", {
      workPackageId: workPackage.id,
      phaseId: workPackage.phaseId,
    });
    pushIfMissing(errors, rolePairIds.has(workPackage.rolePairId), "工作包 rolePairId 未指向快照内角色配对", {
      workPackageId: workPackage.id,
      rolePairId: workPackage.rolePairId,
    });
  }

  for (const requirement of gateRequirements) {
    pushIfMissing(errors, gateIds.has(requirement.gateId), "阶段门条件 gateId 未指向快照内阶段门", {
      requirementId: requirement.id,
      gateId: requirement.gateId,
    });
  }

  for (const artifact of artifactVersions) {
    pushIfMissing(errors, workPackageIds.has(artifact.workPackageId), "交付物 workPackageId 未指向快照内工作包", {
      artifactId: artifact.id,
      workPackageId: artifact.workPackageId,
    });
  }

  for (const review of reviews) {
    pushIfMissing(errors, workPackageIds.has(review.workPackageId), "审核记录 workPackageId 未指向快照内工作包", {
      reviewId: review.id,
      workPackageId: review.workPackageId,
    });
  }

  for (const evidenceRef of evidenceRefs) {
    pushIfMissing(errors, evidenceRef.projectId === project?.id, "证据引用 projectId 与项目不一致", {
      evidenceRefId: evidenceRef.id,
      projectId: evidenceRef.projectId,
    });
    pushIfMissing(errors, workPackageIds.has(evidenceRef.workPackageId), "证据引用 workPackageId 未指向快照内工作包", {
      evidenceRefId: evidenceRef.id,
      workPackageId: evidenceRef.workPackageId,
    });
  }

  for (const approvalPack of gateApprovalPacks) {
    pushIfMissing(errors, approvalPack.projectId === project?.id, "阶段门批准包 projectId 与项目不一致", {
      approvalPackId: approvalPack.id,
      projectId: approvalPack.projectId,
    });
    pushIfMissing(errors, gateIds.has(approvalPack.gateId), "阶段门批准包 gateId 未指向快照内阶段门", {
      approvalPackId: approvalPack.id,
      gateId: approvalPack.gateId,
    });
    pushIfMissing(errors, phaseIds.has(approvalPack.phaseId), "阶段门批准包 phaseId 未指向快照内阶段", {
      approvalPackId: approvalPack.id,
      phaseId: approvalPack.phaseId,
    });
  }

  for (const risk of risks) {
    pushIfMissing(errors, risk.projectId === project?.id, "风险 projectId 与项目不一致", {
      riskId: risk.id,
      projectId: risk.projectId,
    });
    pushIfMissing(errors, phaseIds.has(risk.phaseId), "风险 phaseId 未指向快照内阶段", {
      riskId: risk.id,
      phaseId: risk.phaseId,
    });
    if (risk.mitigationOwnerUserId && !findUser(risk.mitigationOwnerUserId)) {
      warnings.push({
        message: "风险缓解负责人用户不存在，导入后仍会保留原始负责人 ID",
        riskId: risk.id,
        mitigationOwnerUserId: risk.mitigationOwnerUserId,
      });
    }
  }

  for (const agentRun of agentRuns) {
    pushIfMissing(errors, workPackageIds.has(agentRun.workPackageId), "Agent run workPackageId 未指向快照内工作包", {
      agentRunId: agentRun.id,
      workPackageId: agentRun.workPackageId,
    });
  }

  for (const finding of agentFindings) {
    pushIfMissing(errors, workPackageIds.has(finding.workPackageId), "Agent 发现 workPackageId 未指向快照内工作包", {
      findingId: finding.id,
      workPackageId: finding.workPackageId,
    });
  }

  for (const notification of notifications) {
    pushIfMissing(errors, notification.projectId === project?.id, "通知 projectId 与项目不一致", {
      notificationId: notification.id,
      projectId: notification.projectId,
    });
    if (notification.userId && !findUser(notification.userId)) {
      warnings.push({
        message: "通知接收人不在当前演示用户列表中",
        notificationId: notification.id,
        userId: notification.userId,
      });
    }
  }

  return {
    valid: errors.length === 0,
    canImport: errors.length === 0,
    errors,
    warnings,
    summary: {
      projectId: project?.id || null,
      projectName: project?.name || null,
      phaseCount: phases.length,
      gateCount: gates.length,
      rolePairCount: rolePairs.length,
      workPackageCount: workPackages.length,
      gateRequirementCount: gateRequirements.length,
      artifactVersionCount: artifactVersions.length,
      reviewCount: reviews.length,
      evidenceRefCount: evidenceRefs.length,
      gateApprovalPackCount: gateApprovalPacks.length,
      riskCount: risks.length,
      agentRunCount: agentRuns.length,
      agentFindingCount: agentFindings.length,
      notificationCount: notifications.length,
      auditEventCount: auditEvents.length,
    },
  };
}

export function importProjectSnapshot(input = {}) {
  const snapshot = input.snapshot || input;
  const validation = validateProjectSnapshotImport(snapshot);
  if (!validation.valid) {
    return {
      statusCode: 422,
      body: validation,
    };
  }

  const project = { ...snapshot.project };
  const phases = asArray(snapshot.phases).map((item) => ({ ...item }));
  const gates = asArray(snapshot.gates).map((item) => ({ ...item }));
  const rolePairs = asArray(snapshot.rolePairs).map((item) => ({ ...item }));
  const gateRequirements = asArray(snapshot.gateRequirements).map((item) => ({ ...item }));
  const workPackages = asArray(snapshot.workPackages).map(({ phaseName, ownerUserId, agentKey, ...item }) => ({ ...item }));
  const artifactVersions = asArray(snapshot.artifactVersions).map((item) => ({ ...item }));
  const reviews = asArray(snapshot.reviews).map((item) => ({ ...item }));
  const evidenceRefs = asArray(snapshot.evidenceRefs).map((item) => ({ ...item }));
  const gateApprovalPacks = asArray(snapshot.gateApprovalPacks).map((item) => ({ ...item }));
  const risks = asArray(snapshot.risks).map(({ phaseName, ...item }) => ({ ...item }));
  const agentRuns = asArray(snapshot.agentRuns).map((item) => ({ ...item }));
  const agentFindings = asArray(snapshot.agentFindings).map((item) => ({ ...item }));
  const notifications = asArray(snapshot.notifications).map((item) => ({ ...item }));
  const auditEvents = asArray(snapshot.auditEvents).map((item) => ({
    ...item,
    id: `imported-${item.id}`,
    projectId: project.id,
  }));

  store.projects.push(project);
  store.phases.push(...phases);
  store.gates.push(...gates);
  store.rolePairs.push(...rolePairs);
  store.gateRequirements.push(...gateRequirements);
  store.workPackages.push(...workPackages);
  store.artifactVersions.push(...artifactVersions);
  store.reviews.push(...reviews);
  store.evidenceRefs.push(...evidenceRefs);
  store.gateApprovalPacks.push(...gateApprovalPacks);
  store.risks.push(...risks);
  store.agentRuns.push(...agentRuns);
  store.agentFindings.push(...agentFindings);
  store.notifications.push(...notifications);
  store.auditEvents.push(...auditEvents);
  store.activeProjectId = project.id;

  audit(input.importEventType || "PROJECT_IMPORTED", "human", input.actorUserId || "user-project-manager", "project", project.id, {
    sourceExportedAt: snapshot.exportedAt || null,
    ...(input.importPayload || {}),
    importedCounts: validation.summary,
  });
  persistStore();

  return {
    statusCode: 201,
    body: {
      validation,
      project: getActiveProjectView(),
    },
  };
}

function uniqueProjectIdFromName(name) {
  let baseId = `project-${slugifyProjectName(name)}`;
  if (store.projects.some((project) => project.id === baseId)) {
    baseId = `${baseId}-${Date.now()}`;
  }
  return baseId;
}

function remapSnapshotForProjectCopy(snapshot, projectId, name) {
  const copy = structuredClone(snapshot);
  const phaseIdMap = new Map();
  const gateIdMap = new Map();
  const rolePairIdMap = new Map();
  const workPackageIdMap = new Map();

  copy.project = {
    ...copy.project,
    id: projectId,
    name,
    createdAt: new Date().toISOString(),
    clonedFromProjectId: snapshot.project.id,
  };

  copy.phases = asArray(copy.phases).map((phase) => {
    const id = `${projectId}-${phase.id}`;
    phaseIdMap.set(phase.id, id);
    return { ...phase, id, projectId };
  });
  copy.project.currentPhaseId = phaseIdMap.get(snapshot.project.currentPhaseId) || copy.project.currentPhaseId;

  copy.gates = asArray(copy.gates).map((gate) => {
    const id = `${projectId}-${gate.id}`;
    gateIdMap.set(gate.id, id);
    return {
      ...gate,
      id,
      projectId,
      phaseId: phaseIdMap.get(gate.phaseId),
    };
  });

  copy.rolePairs = asArray(copy.rolePairs).map((rolePair) => {
    const id = `${projectId}-${rolePair.id}`;
    rolePairIdMap.set(rolePair.id, id);
    return { ...rolePair, id, projectId };
  });

  copy.workPackages = asArray(copy.workPackages).map(({ phaseName, ownerUserId, agentKey, ...workPackage }) => {
    const id = `${projectId}-${workPackage.id}`;
    workPackageIdMap.set(workPackage.id, id);
    return {
      ...workPackage,
      id,
      projectId,
      phaseId: phaseIdMap.get(workPackage.phaseId),
      rolePairId: rolePairIdMap.get(workPackage.rolePairId),
    };
  });

  copy.gateRequirements = asArray(copy.gateRequirements).map((requirement) => ({
    ...requirement,
    id: `${projectId}-${requirement.id}`,
    gateId: gateIdMap.get(requirement.gateId),
  }));

  copy.artifactVersions = asArray(copy.artifactVersions).map((artifact) => ({
    ...artifact,
    id: `${projectId}-${artifact.id}`,
    workPackageId: workPackageIdMap.get(artifact.workPackageId),
  }));

  copy.reviews = asArray(copy.reviews).map((review) => ({
    ...review,
    id: `${projectId}-${review.id}`,
    workPackageId: workPackageIdMap.get(review.workPackageId),
  }));

  copy.evidenceRefs = asArray(copy.evidenceRefs).map((evidenceRef) => ({
    ...evidenceRef,
    id: `${projectId}-${evidenceRef.id}`,
    projectId,
    workPackageId: workPackageIdMap.get(evidenceRef.workPackageId),
  }));

  copy.gateApprovalPacks = asArray(copy.gateApprovalPacks).map((approvalPack) => ({
    ...approvalPack,
    id: `${projectId}-${approvalPack.id}`,
    projectId,
    gateId: gateIdMap.get(approvalPack.gateId),
    phaseId: phaseIdMap.get(approvalPack.phaseId),
    reviewPack: remapGateReviewPackForProjectCopy(approvalPack.reviewPack, {
      projectId,
      phaseIdMap,
      gateIdMap,
      workPackageIdMap,
    }),
  }));

  copy.risks = asArray(copy.risks).map(({ phaseName, ...risk }) => ({
    ...risk,
    id: `${projectId}-${risk.id}`,
    projectId,
    phaseId: phaseIdMap.get(risk.phaseId),
  }));

  copy.agentRuns = asArray(copy.agentRuns).map((run) => ({
    ...run,
    id: `${projectId}-${run.id}`,
    workPackageId: workPackageIdMap.get(run.workPackageId),
  }));

  copy.agentFindings = asArray(copy.agentFindings).map((finding) => ({
    ...finding,
    id: `${projectId}-${finding.id}`,
    workPackageId: workPackageIdMap.get(finding.workPackageId),
  }));

  copy.notifications = asArray(copy.notifications).map((notification) => ({
    ...notification,
    id: `${projectId}-${notification.id}`,
    projectId,
    objectId:
      notification.objectType === "workPackage"
        ? workPackageIdMap.get(notification.objectId)
        : notification.objectType === "risk"
          ? `${projectId}-${notification.objectId}`
          : notification.objectType === "gate"
            ? gateIdMap.get(notification.objectId)
            : notification.objectId,
  }));

  copy.auditEvents = asArray(copy.auditEvents).map((event) => ({
    ...event,
    id: `${projectId}-${event.id}`,
    projectId,
  }));

  return copy;
}

function remapGateReviewPackForProjectCopy(reviewPack, maps) {
  if (!reviewPack) {
    return reviewPack;
  }

  return {
    ...reviewPack,
    project: reviewPack.project ? { ...reviewPack.project, id: maps.projectId } : reviewPack.project,
    phase: reviewPack.phase
      ? {
          ...reviewPack.phase,
          id: maps.phaseIdMap.get(reviewPack.phase.id) || reviewPack.phase.id,
        }
      : reviewPack.phase,
    gate: reviewPack.gate
      ? {
          ...reviewPack.gate,
          id: maps.gateIdMap.get(reviewPack.gate.id) || reviewPack.gate.id,
        }
      : reviewPack.gate,
    readiness: reviewPack.readiness
      ? {
          ...reviewPack.readiness,
          gateId: maps.gateIdMap.get(reviewPack.readiness.gateId) || reviewPack.readiness.gateId,
          blockers: asArray(reviewPack.readiness.blockers).map((blocker) => ({
            ...blocker,
            relatedObjectId: maps.workPackageIdMap.get(blocker.relatedObjectId) || blocker.relatedObjectId,
          })),
        }
      : reviewPack.readiness,
    evidence: asArray(reviewPack.evidence).map((item) => ({
      ...item,
      workPackageId: maps.workPackageIdMap.get(item.workPackageId) || item.workPackageId,
      manualEvidenceRefs: asArray(item.manualEvidenceRefs).map((evidenceRef) => ({
        ...evidenceRef,
        id: `${maps.projectId}-${evidenceRef.id}`,
        projectId: maps.projectId,
        workPackageId: maps.workPackageIdMap.get(evidenceRef.workPackageId) || evidenceRef.workPackageId,
      })),
    })),
    blockers: asArray(reviewPack.blockers).map((blocker) => ({
      ...blocker,
      relatedObjectId: maps.workPackageIdMap.get(blocker.relatedObjectId) || blocker.relatedObjectId,
    })),
  };
}

export function cloneProject(projectId, body = {}) {
  const snapshot = getProjectSnapshot(projectId);
  if (!snapshot) {
    return {
      statusCode: 404,
      body: { error: "项目不存在" },
    };
  }

  const name = body.name?.trim() || `${snapshot.project.name} 副本`;
  const newProjectId = uniqueProjectIdFromName(name);
  const copy = remapSnapshotForProjectCopy(snapshot, newProjectId, name);

  return importProjectSnapshot({
    ...copy,
    actorUserId: body.userId || "user-project-manager",
    importEventType: "PROJECT_CLONED",
    importPayload: {
      sourceProjectId: projectId,
    },
  });
}

function slugifyProjectName(name) {
  const ascii = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii || `project-${Date.now()}`;
}

export function createProject(body = {}) {
  const name = body.name?.trim();
  if (!name) {
    return {
      statusCode: 400,
      body: { error: "项目名称不能为空" },
    };
  }

  const baseId = uniqueProjectIdFromName(name);

  const activePhaseKey = body.activePhaseKey || "initiation";
  const phaseDefinition = getHardwarePhaseTemplate().phases.find((phase) => phase.phaseKey === activePhaseKey);
  if (!phaseDefinition) {
    return validationError("activePhaseKey 不存在于硬件阶段模板", {
      activePhaseKey,
      allowedPhaseKeys: getHardwarePhaseTemplate().phases.map((phase) => phase.phaseKey),
    });
  }

  const project = {
    id: baseId,
    name,
    productLine: body.productLine || "",
    currentPhaseId: `${baseId}-phase-${activePhaseKey}`,
    status: "IN_PROGRESS",
    createdAt: new Date().toISOString(),
  };
  const generated = buildProjectFromTemplate(project, activePhaseKey);
  store.projects.push(project);
  store.phases.push(...generated.phases);
  store.gates.push(...generated.gates);
  store.rolePairs.push(...generated.rolePairs);
  store.gateRequirements.push(...generated.gateRequirements);
  store.workPackages.push(...generated.workPackages);
  store.activeProjectId = project.id;

  audit("PROJECT_CREATED", "human", body.userId || "user-project-manager", "project", project.id, {
    templateKey: "standard_hardware_development_v0_1",
  });
  persistStore();

  return {
    statusCode: 201,
    body: getActiveProjectView(),
  };
}

export function selectProject(projectId) {
  const project = store.projects.find((item) => item.id === projectId);
  if (!project) {
    return {
      statusCode: 404,
      body: { error: "项目不存在" },
    };
  }
  store.activeProjectId = project.id;
  persistStore();
  return {
    statusCode: 200,
    body: getActiveProjectView(),
  };
}

export function archiveProject(projectId, body = {}) {
  const project = store.projects.find((item) => item.id === projectId);
  if (!project) {
    return {
      statusCode: 404,
      body: { error: "项目不存在" },
    };
  }
  if (project.status === "ARCHIVED") {
    return {
      statusCode: 409,
      body: { error: "项目已经归档", projectId: project.id },
    };
  }

  project.previousStatus = project.status;
  project.status = "ARCHIVED";
  project.archivedAt = new Date().toISOString();
  project.archivedByUserId = body.userId || body.actorUserId || "user-project-manager";

  if (store.activeProjectId === project.id) {
    const replacement = store.projects.find((item) => item.id !== project.id && item.status !== "ARCHIVED");
    if (replacement) {
      store.activeProjectId = replacement.id;
    }
  }

  audit("PROJECT_ARCHIVED", "human", project.archivedByUserId, "project", project.id, {
    previousStatus: project.previousStatus,
  });
  persistStore();

  return {
    statusCode: 200,
    body: getActiveProjectView(),
  };
}

export function restoreProject(projectId, body = {}) {
  const project = store.projects.find((item) => item.id === projectId);
  if (!project) {
    return {
      statusCode: 404,
      body: { error: "项目不存在" },
    };
  }
  if (project.status !== "ARCHIVED") {
    return {
      statusCode: 409,
      body: { error: "项目未归档，不能恢复", projectId: project.id },
    };
  }

  const restoredStatus = project.previousStatus || "IN_PROGRESS";
  project.status = restoredStatus;
  project.restoredAt = new Date().toISOString();
  project.restoredByUserId = body.userId || body.actorUserId || "user-project-manager";
  delete project.previousStatus;
  store.activeProjectId = project.id;

  audit("PROJECT_RESTORED", "human", project.restoredByUserId, "project", project.id, {
    restoredStatus,
  });
  persistStore();

  return {
    statusCode: 200,
    body: getActiveProjectView(),
  };
}

export function updateRolePair(rolePairId, body = {}) {
  const rolePair = store.rolePairs.find((item) => item.id === rolePairId);
  if (!rolePair) {
    return {
      statusCode: 404,
      body: { error: "角色配对不存在" },
    };
  }

  if (!body.humanUserId) {
    return {
      statusCode: 400,
      body: { error: "humanUserId 不能为空" },
    };
  }

  if (!findUser(body.humanUserId)) {
    return validationError("负责人用户不存在", {
      humanUserId: body.humanUserId,
    });
  }

  const previousHumanUserId = rolePair.humanUserId;
  if (previousHumanUserId === body.humanUserId) {
    return {
      statusCode: 200,
      body: {
        rolePair,
        unchanged: true,
        project: getActiveProjectView(),
      },
    };
  }

  rolePair.humanUserId = body.humanUserId;
  const actorUserId = body.actorUserId || "user-project-manager";
  const affectedWorkPackageCount = store.workPackages.filter((item) => item.rolePairId === rolePair.id).length;
  audit("ROLE_PAIR_UPDATED", "human", actorUserId, "rolePair", rolePair.id, {
    previousHumanUserId,
    humanUserId: body.humanUserId,
    affectedWorkPackageCount,
  });
  notifyUser(body.humanUserId, {
    projectId: rolePair.projectId,
    title: "角色负责人已指派给你",
    message: `${rolePair.humanRole || rolePair.roleKey} 已由 ${actorUserId} 指派给你，关联工作包 ${affectedWorkPackageCount} 个。`,
    type: "INFO",
    objectType: "rolePair",
    objectId: rolePair.id,
  });
  notifyUser(previousHumanUserId, {
    projectId: rolePair.projectId,
    title: "角色负责人已变更",
    message: `${rolePair.humanRole || rolePair.roleKey} 已转交给 ${body.humanUserId}。`,
    type: "INFO",
    objectType: "rolePair",
    objectId: rolePair.id,
  });
  notifyRole("项目经理", {
    projectId: rolePair.projectId,
    title: "角色负责人已更新",
    message: `${rolePair.humanRole || rolePair.roleKey} 负责人由 ${previousHumanUserId} 更新为 ${body.humanUserId}。`,
    type: "INFO",
    objectType: "rolePair",
    objectId: rolePair.id,
  });
  persistStore();

  return {
    statusCode: 200,
    body: {
      rolePair,
      project: getActiveProjectView(),
    },
  };
}

export function updateWorkPackageSchedule(workPackageId, body = {}) {
  const workPackage = store.workPackages.find((item) => item.id === workPackageId);
  if (!workPackage) {
    return { statusCode: 404, body: { error: "工作包不存在" } };
  }

  const dueAt = String(body.dueAt || "").trim();
  if (dueAt && !/^\d{4}-\d{2}-\d{2}$/.test(dueAt)) {
    return validationError("dueAt 必须是 YYYY-MM-DD 格式", {
      dueAt,
    });
  }

  workPackage.dueAt = dueAt || null;
  audit("WORK_PACKAGE_SCHEDULE_UPDATED", "human", body.actorUserId || "user-project-manager", "workPackage", workPackage.id, {
    dueAt: workPackage.dueAt,
    scheduleStatus: workPackageScheduleStatus(workPackage),
  });

  const rolePair = store.rolePairs.find((item) => item.id === workPackage.rolePairId) || null;
  notifyUser(rolePair?.humanUserId, {
    title: "工作包截止日期已更新",
    message: `${workPackage.title} 的截止日期更新为 ${workPackage.dueAt || "未设置"}。`,
    type: "INFO",
    objectType: "workPackage",
    objectId: workPackage.id,
  });
  persistStore();

  return {
    statusCode: 200,
    body: {
      workPackage: {
        ...workPackage,
        scheduleStatus: workPackageScheduleStatus(workPackage),
      },
      project: getActiveProjectView(),
    },
  };
}

export function addWorkPackageEvidenceRef(workPackageId, body = {}) {
  const workPackage = store.workPackages.find((item) => item.id === workPackageId);
  if (!workPackage) {
    return { statusCode: 404, body: { error: "工作包不存在" } };
  }

  const label = String(body.label || "").trim();
  const ref = String(body.ref || body.url || "").trim();
  if (!label) {
    return validationError("证据标题不能为空");
  }
  if (!ref) {
    return validationError("证据引用不能为空");
  }

  const evidenceRef = {
    id: `evidence-${randomUUID()}`,
    projectId: workPackage.projectId,
    workPackageId: workPackage.id,
    label,
    ref,
    createdByUserId: body.actorUserId || body.userId || "user-project-manager",
    createdAt: new Date().toISOString(),
  };
  store.evidenceRefs.push(evidenceRef);
  audit("WORK_PACKAGE_EVIDENCE_ADDED", "human", evidenceRef.createdByUserId, "workPackage", workPackage.id, {
    evidenceRefId: evidenceRef.id,
    label: evidenceRef.label,
    ref: evidenceRef.ref,
  });
  persistStore();

  return {
    statusCode: 201,
    body: {
      evidenceRef,
      workPackage: getWorkPackageDetail(workPackage.id),
      project: getActiveProjectView(),
    },
  };
}

export function getWorkPackageDetail(workPackageId) {
  const workPackage = store.workPackages.find((item) => item.id === workPackageId);
  if (!workPackage) {
    return null;
  }
  const reviews = store.reviews.filter((item) => item.workPackageId === workPackageId);
  const reviewIds = new Set(reviews.map((review) => review.id));

  return {
    workPackage,
    rolePair: store.rolePairs.find((item) => item.id === workPackage.rolePairId) || null,
    artifacts: store.artifactVersions.filter((item) => item.workPackageId === workPackageId),
    reviews,
    evidenceRefs: (store.evidenceRefs || []).filter((item) => item.workPackageId === workPackageId),
    agentRuns: store.agentRuns.filter((item) => item.workPackageId === workPackageId),
    auditEvents: store.auditEvents.filter(
      (event) =>
        (event.objectType === "workPackage" && event.objectId === workPackageId) ||
        (event.objectType === "review" && reviewIds.has(event.objectId)),
    ),
    scheduleStatus: workPackageScheduleStatus(workPackage),
  };
}

export function getWorkPackageMarkdown(workPackageId) {
  const detail = getWorkPackageDetail(workPackageId);
  return detail ? renderWorkPackageMarkdown(detail) : null;
}

export function getUserActionItems(userId) {
  const project = currentProject();
  const phaseIds = new Set(store.phases.filter((item) => item.projectId === project.id).map((item) => item.id));
  const workPackages = store.workPackages.filter((item) => item.projectId === project.id);
  const pendingReviews = [];
  const scheduleAlerts = [];
  const conditionalApprovals = [];

  for (const workPackage of workPackages) {
    const rolePair = store.rolePairs.find((item) => item.id === workPackage.rolePairId) || null;
    const scheduleStatus = workPackageScheduleStatus(workPackage);
    if (rolePair?.humanUserId === userId && (scheduleStatus === "OVERDUE" || scheduleStatus === "DUE_SOON")) {
      scheduleAlerts.push({
        type: "WORK_PACKAGE_SCHEDULE",
        workPackageId: workPackage.id,
        title: workPackage.title,
        phaseId: workPackage.phaseId,
        dueAt: workPackage.dueAt,
        scheduleStatus,
      });
    }

    if (rolePair?.humanUserId === userId) {
      const latestConditionalReview = [...store.reviews]
        .reverse()
        .find(
          (item) =>
            item.workPackageId === workPackage.id &&
            item.decision === "APPROVE_WITH_CONDITIONS" &&
            Array.isArray(item.conditions) &&
            item.conditions.length > 0 &&
            !item.conditionsCompletedAt,
        );
      if (latestConditionalReview) {
        conditionalApprovals.push({
          type: "CONDITIONAL_APPROVAL",
          workPackageId: workPackage.id,
          reviewId: latestConditionalReview.id,
          title: workPackage.title,
          phaseId: workPackage.phaseId,
          reviewerUserId: latestConditionalReview.reviewerUserId,
          reviewedAt: latestConditionalReview.reviewedAt,
          comment: latestConditionalReview.comment || "",
          conditions: latestConditionalReview.conditions,
          conditionsCompletedAt: latestConditionalReview.conditionsCompletedAt || null,
        });
      }
    }

    const pendingArtifact = [...store.artifactVersions]
      .reverse()
      .find((item) => item.workPackageId === workPackage.id && item.status === "PENDING_REVIEW");
    if (!pendingArtifact) {
      continue;
    }

    const artifactTemplate =
      (workPackage.artifactTemplateKey && loadArtifactTemplateByKey(workPackage.artifactTemplateKey)) ||
      loadArtifactTemplateByType(workPackage.requiredArtifactType);
    const reviewPermission = canReviewWorkPackage(userId, workPackage, rolePair, artifactTemplate);
    if (!reviewPermission.allowed) {
      continue;
    }

    pendingReviews.push({
      type: "WORK_PACKAGE_REVIEW",
      workPackageId: workPackage.id,
      title: workPackage.title,
      phaseId: workPackage.phaseId,
      artifactType: workPackage.requiredArtifactType,
      canApprove: canApproveWorkPackage(userId, rolePair).allowed,
    });
  }

  const riskPermission = canAcceptRisk(userId);
  const riskDecisions = riskPermission.allowed
    ? store.risks
        .filter(
          (risk) =>
            risk.projectId === project.id &&
            phaseIds.has(risk.phaseId) &&
            (risk.severity === "HIGH" || risk.severity === "CRITICAL") &&
            risk.status === "OPEN",
        )
        .map((risk) => ({
          type: "RISK_DECISION",
          riskId: risk.id,
          title: risk.title,
          phaseId: risk.phaseId,
          severity: risk.severity,
        }))
    : [];
  const riskMitigations = store.risks
    .filter(
      (risk) =>
        risk.projectId === project.id &&
        phaseIds.has(risk.phaseId) &&
        risk.mitigationOwnerUserId === userId &&
        risk.status !== "CLOSED" &&
        risk.mitigationStatus !== "DONE",
    )
    .map((risk) => ({
      type: "RISK_MITIGATION",
      riskId: risk.id,
      title: risk.title,
      phaseId: risk.phaseId,
      severity: risk.severity,
      riskStatus: risk.status,
      dueAt: risk.mitigationDueAt || null,
      scheduleStatus: workPackageScheduleStatus({ dueAt: risk.mitigationDueAt, status: "OPEN" }),
      mitigation: risk.mitigation || "",
    }));

  const gateApprovalPermission = canApproveGate(userId);
  const gateApprovals = [];
  const gate = currentGate();
  if (gate && gateApprovalPermission.allowed) {
    const readiness = checkGate(gate.id);
    if (readiness.status === "READY") {
      gateApprovals.push({
        type: "GATE_APPROVAL",
        gateId: gate.id,
        title: gate.name,
        phaseId: gate.phaseId,
      });
    }
  }

  return {
    userId,
    projectId: project.id,
    pendingReviews,
    scheduleAlerts,
    conditionalApprovals,
    riskDecisions,
    riskMitigations,
    gateApprovals,
    total:
      pendingReviews.length +
      scheduleAlerts.length +
      conditionalApprovals.length +
      riskDecisions.length +
      riskMitigations.length +
      gateApprovals.length,
  };
}

export function getUserNotifications(userId, filters = {}) {
  const project = currentProject();
  const allNotifications = (store.notifications || [])
    .filter((item) => item.userId === userId && item.projectId === project.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const statusFilter = String(filters.status || "").toUpperCase();
  const typeFilter = String(filters.type || "").toUpperCase();
  const notifications = allNotifications.filter((item) => {
    if (statusFilter && item.status !== statusFilter) {
      return false;
    }
    if (typeFilter && item.type !== typeFilter) {
      return false;
    }
    return true;
  });

  return {
    userId,
    projectId: project.id,
    unreadCount: allNotifications.filter((item) => item.status === "UNREAD").length,
    total: allNotifications.length,
    filteredCount: notifications.length,
    filters: {
      status: statusFilter || null,
      type: typeFilter || null,
    },
    counts: {
      unread: allNotifications.filter((item) => item.status === "UNREAD").length,
      read: allNotifications.filter((item) => item.status === "READ").length,
      action: allNotifications.filter((item) => item.type === "ACTION").length,
      warning: allNotifications.filter((item) => item.type === "WARNING").length,
      info: allNotifications.filter((item) => item.type === "INFO").length,
    },
    notifications,
  };
}

export function markNotificationRead(notificationId, body = {}) {
  const notification = (store.notifications || []).find((item) => item.id === notificationId);
  if (!notification) {
    return { statusCode: 404, body: { error: "通知不存在" } };
  }

  if (body.userId && notification.userId !== body.userId) {
    return {
      statusCode: 403,
      body: {
        error: "当前用户无权处理该通知",
        notificationId,
      },
    };
  }

  notification.status = "READ";
  notification.readAt = new Date().toISOString();
  persistStore();

  return {
    statusCode: 200,
    body: {
      notification,
      notifications: getUserNotifications(notification.userId),
    },
  };
}

export function markUserNotificationsRead(userId) {
  const project = currentProject();
  const now = new Date().toISOString();
  let updatedCount = 0;

  for (const notification of store.notifications || []) {
    if (notification.userId === userId && notification.projectId === project.id && notification.status === "UNREAD") {
      notification.status = "READ";
      notification.readAt = now;
      updatedCount += 1;
    }
  }

  persistStore();

  return {
    statusCode: 200,
    body: {
      updatedCount,
      notifications: getUserNotifications(userId),
    },
  };
}

export function getGateReviewPack(gateId) {
  const gate = store.gates.find((item) => item.id === gateId);
  if (!gate) {
    return null;
  }

  const project = store.projects.find((item) => item.id === gate.projectId) || null;
  const phase = store.phases.find((item) => item.id === gate.phaseId) || null;
  const readiness = checkGate(gate.id);
  const requirements = store.gateRequirements.filter((item) => item.gateId === gate.id);
  const evidence = requirements.map((requirement) => {
    const workPackage = store.workPackages.find(
      (item) =>
        item.phaseId === gate.phaseId &&
        item.title === requirement.requiredWorkPackageTitle &&
        item.requiredArtifactType === requirement.requiredArtifactType,
    );
    const artifacts = workPackage
      ? store.artifactVersions.filter((item) => item.workPackageId === workPackage.id && item.artifactType === requirement.requiredArtifactType)
      : [];
    const latestArtifact = artifacts.at(-1) || null;
    const manualEvidenceRefs = workPackage
      ? (store.evidenceRefs || []).filter((item) => item.workPackageId === workPackage.id)
      : [];
    const approvedArtifact =
      artifacts.find((item) => item.status === "APPROVED" || item.status === "LOCKED") || null;
    const approvedReview = workPackage
      ? store.reviews.find(
          (item) =>
            item.workPackageId === workPackage.id &&
            (item.decision === "APPROVE" || item.decision === "APPROVE_WITH_CONDITIONS"),
        ) || null
      : null;

    return {
      requirementId: requirement.id,
      requiredWorkPackageTitle: requirement.requiredWorkPackageTitle,
      requiredArtifactType: requirement.requiredArtifactType,
      requiredRoleKey: requirement.requiredRoleKey,
      workPackageId: workPackage?.id || null,
      workPackageStatus: workPackage?.status || "MISSING",
      latestArtifactId: latestArtifact?.id || null,
      latestArtifactStatus: latestArtifact?.status || "MISSING",
      approvedArtifactId: approvedArtifact?.id || null,
      approvedReviewId: approvedReview?.id || null,
      reviewerUserId: approvedReview?.reviewerUserId || null,
      approvedReviewDecision: approvedReview?.decision || null,
      approvedReviewComment: approvedReview?.comment || "",
      approvedReviewConditions: approvedReview?.conditions || [],
      approvedReviewConditionsCompletedAt: approvedReview?.conditionsCompletedAt || null,
      approvedReviewConditionsCompletedByUserId: approvedReview?.conditionsCompletedByUserId || null,
      approvedReviewConditionsCompletionComment: approvedReview?.conditionsCompletionComment || "",
      approvedReviewedAt: approvedReview?.reviewedAt || null,
      manualEvidenceCount: manualEvidenceRefs.length,
      manualEvidenceRefs,
      ready: Boolean(approvedArtifact && approvedReview),
    };
  });
  const risks = store.risks
    .filter((risk) => risk.projectId === gate.projectId && risk.phaseId === gate.phaseId)
    .map((risk) => ({
      id: risk.id,
      title: risk.title,
      severity: risk.severity,
      status: risk.status,
      mitigationStatus: risk.mitigationStatus || null,
      mitigationOwnerUserId: risk.mitigationOwnerUserId || null,
      mitigationDueAt: risk.mitigationDueAt || null,
      mitigation: risk.mitigation || "",
      mitigationCompletedAt: risk.mitigationCompletedAt || null,
      mitigationCompletedByUserId: risk.mitigationCompletedByUserId || null,
      mitigationCompletionComment: risk.mitigationCompletionComment || "",
      blocksGate:
        (risk.severity === "HIGH" || risk.severity === "CRITICAL") &&
        risk.status !== "CLOSED" &&
        risk.status !== "ACCEPTED",
    }));

  return {
    project: project ? { id: project.id, name: project.name, status: project.status } : null,
    phase: phase ? { id: phase.id, name: phase.name, status: phase.status } : null,
    gate: {
      id: gate.id,
      name: gate.name,
      status: gate.status,
      approvedByUserId: gate.approvedByUserId || null,
      approvedAt: gate.approvedAt || null,
      approvalComment: gate.approvalComment || "",
    },
    readiness,
    evidence,
    risks,
    blockers: readiness.blockers,
    summary: {
      requiredEvidenceCount: evidence.length,
      readyEvidenceCount: evidence.filter((item) => item.ready).length,
      manualEvidenceRefCount: evidence.reduce((total, item) => total + item.manualEvidenceCount, 0),
      openBlockingRiskCount: risks.filter((item) => item.blocksGate).length,
      blockerCount: readiness.blockers.length,
      readyForApproval: readiness.status === "READY",
    },
  };
}

export function getGateApprovalPack(gateId) {
  return (
    (store.gateApprovalPacks || [])
      .filter((item) => item.gateId === gateId)
      .sort((a, b) => String(b.approvedAt).localeCompare(String(a.approvedAt)))[0] || null
  );
}

function createGateApprovalPack(gate, reviewPack, approval) {
  const frozenPack = structuredClone({
    ...reviewPack,
    gate: {
      ...reviewPack.gate,
      status: "APPROVED",
      approvedByUserId: approval.approvedByUserId,
      approvedAt: approval.approvedAt,
      approvalComment: approval.approvalComment,
    },
    readiness: {
      ...reviewPack.readiness,
      status: "READY",
      blockers: [],
    },
    blockers: [],
    summary: {
      ...reviewPack.summary,
      blockerCount: 0,
      readyForApproval: true,
    },
  });
  const approvalPack = {
    id: `gate-pack-${randomUUID()}`,
    projectId: gate.projectId,
    gateId: gate.id,
    phaseId: gate.phaseId,
    approvedByUserId: approval.approvedByUserId,
    approvedAt: approval.approvedAt,
    approvalComment: approval.approvalComment,
    reviewPack: frozenPack,
  };
  store.gateApprovalPacks.push(approvalPack);
  return approvalPack;
}

export function runAgentWorkPackage(body) {
  const workPackage = store.workPackages.find((item) => item.id === body.workPackageId);
  if (!workPackage) {
    return { statusCode: 404, body: { error: "工作包不存在" } };
  }

  if (body.inputRefs && !Array.isArray(body.inputRefs)) {
    return validationError("inputRefs 必须是数组");
  }

  const rolePair = store.rolePairs.find((item) => item.id === workPackage.rolePairId) || null;
  const agentKey = body.agentKey || rolePair?.agentKey;
  if (!agentKey) {
    return {
      statusCode: 409,
      body: {
        error: "工作包缺少绑定 Agent",
        workPackageId: workPackage.id,
      },
    };
  }

  if (body.agentKey && rolePair?.agentKey && body.agentKey !== rolePair.agentKey) {
    return validationError("agentKey 与工作包绑定 Agent 不一致", {
      expectedAgentKey: rolePair.agentKey,
      receivedAgentKey: body.agentKey,
    });
  }

  const artifactTemplate =
    (workPackage.artifactTemplateKey && loadArtifactTemplateByKey(workPackage.artifactTemplateKey)) ||
    loadArtifactTemplateByType(workPackage.requiredArtifactType);

  if (!artifactTemplate) {
    return {
      statusCode: 409,
      body: {
        error: "工作包缺少交付物模板",
        workPackageId: workPackage.id,
        artifactType: workPackage.requiredArtifactType,
      },
    };
  }

  const agentRun = {
    id: randomUUID(),
    workPackageId: workPackage.id,
    agentKey,
    status: "OUTPUT_READY",
    inputRefs: body.inputRefs || [],
    artifactTemplateKey: artifactTemplate.templateKey,
    requiredSections: artifactTemplate.requiredSections,
    requiredReviewRoles: artifactTemplate.requiredReviewRoles,
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };
  const draftMarkdown = body.draftMarkdown || artifactTemplate.contentMarkdown;
  const validation = validateArtifactMarkdown(draftMarkdown, artifactTemplate);

  if (validation.status !== "PASSED") {
    const failedRun = {
      ...agentRun,
      status: "OUTPUT_INVALID",
      validation,
    };
    workPackage.status = "NEEDS_AGENT_REVISION";
    store.agentRuns.push(failedRun);
    audit("AGENT_OUTPUT_INVALID", "agent", failedRun.agentKey, "workPackage", workPackage.id, {
      artifactTemplateKey: artifactTemplate.templateKey,
      validation,
    });
    notifyUser(rolePair?.humanUserId, {
      title: "Agent 输出未通过模板校验",
      message: `${workPackage.title} 需要重新生成或补齐必需章节。`,
      type: "WARNING",
      objectType: "workPackage",
      objectId: workPackage.id,
    });
    persistStore();

    return {
      statusCode: 422,
      body: {
        error: "Agent 输出未满足交付物模板要求，不能进入人类审核",
        agentRun: failedRun,
        workPackage,
        artifactTemplate: {
          templateKey: artifactTemplate.templateKey,
          name: artifactTemplate.name,
          requiredSections: artifactTemplate.requiredSections,
        },
        validation,
      },
    };
  }

  const artifact = {
    id: randomUUID(),
    workPackageId: workPackage.id,
    artifactType: workPackage.requiredArtifactType,
    status: "PENDING_REVIEW",
    version: "0.1",
    createdByActor: `agent:${agentRun.agentKey}`,
    content: {
      title: `${workPackage.title}草稿`,
      summary: "Agent 已生成草稿。该输出仅为建议，必须由人类负责人审核后才可进入正式版本。",
      evidenceRefs: agentRun.inputRefs,
      templateKey: artifactTemplate.templateKey,
      templateName: artifactTemplate.name,
      requiredSections: artifactTemplate.requiredSections,
      requiredReviewRoles: artifactTemplate.requiredReviewRoles,
      draftMarkdown,
      validation,
    },
  };

  workPackage.status = "AGENT_DRAFT_READY";
  store.agentRuns.push(agentRun);
  store.artifactVersions.push(artifact);
  audit("AGENT_OUTPUT_READY", "agent", agentRun.agentKey, "workPackage", workPackage.id, {
    artifactId: artifact.id,
  });
  notifyUser(rolePair?.humanUserId, {
    title: "工作包待审核",
    message: `${workPackage.title} 已生成 Agent 草稿，等待人类负责人审核。`,
    type: "ACTION",
    objectType: "workPackage",
    objectId: workPackage.id,
  });
  persistStore();

  return { statusCode: 201, body: { agentRun, artifact, workPackage, artifactTemplate } };
}

export function submitHumanReview(body) {
  const workPackage = store.workPackages.find((item) => item.id === body.workPackageId);
  if (!workPackage) {
    return { statusCode: 404, body: { error: "工作包不存在" } };
  }

  if (!allowedReviewDecisions.has(body.decision)) {
    return validationError("审核决定不合法", {
      decision: body.decision,
      allowedDecisions: [...allowedReviewDecisions],
    });
  }

  const reviewerUserId = body.reviewerUserId || "";
  const rolePair = store.rolePairs.find((item) => item.id === workPackage.rolePairId) || null;
  const artifactTemplate =
    (workPackage.artifactTemplateKey && loadArtifactTemplateByKey(workPackage.artifactTemplateKey)) ||
    loadArtifactTemplateByType(workPackage.requiredArtifactType);
  const permission = canReviewWorkPackage(reviewerUserId, workPackage, rolePair, artifactTemplate);
  if (!permission.allowed) {
    audit("HUMAN_REVIEW_DENIED", "human", reviewerUserId || "unknown", "workPackage", workPackage.id, {
      reason: permission.reason,
    });
    persistStore();
    return {
      statusCode: 403,
      body: {
        error: "当前用户无权审核该工作包",
        reason: permission.reason,
        workPackageId: workPackage.id,
      },
    };
  }

  if (body.decision === "APPROVE" || body.decision === "APPROVE_WITH_CONDITIONS") {
    const approvePermission = canApproveWorkPackage(reviewerUserId, rolePair);
    if (!approvePermission.allowed) {
      audit("HUMAN_APPROVAL_DENIED", "human", reviewerUserId || "unknown", "workPackage", workPackage.id, {
        reason: approvePermission.reason,
      });
      persistStore();
      return {
        statusCode: 403,
        body: {
          error: "当前用户无权批准该工作包",
          reason: approvePermission.reason,
          workPackageId: workPackage.id,
        },
      };
    }
  }

  const reviewComment = String(body.comment || "").trim();
  if ((body.decision === "REQUEST_REVISION" || body.decision === "REJECT") && !reviewComment) {
    return validationError("要求修改或驳回必须填写审核意见", {
      decision: body.decision,
    });
  }

  const review = {
    id: randomUUID(),
    workPackageId: workPackage.id,
    reviewerUserId,
    decision: body.decision,
    comment: reviewComment,
    conditions: body.conditions || [],
    reviewedAt: new Date().toISOString(),
  };

  const pendingArtifact = [...store.artifactVersions]
    .reverse()
    .find((item) => item.workPackageId === workPackage.id && item.status === "PENDING_REVIEW");

  if (!pendingArtifact) {
    return {
      statusCode: 409,
      body: {
        error: "没有可审核的待审交付物",
        workPackageId: workPackage.id,
        currentStatus: workPackage.status,
      },
    };
  }

  if (pendingArtifact.content?.validation?.status && pendingArtifact.content.validation.status !== "PASSED") {
    return {
      statusCode: 409,
      body: {
        error: "交付物模板校验未通过，不能进入人类审核",
        workPackageId: workPackage.id,
        validation: pendingArtifact.content.validation,
      },
    };
  }

  store.reviews.push(review);

  if (body.decision === "APPROVE" || body.decision === "APPROVE_WITH_CONDITIONS") {
    workPackage.status = "HUMAN_APPROVED";
    pendingArtifact.status = "APPROVED";
    pendingArtifact.version = "1.0";
  } else if (body.decision === "REQUEST_REVISION") {
    workPackage.status = "NEEDS_AGENT_REVISION";
    pendingArtifact.status = "NEEDS_REVISION";
  } else {
    workPackage.status = "REJECTED";
    pendingArtifact.status = "REJECTED";
  }

  audit("HUMAN_REVIEW_SUBMITTED", "human", review.reviewerUserId, "workPackage", workPackage.id, {
    decision: review.decision,
    comment: review.comment,
  });
  if (body.decision === "APPROVE" || body.decision === "APPROVE_WITH_CONDITIONS") {
    notifyRole("项目经理", {
      title: "工作包已批准",
      message: `${workPackage.title} 已由 ${review.reviewerUserId} 批准。`,
      type: "INFO",
      objectType: "workPackage",
      objectId: workPackage.id,
    });
  } else {
    notifyRole("项目经理", {
      title: "工作包需要返工",
      message: `${workPackage.title} 的审核结果为 ${body.decision}。`,
      type: "WARNING",
      objectType: "workPackage",
      objectId: workPackage.id,
    });
  }
  persistStore();

  return { statusCode: 201, body: { review, workPackage, latestGateCheck: currentGateCheck() } };
}

export function completeConditionalApproval(reviewId, body = {}) {
  const review = store.reviews.find((item) => item.id === reviewId);
  if (!review) {
    return { statusCode: 404, body: { error: "审核记录不存在" } };
  }
  if (review.decision !== "APPROVE_WITH_CONDITIONS" || !Array.isArray(review.conditions) || review.conditions.length === 0) {
    return validationError("审核记录不是有条件批准", { reviewId });
  }

  const workPackage = store.workPackages.find((item) => item.id === review.workPackageId);
  if (!workPackage) {
    return { statusCode: 404, body: { error: "工作包不存在" } };
  }

  const rolePair = store.rolePairs.find((item) => item.id === workPackage.rolePairId) || null;
  const actorUserId = body.userId || body.actorUserId || "";
  const isOwner = rolePair?.humanUserId === actorUserId;
  const canApprove = canApproveWorkPackage(actorUserId, rolePair).allowed;
  if (!isOwner && !canApprove) {
    return {
      statusCode: 403,
      body: {
        error: "当前用户无权完成有条件批准条款",
        workPackageId: workPackage.id,
        reviewId: review.id,
      },
    };
  }

  review.conditionsCompletedAt = new Date().toISOString();
  review.conditionsCompletedByUserId = actorUserId;
  review.conditionsCompletionComment = String(body.comment || "").trim();

  audit("CONDITIONAL_APPROVAL_COMPLETED", "human", actorUserId, "review", review.id, {
    workPackageId: workPackage.id,
    conditions: review.conditions,
    comment: review.conditionsCompletionComment,
  });
  notifyRole("项目经理", {
    title: "有条件批准条款已完成",
    message: `${workPackage.title} 的补充条款已由 ${actorUserId} 完成。`,
    type: "INFO",
    objectType: "review",
    objectId: review.id,
  });
  persistStore();
  return {
    statusCode: 200,
    body: {
      review,
      workPackage,
      actionItems: getUserActionItems(actorUserId),
      latestGateCheck: currentGateCheck(),
    },
  };
}

export function updateRiskStatus(riskId, status, body = {}) {
  const risk = store.risks.find((item) => item.id === riskId);
  if (!risk) {
    return { statusCode: 404, body: { error: "风险不存在" } };
  }

  if (!allowedRiskStatuses.has(status)) {
    return validationError("风险状态不合法", {
      status,
      allowedStatuses: [...allowedRiskStatuses],
    });
  }

  const actorUserId = body.userId || "";
  if (status === "ACCEPTED") {
    const permission = canAcceptRisk(actorUserId);
    if (!permission.allowed) {
      audit("RISK_ACCEPT_DENIED", "human", actorUserId || "unknown", "risk", risk.id, {
        reason: permission.reason,
      });
      persistStore();
      return {
        statusCode: 403,
        body: {
          error: "当前用户无权接受风险",
          reason: permission.reason,
          riskId: risk.id,
        },
      };
    }
  }

  if (status === "CLOSED") {
    const permission = canCloseRisk(actorUserId);
    if (!permission.allowed) {
      audit("RISK_CLOSE_DENIED", "human", actorUserId || "unknown", "risk", risk.id, {
        reason: permission.reason,
      });
      persistStore();
      return {
        statusCode: 403,
        body: {
          error: "当前用户无权关闭风险",
          reason: permission.reason,
          riskId: risk.id,
        },
      };
    }
  }

  risk.status = status;
  if (status === "ACCEPTED") {
    risk.acceptedByUserId = actorUserId;
    risk.acceptedAt = new Date().toISOString();
    risk.acceptedComment = body.comment || "";
  }

  if (status === "CLOSED") {
    risk.closedByUserId = actorUserId;
    risk.closedAt = new Date().toISOString();
    risk.closedComment = body.comment || "";
  }

  audit(`RISK_${status}`, "human", actorUserId, "risk", risk.id, {
    comment: body.comment || "",
  });
  notifyRole("项目经理", {
    title: status === "ACCEPTED" ? "风险已接受" : "风险已关闭",
    message: `${risk.title} 状态更新为 ${status}。`,
    type: "INFO",
    objectType: "risk",
    objectId: risk.id,
  });
  notifyRole("质量负责人", {
    title: status === "ACCEPTED" ? "风险已接受" : "风险已关闭",
    message: `${risk.title} 状态更新为 ${status}。`,
    type: "INFO",
    objectType: "risk",
    objectId: risk.id,
  });
  persistStore();
  return { statusCode: 200, body: { risk, latestGateCheck: currentGateCheck() } };
}

export function updateRiskMitigation(riskId, body = {}) {
  const risk = store.risks.find((item) => item.id === riskId);
  if (!risk) {
    return { statusCode: 404, body: { error: "风险不存在" } };
  }

  const actorUserId = body.userId || body.actorUserId || "user-project-manager";
  const mitigation = String(body.mitigation || "").trim();
  const mitigationDueAt = String(body.mitigationDueAt || body.dueAt || "").trim();
  if (mitigationDueAt && !/^\d{4}-\d{2}-\d{2}$/.test(mitigationDueAt)) {
    return validationError("mitigationDueAt 必须是 YYYY-MM-DD 格式", { mitigationDueAt });
  }

  const mitigationOwnerUserId = String(body.mitigationOwnerUserId || body.ownerUserId || "").trim();
  if (mitigationOwnerUserId && !findUser(mitigationOwnerUserId)) {
    return validationError("缓解负责人用户不存在", { mitigationOwnerUserId });
  }

  risk.mitigation = mitigation;
  risk.mitigationDueAt = mitigationDueAt || null;
  risk.mitigationOwnerUserId = mitigationOwnerUserId || null;
  risk.mitigationStatus = mitigation || mitigationDueAt || mitigationOwnerUserId ? "OPEN" : null;
  risk.mitigationCompletedAt = null;
  risk.mitigationCompletedByUserId = null;
  risk.mitigationCompletionComment = "";
  risk.mitigationUpdatedAt = new Date().toISOString();
  risk.mitigationUpdatedByUserId = actorUserId;

  audit("RISK_MITIGATION_UPDATED", "human", actorUserId, "risk", risk.id, {
    mitigationOwnerUserId: risk.mitigationOwnerUserId,
    mitigationDueAt: risk.mitigationDueAt,
    mitigation: risk.mitigation,
  });

  if (risk.mitigationOwnerUserId) {
    notifyUser(risk.mitigationOwnerUserId, {
      projectId: risk.projectId,
      title: "风险缓解任务已分配",
      message: `${risk.title} 的缓解措施已更新，截止日期 ${risk.mitigationDueAt || "未设置"}。`,
      type: "ACTION",
      objectType: "risk",
      objectId: risk.id,
    });
  }

  persistStore();
  return { statusCode: 200, body: { risk, latestGateCheck: currentGateCheck() } };
}

export function completeRiskMitigation(riskId, body = {}) {
  const risk = store.risks.find((item) => item.id === riskId);
  if (!risk) {
    return { statusCode: 404, body: { error: "风险不存在" } };
  }

  if (!risk.mitigationOwnerUserId && !risk.mitigation && !risk.mitigationDueAt) {
    return validationError("风险缓解计划尚未设置", { riskId: risk.id });
  }

  const actorUserId = body.userId || body.actorUserId || "user-project-manager";
  const ownerCanComplete = risk.mitigationOwnerUserId && risk.mitigationOwnerUserId === actorUserId;
  const riskDecisionPermission = canAcceptRisk(actorUserId);
  if (!ownerCanComplete && !riskDecisionPermission.allowed) {
    return {
      statusCode: 403,
      body: {
        error: "当前用户无权完成风险缓解任务",
        reason: riskDecisionPermission.reason,
        riskId: risk.id,
      },
    };
  }

  risk.mitigationStatus = "DONE";
  risk.mitigationCompletedAt = new Date().toISOString();
  risk.mitigationCompletedByUserId = actorUserId;
  risk.mitigationCompletionComment = body.comment || "";

  audit("RISK_MITIGATION_DONE", "human", actorUserId, "risk", risk.id, {
    mitigationOwnerUserId: risk.mitigationOwnerUserId,
    comment: risk.mitigationCompletionComment,
  });
  notifyRole("项目经理", {
    title: "风险缓解已完成",
    message: `${risk.title} 的缓解任务已由 ${actorUserId} 完成。`,
    type: "INFO",
    objectType: "risk",
    objectId: risk.id,
  });
  notifyRole("质量负责人", {
    title: "风险缓解已完成",
    message: `${risk.title} 的缓解任务已由 ${actorUserId} 完成。`,
    type: "INFO",
    objectType: "risk",
    objectId: risk.id,
  });

  persistStore();
  return { statusCode: 200, body: { risk, latestGateCheck: currentGateCheck() } };
}

function createRiskForCurrentPhase(body = {}, options = {}) {
  const project = currentProject();
  if (project.status === "COMPLETED") {
    return {
      statusCode: 409,
      body: {
        error: "项目已完成，不能继续创建阶段风险",
        projectId: project.id,
      },
    };
  }

  const phase = store.phases.find((item) => item.id === project.currentPhaseId);
  if (!phase) {
    return { statusCode: 404, body: { error: "当前阶段不存在" } };
  }

  const title = String(body.title || "").trim();
  if (options.requireTitle && !title) {
    return validationError("风险标题不能为空");
  }

  const severity = body.severity || "HIGH";
  if (!allowedRiskSeverities.has(severity)) {
    return validationError("风险严重度不合法", {
      severity,
      allowedSeverities: [...allowedRiskSeverities],
    });
  }

  const risk = {
    id: `risk-${phase.phaseKey}-${Date.now()}`,
    projectId: project.id,
    phaseId: phase.id,
    title: title || `${phase.name} 演示高风险`,
    severity,
    status: "OPEN",
    createdByUserId: body.userId || options.defaultActorId || "demo",
    createdAt: new Date().toISOString(),
  };

  store.risks.push(risk);
  audit("RISK_CREATED", options.actorType || "system", risk.createdByUserId, "risk", risk.id, {
    phaseId: phase.id,
    severity: risk.severity,
  });
  notifyRole("项目经理", {
    title: "新风险待处理",
    message: `${risk.title} 已创建，严重度为 ${risk.severity}。`,
    type: "ACTION",
    objectType: "risk",
    objectId: risk.id,
  });
  notifyRole("质量负责人", {
    title: "新风险待处理",
    message: `${risk.title} 已创建，严重度为 ${risk.severity}。`,
    type: "ACTION",
    objectType: "risk",
    objectId: risk.id,
  });
  persistStore();

  return {
    statusCode: 201,
    body: {
      risk,
      latestGateCheck: currentGateCheck(),
    },
  };
}

export function createCurrentPhaseRisk(body = {}) {
  return createRiskForCurrentPhase(body, {
    actorType: "human",
    defaultActorId: "user-project-manager",
    requireTitle: true,
  });
}

export function createDemoRiskForCurrentPhase(body = {}) {
  return createRiskForCurrentPhase(body, {
    actorType: "system",
    defaultActorId: "demo",
    requireTitle: false,
  });
}

export function approveGate(gateId, body = {}) {
  const gate = store.gates.find((item) => item.id === gateId);
  if (!gate) {
    return { statusCode: 404, body: { error: "阶段门不存在" } };
  }

  if (gate.status === "APPROVED") {
    return {
      statusCode: 409,
      body: {
        error: "阶段门已经批准，不能重复批准",
        gateId: gate.id,
      },
    };
  }

  const actorUserId = body.userId || "";
  const permission = canApproveGate(actorUserId);
  if (!permission.allowed) {
    audit("GATE_APPROVAL_DENIED", "human", actorUserId || "unknown", "gate", gate.id, {
      reason: permission.reason,
    });
    persistStore();
    return {
      statusCode: 403,
      body: {
        error: "当前用户无权批准阶段门",
        reason: permission.reason,
        gateId: gate.id,
      },
    };
  }

  const readiness = checkGate(gateId);
  if (!readiness || readiness.status !== "READY") {
    return {
      statusCode: 409,
      body: {
        error: "阶段门尚未满足通过条件，不能批准",
        gateId: gate.id,
        readiness,
      },
    };
  }
  const reviewPack = getGateReviewPack(gateId);

  const phase = store.phases.find((item) => item.id === gate.phaseId);
  const project = store.projects.find((item) => item.id === gate.projectId) || currentProject();
  gate.status = "APPROVED";
  gate.approvedByUserId = actorUserId;
  gate.approvedAt = new Date().toISOString();
  gate.approvalComment = body.comment || "";
  const approvalPack = createGateApprovalPack(gate, reviewPack, {
    approvedByUserId: actorUserId,
    approvedAt: gate.approvedAt,
    approvalComment: gate.approvalComment,
  });

  if (phase) {
    phase.status = "LOCKED";
    const nextPhase = store.phases
      .filter((item) => item.projectId === project.id && item.sequence > phase.sequence)
      .sort((a, b) => a.sequence - b.sequence)[0];
    if (nextPhase) {
      nextPhase.status = "IN_PROGRESS";
      project.currentPhaseId = nextPhase.id;
      const nextGate = store.gates.find((item) => item.phaseId === nextPhase.id);
      if (nextGate && nextGate.status === "NOT_STARTED") {
        nextGate.status = "GATE_BLOCKED";
      }
    } else {
      project.status = "COMPLETED";
    }
  }

  audit("GATE_APPROVED", "human", actorUserId, "gate", gate.id, {
    nextPhaseId: project.currentPhaseId,
    comment: gate.approvalComment,
    approvalPackId: approvalPack.id,
  });
  notifyRole("项目经理", {
    title: "阶段门已批准",
    message: `${phase?.name || gate.phaseId} 阶段门已批准。`,
    type: "INFO",
    objectType: "gate",
    objectId: gate.id,
  });
  persistStore();

  return {
    statusCode: 200,
    body: {
      gate,
      approvalPack,
      project,
      phases: store.phases,
    },
  };
}

async function handleAgentRun(req, res) {
  const result = runAgentWorkPackage(await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleReview(req, res) {
  const result = submitHumanReview(await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleConditionalApprovalComplete(req, res, reviewId) {
  const result = completeConditionalApproval(reviewId, await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleRiskUpdate(req, res, riskId, status) {
  const result = updateRiskStatus(riskId, status, await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleRiskMitigationUpdate(req, res, riskId) {
  const result = updateRiskMitigation(riskId, await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleRiskMitigationComplete(req, res, riskId) {
  const result = completeRiskMitigation(riskId, await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleCreateRisk(req, res) {
  const result = createCurrentPhaseRisk(await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleCreateDemoRisk(req, res) {
  const result = createDemoRiskForCurrentPhase(await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleCreateProject(req, res) {
  const result = createProject(await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleValidateProjectImport(req, res) {
  const result = validateProjectSnapshotImport(await readJson(req));
  return writeJson(res, result.valid ? 200 : 422, result);
}

async function handleImportProject(req, res) {
  const result = importProjectSnapshot(await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleCloneProject(req, res, projectId) {
  const result = cloneProject(projectId, await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleSelectProject(req, res, projectId) {
  const result = selectProject(projectId);
  return writeJson(res, result.statusCode, result.body);
}

async function handleArchiveProject(req, res, projectId) {
  const result = archiveProject(projectId, await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleRestoreProject(req, res, projectId) {
  const result = restoreProject(projectId, await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleUpdateRolePair(req, res, rolePairId) {
  const result = updateRolePair(rolePairId, await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleUpdateWorkPackageSchedule(req, res, workPackageId) {
  const result = updateWorkPackageSchedule(workPackageId, await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleAddWorkPackageEvidenceRef(req, res, workPackageId) {
  const result = addWorkPackageEvidenceRef(workPackageId, await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleGateApproval(req, res, gateId) {
  const result = approveGate(gateId, await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleMarkNotificationRead(req, res, notificationId) {
  const result = markNotificationRead(notificationId, await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleMarkUserNotificationsRead(req, res, userId) {
  await readJson(req);
  const result = markUserNotificationsRead(userId);
  return writeJson(res, result.statusCode, result.body);
}

function serveStatic(req, res, url) {
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(staticRoot, pathname));

  if (!filePath.startsWith(staticRoot)) {
    return writeText(res, 403, "Forbidden");
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return writeText(res, 404, "Not found");
  }

  const ext = path.extname(filePath);
  const contentType =
    ext === ".html"
      ? "text/html; charset=utf-8"
      : ext === ".css"
        ? "text/css; charset=utf-8"
        : ext === ".js"
          ? "application/javascript; charset=utf-8"
          : "application/octet-stream";

  return writeText(res, 200, fs.readFileSync(filePath), contentType);
}

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    return writeJson(res, 204, {});
  }

  try {
    if (req.method === "GET" && url.pathname === "/health") {
      return writeJson(res, 200, {
        ok: true,
        service: "hardware-flow-api",
        activeProjectId: store.activeProjectId,
        projectCount: store.projects.length,
      });
    }

    if (req.method === "GET" && url.pathname === "/storage/status") {
      return writeJson(res, 200, getStorageStatus());
    }

    if (req.method === "POST" && url.pathname === "/demo/reset") {
      store = createDemoStore();
      return writeJson(res, 200, getActiveProjectView());
    }

    if (req.method === "GET" && url.pathname === "/projects/demo") {
      return writeJson(res, 200, getActiveProjectView());
    }

    if (req.method === "POST" && url.pathname === "/projects") {
      return await handleCreateProject(req, res);
    }

    if (req.method === "POST" && url.pathname === "/projects/import/validate") {
      return await handleValidateProjectImport(req, res);
    }

    if (req.method === "POST" && url.pathname === "/projects/import") {
      return await handleImportProject(req, res);
    }

    const cloneProjectMatch = url.pathname.match(/^\/projects\/([^/]+)\/clone$/);
    if (req.method === "POST" && cloneProjectMatch) {
      return await handleCloneProject(req, res, cloneProjectMatch[1]);
    }

    const projectSnapshotMarkdownMatch = url.pathname.match(/^\/projects\/([^/]+)\/snapshot\.md$/);
    if (req.method === "GET" && projectSnapshotMarkdownMatch) {
      const snapshot = getProjectSnapshot(projectSnapshotMarkdownMatch[1]);
      return snapshot
        ? writeText(res, 200, renderProjectSnapshotMarkdown(snapshot), "text/markdown; charset=utf-8")
        : writeJson(res, 404, { error: "项目不存在" });
    }

    const projectSnapshotMatch = url.pathname.match(/^\/projects\/([^/]+)\/snapshot$/);
    if (req.method === "GET" && projectSnapshotMatch) {
      const snapshot = getProjectSnapshot(projectSnapshotMatch[1]);
      return snapshot ? writeJson(res, 200, snapshot) : writeJson(res, 404, { error: "项目不存在" });
    }

    const projectRiskRegisterMarkdownMatch = url.pathname.match(/^\/projects\/([^/]+)\/risk-register\.md$/);
    if (req.method === "GET" && projectRiskRegisterMarkdownMatch) {
      const register = getProjectRiskRegister(projectRiskRegisterMarkdownMatch[1]);
      return register
        ? writeText(res, 200, renderRiskRegisterMarkdown(register), "text/markdown; charset=utf-8")
        : writeJson(res, 404, { error: "项目不存在" });
    }

    const projectRiskRegisterMatch = url.pathname.match(/^\/projects\/([^/]+)\/risk-register$/);
    if (req.method === "GET" && projectRiskRegisterMatch) {
      const register = getProjectRiskRegister(projectRiskRegisterMatch[1]);
      return register ? writeJson(res, 200, register) : writeJson(res, 404, { error: "项目不存在" });
    }

    const selectProjectMatch = url.pathname.match(/^\/projects\/([^/]+)\/select$/);
    if (req.method === "POST" && selectProjectMatch) {
      return await handleSelectProject(req, res, selectProjectMatch[1]);
    }

    const archiveProjectMatch = url.pathname.match(/^\/projects\/([^/]+)\/archive$/);
    if (req.method === "POST" && archiveProjectMatch) {
      return await handleArchiveProject(req, res, archiveProjectMatch[1]);
    }

    const restoreProjectMatch = url.pathname.match(/^\/projects\/([^/]+)\/restore$/);
    if (req.method === "POST" && restoreProjectMatch) {
      return await handleRestoreProject(req, res, restoreProjectMatch[1]);
    }

    const rolePairMatch = url.pathname.match(/^\/role-pairs\/([^/]+)$/);
    if (req.method === "PATCH" && rolePairMatch) {
      return await handleUpdateRolePair(req, res, rolePairMatch[1]);
    }

    if (req.method === "GET" && url.pathname === "/users/demo") {
      return writeJson(res, 200, { users: getDemoUsers() });
    }

    const userActionItemsMatch = url.pathname.match(/^\/users\/([^/]+)\/action-items$/);
    if (req.method === "GET" && userActionItemsMatch) {
      return writeJson(res, 200, getUserActionItems(userActionItemsMatch[1]));
    }

    const userNotificationsMatch = url.pathname.match(/^\/users\/([^/]+)\/notifications$/);
    if (req.method === "GET" && userNotificationsMatch) {
      return writeJson(res, 200, getUserNotifications(userNotificationsMatch[1], Object.fromEntries(url.searchParams)));
    }

    const userNotificationsReadMatch = url.pathname.match(/^\/users\/([^/]+)\/notifications\/read$/);
    if (req.method === "POST" && userNotificationsReadMatch) {
      return await handleMarkUserNotificationsRead(req, res, userNotificationsReadMatch[1]);
    }

    const notificationReadMatch = url.pathname.match(/^\/notifications\/([^/]+)\/read$/);
    if (req.method === "POST" && notificationReadMatch) {
      return await handleMarkNotificationRead(req, res, notificationReadMatch[1]);
    }

    const workPackageMatch = url.pathname.match(/^\/work-packages\/([^/]+)$/);
    if (req.method === "GET" && workPackageMatch) {
      const result = getWorkPackageDetail(workPackageMatch[1]);
      return result ? writeJson(res, 200, result) : writeJson(res, 404, { error: "工作包不存在" });
    }

    const workPackageMarkdownMatch = url.pathname.match(/^\/work-packages\/([^/]+)\/export\.md$/);
    if (req.method === "GET" && workPackageMarkdownMatch) {
      const result = getWorkPackageMarkdown(workPackageMarkdownMatch[1]);
      return result
        ? writeText(res, 200, result, "text/markdown; charset=utf-8")
        : writeJson(res, 404, { error: "工作包不存在" });
    }

    const workPackageScheduleMatch = url.pathname.match(/^\/work-packages\/([^/]+)\/schedule$/);
    if (req.method === "PATCH" && workPackageScheduleMatch) {
      return await handleUpdateWorkPackageSchedule(req, res, workPackageScheduleMatch[1]);
    }

    const workPackageEvidenceRefMatch = url.pathname.match(/^\/work-packages\/([^/]+)\/evidence-refs$/);
    if (req.method === "POST" && workPackageEvidenceRefMatch) {
      return await handleAddWorkPackageEvidenceRef(req, res, workPackageEvidenceRefMatch[1]);
    }

    if (req.method === "GET" && url.pathname === "/templates/hardware") {
      return writeJson(res, 200, getHardwarePhaseTemplate());
    }

    if (req.method === "GET" && url.pathname === "/templates/artifacts") {
      return writeJson(res, 200, getArtifactTemplateRegistry());
    }

    const artifactTemplateMatch = url.pathname.match(/^\/templates\/artifacts\/([^/]+)$/);
    if (req.method === "GET" && artifactTemplateMatch) {
      const template = loadArtifactTemplateByKey(artifactTemplateMatch[1]);
      return template ? writeJson(res, 200, template) : writeJson(res, 404, { error: "交付物模板不存在" });
    }

    if (req.method === "POST" && url.pathname === "/agent-runs") {
      return await handleAgentRun(req, res);
    }

    if (req.method === "POST" && url.pathname === "/reviews") {
      return await handleReview(req, res);
    }

    const conditionalApprovalCompleteMatch = url.pathname.match(/^\/reviews\/([^/]+)\/conditions\/complete$/);
    if (req.method === "POST" && conditionalApprovalCompleteMatch) {
      return await handleConditionalApprovalComplete(req, res, conditionalApprovalCompleteMatch[1]);
    }

    const riskMitigationMatch = url.pathname.match(/^\/risks\/([^/]+)\/mitigation$/);
    if (req.method === "PATCH" && riskMitigationMatch) {
      return await handleRiskMitigationUpdate(req, res, riskMitigationMatch[1]);
    }

    const riskMitigationCompleteMatch = url.pathname.match(/^\/risks\/([^/]+)\/mitigation\/complete$/);
    if (req.method === "POST" && riskMitigationCompleteMatch) {
      return await handleRiskMitigationComplete(req, res, riskMitigationCompleteMatch[1]);
    }

    const riskAcceptMatch = url.pathname.match(/^\/risks\/([^/]+)\/accept$/);
    if (req.method === "POST" && riskAcceptMatch) {
      return await handleRiskUpdate(req, res, riskAcceptMatch[1], "ACCEPTED");
    }

    const riskCloseMatch = url.pathname.match(/^\/risks\/([^/]+)\/close$/);
    if (req.method === "POST" && riskCloseMatch) {
      return await handleRiskUpdate(req, res, riskCloseMatch[1], "CLOSED");
    }

    if (req.method === "POST" && url.pathname === "/risks/demo-current-phase") {
      return await handleCreateDemoRisk(req, res);
    }

    if (req.method === "POST" && url.pathname === "/risks/current-phase") {
      return await handleCreateRisk(req, res);
    }

    const gateCheckMatch = url.pathname.match(/^\/gates\/([^/]+)\/check$/);
    if (req.method === "GET" && gateCheckMatch) {
      const result = checkGate(gateCheckMatch[1]);
      return result ? writeJson(res, 200, result) : writeJson(res, 404, { error: "阶段门不存在" });
    }

    const gateReviewPackMatch = url.pathname.match(/^\/gates\/([^/]+)\/review-pack$/);
    if (req.method === "GET" && gateReviewPackMatch) {
      const result = getGateReviewPack(gateReviewPackMatch[1]);
      return result ? writeJson(res, 200, result) : writeJson(res, 404, { error: "阶段门不存在" });
    }

    const gateReviewPackMarkdownMatch = url.pathname.match(/^\/gates\/([^/]+)\/review-pack\.md$/);
    if (req.method === "GET" && gateReviewPackMarkdownMatch) {
      const result = getGateReviewPack(gateReviewPackMarkdownMatch[1]);
      return result
        ? writeText(res, 200, renderGateReviewPackMarkdown(result), "text/markdown; charset=utf-8")
        : writeJson(res, 404, { error: "阶段门不存在" });
    }

    const gateApprovalPackMarkdownMatch = url.pathname.match(/^\/gates\/([^/]+)\/approval-pack\.md$/);
    if (req.method === "GET" && gateApprovalPackMarkdownMatch) {
      const result = getGateApprovalPack(gateApprovalPackMarkdownMatch[1]);
      return result
        ? writeText(res, 200, renderGateReviewPackMarkdown(result.reviewPack), "text/markdown; charset=utf-8")
        : writeJson(res, 404, { error: "阶段门批准包不存在" });
    }

    const gateApprovalPackMatch = url.pathname.match(/^\/gates\/([^/]+)\/approval-pack$/);
    if (req.method === "GET" && gateApprovalPackMatch) {
      const result = getGateApprovalPack(gateApprovalPackMatch[1]);
      return result ? writeJson(res, 200, result) : writeJson(res, 404, { error: "阶段门批准包不存在" });
    }

    const gateApproveMatch = url.pathname.match(/^\/gates\/([^/]+)\/approve$/);
    if (req.method === "POST" && gateApproveMatch) {
      return await handleGateApproval(req, res, gateApproveMatch[1]);
    }

    if (req.method === "GET") {
      return serveStatic(req, res, url);
    }

    return writeJson(res, 404, { error: "接口不存在" });
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500;
    return writeJson(res, statusCode, {
      error: statusCode === 400 ? error.message : "服务器错误",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});

if (import.meta.url === `file://${process.argv[1]}`) {
  server.on("error", (error) => {
    console.error("服务启动失败。请确认当前环境允许监听端口，或通过 PORT 指定其他端口。");
    console.error(error);
    process.exit(1);
  });

  server.listen(port, host, () => {
    const displayHost = host === "0.0.0.0" ? "localhost" : host;
    console.log(`Hardware Flow API listening on http://${displayHost}:${port}`);
    if (host === "0.0.0.0") {
      console.log("LAN mode enabled. Use this machine's LAN IP from other devices.");
    }
  });
}
