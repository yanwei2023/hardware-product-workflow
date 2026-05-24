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

function validationError(message, details = {}) {
  return {
    statusCode: 400,
    body: {
      error: message,
      ...details,
    },
  };
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
    auditEvents: [],
  };
}

let store = loadStoreFromDisk() || createDemoStore();
saveStoreToDisk(store);

function persistStore() {
  saveStoreToDisk(store);
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
        `| ${item.requiredWorkPackageTitle} | ${item.requiredArtifactType} | ${item.workPackageStatus} | ${item.latestArtifactStatus} | ${item.reviewerUserId || "-"} | ${item.ready ? "READY" : "BLOCKED"} |`,
    )
    .join("\n");
  const riskRows = pack.risks.length
    ? pack.risks
        .map((risk) => `| ${risk.title} | ${risk.severity} | ${risk.status} | ${risk.blocksGate ? "YES" : "NO"} |`)
        .join("\n")
    : "| 无 | - | - | NO |";
  const blockerRows = pack.blockers.length
    ? pack.blockers.map((blocker) => `- ${blocker.code}: ${blocker.message}`).join("\n")
    : "- 无";

  return `# ${pack.gate.name} 审核包

项目：${pack.project?.name || "-"}
阶段：${pack.phase?.name || "-"}
阶段门状态：${pack.gate.status}
就绪状态：${pack.readiness.status}

## 摘要

- 必需证据：${pack.summary.readyEvidenceCount}/${pack.summary.requiredEvidenceCount}
- 阻塞项：${pack.summary.blockerCount}
- 阻塞风险：${pack.summary.openBlockingRiskCount}
- 可批准：${pack.summary.readyForApproval ? "是" : "否"}

## 必需证据

| 工作包 | 交付物类型 | 工作包状态 | 最新交付物状态 | 审核人 | 结论 |
|---|---|---|---|---|---|
${evidenceRows}

## 风险

| 风险 | 严重度 | 状态 | 阻塞阶段门 |
|---|---|---|---|
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
    .map((item) => `| ${item.phaseName} | ${item.title} | ${item.requiredArtifactType} | ${item.status} | ${item.ownerUserId || "-"} |`)
    .join("\n");
  const riskRows = snapshot.risks.length
    ? snapshot.risks.map((risk) => `| ${risk.phaseName} | ${risk.title} | ${risk.severity} | ${risk.status} |`).join("\n")
    : "| 无 | - | - | - |";
  const auditRows = snapshot.auditEvents.length
    ? snapshot.auditEvents
        .slice(-12)
        .map((event) => `| ${event.createdAt} | ${event.eventType} | ${event.actorType}:${event.actorId} | ${event.objectType}:${event.objectId} |`)
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
- 风险：${snapshot.summary.riskCount}
- 打开高风险：${snapshot.summary.openHighRiskCount}
- 审计事件：${snapshot.summary.auditEventCount}

## 阶段

| 序号 | 阶段 | 状态 |
|---|---|---|
${phaseRows}

## 工作包

| 阶段 | 工作包 | 交付物类型 | 状态 | 负责人 |
|---|---|---|---|---|
${workPackageRows}

## 风险

| 阶段 | 风险 | 严重度 | 状态 |
|---|---|---|---|
${riskRows}

## 最近审计

| 时间 | 事件 | 操作者 | 对象 |
|---|---|---|---|
${auditRows}
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
    workPackages: store.workPackages.filter((item) => item.projectId === project.id),
    artifactVersions: store.artifactVersions.filter((item) => workPackageIds.has(item.workPackageId)),
    reviews: store.reviews.filter((item) => workPackageIds.has(item.workPackageId)),
    risks: store.risks.filter((item) => item.projectId === project.id && phaseIds.has(item.phaseId)),
    agentRuns: store.agentRuns.filter((item) => workPackageIds.has(item.workPackageId)),
    agentFindings: store.agentFindings.filter((item) => workPackageIds.has(item.workPackageId)),
    auditEvents: store.auditEvents.filter((event) => !event.projectId || event.projectId === project.id),
    latestGateCheck: gate ? checkGate(gate.id) : null,
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
  const risks = store.risks.filter((item) => item.projectId === project.id && phaseIds.has(item.phaseId));
  const currentPhase = phases.find((item) => item.id === project.currentPhaseId) || null;
  const currentGate = currentPhase ? gates.find((item) => item.phaseId === currentPhase.id) || null : null;
  const auditEvents = store.auditEvents.filter((event) => !event.projectId || event.projectId === project.id);

  return {
    exportedAt: new Date().toISOString(),
    project,
    currentPhase,
    currentGate,
    summary: {
      phaseCount: phases.length,
      workPackageCount: workPackages.length,
      approvedWorkPackageCount: workPackages.filter((item) => item.status === "HUMAN_APPROVED" || item.status === "LOCKED").length,
      riskCount: risks.length,
      openHighRiskCount: risks.filter(
        (risk) =>
          (risk.severity === "HIGH" || risk.severity === "CRITICAL") &&
          risk.status !== "CLOSED" &&
          risk.status !== "ACCEPTED",
      ).length,
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
      };
    }),
    artifactVersions: store.artifactVersions.filter((item) => workPackageIds.has(item.workPackageId)),
    reviews: store.reviews.filter((item) => workPackageIds.has(item.workPackageId)),
    risks: risks.map((risk) => ({
      ...risk,
      phaseName: phases.find((phase) => phase.id === risk.phaseId)?.name || risk.phaseId,
    })),
    agentRuns: store.agentRuns.filter((item) => workPackageIds.has(item.workPackageId)),
    agentFindings: store.agentFindings.filter((item) => workPackageIds.has(item.workPackageId)),
    auditEvents,
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
  const risks = asArray(snapshot.risks);
  const agentRuns = asArray(snapshot.agentRuns);
  const agentFindings = asArray(snapshot.agentFindings);
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

  for (const risk of risks) {
    pushIfMissing(errors, risk.projectId === project?.id, "风险 projectId 与项目不一致", {
      riskId: risk.id,
      projectId: risk.projectId,
    });
    pushIfMissing(errors, phaseIds.has(risk.phaseId), "风险 phaseId 未指向快照内阶段", {
      riskId: risk.id,
      phaseId: risk.phaseId,
    });
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
      riskCount: risks.length,
      agentRunCount: agentRuns.length,
      agentFindingCount: agentFindings.length,
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
  const risks = asArray(snapshot.risks).map(({ phaseName, ...item }) => ({ ...item }));
  const agentRuns = asArray(snapshot.agentRuns).map((item) => ({ ...item }));
  const agentFindings = asArray(snapshot.agentFindings).map((item) => ({ ...item }));
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
  store.risks.push(...risks);
  store.agentRuns.push(...agentRuns);
  store.agentFindings.push(...agentFindings);
  store.auditEvents.push(...auditEvents);
  store.activeProjectId = project.id;

  audit("PROJECT_IMPORTED", "human", input.actorUserId || "user-project-manager", "project", project.id, {
    sourceExportedAt: snapshot.exportedAt || null,
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

  let baseId = `project-${slugifyProjectName(name)}`;
  if (store.projects.some((project) => project.id === baseId)) {
    baseId = `${baseId}-${Date.now()}`;
  }

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

  rolePair.humanUserId = body.humanUserId;
  audit("ROLE_PAIR_UPDATED", "human", body.actorUserId || "user-project-manager", "rolePair", rolePair.id, {
    humanUserId: body.humanUserId,
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

export function getWorkPackageDetail(workPackageId) {
  const workPackage = store.workPackages.find((item) => item.id === workPackageId);
  if (!workPackage) {
    return null;
  }

  return {
    workPackage,
    rolePair: store.rolePairs.find((item) => item.id === workPackage.rolePairId) || null,
    artifacts: store.artifactVersions.filter((item) => item.workPackageId === workPackageId),
    reviews: store.reviews.filter((item) => item.workPackageId === workPackageId),
    agentRuns: store.agentRuns.filter((item) => item.workPackageId === workPackageId),
  };
}

export function getUserActionItems(userId) {
  const project = currentProject();
  const phaseIds = new Set(store.phases.filter((item) => item.projectId === project.id).map((item) => item.id));
  const workPackages = store.workPackages.filter((item) => item.projectId === project.id);
  const pendingReviews = [];

  for (const workPackage of workPackages) {
    const pendingArtifact = [...store.artifactVersions]
      .reverse()
      .find((item) => item.workPackageId === workPackage.id && item.status === "PENDING_REVIEW");
    if (!pendingArtifact) {
      continue;
    }

    const rolePair = store.rolePairs.find((item) => item.id === workPackage.rolePairId) || null;
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
    riskDecisions,
    gateApprovals,
    total: pendingReviews.length + riskDecisions.length + gateApprovals.length,
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
    },
    readiness,
    evidence,
    risks,
    blockers: readiness.blockers,
    summary: {
      requiredEvidenceCount: evidence.length,
      readyEvidenceCount: evidence.filter((item) => item.ready).length,
      openBlockingRiskCount: risks.filter((item) => item.blocksGate).length,
      blockerCount: readiness.blockers.length,
      readyForApproval: readiness.status === "READY",
    },
  };
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

  const review = {
    id: randomUUID(),
    workPackageId: workPackage.id,
    reviewerUserId,
    decision: body.decision,
    comment: body.comment || "",
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
  });
  persistStore();

  return { statusCode: 201, body: { review, workPackage, latestGateCheck: currentGateCheck() } };
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
  }

  audit(`RISK_${status}`, "human", actorUserId, "risk", risk.id);
  persistStore();
  return { statusCode: 200, body: { risk, latestGateCheck: currentGateCheck() } };
}

export function createDemoRiskForCurrentPhase(body = {}) {
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
    title: body.title || `${phase.name} 演示高风险`,
    severity,
    status: "OPEN",
  };

  store.risks.push(risk);
  audit("RISK_CREATED", "system", "demo", "risk", risk.id, {
    phaseId: phase.id,
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

  const phase = store.phases.find((item) => item.id === gate.phaseId);
  const project = store.projects.find((item) => item.id === gate.projectId) || currentProject();
  gate.status = "APPROVED";
  gate.approvedByUserId = actorUserId;
  gate.approvedAt = new Date().toISOString();

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
  });
  persistStore();

  return {
    statusCode: 200,
    body: {
      gate,
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

async function handleRiskUpdate(req, res, riskId, status) {
  const result = updateRiskStatus(riskId, status, await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleCreateRisk(req, res) {
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

async function handleSelectProject(req, res, projectId) {
  const result = selectProject(projectId);
  return writeJson(res, result.statusCode, result.body);
}

async function handleUpdateRolePair(req, res, rolePairId) {
  const result = updateRolePair(rolePairId, await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleGateApproval(req, res, gateId) {
  const result = approveGate(gateId, await readJson(req));
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
      return handleCreateProject(req, res);
    }

    if (req.method === "POST" && url.pathname === "/projects/import/validate") {
      return handleValidateProjectImport(req, res);
    }

    if (req.method === "POST" && url.pathname === "/projects/import") {
      return handleImportProject(req, res);
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

    const selectProjectMatch = url.pathname.match(/^\/projects\/([^/]+)\/select$/);
    if (req.method === "POST" && selectProjectMatch) {
      return handleSelectProject(req, res, selectProjectMatch[1]);
    }

    const rolePairMatch = url.pathname.match(/^\/role-pairs\/([^/]+)$/);
    if (req.method === "PATCH" && rolePairMatch) {
      return handleUpdateRolePair(req, res, rolePairMatch[1]);
    }

    if (req.method === "GET" && url.pathname === "/users/demo") {
      return writeJson(res, 200, { users: getDemoUsers() });
    }

    const userActionItemsMatch = url.pathname.match(/^\/users\/([^/]+)\/action-items$/);
    if (req.method === "GET" && userActionItemsMatch) {
      return writeJson(res, 200, getUserActionItems(userActionItemsMatch[1]));
    }

    const workPackageMatch = url.pathname.match(/^\/work-packages\/([^/]+)$/);
    if (req.method === "GET" && workPackageMatch) {
      const result = getWorkPackageDetail(workPackageMatch[1]);
      return result ? writeJson(res, 200, result) : writeJson(res, 404, { error: "工作包不存在" });
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
      return handleAgentRun(req, res);
    }

    if (req.method === "POST" && url.pathname === "/reviews") {
      return handleReview(req, res);
    }

    const riskAcceptMatch = url.pathname.match(/^\/risks\/([^/]+)\/accept$/);
    if (req.method === "POST" && riskAcceptMatch) {
      return handleRiskUpdate(req, res, riskAcceptMatch[1], "ACCEPTED");
    }

    const riskCloseMatch = url.pathname.match(/^\/risks\/([^/]+)\/close$/);
    if (req.method === "POST" && riskCloseMatch) {
      return handleRiskUpdate(req, res, riskCloseMatch[1], "CLOSED");
    }

    if (req.method === "POST" && url.pathname === "/risks/demo-current-phase") {
      return handleCreateRisk(req, res);
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

    const gateApproveMatch = url.pathname.match(/^\/gates\/([^/]+)\/approve$/);
    if (req.method === "POST" && gateApproveMatch) {
      return handleGateApproval(req, res, gateApproveMatch[1]);
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
