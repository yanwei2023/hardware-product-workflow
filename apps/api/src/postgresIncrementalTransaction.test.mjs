import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDemoStore } from "./demoStoreFactory.mjs";
import {
  addAgentJobInStore,
  addAuditEventInStore,
  addGateApprovalPackInStore,
  addNotificationInStore,
  addRiskInStore,
  addWorkPackageEvidenceRefInStore,
  approveGateInStore,
  completeReviewConditionsInStore,
  completeRiskMitigationInStore,
  markNotificationReadInStore,
  recordInvalidAgentOutputInStore,
  submitHumanReviewInStore,
  updateRiskMitigationInStore,
  updateRolePairOwnerInStore,
  updateRiskStatusInStore,
  updateWorkPackageScheduleInStore,
} from "./storeRepository.mjs";
import {
  buildAgentJobQueueTransaction,
  buildAgentOutputInvalidTransaction,
  buildConditionalApprovalCompletionTransaction,
  buildGateApprovalTransaction,
  buildNotificationReadTransaction,
  buildProjectNotificationsReadTransaction,
  buildRiskCreateTransaction,
  buildRiskTransaction,
  buildHumanReviewTransaction,
  buildRolePairOwnerTransaction,
  buildWorkPackageEvidenceTransaction,
  buildWorkPackageScheduleTransaction,
  executePostgresIncrementalTransaction,
} from "./postgresIncrementalTransaction.mjs";
import { mapStoreToPostgresRows } from "./postgresMapper.mjs";

function changedStores() {
  const previousStore = createDemoStore();
  const nextStore = structuredClone(previousStore);
  updateRolePairOwnerInStore(nextStore, "pair-test_agent", "user-quality-lead");
  addAuditEventInStore(nextStore, {
    id: "audit-role-change",
    projectId: nextStore.activeProjectId,
    actorType: "human",
    actorId: "user-project-manager",
    eventType: "ROLE_PAIR_UPDATED",
    objectType: "rolePair",
    objectId: "pair-test_agent",
    payload: { previousHumanUserId: "user-test-lead", humanUserId: "user-quality-lead" },
    createdAt: "2026-06-14T01:00:00.000Z",
  });
  addNotificationInStore(nextStore, {
    id: "notification-role-change",
    projectId: nextStore.activeProjectId,
    userId: "user-quality-lead",
    title: "角色负责人已指派给你",
    message: "测试负责人已指派给你。",
    type: "INFO",
    status: "UNREAD",
    objectType: "rolePair",
    objectId: "pair-test_agent",
    createdAt: "2026-06-14T01:00:00.000Z",
  });
  return { previousStore, nextStore };
}

function scheduleChangedStores() {
  const previousStore = createDemoStore();
  const nextStore = structuredClone(previousStore);
  const workPackageId = "wp-initiation-initial_project_plan";
  updateWorkPackageScheduleInStore(nextStore, workPackageId, "2026-07-01");
  addAuditEventInStore(nextStore, {
    id: "audit-schedule-change",
    projectId: nextStore.activeProjectId,
    actorType: "human",
    actorId: "user-project-manager",
    eventType: "WORK_PACKAGE_SCHEDULE_UPDATED",
    objectType: "workPackage",
    objectId: workPackageId,
    payload: { dueAt: "2026-07-01", scheduleStatus: "PLANNED" },
    createdAt: "2026-06-14T02:00:00.000Z",
  });
  addNotificationInStore(nextStore, {
    id: "notification-schedule-change",
    projectId: nextStore.activeProjectId,
    userId: "user-project-manager",
    title: "工作包截止日期已更新",
    message: "初版项目计划的截止日期更新为 2026-07-01。",
    type: "INFO",
    status: "UNREAD",
    objectType: "workPackage",
    objectId: workPackageId,
    createdAt: "2026-06-14T02:00:00.000Z",
  });
  return { previousStore, nextStore, workPackageId };
}

function evidenceChangedStores({ file = false } = {}) {
  const previousStore = createDemoStore();
  const nextStore = structuredClone(previousStore);
  const workPackageId = "wp-evt_exit-evt_test_plan";
  const evidenceRef = addWorkPackageEvidenceRefInStore(nextStore, workPackageId, {
    id: `evidence-${file ? "file" : "ref"}`,
    label: file ? "热测试附件" : "热测试报告",
    ref: file ? "/evidence-files/evidence-file/download" : "https://example.test/reports/thermal",
    kind: file ? "file" : "reference",
    fileName: file ? "evidence-file.txt" : null,
    originalFileName: file ? "thermal-report.txt" : null,
    mimeType: file ? "text/plain" : null,
    sizeBytes: file ? 25 : null,
    storagePath: file ? "/tmp/evidence-file.txt" : null,
    createdByUserId: "user-test-lead",
    createdAt: file ? "2026-06-14T08:30:00.000Z" : "2026-06-14T08:00:00.000Z",
  });
  addAuditEventInStore(nextStore, {
    id: `audit-${evidenceRef.id}`,
    projectId: nextStore.activeProjectId,
    actorType: "human",
    actorId: "user-test-lead",
    eventType: file ? "WORK_PACKAGE_EVIDENCE_FILE_UPLOADED" : "WORK_PACKAGE_EVIDENCE_ADDED",
    objectType: "workPackage",
    objectId: workPackageId,
    payload: file
      ? {
          evidenceRefId: evidenceRef.id,
          label: evidenceRef.label,
          originalFileName: evidenceRef.originalFileName,
          sizeBytes: evidenceRef.sizeBytes,
        }
      : {
          evidenceRefId: evidenceRef.id,
          label: evidenceRef.label,
          ref: evidenceRef.ref,
        },
    createdAt: evidenceRef.createdAt,
  });
  return { previousStore, nextStore, workPackageId, evidenceRefId: evidenceRef.id };
}

function notificationReadStores() {
  const previousStore = createDemoStore();
  addNotificationInStore(previousStore, {
    id: "notification-read-target",
    projectId: previousStore.activeProjectId,
    userId: "user-project-manager",
    title: "待读通知",
    message: "需要确认。",
    type: "INFO",
    status: "UNREAD",
    objectType: "project",
    objectId: previousStore.activeProjectId,
    createdAt: "2026-06-14T02:30:00.000Z",
  });
  const nextStore = structuredClone(previousStore);
  const notificationId = "notification-read-target";
  markNotificationReadInStore(nextStore, notificationId, { readAt: "2026-06-14T03:00:00.000Z" });
  return { previousStore, nextStore, notificationId };
}

function projectNotificationsReadStores() {
  const previousStore = createDemoStore();
  const projectId = previousStore.activeProjectId;
  const userId = "user-project-manager";
  for (const id of ["notification-read-target-a", "notification-read-target-b"]) {
    addNotificationInStore(previousStore, {
      id,
      projectId,
      userId,
      title: `待读通知 ${id}`,
      message: "需要确认。",
      type: "INFO",
      status: "UNREAD",
      objectType: "project",
      objectId: projectId,
      createdAt: "2026-06-14T02:30:00.000Z",
    });
  }
  const nextStore = structuredClone(previousStore);
  for (const notificationId of ["notification-read-target-a", "notification-read-target-b"]) {
    markNotificationReadInStore(nextStore, notificationId, { readAt: "2026-06-14T03:00:00.000Z" });
  }
  return { previousStore, nextStore, projectId, userId, notificationIds: ["notification-read-target-a", "notification-read-target-b"] };
}

