import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { readPostgresDatabaseRows } from "./postgresDatabaseReader.mjs";
import { mapStoreToPostgresRows } from "./postgresMapper.mjs";
import { comparePostgresRows } from "./postgresStoreComparison.mjs";

function runPsqlFile(databaseUrl, filePath) {
  return spawnSync(
    "psql",
    ["--dbname", databaseUrl, "--set", "ON_ERROR_STOP=1", "--file", filePath],
    { encoding: "utf8" },
  );
}

function redact(value, databaseUrl) {
  let text = String(value || "");
  if (!databaseUrl) {
    return text;
  }
  text = text.replaceAll(databaseUrl, "[REDACTED_DATABASE_URL]");
  try {
    const password = new URL(databaseUrl).password;
    if (password) {
      text = text.replaceAll(password, "***");
    }
  } catch {
    // Full-value redaction still protects malformed URLs.
  }
  return text;
}

function executionSummary(result, databaseUrl) {
  const status = Number.isInteger(result?.status) ? result.status : null;
  const error = result?.error?.message ? redact(result.error.message, databaseUrl) : null;
  return {
    ok: status === 0 && !error,
    status,
    signal: result?.signal || null,
    stdout: redact(result?.stdout, databaseUrl).trim(),
    stderr: redact(result?.stderr, databaseUrl).trim(),
    error,
  };
}

