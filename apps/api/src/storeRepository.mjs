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

export function getProjectUserNotifications(store, projectId, userId, filters = {}) {
  const statusFilter = String(filters.status || "").toUpperCase();
  const typeFilter = String(filters.type || "").toUpperCase();
  const allNotifications = (store.notifications || [])
    .filter((item) => item.userId === userId && item.projectId === projectId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
    projectId,
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

export function getWorkPackageReadModel(store, workPackageId, { scheduleStatus = () => null } = {}) {
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
    scheduleStatus: scheduleStatus(workPackage),
  };
}
