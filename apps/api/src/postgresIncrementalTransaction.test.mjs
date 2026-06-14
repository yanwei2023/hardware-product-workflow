import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDemoStore } from "./demoStoreFactory.mjs";
import {
  addAuditEventInStore,
  addNotificationInStore,
  updateRolePairOwnerInStore,
  updateWorkPackageScheduleInStore,
} from "./storeRepository.mjs";
import {
  buildRolePairOwnerTransaction,
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