function sqlString(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

function sqlNullable(value) {
  return value === null || value === undefined ? "NULL" : sqlString(value);
}

function sqlJson(value) {
  return `${sqlString(JSON.stringify(value ?? {}))}::jsonb`;
}

function sqlValue(value) {
  if (value && typeof value === "object") {
    return sqlJson(value);
  }
  return sqlNullable(value);
}

function insertedRows(previousRows, nextRows, table) {
  const previousIds = new Set((previousRows[table] || []).map((row) => row.id));
  return (nextRows[table] || []).filter((row) => !previousIds.has(row.id));
}

function assertOnlyTablesChanged(storeDelta, allowedTables, transactionLabel) {
  const allowedDriftTables = new Set(allowedTables);
  const unexpectedDriftTables = Object.entries(storeDelta.tables)
    .filter(([table, detail]) => !allowedDriftTables.has(table) && !detail.inSync)
    .map(([table]) => table);
  if (unexpectedDriftTables.length > 0) {
    throw new Error(`${transactionLabel} contains unrelated store changes: ${unexpectedDriftTables.join(", ")}`);
  }
}

function assertInsertedSideEffects(storeDelta, transactionLabel) {
  for (const table of ["notifications", "audit_events"]) {
    const detail = storeDelta.tables[table];
    if (detail.missingInDatabase.length > 0 || detail.changed.length > 0) {
      throw new Error(`${transactionLabel} contains unsupported ${table} changes`);
    }
  }
}

function renderNotificationInsert(row) {
  return `INSERT INTO notifications (id, project_id, user_id, title, message, type, status, object_type, object_id, created_at, read_at) VALUES (${[
    sqlString(row.id),
    sqlNullable(row.project_id),
    sqlString(row.user_id),
    sqlString(row.title),
    sqlString(row.message),
    sqlString(row.type),
    sqlString(row.status),
    sqlNullable(row.object_type),
    sqlNullable(row.object_id),
    sqlString(row.created_at),
    sqlNullable(row.read_at),
  ].join(", ")});`;
}

function renderAuditInsert(row) {
  return `INSERT INTO audit_events (id, project_id, actor_type, actor_id, event_type, object_type, object_id, payload, created_at) VALUES (${[
    sqlString(row.id),
    sqlNullable(row.project_id),
    sqlString(row.actor_type),
    sqlString(row.actor_id),
    sqlString(row.event_type),
    sqlString(row.object_type),
    sqlString(row.object_id),
    sqlJson(row.payload),
    sqlString(row.created_at),
  ].join(", ")});`;
}

function renderReviewInsert(row) {
  return `INSERT INTO reviews (id, work_package_id, reviewer_user_id, decision, comment, conditions, conditions_completed_at, conditions_completed_by_user_id, conditions_completion_comment, reviewed_at) VALUES (${[
    sqlString(row.id),
    sqlString(row.work_package_id),
    sqlString(row.reviewer_user_id),
    sqlString(row.decision),
    sqlString(row.comment),
    sqlJson(row.conditions),
    sqlNullable(row.conditions_completed_at),
    sqlNullable(row.conditions_completed_by_user_id),
    sqlString(row.conditions_completion_comment),
    sqlString(row.reviewed_at),
  ].join(", ")});`;
}

function renderEvidenceRefInsert(row) {
  return `INSERT INTO work_package_evidence_refs (id, project_id, work_package_id, label, ref, created_by_user_id, created_at) VALUES (${[
    sqlString(row.id),
    sqlString(row.project_id),
    sqlString(row.work_package_id),
    sqlString(row.label),
    sqlString(row.ref),
    sqlString(row.created_by_user_id),
    sqlString(row.created_at),
  ].join(", ")});`;
}

function renderGateApprovalPackInsert(row) {
  return `INSERT INTO gate_approval_packs (id, project_id, gate_id, phase_id, approved_by_user_id, approved_at, approval_comment, review_pack_json) VALUES (${[
    sqlString(row.id),
    sqlString(row.project_id),
    sqlString(row.gate_id),
    sqlString(row.phase_id),
    sqlString(row.approved_by_user_id),
    sqlString(row.approved_at),
    sqlString(row.approval_comment),
    sqlJson(row.review_pack_json),
  ].join(", ")});`;
}

function renderRiskInsert(row) {
  return `INSERT INTO risks (id, project_id, phase_id, title, severity, status, owner_role_pair_id, mitigation, mitigation_owner_user_id, mitigation_due_at, mitigation_status, mitigation_updated_at, mitigation_updated_by_user_id, mitigation_completed_at, mitigation_completed_by_user_id, mitigation_completion_comment, accepted_by_user_id, accepted_at, accepted_comment, closed_by_user_id, closed_at, closed_comment, created_by_user_id, created_at) VALUES (${[
    sqlString(row.id),
    sqlString(row.project_id),
    sqlString(row.phase_id),
    sqlString(row.title),
    sqlString(row.severity),
    sqlString(row.status),
    sqlNullable(row.owner_role_pair_id),
    sqlString(row.mitigation),
    sqlNullable(row.mitigation_owner_user_id),
    sqlNullable(row.mitigation_due_at),
    sqlNullable(row.mitigation_status),
    sqlNullable(row.mitigation_updated_at),
    sqlNullable(row.mitigation_updated_by_user_id),
    sqlNullable(row.mitigation_completed_at),
    sqlNullable(row.mitigation_completed_by_user_id),
    sqlString(row.mitigation_completion_comment),
    sqlNullable(row.accepted_by_user_id),
    sqlNullable(row.accepted_at),
    sqlString(row.accepted_comment),
    sqlNullable(row.closed_by_user_id),
    sqlNullable(row.closed_at),
    sqlString(row.closed_comment),
    sqlString(row.created_by_user_id),
    sqlString(row.created_at),
  ].join(", ")});`;
}

function renderAgentJobInsert(row) {
  return `INSERT INTO agent_jobs (id, project_id, work_package_id, agent_key, input_refs, draft_markdown, requested_by_user_id, status, created_at, started_at, completed_at, result_status_code, agent_run_id, error) VALUES (${[
    sqlString(row.id),
    sqlString(row.project_id),
    sqlString(row.work_package_id),
    sqlString(row.agent_key),
    sqlJson(row.input_refs),
    sqlNullable(row.draft_markdown),
    sqlString(row.requested_by_user_id),
    sqlString(row.status),
    sqlString(row.created_at),
    sqlNullable(row.started_at),
    sqlNullable(row.completed_at),
    sqlNullable(row.result_status_code),
    sqlNullable(row.agent_run_id),
    sqlString(row.error),
  ].join(", ")});`;
}

function renderAgentRunInsert(row) {
  return `INSERT INTO agent_runs (id, work_package_id, agent_key, status, input_refs, output_ref, artifact_template_key, required_sections, required_review_roles, validation_json, created_at, completed_at) VALUES (${[
    sqlString(row.id),
    sqlString(row.work_package_id),
    sqlString(row.agent_key),
    sqlString(row.status),
    sqlJson(row.input_refs),
    sqlNullable(row.output_ref),
    sqlNullable(row.artifact_template_key),
    sqlJson(row.required_sections),
    sqlJson(row.required_review_roles),
    sqlValue(row.validation_json),
    sqlString(row.created_at),
    sqlNullable(row.completed_at),
  ].join(", ")});`;
}

function renderArtifactInsert(row) {
  return `INSERT INTO artifact_versions (id, work_package_id, artifact_type, version, status, object_key, content_json, created_by_actor, created_at) VALUES (${[
    sqlString(row.id),
    sqlString(row.work_package_id),
    sqlString(row.artifact_type),
    sqlString(row.version),
    sqlString(row.status),
    sqlNullable(row.object_key),
    sqlJson(row.content_json),
    sqlString(row.created_by_actor),
    sqlString(row.created_at),
  ].join(", ")});`;
}

function renderUpdateSet(row, fields) {
  return fields.map((field) => `${field} = ${sqlValue(row[field])}`).join(", ");
}

function renderPreviousConditions(row, fields) {
  return fields.map((field) => `${field} IS NOT DISTINCT FROM ${sqlValue(row[field])}`).join(" AND ");
}

function changedRowForId(storeDelta, table, id, label) {
  const changed = storeDelta.tables[table].changed.find((row) => row.id === id) || null;
  if (!changed) {
    throw new Error(`${label} transaction expected ${table} row to change: ${id}`);
  }
  return changed;
}

function assertNoRowAddsOrDeletes(storeDelta, table, label) {
  const detail = storeDelta.tables[table];
  if (detail.missingInDatabase.length > 0 || detail.missingInStore.length > 0) {
    throw new Error(`${label} transaction contains unsupported ${table} row additions or deletions`);
  }
}

export function buildRolePairOwnerTransaction({ previousStore, nextStore, rolePairId } = {}) {
  const previousRows = mapStoreToPostgresRows(previousStore);
  const nextRows = mapStoreToPostgresRows(nextStore);
  const storeDelta = comparePostgresRows(previousRows, nextRows);
  const previousRolePair = previousRows.role_pairs.find((row) => row.id === rolePairId);
  const nextRolePair = nextRows.role_pairs.find((row) => row.id === rolePairId);
  if (!previousRolePair || !nextRolePair) {
    throw new Error(`role pair not found for incremental transaction: ${rolePairId}`);
  }
  if (previousRolePair.human_user_id === nextRolePair.human_user_id) {
    throw new Error(`role pair owner did not change: ${rolePairId}`);
  }

  const notifications = insertedRows(previousRows, nextRows, "notifications");
  const auditEvents = insertedRows(previousRows, nextRows, "audit_events");
  if (auditEvents.length !== 1 || auditEvents[0].event_type !== "ROLE_PAIR_UPDATED") {
    throw new Error("role pair owner transaction requires exactly one ROLE_PAIR_UPDATED audit event");
  }
  if (notifications.length === 0) {
    throw new Error("role pair owner transaction requires at least one notification");
  }
  assertOnlyTablesChanged(storeDelta, ["role_pairs", "notifications", "audit_events"], "role pair owner transaction");
  const rolePairDelta = storeDelta.tables.role_pairs;
  if (
    rolePairDelta.missingInDatabase.length > 0 ||
    rolePairDelta.missingInStore.length > 0 ||
    rolePairDelta.changed.length !== 1 ||
    rolePairDelta.changed[0].id !== rolePairId ||
    rolePairDelta.changed[0].fields.join(",") !== "human_user_id"
  ) {
    throw new Error("role pair owner transaction contains unsupported role pair changes");
  }
  assertInsertedSideEffects(storeDelta, "role pair owner transaction");

  const notificationIds = notifications.map((row) => row.id);
  const auditIds = auditEvents.map((row) => row.id);
  const applySql = [
    "-- Native incremental role-pair owner transaction",
    "BEGIN;",
    "SELECT pg_advisory_xact_lock(724311);",
    "DO $hardware_flow$",
    "BEGIN",
    `  UPDATE role_pairs SET human_user_id = ${sqlString(nextRolePair.human_user_id)} WHERE id = ${sqlString(rolePairId)} AND human_user_id = ${sqlString(previousRolePair.human_user_id)};`,
    "  IF NOT FOUND THEN",
    "    RAISE EXCEPTION 'role pair owner changed concurrently or role pair is missing';",
    "  END IF;",
    "END;",
    "$hardware_flow$;",
    ...auditEvents.map(renderAuditInsert),
    ...notifications.map(renderNotificationInsert),
    "COMMIT;",
    "",
  ].join("\n");
  const rollbackSql = [
    "-- Compensating role-pair owner transaction",
    "BEGIN;",
    "SELECT pg_advisory_xact_lock(724311);",
    `DELETE FROM notifications WHERE id IN (${notificationIds.map(sqlString).join(", ")});`,
    `DELETE FROM audit_events WHERE id IN (${auditIds.map(sqlString).join(", ")});`,
    `UPDATE role_pairs SET human_user_id = ${sqlString(previousRolePair.human_user_id)} WHERE id = ${sqlString(rolePairId)} AND human_user_id = ${sqlString(nextRolePair.human_user_id)};`,
    "COMMIT;",
    "",
  ].join("\n");

  return {
    kind: "role-pair-owner-update",
    rolePairId,
    previousHumanUserId: previousRolePair.human_user_id,
    humanUserId: nextRolePair.human_user_id,
    auditEventCount: auditEvents.length,
    notificationCount: notifications.length,
    applySql,
    rollbackSql,
    previousRows,
    nextRows,
  };
}

export function buildWorkPackageScheduleTransaction({ previousStore, nextStore, workPackageId } = {}) {
  const previousRows = mapStoreToPostgresRows(previousStore);
  const nextRows = mapStoreToPostgresRows(nextStore);
  const storeDelta = comparePostgresRows(previousRows, nextRows);
  const previousWorkPackage = previousRows.work_packages.find((row) => row.id === workPackageId);
  const nextWorkPackage = nextRows.work_packages.find((row) => row.id === workPackageId);
  if (!previousWorkPackage || !nextWorkPackage) {
    throw new Error(`work package not found for incremental transaction: ${workPackageId}`);
  }
  if (previousWorkPackage.due_at === nextWorkPackage.due_at) {
    throw new Error(`work package schedule did not change: ${workPackageId}`);
  }

  const notifications = insertedRows(previousRows, nextRows, "notifications");
  const auditEvents = insertedRows(previousRows, nextRows, "audit_events");
  if (auditEvents.length !== 1 || auditEvents[0].event_type !== "WORK_PACKAGE_SCHEDULE_UPDATED") {
    throw new Error("work package schedule transaction requires exactly one WORK_PACKAGE_SCHEDULE_UPDATED audit event");
  }
  if (notifications.length === 0) {
    throw new Error("work package schedule transaction requires at least one notification");
  }
  assertOnlyTablesChanged(storeDelta, ["work_packages", "notifications", "audit_events"], "work package schedule transaction");
  const workPackageDelta = storeDelta.tables.work_packages;
  if (
    workPackageDelta.missingInDatabase.length > 0 ||
    workPackageDelta.missingInStore.length > 0 ||
    workPackageDelta.changed.length !== 1 ||
    workPackageDelta.changed[0].id !== workPackageId ||
    workPackageDelta.changed[0].fields.join(",") !== "due_at"
  ) {
    throw new Error("work package schedule transaction contains unsupported work package changes");
  }
  assertInsertedSideEffects(storeDelta, "work package schedule transaction");

  const notificationIds = notifications.map((row) => row.id);
  const auditIds = auditEvents.map((row) => row.id);
  const applySql = [
    "-- Native incremental work-package schedule transaction",
    "BEGIN;",
    "SELECT pg_advisory_xact_lock(724311);",
    "DO $hardware_flow$",
    "BEGIN",
    `  UPDATE work_packages SET due_at = ${sqlNullable(nextWorkPackage.due_at)} WHERE id = ${sqlString(workPackageId)} AND due_at IS NOT DISTINCT FROM ${sqlNullable(previousWorkPackage.due_at)};`,
    "  IF NOT FOUND THEN",
    "    RAISE EXCEPTION 'work package schedule changed concurrently or work package is missing';",
    "  END IF;",
    "END;",
    "$hardware_flow$;",
    ...auditEvents.map(renderAuditInsert),
    ...notifications.map(renderNotificationInsert),
    "COMMIT;",
    "",
  ].join("\n");
  const rollbackSql = [
    "-- Compensating work-package schedule transaction",
    "BEGIN;",
    "SELECT pg_advisory_xact_lock(724311);",
    `DELETE FROM notifications WHERE id IN (${notificationIds.map(sqlString).join(", ")});`,
    `DELETE FROM audit_events WHERE id IN (${auditIds.map(sqlString).join(", ")});`,
    `UPDATE work_packages SET due_at = ${sqlNullable(previousWorkPackage.due_at)} WHERE id = ${sqlString(workPackageId)} AND due_at IS NOT DISTINCT FROM ${sqlNullable(nextWorkPackage.due_at)};`,
    "COMMIT;",
    "",
  ].join("\n");

  return {
    kind: "work-package-schedule-update",
    workPackageId,
    previousDueAt: previousWorkPackage.due_at,
    dueAt: nextWorkPackage.due_at,
    auditEventCount: auditEvents.length,
    notificationCount: notifications.length,
    applySql,
    rollbackSql,
    previousRows,
    nextRows,
  };
}

export function buildNotificationReadTransaction({ previousStore, nextStore, notificationId } = {}) {
  const previousRows = mapStoreToPostgresRows(previousStore);
  const nextRows = mapStoreToPostgresRows(nextStore);
  const storeDelta = comparePostgresRows(previousRows, nextRows);
  const previousNotification = previousRows.notifications.find((row) => row.id === notificationId);
  const nextNotification = nextRows.notifications.find((row) => row.id === notificationId);
  if (!previousNotification || !nextNotification) {
    throw new Error(`notification not found for incremental transaction: ${notificationId}`);
  }
  if (previousNotification.status === nextNotification.status && previousNotification.read_at === nextNotification.read_at) {
    throw new Error(`notification read state did not change: ${notificationId}`);
  }
  if (nextNotification.status !== "READ" || !nextNotification.read_at) {
    throw new Error("notification read transaction requires a READ status and read_at timestamp");
  }

  assertOnlyTablesChanged(storeDelta, ["notifications"], "notification read transaction");
  const notificationDelta = storeDelta.tables.notifications;
  const changedFields = notificationDelta.changed[0]?.fields || [];
  const allowedFields = new Set(["read_at", "status"]);
  if (
    notificationDelta.missingInDatabase.length > 0 ||
    notificationDelta.missingInStore.length > 0 ||
    notificationDelta.changed.length !== 1 ||
    notificationDelta.changed[0].id !== notificationId ||
    changedFields.some((field) => !allowedFields.has(field)) ||
    changedFields.length === 0
  ) {
    throw new Error("notification read transaction contains unsupported notification changes");
  }

  const applySql = [
    "-- Native incremental notification-read transaction",
    "BEGIN;",
    "SELECT pg_advisory_xact_lock(724311);",
    "DO $hardware_flow$",
    "BEGIN",
    `  UPDATE notifications SET status = ${sqlString(nextNotification.status)}, read_at = ${sqlString(nextNotification.read_at)} WHERE id = ${sqlString(notificationId)} AND status = ${sqlString(previousNotification.status)} AND read_at IS NOT DISTINCT FROM ${sqlNullable(previousNotification.read_at)};`,
    "  IF NOT FOUND THEN",
    "    RAISE EXCEPTION 'notification read state changed concurrently or notification is missing';",
    "  END IF;",
    "END;",
    "$hardware_flow$;",
    "COMMIT;",
    "",
  ].join("\n");
  const rollbackSql = [
    "-- Compensating notification-read transaction",
    "BEGIN;",
    "SELECT pg_advisory_xact_lock(724311);",
    `UPDATE notifications SET status = ${sqlString(previousNotification.status)}, read_at = ${sqlNullable(previousNotification.read_at)} WHERE id = ${sqlString(notificationId)} AND status = ${sqlString(nextNotification.status)} AND read_at IS NOT DISTINCT FROM ${sqlString(nextNotification.read_at)};`,
    "COMMIT;",
    "",
  ].join("\n");

  return {
    kind: "notification-read",
    notificationId,
    previousStatus: previousNotification.status,
    status: nextNotification.status,
    previousReadAt: previousNotification.read_at,
    readAt: nextNotification.read_at,
    auditEventCount: 0,
    notificationCount: 1,
    applySql,
    rollbackSql,
    previousRows,
    nextRows,
  };
}

export function buildProjectNotificationsReadTransaction({ previousStore, nextStore, projectId, userId } = {}) {
  const previousRows = mapStoreToPostgresRows(previousStore);
  const nextRows = mapStoreToPostgresRows(nextStore);
  const storeDelta = comparePostgresRows(previousRows, nextRows);
  assertOnlyTablesChanged(storeDelta, ["notifications"], "project notifications read transaction");

  const notificationDelta = storeDelta.tables.notifications;
  if (notificationDelta.missingInDatabase.length > 0 || notificationDelta.missingInStore.length > 0) {
    throw new Error("project notifications read transaction contains unsupported notification row additions or deletions");
  }
  if (notificationDelta.changed.length === 0) {
    throw new Error(`project notifications read transaction did not change notifications for ${projectId}/${userId}`);
  }

  const previousById = new Map(previousRows.notifications.map((row) => [row.id, row]));
  const nextById = new Map(nextRows.notifications.map((row) => [row.id, row]));
  const allowedFields = new Set(["read_at", "status"]);
  const changedNotifications = notificationDelta.changed.map((change) => {
    const previousNotification = previousById.get(change.id);
    const nextNotification = nextById.get(change.id);
    if (!previousNotification || !nextNotification) {
      throw new Error(`notification not found for incremental transaction: ${change.id}`);
    }
    if (previousNotification.project_id !== projectId || nextNotification.project_id !== projectId) {
      throw new Error("project notifications read transaction contains notifications outside the project");
    }
    if (previousNotification.user_id !== userId || nextNotification.user_id !== userId) {
      throw new Error("project notifications read transaction contains notifications outside the user");
    }
    if (previousNotification.status !== "UNREAD" || nextNotification.status !== "READ" || !nextNotification.read_at) {
      throw new Error("project notifications read transaction requires UNREAD notifications to become READ with read_at timestamps");
    }
    const unsupportedFields = change.fields.filter((field) => !allowedFields.has(field));
    if (unsupportedFields.length > 0 || change.fields.length === 0) {
      throw new Error("project notifications read transaction contains unsupported notification changes");
    }
    return { change, previousNotification, nextNotification };
  });

  const updateSql = changedNotifications.flatMap(({ change, previousNotification, nextNotification }) => [
    `  UPDATE notifications SET status = ${sqlString(nextNotification.status)}, read_at = ${sqlString(nextNotification.read_at)} WHERE id = ${sqlString(change.id)} AND project_id = ${sqlString(projectId)} AND user_id = ${sqlString(userId)} AND status = ${sqlString(previousNotification.status)} AND read_at IS NOT DISTINCT FROM ${sqlNullable(previousNotification.read_at)};`,
    "  IF NOT FOUND THEN",
    `    RAISE EXCEPTION 'notification read state changed concurrently or notification is missing: ${change.id}';`,
    "  END IF;",
  ]);
  const rollbackSql = changedNotifications.map(({ change, previousNotification, nextNotification }) =>
    `UPDATE notifications SET status = ${sqlString(previousNotification.status)}, read_at = ${sqlNullable(previousNotification.read_at)} WHERE id = ${sqlString(change.id)} AND project_id = ${sqlString(projectId)} AND user_id = ${sqlString(userId)} AND status = ${sqlString(nextNotification.status)} AND read_at IS NOT DISTINCT FROM ${sqlString(nextNotification.read_at)};`,
  );

  return {
    kind: "project-notifications-read",
    projectId,
    userId,
    notificationIds: changedNotifications.map(({ change }) => change.id),
    auditEventCount: 0,
    notificationCount: changedNotifications.length,
    applySql: [
      "-- Native incremental project-notifications-read transaction",
      "BEGIN;",
      "SELECT pg_advisory_xact_lock(724311);",
      "DO $hardware_flow$",
      "BEGIN",
      ...updateSql,
      "END;",
      "$hardware_flow$;",
      "COMMIT;",
      "",
    ].join("\n"),
    rollbackSql: [
      "-- Compensating project-notifications-read transaction",
      "BEGIN;",
      "SELECT pg_advisory_xact_lock(724311);",
      ...rollbackSql,
      "COMMIT;",
      "",
    ].join("\n"),
    previousRows,
    nextRows,
  };
}

const riskMutationFieldAllowlist = {
  "risk-status-update": new Set([
    "status",
    "accepted_by_user_id",
    "accepted_at",
    "accepted_comment",
    "closed_by_user_id",
    "closed_at",
    "closed_comment",
  ]),
  "risk-mitigation-update": new Set([
    "mitigation",
    "mitigation_owner_user_id",
    "mitigation_due_at",
    "mitigation_status",
    "mitigation_updated_at",
    "mitigation_updated_by_user_id",
    "mitigation_completed_at",
    "mitigation_completed_by_user_id",
    "mitigation_completion_comment",
  ]),
  "risk-mitigation-complete": new Set([
    "mitigation_status",
    "mitigation_completed_at",
    "mitigation_completed_by_user_id",
    "mitigation_completion_comment",
  ]),
};

function renderRiskUpdate(row, changedFields) {
  return changedFields.map((field) => `${field} = ${sqlValue(row[field])}`).join(", ");
}

function renderRiskPreviousConditions(row, changedFields) {
  return changedFields.map((field) => `${field} IS NOT DISTINCT FROM ${sqlValue(row[field])}`).join(" AND ");
}

export function buildRiskTransaction({ previousStore, nextStore, riskId, kind } = {}) {
  const allowedFields = riskMutationFieldAllowlist[kind];
  if (!allowedFields) {
    throw new Error(`unsupported risk incremental transaction: ${kind || "missing"}`);
  }

  const previousRows = mapStoreToPostgresRows(previousStore);
  const nextRows = mapStoreToPostgresRows(nextStore);
  const storeDelta = comparePostgresRows(previousRows, nextRows);
  const previousRisk = previousRows.risks.find((row) => row.id === riskId);
  const nextRisk = nextRows.risks.find((row) => row.id === riskId);
  if (!previousRisk || !nextRisk) {
    throw new Error(`risk not found for incremental transaction: ${riskId}`);
  }

  const riskDelta = storeDelta.tables.risks;
  if (
    riskDelta.missingInDatabase.length > 0 ||
    riskDelta.missingInStore.length > 0 ||
    riskDelta.changed.length !== 1 ||
    riskDelta.changed[0].id !== riskId
  ) {
    throw new Error(`${kind} transaction contains unsupported risk changes`);
  }

  const changedFields = riskDelta.changed[0].fields;
  const unsupportedFields = changedFields.filter((field) => !allowedFields.has(field));
  if (unsupportedFields.length > 0) {
    throw new Error(`${kind} transaction contains unsupported risk fields: ${unsupportedFields.join(", ")}`);
  }
  if (changedFields.length === 0) {
    throw new Error(`${kind} transaction did not change risk fields: ${riskId}`);
  }

  const notifications = insertedRows(previousRows, nextRows, "notifications");
  const auditEvents = insertedRows(previousRows, nextRows, "audit_events");
  const allowedAuditEvents = {
    "risk-status-update": new Set(["RISK_ACCEPTED", "RISK_CLOSED"]),
    "risk-mitigation-update": new Set(["RISK_MITIGATION_UPDATED"]),
    "risk-mitigation-complete": new Set(["RISK_MITIGATION_DONE"]),
  }[kind];
  if (auditEvents.length !== 1 || !allowedAuditEvents.has(auditEvents[0].event_type)) {
    throw new Error(`${kind} transaction requires exactly one supported audit event`);
  }

  assertOnlyTablesChanged(storeDelta, ["risks", "notifications", "audit_events"], `${kind} transaction`);
  assertInsertedSideEffects(storeDelta, `${kind} transaction`);

  const notificationIds = notifications.map((row) => row.id);
  const auditIds = auditEvents.map((row) => row.id);
  const notificationRollback = notificationIds.length > 0
    ? `DELETE FROM notifications WHERE id IN (${notificationIds.map(sqlString).join(", ")});`
    : "-- No notification side effects to delete.";
  const applySql = [
    `-- Native incremental ${kind} transaction`,
    "BEGIN;",
    "SELECT pg_advisory_xact_lock(724311);",
    "DO $hardware_flow$",
    "BEGIN",
    `  UPDATE risks SET ${renderRiskUpdate(nextRisk, changedFields)} WHERE id = ${sqlString(riskId)} AND ${renderRiskPreviousConditions(previousRisk, changedFields)};`,
    "  IF NOT FOUND THEN",
    "    RAISE EXCEPTION 'risk changed concurrently or risk is missing';",
    "  END IF;",
    "END;",
    "$hardware_flow$;",
    ...auditEvents.map(renderAuditInsert),
    ...notifications.map(renderNotificationInsert),
    "COMMIT;",
    "",
  ].join("\n");
  const rollbackSql = [
    `-- Compensating ${kind} transaction`,
    "BEGIN;",
    "SELECT pg_advisory_xact_lock(724311);",
    notificationRollback,
    `DELETE FROM audit_events WHERE id IN (${auditIds.map(sqlString).join(", ")});`,
    `UPDATE risks SET ${renderRiskUpdate(previousRisk, changedFields)} WHERE id = ${sqlString(riskId)} AND ${renderRiskPreviousConditions(nextRisk, changedFields)};`,
    "COMMIT;",
    "",
  ].join("\n");

  return {
    kind,
    riskId,
    changedFields,
    auditEventCount: auditEvents.length,
    notificationCount: notifications.length,
    applySql,
    rollbackSql,
    previousRows,
    nextRows,
  };
}

export function buildRiskCreateTransaction({ previousStore, nextStore, riskId } = {}) {
  const previousRows = mapStoreToPostgresRows(previousStore);
  const nextRows = mapStoreToPostgresRows(nextStore);
  const storeDelta = comparePostgresRows(previousRows, nextRows);
  const risks = insertedRows(previousRows, nextRows, "risks");
  const risk = risks.find((row) => row.id === riskId) || null;
  if (risks.length !== 1 || !risk) {
    throw new Error("risk create transaction requires exactly one inserted risk");
  }
  if (risk.status !== "OPEN" || !risk.project_id || !risk.phase_id || !risk.created_by_user_id || !risk.created_at) {
    throw new Error("risk create transaction requires a complete OPEN risk row");
  }

  const notifications = insertedRows(previousRows, nextRows, "notifications");
  const auditEvents = insertedRows(previousRows, nextRows, "audit_events");
  if (auditEvents.length !== 1 || auditEvents[0].event_type !== "RISK_CREATED") {
    throw new Error("risk create transaction requires exactly one RISK_CREATED audit event");
  }
  if (notifications.length === 0) {
    throw new Error("risk create transaction requires at least one notification");
  }

  assertOnlyTablesChanged(storeDelta, ["risks", "notifications", "audit_events"], "risk create transaction");
  assertInsertedSideEffects(storeDelta, "risk create transaction");
  const riskDelta = storeDelta.tables.risks;
  if (
    riskDelta.missingInDatabase.length > 0 ||
    riskDelta.missingInStore.length !== 1 ||
    riskDelta.missingInStore[0] !== riskId ||
    riskDelta.changed.length > 0
  ) {
    throw new Error("risk create transaction contains unsupported risk changes");
  }

  const notificationIds = notifications.map((row) => row.id);
  const auditIds = auditEvents.map((row) => row.id);
  const applySql = [
    "-- Native incremental risk-create transaction",
    "BEGIN;",
    "SELECT pg_advisory_xact_lock(724311);",
    renderRiskInsert(risk),
    ...auditEvents.map(renderAuditInsert),
    ...notifications.map(renderNotificationInsert),
    "COMMIT;",
    "",
  ].join("\n");
  const rollbackSql = [
    "-- Compensating risk-create transaction",
    "BEGIN;",
    "SELECT pg_advisory_xact_lock(724311);",
    `DELETE FROM notifications WHERE id IN (${notificationIds.map(sqlString).join(", ")});`,
    `DELETE FROM audit_events WHERE id IN (${auditIds.map(sqlString).join(", ")});`,
    `DELETE FROM risks WHERE id = ${sqlString(riskId)};`,
    "COMMIT;",
    "",
  ].join("\n");

  return {
    kind: "risk-create",
    riskId,
    auditEventCount: auditEvents.length,
    notificationCount: notifications.length,
    applySql,
    rollbackSql,
    previousRows,
    nextRows,
  };
}

export function buildAgentJobQueueTransaction({ previousStore, nextStore, agentJobId } = {}) {
  const previousRows = mapStoreToPostgresRows(previousStore);
  const nextRows = mapStoreToPostgresRows(nextStore);
  const storeDelta = comparePostgresRows(previousRows, nextRows);
  const agentJobs = insertedRows(previousRows, nextRows, "agent_jobs");
  const agentJob = agentJobs.find((row) => row.id === agentJobId) || null;
  if (agentJobs.length !== 1 || !agentJob) {
    throw new Error("agent job queue transaction requires exactly one inserted agent job");
  }
  if (
    agentJob.status !== "QUEUED" ||
    !agentJob.project_id ||
    !agentJob.work_package_id ||
    !agentJob.agent_key ||
    !agentJob.requested_by_user_id ||
    !agentJob.created_at
  ) {
    throw new Error("agent job queue transaction requires a complete QUEUED agent job row");
  }

  const auditEvents = insertedRows(previousRows, nextRows, "audit_events");
  if (auditEvents.length !== 1 || auditEvents[0].event_type !== "AGENT_JOB_QUEUED") {
    throw new Error("agent job queue transaction requires exactly one AGENT_JOB_QUEUED audit event");
  }

  assertOnlyTablesChanged(storeDelta, ["agent_jobs", "audit_events"], "agent job queue transaction");
  assertInsertedSideEffects(storeDelta, "agent job queue transaction");
  const agentJobDelta = storeDelta.tables.agent_jobs;
  if (
    agentJobDelta.missingInDatabase.length > 0 ||
    agentJobDelta.missingInStore.length !== 1 ||
    agentJobDelta.missingInStore[0] !== agentJobId ||
    agentJobDelta.changed.length > 0
  ) {
    throw new Error("agent job queue transaction contains unsupported agent job changes");
  }

  const auditIds = auditEvents.map((row) => row.id);
  const applySql = [
    "-- Native incremental agent-job-queue transaction",
    "BEGIN;",
    "SELECT pg_advisory_xact_lock(724311);",
    renderAgentJobInsert(agentJob),
    ...auditEvents.map(renderAuditInsert),
    "COMMIT;",
    "",
  ].join("\n");
  const rollbackSql = [
    "-- Compensating agent-job-queue transaction",
    "BEGIN;",
    "SELECT pg_advisory_xact_lock(724311);",
    `DELETE FROM audit_events WHERE id IN (${auditIds.map(sqlString).join(", ")});`,
    `DELETE FROM agent_jobs WHERE id = ${sqlString(agentJobId)};`,
    "COMMIT;",
    "",
  ].join("\n");

  return {
    kind: "agent-job-queue",
    agentJobId,
    workPackageId: agentJob.work_package_id,
    auditEventCount: auditEvents.length,
    notificationCount: 0,
    applySql,
    rollbackSql,
    previousRows,
    nextRows,
  };
}

export function buildAgentOutputInvalidTransaction({ previousStore, nextStore, workPackageId, agentRunId } = {}) {
  const previousRows = mapStoreToPostgresRows(previousStore);
  const nextRows = mapStoreToPostgresRows(nextStore);
  const storeDelta = comparePostgresRows(previousRows, nextRows);
  const previousWorkPackage = previousRows.work_packages.find((row) => row.id === workPackageId);
  const nextWorkPackage = nextRows.work_packages.find((row) => row.id === workPackageId);
  if (!previousWorkPackage || !nextWorkPackage) {
    throw new Error(`work package not found for agent output invalid transaction: ${workPackageId}`);
  }
  if (nextWorkPackage.status !== "NEEDS_AGENT_REVISION" || previousWorkPackage.status === nextWorkPackage.status) {
    throw new Error("agent output invalid transaction requires work package status to change to NEEDS_AGENT_REVISION");
  }

  const agentRuns = insertedRows(previousRows, nextRows, "agent_runs");
  const agentRun = agentRuns.find((row) => row.id === agentRunId) || null;
  if (agentRuns.length !== 1 || !agentRun || agentRun.work_package_id !== workPackageId) {
    throw new Error("agent output invalid transaction requires exactly one inserted agent run for the work package");
  }
  if (agentRun.status !== "OUTPUT_INVALID" || !agentRun.validation_json) {
    throw new Error("agent output invalid transaction requires an OUTPUT_INVALID agent run with validation details");
  }

  const notifications = insertedRows(previousRows, nextRows, "notifications");
  const auditEvents = insertedRows(previousRows, nextRows, "audit_events");
  if (auditEvents.length !== 1 || auditEvents[0].event_type !== "AGENT_OUTPUT_INVALID") {
    throw new Error("agent output invalid transaction requires exactly one AGENT_OUTPUT_INVALID audit event");
  }
  if (notifications.length === 0) {
    throw new Error("agent output invalid transaction requires at least one notification");
  }

  assertOnlyTablesChanged(storeDelta, ["work_packages", "agent_runs", "notifications", "audit_events"], "agent output invalid transaction");
  assertInsertedSideEffects(storeDelta, "agent output invalid transaction");
  const workPackageDelta = storeDelta.tables.work_packages;
  if (
    workPackageDelta.missingInDatabase.length > 0 ||
    workPackageDelta.missingInStore.length > 0 ||
    workPackageDelta.changed.length !== 1 ||
    workPackageDelta.changed[0].id !== workPackageId ||
    workPackageDelta.changed[0].fields.join(",") !== "status"
  ) {
    throw new Error("agent output invalid transaction contains unsupported work package changes");
  }
  const agentRunDelta = storeDelta.tables.agent_runs;
  if (
    agentRunDelta.missingInDatabase.length > 0 ||
    agentRunDelta.missingInStore.length !== 1 ||
    agentRunDelta.missingInStore[0] !== agentRunId ||
    agentRunDelta.changed.length > 0
  ) {
    throw new Error("agent output invalid transaction contains unsupported agent run changes");
  }

  const notificationIds = notifications.map((row) => row.id);
  const auditIds = auditEvents.map((row) => row.id);
  const applySql = [
    "-- Native incremental agent-output-invalid transaction",
    "BEGIN;",
    "SELECT pg_advisory_xact_lock(724311);",
    renderAgentRunInsert(agentRun),
    "DO $hardware_flow$",
    "BEGIN",
    `  UPDATE work_packages SET status = ${sqlString(nextWorkPackage.status)} WHERE id = ${sqlString(workPackageId)} AND status IS NOT DISTINCT FROM ${sqlString(previousWorkPackage.status)};`,
    "  IF NOT FOUND THEN",
    "    RAISE EXCEPTION 'work package changed concurrently or work package is missing';",
    "  END IF;",
    "END;",
    "$hardware_flow$;",
    ...auditEvents.map(renderAuditInsert),
    ...notifications.map(renderNotificationInsert),
    "COMMIT;",
    "",
  ].join("\n");
  const rollbackSql = [
    "-- Compensating agent-output-invalid transaction",
    "BEGIN;",
    "SELECT pg_advisory_xact_lock(724311);",
    `DELETE FROM notifications WHERE id IN (${notificationIds.map(sqlString).join(", ")});`,
    `DELETE FROM audit_events WHERE id IN (${auditIds.map(sqlString).join(", ")});`,
    `DELETE FROM agent_runs WHERE id = ${sqlString(agentRunId)};`,
    `UPDATE work_packages SET status = ${sqlString(previousWorkPackage.status)} WHERE id = ${sqlString(workPackageId)} AND status IS NOT DISTINCT FROM ${sqlString(nextWorkPackage.status)};`,
    "COMMIT;",
    "",
  ].join("\n");

  return {
    kind: "agent-output-invalid",
    workPackageId,
    agentRunId,
    auditEventCount: auditEvents.length,
    notificationCount: notifications.length,
    applySql,
    rollbackSql,
    previousRows,
    nextRows,
  };
}

export function buildAgentOutputReadyTransaction({ previousStore, nextStore, workPackageId, agentRunId, artifactId } = {}) {
  const previousRows = mapStoreToPostgresRows(previousStore);
  const nextRows = mapStoreToPostgresRows(nextStore);
  const storeDelta = comparePostgresRows(previousRows, nextRows);
  const previousWorkPackage = previousRows.work_packages.find((row) => row.id === workPackageId);
  const nextWorkPackage = nextRows.work_packages.find((row) => row.id === workPackageId);
  if (!previousWorkPackage || !nextWorkPackage) {
    throw new Error(`work package not found for agent output ready transaction: ${workPackageId}`);
  }
  if (nextWorkPackage.status !== "AGENT_DRAFT_READY" || previousWorkPackage.status === nextWorkPackage.status) {
    throw new Error("agent output ready transaction requires work package status to change to AGENT_DRAFT_READY");
  }

  const agentRuns = insertedRows(previousRows, nextRows, "agent_runs");
  const agentRun = agentRuns.find((row) => row.id === agentRunId) || null;
  if (agentRuns.length !== 1 || !agentRun || agentRun.work_package_id !== workPackageId) {
    throw new Error("agent output ready transaction requires exactly one inserted agent run for the work package");
  }
  if (agentRun.status !== "OUTPUT_READY") {
    throw new Error("agent output ready transaction requires an OUTPUT_READY agent run");
  }

  const artifacts = insertedRows(previousRows, nextRows, "artifact_versions");
  const artifact = artifacts.find((row) => row.id === artifactId) || null;
  if (artifacts.length !== 1 || !artifact || artifact.work_package_id !== workPackageId) {
    throw new Error("agent output ready transaction requires exactly one inserted artifact for the work package");
  }
  if (artifact.status !== "PENDING_REVIEW" || !artifact.created_by_actor) {
    throw new Error("agent output ready transaction requires a PENDING_REVIEW artifact");
  }

  const notifications = insertedRows(previousRows, nextRows, "notifications");
  const auditEvents = insertedRows(previousRows, nextRows, "audit_events");
  if (auditEvents.length !== 1 || auditEvents[0].event_type !== "AGENT_OUTPUT_READY") {
    throw new Error("agent output ready transaction requires exactly one AGENT_OUTPUT_READY audit event");
  }
  if (notifications.length === 0) {
    throw new Error("agent output ready transaction requires at least one notification");
  }

  assertOnlyTablesChanged(
    storeDelta,
    ["work_packages", "agent_runs", "artifact_versions", "notifications", "audit_events"],
    "agent output ready transaction",
  );
  assertInsertedSideEffects(storeDelta, "agent output ready transaction");
  const workPackageDelta = storeDelta.tables.work_packages;
  if (
    workPackageDelta.missingInDatabase.length > 0 ||
    workPackageDelta.missingInStore.length > 0 ||
    workPackageDelta.changed.length !== 1 ||
    workPackageDelta.changed[0].id !== workPackageId ||
    workPackageDelta.changed[0].fields.join(",") !== "status"
  ) {
    throw new Error("agent output ready transaction contains unsupported work package changes");
  }
  const agentRunDelta = storeDelta.tables.agent_runs;
  if (
    agentRunDelta.missingInDatabase.length > 0 ||
    agentRunDelta.missingInStore.length !== 1 ||
    agentRunDelta.missingInStore[0] !== agentRunId ||
    agentRunDelta.changed.length > 0
  ) {
    throw new Error("agent output ready transaction contains unsupported agent run changes");
  }
  const artifactDelta = storeDelta.tables.artifact_versions;
  if (
    artifactDelta.missingInDatabase.length > 0 ||
    artifactDelta.missingInStore.length !== 1 ||
    artifactDelta.missingInStore[0] !== artifactId ||
    artifactDelta.changed.length > 0
  ) {
    throw new Error("agent output ready transaction contains unsupported artifact changes");
  }

  const notificationIds = notifications.map((row) => row.id);
  const auditIds = auditEvents.map((row) => row.id);
  const applySql = [
    "-- Native incremental agent-output-ready transaction",
    "BEGIN;",
    "SELECT pg_advisory_xact_lock(724311);",
    renderAgentRunInsert(agentRun),
    renderArtifactInsert(artifact),
    "DO $hardware_flow$",
    "BEGIN",
    `  UPDATE work_packages SET status = ${sqlString(nextWorkPackage.status)} WHERE id = ${sqlString(workPackageId)} AND status IS NOT DISTINCT FROM ${sqlString(previousWorkPackage.status)};`,
    "  IF NOT FOUND THEN",
    "    RAISE EXCEPTION 'work package changed concurrently or work package is missing';",
    "  END IF;",
    "END;",
    "$hardware_flow$;",
    ...auditEvents.map(renderAuditInsert),
    ...notifications.map(renderNotificationInsert),
    "COMMIT;",
    "",
  ].join("\n");
  const rollbackSql = [
    "-- Compensating agent-output-ready transaction",
    "BEGIN;",
    "SELECT pg_advisory_xact_lock(724311);",
    `DELETE FROM notifications WHERE id IN (${notificationIds.map(sqlString).join(", ")});`,
    `DELETE FROM audit_events WHERE id IN (${auditIds.map(sqlString).join(", ")});`,
    `DELETE FROM artifact_versions WHERE id = ${sqlString(artifactId)};`,
    `DELETE FROM agent_runs WHERE id = ${sqlString(agentRunId)};`,
    `UPDATE work_packages SET status = ${sqlString(previousWorkPackage.status)} WHERE id = ${sqlString(workPackageId)} AND status IS NOT DISTINCT FROM ${sqlString(nextWorkPackage.status)};`,
    "COMMIT;",
    "",
  ].join("\n");

  return {
    kind: "agent-output-ready",
    workPackageId,
    agentRunId,
    artifactId,
    auditEventCount: auditEvents.length,
    notificationCount: notifications.length,
    applySql,
    rollbackSql,
    previousRows,
    nextRows,
  };
}

export function buildHumanReviewTransaction({ previousStore, nextStore, workPackageId, artifactId, reviewId } = {}) {
  const previousRows = mapStoreToPostgresRows(previousStore);
  const nextRows = mapStoreToPostgresRows(nextStore);
  const storeDelta = comparePostgresRows(previousRows, nextRows);
  const previousWorkPackage = previousRows.work_packages.find((row) => row.id === workPackageId);
  const nextWorkPackage = nextRows.work_packages.find((row) => row.id === workPackageId);
  const previousArtifact = previousRows.artifact_versions.find((row) => row.id === artifactId);
  const nextArtifact = nextRows.artifact_versions.find((row) => row.id === artifactId);
  if (!previousWorkPackage || !nextWorkPackage) {
    throw new Error(`work package not found for incremental transaction: ${workPackageId}`);
  }
  if (!previousArtifact || !nextArtifact) {
    throw new Error(`artifact not found for incremental transaction: ${artifactId}`);
  }

  const reviews = insertedRows(previousRows, nextRows, "reviews");
  const review = reviews.find((row) => row.id === reviewId) || null;
  if (reviews.length !== 1 || !review) {
    throw new Error("human review transaction requires exactly one inserted review");
  }
  const notifications = insertedRows(previousRows, nextRows, "notifications");
  const auditEvents = insertedRows(previousRows, nextRows, "audit_events");
  if (auditEvents.length !== 1 || auditEvents[0].event_type !== "HUMAN_REVIEW_SUBMITTED") {
    throw new Error("human review transaction requires exactly one HUMAN_REVIEW_SUBMITTED audit event");
  }
  if (notifications.length === 0) {
    throw new Error("human review transaction requires at least one notification");
  }

  assertOnlyTablesChanged(
    storeDelta,
    ["work_packages", "artifact_versions", "reviews", "notifications", "audit_events"],
    "human review transaction",
  );
  assertInsertedSideEffects(storeDelta, "human review transaction");

  const reviewDelta = storeDelta.tables.reviews;
  if (
    reviewDelta.missingInDatabase.length > 0 ||
    reviewDelta.missingInStore.length !== 1 ||
    reviewDelta.missingInStore[0] !== reviewId ||
    reviewDelta.changed.length > 0
  ) {
    throw new Error("human review transaction contains unsupported review changes");
  }

  const workPackageDelta = storeDelta.tables.work_packages;
  if (
    workPackageDelta.missingInDatabase.length > 0 ||
    workPackageDelta.missingInStore.length > 0 ||
    workPackageDelta.changed.length !== 1 ||
    workPackageDelta.changed[0].id !== workPackageId ||
    workPackageDelta.changed[0].fields.join(",") !== "status"
  ) {
    throw new Error("human review transaction contains unsupported work package changes");
  }

  const artifactDelta = storeDelta.tables.artifact_versions;
  if (
    artifactDelta.missingInDatabase.length > 0 ||
    artifactDelta.missingInStore.length > 0 ||
    artifactDelta.changed.length !== 1 ||
    artifactDelta.changed[0].id !== artifactId
  ) {
    throw new Error("human review transaction contains unsupported artifact changes");
  }
  const artifactFields = artifactDelta.changed[0].fields;
  const unsupportedArtifactFields = artifactFields.filter((field) => !new Set(["status", "version"]).has(field));
  if (unsupportedArtifactFields.length > 0) {
    throw new Error(`human review transaction contains unsupported artifact fields: ${unsupportedArtifactFields.join(", ")}`);
  }

  const notificationIds = notifications.map((row) => row.id);
  const auditIds = auditEvents.map((row) => row.id);
  const applySql = [
    "-- Native incremental human-review transaction",
    "BEGIN;",
    "SELECT pg_advisory_xact_lock(724311);",
    "DO $hardware_flow$",
    "BEGIN",
    `  UPDATE work_packages SET status = ${sqlString(nextWorkPackage.status)} WHERE id = ${sqlString(workPackageId)} AND status = ${sqlString(previousWorkPackage.status)};`,
    "  IF NOT FOUND THEN",
    "    RAISE EXCEPTION 'work package status changed concurrently or work package is missing';",
    "  END IF;",
    `  UPDATE artifact_versions SET ${artifactFields.map((field) => `${field} = ${sqlValue(nextArtifact[field])}`).join(", ")} WHERE id = ${sqlString(artifactId)} AND ${artifactFields.map((field) => `${field} IS NOT DISTINCT FROM ${sqlValue(previousArtifact[field])}`).join(" AND ")};`,
    "  IF NOT FOUND THEN",
    "    RAISE EXCEPTION 'artifact version changed concurrently or artifact is missing';",
    "  END IF;",
    "END;",
    "$hardware_flow$;",
    renderReviewInsert(review),
    ...auditEvents.map(renderAuditInsert),
    ...notifications.map(renderNotificationInsert),
    "COMMIT;",
    "",
  ].join("\n");
  const rollbackSql = [
    "-- Compensating human-review transaction",
    "BEGIN;",
    "SELECT pg_advisory_xact_lock(724311);",
    `DELETE FROM notifications WHERE id IN (${notificationIds.map(sqlString).join(", ")});`,
    `DELETE FROM audit_events WHERE id IN (${auditIds.map(sqlString).join(", ")});`,
    `DELETE FROM reviews WHERE id = ${sqlString(reviewId)};`,
    `UPDATE artifact_versions SET ${artifactFields.map((field) => `${field} = ${sqlValue(previousArtifact[field])}`).join(", ")} WHERE id = ${sqlString(artifactId)} AND ${artifactFields.map((field) => `${field} IS NOT DISTINCT FROM ${sqlValue(nextArtifact[field])}`).join(" AND ")};`,
    `UPDATE work_packages SET status = ${sqlString(previousWorkPackage.status)} WHERE id = ${sqlString(workPackageId)} AND status = ${sqlString(nextWorkPackage.status)};`,
    "COMMIT;",
    "",
  ].join("\n");

  return {
    kind: "human-review-submit",
    workPackageId,
    artifactId,
    reviewId,
    changedArtifactFields: artifactFields,
    auditEventCount: auditEvents.length,
    notificationCount: notifications.length,
    applySql,
    rollbackSql,
    previousRows,
    nextRows,
  };
}

export function buildConditionalApprovalCompletionTransaction({ previousStore, nextStore, reviewId } = {}) {
  const previousRows = mapStoreToPostgresRows(previousStore);
  const nextRows = mapStoreToPostgresRows(nextStore);
  const storeDelta = comparePostgresRows(previousRows, nextRows);
  const previousReview = previousRows.reviews.find((row) => row.id === reviewId);
  const nextReview = nextRows.reviews.find((row) => row.id === reviewId);
  if (!previousReview || !nextReview) {
    throw new Error(`review not found for incremental transaction: ${reviewId}`);
  }
  if (previousReview.decision !== "APPROVE_WITH_CONDITIONS") {
    throw new Error("conditional approval completion transaction requires an APPROVE_WITH_CONDITIONS review");
  }
  if (!nextReview.conditions_completed_at || !nextReview.conditions_completed_by_user_id) {
    throw new Error("conditional approval completion transaction requires completion metadata");
  }

  const notifications = insertedRows(previousRows, nextRows, "notifications");
  const auditEvents = insertedRows(previousRows, nextRows, "audit_events");
  if (auditEvents.length !== 1 || auditEvents[0].event_type !== "CONDITIONAL_APPROVAL_COMPLETED") {
    throw new Error("conditional approval completion transaction requires exactly one CONDITIONAL_APPROVAL_COMPLETED audit event");
  }
  if (notifications.length === 0) {
    throw new Error("conditional approval completion transaction requires at least one notification");
  }

  assertOnlyTablesChanged(storeDelta, ["reviews", "notifications", "audit_events"], "conditional approval completion transaction");
  assertInsertedSideEffects(storeDelta, "conditional approval completion transaction");
  assertNoRowAddsOrDeletes(storeDelta, "reviews", "conditional approval completion");
  const reviewChanged = changedRowForId(storeDelta, "reviews", reviewId, "conditional approval completion");
  const allowedFields = new Set(["conditions_completed_at", "conditions_completed_by_user_id", "conditions_completion_comment"]);
  const unsupportedFields = reviewChanged.fields.filter((field) => !allowedFields.has(field));
  if (unsupportedFields.length > 0) {
    throw new Error(`conditional approval completion transaction contains unsupported review fields: ${unsupportedFields.join(", ")}`);
  }
  if (reviewChanged.fields.length === 0) {
    throw new Error(`conditional approval completion transaction did not change review fields: ${reviewId}`);
  }

  const notificationIds = notifications.map((row) => row.id);
  const auditIds = auditEvents.map((row) => row.id);
  const applySql = [
    "-- Native incremental conditional-approval-complete transaction",
    "BEGIN;",
    "SELECT pg_advisory_xact_lock(724311);",
    "DO $hardware_flow$",
    "BEGIN",
    `  UPDATE reviews SET ${renderUpdateSet(nextReview, reviewChanged.fields)} WHERE id = ${sqlString(reviewId)} AND ${renderPreviousConditions(previousReview, reviewChanged.fields)};`,
    "  IF NOT FOUND THEN",
    "    RAISE EXCEPTION 'review completion state changed concurrently or review is missing';",
    "  END IF;",
    "END;",
    "$hardware_flow$;",
    ...auditEvents.map(renderAuditInsert),
    ...notifications.map(renderNotificationInsert),
    "COMMIT;",
    "",
  ].join("\n");
  const rollbackSql = [
    "-- Compensating conditional-approval-complete transaction",
    "BEGIN;",
    "SELECT pg_advisory_xact_lock(724311);",
    `DELETE FROM notifications WHERE id IN (${notificationIds.map(sqlString).join(", ")});`,
    `DELETE FROM audit_events WHERE id IN (${auditIds.map(sqlString).join(", ")});`,
    `UPDATE reviews SET ${renderUpdateSet(previousReview, reviewChanged.fields)} WHERE id = ${sqlString(reviewId)} AND ${renderPreviousConditions(nextReview, reviewChanged.fields)};`,
    "COMMIT;",
    "",
  ].join("\n");

  return {
    kind: "conditional-approval-complete",
    reviewId,
    changedReviewFields: reviewChanged.fields,
    auditEventCount: auditEvents.length,
    notificationCount: notifications.length,
    applySql,
    rollbackSql,
    previousRows,
    nextRows,
  };
}

export function buildWorkPackageEvidenceTransaction({ previousStore, nextStore, workPackageId, evidenceRefId } = {}) {
  const previousRows = mapStoreToPostgresRows(previousStore);
  const nextRows = mapStoreToPostgresRows(nextStore);
  const storeDelta = comparePostgresRows(previousRows, nextRows);
  const workPackage = nextRows.work_packages.find((row) => row.id === workPackageId);
  if (!workPackage) {
    throw new Error(`work package not found for incremental transaction: ${workPackageId}`);
  }

  const evidenceRefs = insertedRows(previousRows, nextRows, "work_package_evidence_refs");
  const evidenceRef = evidenceRefs.find((row) => row.id === evidenceRefId) || null;
  if (evidenceRefs.length !== 1 || !evidenceRef || evidenceRef.work_package_id !== workPackageId) {
    throw new Error("work package evidence transaction requires exactly one inserted evidence ref");
  }

  const auditEvents = insertedRows(previousRows, nextRows, "audit_events");
  const allowedAuditTypes = new Set(["WORK_PACKAGE_EVIDENCE_ADDED", "WORK_PACKAGE_EVIDENCE_FILE_UPLOADED"]);
  if (auditEvents.length !== 1 || !allowedAuditTypes.has(auditEvents[0].event_type)) {
    throw new Error("work package evidence transaction requires exactly one evidence audit event");
  }

  assertOnlyTablesChanged(storeDelta, ["work_package_evidence_refs", "audit_events"], "work package evidence transaction");
  assertInsertedSideEffects(storeDelta, "work package evidence transaction");
  const evidenceDelta = storeDelta.tables.work_package_evidence_refs;
  if (
    evidenceDelta.missingInDatabase.length > 0 ||
    evidenceDelta.missingInStore.length !== 1 ||
    evidenceDelta.missingInStore[0] !== evidenceRefId ||
    evidenceDelta.changed.length > 0
  ) {
    throw new Error("work package evidence transaction contains unsupported evidence ref changes");
  }

  const auditIds = auditEvents.map((row) => row.id);
  const applySql = [
    "-- Native incremental work-package evidence transaction",
    "BEGIN;",
    "SELECT pg_advisory_xact_lock(724311);",
    renderEvidenceRefInsert(evidenceRef),
    ...auditEvents.map(renderAuditInsert),
    "COMMIT;",
    "",
  ].join("\n");
  const rollbackSql = [
    "-- Compensating work-package evidence transaction",
    "BEGIN;",
    "SELECT pg_advisory_xact_lock(724311);",
    `DELETE FROM audit_events WHERE id IN (${auditIds.map(sqlString).join(", ")});`,
    `DELETE FROM work_package_evidence_refs WHERE id = ${sqlString(evidenceRefId)};`,
    "COMMIT;",
    "",
  ].join("\n");

  return {
    kind: "work-package-evidence-add",
    workPackageId,
    evidenceRefId,
    auditEventCount: auditEvents.length,
    notificationCount: 0,
    applySql,
    rollbackSql,
    previousRows,
    nextRows,
  };
}

export function buildGateApprovalTransaction({ previousStore, nextStore, gateId, approvalPackId } = {}) {
  const previousRows = mapStoreToPostgresRows(previousStore);
  const nextRows = mapStoreToPostgresRows(nextStore);
  const storeDelta = comparePostgresRows(previousRows, nextRows);
  const previousGate = previousRows.gates.find((row) => row.id === gateId);
  const nextGate = nextRows.gates.find((row) => row.id === gateId);
  if (!previousGate || !nextGate) {
    throw new Error(`gate not found for incremental transaction: ${gateId}`);
  }
  const previousPhase = previousRows.phases.find((row) => row.id === previousGate.phase_id);
  const nextPhase = nextRows.phases.find((row) => row.id === previousGate.phase_id);
  const previousProject = previousRows.projects.find((row) => row.id === previousGate.project_id);
  const nextProject = nextRows.projects.find((row) => row.id === previousGate.project_id);
  if (!previousPhase || !nextPhase || !previousProject || !nextProject) {
    throw new Error(`gate approval graph is incomplete for incremental transaction: ${gateId}`);
  }

  const approvalPacks = insertedRows(previousRows, nextRows, "gate_approval_packs");
  const approvalPack = approvalPacks.find((row) => row.id === approvalPackId) || null;
  if (approvalPacks.length !== 1 || !approvalPack) {
    throw new Error("gate approval transaction requires exactly one inserted approval pack");
  }
  const notifications = insertedRows(previousRows, nextRows, "notifications");
  const auditEvents = insertedRows(previousRows, nextRows, "audit_events");
  if (auditEvents.length !== 1 || auditEvents[0].event_type !== "GATE_APPROVED") {
    throw new Error("gate approval transaction requires exactly one GATE_APPROVED audit event");
  }
  if (notifications.length === 0) {
    throw new Error("gate approval transaction requires at least one notification");
  }

  assertOnlyTablesChanged(
    storeDelta,
    ["projects", "phases", "gates", "gate_approval_packs", "notifications", "audit_events"],
    "gate approval",
  );
  assertInsertedSideEffects(storeDelta, "gate approval");
  assertNoRowAddsOrDeletes(storeDelta, "projects", "gate approval");
  assertNoRowAddsOrDeletes(storeDelta, "phases", "gate approval");
  assertNoRowAddsOrDeletes(storeDelta, "gates", "gate approval");

  const approvalPackDelta = storeDelta.tables.gate_approval_packs;
  if (
    approvalPackDelta.missingInDatabase.length > 0 ||
    approvalPackDelta.missingInStore.length !== 1 ||
    approvalPackDelta.missingInStore[0] !== approvalPackId ||
    approvalPackDelta.changed.length > 0
  ) {
    throw new Error("gate approval transaction contains unsupported approval pack changes");
  }

  const gateChanged = changedRowForId(storeDelta, "gates", gateId, "gate approval");
  const gateFields = gateChanged.fields;
  const allowedGateFields = new Set(["status", "approved_by_user_id", "approved_at", "approval_comment"]);
  const unsupportedGateFields = gateFields.filter((field) => !allowedGateFields.has(field));
  if (unsupportedGateFields.length > 0) {
    throw new Error(`gate approval transaction contains unsupported gate fields: ${unsupportedGateFields.join(", ")}`);
  }

  const currentPhaseChanged = changedRowForId(storeDelta, "phases", previousPhase.id, "gate approval");
  if (currentPhaseChanged.fields.join(",") !== "status") {
    throw new Error("gate approval transaction contains unsupported current phase changes");
  }

  const projectChanged = changedRowForId(storeDelta, "projects", previousProject.id, "gate approval");
  const allowedProjectFields = new Set(["current_phase_id", "status"]);
  const unsupportedProjectFields = projectChanged.fields.filter((field) => !allowedProjectFields.has(field));
  if (unsupportedProjectFields.length > 0) {
    throw new Error(`gate approval transaction contains unsupported project fields: ${unsupportedProjectFields.join(", ")}`);
  }

  const phaseChanges = storeDelta.tables.phases.changed;
  const gateChanges = storeDelta.tables.gates.changed;
  const nextPhaseChange = phaseChanges.find((row) => row.id !== previousPhase.id) || null;
  const nextGateChange = gateChanges.find((row) => row.id !== gateId) || null;
  if (nextPhaseChange && nextPhaseChange.fields.join(",") !== "status") {
    throw new Error("gate approval transaction contains unsupported next phase changes");
  }
  if (nextGateChange && nextGateChange.fields.join(",") !== "status") {
    throw new Error("gate approval transaction contains unsupported next gate changes");
  }
  if (phaseChanges.length > (nextPhaseChange ? 2 : 1)) {
    throw new Error("gate approval transaction contains unsupported phase changes");
  }
  if (gateChanges.length > (nextGateChange ? 2 : 1)) {
    throw new Error("gate approval transaction contains unsupported gate changes");
  }

  const notificationIds = notifications.map((row) => row.id);
  const auditIds = auditEvents.map((row) => row.id);
  const previousByTable = {
    projects: new Map(previousRows.projects.map((row) => [row.id, row])),
    phases: new Map(previousRows.phases.map((row) => [row.id, row])),
    gates: new Map(previousRows.gates.map((row) => [row.id, row])),
  };
  const nextByTable = {
    projects: new Map(nextRows.projects.map((row) => [row.id, row])),
    phases: new Map(nextRows.phases.map((row) => [row.id, row])),
    gates: new Map(nextRows.gates.map((row) => [row.id, row])),
  };
  const changedRowSql = (table, id, fields, rowsByTable) => [
    `  UPDATE ${table} SET ${renderUpdateSet(rowsByTable[table].get(id), fields)} WHERE id = ${sqlString(id)} AND ${renderPreviousConditions(previousByTable[table].get(id), fields)};`,
    "  IF NOT FOUND THEN",
    `    RAISE EXCEPTION '${table} changed concurrently or row is missing: ${id}';`,
    "  END IF;",
  ].join("\n");
  const rollbackRowSql = (table, id, fields) =>
    `UPDATE ${table} SET ${renderUpdateSet(previousByTable[table].get(id), fields)} WHERE id = ${sqlString(id)} AND ${renderPreviousConditions(nextByTable[table].get(id), fields)};`;

  const applySql = [
    "-- Native incremental gate-approval transaction",
    "BEGIN;",
    "SELECT pg_advisory_xact_lock(724311);",
    "DO $hardware_flow$",
    "BEGIN",
    changedRowSql("gates", gateId, gateFields, nextByTable),
    changedRowSql("phases", previousPhase.id, currentPhaseChanged.fields, nextByTable),
    ...(nextPhaseChange ? [changedRowSql("phases", nextPhaseChange.id, nextPhaseChange.fields, nextByTable)] : []),
    changedRowSql("projects", previousProject.id, projectChanged.fields, nextByTable),
    ...(nextGateChange ? [changedRowSql("gates", nextGateChange.id, nextGateChange.fields, nextByTable)] : []),
    "END;",
    "$hardware_flow$;",
    renderGateApprovalPackInsert(approvalPack),
    ...auditEvents.map(renderAuditInsert),
    ...notifications.map(renderNotificationInsert),
    "COMMIT;",
    "",
  ].join("\n");
  const rollbackSql = [
    "-- Compensating gate-approval transaction",
    "BEGIN;",
    "SELECT pg_advisory_xact_lock(724311);",
    `DELETE FROM notifications WHERE id IN (${notificationIds.map(sqlString).join(", ")});`,
    `DELETE FROM audit_events WHERE id IN (${auditIds.map(sqlString).join(", ")});`,
    `DELETE FROM gate_approval_packs WHERE id = ${sqlString(approvalPackId)};`,
    ...(nextGateChange ? [rollbackRowSql("gates", nextGateChange.id, nextGateChange.fields)] : []),
    rollbackRowSql("projects", previousProject.id, projectChanged.fields),
    ...(nextPhaseChange ? [rollbackRowSql("phases", nextPhaseChange.id, nextPhaseChange.fields)] : []),
    rollbackRowSql("phases", previousPhase.id, currentPhaseChanged.fields),
    rollbackRowSql("gates", gateId, gateFields),
    "COMMIT;",
    "",
  ].join("\n");

  return {
    kind: "gate-approval",
    gateId,
    approvalPackId,
    changedProjectFields: projectChanged.fields,
    changedGateIds: gateChanges.map((row) => row.id),
    changedPhaseIds: phaseChanges.map((row) => row.id),
    auditEventCount: auditEvents.length,
    notificationCount: notifications.length,
    applySql,
    rollbackSql,
    previousRows,
    nextRows,
  };
}

export function executePostgresIncrementalTransaction({
  previousStore,
  nextStore,
  mutation,
  databaseUrl = process.env.DATABASE_URL || "",
  outputDir = "data/runtime-postgres-sync",
  runner = runPsqlFile,
  queryRunner,
} = {}) {
  if (!databaseUrl) {
    return { ok: false, mode: "INCREMENTAL_TRANSACTION", errors: ["DATABASE_URL is required"], execution: null, verification: null, compensation: null };
  }
  let transaction;
  try {
    if (mutation?.kind === "role-pair-owner-update") {
      transaction = buildRolePairOwnerTransaction({ previousStore, nextStore, rolePairId: mutation.rolePairId });
    } else if (mutation?.kind === "work-package-schedule-update") {
      transaction = buildWorkPackageScheduleTransaction({ previousStore, nextStore, workPackageId: mutation.workPackageId });
    } else if (mutation?.kind === "work-package-evidence-add") {
      transaction = buildWorkPackageEvidenceTransaction({
        previousStore,
        nextStore,
        workPackageId: mutation.workPackageId,
        evidenceRefId: mutation.evidenceRefId,
      });
    } else if (mutation?.kind === "notification-read") {
      transaction = buildNotificationReadTransaction({ previousStore, nextStore, notificationId: mutation.notificationId });
    } else if (mutation?.kind === "project-notifications-read") {
      transaction = buildProjectNotificationsReadTransaction({
        previousStore,
        nextStore,
        projectId: mutation.projectId,
        userId: mutation.userId,
      });
    } else if (mutation?.kind === "risk-create") {
      transaction = buildRiskCreateTransaction({ previousStore, nextStore, riskId: mutation.riskId });
    } else if (mutation?.kind?.startsWith("risk-")) {
      transaction = buildRiskTransaction({ previousStore, nextStore, riskId: mutation.riskId, kind: mutation.kind });
    } else if (mutation?.kind === "agent-job-queue") {
      transaction = buildAgentJobQueueTransaction({ previousStore, nextStore, agentJobId: mutation.agentJobId });
    } else if (mutation?.kind === "agent-output-invalid") {
      transaction = buildAgentOutputInvalidTransaction({
        previousStore,
        nextStore,
        workPackageId: mutation.workPackageId,
        agentRunId: mutation.agentRunId,
      });
    } else if (mutation?.kind === "agent-output-ready") {
      transaction = buildAgentOutputReadyTransaction({
        previousStore,
        nextStore,
        workPackageId: mutation.workPackageId,
        agentRunId: mutation.agentRunId,
        artifactId: mutation.artifactId,
      });
    } else if (mutation?.kind === "human-review-submit") {
      transaction = buildHumanReviewTransaction({
        previousStore,
        nextStore,
        workPackageId: mutation.workPackageId,
        artifactId: mutation.artifactId,
        reviewId: mutation.reviewId,
      });
    } else if (mutation?.kind === "conditional-approval-complete") {
      transaction = buildConditionalApprovalCompletionTransaction({ previousStore, nextStore, reviewId: mutation.reviewId });
    } else if (mutation?.kind === "gate-approval") {
      transaction = buildGateApprovalTransaction({
        previousStore,
        nextStore,
        gateId: mutation.gateId,
        approvalPackId: mutation.approvalPackId,
      });
    } else {
      throw new Error(`unsupported incremental mutation: ${mutation?.kind || "missing"}`);
    }
  } catch (error) {
    return { ok: false, mode: "INCREMENTAL_TRANSACTION", errors: [error instanceof Error ? error.message : String(error)], execution: null, verification: null, compensation: null };
  }

  const resolvedOutputDir = path.resolve(outputDir);
  fs.mkdirSync(resolvedOutputDir, { recursive: true });
  const sqlPath = path.join(resolvedOutputDir, "runtime-incremental-transaction.sql");
  const rollbackSqlPath = path.join(resolvedOutputDir, "runtime-incremental-compensation.sql");
  fs.writeFileSync(sqlPath, transaction.applySql);
  fs.writeFileSync(rollbackSqlPath, transaction.rollbackSql);
  const execution = executionSummary(runner(databaseUrl, sqlPath), databaseUrl);
  if (!execution.ok) {
    return { ok: false, mode: "INCREMENTAL_TRANSACTION", errors: [execution.error || execution.stderr || "incremental transaction failed"], sqlPath, execution, verification: null, compensation: null };
  }

  const database = readPostgresDatabaseRows({ databaseUrl, ...(queryRunner ? { runner: queryRunner } : {}) });
  const comparison = database.ok ? comparePostgresRows(transaction.nextRows, database.rows) : null;
  if (database.ok && comparison.inSync) {
    return {
      ok: true,
      mode: "INCREMENTAL_TRANSACTION",
      mutation: {
        kind: transaction.kind,
        ...(transaction.rolePairId ? { rolePairId: transaction.rolePairId } : {}),
        ...(transaction.workPackageId ? { workPackageId: transaction.workPackageId } : {}),
        ...(transaction.evidenceRefId ? { evidenceRefId: transaction.evidenceRefId } : {}),
        ...(transaction.notificationId ? { notificationId: transaction.notificationId } : {}),
        ...(transaction.notificationIds ? { notificationIds: transaction.notificationIds } : {}),
        ...(transaction.riskId ? { riskId: transaction.riskId } : {}),
        ...(transaction.agentJobId ? { agentJobId: transaction.agentJobId } : {}),
        ...(transaction.agentRunId ? { agentRunId: transaction.agentRunId } : {}),
        ...(transaction.projectId ? { projectId: transaction.projectId } : {}),
        ...(transaction.userId ? { userId: transaction.userId } : {}),
        ...(transaction.artifactId ? { artifactId: transaction.artifactId } : {}),
        ...(transaction.reviewId ? { reviewId: transaction.reviewId } : {}),
        ...(transaction.gateId ? { gateId: transaction.gateId } : {}),
        ...(transaction.approvalPackId ? { approvalPackId: transaction.approvalPackId } : {}),
      },
      counts: { auditEvents: transaction.auditEventCount, notifications: transaction.notificationCount },
      errors: [],
      sqlPath,
      execution,
      verification: { ok: true, comparison, execution: database.execution },
      compensation: null,
    };
  }

  const compensationExecution = executionSummary(runner(databaseUrl, rollbackSqlPath), databaseUrl);
  const rollbackDatabase = compensationExecution.ok
    ? readPostgresDatabaseRows({ databaseUrl, ...(queryRunner ? { runner: queryRunner } : {}) })
    : null;
  const rollbackComparison = rollbackDatabase?.ok
    ? comparePostgresRows(transaction.previousRows, rollbackDatabase.rows)
    : null;
  const compensation = {
    ok: compensationExecution.ok && rollbackDatabase?.ok === true && rollbackComparison?.inSync === true,
    sqlPath: rollbackSqlPath,
    execution: compensationExecution,
    verification: rollbackComparison ? { ok: rollbackComparison.inSync, comparison: rollbackComparison } : null,
  };
  return {
    ok: false,
    mode: "INCREMENTAL_TRANSACTION",
    errors: database.ok ? ["PostgreSQL incremental transaction verification drifted"] : database.errors,
    sqlPath,
    execution,
    verification: comparison ? { ok: false, comparison } : { ok: false, comparison: null, execution: database.execution },
    compensation,
  };
}
