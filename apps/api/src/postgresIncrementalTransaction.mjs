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
    } else if (mutation?.kind?.startsWith("risk-")) {
      transaction = buildRiskTransaction({ previousStore, nextStore, riskId: mutation.riskId, kind: mutation.kind });
    } else if (mutation?.kind === "human-review-submit") {
      transaction = buildHumanReviewTransaction({
        previousStore,
        nextStore,
        workPackageId: mutation.workPackageId,
        artifactId: mutation.artifactId,
        reviewId: mutation.reviewId,
      });
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
        ...(transaction.riskId ? { riskId: transaction.riskId } : {}),
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
