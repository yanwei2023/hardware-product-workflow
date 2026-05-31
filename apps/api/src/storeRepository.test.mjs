import assert from "node:assert/strict";
import test from "node:test";
import { createDemoStore } from "./server.mjs";
import {
  getActiveProjectReadModel,
  getGateReviewPackReadModel,
  getLatestGateApprovalPack,
  getProjectListItemReadModel,
  getProjectListReadModel,
  getProjectReadModel,
  getProjectRiskRegisterReadModel,
  getProjectSnapshotReadModel,
  getProjectUserNotifications,
  getUserActionItemsReadModel,
  getWorkPackageReadModel,
} from "./storeRepository.mjs";

test("project read model scopes workflow records to one project", () => {
  const store = createDemoStore();
  store.projects.push({
    id: "project-other",
    name: "Other",
    currentPhaseId: "project-other-phase-evt_exit",
    status: "IN_PROGRESS",
  });
  store.phases.push({
    id: "project-other-phase-evt_exit",
    projectId: "project-other",
    name: "EVT Exit",
    sequence: 4,
    status: "GATE_BLOCKED",
  });
  store.gates.push({
    id: "project-other-gate-evt_exit",
    projectId: "project-other",
    phaseId: "project-other-phase-evt_exit",
    name: "Other Gate",
    status: "GATE_BLOCKED",
  });
  store.auditEvents.push(
    { id: "audit-global", eventType: "GLOBAL", actorType: "human", actorId: "user-project-manager", objectType: "system", objectId: "global" },
    { id: "audit-demo", projectId: "project-smart-controller", eventType: "DEMO", actorType: "human", actorId: "user-project-manager", objectType: "project", objectId: "project-smart-controller" },
    { id: "audit-other", projectId: "project-other", eventType: "OTHER", actorType: "human", actorId: "user-project-manager", objectType: "project", objectId: "project-other" },
  );

  const model = getProjectReadModel(store, "project-smart-controller");

  assert.equal(model.project.id, "project-smart-controller");
  assert.equal(model.phases.length, 7);
  assert.equal(model.currentPhase.id, "phase-evt_exit");
  assert.equal(model.currentGate.id, "gate-evt_exit");
  assert.equal(model.gates.some((gate) => gate.projectId === "project-other"), false);
  assert.equal(model.auditEvents.some((event) => event.id === "audit-global"), true);
  assert.equal(model.auditEvents.some((event) => event.id === "audit-demo"), true);
  assert.equal(model.auditEvents.some((event) => event.id === "audit-other"), false);
});

test("project read model returns null for unknown projects", () => {
  assert.equal(getProjectReadModel(createDemoStore(), "missing-project"), null);
});

test("project list read model summarizes workflow health", () => {
  const store = createDemoStore();
  store.workPackages.push({
    id: "wp-overdue-summary",
    projectId: "project-smart-controller",
    rolePairId: "role-systems",
    title: "逾期摘要工作包",
    status: "OPEN",
    dueAt: "2026-05-20",
  });
  store.reviews.push(
    {
      id: "review-conditions-open",
      workPackageId: "wp-evt_exit-evt_test_plan",
      reviewerUserId: "user-quality-lead",
      decision: "APPROVE_WITH_CONDITIONS",
      conditions: ["补齐测试覆盖矩阵"],
      reviewedAt: "2026-05-25T01:00:00.000Z",
    },
    {
      id: "review-conditions-closed",
      workPackageId: "wp-evt_exit-evt_test_report",
      reviewerUserId: "user-quality-lead",
      decision: "APPROVE_WITH_CONDITIONS",
      conditions: ["补充样机编号"],
      conditionsCompletedAt: "2026-05-26T01:00:00.000Z",
      reviewedAt: "2026-05-25T02:00:00.000Z",
    },
  );
  store.risks.push(
    {
      id: "risk-high-open",
      projectId: "project-smart-controller",
      phaseId: "phase-evt_exit",
      severity: "HIGH",
      status: "OPEN",
      mitigationOwnerUserId: "user-project-manager",
    },
    {
      id: "risk-critical-accepted",
      projectId: "project-smart-controller",
      phaseId: "phase-evt_exit",
      severity: "CRITICAL",
      status: "ACCEPTED",
      mitigationOwnerUserId: "user-project-manager",
    },
  );

  const summary = getProjectListItemReadModel(store, "project-smart-controller", {
    scheduleStatus: (workPackage) => (workPackage.id === "wp-overdue-summary" ? "OVERDUE" : "ON_TRACK"),
    summarizeRiskMitigations: (risks) => ({ mitigationPlanCount: risks.length }),
  });

  assert.equal(summary.id, "project-smart-controller");
  assert.equal(summary.currentPhaseName, "EVT Exit");
  assert.equal(summary.currentGateName, "EVT Exit 阶段门");
  assert.equal(summary.workPackageCount, 23);
  assert.equal(summary.overdueWorkPackageCount, 1);
  assert.equal(summary.openHighRiskCount, 2);
  assert.equal(summary.openConditionalApprovalCount, 1);
  assert.equal(summary.mitigationPlanCount, 3);
});

