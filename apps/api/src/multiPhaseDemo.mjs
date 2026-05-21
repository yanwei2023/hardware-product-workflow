import {
  approveGate,
  getDemoProject,
  resetDemoStore,
  runAgentWorkPackage,
  submitHumanReview,
  updateRiskStatus,
} from "./server.mjs";

function currentPhaseSnapshot() {
  const project = getDemoProject();
  const phase = project.phases.find((item) => item.id === project.project.currentPhaseId);
  const gate = project.gates.find((item) => item.phaseId === phase.id);
  return { project, phase, gate };
}

function completeCurrentPhase() {
  let { project, phase, gate } = currentPhaseSnapshot();
  const workPackages = project.workPackages.filter((item) => item.phaseId === phase.id);

  for (const workPackage of workPackages) {
    const rolePair = project.rolePairs.find((item) => item.id === workPackage.rolePairId);
    runAgentWorkPackage({
      workPackageId: workPackage.id,
      agentKey: rolePair.agentKey,
      inputRefs: [`artifact:${phase.phaseKey}-demo-input`],
    });
    submitHumanReview({
      workPackageId: workPackage.id,
      reviewerUserId: rolePair.humanUserId,
      decision: "APPROVE",
      comment: `${phase.name} 演示批准。`,
    });
  }

  project = getDemoProject();
  for (const risk of project.risks.filter((item) => item.phaseId === phase.id && item.status === "OPEN")) {
    updateRiskStatus(risk.id, "ACCEPTED", {
      userId: "user-project-manager",
    });
  }

  const result = approveGate(gate.id, {
    userId: "user-project-manager",
  });

  return {
    phase: phase.name,
    statusCode: result.statusCode,
    nextPhaseId: getDemoProject().project.currentPhaseId,
  };
}

resetDemoStore();

console.log(JSON.stringify(completeCurrentPhase(), null, 2));
console.log(JSON.stringify(completeCurrentPhase(), null, 2));

const finalProject = getDemoProject();
console.log(
  finalProject.phases.map((phase) => `${phase.name}:${phase.status}`).join(" | "),
);

