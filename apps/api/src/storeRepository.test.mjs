import assert from "node:assert/strict";
import test from "node:test";
import { createDemoStore } from "./server.mjs";
import {
  getProjectListItemReadModel,
  getProjectListReadModel,
  getProjectReadModel,
  getProjectRiskRegisterReadModel,
  getProjectSnapshotReadModel,
  getProjectUserNotifications,
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