function riskCreatedStores() {
  const previousStore = createDemoStore();
  const nextStore = structuredClone(previousStore);
  const riskId = "risk-evt_exit-supply-delay";
  const projectId = nextStore.activeProjectId;
  const phaseId = "phase-evt_exit";
  addRiskInStore(nextStore, {
    id: riskId,
    projectId,
    phaseId,
    title: "关键物料交期不确定",
    severity: "HIGH",
    status: "OPEN",
    createdByUserId: "user-project-manager",
    createdAt: "2026-06-14T02:45:00.000Z",
  });
  addAuditEventInStore(nextStore, {
    id: "audit-risk-created",
    projectId,
    actorType: "human",
    actorId: "user-project-manager",
    eventType: "RISK_CREATED",
    objectType: "risk",
    objectId: riskId,
    payload: { phaseId, severity: "HIGH" },
    createdAt: "2026-06-14T02:45:00.000Z",
  });
  addNotificationInStore(nextStore, {
    id: "notification-risk-created-pm",
    projectId,
    userId: "user-project-manager",
    title: "新风险待处理",
    message: "关键物料交期不确定 已创建，严重度为 HIGH。",
    type: "ACTION",
    status: "UNREAD",
    objectType: "risk",
    objectId: riskId,
    createdAt: "2026-06-14T02:45:00.000Z",
  });
  addNotificationInStore(nextStore, {
    id: "notification-risk-created-quality",
    projectId,
    userId: "user-quality-lead",
    title: "新风险待处理",
    message: "关键物料交期不确定 已创建，严重度为 HIGH。",
    type: "ACTION",
    status: "UNREAD",
    objectType: "risk",
    objectId: riskId,
    createdAt: "2026-06-14T02:45:00.000Z",
  });
  return { previousStore, nextStore, riskId };
}

function agentJobQueuedStores() {
  const previousStore = createDemoStore();
  const nextStore = structuredClone(previousStore);
  const agentJobId = "agent-job-evt-test-plan";
  const projectId = nextStore.activeProjectId;
  const workPackageId = "wp-evt_exit-evt_test_plan";
  addAgentJobInStore(nextStore, {
    id: agentJobId,
    projectId,
    workPackageId,
    agentKey: "test-agent",
    inputRefs: ["artifact:queued-agent"],
    draftMarkdown: "## 测试计划\n\n- 覆盖热测试。",
    requestedByUserId: "user-project-manager",
    status: "QUEUED",
    createdAt: "2026-06-14T02:50:00.000Z",
    startedAt: null,
    completedAt: null,
    resultStatusCode: null,
    agentRunId: null,
    error: "",
  });
  addAuditEventInStore(nextStore, {
    id: "audit-agent-job-queued",
    projectId,
    actorType: "human",
    actorId: "user-project-manager",
    eventType: "AGENT_JOB_QUEUED",
    objectType: "workPackage",
    objectId: workPackageId,
    payload: { agentJobId, agentKey: "test-agent" },
    createdAt: "2026-06-14T02:50:00.000Z",
  });
  return { previousStore, nextStore, agentJobId, workPackageId };
}

function agentOutputInvalidStores() {
  const previousStore = createDemoStore();
  const nextStore = structuredClone(previousStore);
  const workPackageId = "wp-evt_exit-evt_test_report";
  const agentRunId = "agent-run-invalid-output";
  const validation = {
    status: "FAILED",
    missingSections: ["测试结论"],
    unexpectedSections: [],
  };
  recordInvalidAgentOutputInStore(nextStore, workPackageId, {
    id: agentRunId,
    workPackageId,
    agentKey: "test_agent",
    status: "OUTPUT_INVALID",
    inputRefs: ["artifact:thermal-test"],
    artifactTemplateKey: "evt_test_report_v0_1",
    requiredSections: ["测试结论"],
    requiredReviewRoles: ["测试负责人"],
    validation,
    createdAt: "2026-06-14T02:55:00.000Z",
    completedAt: "2026-06-14T02:55:00.000Z",
  });
  addAuditEventInStore(nextStore, {
    id: "audit-agent-output-invalid",
    projectId: nextStore.activeProjectId,
    actorType: "agent",
    actorId: "test_agent",
    eventType: "AGENT_OUTPUT_INVALID",
    objectType: "workPackage",
    objectId: workPackageId,
    payload: { artifactTemplateKey: "evt_test_report_v0_1", validation },
    createdAt: "2026-06-14T02:55:00.000Z",
  });
  addNotificationInStore(nextStore, {
    id: "notification-agent-output-invalid",
    projectId: nextStore.activeProjectId,
    userId: "user-test-lead",
    title: "Agent 输出未通过模板校验",
    message: "EVT 测试报告 需要重新生成或补齐必需章节。",
    type: "WARNING",
    status: "UNREAD",
    objectType: "workPackage",
    objectId: workPackageId,
    createdAt: "2026-06-14T02:55:00.000Z",
  });
  return { previousStore, nextStore, workPackageId, agentRunId };
}

function riskStatusChangedStores() {
  const previousStore = createDemoStore();
  const nextStore = structuredClone(previousStore);
  const riskId = "risk-thermal-margin";
  updateRiskStatusInStore(nextStore, riskId, {
    status: "ACCEPTED",
    actorUserId: "user-project-manager",
    comment: "pilot accepted",
    changedAt: "2026-06-14T03:00:00.000Z",
  });
  addAuditEventInStore(nextStore, {
    id: "audit-risk-accepted",
    projectId: nextStore.activeProjectId,
    actorType: "human",
    actorId: "user-project-manager",
    eventType: "RISK_ACCEPTED",
    objectType: "risk",
    objectId: riskId,
    payload: { comment: "pilot accepted" },
    createdAt: "2026-06-14T03:00:00.000Z",
  });
  addNotificationInStore(nextStore, {
    id: "notification-risk-accepted",
    projectId: nextStore.activeProjectId,
    userId: "user-project-manager",
    title: "风险已接受",
    message: "热设计裕量不足 状态更新为 ACCEPTED。",
    type: "INFO",
    status: "UNREAD",
    objectType: "risk",
    objectId: riskId,
    createdAt: "2026-06-14T03:00:00.000Z",
  });
  return { previousStore, nextStore, riskId };
}