test("project list read model returns summaries for every project", () => {
  const store = createDemoStore();
  store.projects.push({
    id: "project-other",
    name: "Other",
    currentPhaseId: "project-other-phase",
    status: "PLANNED",
  });
  store.phases.push({
    id: "project-other-phase",
    projectId: "project-other",
    name: "Other Phase",
    sequence: 1,
    status: "IN_PROGRESS",
  });

  const summaries = getProjectListReadModel(store, {
    scheduleStatus: () => "ON_TRACK",
  });

  assert.deepEqual(
    summaries.map((item) => item.id),
    ["project-smart-controller", "project-other"],
  );
  assert.equal(summaries[1].currentPhaseName, "Other Phase");
});

test("active project read model summarizes current workflow view", () => {
  const store = createDemoStore();
  store.activeProjectId = "project-smart-controller";
  store.workPackages.push(
    {
      id: "wp-active-overdue",
      projectId: "project-smart-controller",
      phaseId: "phase-evt_exit",
      rolePairId: "pair-system_agent",
      title: "当前视图逾期工作包",
      status: "OPEN",
      dueAt: "2026-05-20",
    },
    {
      id: "wp-active-due-soon",
      projectId: "project-smart-controller",
      phaseId: "phase-evt_exit",
      rolePairId: "pair-quality_agent",
      title: "当前视图临近工作包",
      status: "OPEN",
      dueAt: "2026-06-01",
    },
    {
      id: "wp-active-unscheduled",
      projectId: "project-smart-controller",
      phaseId: "phase-evt_exit",
      rolePairId: "pair-quality_agent",
      title: "当前视图未排期工作包",
      status: "OPEN",
    },
  );
  store.reviews.push(
    {
      id: "review-active-open-condition",
      workPackageId: "wp-evt_exit-evt_test_plan",
      reviewerUserId: "user-quality-lead",
      decision: "APPROVE_WITH_CONDITIONS",
      conditions: ["补齐记录"],
      reviewedAt: "2026-05-25T01:00:00.000Z",
    },
    {
      id: "review-active-closed-condition",
      workPackageId: "wp-evt_exit-evt_test_report",
      reviewerUserId: "user-quality-lead",
      decision: "APPROVE_WITH_CONDITIONS",
      conditions: ["补充附件"],
      conditionsCompletedAt: "2026-05-26T01:00:00.000Z",
      reviewedAt: "2026-05-25T02:00:00.000Z",
    },
  );

  const view = getActiveProjectReadModel(store, "project-smart-controller", {
    latestGateCheck: {
      gateId: "gate-evt_exit",
      status: "BLOCKED",
      blockers: [{ type: "RISK", riskId: "risk-thermal-margin" }],
    },
    scheduleStatus: (workPackage) => {
      if (workPackage.id === "wp-active-overdue") {
        return "OVERDUE";
      }
      if (workPackage.id === "wp-active-due-soon") {
        return "DUE_SOON";
      }
      if (workPackage.id === "wp-active-unscheduled") {
        return "UNSCHEDULED";
      }
      return "ON_TRACK";
    },
    summarizeRiskMitigations: (risks) => ({ mitigationPlanCount: risks.length }),
  });

  assert.equal(view.project.id, "project-smart-controller");
  assert.equal(view.activeProjectId, "project-smart-controller");
  assert.equal(view.projects.length, 1);
  assert.equal(view.projectSummaries.length, 1);
  assert.equal(view.workPackages.length, 25);
  assert.equal(view.workPackages.find((item) => item.id === "wp-active-overdue").scheduleStatus, "OVERDUE");
  assert.deepEqual(view.latestGateCheck.blockers, [{ type: "RISK", riskId: "risk-thermal-margin" }]);
  assert.deepEqual(view.scheduleSummary, {
    overdueWorkPackageCount: 1,
    dueSoonWorkPackageCount: 1,
    unscheduledWorkPackageCount: 1,
  });
  assert.deepEqual(view.conditionalApprovalSummary, {
    conditionalApprovalCount: 2,
    openConditionalApprovalCount: 1,
    completedConditionalApprovalCount: 1,
  });
  assert.equal(view.riskMitigationSummary.mitigationPlanCount, 1);
  assert.equal(view.projectSummaries[0].mitigationPlanCount, 1);
});

