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
import { deleteStoreFromDisk, loadStoreFromDisk, saveStoreToDisk } from "./persistence.mjs";
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

export function resetDemoStore() {
  deleteStoreFromDisk();
  store = createDemoStore();
  persistStore();
  return getDemoProject();
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

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
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

export function getDemoProject() {
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
    body: getDemoProject(),
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
    body: getDemoProject(),
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
      project: getDemoProject(),
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

    if (req.method === "POST" && url.pathname === "/demo/reset") {
      store = createDemoStore();
      return writeJson(res, 200, getDemoProject());
    }

    if (req.method === "GET" && url.pathname === "/projects/demo") {
      return writeJson(res, 200, getDemoProject());
    }

    if (req.method === "POST" && url.pathname === "/projects") {
      return handleCreateProject(req, res);
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

    const gateApproveMatch = url.pathname.match(/^\/gates\/([^/]+)\/approve$/);
    if (req.method === "POST" && gateApproveMatch) {
      return handleGateApproval(req, res, gateApproveMatch[1]);
    }

    if (req.method === "GET") {
      return serveStatic(req, res, url);
    }

    return writeJson(res, 404, { error: "接口不存在" });
  } catch (error) {
    return writeJson(res, 500, {
      error: "服务器错误",
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