function riskMitigationChangedStores() {
  const previousStore = createDemoStore();
  const nextStore = structuredClone(previousStore);
  const riskId = "risk-thermal-margin";
  updateRiskMitigationInStore(nextStore, riskId, {
    mitigation: "增加热仿真复核并补测高温场景。",
    mitigationDueAt: "2026-07-15",
    mitigationOwnerUserId: "user-quality-lead",
    updatedAt: "2026-06-14T04:00:00.000Z",
    updatedByUserId: "user-project-manager",
  });
  addAuditEventInStore(nextStore, {
    id: "audit-risk-mitigation",
    projectId: nextStore.activeProjectId,
    actorType: "human",
    actorId: "user-project-manager",
    eventType: "RISK_MITIGATION_UPDATED",
    objectType: "risk",
    objectId: riskId,
    payload: { mitigationOwnerUserId: "user-quality-lead", mitigationDueAt: "2026-07-15" },
    createdAt: "2026-06-14T04:00:00.000Z",
  });
  addNotificationInStore(nextStore, {
    id: "notification-risk-mitigation",
    projectId: nextStore.activeProjectId,
    userId: "user-quality-lead",
    title: "风险缓解任务已分配",
    message: "热设计裕量不足 的缓解措施已更新，截止日期 2026-07-15。",
    type: "ACTION",
    status: "UNREAD",
    objectType: "risk",
    objectId: riskId,
    createdAt: "2026-06-14T04:00:00.000Z",
  });
  return { previousStore, nextStore, riskId };
}

function riskMitigationCompletedStores() {
  const previousStore = createDemoStore();
  const riskId = "risk-thermal-margin";
  updateRiskMitigationInStore(previousStore, riskId, {
    mitigation: "增加热仿真复核并补测高温场景。",
    mitigationDueAt: "2026-07-15",
    mitigationOwnerUserId: "user-quality-lead",
    updatedAt: "2026-06-14T04:00:00.000Z",
    updatedByUserId: "user-project-manager",
  });
  const nextStore = structuredClone(previousStore);
  completeRiskMitigationInStore(nextStore, riskId, {
    completedAt: "2026-06-14T05:00:00.000Z",
    completedByUserId: "user-quality-lead",
    completionComment: "复测通过。",
  });
  addAuditEventInStore(nextStore, {
    id: "audit-risk-mitigation-done",
    projectId: nextStore.activeProjectId,
    actorType: "human",
    actorId: "user-quality-lead",
    eventType: "RISK_MITIGATION_DONE",
    objectType: "risk",
    objectId: riskId,
    payload: { mitigationOwnerUserId: "user-quality-lead", comment: "复测通过。" },
    createdAt: "2026-06-14T05:00:00.000Z",
  });
  addNotificationInStore(nextStore, {
    id: "notification-risk-mitigation-done",
    projectId: nextStore.activeProjectId,
    userId: "user-project-manager",
    title: "风险缓解已完成",
    message: "热设计裕量不足 的缓解任务已由 user-quality-lead 完成。",
    type: "INFO",
    status: "UNREAD",
    objectType: "risk",
    objectId: riskId,
    createdAt: "2026-06-14T05:00:00.000Z",
  });
  return { previousStore, nextStore, riskId };
}

function humanReviewChangedStores(decision = "APPROVE") {
  const previousStore = createDemoStore();
  const nextStore = structuredClone(previousStore);
  const workPackageId = "wp-evt_exit-evt_test_plan";
  const artifactId = "artifact-evt-test-plan-draft";
  const review = {
    id: `review-${decision.toLowerCase().replaceAll("_", "-")}`,
    workPackageId,
    reviewerUserId: "user-test-lead",
    decision,
    comment: decision === "REQUEST_REVISION" ? "补充覆盖矩阵。" : "",
    conditions: decision === "APPROVE_WITH_CONDITIONS" ? ["补充低温启动测试"] : [],
    reviewedAt: "2026-06-14T06:00:00.000Z",
  };
  submitHumanReviewInStore(nextStore, workPackageId, artifactId, review);
  addAuditEventInStore(nextStore, {
    id: `audit-${review.id}`,
    projectId: nextStore.activeProjectId,
    actorType: "human",
    actorId: "user-test-lead",
    eventType: "HUMAN_REVIEW_SUBMITTED",
    objectType: "workPackage",
    objectId: workPackageId,
    payload: { decision, comment: review.comment },
    createdAt: "2026-06-14T06:00:00.000Z",
  });
  addNotificationInStore(nextStore, {
    id: `notification-${review.id}`,
    projectId: nextStore.activeProjectId,
    userId: "user-project-manager",
    title: decision === "APPROVE" || decision === "APPROVE_WITH_CONDITIONS" ? "工作包已批准" : "工作包需要返工",
    message: `EVT 测试计划 的审核结果为 ${decision}。`,
    type: decision === "APPROVE" || decision === "APPROVE_WITH_CONDITIONS" ? "INFO" : "WARNING",
    status: "UNREAD",
    objectType: "workPackage",
    objectId: workPackageId,
    createdAt: "2026-06-14T06:00:00.000Z",
  });
  return { previousStore, nextStore, workPackageId, artifactId, reviewId: review.id };
}

function conditionalApprovalCompletedStores() {
  const seeded = humanReviewChangedStores("APPROVE_WITH_CONDITIONS");
  const previousStore = seeded.nextStore;
  const nextStore = structuredClone(previousStore);
  completeReviewConditionsInStore(nextStore, seeded.reviewId, {
    completedAt: "2026-06-14T06:30:00.000Z",
    completedByUserId: "user-test-lead",
    completionComment: "低温启动测试已补充。",
  });
  addAuditEventInStore(nextStore, {
    id: "audit-conditional-approval-complete",
    projectId: nextStore.activeProjectId,
    actorType: "human",
    actorId: "user-test-lead",
    eventType: "CONDITIONAL_APPROVAL_COMPLETED",
    objectType: "review",
    objectId: seeded.reviewId,
    payload: { workPackageId: seeded.workPackageId, conditions: ["补充低温启动测试"], comment: "低温启动测试已补充。" },
    createdAt: "2026-06-14T06:30:00.000Z",
  });
  addNotificationInStore(nextStore, {
    id: "notification-conditional-approval-complete",
    projectId: nextStore.activeProjectId,
    userId: "user-project-manager",
    title: "有条件批准条款已完成",
    message: "EVT 测试计划 的补充条款已由 user-test-lead 完成。",
    type: "INFO",
    status: "UNREAD",
    objectType: "review",
    objectId: seeded.reviewId,
    createdAt: "2026-06-14T06:30:00.000Z",
  });
  return { previousStore, nextStore, reviewId: seeded.reviewId };
}

