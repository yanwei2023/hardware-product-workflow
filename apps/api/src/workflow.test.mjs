import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, beforeEach, test } from "node:test";

const tempDir = mkdtempSync(path.join(tmpdir(), "hardware-flow-test-"));
process.env.HARDWARE_FLOW_STORE_PATH = path.join(tempDir, "store.json");

const workflow = await import("./server.mjs");

after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(() => {
  workflow.resetDemoStore();
});

function runAgent(workPackageId, agentKey) {
  const result = workflow.runAgentWorkPackage({
    workPackageId,
    agentKey,
    inputRefs: ["artifact:test-input"],
  });
  assert.equal(result.statusCode, 201);
  return result.body;
}

function completeEvtWorkPackages(idPrefix = "") {
  runAgent(`${idPrefix}wp-evt_exit-evt_test_plan`, "test_agent");
  approveWorkPackage(`${idPrefix}wp-evt_exit-evt_test_plan`, "user-test-lead");
  runAgent(`${idPrefix}wp-evt_exit-evt_test_report`, "test_agent");
  approveWorkPackage(`${idPrefix}wp-evt_exit-evt_test_report`, "user-test-lead");
  runAgent(`${idPrefix}wp-evt_exit-evt_issue_closure`, "quality_agent");
  approveWorkPackage(`${idPrefix}wp-evt_exit-evt_issue_closure`, "user-quality-lead");
}

function approveWorkPackage(workPackageId, reviewerUserId) {
  const result = workflow.submitHumanReview({
    workPackageId,
    reviewerUserId,
    decision: "APPROVE",
    comment: "测试批准。",
  });
  assert.equal(result.statusCode, 201);
  return result.body;
}

function completeWorkPackages(workPackages, idPrefix = "") {
  for (const item of workPackages) {
    runAgent(`${idPrefix}${item.workPackageId}`, item.agentKey);
    approveWorkPackage(`${idPrefix}${item.workPackageId}`, item.reviewerUserId);
  }
}

function makeImportableSnapshot(snapshot, projectId = "project-importable") {
  const renamed = structuredClone(snapshot);
  renamed.project.id = projectId;
  renamed.project.name = `${snapshot.project.name} 导入副本`;
  renamed.project.currentPhaseId = `${projectId}-phase-evt_exit`;
  renamed.phases = renamed.phases.map((phase) => ({
    ...phase,
    id: `${projectId}-${phase.id}`,
    projectId,
  }));
  const phaseIdMap = new Map(snapshot.phases.map((phase, index) => [phase.id, renamed.phases[index].id]));
  renamed.gates = renamed.gates.map((gate) => ({
    ...gate,
    id: `${projectId}-${gate.id}`,
    projectId,
    phaseId: phaseIdMap.get(gate.phaseId),
  }));
  const gateIdMap = new Map(snapshot.gates.map((gate, index) => [gate.id, renamed.gates[index].id]));
  renamed.rolePairs = renamed.rolePairs.map((pair) => ({ ...pair, id: `${projectId}-${pair.id}`, projectId }));
  const rolePairIdMap = new Map(snapshot.rolePairs.map((pair, index) => [pair.id, renamed.rolePairs[index].id]));
  renamed.workPackages = renamed.workPackages.map((workPackage) => ({
    ...workPackage,
    id: `${projectId}-${workPackage.id}`,
    projectId,
    phaseId: phaseIdMap.get(workPackage.phaseId),
    rolePairId: rolePairIdMap.get(workPackage.rolePairId),
  }));
  const workPackageIdMap = new Map(snapshot.workPackages.map((workPackage, index) => [workPackage.id, renamed.workPackages[index].id]));
  renamed.gateRequirements = renamed.gateRequirements.map((requirement) => ({
    ...requirement,
    id: `${projectId}-${requirement.id}`,
    gateId: gateIdMap.get(requirement.gateId),
  }));
  renamed.artifactVersions = renamed.artifactVersions.map((artifact) => ({
    ...artifact,
    id: `${projectId}-${artifact.id}`,
    workPackageId: workPackageIdMap.get(artifact.workPackageId),
  }));
  renamed.reviews = renamed.reviews.map((review) => ({
    ...review,
    id: `${projectId}-${review.id}`,
    workPackageId: workPackageIdMap.get(review.workPackageId),
  }));
  renamed.risks = renamed.risks.map((risk) => ({
    ...risk,
    id: `${projectId}-${risk.id}`,
    projectId,
    phaseId: phaseIdMap.get(risk.phaseId),
  }));
  renamed.agentRuns = renamed.agentRuns.map((run) => ({
    ...run,
    id: `${projectId}-${run.id}`,
    workPackageId: workPackageIdMap.get(run.workPackageId),
  }));
  renamed.agentFindings = renamed.agentFindings.map((finding) => ({
    ...finding,
    id: `${projectId}-${finding.id}`,
    workPackageId: workPackageIdMap.get(finding.workPackageId),
  }));
  renamed.auditEvents = renamed.auditEvents.map((event) => ({ ...event, id: `${projectId}-${event.id}`, projectId }));
  return renamed;
}

