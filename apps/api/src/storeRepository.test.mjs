import assert from "node:assert/strict";
import test from "node:test";
import { createDemoStore } from "./server.mjs";
import {
  addAuditEventInStore,
  addGateApprovalPackInStore,
  addNotificationInStore,
  addProjectGraphInStore,
  addRiskInStore,
  addWorkPackageEvidenceRefInStore,
  approveGateInStore,
  archiveProjectInStore,
  completeReviewConditionsInStore,
  completeRiskMitigationInStore,
  findGate,
  findNotification,
  findPhase,
  findProject,
  findReview,
  findRolePair,
  findRisk,
  findWorkPackage,
  getActiveProjectReadModel,
  getCurrentGate,
  getCurrentProject,
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
  markNotificationReadInStore,
  markProjectUserNotificationsReadInStore,
  recordInvalidAgentOutputInStore,
  recordReadyAgentOutputInStore,
  restoreProjectInStore,
  selectProjectInStore,
  submitHumanReviewInStore,
  updateGateReadinessInStore,
  updateRolePairOwnerInStore,
  updateRiskMitigationInStore,
  updateRiskStatusInStore,
  updateWorkPackageScheduleInStore,
} from "./storeRepository.mjs";

test("store lookup helpers resolve current and individual records", () => {
  const store = createDemoStore();
  store.notifications.push({
    id: "notification-helper",
    projectId: "project-smart-controller",
    userId: "user-project-manager",
    title: "helper",
    message: "",
    type: "INFO",
    status: "UNREAD",
    createdAt: "2026-05-26T01:00:00.000Z",
  });

  assert.equal(getCurrentProject(store).id, "project-smart-controller");
  assert.equal(getCurrentGate(store).id, "gate-evt_exit");
  assert.equal(findProject(store, "project-smart-controller").name, "智能控制器项目");
  assert.equal(findRolePair(store, "pair-test_agent").humanUserId, "user-test-lead");
  assert.equal(findWorkPackage(store, "wp-evt_exit-evt_test_plan").title, "EVT 测试计划");
  assert.equal(findNotification(store, "notification-helper").title, "helper");
  assert.equal(findGate(store, "gate-evt_exit").name, "EVT Exit 阶段门");
  assert.equal(findPhase(store, "phase-evt_exit").name, "EVT Exit");
  assert.equal(findRisk(store, "risk-thermal-margin").title, "热设计裕量不足");
  assert.equal(findProject(store, "missing-project"), null);
  assert.equal(findRolePair(store, "missing-role-pair"), null);
  assert.equal(findWorkPackage(store, "missing-work-package"), null);
  assert.equal(findNotification(store, "missing-notification"), null);
  assert.equal(findGate(store, "missing-gate"), null);
  assert.equal(findPhase(store, "missing-phase"), null);
  assert.equal(findReview(store, "missing-review"), null);
  assert.equal(findRisk(store, "missing-risk"), null);
});

test("current project helper falls back to the first project", () => {
  const store = createDemoStore();
  store.activeProjectId = "missing-project";

  assert.equal(getCurrentProject(store).id, "project-smart-controller");
  assert.equal(getCurrentGate({ ...store, projects: [] }), null);
});

test("audit and notification write helpers append records with defaults", () => {
  const store = createDemoStore();

  const auditEvent = addAuditEventInStore(store, {
    id: "audit-helper",
    projectId: "project-smart-controller",
    eventType: "HELPER_EVENT",
    actorType: "human",
    actorId: "user-project-manager",
    objectType: "project",
    objectId: "project-smart-controller",
    payload: { ok: true },
    createdAt: "2026-06-01T06:00:00.000Z",
  });
  const notification = addNotificationInStore(store, {
    id: "notification-helper-defaults",
    projectId: "project-smart-controller",
    userId: "user-project-manager",
    title: "helper notification",
    createdAt: "2026-06-01T07:00:00.000Z",
  });

  assert.deepEqual(auditEvent, {
    id: "audit-helper",
    projectId: "project-smart-controller",
    eventType: "HELPER_EVENT",
    actorType: "human",
    actorId: "user-project-manager",
    objectType: "project",
    objectId: "project-smart-controller",
    payload: { ok: true },
    createdAt: "2026-06-01T06:00:00.000Z",
  });
  assert.equal(store.auditEvents.at(-1).id, "audit-helper");
  assert.deepEqual(notification, {
    id: "notification-helper-defaults",
    projectId: "project-smart-controller",
    userId: "user-project-manager",
    title: "helper notification",
    message: "",
    type: "INFO",
    status: "UNREAD",
    objectType: null,
    objectId: null,
    createdAt: "2026-06-01T07:00:00.000Z",
  });
  assert.equal(store.notifications.at(-1).id, "notification-helper-defaults");
});

