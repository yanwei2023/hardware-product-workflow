function bySequence(a, b) {
  return (a.sequence || 0) - (b.sequence || 0);
}

export function getProjectReadModel(store, projectId) {
  const project = store.projects.find((item) => item.id === projectId);
  if (!project) {
    return null;
  }

  const phases = store.phases.filter((item) => item.projectId === project.id).sort(bySequence);
  const phaseIds = new Set(phases.map((item) => item.id));
  const gates = store.gates.filter((item) => item.projectId === project.id);
  const gateIds = new Set(gates.map((item) => item.id));
  const rolePairs = store.rolePairs.filter((item) => item.projectId === project.id);
  const workPackages = store.workPackages.filter((item) => item.projectId === project.id);
  const workPackageIds = new Set(workPackages.map((item) => item.id));
  const currentPhase = phases.find((item) => item.id === project.currentPhaseId) || null;
  const currentGate = currentPhase ? gates.find((item) => item.phaseId === currentPhase.id) || null : null;

  return {
    project,
    phases,
    phaseIds,
    gates,
    gateIds,
    rolePairs,
    workPackages,
    workPackageIds,
    currentPhase,
    currentGate,
    gateRequirements: store.gateRequirements.filter((item) => gateIds.has(item.gateId)),
    artifactVersions: store.artifactVersions.filter((item) => workPackageIds.has(item.workPackageId)),
    reviews: store.reviews.filter((item) => workPackageIds.has(item.workPackageId)),
    evidenceRefs: (store.evidenceRefs || []).filter((item) => workPackageIds.has(item.workPackageId)),
    gateApprovalPacks: (store.gateApprovalPacks || []).filter((item) => item.projectId === project.id),
    risks: store.risks.filter((item) => item.projectId === project.id && phaseIds.has(item.phaseId)),
    agentRuns: store.agentRuns.filter((item) => workPackageIds.has(item.workPackageId)),
    agentFindings: store.agentFindings.filter((item) => workPackageIds.has(item.workPackageId)),
    notifications: (store.notifications || []).filter((item) => item.projectId === project.id),
    auditEvents: store.auditEvents.filter((event) => !event.projectId || event.projectId === project.id),
  };
}
