import assert from "node:assert/strict";
import test from "node:test";
import { createDemoStore } from "./server.mjs";
import { mapStoreToPostgresRows, postgresTableNames, renderPostgresSeedSql } from "./postgresMapper.mjs";

test("store mapper produces PostgreSQL-shaped rows for the demo store", () => {
  const store = createDemoStore();
  const rows = mapStoreToPostgresRows(store);

  assert.deepEqual(Object.keys(rows), postgresTableNames);
  assert.equal(rows.projects.length, 1);
  assert.equal(rows.projects[0].product_line, null);
  assert.equal(rows.projects[0].current_phase_id, "phase-evt_exit");
  assert.equal(rows.projects[0].created_at, "1970-01-01T00:00:00.000Z");
  assert.equal(rows.projects[0].updated_at, "1970-01-01T00:00:00.000Z");
  assert.equal(rows.phases.length, 7);
  assert.equal(rows.gates.length, 7);
  assert.equal(rows.role_pairs.length, 10);
  assert.equal(rows.role_pairs.every((pair) => pair.agent_permission_level === "L1_DRAFT"), true);
  assert.equal(rows.work_packages.length, 22);
  assert.equal(rows.gate_requirements.length, store.gateRequirements.length);
  assert.equal(rows.gate_requirements.some((requirement) => !requirement.work_package_id), false);
  assert.equal(rows.artifact_versions.length, 1);
  assert.equal(rows.artifact_versions[0].created_at, "1970-01-01T00:00:00.000Z");
  assert.equal(rows.risks.length, 1);
  assert.equal(rows.risks[0].created_at, "1970-01-01T00:00:00.000Z");
  assert.equal(rows.audit_events.length, 0);
});

test("store mapper resolves gate requirements to matching work packages", () => {
  const store = createDemoStore();
  const rows = mapStoreToPostgresRows(store);
  const evtTestPlanRequirement = rows.gate_requirements.find((requirement) => requirement.id === "req-evt_exit-evt_test_plan");

  assert.equal(evtTestPlanRequirement.work_package_id, "wp-evt_exit-evt_test_plan");
});

test("store mapper carries workflow closure fields", () => {
  const store = createDemoStore();
  store.reviews.push({
    id: "review-1",
    workPackageId: "wp-evt_exit-evt_test_plan",
    reviewerUserId: "user-test-lead",
    decision: "APPROVE_WITH_CONDITIONS",
    comment: "补齐低温测试。",
    conditions: ["补充低温启动测试"],
    conditionsCompletedAt: "2026-05-26T01:00:00.000Z",
    conditionsCompletedByUserId: "user-test-lead",
    conditionsCompletionComment: "已补齐。",
    reviewedAt: "2026-05-26T00:00:00.000Z",
  });
  store.risks[0] = {
    ...store.risks[0],
    mitigation: "补充热仿真。",
    mitigationOwnerUserId: "user-quality-lead",
    mitigationDueAt: "2026-06-15",
    mitigationStatus: "DONE",
    mitigationCompletedAt: "2026-05-26T02:00:00.000Z",
    mitigationCompletedByUserId: "user-quality-lead",
    mitigationCompletionComment: "热仿真通过。",
  };
  store.evidenceRefs.push({
    id: "evidence-1",
    projectId: "project-smart-controller",
    workPackageId: "wp-evt_exit-evt_test_plan",
    label: "低温测试记录",
    ref: "file://low-temp-test.pdf",
    createdByUserId: "user-test-lead",
    createdAt: "2026-05-26T03:00:00.000Z",
  });
  store.notifications.push({
    id: "notification-1",
    projectId: "project-smart-controller",
    userId: "user-project-manager",
    title: "风险缓解已完成",
    message: "热仿真通过。",
    type: "INFO",
    status: "READ",
    objectType: "risk",
    objectId: "risk-thermal-margin",
    createdAt: "2026-05-26T04:00:00.000Z",
    readAt: "2026-05-26T04:05:00.000Z",
  });

  const rows = mapStoreToPostgresRows(store);

  assert.equal(rows.reviews[0].conditions_completed_by_user_id, "user-test-lead");
  assert.equal(rows.reviews[0].conditions_completion_comment, "已补齐。");
  assert.equal(rows.risks[0].mitigation_owner_user_id, "user-quality-lead");
  assert.equal(rows.risks[0].mitigation_status, "DONE");
  assert.equal(rows.work_package_evidence_refs[0].label, "低温测试记录");
  assert.equal(rows.notifications[0].read_at, "2026-05-26T04:05:00.000Z");
});

test("PostgreSQL seed SQL wraps rows in a deferred transaction", () => {
  const rows = mapStoreToPostgresRows(createDemoStore());
  const sql = renderPostgresSeedSql(rows);

  assert.match(sql, /^-- Generated from hardware-product-workflow JSON store\./);
  assert.match(sql, /BEGIN;\nSET CONSTRAINTS ALL DEFERRED;/);
  assert.match(sql, /INSERT INTO projects /);
  assert.match(sql, /ON CONFLICT \(id\) DO UPDATE SET name = EXCLUDED.name/);
  assert.match(sql, /INSERT INTO gate_requirements /);
  assert.match(sql, /'阶段门阻塞'|GATE_BLOCKED/);
  assert.match(sql, /'\{"title":"EVT 测试计划草稿"/);
  assert.match(sql, /COMMIT;\n$/);
});

test("PostgreSQL seed SQL escapes strings and renders jsonb values", () => {
  const sql = renderPostgresSeedSql({
    ...Object.fromEntries(postgresTableNames.map((table) => [table, []])),
    projects: [
      {
        id: "project-quote",
        name: "Bob's Device",
        product_line: "IoT",
        owner_user_id: "user-project-manager",
        current_phase_id: null,
        status: "IN_PROGRESS",
        archived_at: null,
        archived_by_user_id: null,
        cloned_from_project_id: null,
        source_exported_at: null,
        created_at: null,
        updated_at: null,
      },
    ],
    audit_events: [
      {
        id: "audit-quote",
        project_id: "project-quote",
        actor_type: "human",
        actor_id: "user-project-manager",
        event_type: "PROJECT_CREATED",
        object_type: "project",
        object_id: "project-quote",
        payload: { note: "Bob's payload" },
        created_at: "2026-05-26T00:00:00.000Z",
      },
    ],
  });

  assert.match(sql, /'Bob''s Device'/);
  assert.match(sql, /'\{"note":"Bob''s payload"\}'::jsonb/);
});