function gateApprovalChangedStores({ final = false } = {}) {
  const previousStore = createDemoStore();
  const project = previousStore.projects.find((item) => item.id === previousStore.activeProjectId);
  let gateId = "gate-evt_exit";
  if (final) {
    const finalPhase = previousStore.phases
      .filter((item) => item.projectId === project.id)
      .sort((left, right) => right.sequence - left.sequence)[0];
    project.currentPhaseId = finalPhase.id;
    finalPhase.status = "GATE_BLOCKED";
    gateId = previousStore.gates.find((item) => item.phaseId === finalPhase.id).id;
  }
  previousStore.gates.find((item) => item.id === gateId).status = "READY";

  const nextStore = structuredClone(previousStore);
  const approvedAt = final ? "2026-06-14T07:30:00.000Z" : "2026-06-14T07:00:00.000Z";
  const approvalComment = final ? "批准项目完成" : "批准进入下一阶段";
  const approval = approveGateInStore(nextStore, gateId, {
    approvedByUserId: "user-project-manager",
    approvedAt,
    approvalComment,
  });
  const approvalPackId = `gate-pack-${final ? "final" : "evt"}`;
  addGateApprovalPackInStore(nextStore, {
    id: approvalPackId,
    projectId: approval.gate.projectId,
    gateId: approval.gate.id,
    phaseId: approval.gate.phaseId,
    approvedByUserId: "user-project-manager",
    approvedAt: approval.gate.approvedAt,
    approvalComment: approval.gate.approvalComment,
    reviewPack: {
      gate: { id: approval.gate.id, status: "APPROVED" },
      readiness: { status: "READY", blockers: [] },
      summary: { readyForApproval: true, blockerCount: 0 },
    },
  });
  addAuditEventInStore(nextStore, {
    id: `audit-${approvalPackId}`,
    projectId: approval.gate.projectId,
    actorType: "human",
    actorId: "user-project-manager",
    eventType: "GATE_APPROVED",
    objectType: "gate",
    objectId: approval.gate.id,
    payload: {
      nextPhaseId: approval.project.currentPhaseId,
      comment: approval.gate.approvalComment,
      approvalPackId,
    },
    createdAt: approvedAt,
  });
  addNotificationInStore(nextStore, {
    id: `notification-${approvalPackId}`,
    projectId: approval.gate.projectId,
    userId: "user-project-manager",
    title: "阶段门已批准",
    message: `${approval.phase.name} 阶段门已批准。`,
    type: "INFO",
    status: "UNREAD",
    objectType: "gate",
    objectId: approval.gate.id,
    createdAt: approvedAt,
  });
  return { previousStore, nextStore, gateId, approvalPackId };
}

function queryRunnerSequence(rowsList) {
  let index = 0;
  return () => ({ status: 0, signal: null, stdout: `${JSON.stringify(rowsList[Math.min(index++, rowsList.length - 1)])}\n`, stderr: "" });
}

test("role pair owner transaction updates business state, audit, and notifications atomically", () => {
  const { previousStore, nextStore } = changedStores();
  const transaction = buildRolePairOwnerTransaction({ previousStore, nextStore, rolePairId: "pair-test_agent" });

  assert.match(transaction.applySql, /^-- Native incremental role-pair owner transaction/m);
  assert.match(transaction.applySql, /BEGIN;[\s\S]*pg_advisory_xact_lock[\s\S]*UPDATE role_pairs[\s\S]*INSERT INTO audit_events[\s\S]*INSERT INTO notifications[\s\S]*COMMIT;/);
  assert.match(transaction.applySql, /human_user_id = 'user-quality-lead'/);
  assert.match(transaction.rollbackSql, /DELETE FROM notifications[\s\S]*DELETE FROM audit_events[\s\S]*human_user_id = 'user-test-lead'/);
  assert.equal(transaction.auditEventCount, 1);
  assert.equal(transaction.notificationCount, 1);
});

test("role pair owner transaction rejects unrelated in-memory changes", () => {
  const { previousStore, nextStore } = changedStores();
  nextStore.projects[0].status = "UNRELATED_CHANGE";

  assert.throws(
    () => buildRolePairOwnerTransaction({ previousStore, nextStore, rolePairId: "pair-test_agent" }),
    /contains unrelated store changes: projects/,
  );
});

test("work package schedule transaction updates due date, audit, and notifications atomically", () => {
  const { previousStore, nextStore, workPackageId } = scheduleChangedStores();
  const transaction = buildWorkPackageScheduleTransaction({ previousStore, nextStore, workPackageId });

  assert.match(transaction.applySql, /^-- Native incremental work-package schedule transaction/m);
  assert.match(transaction.applySql, /UPDATE work_packages SET due_at = '2026-07-01'/);
  assert.match(transaction.applySql, /due_at IS NOT DISTINCT FROM NULL/);
  assert.match(transaction.applySql, /INSERT INTO audit_events[\s\S]*INSERT INTO notifications[\s\S]*COMMIT;/);
  assert.match(transaction.rollbackSql, /DELETE FROM notifications[\s\S]*DELETE FROM audit_events[\s\S]*SET due_at = NULL/);
  assert.equal(transaction.auditEventCount, 1);
  assert.equal(transaction.notificationCount, 1);
});

test("work package schedule transaction supports clearing a due date", () => {
  const { previousStore, nextStore, workPackageId } = scheduleChangedStores();
  updateWorkPackageScheduleInStore(previousStore, workPackageId, "2026-06-30");
  updateWorkPackageScheduleInStore(nextStore, workPackageId, null);

  const transaction = buildWorkPackageScheduleTransaction({ previousStore, nextStore, workPackageId });

  assert.match(transaction.applySql, /SET due_at = NULL[\s\S]*due_at IS NOT DISTINCT FROM '2026-06-30'/);
  assert.match(transaction.rollbackSql, /SET due_at = '2026-06-30'[\s\S]*due_at IS NOT DISTINCT FROM NULL/);
});

test("work package schedule transaction rejects unrelated in-memory changes", () => {
  const { previousStore, nextStore, workPackageId } = scheduleChangedStores();
  nextStore.projects[0].status = "UNRELATED_CHANGE";

  assert.throws(
    () => buildWorkPackageScheduleTransaction({ previousStore, nextStore, workPackageId }),
    /contains unrelated store changes: projects/,
  );
});

test("work package evidence transaction inserts evidence and audit atomically", () => {
  const { previousStore, nextStore, workPackageId, evidenceRefId } = evidenceChangedStores();
  const transaction = buildWorkPackageEvidenceTransaction({ previousStore, nextStore, workPackageId, evidenceRefId });

  assert.match(transaction.applySql, /^-- Native incremental work-package evidence transaction/m);
  assert.match(transaction.applySql, /INSERT INTO work_package_evidence_refs/);
  assert.match(transaction.applySql, /https:\/\/example\.test\/reports\/thermal/);
  assert.match(transaction.applySql, /INSERT INTO audit_events[\s\S]*WORK_PACKAGE_EVIDENCE_ADDED[\s\S]*COMMIT;/);
  assert.match(transaction.rollbackSql, /DELETE FROM audit_events[\s\S]*DELETE FROM work_package_evidence_refs/);
  assert.equal(transaction.auditEventCount, 1);
  assert.equal(transaction.notificationCount, 0);
});

test("work package evidence transaction supports uploaded file audit events", () => {
  const { previousStore, nextStore, workPackageId, evidenceRefId } = evidenceChangedStores({ file: true });
  const transaction = buildWorkPackageEvidenceTransaction({ previousStore, nextStore, workPackageId, evidenceRefId });

  assert.match(transaction.applySql, /WORK_PACKAGE_EVIDENCE_FILE_UPLOADED/);
  assert.match(transaction.applySql, /\/evidence-files\/evidence-file\/download/);
});