test("project graph write helper appends workflow records and activates project", () => {
  const store = createDemoStore();
  const project = {
    id: "project-graph-helper",
    name: "图谱项目",
    productLine: "测试",
    currentPhaseId: "project-graph-helper-phase",
    status: "IN_PROGRESS",
    createdAt: "2026-06-01T18:00:00.000Z",
  };
  const phase = {
    id: "project-graph-helper-phase",
    projectId: project.id,
    phaseKey: "initiation",
    name: "立项",
    sequence: 1,
    status: "IN_PROGRESS",
  };
  const gate = {
    id: "project-graph-helper-gate",
    projectId: project.id,
    phaseId: phase.id,
    name: "立项门",
    status: "GATE_BLOCKED",
  };

  const created = addProjectGraphInStore(store, {
    project,
    phases: [phase],
    gates: [gate],
    rolePairs: [{ id: "project-graph-helper-pair", projectId: project.id }],
    gateRequirements: [{ id: "project-graph-helper-req", projectId: project.id, gateId: gate.id }],
    workPackages: [{ id: "project-graph-helper-wp", projectId: project.id, phaseId: phase.id }],
    artifactVersions: [{ id: "project-graph-helper-artifact", workPackageId: "project-graph-helper-wp" }],
    reviews: [{ id: "project-graph-helper-review", workPackageId: "project-graph-helper-wp" }],
    evidenceRefs: [{ id: "project-graph-helper-evidence", projectId: project.id }],
    gateApprovalPacks: [{ id: "project-graph-helper-pack", projectId: project.id, gateId: gate.id }],
    risks: [{ id: "project-graph-helper-risk", projectId: project.id, phaseId: phase.id }],
    agentRuns: [{ id: "project-graph-helper-run", workPackageId: "project-graph-helper-wp" }],
    agentFindings: [{ id: "project-graph-helper-finding", workPackageId: "project-graph-helper-wp" }],
    notifications: [{ id: "project-graph-helper-notification", projectId: project.id }],
    auditEvents: [{ id: "project-graph-helper-audit", projectId: project.id }],
  });

  assert.equal(created.id, project.id);
  assert.equal(store.activeProjectId, project.id);
  assert.equal(findProject(store, project.id).name, "图谱项目");
  assert.equal(findPhase(store, phase.id).id, phase.id);
  assert.equal(findGate(store, gate.id).id, gate.id);
  assert.equal(store.workPackages.at(-1).id, "project-graph-helper-wp");
  assert.equal(store.auditEvents.at(-1).id, "project-graph-helper-audit");

  const inactiveProject = {
    ...project,
    id: "project-graph-helper-inactive",
    currentPhaseId: "project-graph-helper-inactive-phase",
  };
  addProjectGraphInStore(store, { project: inactiveProject, activate: false });

  assert.equal(store.activeProjectId, project.id);
  assert.equal(findProject(store, inactiveProject.id).id, inactiveProject.id);
});

