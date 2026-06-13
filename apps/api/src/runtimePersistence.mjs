import path from "node:path";
import { saveStoreToDisk } from "./persistence.mjs";
import { synchronizeStoreToPostgres } from "./postgresStoreSync.mjs";

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

export function createRuntimePersistence({
  initialStore,
  backend = process.env.HARDWARE_FLOW_RUNTIME_PERSISTENCE_BACKEND || "json",
  databaseUrl = process.env.DATABASE_URL || "",
  outputDir = process.env.HARDWARE_FLOW_RUNTIME_POSTGRES_SYNC_DIR || "data/runtime-postgres-sync",
  saveStore = saveStoreToDisk,
  synchronize = synchronizeStoreToPostgres,
} = {}) {
  const normalizedBackend = normalizeRuntimePersistenceBackend(backend);
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