test("work package evidence transaction rejects unrelated evidence changes", () => {
  const { previousStore, nextStore, workPackageId, evidenceRefId } = evidenceChangedStores();
  nextStore.evidenceRefs.push({
    id: "evidence-extra",
    projectId: nextStore.activeProjectId,
    workPackageId,
    label: "额外证据",
    ref: "https://example.test/extra",
    createdByUserId: "user-test-lead",
    createdAt: "2026-06-14T09:00:00.000Z",
  });

  assert.throws(
    () => buildWorkPackageEvidenceTransaction({ previousStore, nextStore, workPackageId, evidenceRefId }),
    /requires exactly one inserted evidence ref/,
  );
});

test("notification read transaction marks one notification read with compensation", () => {
  const { previousStore, nextStore, notificationId } = notificationReadStores();
  const transaction = buildNotificationReadTransaction({ previousStore, nextStore, notificationId });

  assert.match(transaction.applySql, /^-- Native incremental notification-read transaction/m);
  assert.match(transaction.applySql, /UPDATE notifications SET status = 'READ', read_at = '2026-06-14T03:00:00.000Z'/);
  assert.match(transaction.applySql, /status = 'UNREAD'[\s\S]*read_at IS NOT DISTINCT FROM NULL/);
  assert.match(transaction.rollbackSql, /SET status = 'UNREAD', read_at = NULL/);
  assert.equal(transaction.auditEventCount, 0);
  assert.equal(transaction.notificationCount, 1);
});

test("notification read transaction supports refreshing an existing read timestamp", () => {
  const { previousStore, nextStore, notificationId } = notificationReadStores();
  markNotificationReadInStore(previousStore, notificationId, { readAt: "2026-06-14T02:00:00.000Z" });

  const transaction = buildNotificationReadTransaction({ previousStore, nextStore, notificationId });

  assert.match(transaction.applySql, /status = 'READ'[\s\S]*read_at IS NOT DISTINCT FROM '2026-06-14T02:00:00.000Z'/);
  assert.match(transaction.rollbackSql, /SET status = 'READ', read_at = '2026-06-14T02:00:00.000Z'/);
});

test("notification read transaction rejects unrelated in-memory changes", () => {
  const { previousStore, nextStore, notificationId } = notificationReadStores();
  nextStore.projects[0].status = "UNRELATED_CHANGE";

  assert.throws(
    () => buildNotificationReadTransaction({ previousStore, nextStore, notificationId }),
    /contains unrelated store changes: projects/,
  );
});

test("project notifications read transaction marks all scoped notifications read", () => {
  const { previousStore, nextStore, projectId, userId, notificationIds } = projectNotificationsReadStores();
  const transaction = buildProjectNotificationsReadTransaction({ previousStore, nextStore, projectId, userId });

  assert.match(transaction.applySql, /^-- Native incremental project-notifications-read transaction/m);
  assert.equal((transaction.applySql.match(/UPDATE notifications SET status = 'READ'/g) || []).length, 2);
  assert.match(transaction.applySql, /project_id = 'project-smart-controller'/);
  assert.match(transaction.applySql, /user_id = 'user-project-manager'/);
  assert.match(transaction.rollbackSql, /SET status = 'UNREAD', read_at = NULL/);
  assert.deepEqual(transaction.notificationIds, notificationIds);
  assert.equal(transaction.auditEventCount, 0);
  assert.equal(transaction.notificationCount, 2);
});

test("project notifications read transaction rejects notifications outside the user scope", () => {
  const { previousStore, nextStore, projectId, userId } = projectNotificationsReadStores();
  nextStore.notifications.find((notification) => notification.id === "notification-read-target-b").userId = "user-quality-lead";

  assert.throws(
    () => buildProjectNotificationsReadTransaction({ previousStore, nextStore, projectId, userId }),
    /outside the user/,
  );
});

test("risk create transaction inserts risk, audit, and notifications atomically", () => {
  const { previousStore, nextStore, riskId } = riskCreatedStores();
  const transaction = buildRiskCreateTransaction({ previousStore, nextStore, riskId });

  assert.match(transaction.applySql, /^-- Native incremental risk-create transaction/m);
  assert.match(transaction.applySql, /INSERT INTO risks/);
  assert.match(transaction.applySql, /关键物料交期不确定/);
  assert.match(transaction.applySql, /INSERT INTO audit_events[\s\S]*RISK_CREATED[\s\S]*INSERT INTO notifications/);
  assert.match(transaction.rollbackSql, /DELETE FROM notifications[\s\S]*DELETE FROM audit_events[\s\S]*DELETE FROM risks/);
  assert.equal(transaction.auditEventCount, 1);
  assert.equal(transaction.notificationCount, 2);
});

test("risk create transaction rejects multiple inserted risks", () => {
  const { previousStore, nextStore, riskId } = riskCreatedStores();
  addRiskInStore(nextStore, {
    id: "risk-extra",
    projectId: nextStore.activeProjectId,
    phaseId: "phase-evt_exit",
    title: "额外风险",
    severity: "LOW",
    status: "OPEN",
    createdByUserId: "user-project-manager",
    createdAt: "2026-06-14T02:46:00.000Z",
  });

  assert.throws(
    () => buildRiskCreateTransaction({ previousStore, nextStore, riskId }),
    /requires exactly one inserted risk/,
  );
});

test("agent job queue transaction inserts job and audit atomically", () => {
  const { previousStore, nextStore, agentJobId } = agentJobQueuedStores();
  const transaction = buildAgentJobQueueTransaction({ previousStore, nextStore, agentJobId });

  assert.match(transaction.applySql, /^-- Native incremental agent-job-queue transaction/m);
  assert.match(transaction.applySql, /INSERT INTO agent_jobs/);
  assert.match(transaction.applySql, /artifact:queued-agent/);
  assert.match(transaction.applySql, /INSERT INTO audit_events[\s\S]*AGENT_JOB_QUEUED/);
  assert.match(transaction.rollbackSql, /DELETE FROM audit_events[\s\S]*DELETE FROM agent_jobs/);
  assert.equal(transaction.auditEventCount, 1);
  assert.equal(transaction.notificationCount, 0);
});

test("agent job queue transaction rejects multiple inserted jobs", () => {
  const { previousStore, nextStore, agentJobId } = agentJobQueuedStores();
  addAgentJobInStore(nextStore, {
    id: "agent-job-extra",
    projectId: nextStore.activeProjectId,
    workPackageId: "wp-evt_exit-evt_test_plan",
    agentKey: "test-agent",
    inputRefs: [],
    draftMarkdown: null,
    requestedByUserId: "user-project-manager",
    status: "QUEUED",
    createdAt: "2026-06-14T02:51:00.000Z",
    startedAt: null,
    completedAt: null,
    resultStatusCode: null,
    agentRunId: null,
    error: "",
  });

  assert.throws(
    () => buildAgentJobQueueTransaction({ previousStore, nextStore, agentJobId }),
    /requires exactly one inserted agent job/,
  );
});