test("gate readiness write helper synchronizes gate and phase status", () => {
  const store = createDemoStore();

  const blocked = updateGateReadinessInStore(store, "gate-evt_exit", "BLOCKED");

  assert.equal(blocked.gate.status, "GATE_BLOCKED");
  assert.equal(blocked.phase.status, "GATE_BLOCKED");
  assert.equal(findGate(store, "gate-evt_exit").status, "GATE_BLOCKED");
  assert.equal(findPhase(store, "phase-evt_exit").status, "GATE_BLOCKED");

  const ready = updateGateReadinessInStore(store, "gate-evt_exit", "READY");

  assert.equal(ready.gate.status, "GATE_READY");
  assert.equal(ready.phase.status, "GATE_READY");
  assert.equal(updateGateReadinessInStore(store, "missing-gate", "READY"), null);
});

test("notification write helpers mark one or many notifications read", () => {
  const store = createDemoStore();
  store.notifications.push(
    {
      id: "notification-read-one",
      projectId: "project-smart-controller",
      userId: "user-project-manager",
      title: "one",
      message: "",
      type: "INFO",
      status: "UNREAD",
      createdAt: "2026-05-26T01:00:00.000Z",
    },
    {
      id: "notification-read-bulk",
      projectId: "project-smart-controller",
      userId: "user-project-manager",
      title: "bulk",
      message: "",
      type: "ACTION",
      status: "UNREAD",
      createdAt: "2026-05-26T02:00:00.000Z",
    },
    {
      id: "notification-other-user",
      projectId: "project-smart-controller",
      userId: "user-test-lead",
      title: "other user",
      message: "",
      type: "ACTION",
      status: "UNREAD",
      createdAt: "2026-05-26T03:00:00.000Z",
    },
  );

  const readOne = markNotificationReadInStore(store, "notification-read-one", {
    readAt: "2026-05-31T01:00:00.000Z",
  });
  const updatedCount = markProjectUserNotificationsReadInStore(store, "project-smart-controller", "user-project-manager", {
    readAt: "2026-05-31T02:00:00.000Z",
  });

  assert.equal(readOne.status, "READ");
  assert.equal(readOne.readAt, "2026-05-31T01:00:00.000Z");
  assert.equal(updatedCount, 1);
  assert.equal(findNotification(store, "notification-read-bulk").status, "READ");
  assert.equal(findNotification(store, "notification-read-bulk").readAt, "2026-05-31T02:00:00.000Z");
  assert.equal(findNotification(store, "notification-other-user").status, "UNREAD");
  assert.equal(markNotificationReadInStore(store, "missing-notification"), null);
});

test("work package schedule write helper updates and clears due dates", () => {
  const store = createDemoStore();

  const updated = updateWorkPackageScheduleInStore(store, "wp-evt_exit-evt_test_plan", "2026-06-15");
  const updatedDueAt = updated.dueAt;
  const cleared = updateWorkPackageScheduleInStore(store, "wp-evt_exit-evt_test_plan", "");

  assert.equal(updated.id, "wp-evt_exit-evt_test_plan");
  assert.equal(updatedDueAt, "2026-06-15");
  assert.equal(cleared.dueAt, null);
  assert.equal(findWorkPackage(store, "wp-evt_exit-evt_test_plan").dueAt, null);
  assert.equal(updateWorkPackageScheduleInStore(store, "missing-work-package", "2026-06-15"), null);
});

test("work package evidence write helper creates scoped refs", () => {
  const store = createDemoStore();

  const evidenceRef = addWorkPackageEvidenceRefInStore(store, "wp-evt_exit-evt_test_plan", {
    id: "evidence-helper",
    label: "测试照片",
    ref: "file://photo.jpg",
    createdByUserId: "user-test-lead",
    createdAt: "2026-05-31T03:00:00.000Z",
  });

  assert.deepEqual(evidenceRef, {
    id: "evidence-helper",
    projectId: "project-smart-controller",
    workPackageId: "wp-evt_exit-evt_test_plan",
    label: "测试照片",
    ref: "file://photo.jpg",
    createdByUserId: "user-test-lead",
    createdAt: "2026-05-31T03:00:00.000Z",
  });
  assert.equal(store.evidenceRefs.at(-1).id, "evidence-helper");
  assert.equal(addWorkPackageEvidenceRefInStore(store, "missing-work-package", { id: "missing" }), null);
});

