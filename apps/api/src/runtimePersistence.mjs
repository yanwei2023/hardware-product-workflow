import path from "node:path";
import { saveStoreToDisk } from "./persistence.mjs";
import { readPostgresDatabaseRows } from "./postgresDatabaseReader.mjs";
import { mapStoreToPostgresRows } from "./postgresMapper.mjs";
import { comparePostgresRows } from "./postgresStoreComparison.mjs";
import { synchronizeStoreToPostgres } from "./postgresStoreSync.mjs";
import { validateStoreObject } from "./storeDoctor.mjs";

export const runtimePersistenceBackends = ["json", "postgres-mirror"];

export function normalizeRuntimePersistenceBackend(value = "json") {
  const backend = String(value || "json").trim().toLowerCase();
  if (!runtimePersistenceBackends.includes(backend)) {
    throw new Error(
      `HARDWARE_FLOW_RUNTIME_PERSISTENCE_BACKEND must be one of: ${runtimePersistenceBackends.join(", ")}`,
    );
  }
  return backend;
}

function cloneStore(store) {
  return structuredClone(store);
}

export class RuntimePersistenceError extends Error {
  constructor(message, { cause, syncResult } = {}) {
    super(message, { cause });
    this.name = "RuntimePersistenceError";
    this.statusCode = 503;
    this.code = "RUNTIME_PERSISTENCE_FAILED";
    this.syncResult = syncResult || null;
  }
}

export class RuntimePersistenceStartupError extends Error {
  constructor(errors) {
    super(`PostgreSQL runtime mirror startup check failed: ${errors.join("; ")}`);
    this.name = "RuntimePersistenceStartupError";
    this.code = "RUNTIME_PERSISTENCE_STARTUP_FAILED";
    this.errors = errors;
  }
}

export function checkRuntimePersistenceStartup({
  initialStore,
  backend = process.env.HARDWARE_FLOW_RUNTIME_PERSISTENCE_BACKEND || "json",
  databaseUrl = process.env.DATABASE_URL || "",
  databaseReader = readPostgresDatabaseRows,
  checkedAt = new Date(),
} = {}) {
  const normalizedBackend = normalizeRuntimePersistenceBackend(backend);
  const checkedAtIso = checkedAt instanceof Date ? checkedAt.toISOString() : String(checkedAt);
  if (normalizedBackend === "json") {
    return {
      required: false,
      ready: true,
      checkedAt: checkedAtIso,
      inSync: null,
      summary: null,
      errors: [],
    };
  }
  if (!databaseUrl) {
    return {
      required: true,
      ready: false,
      checkedAt: checkedAtIso,
      inSync: false,
      summary: null,
      errors: ["DATABASE_URL is required for PostgreSQL runtime mirroring"],
    };
  }

  const storeErrors = validateStoreObject(initialStore);
  if (storeErrors.length > 0) {
    return {
      required: true,
      ready: false,
      checkedAt: checkedAtIso,
      inSync: false,
      summary: null,
      errors: storeErrors,
    };
  }

  let expectedRows;
  try {
    expectedRows = mapStoreToPostgresRows(initialStore);
  } catch (error) {
    return {
      required: true,
      ready: false,
      checkedAt: checkedAtIso,
      inSync: false,
      summary: null,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
  let database;
  try {
    database = databaseReader({ databaseUrl });
  } catch (error) {
    return {
      required: true,
      ready: false,
      checkedAt: checkedAtIso,
      inSync: false,
      summary: null,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
  if (!database.ok) {
    return {
      required: true,
      ready: false,
      checkedAt: checkedAtIso,
      inSync: false,
      summary: null,
      errors: database.errors,
    };
  }

  const comparison = comparePostgresRows(expectedRows, database.rows);
  return {
    required: true,
    ready: comparison.inSync,
    checkedAt: checkedAtIso,
    inSync: comparison.inSync,
    summary: comparison.summary,
    errors: comparison.inSync ? [] : ["JSON runtime store and PostgreSQL are not in sync"],
  };
}

export function createRuntimePersistence({
  initialStore,
  backend = process.env.HARDWARE_FLOW_RUNTIME_PERSISTENCE_BACKEND || "json",
  databaseUrl = process.env.DATABASE_URL || "",
  outputDir = process.env.HARDWARE_FLOW_RUNTIME_POSTGRES_SYNC_DIR || "data/runtime-postgres-sync",
  saveStore = saveStoreToDisk,
  synchronize = synchronizeStoreToPostgres,
  databaseReader = readPostgresDatabaseRows,
  startupChecker = checkRuntimePersistenceStartup,
} = {}) {
  const normalizedBackend = normalizeRuntimePersistenceBackend(backend);
  const startupCheck = startupChecker({
    initialStore,
    backend: normalizedBackend,
    databaseUrl,
    databaseReader,
  });
  if (!startupCheck.ready) {
    throw new RuntimePersistenceStartupError(startupCheck.errors);
  }
  let committedStore = cloneStore(initialStore);
  let lastPersistedAt = null;
  let lastPostgresSyncAt = null;
  let lastError = null;
  let postgresSyncFailureCount = 0;

  function status() {
    return {
      backend: normalizedBackend,
      postgresMirrorEnabled: normalizedBackend === "postgres-mirror",
      outputDir: normalizedBackend === "postgres-mirror" ? path.resolve(outputDir) : null,
      databaseConfigured: Boolean(databaseUrl),
      lastPersistedAt,
      lastPostgresSyncAt,
      lastError,
      postgresSyncFailureCount,
      startupCheck,
    };
  }

  function persist(nextStore, { persistedAt = new Date() } = {}) {
    const persistedAtIso = persistedAt instanceof Date ? persistedAt.toISOString() : String(persistedAt);
    saveStore(nextStore);

    if (normalizedBackend === "postgres-mirror") {
      let syncResult;
      try {
        syncResult = synchronize({
          store: nextStore,
          databaseUrl,
          outputDir,
          confirm: true,
        });
      } catch (error) {
        syncResult = { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
      }

      if (!syncResult?.ok) {
        postgresSyncFailureCount += 1;
        lastError = (syncResult?.errors || ["PostgreSQL mirror synchronization failed"]).join("; ");
        try {
          saveStore(committedStore, { backup: false });
        } catch (rollbackError) {
          lastError = `${lastError}; JSON rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`;
        }
        throw new RuntimePersistenceError("PostgreSQL 镜像写入失败，运行时修改已回滚", { syncResult });
      }
      lastPostgresSyncAt = persistedAtIso;
    }

    committedStore = cloneStore(nextStore);
    lastPersistedAt = persistedAtIso;
    lastError = null;
    return status();
  }

  return {
    backend: normalizedBackend,
    persist,
    getCommittedStore: () => cloneStore(committedStore),
    getStatus: status,
  };
}
