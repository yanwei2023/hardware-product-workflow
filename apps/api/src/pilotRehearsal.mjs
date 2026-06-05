import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-pilot-rehearsal-"));
process.env.HARDWARE_FLOW_STORE_PATH = path.join(tempDir, "store.json");
process.env.HARDWARE_FLOW_ACCESS_LOG = "0";

const workflow = await import("./server.mjs");
const completedSteps = [];

function assertOk(result, label, expectedStatus = 200) {
  assert.equal(result.statusCode, expectedStatus, `${label}: ${JSON.stringify(result.body)}`);
  return result.body;
}

function recordStep(key, title, details = {}) {
  completedSteps.push({
    key,
    title,
    ...details,
  });
}

function currentPhaseWorkPackages() {
  const project = workflow.getDemoProject();
  return project.workPackages.filter((item) => item.phaseId === project.project.currentPhaseId);
}

function rolePairFor(workPackage) {
  return workflow.getDemoProject().rolePairs.find((item) => item.id === workPackage.rolePairId);
}

try {
  assertOk(workflow.createStorageCheckpoint({ label: "pilot-rehearsal-start" }), "create checkpoint", 201);
  recordStep("checkpoint", "创建试点演练检查点", { label: "pilot-rehearsal-start" });

  const scheduledWorkPackages = [];
  for (const [index, workPackage] of currentPhaseWorkPackages().entries()) {
    const dueAt = `2026-06-${String(10 + index).padStart(2, "0")}`;
    assertOk(
      workflow.updateWorkPackageSchedule(workPackage.id, {
        actorUserId: "user-project-manager",
        dueAt,
      }),
      `schedule ${workPackage.id}`,
    );
    scheduledWorkPackages.push(workPackage.id);
  }
  recordStep("schedule", "设置当前阶段工作包截止日期", { count: scheduledWorkPackages.length, workPackageIds: scheduledWorkPackages });

  const invalidOutput = workflow.runAgentWorkPackage({
    workPackageId: "wp-evt_exit-evt_test_report",
    inputRefs: ["artifact:invalid-rehearsal"],
    draftMarkdown: "# 无效草稿\n\n缺少模板必填章节。",
  });
  assert.equal(invalidOutput.statusCode, 422);
  recordStep("invalid_agent_guard", "确认无效 Agent 草稿会被拒绝", { statusCode: invalidOutput.statusCode });

  const generatedWorkPackages = [];
  const evidenceWorkPackages = [];
  const reviewedWorkPackages = [];
  for (const workPackage of currentPhaseWorkPackages()) {
    const rolePair = rolePairFor(workPackage);
    assertOk(
      workflow.runAgentWorkPackage({
        workPackageId: workPackage.id,
        agentKey: rolePair.agentKey,
        inputRefs: [`artifact:${workPackage.id}:pilot-rehearsal`],
      }),
      `agent ${workPackage.id}`,
      201,
    );
    generatedWorkPackages.push(workPackage.id);
    assertOk(
      workflow.addWorkPackageEvidenceRef(workPackage.id, {
        actorUserId: rolePair.humanUserId,
        label: `${workPackage.title} 试点证据`,
        ref: `pilot-rehearsal://${workPackage.id}`,
      }),
      `evidence ${workPackage.id}`,
      201,
    );
    evidenceWorkPackages.push(workPackage.id);
    assertOk(
      workflow.submitHumanReview({
        workPackageId: workPackage.id,
        reviewerUserId: rolePair.humanUserId,
        decision: "APPROVE",
        comment: "试点演练批准。",
      }),
      `review ${workPackage.id}`,
      201,
    );
    reviewedWorkPackages.push(workPackage.id);
  }
  recordStep("agent_drafts", "生成当前阶段 Agent 草稿", { count: generatedWorkPackages.length, workPackageIds: generatedWorkPackages });
  recordStep("evidence_refs", "补充阶段门证据引用", { count: evidenceWorkPackages.length, workPackageIds: evidenceWorkPackages });
  recordStep("human_reviews", "完成人类审核批准", { count: reviewedWorkPackages.length, workPackageIds: reviewedWorkPackages });

  assertOk(
    workflow.updateRiskMitigation("risk-thermal-margin", {
      userId: "user-project-manager",
      mitigationOwnerUserId: "user-quality-lead",
      mitigationDueAt: "2026-06-12",
      mitigation: "试点演练中确认热设计裕量风险由质量负责人跟踪关闭。",
    }),
    "risk mitigation",
  );
  recordStep("risk_mitigation", "保存阻塞风险缓解计划", { riskId: "risk-thermal-margin" });
  assertOk(
    workflow.updateRiskStatus("risk-thermal-margin", "ACCEPTED", {
      userId: "user-project-manager",
      comment: "试点演练接受风险。",
    }),
    "risk accept",
  );
  recordStep("risk_acceptance", "接受阻塞风险", { riskId: "risk-thermal-margin" });

  const gateCheck = workflow.checkGate("gate-evt_exit");
  assert.equal(gateCheck.status, "READY", JSON.stringify(gateCheck));
  recordStep("gate_ready", "确认 EVT Exit 阶段门 READY", { gateId: "gate-evt_exit" });

  const checklistBeforeApproval = workflow.getPilotChecklistStatus();
  const requiredPending = checklistBeforeApproval.items.filter((item) => item.severity === "REQUIRED" && item.status !== "DONE");
  assert.deepEqual(requiredPending, []);
  recordStep("required_checklist", "确认试点必需项全部完成", { requiredDone: checklistBeforeApproval.summary.requiredDone, requiredTotal: checklistBeforeApproval.summary.requiredTotal });

  assertOk(
    workflow.approveGate("gate-evt_exit", {
      userId: "user-project-manager",
      comment: "试点演练批准 EVT Exit。",
    }),
    "gate approval",
  );
  recordStep("gate_approval", "批准 EVT Exit 并推进项目阶段", { gateId: "gate-evt_exit" });

  const snapshot = workflow.getProjectSnapshot("project-smart-controller");
  assert.equal(snapshot.summary.auditEventCount > 0, true);
  assert.equal(snapshot.summary.notificationCount > 0, true);
  assert.equal(snapshot.summary.evidenceRefCount >= currentPhaseWorkPackages().length, true);
  recordStep("snapshot_verification", "确认审计、通知和证据链路已记录", {
    auditEventCount: snapshot.summary.auditEventCount,
    notificationCount: snapshot.summary.notificationCount,
    evidenceRefCount: snapshot.summary.evidenceRefCount,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        storePath: process.env.HARDWARE_FLOW_STORE_PATH,
        currentPhaseId: workflow.getDemoProject().project.currentPhaseId,
        checklistBeforeApproval: checklistBeforeApproval.summary,
        requiredPendingBeforeApproval: requiredPending,
        completedSteps,
        snapshot: {
          auditEventCount: snapshot.summary.auditEventCount,
          notificationCount: snapshot.summary.notificationCount,
          evidenceRefCount: snapshot.summary.evidenceRefCount,
          gateApprovalPackCount: snapshot.summary.gateApprovalPackCount,
        },
      },
      null,
      2,
    ),
  );
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
