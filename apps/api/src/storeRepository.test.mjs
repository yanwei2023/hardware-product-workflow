import assert from "node:assert/strict";
import test from "node:test";
import { createDemoStore } from "./server.mjs";
import {
  getProjectListItemReadModel,
  getProjectListReadModel,
  getProjectReadModel,
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
