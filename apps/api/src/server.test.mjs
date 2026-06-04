import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { after, beforeEach, test } from "node:test";

const tempDir = mkdtempSync(path.join(tmpdir(), "hardware-flow-http-test-"));
process.env.HARDWARE_FLOW_STORE_PATH = path.join(tempDir, "store.json");

const workflow = await import("./server.mjs");
const requestHandler = workflow.server.listeners("request")[0];

after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(() => {
  workflow.resetDemoStore();
});

function completeEvtGateForHttpTests() {
  for (const item of [
    ["wp-evt_exit-evt_test_plan", "test_agent", "user-test-lead"],
    ["wp-evt_exit-evt_test_report", "test_agent", "user-test-lead"],
    ["wp-evt_exit-evt_issue_closure", "quality_agent", "user-quality-lead"],
  ]) {
    const agentRun = workflow.runAgentWorkPackage({
      workPackageId: item[0],
      agentKey: item[1],
      inputRefs: ["artifact:http-test-input"],
    });
    assert.equal(agentRun.statusCode, 201);
    const review = workflow.submitHumanReview({
      workPackageId: item[0],
      reviewerUserId: item[2],
      decision: "APPROVE",
      comment: "HTTP 测试批准。",
    });
    assert.equal(review.statusCode, 201);
  }
  const risk = workflow.updateRiskStatus("risk-thermal-margin", "ACCEPTED", {
    userId: "user-project-manager",
    comment: "HTTP 测试接受风险。",
  });
  assert.equal(risk.statusCode, 200);
}

async function dispatch(pathname, options = {}) {
  const body = options.body || "";
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.method = options.method || "GET";
  req.url = pathname;
  req.headers = { host: "127.0.0.1", "content-type": "application/json" };

  return await new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headers: {},
      writeHead(statusCode, headers) {
        this.statusCode = statusCode;
        this.headers = headers;
      },
      end(rawBody) {
        const text = rawBody ? String(rawBody) : "";
        const contentType = this.headers?.["content-type"] || "";
        resolve({
          status: this.statusCode,
          headers: this.headers,
          body: contentType.includes("application/json") && text ? JSON.parse(text) : text || null,
        });
      },
    };
    Promise.resolve(requestHandler(req, res)).catch((error) => {
      resolve({
        status: Number(error?.statusCode) || 500,
        headers: { "content-type": "application/json; charset=utf-8" },
        body: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
    });
  });
}

test("health endpoint reports the active project", async () => {
  const result = await dispatch("/health");

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.activeProjectId, "project-smart-controller");
  assert.equal(result.body.projectCount, 1);
  assert.equal(result.body.packageName, "human-agent-hardware-flow");
  assert.match(result.body.version, /^\d+\.\d+\.\d+/);
});

test("ready endpoint reports runtime and storage readiness", async () => {
  const result = await dispatch("/ready");

  assert.equal(result.status, 200);
  assert.equal(result.body.ready, true);
  assert.equal(result.body.service, "hardware-flow-api");
  assert.equal(result.body.packageName, "human-agent-hardware-flow");
  assert.match(result.body.version, /^\d+\.\d+\.\d+/);
  assert.equal(result.body.activeProjectId, "project-smart-controller");
  assert.equal(result.body.storage.exists, true);
  assert.equal(result.body.storage.valid, true);
  assert.deepEqual(result.body.storage.errors, []);
});

test("runtime config endpoint reports non-secret deployment settings", async () => {
  const result = await dispatch("/runtime/config");

  assert.equal(result.status, 200);
  assert.equal(result.body.service, "hardware-flow-api");
  assert.equal(result.body.packageName, "human-agent-hardware-flow");
  assert.match(result.body.version, /^\d+\.\d+\.\d+/);
  assert.equal(result.body.host, "127.0.0.1");
  assert.equal(result.body.port, 3001);
  assert.ok(result.body.storePath.endsWith("store.json"));
  assert.match(result.body.staticMode, /^(react|static)$/);
  assert.equal(typeof result.body.reactStaticAvailable, "boolean");
  assert.ok(result.body.staticRoot.includes("apps/"));
});

test("storage status endpoint reports persistence metadata", async () => {
  const result = await dispatch("/storage/status");

  assert.equal(result.status, 200);
  assert.equal(result.body.exists, true);
  assert.equal(result.body.activeProjectId, "project-smart-controller");
  assert.equal(result.body.projectCount, 1);
  assert.equal(result.body.gateApprovalPackCount, 0);
  assert.equal(result.body.notificationCount, 0);
  assert.ok(result.body.storePath.endsWith("store.json"));
  assert.ok(result.body.backupPath.endsWith("store.json.bak"));
  assert.equal(typeof result.body.backupExists, "boolean");
});

test("storage doctor endpoint reports JSON store validity", async () => {
  const result = await dispatch("/storage/doctor");

  assert.equal(result.status, 200);
  assert.equal(result.body.exists, true);
  assert.equal(result.body.valid, true);
  assert.deepEqual(result.body.errors, []);
  assert.equal(result.body.backupValid, true);
  assert.deepEqual(result.body.backupErrors, []);
  assert.ok(result.body.storePath.endsWith("store.json"));
  assert.ok(result.body.backupPath.endsWith("store.json.bak"));
});