test("agent output invalid transaction records failed run and notification atomically", () => {
  const { previousStore, nextStore, workPackageId, agentRunId } = agentOutputInvalidStores();
  const transaction = buildAgentOutputInvalidTransaction({ previousStore, nextStore, workPackageId, agentRunId });

  assert.match(transaction.applySql, /^-- Native incremental agent-output-invalid transaction/m);
  assert.match(transaction.applySql, /INSERT INTO agent_runs/);
  assert.match(transaction.applySql, /OUTPUT_INVALID/);
  assert.match(transaction.applySql, /UPDATE work_packages SET status = 'NEEDS_AGENT_REVISION'/);
  assert.match(transaction.applySql, /INSERT INTO audit_events[\s\S]*AGENT_OUTPUT_INVALID[\s\S]*INSERT INTO notifications/);
  assert.match(transaction.rollbackSql, /DELETE FROM notifications[\s\S]*DELETE FROM audit_events[\s\S]*DELETE FROM agent_runs[\s\S]*UPDATE work_packages/);
  assert.equal(transaction.auditEventCount, 1);
  assert.equal(transaction.notificationCount, 1);
});

test("agent output invalid transaction rejects artifact insertions", () => {
  const { previousStore, nextStore, workPackageId, agentRunId } = agentOutputInvalidStores();
  nextStore.artifactVersions.push({
    id: "artifact-unexpected",
    workPackageId,
    artifactType: "EVT_TEST_REPORT",
    status: "PENDING_REVIEW",
    version: "0.1",
    createdByActor: "agent:test_agent",
    content: {},
  });

  assert.throws(
    () => buildAgentOutputInvalidTransaction({ previousStore, nextStore, workPackageId, agentRunId }),
    /contains unrelated store changes: artifact_versions/,
  );
});

test("risk status transaction updates decision fields, audit, and notifications atomically", () => {
  const { previousStore, nextStore, riskId } = riskStatusChangedStores();
  const transaction = buildRiskTransaction({ previousStore, nextStore, riskId, kind: "risk-status-update" });

  assert.match(transaction.applySql, /^-- Native incremental risk-status-update transaction/m);
  assert.match(transaction.applySql, /UPDATE risks SET [\s\S]*status = 'ACCEPTED'/);
  assert.match(transaction.applySql, /accepted_by_user_id = 'user-project-manager'/);
  assert.match(transaction.applySql, /status IS NOT DISTINCT FROM 'OPEN'/);
  assert.match(transaction.rollbackSql, /DELETE FROM notifications[\s\S]*DELETE FROM audit_events[\s\S]*status = 'OPEN'/);
  assert.equal(transaction.auditEventCount, 1);
  assert.equal(transaction.notificationCount, 1);
});

test("risk mitigation transaction updates plan fields atomically", () => {
  const { previousStore, nextStore, riskId } = riskMitigationChangedStores();
  const transaction = buildRiskTransaction({ previousStore, nextStore, riskId, kind: "risk-mitigation-update" });

  assert.match(transaction.applySql, /mitigation_owner_user_id = 'user-quality-lead'/);
  assert.match(transaction.applySql, /mitigation_due_at = '2026-07-15'/);
  assert.match(transaction.applySql, /mitigation_status = 'OPEN'/);
  assert.match(transaction.rollbackSql, /mitigation_owner_user_id = NULL/);
  assert.equal(transaction.notificationCount, 1);
});

test("risk mitigation completion transaction updates completion fields atomically", () => {
  const { previousStore, nextStore, riskId } = riskMitigationCompletedStores();
  const transaction = buildRiskTransaction({ previousStore, nextStore, riskId, kind: "risk-mitigation-complete" });

  assert.match(transaction.applySql, /mitigation_status = 'DONE'/);
  assert.match(transaction.applySql, /mitigation_completed_by_user_id = 'user-quality-lead'/);
  assert.match(transaction.rollbackSql, /mitigation_status = 'OPEN'/);
  assert.equal(transaction.auditEventCount, 1);
});

test("risk transaction rejects unrelated risk fields", () => {
  const { previousStore, nextStore, riskId } = riskMitigationChangedStores();
  nextStore.risks.find((risk) => risk.id === riskId).status = "CLOSED";

  assert.throws(
    () => buildRiskTransaction({ previousStore, nextStore, riskId, kind: "risk-mitigation-update" }),
    /unsupported risk fields: status/,
  );
});

test("human review transaction approves work package and artifact atomically", () => {
  const { previousStore, nextStore, workPackageId, artifactId, reviewId } = humanReviewChangedStores();
  const transaction = buildHumanReviewTransaction({ previousStore, nextStore, workPackageId, artifactId, reviewId });

  assert.match(transaction.applySql, /^-- Native incremental human-review transaction/m);
  assert.match(transaction.applySql, /UPDATE work_packages SET status = 'HUMAN_APPROVED'/);
  assert.match(transaction.applySql, /UPDATE artifact_versions SET status = 'APPROVED', version = '1.0'/);
  assert.match(transaction.applySql, /INSERT INTO reviews[\s\S]*INSERT INTO audit_events[\s\S]*INSERT INTO notifications[\s\S]*COMMIT;/);
  assert.match(transaction.rollbackSql, /DELETE FROM notifications[\s\S]*DELETE FROM audit_events[\s\S]*DELETE FROM reviews[\s\S]*status = 'PENDING_REVIEW'/);
  assert.equal(transaction.auditEventCount, 1);
  assert.equal(transaction.notificationCount, 1);
});

test("human review transaction supports revision decisions", () => {
  const { previousStore, nextStore, workPackageId, artifactId, reviewId } = humanReviewChangedStores("REQUEST_REVISION");
  const transaction = buildHumanReviewTransaction({ previousStore, nextStore, workPackageId, artifactId, reviewId });

  assert.match(transaction.applySql, /UPDATE work_packages SET status = 'NEEDS_AGENT_REVISION'/);
  assert.match(transaction.applySql, /UPDATE artifact_versions SET status = 'NEEDS_REVISION'/);
  assert.deepEqual(transaction.changedArtifactFields, ["status"]);
});

test("human review transaction rejects unrelated artifact changes", () => {
  const { previousStore, nextStore, workPackageId, artifactId, reviewId } = humanReviewChangedStores();
  nextStore.artifactVersions.find((artifact) => artifact.id === artifactId).objectKey = "unexpected";

  assert.throws(
    () => buildHumanReviewTransaction({ previousStore, nextStore, workPackageId, artifactId, reviewId }),
    /unsupported artifact fields: object_key/,
  );
});