test("agent output write helpers record invalid and ready outputs", () => {
  const store = createDemoStore();
  const workPackageId = "wp-evt_exit-evt_test_plan";
  const invalidRun = {
    id: "agent-run-invalid-helper",
    workPackageId,
    agentKey: "test_agent",
    status: "OUTPUT_INVALID",
    createdAt: "2026-06-01T11:00:00.000Z",
    completedAt: "2026-06-01T11:00:00.000Z",
    validation: { status: "FAILED" },
  };

  const invalid = recordInvalidAgentOutputInStore(store, workPackageId, invalidRun);

  assert.equal(invalid.workPackage.status, "NEEDS_AGENT_REVISION");
  assert.equal(store.agentRuns.at(-1).id, "agent-run-invalid-helper");

  const readyRun = {
    id: "agent-run-ready-helper",
    workPackageId,
    agentKey: "test_agent",
    status: "OUTPUT_READY",
    createdAt: "2026-06-01T12:00:00.000Z",
    completedAt: "2026-06-01T12:00:00.000Z",
  };
  const artifact = {
    id: "artifact-ready-helper",
    workPackageId,
    artifactType: "TEST_PLAN",
    status: "PENDING_REVIEW",
    version: "0.1",
    createdByActor: "agent:test_agent",
    content: {},
  };
  const ready = recordReadyAgentOutputInStore(store, workPackageId, readyRun, artifact);

  assert.equal(ready.workPackage.status, "AGENT_DRAFT_READY");
  assert.equal(store.agentRuns.at(-1).id, "agent-run-ready-helper");
  assert.equal(store.artifactVersions.at(-1).id, "artifact-ready-helper");
  assert.equal(findWorkPackage(store, workPackageId).status, "AGENT_DRAFT_READY");
  assert.equal(recordInvalidAgentOutputInStore(store, "missing-work-package", invalidRun), null);
  assert.equal(recordReadyAgentOutputInStore(store, "missing-work-package", readyRun, artifact), null);
});

test("human review write helper records review decisions and artifact status", () => {
  const store = createDemoStore();
  const workPackageId = "wp-evt_exit-evt_test_plan";
  const pendingArtifact = store.artifactVersions.find((item) => item.id === "artifact-evt-test-plan-draft");

  const approved = submitHumanReviewInStore(store, workPackageId, pendingArtifact.id, {
    id: "review-helper-approved",
    workPackageId,
    reviewerUserId: "user-test-lead",
    decision: "APPROVE",
    comment: "批准",
    conditions: [],
    reviewedAt: "2026-06-01T13:00:00.000Z",
  });

  assert.equal(approved.review.id, "review-helper-approved");
  assert.equal(approved.workPackage.status, "HUMAN_APPROVED");
  assert.equal(approved.artifact.status, "APPROVED");
  assert.equal(approved.artifact.version, "1.0");
  assert.equal(store.reviews.at(-1).id, "review-helper-approved");

  const revisionArtifact = {
    ...pendingArtifact,
    id: "artifact-review-revision-helper",
    status: "PENDING_REVIEW",
    version: "0.2",
  };
  store.artifactVersions.push(revisionArtifact);
  const revision = submitHumanReviewInStore(store, workPackageId, revisionArtifact.id, {
    id: "review-helper-revision",
    workPackageId,
    reviewerUserId: "user-test-lead",
    decision: "REQUEST_REVISION",
    comment: "需要修改",
    conditions: [],
    reviewedAt: "2026-06-01T14:00:00.000Z",
  });

  assert.equal(revision.workPackage.status, "NEEDS_AGENT_REVISION");
  assert.equal(revision.artifact.status, "NEEDS_REVISION");

  const rejectedArtifact = {
    ...pendingArtifact,
    id: "artifact-review-rejected-helper",
    status: "PENDING_REVIEW",
    version: "0.3",
  };
  store.artifactVersions.push(rejectedArtifact);
  const rejected = submitHumanReviewInStore(store, workPackageId, rejectedArtifact.id, {
    id: "review-helper-rejected",
    workPackageId,
    reviewerUserId: "user-test-lead",
    decision: "REJECT",
    comment: "驳回",
    conditions: [],
    reviewedAt: "2026-06-01T15:00:00.000Z",
  });

  assert.equal(rejected.workPackage.status, "REJECTED");
  assert.equal(rejected.artifact.status, "REJECTED");
  assert.equal(submitHumanReviewInStore(store, "missing-work-package", rejectedArtifact.id, rejected.review), null);
  assert.equal(submitHumanReviewInStore(store, workPackageId, "missing-artifact", rejected.review), null);
});

