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

function insertedRows(previousRows, nextRows, table) {
  const previousIds = new Set((previousRows[table] || []).map((row) => row.id));
  return (nextRows[table] || []).filter((row) => !previousIds.has(row.id));
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
  const allowedDriftTables = new Set(["role_pairs", "notifications", "audit_events"]);
  const unexpectedDriftTables = Object.entries(storeDelta.tables)
    .filter(([table, detail]) => !allowedDriftTables.has(table) && !detail.inSync)
    .map(([table]) => table);
  if (unexpectedDriftTables.length > 0) {
    throw new Error(`role pair owner transaction contains unrelated store changes: ${unexpectedDriftTables.join(", ")}`);
  }
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
  for (const table of ["notifications", "audit_events"]) {
    const detail = storeDelta.tables[table];
    if (detail.missingInDatabase.length > 0 || detail.changed.length > 0) {
      throw new Error(`role pair owner transaction contains unsupported ${table} changes`);
    }
  }

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
    "END",
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
    if (mutation?.kind !== "role-pair-owner-update") {
      throw new Error(`unsupported incremental mutation: ${mutation?.kind || "missing"}`);
    }
    transaction = buildRolePairOwnerTransaction({ previousStore, nextStore, rolePairId: mutation.rolePairId });
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
      mutation: { kind: transaction.kind, rolePairId: transaction.rolePairId },
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
