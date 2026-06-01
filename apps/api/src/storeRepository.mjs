function bySequence(a, b) {
  return (a.sequence || 0) - (b.sequence || 0);
}

export function getCurrentProject(store) {
  return store.projects.find((project) => project.id === store.activeProjectId) || store.projects[0] || null;
}

export function getCurrentGate(store) {
  const project = getCurrentProject(store);
  return project ? store.gates.find((gate) => gate.phaseId === project.currentPhaseId) || null : null;
}

export function findProject(store, projectId) {
  return store.projects.find((item) => item.id === projectId) || null;
}

export function findPhase(store, phaseId) {
  return store.phases.find((item) => item.id === phaseId) || null;
}

export function findRolePair(store, rolePairId) {
  return store.rolePairs.find((item) => item.id === rolePairId) || null;
}

export function findWorkPackage(store, workPackageId) {
  return store.workPackages.find((item) => item.id === workPackageId) || null;
}

export function findNotification(store, notificationId) {
  return (store.notifications || []).find((item) => item.id === notificationId) || null;
}

export function findGate(store, gateId) {
  return store.gates.find((item) => item.id === gateId) || null;
}

export function findReview(store, reviewId) {
  return store.reviews.find((item) => item.id === reviewId) || null;
}

export function findRisk(store, riskId) {
  return store.risks.find((item) => item.id === riskId) || null;
}

export function addAuditEventInStore(
  store,
  {
    id,
    projectId = null,
    eventType,
    actorType,
    actorId,
    objectType,
    objectId,
    payload = {},
    createdAt = new Date().toISOString(),
  } = {},
) {
  const auditEvent = {
    id,
    projectId,
    eventType,
    actorType,
    actorId,
    objectType,
    objectId,
    payload,
    createdAt,
  };
  store.auditEvents.push(auditEvent);
  return auditEvent;
}

export function addNotificationInStore(
  store,
  {
    id,
    projectId = null,
    userId,
    title,
    message = "",
    type = "INFO",
    status = "UNREAD",
    objectType = null,
    objectId = null,
    createdAt = new Date().toISOString(),
  } = {},
) {
  const notification = {
    id,
    projectId,
    userId,
    title,
    message,
    type,
    status,
    objectType,
    objectId,
    createdAt,
  };
  store.notifications.push(notification);
  return notification;
}

export function updateGateReadinessInStore(store, gateId, readinessStatus) {
  const gate = findGate(store, gateId);
  if (!gate) {
    return null;
  }

  const gateStatus = readinessStatus === "READY" ? "GATE_READY" : "GATE_BLOCKED";
  gate.status = gateStatus;
  const phase = findPhase(store, gate.phaseId);
  if (phase) {
    phase.status = gateStatus;
  }

  return {
    gate,
    phase,
  };
}

export function markNotificationReadInStore(store, notificationId, { readAt = new Date().toISOString() } = {}) {
  const notification = findNotification(store, notificationId);
  if (!notification) {
    return null;
  }

  notification.status = "READ";
  notification.readAt = readAt;
  return notification;
}

export function markProjectUserNotificationsReadInStore(
  store,
  projectId,
  userId,
  { readAt = new Date().toISOString() } = {},
) {
  let updatedCount = 0;
  for (const notification of store.notifications || []) {
    if (notification.userId === userId && notification.projectId === projectId && notification.status === "UNREAD") {
      notification.status = "READ";
      notification.readAt = readAt;
      updatedCount += 1;
    }
  }
  return updatedCount;
}

export function updateWorkPackageScheduleInStore(store, workPackageId, dueAt) {
  const workPackage = findWorkPackage(store, workPackageId);
  if (!workPackage) {
    return null;
  }

  workPackage.dueAt = dueAt || null;
  return workPackage;
}

export function addWorkPackageEvidenceRefInStore(
  store,
  workPackageId,
  { id, label, ref, createdByUserId, createdAt = new Date().toISOString() } = {},
) {
  const workPackage = findWorkPackage(store, workPackageId);
  if (!workPackage) {
    return null;
  }

  const evidenceRef = {
    id,
    projectId: workPackage.projectId,
    workPackageId: workPackage.id,
    label,
    ref,
    createdByUserId,
    createdAt,
  };
  store.evidenceRefs.push(evidenceRef);
  return evidenceRef;
}

export function addGateApprovalPackInStore(
  store,
  {
    id,
    projectId,
    gateId,
    phaseId,
    approvedByUserId,
    approvedAt,
    approvalComment = "",
    reviewPack,
  } = {},
) {
  const approvalPack = {
    id,
    projectId,
    gateId,
    phaseId,
    approvedByUserId,
    approvedAt,
    approvalComment,
    reviewPack,
  };
  store.gateApprovalPacks.push(approvalPack);
  return approvalPack;
}