test("gate approval pack write helper appends frozen packs", () => {
  const store = createDemoStore();
  const reviewPack = {
    gate: { id: "gate-evt_exit", status: "APPROVED" },
    readiness: { status: "READY", blockers: [] },
  };

  const approvalPack = addGateApprovalPackInStore(store, {
    id: "gate-pack-helper",
    projectId: "project-smart-controller",
    gateId: "gate-evt_exit",
    phaseId: "phase-evt_exit",
    approvedByUserId: "user-project-manager",
    approvedAt: "2026-06-01T09:00:00.000Z",
    approvalComment: "批准进入下一阶段",
    reviewPack,
  });

  assert.deepEqual(approvalPack, {
    id: "gate-pack-helper",
    projectId: "project-smart-controller",
    gateId: "gate-evt_exit",
    phaseId: "phase-evt_exit",
    approvedByUserId: "user-project-manager",
    approvedAt: "2026-06-01T09:00:00.000Z",
    approvalComment: "批准进入下一阶段",
    reviewPack,
  });
  assert.equal(store.gateApprovalPacks.at(-1).id, "gate-pack-helper");
});

test("gate approval write helper locks current phase and advances project", () => {
  const store = createDemoStore();

  const approval = approveGateInStore(store, "gate-evt_exit", {
    approvedByUserId: "user-project-manager",
    approvedAt: "2026-06-01T16:00:00.000Z",
    approvalComment: "批准 EVT",
  });

  assert.equal(approval.gate.status, "APPROVED");
  assert.equal(approval.gate.approvedByUserId, "user-project-manager");
  assert.equal(approval.gate.approvedAt, "2026-06-01T16:00:00.000Z");
  assert.equal(approval.gate.approvalComment, "批准 EVT");
  assert.equal(approval.phase.status, "LOCKED");
  assert.equal(approval.nextPhase.status, "IN_PROGRESS");
  assert.equal(approval.project.currentPhaseId, approval.nextPhase.id);
  assert.equal(approval.nextGate.status, "GATE_BLOCKED");
});

test("gate approval write helper completes project at the final phase", () => {
  const store = createDemoStore();
  const project = findProject(store, "project-smart-controller");
  const finalPhase = store.phases
    .filter((item) => item.projectId === project.id)
    .sort((a, b) => b.sequence - a.sequence)[0];
  const finalGate = findGate(store, `gate-${finalPhase.phaseKey}`);
  project.currentPhaseId = finalPhase.id;

  const approval = approveGateInStore(store, finalGate.id, {
    approvedByUserId: "user-project-manager",
    approvedAt: "2026-06-01T17:00:00.000Z",
    approvalComment: "项目完成",
  });

  assert.equal(approval.gate.status, "APPROVED");
  assert.equal(approval.phase.status, "LOCKED");
  assert.equal(approval.nextPhase, null);
  assert.equal(approval.nextGate, null);
  assert.equal(approval.project.status, "COMPLETED");
  assert.equal(approveGateInStore(store, "missing-gate"), null);
});

test("risk write helper appends project risks", () => {
  const store = createDemoStore();
  const risk = {
    id: "risk-helper-created",
    projectId: "project-smart-controller",
    phaseId: "phase-evt_exit",
    title: "新增供应风险",
    severity: "MEDIUM",
    status: "OPEN",
    createdByUserId: "user-project-manager",
    createdAt: "2026-06-01T10:00:00.000Z",
  };

  const created = addRiskInStore(store, risk);

  assert.equal(created, risk);
  assert.equal(store.risks.at(-1).id, "risk-helper-created");
  assert.equal(findRisk(store, "risk-helper-created").title, "新增供应风险");
});