test("EVT gate stays blocked until required artifacts and high risks are handled", () => {
  let gateCheck = workflow.checkGate("gate-evt_exit");
  assert.equal(gateCheck.status, "BLOCKED");
  assert.match(
    gateCheck.blockers.map((blocker) => blocker.code).join(","),
    /MISSING_ARTIFACT/,
  );
  assert.match(
    gateCheck.blockers.map((blocker) => blocker.code).join(","),
    /OPEN_HIGH_RISK/,
  );

  approveWorkPackage("wp-evt_exit-evt_test_plan", "user-test-lead");
  runAgent("wp-evt_exit-evt_test_report", "test_agent");
  approveWorkPackage("wp-evt_exit-evt_test_report", "user-test-lead");
  runAgent("wp-evt_exit-evt_issue_closure", "quality_agent");
  approveWorkPackage("wp-evt_exit-evt_issue_closure", "user-quality-lead");

  gateCheck = workflow.checkGate("gate-evt_exit");
  assert.equal(gateCheck.status, "BLOCKED");
  assert.deepEqual(
    gateCheck.blockers.map((blocker) => blocker.code),
    ["OPEN_HIGH_RISK"],
  );

  const riskResult = workflow.updateRiskStatus("risk-thermal-margin", "ACCEPTED", {
    userId: "user-project-manager",
  });
  assert.equal(riskResult.statusCode, 200);

  gateCheck = workflow.checkGate("gate-evt_exit");
  assert.equal(gateCheck.status, "READY");
});

test("storage status exposes local persistence metadata", () => {
  const status = workflow.getStorageStatus();

  assert.equal(status.exists, true);
  assert.equal(status.activeProjectId, "project-smart-controller");
  assert.equal(status.projectCount, 1);
  assert.ok(status.sizeBytes > 0);
});

test("gate review pack summarizes required evidence and readiness", () => {
  let pack = workflow.getGateReviewPack("gate-evt_exit");
  assert.equal(pack.gate.id, "gate-evt_exit");
  assert.equal(pack.summary.requiredEvidenceCount, 3);
  assert.equal(pack.summary.readyEvidenceCount, 0);
  assert.equal(pack.summary.openBlockingRiskCount, 1);
  assert.equal(pack.summary.readyForApproval, false);

  completeEvtWorkPackages();
  workflow.updateRiskStatus("risk-thermal-margin", "ACCEPTED", {
    userId: "user-project-manager",
  });

  pack = workflow.getGateReviewPack("gate-evt_exit");
  assert.equal(pack.summary.readyEvidenceCount, 3);
  assert.equal(pack.summary.openBlockingRiskCount, 0);
  assert.equal(pack.summary.readyForApproval, true);
  assert.equal(pack.evidence.every((item) => item.ready), true);
});

test("only the assigned human owner can approve a gate artifact", () => {
  runAgent("wp-evt_exit-evt_test_report", "test_agent");

  const denied = workflow.submitHumanReview({
    workPackageId: "wp-evt_exit-evt_test_report",
    reviewerUserId: "user-project-manager",
    decision: "APPROVE",
    comment: "尝试越权批准。",
  });

  assert.equal(denied.statusCode, 403);
  assert.match(denied.body.reason, /只有工作包绑定的人类负责人/);
});