test("conditional approval completion transaction updates review completion fields atomically", () => {
  const { previousStore, nextStore, reviewId } = conditionalApprovalCompletedStores();
  const transaction = buildConditionalApprovalCompletionTransaction({ previousStore, nextStore, reviewId });

  assert.match(transaction.applySql, /^-- Native incremental conditional-approval-complete transaction/m);
  assert.match(transaction.applySql, /UPDATE reviews SET [\s\S]*conditions_completed_at = '2026-06-14T06:30:00.000Z'/);
  assert.match(transaction.applySql, /conditions_completed_by_user_id = 'user-test-lead'/);
  assert.match(transaction.applySql, /INSERT INTO audit_events[\s\S]*CONDITIONAL_APPROVAL_COMPLETED[\s\S]*INSERT INTO notifications/);
  assert.match(transaction.rollbackSql, /DELETE FROM notifications[\s\S]*DELETE FROM audit_events[\s\S]*conditions_completed_at = NULL/);
  assert.deepEqual(transaction.changedReviewFields, [
    "conditions_completed_at",
    "conditions_completed_by_user_id",
    "conditions_completion_comment",
  ]);
  assert.equal(transaction.auditEventCount, 1);
  assert.equal(transaction.notificationCount, 1);
});

test("conditional approval completion transaction rejects unsupported review changes", () => {
  const { previousStore, nextStore, reviewId } = conditionalApprovalCompletedStores();
  nextStore.reviews.find((review) => review.id === reviewId).comment = "unexpected";

  assert.throws(
    () => buildConditionalApprovalCompletionTransaction({ previousStore, nextStore, reviewId }),
    /unsupported review fields: comment/,
  );
});

test("gate approval transaction advances project atomically", () => {
  const { previousStore, nextStore, gateId, approvalPackId } = gateApprovalChangedStores();
  const transaction = buildGateApprovalTransaction({ previousStore, nextStore, gateId, approvalPackId });

  assert.match(transaction.applySql, /^-- Native incremental gate-approval transaction/m);
  assert.match(transaction.applySql, /DO \$hardware_flow\$[\s\S]*UPDATE gates SET [\s\S]*status = 'APPROVED'/);
  assert.match(transaction.applySql, /IF NOT FOUND THEN[\s\S]*RAISE EXCEPTION 'gates changed concurrently or row is missing: gate-evt_exit'/);
  assert.match(transaction.applySql, /INSERT INTO gate_approval_packs[\s\S]*INSERT INTO audit_events[\s\S]*INSERT INTO notifications[\s\S]*COMMIT;/);
  assert.match(transaction.rollbackSql, /DELETE FROM notifications[\s\S]*DELETE FROM audit_events[\s\S]*DELETE FROM gate_approval_packs/);
  assert.match(transaction.rollbackSql, /current_phase_id = 'phase-evt_exit'/);
  assert.deepEqual(transaction.changedProjectFields, ["current_phase_id"]);
  assert.deepEqual(transaction.changedGateIds, ["gate-dvt_exit", "gate-evt_exit"]);
  assert.deepEqual(transaction.changedPhaseIds, ["phase-dvt_exit", "phase-evt_exit"]);
  assert.equal(transaction.auditEventCount, 1);
  assert.equal(transaction.notificationCount, 1);
});

test("gate approval transaction supports final phase completion", () => {
  const { previousStore, nextStore, gateId, approvalPackId } = gateApprovalChangedStores({ final: true });
  const transaction = buildGateApprovalTransaction({ previousStore, nextStore, gateId, approvalPackId });

  assert.match(transaction.applySql, /UPDATE projects SET status = 'COMPLETED'/);
  assert.deepEqual(transaction.changedProjectFields, ["status"]);
  assert.deepEqual(transaction.changedGateIds, [gateId]);
  assert.deepEqual(transaction.changedPhaseIds, [nextStore.gates.find((gate) => gate.id === gateId).phaseId]);
});

test("gate approval transaction rejects unrelated phase changes", () => {
  const { previousStore, nextStore, gateId, approvalPackId } = gateApprovalChangedStores();
  nextStore.phases.find((phase) => phase.id === "phase-dvt_exit").name = "Unexpected";

  assert.throws(
    () => buildGateApprovalTransaction({ previousStore, nextStore, gateId, approvalPackId }),
    /unsupported next phase changes/,
  );
});

