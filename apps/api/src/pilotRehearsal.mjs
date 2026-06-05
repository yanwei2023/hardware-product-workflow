import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-pilot-rehearsal-"));
process.env.HARDWARE_FLOW_STORE_PATH = path.join(tempDir, "store.json");
process.env.HARDWARE_FLOW_ACCESS_LOG = "0";

const workflow = await import("./server.mjs");

function assertOk(result, label, expectedStatus = 200) {
  assert.equal(result.statusCode, expectedStatus, `${label}: ${JSON.stringify(result.body)}`);
  return result.body;
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

  for (const [index, workPackage] of currentPhaseWorkPackages().entries()) {
    const dueAt = `2026-06-${String(10 + index).padStart(2, "0")}`;
    assertOk(
      workflow.updateWorkPackageSchedule(workPackage.id, {
        actorUserId: "user-project-manager",
        dueAt,
      }),
      `schedule ${workPackage.id}`,
    );
  }

  const invalidOutput = workflow.runAgentWorkPackage({
    workPackageId: "wp-evt_exit-evt_test_report",
    inputRefs: ["artifact:invalid-rehearsal"],
    draftMarkdown: "# 无效草稿\n\n缺少模板必填章节。",
  });
  assert.equal(invalidOutput.statusCode, 422);

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
    assertOk(
      workflow.addWorkPackageEvidenceRef(workPackage.id, {
        actorUserId: rolePair.humanUserId,
        label: `${workPackage.title} 试点证据`,
        ref: `pilot-rehearsal://${workPackage.id}`,
      }),
      `evidence ${workPackage.id}`,
      201,
    );
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
  }

  assertOk(
    workflow.updateRiskMitigation("risk-thermal-margin", {
      userId: "user-project-manager",
      mitigationOwnerUserId: "user-quality-lead",
      mitigationDueAt: "2026-06-12",
      mitigation: "试点演练中确认热设计裕量风险由质量负责人跟踪关闭。",
    }),
    "risk mitigation",
  );
  assertOk(
    workflow.updateRiskStatus("risk-thermal-margin", "ACCEPTED", {
      userId: "user-project-manager",
      comment: "试点演练接受风险。",
    }),
    "risk accept",
  );

  const gateCheck = workflow.checkGate("gate-evt_exit");
  assert.equal(gateCheck.status, "READY", JSON.stringify(gateCheck));

  const checklistBeforeApproval = workflow.getPilotChecklistStatus();
  const requiredPending = checklistBeforeApproval.items.filter((item) => item.severity === "REQUIRED" && item.status !== "DONE");
  assert.deepEqual(requiredPending, []);

  assertOk(
    workflow.approveGate("gate-evt_exit", {
      userId: "user-project-manager",
      comment: "试点演练批准 EVT Exit。",
    }),
    "gate approval",
  );

  const snapshot = workflow.getProjectSnapshot("project-smart-controller");
  assert.equal(snapshot.summary.auditEventCount > 0, true);
  assert.equal(snapshot.summary.notificationCount > 0, true);
  assert.equal(snapshot.summary.evidenceRefCount >= currentPhaseWorkPackages().length, true);

  console.log(
    JSON.stringify(
      {
        ok: true,
        storePath: process.env.HARDWARE_FLOW_STORE_PATH,
        currentPhaseId: workflow.getDemoProject().project.currentPhaseId,
        checklistBeforeApproval: checklistBeforeApproval.summary,
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