test("active project read model returns null for unknown projects", () => {
  assert.equal(getActiveProjectReadModel(createDemoStore(), "missing-project"), null);
});

test("user action items read model aggregates review, schedule, risk, and gate work", () => {
  const store = createDemoStore();
  const workPackage = store.workPackages.find((item) => item.id === "wp-evt_exit-evt_test_plan");
  store.artifactVersions.push({
    id: "artifact-pending-action",
    workPackageId: workPackage.id,
    artifactType: workPackage.requiredArtifactType,
    status: "PENDING_REVIEW",
    version: 1,
  });
  store.reviews.push({
    id: "review-open-action-condition",
    workPackageId: workPackage.id,
    reviewerUserId: "user-quality-lead",
    decision: "APPROVE_WITH_CONDITIONS",
    comment: "补齐记录后通过",
    conditions: ["补齐记录"],
    reviewedAt: "2026-05-25T01:00:00.000Z",
  });
  store.risks.push({
    id: "risk-action-mitigation",
    projectId: "project-smart-controller",
    phaseId: "phase-evt_exit",
    title: "缓解动作",
    severity: "MEDIUM",
    status: "OPEN",
    mitigationOwnerUserId: "user-test-lead",
    mitigationDueAt: "2026-06-01",
    mitigationStatus: "OPEN",
    mitigation: "补充测试记录",
  });

  const result = getUserActionItemsReadModel(store, "project-smart-controller", "user-test-lead", {
    scheduleStatus: (item) => {
      if (item.id === workPackage.id) {
        return "OVERDUE";
      }
      if (item.dueAt === "2026-06-01") {
        return "DUE_SOON";
      }
      return "ON_TRACK";
    },
    loadArtifactTemplate: () => ({ requiredReviewerRole: "test" }),
    canReviewWorkPackage: () => ({ allowed: true }),
    canApproveWorkPackage: () => ({ allowed: true }),
    canAcceptRisk: () => ({ allowed: true }),
    canApproveGate: () => ({ allowed: true }),
    currentGateReadiness: {
      gateId: "gate-evt_exit",
      status: "READY",
      blockers: [],
    },
  });

  assert.equal(result.userId, "user-test-lead");
  assert.equal(result.projectId, "project-smart-controller");
  assert.equal(result.pendingReviews.length, 1);
  assert.equal(result.pendingReviews[0].workPackageId, workPackage.id);
  assert.equal(result.pendingReviews[0].canApprove, true);
  assert.equal(result.scheduleAlerts.length, 1);
  assert.equal(result.scheduleAlerts[0].scheduleStatus, "OVERDUE");
  assert.equal(result.conditionalApprovals.length, 1);
  assert.equal(result.conditionalApprovals[0].reviewId, "review-open-action-condition");
  assert.deepEqual(
    result.riskDecisions.map((item) => item.riskId),
    ["risk-thermal-margin"],
  );
  assert.equal(result.riskMitigations.length, 1);
  assert.equal(result.riskMitigations[0].riskId, "risk-action-mitigation");
  assert.equal(result.riskMitigations[0].scheduleStatus, "DUE_SOON");
  assert.equal(result.gateApprovals.length, 1);
  assert.equal(result.gateApprovals[0].gateId, "gate-evt_exit");
  assert.equal(result.total, 6);
});