export function addRiskInStore(store, risk) {
  store.risks.push(risk);
  return risk;
}

export function updateRiskMitigationInStore(
  store,
  riskId,
  {
    mitigation = "",
    mitigationDueAt = null,
    mitigationOwnerUserId = null,
    updatedAt = new Date().toISOString(),
    updatedByUserId = "user-project-manager",
  } = {},
) {
  const risk = findRisk(store, riskId);
  if (!risk) {
    return null;
  }

  risk.mitigation = mitigation;
  risk.mitigationDueAt = mitigationDueAt || null;
  risk.mitigationOwnerUserId = mitigationOwnerUserId || null;
  risk.mitigationStatus = mitigation || mitigationDueAt || mitigationOwnerUserId ? "OPEN" : null;
  risk.mitigationCompletedAt = null;
  risk.mitigationCompletedByUserId = null;
  risk.mitigationCompletionComment = "";
  risk.mitigationUpdatedAt = updatedAt;
  risk.mitigationUpdatedByUserId = updatedByUserId;
  return risk;
}

export function completeRiskMitigationInStore(
  store,
  riskId,
  {
    completedAt = new Date().toISOString(),
    completedByUserId = "user-project-manager",
    completionComment = "",
  } = {},
) {
  const risk = findRisk(store, riskId);
  if (!risk) {
    return null;
  }

  risk.mitigationStatus = "DONE";
  risk.mitigationCompletedAt = completedAt;
  risk.mitigationCompletedByUserId = completedByUserId;
  risk.mitigationCompletionComment = completionComment;
  return risk;
}

export function updateRiskStatusInStore(
  store,
  riskId,
  {
    status,
    actorUserId = "",
    comment = "",
    changedAt = new Date().toISOString(),
  } = {},
) {
  const risk = findRisk(store, riskId);
  if (!risk) {
    return null;
  }

  risk.status = status;
  if (status === "ACCEPTED") {
    risk.acceptedByUserId = actorUserId;
    risk.acceptedAt = changedAt;
    risk.acceptedComment = comment;
  }

  if (status === "CLOSED") {
    risk.closedByUserId = actorUserId;
    risk.closedAt = changedAt;
    risk.closedComment = comment;
  }

  return risk;
}

export function completeReviewConditionsInStore(
  store,
  reviewId,
  {
    completedAt = new Date().toISOString(),
    completedByUserId = "",
    completionComment = "",
  } = {},
) {
  const review = findReview(store, reviewId);
  if (!review) {
    return null;
  }

  review.conditionsCompletedAt = completedAt;
  review.conditionsCompletedByUserId = completedByUserId;
  review.conditionsCompletionComment = completionComment;
  return review;
}

export function updateRolePairOwnerInStore(store, rolePairId, humanUserId) {
  const rolePair = findRolePair(store, rolePairId);
  if (!rolePair) {
    return null;
  }

  const previousHumanUserId = rolePair.humanUserId;
  rolePair.humanUserId = humanUserId;
  return {
    rolePair,
    previousHumanUserId,
    changed: previousHumanUserId !== humanUserId,
  };
}

export function selectProjectInStore(store, projectId) {
  const project = findProject(store, projectId);
  if (!project) {
    return null;
  }

  store.activeProjectId = project.id;
  return project;
}

export function archiveProjectInStore(
  store,
  projectId,
  { archivedAt = new Date().toISOString(), archivedByUserId = "user-project-manager" } = {},
) {
  const project = findProject(store, projectId);
  if (!project) {
    return null;
  }

  const previousStatus = project.status;
  project.previousStatus = previousStatus;
  project.status = "ARCHIVED";
  project.archivedAt = archivedAt;
  project.archivedByUserId = archivedByUserId;

  let replacementProject = null;
  if (store.activeProjectId === project.id) {
    replacementProject = store.projects.find((item) => item.id !== project.id && item.status !== "ARCHIVED") || null;
    if (replacementProject) {
      store.activeProjectId = replacementProject.id;
    }
  }

  return { project, previousStatus, replacementProject };
}