test("risk mitigation write helper updates plan fields and resets completion", () => {
  const store = createDemoStore();
  const riskId = "risk-thermal-margin";

  const updated = updateRiskMitigationInStore(store, riskId, {
    mitigation: "增加散热片验证",
    mitigationDueAt: "2026-06-20",
    mitigationOwnerUserId: "user-quality-lead",
    updatedAt: "2026-06-01T01:00:00.000Z",
    updatedByUserId: "user-project-manager",
  });

  assert.equal(updated.id, riskId);
  assert.equal(updated.mitigation, "增加散热片验证");
  assert.equal(updated.mitigationDueAt, "2026-06-20");
  assert.equal(updated.mitigationOwnerUserId, "user-quality-lead");
  assert.equal(updated.mitigationStatus, "OPEN");
  assert.equal(updated.mitigationCompletedAt, null);
  assert.equal(updated.mitigationCompletedByUserId, null);
  assert.equal(updated.mitigationCompletionComment, "");
  assert.equal(updated.mitigationUpdatedAt, "2026-06-01T01:00:00.000Z");
  assert.equal(updated.mitigationUpdatedByUserId, "user-project-manager");

  const cleared = updateRiskMitigationInStore(store, riskId, {
    updatedAt: "2026-06-01T02:00:00.000Z",
    updatedByUserId: "user-quality-lead",
  });

  assert.equal(cleared.mitigation, "");
  assert.equal(cleared.mitigationDueAt, null);
  assert.equal(cleared.mitigationOwnerUserId, null);
  assert.equal(cleared.mitigationStatus, null);
  assert.equal(cleared.mitigationUpdatedByUserId, "user-quality-lead");
  assert.equal(updateRiskMitigationInStore(store, "missing-risk", { mitigation: "noop" }), null);
});

test("risk mitigation completion write helper marks plan done", () => {
  const store = createDemoStore();
  const riskId = "risk-thermal-margin";

  updateRiskMitigationInStore(store, riskId, {
    mitigation: "增加散热片验证",
    mitigationOwnerUserId: "user-quality-lead",
  });
  const completed = completeRiskMitigationInStore(store, riskId, {
    completedAt: "2026-06-01T03:00:00.000Z",
    completedByUserId: "user-quality-lead",
    completionComment: "验证完成",
  });

  assert.equal(completed.id, riskId);
  assert.equal(completed.mitigationStatus, "DONE");
  assert.equal(completed.mitigationCompletedAt, "2026-06-01T03:00:00.000Z");
  assert.equal(completed.mitigationCompletedByUserId, "user-quality-lead");
  assert.equal(completed.mitigationCompletionComment, "验证完成");
  assert.equal(findRisk(store, riskId).mitigationStatus, "DONE");
  assert.equal(completeRiskMitigationInStore(store, "missing-risk"), null);
});

test("risk status write helper records acceptance and closure metadata", () => {
  const store = createDemoStore();
  const riskId = "risk-thermal-margin";

  const accepted = updateRiskStatusInStore(store, riskId, {
    status: "ACCEPTED",
    actorUserId: "user-project-manager",
    comment: "业务接受",
    changedAt: "2026-06-01T04:00:00.000Z",
  });

  assert.equal(accepted.status, "ACCEPTED");
  assert.equal(accepted.acceptedByUserId, "user-project-manager");
  assert.equal(accepted.acceptedAt, "2026-06-01T04:00:00.000Z");
  assert.equal(accepted.acceptedComment, "业务接受");

  const closed = updateRiskStatusInStore(store, riskId, {
    status: "CLOSED",
    actorUserId: "user-quality-lead",
    comment: "措施关闭",
    changedAt: "2026-06-01T05:00:00.000Z",
  });

  assert.equal(closed.status, "CLOSED");
  assert.equal(closed.closedByUserId, "user-quality-lead");
  assert.equal(closed.closedAt, "2026-06-01T05:00:00.000Z");
  assert.equal(closed.closedComment, "措施关闭");
  assert.equal(findRisk(store, riskId).status, "CLOSED");
  assert.equal(updateRiskStatusInStore(store, "missing-risk", { status: "OPEN" }), null);
});