test("user action items read model returns null for unknown projects", () => {
  assert.equal(getUserActionItemsReadModel(createDemoStore(), "missing-project", "user-test-lead"), null);
});

test("project risk register read model enriches, sorts, and summarizes risks", () => {
  const store = createDemoStore();
  store.risks.push(
    {
      id: "risk-dvt-closed",
      projectId: "project-smart-controller",
      phaseId: "phase-dvt_exit",
      title: "DVT closed risk",
      severity: "HIGH",
      status: "CLOSED",
      closedByUserId: "user-project-manager",
      closedComment: "已关闭",
    },
    {
      id: "risk-evt-accepted",
      projectId: "project-smart-controller",
      phaseId: "phase-evt_exit",
      title: "Accepted EVT risk",
      severity: "CRITICAL",
      status: "ACCEPTED",
      acceptedByUserId: "user-project-manager",
      acceptedComment: "接受残余风险",
    },
    {
      id: "risk-other-project",
      projectId: "project-other",
      phaseId: "phase-evt_exit",
      title: "Other project risk",
      severity: "CRITICAL",
      status: "OPEN",
    },
  );

  const register = getProjectRiskRegisterReadModel(store, "project-smart-controller", {
    exportedAt: () => "2026-05-31T00:00:00.000Z",
    summarizeRiskMitigations: (risks) => ({ mitigationPlanCount: risks.filter((risk) => risk.mitigationOwnerUserId).length }),
  });

  assert.equal(register.exportedAt, "2026-05-31T00:00:00.000Z");
  assert.equal(register.summary.totalRiskCount, 3);
  assert.equal(register.summary.openRiskCount, 1);
  assert.equal(register.summary.openBlockingRiskCount, 1);
  assert.equal(register.summary.acceptedRiskCount, 1);
  assert.equal(register.summary.closedRiskCount, 1);
  assert.equal(register.summary.mitigationPlanCount, 0);
  assert.deepEqual(
    register.risks.map((risk) => risk.id),
    ["risk-evt-accepted", "risk-thermal-margin", "risk-dvt-closed"],
  );
  assert.equal(register.risks[0].phaseName, "EVT Exit");
  assert.equal(register.risks[0].decisionUserId, "user-project-manager");
  assert.equal(register.risks[0].decisionComment, "接受残余风险");
  assert.equal(register.risks[1].blocksGate, true);
  assert.equal(register.risks[2].blocksGate, false);
});

test("project risk register read model returns null for unknown projects", () => {
  assert.equal(getProjectRiskRegisterReadModel(createDemoStore(), "missing-project"), null);
});