export function restoreProjectInStore(
  store,
  projectId,
  { restoredAt = new Date().toISOString(), restoredByUserId = "user-project-manager" } = {},
) {
  const project = findProject(store, projectId);
  if (!project) {
    return null;
  }

  const restoredStatus = project.previousStatus || "IN_PROGRESS";
  project.status = restoredStatus;
  project.restoredAt = restoredAt;
  project.restoredByUserId = restoredByUserId;
  delete project.previousStatus;
  store.activeProjectId = project.id;

  return { project, restoredStatus };
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

export function getUserActionItemsReadModel(
  store,
  projectId,
  userId,
  {
    scheduleStatus = () => null,
    loadArtifactTemplate = () => null,
    canReviewWorkPackage = () => ({ allowed: false }),
    canApproveWorkPackage = () => ({ allowed: false }),
    canAcceptRisk = () => ({ allowed: false }),
    canApproveGate = () => ({ allowed: false }),
    currentGateReadiness = null,
  } = {},
) {
  const model = getProjectReadModel(store, projectId);
  if (!model) {
    return null;
  }

  const { project, phaseIds, rolePairs, workPackages, artifactVersions, reviews, risks, currentGate } = model;
  const pendingReviews = [];
  const scheduleAlerts = [];
  const conditionalApprovals = [];

  for (const workPackage of workPackages) {
    const rolePair = rolePairs.find((item) => item.id === workPackage.rolePairId) || null;
    const workPackageScheduleStatus = scheduleStatus(workPackage);
    if (rolePair?.humanUserId === userId && (workPackageScheduleStatus === "OVERDUE" || workPackageScheduleStatus === "DUE_SOON")) {
      scheduleAlerts.push({
        type: "WORK_PACKAGE_SCHEDULE",
        workPackageId: workPackage.id,
        title: workPackage.title,
        phaseId: workPackage.phaseId,
        dueAt: workPackage.dueAt,
        scheduleStatus: workPackageScheduleStatus,
      });
    }

    if (rolePair?.humanUserId === userId) {
      const latestConditionalReview = [...reviews]
        .reverse()
        .find(
          (item) =>
            item.workPackageId === workPackage.id &&
            item.decision === "APPROVE_WITH_CONDITIONS" &&
            Array.isArray(item.conditions) &&
            item.conditions.length > 0 &&
            !item.conditionsCompletedAt,
        );
      if (latestConditionalReview) {
        conditionalApprovals.push({
          type: "CONDITIONAL_APPROVAL",
          workPackageId: workPackage.id,
          reviewId: latestConditionalReview.id,
          title: workPackage.title,
          phaseId: workPackage.phaseId,
          reviewerUserId: latestConditionalReview.reviewerUserId,
          reviewedAt: latestConditionalReview.reviewedAt,
          comment: latestConditionalReview.comment || "",
          conditions: latestConditionalReview.conditions,
          conditionsCompletedAt: latestConditionalReview.conditionsCompletedAt || null,
        });
      }
    }

    const pendingArtifact = [...artifactVersions]
      .reverse()
      .find((item) => item.workPackageId === workPackage.id && item.status === "PENDING_REVIEW");
    if (!pendingArtifact) {
      continue;
    }

    const artifactTemplate = loadArtifactTemplate(workPackage);
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
    ? risks
        .filter(
          (risk) =>
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
  const riskMitigations = risks
    .filter(
      (risk) =>
        phaseIds.has(risk.phaseId) &&
        risk.mitigationOwnerUserId === userId &&
        risk.status !== "CLOSED" &&
        risk.mitigationStatus !== "DONE",
    )
    .map((risk) => ({
      type: "RISK_MITIGATION",
      riskId: risk.id,
      title: risk.title,
      phaseId: risk.phaseId,
      severity: risk.severity,
      riskStatus: risk.status,
      dueAt: risk.mitigationDueAt || null,
      scheduleStatus: scheduleStatus({ dueAt: risk.mitigationDueAt, status: "OPEN" }),
      mitigation: risk.mitigation || "",
    }));

  const gateApprovals = [];
  const gateApprovalPermission = canApproveGate(userId);
  if (currentGate && gateApprovalPermission.allowed && currentGateReadiness?.status === "READY") {
    gateApprovals.push({
      type: "GATE_APPROVAL",
      gateId: currentGate.id,
      title: currentGate.name,
      phaseId: currentGate.phaseId,
    });
  }

  return {
    userId,
    projectId: project.id,
    pendingReviews,
    scheduleAlerts,
    conditionalApprovals,
    riskDecisions,
    riskMitigations,
    gateApprovals,
    total:
      pendingReviews.length +
      scheduleAlerts.length +
      conditionalApprovals.length +
      riskDecisions.length +
      riskMitigations.length +
      gateApprovals.length,
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

export function getActiveProjectReadModel(
  store,
  projectId,
  {
    latestGateCheck = null,
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
    artifactVersions,
    reviews,
    evidenceRefs,
    gateApprovalPacks,
    risks,
    agentRuns,
    agentFindings,
    auditEvents,
  } = model;
  const conditionalApprovalReviews = reviews.filter(
    (item) => item.decision === "APPROVE_WITH_CONDITIONS" && Array.isArray(item.conditions) && item.conditions.length > 0,
  );

  return {
    project,
    projects: store.projects,
    projectSummaries: getProjectListReadModel(store, {
      scheduleStatus,
      summarizeRiskMitigations,
    }),
    activeProjectId: store.activeProjectId,
    phases,
    gates,
    rolePairs,
    workPackages: workPackages.map((item) => ({
      ...item,
      scheduleStatus: scheduleStatus(item),
    })),
    artifactVersions,
    reviews,
    evidenceRefs,
    gateApprovalPacks,
    risks,
    agentRuns,
    agentFindings,
    auditEvents,
    latestGateCheck,
    scheduleSummary: {
      overdueWorkPackageCount: workPackages.filter((item) => scheduleStatus(item) === "OVERDUE").length,
      dueSoonWorkPackageCount: workPackages.filter((item) => scheduleStatus(item) === "DUE_SOON").length,
      unscheduledWorkPackageCount: workPackages.filter((item) => scheduleStatus(item) === "UNSCHEDULED").length,
    },
    conditionalApprovalSummary: {
      conditionalApprovalCount: conditionalApprovalReviews.length,
      openConditionalApprovalCount: conditionalApprovalReviews.filter((item) => !item.conditionsCompletedAt).length,
      completedConditionalApprovalCount: conditionalApprovalReviews.filter((item) => item.conditionsCompletedAt).length,
    },
    riskMitigationSummary: summarizeRiskMitigations(risks),
  };
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

export function getGateReviewPackReadModel(store, gateId, { readiness = null } = {}) {
  const gate = store.gates.find((item) => item.id === gateId);
  if (!gate) {
    return null;
  }

  const project = store.projects.find((item) => item.id === gate.projectId) || null;
  const phase = store.phases.find((item) => item.id === gate.phaseId) || null;
  const gateReadiness = readiness || { status: gate.status, blockers: [] };
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
    const manualEvidenceRefs = workPackage
      ? (store.evidenceRefs || []).filter((item) => item.workPackageId === workPackage.id)
      : [];
    const approvedArtifact = artifacts.find((item) => item.status === "APPROVED" || item.status === "LOCKED") || null;
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
      approvedReviewDecision: approvedReview?.decision || null,
      approvedReviewComment: approvedReview?.comment || "",
      approvedReviewConditions: approvedReview?.conditions || [],
      approvedReviewConditionsCompletedAt: approvedReview?.conditionsCompletedAt || null,
      approvedReviewConditionsCompletedByUserId: approvedReview?.conditionsCompletedByUserId || null,
      approvedReviewConditionsCompletionComment: approvedReview?.conditionsCompletionComment || "",
      approvedReviewedAt: approvedReview?.reviewedAt || null,
      manualEvidenceCount: manualEvidenceRefs.length,
      manualEvidenceRefs,
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
      mitigationStatus: risk.mitigationStatus || null,
      mitigationOwnerUserId: risk.mitigationOwnerUserId || null,
      mitigationDueAt: risk.mitigationDueAt || null,
      mitigation: risk.mitigation || "",
      mitigationCompletedAt: risk.mitigationCompletedAt || null,
      mitigationCompletedByUserId: risk.mitigationCompletedByUserId || null,
      mitigationCompletionComment: risk.mitigationCompletionComment || "",
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
      approvalComment: gate.approvalComment || "",
    },
    readiness: gateReadiness,
    evidence,
    risks,
    blockers: gateReadiness.blockers,
    summary: {
      requiredEvidenceCount: evidence.length,
      readyEvidenceCount: evidence.filter((item) => item.ready).length,
      manualEvidenceRefCount: evidence.reduce((total, item) => total + item.manualEvidenceCount, 0),
      conditionalApprovalCount: evidence.filter((item) => item.approvedReviewConditions?.length).length,
      openConditionalApprovalCount: evidence.filter((item) => item.approvedReviewConditions?.length && !item.approvedReviewConditionsCompletedAt).length,
      completedConditionalApprovalCount: evidence.filter((item) => item.approvedReviewConditions?.length && item.approvedReviewConditionsCompletedAt).length,
      openBlockingRiskCount: risks.filter((item) => item.blocksGate).length,
      blockerCount: gateReadiness.blockers.length,
      readyForApproval: gateReadiness.status === "READY",
    },
  };
}

export function getLatestGateApprovalPack(store, gateId) {
  return (
    (store.gateApprovalPacks || [])
      .filter((item) => item.gateId === gateId)
      .sort((a, b) => String(b.approvedAt).localeCompare(String(a.approvedAt)))[0] || null
  );
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
