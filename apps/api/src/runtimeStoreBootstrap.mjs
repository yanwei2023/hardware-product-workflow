import { readPostgresDatabaseRows } from "./postgresDatabaseReader.mjs";
import { mapPostgresRowsToStore } from "./postgresMapper.mjs";
import { validateStoreObject } from "./storeDoctor.mjs";

export const runtimeStoreSourceModes = ["json", "postgres", "postgres-fallback"];

export function normalizeRuntimeStoreSource(value = "json") {
  const mode = String(value || "json").trim().toLowerCase();
  if (!runtimeStoreSourceModes.includes(mode)) {
    throw new Error(
      `HARDWARE_FLOW_STARTUP_STORE_SOURCE must be one of: ${runtimeStoreSourceModes.join(", ")}`,
    );
  }
  return mode;
}

function validateRuntimeStore(store, label) {
  const errors = validateStoreObject(store);
  if (errors.length > 0) {
    throw new Error(`${label} is invalid:\n${errors.join("\n")}`);
  }
  return store;
}

export function bootstrapRuntimeStore({
  mode = process.env.HARDWARE_FLOW_STARTUP_STORE_SOURCE || "json",
  databaseUrl = process.env.DATABASE_URL || "",
  localStore = null,
  createFallbackStore,
  activeProjectId = null,
  databaseReader = readPostgresDatabaseRows,
  loadedAt = new Date(),
} = {}) {
  const requestedSource = normalizeRuntimeStoreSource(mode);
  const jsonStore = localStore || createFallbackStore?.() || null;
  const loadedAtIso = loadedAt instanceof Date ? loadedAt.toISOString() : String(loadedAt);

  if (requestedSource === "json") {
    return {
      store: validateRuntimeStore(jsonStore, "JSON runtime store"),
      status: {
        requestedSource,
        loadedSource: localStore ? "json-file" : "demo-fallback",
        writeBackend: "json-file",
        loadedAt: loadedAtIso,
        fallbackUsed: !localStore,
        degraded: false,
        databaseConfigured: Boolean(databaseUrl),
        errors: [],
      },
    };
  }

  const database = databaseReader({ databaseUrl });
  if (database.ok) {
    let store;
    try {
      store = mapPostgresRowsToStore(database.rows, { activeProjectId });
      validateRuntimeStore(store, "PostgreSQL runtime snapshot");
      if (activeProjectId && store.activeProjectId !== activeProjectId) {
        throw new Error(`requested active PostgreSQL project does not exist: ${activeProjectId}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (requestedSource === "postgres") {
        throw new Error(`PostgreSQL startup store failed: ${message}`);
      }
      return {
        store: validateRuntimeStore(jsonStore, "JSON fallback runtime store"),
        status: {
          requestedSource,
          loadedSource: localStore ? "json-file" : "demo-fallback",
          writeBackend: "json-file",
          loadedAt: loadedAtIso,
          fallbackUsed: true,
          degraded: true,
          databaseConfigured: Boolean(databaseUrl),
          errors: [message],
        },
      };
    }

    return {
      store,
      status: {
        requestedSource,
        loadedSource: "postgres-snapshot",
        writeBackend: "json-file",
        loadedAt: loadedAtIso,
        fallbackUsed: false,
        degraded: false,
        databaseConfigured: Boolean(databaseUrl),
        activeProjectId: store.activeProjectId,
        counts: database.counts,
        errors: [],
      },
    };
  }

  if (requestedSource === "postgres") {
    throw new Error(`PostgreSQL startup store failed: ${database.errors.join("; ")}`);
  }

  return {
    store: validateRuntimeStore(jsonStore, "JSON fallback runtime store"),
    status: {
      requestedSource,
      loadedSource: localStore ? "json-file" : "demo-fallback",
      writeBackend: "json-file",
      loadedAt: loadedAtIso,
      fallbackUsed: true,
      degraded: true,
      databaseConfigured: Boolean(databaseUrl),
      errors: database.errors,
    },
  };
}