test("storage doctor endpoint reports invalid backup files", async () => {
  writeFileSync(`${process.env.HARDWARE_FLOW_STORE_PATH}.bak`, "{");

  const result = await dispatch("/storage/doctor");

  assert.equal(result.status, 200);
  assert.equal(result.body.valid, true);
  assert.equal(result.body.backupExists, true);
  assert.equal(result.body.backupValid, false);
  assert.match(result.body.backupErrors[0], /store JSON is invalid/);
});

test("storage backup restore endpoint requires explicit confirmation", async () => {
  const result = await dispatch("/storage/restore-backup", {
    method: "POST",
    body: JSON.stringify({}),
  });

  assert.equal(result.status, 400);
  assert.equal(result.body.error, "恢复备份需要 confirm: true");
});

test("storage backup restore endpoint reloads the restored store", async () => {
  const backupStore = workflow.createDemoStore();
  backupStore.projects[0] = {
    ...backupStore.projects[0],
    name: "恢复后的演示项目",
  };
  writeFileSync(`${process.env.HARDWARE_FLOW_STORE_PATH}.bak`, `${JSON.stringify(backupStore, null, 2)}\n`);

  const result = await dispatch("/storage/restore-backup", {
    method: "POST",
    body: JSON.stringify({ confirm: true }),
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.restored, true);
  assert.equal(result.body.doctor.valid, true);
  assert.ok(result.body.preRestorePath.endsWith(".bak"));

  const project = await dispatch("/projects/demo");
  assert.equal(project.body.project.name, "恢复后的演示项目");
});

test("project endpoint returns the current workflow snapshot", async () => {
  const result = await dispatch("/projects/demo");

  assert.equal(result.status, 200);
  assert.equal(result.body.project.currentPhaseId, "phase-evt_exit");
  assert.equal(result.body.phases.length, 7);
  assert.equal(result.body.gates.length, 7);
  assert.equal(result.body.latestGateCheck.status, "BLOCKED");
  assert.equal(result.body.projectSummaries.length, 1);
  assert.equal(result.body.projectSummaries[0].currentGateName, "EVT Exit 阶段门");
  assert.equal(result.body.projectSummaries[0].currentGateStatus, "GATE_BLOCKED");
  assert.equal(result.body.projectSummaries[0].openHighRiskCount, 1);
  assert.equal(result.body.projectSummaries[0].openMitigationCount, 0);
  assert.equal(result.body.projectSummaries[0].openConditionalApprovalCount, 0);
});

test("project snapshot endpoints export current project state", async () => {
  const jsonResult = await dispatch("/projects/project-smart-controller/snapshot");
  assert.equal(jsonResult.status, 200);
  assert.equal(jsonResult.body.project.id, "project-smart-controller");
  assert.equal(jsonResult.body.summary.phaseCount, 7);
  assert.equal(jsonResult.body.summary.gateApprovalPackCount, 0);
  assert.equal(jsonResult.body.summary.mitigationPlanCount, 0);
  assert.equal(jsonResult.body.summary.openMitigationCount, 0);
  assert.equal(jsonResult.body.summary.overdueMitigationCount, 0);
  assert.equal(jsonResult.body.summary.completedMitigationCount, 0);
  assert.equal(jsonResult.body.summary.conditionalApprovalCount, 0);
  assert.equal(jsonResult.body.summary.openConditionalApprovalCount, 0);
  assert.equal(jsonResult.body.summary.completedConditionalApprovalCount, 0);
  assert.equal(jsonResult.body.summary.notificationCount, 0);
  assert.equal(jsonResult.body.currentPhase.name, "EVT Exit");

  const markdownResult = await dispatch("/projects/project-smart-controller/snapshot.md");
  assert.equal(markdownResult.status, 200);
  assert.match(markdownResult.headers["content-type"], /text\/markdown/);
  assert.match(markdownResult.body, /# 智能控制器项目 项目快照/);
  assert.match(markdownResult.body, /风险缓解：0\/0 已完成，0 进行中，0 逾期/);
  assert.match(markdownResult.body, /有条件批准条款：0\/0 已完成，0 未完成/);
  assert.match(markdownResult.body, /## 工作包/);
});

test("project snapshot summarizes conditional approval follow-ups", async () => {
  const review = await dispatch("/reviews", {
    method: "POST",
    body: JSON.stringify({
      workPackageId: "wp-evt_exit-evt_test_plan",
      reviewerUserId: "user-test-lead",
      decision: "APPROVE_WITH_CONDITIONS",
      comment: "允许进入下一阶段，但需要补充低温测试。",
      conditions: ["补充低温启动测试"],
    }),
  });

  const openSnapshot = await dispatch("/projects/project-smart-controller/snapshot");
  assert.equal(openSnapshot.status, 200);
  assert.equal(openSnapshot.body.summary.conditionalApprovalCount, 1);
  assert.equal(openSnapshot.body.summary.openConditionalApprovalCount, 1);
  assert.equal(openSnapshot.body.summary.completedConditionalApprovalCount, 0);

  await dispatch(`/reviews/${review.body.review.id}/conditions/complete`, {
    method: "POST",
    body: JSON.stringify({
      actorUserId: "user-test-lead",
      comment: "低温测试已补齐。",
    }),
  });

  const completedSnapshot = await dispatch("/projects/project-smart-controller/snapshot");
  assert.equal(completedSnapshot.body.summary.conditionalApprovalCount, 1);
  assert.equal(completedSnapshot.body.summary.openConditionalApprovalCount, 0);
  assert.equal(completedSnapshot.body.summary.completedConditionalApprovalCount, 1);
});

test("project risk register endpoints export current project risks", async () => {
  const jsonResult = await dispatch("/projects/project-smart-controller/risk-register");
  assert.equal(jsonResult.status, 200);
  assert.equal(jsonResult.body.summary.totalRiskCount, 1);
  assert.equal(jsonResult.body.summary.openBlockingRiskCount, 1);
  assert.equal(jsonResult.body.summary.mitigationPlanCount, 0);
  assert.equal(jsonResult.body.risks[0].phaseName, "EVT Exit");

  const markdownResult = await dispatch("/projects/project-smart-controller/risk-register.md");
  assert.equal(markdownResult.status, 200);
  assert.match(markdownResult.headers["content-type"], /text\/markdown/);
  assert.match(markdownResult.body, /# 智能控制器项目 风险台账/);
  assert.match(markdownResult.body, /缓解计划：0\/0 已完成，0 进行中，0 逾期/);
  assert.match(markdownResult.body, /热设计裕量不足/);
});

test("risk mitigation endpoint stores owner, due date, plan, and notifies owner", async () => {
  const result = await dispatch("/risks/risk-thermal-margin/mitigation", {
    method: "PATCH",
    body: JSON.stringify({
      mitigationOwnerUserId: "user-quality-lead",
      mitigationDueAt: "2020-01-01",
      mitigation: "补充热仿真并准备散热垫备选方案。",
      actorUserId: "user-project-manager",
    }),
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.risk.mitigationOwnerUserId, "user-quality-lead");
  assert.equal(result.body.risk.mitigationDueAt, "2020-01-01");
  assert.equal(result.body.risk.mitigation, "补充热仿真并准备散热垫备选方案。");
  assert.equal(result.body.risk.mitigationStatus, "OPEN");

  const register = await dispatch("/projects/project-smart-controller/risk-register");
  assert.equal(register.body.risks[0].mitigationOwnerUserId, "user-quality-lead");
  assert.equal(register.body.summary.mitigationPlanCount, 1);
  assert.equal(register.body.summary.openMitigationCount, 1);
  assert.equal(register.body.summary.overdueMitigationCount, 1);
  assert.equal(register.body.summary.completedMitigationCount, 0);

  const snapshot = await dispatch("/projects/project-smart-controller/snapshot");
  assert.equal(snapshot.body.summary.mitigationPlanCount, 1);
  assert.equal(snapshot.body.summary.openMitigationCount, 1);
  assert.equal(snapshot.body.summary.overdueMitigationCount, 1);
  assert.equal(snapshot.body.summary.completedMitigationCount, 0);

  const markdown = await dispatch("/projects/project-smart-controller/risk-register.md");
  assert.match(markdown.body, /缓解计划：0\/1 已完成，1 进行中，1 逾期/);

  const notifications = await dispatch("/users/user-quality-lead/notifications?type=ACTION");
  assert.equal(notifications.body.notifications[0].title, "风险缓解任务已分配");
  assert.equal(notifications.body.notifications[0].objectType, "risk");

  const invalid = await dispatch("/risks/risk-thermal-margin/mitigation", {
    method: "PATCH",
    body: JSON.stringify({ mitigationDueAt: "2026/06/15" }),
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error, "mitigationDueAt 必须是 YYYY-MM-DD 格式");
});

test("risk mitigation completion endpoint clears owner action item", async () => {
  await dispatch("/risks/risk-thermal-margin/mitigation", {
    method: "PATCH",
    body: JSON.stringify({
      mitigationOwnerUserId: "user-quality-lead",
      mitigationDueAt: "2026-06-15",
      mitigation: "补充热仿真并准备散热垫备选方案。",
      actorUserId: "user-project-manager",
    }),
  });

  const completed = await dispatch("/risks/risk-thermal-margin/mitigation/complete", {
    method: "POST",
    body: JSON.stringify({
      actorUserId: "user-quality-lead",
      comment: "热仿真复核通过，散热垫备选方案已归档。",
    }),
  });

  assert.equal(completed.status, 200);
  assert.equal(completed.body.risk.mitigationStatus, "DONE");
  assert.equal(completed.body.risk.mitigationCompletedByUserId, "user-quality-lead");
  assert.equal(completed.body.risk.mitigationCompletionComment, "热仿真复核通过，散热垫备选方案已归档。");

  const snapshot = await dispatch("/projects/project-smart-controller/snapshot");
  assert.equal(snapshot.body.summary.mitigationPlanCount, 1);
  assert.equal(snapshot.body.summary.openMitigationCount, 0);
  assert.equal(snapshot.body.summary.completedMitigationCount, 1);

  const actionItems = await dispatch("/users/user-quality-lead/action-items");
  assert.equal(actionItems.body.riskMitigations.length, 0);

  const notifications = await dispatch("/users/user-project-manager/notifications?type=INFO");
  assert.equal(notifications.body.notifications[0].title, "风险缓解已完成");
});

test("project snapshot endpoint rejects unknown projects", async () => {
  const result = await dispatch("/projects/missing-project/snapshot");

  assert.equal(result.status, 404);
  assert.equal(result.body.error, "项目不存在");
});

test("project risk register endpoint rejects unknown projects", async () => {
  const result = await dispatch("/projects/missing-project/risk-register");

  assert.equal(result.status, 404);
  assert.equal(result.body.error, "项目不存在");
});

test("project import validation endpoint reports duplicate project ids", async () => {
  const snapshot = workflow.getProjectSnapshot("project-smart-controller");
  const result = await dispatch("/projects/import/validate", {
    method: "POST",
    body: JSON.stringify(snapshot),
  });

  assert.equal(result.status, 422);
  assert.equal(result.body.valid, false);
  assert.equal(result.body.errors.some((error) => error.message === "项目 ID 已存在，不能直接导入"), true);
});

test("project import endpoint refuses invalid snapshots", async () => {
  const snapshot = workflow.getProjectSnapshot("project-smart-controller");
  const result = await dispatch("/projects/import", {
    method: "POST",
    body: JSON.stringify(snapshot),
  });

  assert.equal(result.status, 422);
  assert.equal(result.body.valid, false);
  assert.equal(result.body.errors.some((error) => error.message === "项目 ID 已存在，不能直接导入"), true);
});

test("project clone endpoint creates a named project copy", async () => {
  const result = await dispatch("/projects/project-smart-controller/clone", {
    method: "POST",
    body: JSON.stringify({
      name: "HTTP Clone Project",
      userId: "user-project-manager",
    }),
  });

  assert.equal(result.status, 201);
  assert.equal(result.body.project.project.name, "HTTP Clone Project");
  assert.equal(result.body.project.activeProjectId, result.body.project.project.id);
  assert.equal(result.body.project.auditEvents.some((event) => event.eventType === "PROJECT_CLONED"), true);
});

test("project clone endpoint rejects unknown projects", async () => {
  const result = await dispatch("/projects/missing-project/clone", {
    method: "POST",
    body: JSON.stringify({ name: "Missing clone" }),
  });

  assert.equal(result.status, 404);
  assert.equal(result.body.error, "项目不存在");
});

test("project archive and restore endpoints preserve project data", async () => {
  const created = await dispatch("/projects", {
    method: "POST",
    body: JSON.stringify({
      name: "HTTP Archive Project",
      userId: "user-project-manager",
    }),
  });
  assert.equal(created.status, 201);
  const projectId = created.body.project.id;

  const archived = await dispatch(`/projects/${projectId}/archive`, {
    method: "POST",
    body: JSON.stringify({ userId: "user-project-manager" }),
  });
  assert.equal(archived.status, 200);
  assert.equal(archived.body.project.id, "project-smart-controller");

  const archivedSnapshot = await dispatch(`/projects/${projectId}/snapshot`);
  assert.equal(archivedSnapshot.status, 200);
  assert.equal(archivedSnapshot.body.project.status, "ARCHIVED");
  assert.equal(archivedSnapshot.body.workPackages.length, created.body.workPackages.length);

  const restored = await dispatch(`/projects/${projectId}/restore`, {
    method: "POST",
    body: JSON.stringify({ userId: "user-project-manager" }),
  });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.project.id, projectId);
  assert.equal(restored.body.project.status, "IN_PROGRESS");
});

test("post endpoints return 400 for malformed JSON bodies", async () => {
  const result = await dispatch("/projects/import/validate", {
    method: "POST",
    body: "{not valid json",
  });

  assert.equal(result.status, 400);
  assert.equal(result.body.error, "请求体不是合法 JSON");
});

test("action items endpoint returns user-specific work", async () => {
  const result = await dispatch("/users/user-project-manager/action-items");

  assert.equal(result.status, 200);
  assert.equal(result.body.userId, "user-project-manager");
  assert.equal(result.body.pendingReviews.length, 0);
  assert.equal(result.body.conditionalApprovals.length, 0);
  assert.equal(result.body.riskDecisions.length, 1);
  assert.equal(result.body.riskMitigations.length, 0);
  assert.equal(result.body.total, 1);
});

test("action items endpoint includes conditional approval follow-up work", async () => {
  const review = await dispatch("/reviews", {
    method: "POST",
    body: JSON.stringify({
      workPackageId: "wp-evt_exit-evt_test_plan",
      reviewerUserId: "user-test-lead",
      decision: "APPROVE_WITH_CONDITIONS",
      comment: "允许进入下一阶段，但需要补充低温测试。",
      conditions: ["补充低温启动测试", "更新测试覆盖率矩阵"],
    }),
  });

  const actionItems = await dispatch("/users/user-test-lead/action-items");
  assert.equal(actionItems.status, 200);
  assert.equal(actionItems.body.pendingReviews.length, 0);
  assert.equal(actionItems.body.conditionalApprovals.length, 1);
  assert.equal(actionItems.body.conditionalApprovals[0].workPackageId, "wp-evt_exit-evt_test_plan");
  assert.deepEqual(actionItems.body.conditionalApprovals[0].conditions, ["补充低温启动测试", "更新测试覆盖率矩阵"]);
  assert.equal(actionItems.body.total, 1);

  const completed = await dispatch(`/reviews/${review.body.review.id}/conditions/complete`, {
    method: "POST",
    body: JSON.stringify({
      actorUserId: "user-test-lead",
      comment: "低温测试和覆盖率矩阵已补齐。",
    }),
  });
  assert.equal(completed.status, 200);
  assert.equal(completed.body.review.conditionsCompletedByUserId, "user-test-lead");
  assert.equal(completed.body.review.conditionsCompletionComment, "低温测试和覆盖率矩阵已补齐。");
  assert.equal(completed.body.actionItems.conditionalApprovals.length, 0);

  const refreshedItems = await dispatch("/users/user-test-lead/action-items");
  assert.equal(refreshedItems.body.conditionalApprovals.length, 0);
});

test("conditional approval completion endpoint rejects unrelated users", async () => {
  const review = await dispatch("/reviews", {
    method: "POST",
    body: JSON.stringify({
      workPackageId: "wp-evt_exit-evt_test_plan",
      reviewerUserId: "user-test-lead",
      decision: "APPROVE_WITH_CONDITIONS",
      comment: "允许进入下一阶段，但需要补充低温测试。",
      conditions: ["补充低温启动测试"],
    }),
  });

  const result = await dispatch(`/reviews/${review.body.review.id}/conditions/complete`, {
    method: "POST",
    body: JSON.stringify({
      actorUserId: "user-product-manager",
      comment: "越权完成。",
    }),
  });

  assert.equal(result.status, 403);
  assert.equal(result.body.error, "当前用户无权完成有条件批准条款");
});

test("action items endpoint includes assigned risk mitigation work", async () => {
  await dispatch("/risks/risk-thermal-margin/mitigation", {
    method: "PATCH",
    body: JSON.stringify({
      mitigationOwnerUserId: "user-quality-lead",
      mitigationDueAt: "2020-01-01",
      mitigation: "补充热仿真并准备散热垫备选方案。",
      actorUserId: "user-project-manager",
    }),
  });

  const actionItems = await dispatch("/users/user-quality-lead/action-items");
  assert.equal(actionItems.status, 200);
  assert.equal(actionItems.body.riskMitigations.length, 1);
  assert.equal(actionItems.body.riskMitigations[0].riskId, "risk-thermal-margin");
  assert.equal(actionItems.body.riskMitigations[0].scheduleStatus, "OVERDUE");
  assert.equal(actionItems.body.total, actionItems.body.riskDecisions.length + actionItems.body.riskMitigations.length);
});

test("role pair update endpoint notifies owners and project manager", async () => {
  const result = await dispatch("/role-pairs/pair-test_agent", {
    method: "PATCH",
    body: JSON.stringify({
      humanUserId: "user-quality-lead",
      actorUserId: "user-project-manager",
    }),
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.rolePair.humanUserId, "user-quality-lead");

  const newOwnerNotifications = await dispatch("/users/user-quality-lead/notifications");
  assert.equal(newOwnerNotifications.body.notifications[0].objectType, "rolePair");
  assert.equal(newOwnerNotifications.body.notifications[0].title, "角色负责人已指派给你");

  const previousOwnerNotifications = await dispatch("/users/user-test-lead/notifications");
  assert.equal(previousOwnerNotifications.body.notifications[0].title, "角色负责人已变更");
});

test("work package schedule endpoint updates due dates and action items", async () => {
  const updateResult = await dispatch("/work-packages/wp-evt_exit-evt_test_report/schedule", {
    method: "PATCH",
    body: JSON.stringify({
      dueAt: "2020-01-01",
      actorUserId: "user-project-manager",
    }),
  });
  assert.equal(updateResult.status, 200);
  assert.equal(updateResult.body.workPackage.dueAt, "2020-01-01");
  assert.equal(updateResult.body.workPackage.scheduleStatus, "OVERDUE");

  const actionItems = await dispatch("/users/user-test-lead/action-items");
  assert.equal(actionItems.body.scheduleAlerts.length, 1);
  assert.equal(actionItems.body.scheduleAlerts[0].workPackageId, "wp-evt_exit-evt_test_report");
});

test("work package schedule endpoint validates dates", async () => {
  const result = await dispatch("/work-packages/wp-evt_exit-evt_test_report/schedule", {
    method: "PATCH",
    body: JSON.stringify({ dueAt: "tomorrow" }),
  });

  assert.equal(result.status, 400);
  assert.equal(result.body.error, "dueAt 必须是 YYYY-MM-DD 格式");
});

test("work package evidence refs are exported and included in gate review packs", async () => {
  const createResult = await dispatch("/work-packages/wp-evt_exit-evt_test_plan/evidence-refs", {
    method: "POST",
    body: JSON.stringify({
      label: "热测试报告",
      ref: "https://example.test/reports/thermal",
      actorUserId: "user-test-lead",
    }),
  });
  assert.equal(createResult.status, 201);
  assert.equal(createResult.body.evidenceRef.label, "热测试报告");

  const project = await dispatch("/projects/demo");
  assert.equal(project.body.evidenceRefs.length, 1);

  const workPackageExport = await dispatch("/work-packages/wp-evt_exit-evt_test_plan/export.md");
  assert.match(workPackageExport.body, /## 证据引用/);
  assert.match(workPackageExport.body, /热测试报告/);

  const reviewPack = await dispatch("/gates/gate-evt_exit/review-pack");
  const testPlanEvidence = reviewPack.body.evidence.find((item) => item.workPackageId === "wp-evt_exit-evt_test_plan");
  assert.equal(testPlanEvidence.manualEvidenceCount, 1);
  assert.equal(reviewPack.body.summary.manualEvidenceRefCount, 1);

  const snapshot = workflow.getProjectSnapshot("project-smart-controller");
  assert.equal(snapshot.summary.evidenceRefCount, 1);
  assert.equal(snapshot.evidenceRefs.length, 1);
});

test("work package evidence ref endpoint validates required fields", async () => {
  const result = await dispatch("/work-packages/wp-evt_exit-evt_test_plan/evidence-refs", {
    method: "POST",
    body: JSON.stringify({ label: "", ref: "" }),
  });

  assert.equal(result.status, 400);
  assert.equal(result.body.error, "证据标题不能为空");
});

test("notification endpoints show and mark user notifications", async () => {
  await dispatch("/agent-runs", {
    method: "POST",
    body: JSON.stringify({
      workPackageId: "wp-evt_exit-evt_test_report",
      agentKey: "test_agent",
      inputRefs: ["artifact:test-input"],
    }),
  });

  const listResult = await dispatch("/users/user-test-lead/notifications");
  assert.equal(listResult.status, 200);
  assert.equal(listResult.body.unreadCount, 1);
  assert.equal(listResult.body.filteredCount, 1);
  assert.equal(listResult.body.counts.action, 1);
  assert.equal(listResult.body.notifications[0].title, "工作包待审核");

  const actionResult = await dispatch("/users/user-test-lead/notifications?type=ACTION");
  assert.equal(actionResult.status, 200);
  assert.equal(actionResult.body.filters.type, "ACTION");
  assert.equal(actionResult.body.filteredCount, 1);

  const infoResult = await dispatch("/users/user-test-lead/notifications?type=INFO");
  assert.equal(infoResult.status, 200);
  assert.equal(infoResult.body.filteredCount, 0);

  const readResult = await dispatch(`/notifications/${listResult.body.notifications[0].id}/read`, {
    method: "POST",
    body: JSON.stringify({ userId: "user-test-lead" }),
  });
  assert.equal(readResult.status, 200);
  assert.equal(readResult.body.notifications.unreadCount, 0);

  const unreadResult = await dispatch("/users/user-test-lead/notifications?status=UNREAD");
  assert.equal(unreadResult.status, 200);
  assert.equal(unreadResult.body.filteredCount, 0);
});

test("notification endpoint marks all current user notifications read", async () => {
  await dispatch("/agent-runs", {
    method: "POST",
    body: JSON.stringify({
      workPackageId: "wp-evt_exit-evt_test_report",
      agentKey: "test_agent",
      inputRefs: ["artifact:test-input"],
    }),
  });
  await dispatch("/agent-runs", {
    method: "POST",
    body: JSON.stringify({
      workPackageId: "wp-evt_exit-evt_issue_closure",
      agentKey: "quality_agent",
      inputRefs: ["artifact:test-input"],
    }),
  });

  const result = await dispatch("/users/user-test-lead/notifications/read", {
    method: "POST",
    body: JSON.stringify({}),
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.updatedCount, 1);
  assert.equal(result.body.notifications.unreadCount, 0);

  const qualityResult = await dispatch("/users/user-quality-lead/notifications");
  assert.equal(qualityResult.body.unreadCount, 1);
});

test("notification read endpoint rejects other users", async () => {
  await dispatch("/agent-runs", {
    method: "POST",
    body: JSON.stringify({
      workPackageId: "wp-evt_exit-evt_test_report",
      agentKey: "test_agent",
      inputRefs: ["artifact:test-input"],
    }),
  });
  const listResult = await dispatch("/users/user-test-lead/notifications");
  const result = await dispatch(`/notifications/${listResult.body.notifications[0].id}/read`, {
    method: "POST",
    body: JSON.stringify({ userId: "user-project-manager" }),
  });

  assert.equal(result.status, 403);
  assert.equal(result.body.error, "当前用户无权处理该通知");
});

test("gate review pack endpoint returns evidence and blockers", async () => {
  await dispatch("/reviews", {
    method: "POST",
    body: JSON.stringify({
      workPackageId: "wp-evt_exit-evt_test_plan",
      reviewerUserId: "user-test-lead",
      decision: "APPROVE_WITH_CONDITIONS",
      comment: "允许进入下一阶段，但需要补充低温测试。",
      conditions: ["补充低温启动测试", "更新测试覆盖率矩阵"],
    }),
  });
  await dispatch("/risks/risk-thermal-margin/mitigation", {
    method: "PATCH",
    body: JSON.stringify({
      mitigationOwnerUserId: "user-quality-lead",
      mitigationDueAt: "2026-06-15",
      mitigation: "补充热仿真并准备散热垫备选方案。",
      actorUserId: "user-project-manager",
    }),
  });

  const result = await dispatch("/gates/gate-evt_exit/review-pack");

  assert.equal(result.status, 200);
  assert.equal(result.body.gate.id, "gate-evt_exit");
  assert.equal(result.body.summary.requiredEvidenceCount, 3);
  assert.equal(result.body.summary.readyEvidenceCount, 1);
  assert.equal(result.body.summary.openBlockingRiskCount, 1);
  assert.equal(result.body.readiness.status, "BLOCKED");
  assert.equal(result.body.evidence.length, 3);
  const testPlanEvidence = result.body.evidence.find((item) => item.workPackageId === "wp-evt_exit-evt_test_plan");
  assert.equal(testPlanEvidence.approvedReviewDecision, "APPROVE_WITH_CONDITIONS");
  assert.deepEqual(testPlanEvidence.approvedReviewConditions, ["补充低温启动测试", "更新测试覆盖率矩阵"]);
  assert.equal(testPlanEvidence.approvedReviewComment, "允许进入下一阶段，但需要补充低温测试。");
  assert.equal(testPlanEvidence.approvedReviewConditionsCompletedAt, null);
  assert.equal(result.body.summary.conditionalApprovalCount, 1);
  assert.equal(result.body.summary.openConditionalApprovalCount, 1);
  assert.equal(result.body.summary.completedConditionalApprovalCount, 0);
  assert.equal(result.body.risks[0].mitigationStatus, "OPEN");
  assert.equal(result.body.risks[0].mitigationOwnerUserId, "user-quality-lead");
});

test("gate review pack markdown endpoint exports a readable package", async () => {
  const review = await dispatch("/reviews", {
    method: "POST",
    body: JSON.stringify({
      workPackageId: "wp-evt_exit-evt_test_plan",
      reviewerUserId: "user-test-lead",
      decision: "APPROVE_WITH_CONDITIONS",
      comment: "允许进入下一阶段，但需要补充低温测试。",
      conditions: ["补充低温启动测试"],
    }),
  });
  await dispatch(`/reviews/${review.body.review.id}/conditions/complete`, {
    method: "POST",
    body: JSON.stringify({
      actorUserId: "user-test-lead",
      comment: "低温测试已补齐。",
    }),
  });
  await dispatch("/risks/risk-thermal-margin/mitigation", {
    method: "PATCH",
    body: JSON.stringify({
      mitigationOwnerUserId: "user-quality-lead",
      mitigationDueAt: "2026-06-15",
      mitigation: "补充热仿真并准备散热垫备选方案。",
      actorUserId: "user-project-manager",
    }),
  });

  const result = await dispatch("/gates/gate-evt_exit/review-pack.md");

  assert.equal(result.status, 200);
  assert.match(result.headers["content-type"], /text\/markdown/);
  assert.match(result.body, /# EVT Exit 阶段门 审核包/);
  assert.match(result.body, /批准说明/);
  assert.match(result.body, /## 必需证据/);
  assert.match(result.body, /EVT 测试计划/);
  assert.match(result.body, /APPROVE_WITH_CONDITIONS/);
  assert.match(result.body, /补充低温启动测试/);
  assert.match(result.body, /低温测试已补齐/);
  assert.match(result.body, /有条件批准条款：1\/1 已完成/);
  assert.match(result.body, /缓解负责人/);
  assert.match(result.body, /user-quality-lead/);
});

test("gate approval pack endpoints return the frozen approval package", async () => {
  completeEvtGateForHttpTests();
  await dispatch("/risks/risk-thermal-margin/mitigation", {
    method: "PATCH",
    body: JSON.stringify({
      mitigationOwnerUserId: "user-quality-lead",
      mitigationDueAt: "2026-06-15",
      mitigation: "补充热仿真并准备散热垫备选方案。",
      actorUserId: "user-project-manager",
    }),
  });
  await dispatch("/risks/risk-thermal-margin/mitigation/complete", {
    method: "POST",
    body: JSON.stringify({
      actorUserId: "user-quality-lead",
      comment: "热仿真复测通过。",
    }),
  });

  const approval = await dispatch("/gates/gate-evt_exit/approve", {
    method: "POST",
    body: JSON.stringify({
      userId: "user-project-manager",
      comment: "HTTP 批准归档。",
    }),
  });
  assert.equal(approval.status, 200);
  assert.equal(approval.body.approvalPack.reviewPack.gate.approvalComment, "HTTP 批准归档。");
  assert.equal(approval.body.approvalPack.reviewPack.risks[0].mitigationStatus, "DONE");
  assert.equal(approval.body.approvalPack.reviewPack.evidence[0].approvedReviewDecision, "APPROVE");

  const jsonResult = await dispatch("/gates/gate-evt_exit/approval-pack");
  assert.equal(jsonResult.status, 200);
  assert.equal(jsonResult.body.gateId, "gate-evt_exit");
  assert.equal(jsonResult.body.reviewPack.gate.status, "APPROVED");
  assert.equal(jsonResult.body.reviewPack.risks[0].mitigationCompletionComment, "热仿真复测通过。");

  const markdownResult = await dispatch("/gates/gate-evt_exit/approval-pack.md");
  assert.equal(markdownResult.status, 200);
  assert.match(markdownResult.headers["content-type"], /text\/markdown/);
  assert.match(markdownResult.body, /HTTP 批准归档/);
});

test("agent run endpoint rejects invalid draft output", async () => {
  const result = await dispatch("/agent-runs", {
    method: "POST",
    body: JSON.stringify({
      workPackageId: "wp-evt_exit-evt_test_report",
      agentKey: "test_agent",
      draftMarkdown: "# 不完整草稿\n\n缺少必填章节。",
    }),
  });

  assert.equal(result.status, 422);
  assert.equal(result.body.agentRun.status, "OUTPUT_INVALID");
  assert.equal(result.body.workPackage.status, "NEEDS_AGENT_REVISION");
});

test("agent run endpoint rejects malformed input refs", async () => {
  const result = await dispatch("/agent-runs", {
    method: "POST",
    body: JSON.stringify({
      workPackageId: "wp-evt_exit-evt_test_report",
      agentKey: "test_agent",
      inputRefs: "artifact:test-input",
    }),
  });

  assert.equal(result.status, 400);
  assert.equal(result.body.error, "inputRefs 必须是数组");
});

test("project endpoint rejects unknown active phase keys", async () => {
  const result = await dispatch("/projects", {
    method: "POST",
    body: JSON.stringify({
      name: "非法阶段项目",
      activePhaseKey: "unknown_phase",
    }),
  });

  assert.equal(result.status, 400);
  assert.equal(result.body.error, "activePhaseKey 不存在于硬件阶段模板");
});

test("work package markdown endpoint exports review context", async () => {
  const review = await dispatch("/reviews", {
    method: "POST",
    body: JSON.stringify({
      workPackageId: "wp-evt_exit-evt_test_plan",
      reviewerUserId: "user-test-lead",
      decision: "APPROVE_WITH_CONDITIONS",
      comment: "允许进入下一阶段，但需要补充低温测试。",
      conditions: ["补充低温启动测试"],
    }),
  });
  await dispatch(`/reviews/${review.body.review.id}/conditions/complete`, {
    method: "POST",
    body: JSON.stringify({
      actorUserId: "user-test-lead",
      comment: "低温测试已补齐。",
    }),
  });

  const result = await dispatch("/work-packages/wp-evt_exit-evt_test_plan/export.md");

  assert.equal(result.status, 200);
  assert.match(result.headers["content-type"], /text\/markdown/);
  assert.match(result.body, /# EVT 测试计划 工作包/);
  assert.match(result.body, /## 模板校验/);
  assert.match(result.body, /补充低温启动测试/);
  assert.match(result.body, /低温测试已补齐/);
  assert.match(result.body, /## 活动记录/);
});

test("work package markdown endpoint rejects unknown work packages", async () => {
  const result = await dispatch("/work-packages/missing-work-package/export.md");

  assert.equal(result.status, 404);
  assert.equal(result.body.error, "工作包不存在");
});

test("unauthorized approval attempt returns a clear permission error", async () => {
  await dispatch("/agent-runs", {
    method: "POST",
    body: JSON.stringify({
      workPackageId: "wp-evt_exit-evt_test_report",
      agentKey: "test_agent",
      inputRefs: ["artifact:test-input"],
    }),
  });

  const result = await dispatch("/reviews", {
    method: "POST",
    body: JSON.stringify({
      workPackageId: "wp-evt_exit-evt_test_report",
      reviewerUserId: "user-project-manager",
      decision: "APPROVE",
      comment: "越权批准。",
    }),
  });

  assert.equal(result.status, 403);
  assert.equal(result.body.error, "当前用户无权批准该工作包");
});

test("review endpoint can request agent revision", async () => {
  await dispatch("/agent-runs", {
    method: "POST",
    body: JSON.stringify({
      workPackageId: "wp-evt_exit-evt_test_report",
      agentKey: "test_agent",
      inputRefs: ["artifact:test-input"],
    }),
  });

  const result = await dispatch("/reviews", {
    method: "POST",
    body: JSON.stringify({
      workPackageId: "wp-evt_exit-evt_test_report",
      reviewerUserId: "user-test-lead",
      decision: "REQUEST_REVISION",
      comment: "请补充失败项分析。",
    }),
  });

  assert.equal(result.status, 201);
  assert.equal(result.body.workPackage.status, "NEEDS_AGENT_REVISION");
});

test("review endpoint requires comments for revision or rejection", async () => {
  await dispatch("/agent-runs", {
    method: "POST",
    body: JSON.stringify({
      workPackageId: "wp-evt_exit-evt_test_report",
      agentKey: "test_agent",
      inputRefs: ["artifact:test-input"],
    }),
  });

  const result = await dispatch("/reviews", {
    method: "POST",
    body: JSON.stringify({
      workPackageId: "wp-evt_exit-evt_test_report",
      reviewerUserId: "user-test-lead",
      decision: "REQUEST_REVISION",
      comment: "",
    }),
  });

  assert.equal(result.status, 400);
  assert.equal(result.body.error, "要求修改或驳回必须填写审核意见");
});

test("risk close endpoint enforces risk decision permission", async () => {
  const denied = await dispatch("/risks/risk-thermal-margin/close", {
    method: "POST",
    body: JSON.stringify({ userId: "user-test-lead" }),
  });

  assert.equal(denied.status, 403);
  assert.equal(denied.body.error, "当前用户无权关闭风险");

  const approved = await dispatch("/risks/risk-thermal-margin/close", {
    method: "POST",
    body: JSON.stringify({ userId: "user-project-manager", comment: "热仿真复测通过。" }),
  });

  assert.equal(approved.status, 200);
  assert.equal(approved.body.risk.status, "CLOSED");
  assert.equal(approved.body.risk.closedComment, "热仿真复测通过。");
});

test("current phase risk endpoint creates custom risks", async () => {
  const result = await dispatch("/risks/current-phase", {
    method: "POST",
    body: JSON.stringify({
      title: "关键物料交期不确定",
      severity: "CRITICAL",
      userId: "user-project-manager",
    }),
  });

  assert.equal(result.status, 201);
  assert.equal(result.body.risk.title, "关键物料交期不确定");
  assert.equal(result.body.risk.severity, "CRITICAL");
  assert.equal(result.body.latestGateCheck.status, "BLOCKED");

  const register = await dispatch("/projects/project-smart-controller/risk-register");
  assert.equal(register.body.summary.openBlockingRiskCount, 2);
});

test("current phase risk endpoint requires a title", async () => {
  const result = await dispatch("/risks/current-phase", {
    method: "POST",
    body: JSON.stringify({ title: "", severity: "HIGH" }),
  });

  assert.equal(result.status, 400);
  assert.equal(result.body.error, "风险标题不能为空");
});

test("unknown API path returns JSON 404", async () => {
  const result = await dispatch("/not-a-real-api", { method: "POST" });

  assert.equal(result.status, 404);
  assert.equal(result.body.error, "接口不存在");
});