test("requesting revision removes the stale artifact from pending review", () => {
  runAgent("wp-evt_exit-evt_test_report", "test_agent");

  const reviewResult = workflow.submitHumanReview({
    workPackageId: "wp-evt_exit-evt_test_report",
    reviewerUserId: "user-test-lead",
    decision: "REQUEST_REVISION",
    comment: "请补充失败项分析。",
  });

  assert.equal(reviewResult.statusCode, 201);
  assert.equal(reviewResult.body.workPackage.status, "NEEDS_AGENT_REVISION");

  const detail = workflow.getWorkPackageDetail("wp-evt_exit-evt_test_report");
  assert.equal(detail.artifacts.at(-1).status, "NEEDS_REVISION");

  const actionItems = workflow.getUserActionItems("user-test-lead");
  assert.equal(
    actionItems.pendingReviews.some((item) => item.workPackageId === "wp-evt_exit-evt_test_report"),
    false,
  );
});

test("work package markdown export includes artifact and review context", () => {
  approveWorkPackage("wp-evt_exit-evt_test_plan", "user-test-lead");

  const markdown = workflow.getWorkPackageMarkdown("wp-evt_exit-evt_test_plan");
  assert.match(markdown, /# EVT 测试计划 工作包/);
  assert.match(markdown, /## 最新交付物/);
  assert.match(markdown, /user-test-lead/);
  assert.match(markdown, /## Agent 输出草稿/);
  assert.equal(workflow.getWorkPackageMarkdown("missing-work-package"), null);
});

test("invalid agent output is rejected before human review", () => {
  const result = workflow.runAgentWorkPackage({
    workPackageId: "wp-evt_exit-evt_test_report",
    agentKey: "test_agent",
    draftMarkdown: "# 不完整草稿\n\n缺少必填章节。",
  });

  assert.equal(result.statusCode, 422);
  assert.equal(result.body.agentRun.status, "OUTPUT_INVALID");
  assert.equal(result.body.workPackage.status, "NEEDS_AGENT_REVISION");
  assert.ok(result.body.validation.missingSections.length > 0);
});

test("agent execution defaults to the work package bound agent", () => {
  const result = workflow.runAgentWorkPackage({
    workPackageId: "wp-evt_exit-evt_issue_closure",
    inputRefs: ["artifact:test-input"],
  });

  assert.equal(result.statusCode, 201);
  assert.equal(result.body.agentRun.agentKey, "quality_agent");
});

test("agent execution rejects mismatched agent keys", () => {
  const result = workflow.runAgentWorkPackage({
    workPackageId: "wp-evt_exit-evt_issue_closure",
    agentKey: "test_agent",
    inputRefs: ["artifact:test-input"],
  });

  assert.equal(result.statusCode, 400);
  assert.equal(result.body.error, "agentKey 与工作包绑定 Agent 不一致");
  assert.equal(result.body.expectedAgentKey, "quality_agent");
});

test("risk close uses the same privileged roles as risk acceptance", () => {
  const denied = workflow.updateRiskStatus("risk-thermal-margin", "CLOSED", {
    userId: "user-test-lead",
  });
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.body.error, "当前用户无权关闭风险");

  const approved = workflow.updateRiskStatus("risk-thermal-margin", "CLOSED", {
    userId: "user-quality-lead",
  });
  assert.equal(approved.statusCode, 200);
  assert.equal(approved.body.risk.status, "CLOSED");
});

test("review decisions are constrained to known workflow values", () => {
  runAgent("wp-evt_exit-evt_test_report", "test_agent");

  const result = workflow.submitHumanReview({
    workPackageId: "wp-evt_exit-evt_test_report",
    reviewerUserId: "user-test-lead",
    decision: "SHIP_IT",
    comment: "非法枚举。",
  });

  assert.equal(result.statusCode, 400);
  assert.equal(result.body.error, "审核决定不合法");
});

test("risk creation and role assignment reject unknown values", () => {
  const invalidRisk = workflow.createDemoRiskForCurrentPhase({
    title: "未知风险等级",
    severity: "SEVERE",
  });
  assert.equal(invalidRisk.statusCode, 400);
  assert.equal(invalidRisk.body.error, "风险严重度不合法");

  const project = workflow.getDemoProject();
  const rolePairId = project.rolePairs[0].id;
  const invalidRolePair = workflow.updateRolePair(rolePairId, {
    humanUserId: "user-missing",
    actorUserId: "user-project-manager",
  });
  assert.equal(invalidRolePair.statusCode, 400);
  assert.equal(invalidRolePair.body.error, "负责人用户不存在");
});

test("audit events keep payload details and stay scoped to the active project", () => {
  runAgent("wp-evt_exit-evt_test_report", "test_agent");
  const denied = workflow.submitHumanReview({
    workPackageId: "wp-evt_exit-evt_test_report",
    reviewerUserId: "user-project-manager",
    decision: "APPROVE",
    comment: "越权批准。",
  });
  assert.equal(denied.statusCode, 403);

  let project = workflow.getDemoProject();
  const deniedEvent = project.auditEvents.find((event) => event.eventType === "HUMAN_APPROVAL_DENIED");
  assert.equal(deniedEvent.projectId, "project-smart-controller");
  assert.match(deniedEvent.payload.reason, /只有工作包绑定的人类负责人/);

  const created = workflow.createProject({
    name: "Audit Scope Project",
    productLine: "IoT 产品线",
    activePhaseKey: "initiation",
    userId: "user-project-manager",
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.auditEvents.some((event) => event.eventType === "PROJECT_CREATED"), true);

  workflow.selectProject("project-smart-controller");
  project = workflow.getDemoProject();
  assert.equal(project.auditEvents.some((event) => event.objectId === created.body.project.id), false);
});

test("user action items reflect review and risk responsibilities", () => {
  let testLeadItems = workflow.getUserActionItems("user-test-lead");
  assert.equal(testLeadItems.pendingReviews.length, 1);
  assert.equal(testLeadItems.pendingReviews[0].workPackageId, "wp-evt_exit-evt_test_plan");
  assert.equal(testLeadItems.riskDecisions.length, 0);

  const projectManagerItems = workflow.getUserActionItems("user-project-manager");
  assert.equal(projectManagerItems.pendingReviews.length, 0);
  assert.equal(projectManagerItems.riskDecisions.length, 1);
  assert.equal(projectManagerItems.riskDecisions[0].riskId, "risk-thermal-margin");

  approveWorkPackage("wp-evt_exit-evt_test_plan", "user-test-lead");
  testLeadItems = workflow.getUserActionItems("user-test-lead");
  assert.equal(testLeadItems.pendingReviews.length, 0);
});

test("notifications follow work package and risk events", () => {
  runAgent("wp-evt_exit-evt_test_report", "test_agent");
  let testLeadNotifications = workflow.getUserNotifications("user-test-lead");
  assert.equal(testLeadNotifications.unreadCount, 1);
  assert.equal(testLeadNotifications.notifications[0].objectId, "wp-evt_exit-evt_test_report");

  const readResult = workflow.markNotificationRead(testLeadNotifications.notifications[0].id, {
    userId: "user-test-lead",
  });
  assert.equal(readResult.statusCode, 200);
  testLeadNotifications = workflow.getUserNotifications("user-test-lead");
  assert.equal(testLeadNotifications.unreadCount, 0);

  workflow.createDemoRiskForCurrentPhase({ title: "供应商交期风险", severity: "HIGH" });
  const managerNotifications = workflow.getUserNotifications("user-project-manager");
  assert.equal(managerNotifications.unreadCount, 1);
  assert.equal(managerNotifications.notifications[0].objectType, "risk");
});

test("project risk register summarizes blocking and resolved risks", () => {
  let register = workflow.getProjectRiskRegister("project-smart-controller");
  assert.equal(register.summary.totalRiskCount, 1);
  assert.equal(register.summary.openRiskCount, 1);
  assert.equal(register.summary.openBlockingRiskCount, 1);
  assert.equal(register.risks[0].blocksGate, true);
  assert.equal(register.risks[0].phaseName, "EVT Exit");

  workflow.updateRiskStatus("risk-thermal-margin", "ACCEPTED", { userId: "user-project-manager" });
  register = workflow.getProjectRiskRegister("project-smart-controller");
  assert.equal(register.summary.openBlockingRiskCount, 0);
  assert.equal(register.summary.acceptedRiskCount, 1);
  assert.equal(workflow.getProjectRiskRegister("missing-project"), null);
});

test("project snapshot summarizes project state without changing active project", () => {
  const created = workflow.createProject({
    name: "Snapshot Device",
    productLine: "IoT 产品线",
    activePhaseKey: "evt_exit",
    userId: "user-project-manager",
  });
  assert.equal(created.statusCode, 201);

  const createdSnapshot = workflow.getProjectSnapshot(created.body.project.id);
  assert.equal(createdSnapshot.project.name, "Snapshot Device");
  assert.equal(createdSnapshot.summary.phaseCount, 7);
  assert.equal(createdSnapshot.summary.workPackageCount, createdSnapshot.workPackages.length);
  assert.equal(createdSnapshot.currentPhase.name, "EVT Exit");

  const demoSnapshot = workflow.getProjectSnapshot("project-smart-controller");
  assert.equal(demoSnapshot.project.name, "智能控制器项目");
  assert.equal(workflow.getDemoProject().project.id, created.body.project.id);
  assert.equal(workflow.getProjectSnapshot("missing-project"), null);
});

test("project snapshot import validation catches conflicts and broken references", () => {
  const snapshot = workflow.getProjectSnapshot("project-smart-controller");
  const duplicate = workflow.validateProjectSnapshotImport(snapshot);

  assert.equal(duplicate.valid, false);
  assert.equal(duplicate.canImport, false);
  assert.equal(duplicate.errors.some((error) => error.message === "项目 ID 已存在，不能直接导入"), true);

  const renamed = makeImportableSnapshot(snapshot);

  const valid = workflow.validateProjectSnapshotImport(renamed);
  assert.equal(valid.valid, true);
  assert.equal(valid.summary.projectId, "project-importable");

  renamed.workPackages[0].phaseId = "missing-phase";
  const broken = workflow.validateProjectSnapshotImport(renamed);
  assert.equal(broken.valid, false);
  assert.equal(broken.errors.some((error) => error.message === "工作包 phaseId 未指向快照内阶段"), true);
});

test("project snapshot import creates a new active project and audit event", () => {
  const snapshot = workflow.getProjectSnapshot("project-smart-controller");
  const importable = makeImportableSnapshot(snapshot, "project-imported");

  const result = workflow.importProjectSnapshot({
    ...importable,
    actorUserId: "user-project-manager",
  });

  assert.equal(result.statusCode, 201);
  assert.equal(result.body.validation.valid, true);
  assert.equal(result.body.project.project.id, "project-imported");
  assert.equal(result.body.project.activeProjectId, "project-imported");
  assert.equal(result.body.project.phases.length, 7);
  assert.equal(result.body.project.workPackages.length, snapshot.workPackages.length);
  assert.equal(result.body.project.auditEvents.some((event) => event.eventType === "PROJECT_IMPORTED"), true);

  const duplicate = workflow.importProjectSnapshot(importable);
  assert.equal(duplicate.statusCode, 422);
  assert.equal(duplicate.body.valid, false);
});

test("project clone creates an independent active project copy", () => {
  const result = workflow.cloneProject("project-smart-controller", {
    name: "智能控制器项目 Copy",
    userId: "user-project-manager",
  });

  assert.equal(result.statusCode, 201);
  assert.equal(result.body.validation.valid, true);
  assert.equal(result.body.project.project.name, "智能控制器项目 Copy");
  assert.notEqual(result.body.project.project.id, "project-smart-controller");
  assert.equal(result.body.project.activeProjectId, result.body.project.project.id);
  assert.equal(result.body.project.phases.length, 7);
  assert.equal(result.body.project.workPackages.length, workflow.getProjectSnapshot("project-smart-controller").workPackages.length);
  assert.equal(result.body.project.auditEvents.some((event) => event.eventType === "PROJECT_CLONED"), true);

  const original = workflow.getProjectSnapshot("project-smart-controller");
  const copy = workflow.getProjectSnapshot(result.body.project.project.id);
  assert.equal(original.project.name, "智能控制器项目");
  assert.equal(copy.project.clonedFromProjectId, "project-smart-controller");
});

test("project creation expands the standard phase template", () => {
  const result = workflow.createProject({
    name: "智能门锁 V2",
    productLine: "IoT 产品线",
    activePhaseKey: "initiation",
    userId: "user-project-manager",
  });

  assert.equal(result.statusCode, 201);
  assert.equal(result.body.project.name, "智能门锁 V2");
  assert.equal(result.body.phases.length, 7);
  assert.equal(result.body.gates.length, 7);
  assert.ok(result.body.workPackages.length >= 3);
  assert.equal(result.body.phases[0].status, "GATE_BLOCKED");
});

test("project creation rejects unknown active phase keys", () => {
  const result = workflow.createProject({
    name: "非法阶段项目",
    productLine: "IoT 产品线",
    activePhaseKey: "unknown_phase",
    userId: "user-project-manager",
  });

  assert.equal(result.statusCode, 400);
  assert.equal(result.body.error, "activePhaseKey 不存在于硬件阶段模板");
  assert.ok(result.body.allowedPhaseKeys.includes("evt_exit"));
});

test("gate approval locks the current phase and advances to the next phase", () => {
  completeEvtWorkPackages();
  workflow.updateRiskStatus("risk-thermal-margin", "ACCEPTED", {
    userId: "user-project-manager",
  });

  const result = workflow.approveGate("gate-evt_exit", {
    userId: "user-project-manager",
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.project.currentPhaseId, "phase-dvt_exit");
  assert.equal(result.body.gate.status, "APPROVED");

  const project = workflow.getDemoProject();
  assert.equal(project.phases.find((phase) => phase.id === "phase-evt_exit").status, "LOCKED");
  assert.equal(project.phases.find((phase) => phase.id === "phase-dvt_exit").status, "GATE_BLOCKED");

  const repeated = workflow.approveGate("gate-evt_exit", {
    userId: "user-project-manager",
  });
  assert.equal(repeated.statusCode, 409);
  assert.equal(repeated.body.error, "阶段门已经批准，不能重复批准");
});

test("ready gate appears in approver action items", () => {
  completeEvtWorkPackages();
  workflow.updateRiskStatus("risk-thermal-margin", "ACCEPTED", {
    userId: "user-project-manager",
  });

  const projectManagerItems = workflow.getUserActionItems("user-project-manager");
  assert.equal(projectManagerItems.gateApprovals.length, 1);
  assert.equal(projectManagerItems.gateApprovals[0].gateId, "gate-evt_exit");
});

test("completed projects cannot receive new phase risks", () => {
  const created = workflow.createProject({
    name: "Final Release Project",
    productLine: "IoT 产品线",
    activePhaseKey: "mp_readiness",
    userId: "user-project-manager",
  });
  assert.equal(created.statusCode, 201);

  const projectId = created.body.project.id;
  const idPrefix = `${projectId}-`;
  completeWorkPackages(
    [
      {
        workPackageId: "wp-mp_readiness-mp_readiness_pack",
        agentKey: "manufacturing_agent",
        reviewerUserId: "user-mfg-lead",
      },
      {
        workPackageId: "wp-mp_readiness-quality_release_summary",
        agentKey: "quality_agent",
        reviewerUserId: "user-quality-lead",
      },
      {
        workPackageId: "wp-mp_readiness-final_project_gate_summary",
        agentKey: "pm_agent",
        reviewerUserId: "user-project-manager",
      },
    ],
    idPrefix,
  );

  const approval = workflow.approveGate(`${idPrefix}gate-mp_readiness`, {
    userId: "user-project-manager",
  });
  assert.equal(approval.statusCode, 200);
  assert.equal(approval.body.project.status, "COMPLETED");

  const risk = workflow.createDemoRiskForCurrentPhase({
    title: "完成后风险",
    severity: "HIGH",
  });
  assert.equal(risk.statusCode, 409);
  assert.equal(risk.body.error, "项目已完成，不能继续创建阶段风险");
});

test("gate approval advances within the same project in multi-project stores", () => {
  const created = workflow.createProject({
    name: "Alpha Device",
    productLine: "IoT 产品线",
    activePhaseKey: "evt_exit",
    userId: "user-project-manager",
  });
  assert.equal(created.statusCode, 201);

  const projectId = created.body.project.id;
  const idPrefix = `${projectId}-`;
  completeEvtWorkPackages(idPrefix);

  const result = workflow.approveGate(`${idPrefix}gate-evt_exit`, {
    userId: "user-project-manager",
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.project.currentPhaseId, `${idPrefix}phase-dvt_exit`);
  assert.notEqual(result.body.project.currentPhaseId, "phase-dvt_exit");
});
