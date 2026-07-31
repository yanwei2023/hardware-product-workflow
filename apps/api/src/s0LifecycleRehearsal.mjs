import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "hardware-flow-s0-rehearsal-"),
);
process.env.HARDWARE_FLOW_STORE_PATH = path.join(tempDir, "store.json");
process.env.HARDWARE_FLOW_ACCESS_LOG = "0";

const workflow = await import("./server.mjs");
const completedSteps = [];

function assertStatus(result, expectedStatus, label) {
  assert.equal(
    result.statusCode,
    expectedStatus,
    `${label}: ${JSON.stringify(result.body)}`,
  );
  return result.body;
}

try {
  const created = assertStatus(
    workflow.createProjectCandidate({
      name: "S0 局域网试点候选",
      productConcept: "面向工业客户现场检测场景的通用新产品",
      userId: "user-project-manager",
    }),
    201,
    "创建 S0 候选项目",
  );
  const projectId = created.project.id;
  completedSteps.push("PROJECT_CANDIDATE_CREATED");

  assertStatus(
    workflow.updateInitiationDefinition(projectId, {
      actorUserId: "user-project-manager",
      projectTypeKey: "new_product_development",
      targetMarkets: ["工业客户"],
      customerScenarios: ["现场检测"],
      capabilityKeys: [
        "electronic_hardware",
        "measurement_signal_chain",
      ],
      technicalScope: ["硬件"],
      complianceRequirements: ["目标市场准入要求"],
      supplyMode: "自研加外协",
      deliveryModel: "产品发布后项目交付",
      operationsRequirements: ["培训", "售后"],
      riskLevel: "MEDIUM",
    }),
    200,
    "保存完整立项定义",
  );
  completedSteps.push("INITIATION_DEFINITION_COMPLETED");

  let s0AgentJobCount = 0;
  while (true) {
    const result = workflow.processNextAgentJob({
      workerId: "s0-pilot-worker",
    });
    assert.equal(result.statusCode, 200, JSON.stringify(result.body));
    if (!result.body.processed) {
      break;
    }
    s0AgentJobCount += 1;
  }
  assert.equal(s0AgentJobCount, 10);
  completedSteps.push("S0_AGENT_JOBS_COMPLETED");

  const s0View = workflow.getDemoProject();
  const requiredS0WorkPackages = s0View.workPackages.filter(
    (item) => (
      item.phaseId === s0View.project.currentPhaseId
      && item.requiredForGate
    ),
  );
  assert.equal(requiredS0WorkPackages.length, 8);
  for (const workPackage of requiredS0WorkPackages) {
    const rolePair = s0View.rolePairs.find(
      (item) => item.id === workPackage.rolePairId,
    );
    assert.ok(rolePair, `工作包 ${workPackage.id} 缺少角色对`);
    assertStatus(
      workflow.submitHumanReview({
        workPackageId: workPackage.id,
        reviewerUserId: rolePair.humanUserId,
        decision: "APPROVE",
        comment: "S0 局域网试点演练批准。",
      }),
      201,
      `审核 ${workPackage.id}`,
    );
  }
  completedSteps.push("S0_HUMAN_REVIEWS_APPROVED");

  const s0GateId = `${projectId}-gate-s0_governance`;
  assert.equal(
    workflow.checkGate(s0GateId).status,
    "READY",
    "S0 Gate 应在 Agent 输出和人工审核完成后进入 READY",
  );
  assertStatus(
    workflow.approveGate(s0GateId, {
      userId: "user-project-manager",
      comment: "S0 证据与立项基线满足正式配置条件。",
    }),
    200,
    "批准 S0 Gate",
  );
  completedSteps.push("S0_GATE_APPROVED");

  const configurationView = workflow.getDemoProject();
  const blueprintWorkPackage = configurationView.workPackages.find(
    (item) => item.metadata?.workType === "PROJECT_BLUEPRINT",
  );
  assert.ok(blueprintWorkPackage, "S0 Gate 批准后应创建项目蓝图工作包");

  const blueprintRun = workflow.processNextAgentJob({
    workerId: "blueprint-pilot-worker",
  });
  assert.equal(blueprintRun.statusCode, 200, JSON.stringify(blueprintRun.body));
  assert.equal(blueprintRun.body.processed, true);
  assert.equal(
    blueprintRun.body.result.artifact.artifactType,
    "PROJECT_BLUEPRINT",
  );
  completedSteps.push("PROJECT_BLUEPRINT_GENERATED");

  const blueprintReview = assertStatus(
    workflow.submitHumanReview({
      workPackageId: blueprintWorkPackage.id,
      reviewerUserId: "user-project-manager",
      decision: "APPROVE",
      comment: "批准发布 S1-S10 正式执行蓝图。",
    }),
    201,
    "批准项目蓝图",
  );
  assert.equal(blueprintReview.publication.published, true);
  completedSteps.push("PROJECT_BLUEPRINT_PUBLISHED");

  const active = workflow.getDemoProject();
  const formalPhases = active.phases.filter(
    (phase) => phase.phaseKey !== "s0_governance",
  );
  const currentPhase = active.phases.find(
    (phase) => phase.id === active.project.currentPhaseId,
  );
  const currentPhaseWorkPackageIds = new Set(
    active.workPackages
      .filter((item) => item.phaseId === active.project.currentPhaseId)
      .map((item) => item.id),
  );
  const s1QueuedAgentJobCount = active.agentJobs.filter(
    (job) => (
      job.status === "QUEUED"
      && currentPhaseWorkPackageIds.has(job.workPackageId)
    ),
  ).length;

  assert.equal(active.phases.length, 11);
  assert.equal(formalPhases.length, 10);
  assert.equal(currentPhase?.phaseKey, "s1_market_definition");
  assert.equal(s1QueuedAgentJobCount > 0, true);
  completedSteps.push("S1_AGENT_JOBS_QUEUED");

  console.log(
    JSON.stringify(
      {
        ok: true,
        projectId,
        phaseCount: active.phases.length,
        formalPhaseCount: formalPhases.length,
        currentPhaseKey: currentPhase.phaseKey,
        s0AgentJobCount,
        s0RequiredReviewCount: requiredS0WorkPackages.length,
        s1QueuedAgentJobCount,
        completedSteps,
      },
      null,
      2,
    ),
  );
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