test("project snapshot read model exports enriched project state", () => {
  const store = createDemoStore();
  store.workPackages.push(
    {
      id: "wp-overdue-snapshot",
      projectId: "project-smart-controller",
      phaseId: "phase-evt_exit",
      rolePairId: "pair-system_agent",
      title: "逾期快照工作包",
      status: "OPEN",
      dueAt: "2026-05-20",
    },
    {
      id: "wp-due-soon-snapshot",
      projectId: "project-smart-controller",
      phaseId: "phase-evt_exit",
      rolePairId: "pair-quality_agent",
      title: "临近快照工作包",
      status: "HUMAN_APPROVED",
      dueAt: "2026-06-01",
    },
  );
  store.reviews.push(
    {
      id: "review-snapshot-open-condition",
      workPackageId: "wp-evt_exit-evt_test_plan",
      reviewerUserId: "user-quality-lead",
      decision: "APPROVE_WITH_CONDITIONS",
      conditions: ["补齐附件"],
      reviewedAt: "2026-05-25T01:00:00.000Z",
    },
    {
      id: "review-snapshot-closed-condition",
      workPackageId: "wp-evt_exit-evt_test_report",
      reviewerUserId: "user-quality-lead",
      decision: "APPROVE_WITH_CONDITIONS",
      conditions: ["补充照片"],
      conditionsCompletedAt: "2026-05-26T01:00:00.000Z",
      reviewedAt: "2026-05-25T02:00:00.000Z",
    },
  );
  store.evidenceRefs.push({
    id: "evidence-snapshot",
    projectId: "project-smart-controller",
    workPackageId: "wp-evt_exit-evt_test_plan",
    label: "测试附件",
    ref: "file://evt.pdf",
  });
  store.gateApprovalPacks.push({
    id: "pack-snapshot",
    projectId: "project-smart-controller",
    gateId: "gate-evt_exit",
    createdAt: "2026-05-26T01:00:00.000Z",
    createdByUserId: "user-project-manager",
    status: "READY",
    snapshot: {},
  });
  store.notifications.push({
    id: "notification-snapshot",
    projectId: "project-smart-controller",
    userId: "user-project-manager",
    title: "快照通知",
    message: "",
    type: "INFO",
    status: "UNREAD",
    createdAt: "2026-05-26T01:00:00.000Z",
  });
  store.auditEvents.push({
    id: "audit-snapshot",
    projectId: "project-smart-controller",
    eventType: "SNAPSHOT",
    actorType: "human",
    actorId: "user-project-manager",
    objectType: "project",
    objectId: "project-smart-controller",
  });

  const snapshot = getProjectSnapshotReadModel(store, "project-smart-controller", {
    exportedAt: () => "2026-05-31T00:00:00.000Z",
    scheduleStatus: (workPackage) => {
      if (workPackage.id === "wp-overdue-snapshot") {
        return "OVERDUE";
      }
      if (workPackage.id === "wp-due-soon-snapshot") {
        return "DUE_SOON";
      }
      return "ON_TRACK";
    },
    summarizeRiskMitigations: (risks) => ({ mitigationPlanCount: risks.length }),
  });

  assert.equal(snapshot.exportedAt, "2026-05-31T00:00:00.000Z");
  assert.equal(snapshot.summary.phaseCount, 7);
  assert.equal(snapshot.summary.workPackageCount, 24);
  assert.equal(snapshot.summary.approvedWorkPackageCount, 1);
  assert.equal(snapshot.summary.overdueWorkPackageCount, 1);
  assert.equal(snapshot.summary.dueSoonWorkPackageCount, 1);
  assert.equal(snapshot.summary.conditionalApprovalCount, 2);
  assert.equal(snapshot.summary.openConditionalApprovalCount, 1);
  assert.equal(snapshot.summary.completedConditionalApprovalCount, 1);
  assert.equal(snapshot.summary.evidenceRefCount, 1);
  assert.equal(snapshot.summary.gateApprovalPackCount, 1);
  assert.equal(snapshot.summary.notificationCount, 1);
  assert.equal(snapshot.summary.auditEventCount, 1);
  assert.equal(snapshot.summary.mitigationPlanCount, 1);
  assert.equal(snapshot.workPackages.find((item) => item.id === "wp-overdue-snapshot").phaseName, "EVT Exit");
  assert.equal(snapshot.workPackages.find((item) => item.id === "wp-overdue-snapshot").ownerUserId, "user-system-lead");
  assert.equal(snapshot.workPackages.find((item) => item.id === "wp-due-soon-snapshot").agentKey, "quality_agent");
  assert.equal(snapshot.risks[0].phaseName, "EVT Exit");
});