test("incremental role pair transaction executes and verifies the complete store", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-incremental-"));
  const { previousStore, nextStore } = changedStores();
  const calls = [];
  const result = executePostgresIncrementalTransaction({
    previousStore,
    nextStore,
    mutation: { kind: "role-pair-owner-update", rolePairId: "pair-test_agent" },
    databaseUrl: "postgres://workflow:secret@localhost/workflow",
    outputDir: dir,
    runner: (url, filePath) => {
      calls.push({ url, filePath });
      return { status: 0, signal: null, stdout: "COMMIT\n", stderr: "" };
    },
    queryRunner: queryRunnerSequence([mapStoreToPostgresRows(nextStore)]),
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, "INCREMENTAL_TRANSACTION");
  assert.equal(result.verification.comparison.summary.driftedTableCount, 0);
  assert.equal(calls.length, 1);
  assert.equal(JSON.stringify(result).includes("secret"), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("incremental work package transaction executes and reports its mutation identity", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-incremental-"));
  const { previousStore, nextStore, workPackageId } = scheduleChangedStores();
  const result = executePostgresIncrementalTransaction({
    previousStore,
    nextStore,
    mutation: { kind: "work-package-schedule-update", workPackageId },
    databaseUrl: "postgres://workflow@localhost/workflow",
    outputDir: dir,
    runner: () => ({ status: 0, signal: null, stdout: "COMMIT\n", stderr: "" }),
    queryRunner: queryRunnerSequence([mapStoreToPostgresRows(nextStore)]),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mutation, { kind: "work-package-schedule-update", workPackageId });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("incremental work package evidence transaction executes and reports its mutation identity", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-incremental-"));
  const { previousStore, nextStore, workPackageId, evidenceRefId } = evidenceChangedStores();
  const result = executePostgresIncrementalTransaction({
    previousStore,
    nextStore,
    mutation: { kind: "work-package-evidence-add", workPackageId, evidenceRefId },
    databaseUrl: "postgres://workflow@localhost/workflow",
    outputDir: dir,
    runner: () => ({ status: 0, signal: null, stdout: "COMMIT\n", stderr: "" }),
    queryRunner: queryRunnerSequence([mapStoreToPostgresRows(nextStore)]),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mutation, { kind: "work-package-evidence-add", workPackageId, evidenceRefId });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("incremental notification transaction executes and reports its mutation identity", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-incremental-"));
  const { previousStore, nextStore, notificationId } = notificationReadStores();
  const result = executePostgresIncrementalTransaction({
    previousStore,
    nextStore,
    mutation: { kind: "notification-read", notificationId },
    databaseUrl: "postgres://workflow@localhost/workflow",
    outputDir: dir,
    runner: () => ({ status: 0, signal: null, stdout: "COMMIT\n", stderr: "" }),
    queryRunner: queryRunnerSequence([mapStoreToPostgresRows(nextStore)]),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mutation, { kind: "notification-read", notificationId });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("incremental project notifications transaction executes and reports its mutation identity", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-incremental-"));
  const { previousStore, nextStore, projectId, userId, notificationIds } = projectNotificationsReadStores();
  const result = executePostgresIncrementalTransaction({
    previousStore,
    nextStore,
    mutation: { kind: "project-notifications-read", projectId, userId },
    databaseUrl: "postgres://workflow@localhost/workflow",
    outputDir: dir,
    runner: () => ({ status: 0, signal: null, stdout: "COMMIT\n", stderr: "" }),
    queryRunner: queryRunnerSequence([mapStoreToPostgresRows(nextStore)]),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mutation, { kind: "project-notifications-read", notificationIds, projectId, userId });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("incremental risk create transaction executes and reports its mutation identity", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-incremental-"));
  const { previousStore, nextStore, riskId } = riskCreatedStores();
  const result = executePostgresIncrementalTransaction({
    previousStore,
    nextStore,
    mutation: { kind: "risk-create", riskId },
    databaseUrl: "postgres://workflow@localhost/workflow",
    outputDir: dir,
    runner: () => ({ status: 0, signal: null, stdout: "COMMIT\n", stderr: "" }),
    queryRunner: queryRunnerSequence([mapStoreToPostgresRows(nextStore)]),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mutation, { kind: "risk-create", riskId });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("incremental agent job queue transaction executes and reports its mutation identity", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-incremental-"));
  const { previousStore, nextStore, agentJobId, workPackageId } = agentJobQueuedStores();
  const result = executePostgresIncrementalTransaction({
    previousStore,
    nextStore,
    mutation: { kind: "agent-job-queue", agentJobId },
    databaseUrl: "postgres://workflow@localhost/workflow",
    outputDir: dir,
    runner: () => ({ status: 0, signal: null, stdout: "COMMIT\n", stderr: "" }),
    queryRunner: queryRunnerSequence([mapStoreToPostgresRows(nextStore)]),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mutation, { kind: "agent-job-queue", workPackageId, agentJobId });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("incremental agent output invalid transaction executes and reports its mutation identity", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-incremental-"));
  const { previousStore, nextStore, workPackageId, agentRunId } = agentOutputInvalidStores();
  const result = executePostgresIncrementalTransaction({
    previousStore,
    nextStore,
    mutation: { kind: "agent-output-invalid", workPackageId, agentRunId },
    databaseUrl: "postgres://workflow@localhost/workflow",
    outputDir: dir,
    runner: () => ({ status: 0, signal: null, stdout: "COMMIT\n", stderr: "" }),
    queryRunner: queryRunnerSequence([mapStoreToPostgresRows(nextStore)]),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mutation, { kind: "agent-output-invalid", workPackageId, agentRunId });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("incremental risk transaction executes and reports its mutation identity", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-incremental-"));
  const { previousStore, nextStore, riskId } = riskMitigationChangedStores();
  const result = executePostgresIncrementalTransaction({
    previousStore,
    nextStore,
    mutation: { kind: "risk-mitigation-update", riskId },
    databaseUrl: "postgres://workflow@localhost/workflow",
    outputDir: dir,
    runner: () => ({ status: 0, signal: null, stdout: "COMMIT\n", stderr: "" }),
    queryRunner: queryRunnerSequence([mapStoreToPostgresRows(nextStore)]),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mutation, { kind: "risk-mitigation-update", riskId });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("incremental human review transaction executes and reports its mutation identity", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-incremental-"));
  const { previousStore, nextStore, workPackageId, artifactId, reviewId } = humanReviewChangedStores();
  const result = executePostgresIncrementalTransaction({
    previousStore,
    nextStore,
    mutation: { kind: "human-review-submit", workPackageId, artifactId, reviewId },
    databaseUrl: "postgres://workflow@localhost/workflow",
    outputDir: dir,
    runner: () => ({ status: 0, signal: null, stdout: "COMMIT\n", stderr: "" }),
    queryRunner: queryRunnerSequence([mapStoreToPostgresRows(nextStore)]),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mutation, { kind: "human-review-submit", workPackageId, artifactId, reviewId });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("incremental conditional approval completion transaction executes and reports its mutation identity", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-incremental-"));
  const { previousStore, nextStore, reviewId } = conditionalApprovalCompletedStores();
  const result = executePostgresIncrementalTransaction({
    previousStore,
    nextStore,
    mutation: { kind: "conditional-approval-complete", reviewId },
    databaseUrl: "postgres://workflow@localhost/workflow",
    outputDir: dir,
    runner: () => ({ status: 0, signal: null, stdout: "COMMIT\n", stderr: "" }),
    queryRunner: queryRunnerSequence([mapStoreToPostgresRows(nextStore)]),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mutation, { kind: "conditional-approval-complete", reviewId });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("incremental gate approval transaction executes and reports its mutation identity", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-incremental-"));
  const { previousStore, nextStore, gateId, approvalPackId } = gateApprovalChangedStores();
  const result = executePostgresIncrementalTransaction({
    previousStore,
    nextStore,
    mutation: { kind: "gate-approval", gateId, approvalPackId },
    databaseUrl: "postgres://workflow@localhost/workflow",
    outputDir: dir,
    runner: () => ({ status: 0, signal: null, stdout: "COMMIT\n", stderr: "" }),
    queryRunner: queryRunnerSequence([mapStoreToPostgresRows(nextStore)]),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mutation, { kind: "gate-approval", gateId, approvalPackId });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("verification drift triggers a compensating transaction and verifies the previous store", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-incremental-"));
  const { previousStore, nextStore } = changedStores();
  const driftedRows = mapStoreToPostgresRows(nextStore);
  driftedRows.projects[0].status = "DRIFTED";
  const calls = [];
  const result = executePostgresIncrementalTransaction({
    previousStore,
    nextStore,
    mutation: { kind: "role-pair-owner-update", rolePairId: "pair-test_agent" },
    databaseUrl: "postgres://workflow@localhost/workflow",
    outputDir: dir,
    runner: (url, filePath) => {
      calls.push(filePath);
      return { status: 0, signal: null, stdout: "COMMIT\n", stderr: "" };
    },
    queryRunner: queryRunnerSequence([driftedRows, mapStoreToPostgresRows(previousStore)]),
  });

  assert.equal(result.ok, false);
  assert.equal(result.compensation.ok, true);
  assert.equal(calls.length, 2);
  assert.match(fs.readFileSync(calls[1], "utf8"), /Compensating role-pair owner transaction/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("failed compensation is reported as an unsafe persistence state", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-incremental-"));
  const { previousStore, nextStore } = changedStores();
  const driftedRows = mapStoreToPostgresRows(nextStore);
  driftedRows.projects[0].status = "DRIFTED";
  let executionCount = 0;
  const result = executePostgresIncrementalTransaction({
    previousStore,
    nextStore,
    mutation: { kind: "role-pair-owner-update", rolePairId: "pair-test_agent" },
    databaseUrl: "postgres://workflow@localhost/workflow",
    outputDir: dir,
    runner: () => {
      executionCount += 1;
      return executionCount === 1
        ? { status: 0, signal: null, stdout: "COMMIT\n", stderr: "" }
        : { status: 2, signal: null, stdout: "", stderr: "compensation failed" };
    },
    queryRunner: queryRunnerSequence([driftedRows]),
  });

  assert.equal(result.ok, false);
  assert.equal(result.compensation.ok, false);
  assert.equal(result.compensation.execution.status, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});
