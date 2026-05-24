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