test("review condition completion write helper records completion metadata", () => {
  const store = createDemoStore();
  store.reviews.push({
    id: "review-conditional-helper",
    workPackageId: "wp-evt_exit-evt_test_plan",
    reviewerUserId: "user-test-lead",
    decision: "APPROVE_WITH_CONDITIONS",
    conditions: ["补充环境边界"],
    comment: "带条件批准",
    reviewedAt: "2026-06-01T07:00:00.000Z",
  });

  const completed = completeReviewConditionsInStore(store, "review-conditional-helper", {
    completedAt: "2026-06-01T08:00:00.000Z",
    completedByUserId: "user-test-lead",
    completionComment: "已补充",
  });

  assert.equal(completed.conditionsCompletedAt, "2026-06-01T08:00:00.000Z");
  assert.equal(completed.conditionsCompletedByUserId, "user-test-lead");
  assert.equal(completed.conditionsCompletionComment, "已补充");
  assert.equal(findReview(store, "review-conditional-helper").conditionsCompletionComment, "已补充");
  assert.equal(completeReviewConditionsInStore(store, "missing-review"), null);
});

test("role pair owner write helper tracks previous owner", () => {
  const store = createDemoStore();

  const changed = updateRolePairOwnerInStore(store, "pair-test_agent", "user-quality-lead");
  const unchanged = updateRolePairOwnerInStore(store, "pair-test_agent", "user-quality-lead");

  assert.equal(changed.rolePair.id, "pair-test_agent");
  assert.equal(changed.previousHumanUserId, "user-test-lead");
  assert.equal(changed.rolePair.humanUserId, "user-quality-lead");
  assert.equal(changed.changed, true);
  assert.equal(unchanged.previousHumanUserId, "user-quality-lead");
  assert.equal(unchanged.changed, false);
  assert.equal(findRolePair(store, "pair-test_agent").humanUserId, "user-quality-lead");
  assert.equal(updateRolePairOwnerInStore(store, "missing-role-pair", "user-quality-lead"), null);
});

test("project lifecycle write helpers select, archive, and restore projects", () => {
  const store = createDemoStore();
  store.projects.push({
    id: "project-other",
    name: "Other",
    currentPhaseId: "project-other-phase",
    status: "PLANNED",
  });

  const selected = selectProjectInStore(store, "project-other");
  const archived = archiveProjectInStore(store, "project-other", {
    archivedAt: "2026-05-31T04:00:00.000Z",
    archivedByUserId: "user-project-manager",
  });
  const archivedStatus = archived.project.status;
  const archivedAt = archived.project.archivedAt;
  const restored = restoreProjectInStore(store, "project-other", {
    restoredAt: "2026-05-31T05:00:00.000Z",
    restoredByUserId: "user-project-manager",
  });

  assert.equal(selected.id, "project-other");
  assert.equal(archived.previousStatus, "PLANNED");
  assert.equal(archivedStatus, "ARCHIVED");
  assert.equal(archivedAt, "2026-05-31T04:00:00.000Z");
  assert.equal(archived.replacementProject.id, "project-smart-controller");
  assert.equal(restored.restoredStatus, "PLANNED");
  assert.equal(restored.project.status, "PLANNED");
  assert.equal(restored.project.restoredAt, "2026-05-31T05:00:00.000Z");
  assert.equal(store.activeProjectId, "project-other");
  assert.equal(selectProjectInStore(store, "missing-project"), null);
  assert.equal(archiveProjectInStore(store, "missing-project"), null);
  assert.equal(restoreProjectInStore(store, "missing-project"), null);
});

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
