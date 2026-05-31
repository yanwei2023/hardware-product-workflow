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

export function getProjectListItemReadModel(
  store,
  projectId,
  { scheduleStatus = () => null, summarizeRiskMitigations = () => ({}) } = {},
) {
  const model = getProjectReadModel(store, projectId);
  if (!model) {
    return null;
  }

  const { project, currentPhase, currentGate, workPackages, reviews, risks } = model;
  const conditionalApprovalReviews = reviews.filter(
    (review) => review.decision === "APPROVE_WITH_CONDITIONS" && Array.isArray(review.conditions) && review.conditions.length > 0,
  );

  return {
    ...project,
    currentPhaseName: currentPhase?.name || project.currentPhaseId,
    currentGateName: currentGate?.name || null,
    currentGateStatus: currentGate?.status || null,
    workPackageCount: workPackages.length,
    overdueWorkPackageCount: workPackages.filter((workPackage) => scheduleStatus(workPackage) === "OVERDUE").length,
    openHighRiskCount: risks.filter(
      (risk) =>
        (risk.severity === "HIGH" || risk.severity === "CRITICAL") &&
        risk.status !== "CLOSED" &&
        risk.status !== "ACCEPTED",
    ).length,
    openConditionalApprovalCount: conditionalApprovalReviews.filter((review) => !review.conditionsCompletedAt).length,
    ...summarizeRiskMitigations(risks),
  };
}

export function getProjectListReadModel(store, options = {}) {
  return store.projects.map((project) => getProjectListItemReadModel(store, project.id, options)).filter(Boolean);
}

export function getProjectRiskRegisterReadModel(
  store,
  projectId,
  { exportedAt = () => new Date().toISOString(), summarizeRiskMitigations = () => ({}) } = {},
) {
  const model = getProjectReadModel(store, projectId);
  if (!model) {
    return null;
  }

  const { project, phases } = model;
  const risks = model.risks
    .map((risk) => ({
      ...risk,
      phaseName: phases.find((phase) => phase.id === risk.phaseId)?.name || risk.phaseId,
      decisionUserId: risk.closedByUserId || risk.acceptedByUserId || null,
      decisionComment: risk.closedComment || risk.acceptedComment || "",
      blocksGate:
        (risk.severity === "HIGH" || risk.severity === "CRITICAL") &&
        risk.status !== "CLOSED" &&
        risk.status !== "ACCEPTED",
    }))
    .sort((a, b) => {
      const phaseA = phases.find((phase) => phase.id === a.phaseId)?.sequence || 0;
      const phaseB = phases.find((phase) => phase.id === b.phaseId)?.sequence || 0;
      return phaseA - phaseB || a.title.localeCompare(b.title);
    });

  return {
    exportedAt: exportedAt(),
    project,
    summary: {
      totalRiskCount: risks.length,
      openRiskCount: risks.filter((risk) => risk.status === "OPEN").length,
      openBlockingRiskCount: risks.filter((risk) => risk.blocksGate).length,
      acceptedRiskCount: risks.filter((risk) => risk.status === "ACCEPTED").length,
      closedRiskCount: risks.filter((risk) => risk.status === "CLOSED").length,
      ...summarizeRiskMitigations(risks),
    },
    risks,
  };
}

export function getProjectSnapshotReadModel(
  store,
  projectId,
  {
    exportedAt = () => new Date().toISOString(),
    scheduleStatus = () => null,
    summarizeRiskMitigations = () => ({}),
  } = {},
) {
  const model = getProjectReadModel(store, projectId);
  if (!model) {
    return null;
  }

  const {
    project,
    phases,
    gates,
    rolePairs,
    workPackages,
    evidenceRefs,
    gateApprovalPacks,
    risks,
    reviews,
    currentPhase,
    currentGate,
    auditEvents,
    notifications,
    gateRequirements,
    artifactVersions,
    agentRuns,
    agentFindings,
  } = model;
  const conditionalApprovalReviews = reviews.filter(
    (item) => item.decision === "APPROVE_WITH_CONDITIONS" && Array.isArray(item.conditions) && item.conditions.length > 0,
  );

  return {
    exportedAt: exportedAt(),
    project,
    currentPhase,
    currentGate,
    summary: {
      phaseCount: phases.length,
      workPackageCount: workPackages.length,
      approvedWorkPackageCount: workPackages.filter((item) => item.status === "HUMAN_APPROVED" || item.status === "LOCKED").length,
      overdueWorkPackageCount: workPackages.filter((item) => scheduleStatus(item) === "OVERDUE").length,
      dueSoonWorkPackageCount: workPackages.filter((item) => scheduleStatus(item) === "DUE_SOON").length,
      riskCount: risks.length,
      openHighRiskCount: risks.filter(
        (risk) =>
          (risk.severity === "HIGH" || risk.severity === "CRITICAL") &&
          risk.status !== "CLOSED" &&
          risk.status !== "ACCEPTED",
      ).length,
      ...summarizeRiskMitigations(risks),
      evidenceRefCount: evidenceRefs.length,
      gateApprovalPackCount: gateApprovalPacks.length,
      conditionalApprovalCount: conditionalApprovalReviews.length,
      openConditionalApprovalCount: conditionalApprovalReviews.filter((item) => !item.conditionsCompletedAt).length,
      completedConditionalApprovalCount: conditionalApprovalReviews.filter((item) => item.conditionsCompletedAt).length,
      notificationCount: notifications.length,
      auditEventCount: auditEvents.length,
    },
    phases,
    gates,
    gateRequirements,
    rolePairs,
    workPackages: workPackages.map((workPackage) => {
      const rolePair = rolePairs.find((item) => item.id === workPackage.rolePairId) || null;
      return {
        ...workPackage,
        phaseName: phases.find((phase) => phase.id === workPackage.phaseId)?.name || workPackage.phaseId,
        ownerUserId: rolePair?.humanUserId || null,
        agentKey: rolePair?.agentKey || null,
        scheduleStatus: scheduleStatus(workPackage),
      };
    }),
    artifactVersions,
    reviews,
    evidenceRefs,
    gateApprovalPacks,
    risks: risks.map((risk) => ({
      ...risk,
      phaseName: phases.find((phase) => phase.id === risk.phaseId)?.name || risk.phaseId,
    })),
    agentRuns,
    agentFindings,
    notifications,
    auditEvents,
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