test("project snapshot read model returns null for unknown projects", () => {
  assert.equal(getProjectSnapshotReadModel(createDemoStore(), "missing-project"), null);
});

test("gate review pack read model summarizes evidence, conditions, and blocking risks", () => {
  const store = createDemoStore();
  const workPackage = store.workPackages.find((item) => item.id === "wp-evt_exit-evt_test_plan");
  workPackage.status = "HUMAN_APPROVED";
  store.artifactVersions.push(
    {
      id: "artifact-old",
      workPackageId: workPackage.id,
      artifactType: workPackage.requiredArtifactType,
      status: "DRAFT",
      version: 1,
    },
    {
      id: "artifact-approved",
      workPackageId: workPackage.id,
      artifactType: workPackage.requiredArtifactType,
      status: "APPROVED",
      version: 2,
    },
  );
  store.reviews.push({
    id: "review-approved-with-conditions",
    workPackageId: workPackage.id,
    reviewerUserId: "user-test-lead",
    decision: "APPROVE_WITH_CONDITIONS",
    comment: "有条件通过",
    conditions: ["补充边界条件"],
    reviewedAt: "2026-05-25T01:00:00.000Z",
  });
  store.evidenceRefs.push({
    id: "evidence-review-pack",
    projectId: "project-smart-controller",
    workPackageId: workPackage.id,
    label: "测试照片",
    ref: "file://photo.jpg",
  });

  const pack = getGateReviewPackReadModel(store, "gate-evt_exit", {
    readiness: {
      gateId: "gate-evt_exit",
      status: "BLOCKED",
      blockers: [{ type: "RISK", riskId: "risk-thermal-margin" }],
    },
  });
  const evidence = pack.evidence.find((item) => item.workPackageId === workPackage.id);

  assert.equal(pack.project.id, "project-smart-controller");
  assert.equal(pack.phase.name, "EVT Exit");
  assert.equal(pack.gate.id, "gate-evt_exit");
  assert.equal(pack.summary.requiredEvidenceCount, 3);
  assert.equal(pack.summary.readyEvidenceCount, 1);
  assert.equal(pack.summary.manualEvidenceRefCount, 1);
  assert.equal(pack.summary.conditionalApprovalCount, 1);
  assert.equal(pack.summary.openConditionalApprovalCount, 1);
  assert.equal(pack.summary.openBlockingRiskCount, 1);
  assert.equal(pack.summary.blockerCount, 1);
  assert.equal(pack.summary.readyForApproval, false);
  assert.equal(evidence.latestArtifactId, "artifact-approved");
  assert.equal(evidence.approvedArtifactId, "artifact-approved");
  assert.equal(evidence.approvedReviewId, "review-approved-with-conditions");
  assert.deepEqual(evidence.approvedReviewConditions, ["补充边界条件"]);
  assert.equal(evidence.manualEvidenceRefs[0].id, "evidence-review-pack");
  assert.equal(pack.risks[0].blocksGate, true);
});

test("gate review pack read model returns null for unknown gates", () => {
  assert.equal(getGateReviewPackReadModel(createDemoStore(), "missing-gate"), null);
});

test("latest gate approval pack read model returns the newest approval", () => {
  const store = createDemoStore();
  store.gateApprovalPacks.push(
    {
      id: "pack-old",
      gateId: "gate-evt_exit",
      approvedAt: "2026-05-25T01:00:00.000Z",
    },
    {
      id: "pack-new",
      gateId: "gate-evt_exit",
      approvedAt: "2026-05-26T01:00:00.000Z",
    },
    {
      id: "pack-other",
      gateId: "gate-dvt_exit",
      approvedAt: "2026-05-27T01:00:00.000Z",
    },
  );

  assert.equal(getLatestGateApprovalPack(store, "gate-evt_exit").id, "pack-new");
  assert.equal(getLatestGateApprovalPack(store, "missing-gate"), null);
});

test("project user notifications are scoped, sorted, counted, and filtered", () => {
  const store = createDemoStore();
  store.notifications.push(
    {
      id: "notification-old",
      projectId: "project-smart-controller",
      userId: "user-project-manager",
      title: "旧通知",
      message: "",
      type: "INFO",
      status: "READ",
      createdAt: "2026-05-26T01:00:00.000Z",
    },
    {
      id: "notification-new",
      projectId: "project-smart-controller",
      userId: "user-project-manager",
      title: "新动作",
      message: "",
      type: "ACTION",
      status: "UNREAD",
      createdAt: "2026-05-26T02:00:00.000Z",
    },
    {
      id: "notification-other-project",
      projectId: "project-other",
      userId: "user-project-manager",
      title: "其他项目",
      message: "",
      type: "ACTION",
      status: "UNREAD",
      createdAt: "2026-05-26T03:00:00.000Z",
    },
  );

  const result = getProjectUserNotifications(store, "project-smart-controller", "user-project-manager", {
    type: "ACTION",
  });

  assert.equal(result.total, 2);
  assert.equal(result.filteredCount, 1);
  assert.equal(result.unreadCount, 1);
  assert.deepEqual(result.counts, {
    unread: 1,
    read: 1,
    action: 1,
    warning: 0,
    info: 1,
  });
  assert.deepEqual(
    result.notifications.map((item) => item.id),
    ["notification-new"],
  );
});

test("work package read model includes related reviews, artifacts, evidence, runs, and audit events", () => {
  const store = createDemoStore();
  store.reviews.push({
    id: "review-1",
    workPackageId: "wp-evt_exit-evt_test_plan",
    reviewerUserId: "user-test-lead",
    decision: "APPROVE",
    reviewedAt: "2026-05-26T01:00:00.000Z",
  });
  store.evidenceRefs.push({
    id: "evidence-1",
    projectId: "project-smart-controller",
    workPackageId: "wp-evt_exit-evt_test_plan",
    label: "测试记录",
    ref: "file://test.pdf",
  });
  store.agentRuns.push({
    id: "run-1",
    workPackageId: "wp-evt_exit-evt_test_plan",
    agentKey: "test_agent",
    status: "COMPLETED",
  });
  store.auditEvents.push(
    { id: "audit-work-package", objectType: "workPackage", objectId: "wp-evt_exit-evt_test_plan" },
    { id: "audit-review", objectType: "review", objectId: "review-1" },
    { id: "audit-other", objectType: "workPackage", objectId: "wp-evt_exit-evt_test_report" },
  );

  const detail = getWorkPackageReadModel(store, "wp-evt_exit-evt_test_plan", {
    scheduleStatus: () => "ON_TRACK",
  });

  assert.equal(detail.workPackage.id, "wp-evt_exit-evt_test_plan");
  assert.equal(detail.rolePair.humanUserId, "user-test-lead");
  assert.equal(detail.artifacts.length, 1);
  assert.equal(detail.reviews.length, 1);
  assert.equal(detail.evidenceRefs.length, 1);
  assert.equal(detail.agentRuns.length, 1);
  assert.equal(detail.auditEvents.some((event) => event.id === "audit-work-package"), true);
  assert.equal(detail.auditEvents.some((event) => event.id === "audit-review"), true);
  assert.equal(detail.auditEvents.some((event) => event.id === "audit-other"), false);
  assert.equal(detail.scheduleStatus, "ON_TRACK");
});

test("work package read model returns null for unknown work packages", () => {
  assert.equal(getWorkPackageReadModel(createDemoStore(), "missing-work-package"), null);
});
