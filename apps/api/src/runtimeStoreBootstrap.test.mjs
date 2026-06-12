import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { createDemoStore } from "./demoStoreFactory.mjs";
import { mapStoreToPostgresRows } from "./postgresMapper.mjs";
import { bootstrapRuntimeStore, normalizeRuntimeStoreSource } from "./runtimeStoreBootstrap.mjs";

function databaseResult(store = createDemoStore()) {
  const rows = mapStoreToPostgresRows(store);
  return {
    ok: true,
    rows,
    counts: Object.fromEntries(Object.entries(rows).map(([table, items]) => [table, items.length])),
    errors: [],
  };
}

test("runtime store bootstrap defaults to the local JSON store", () => {
  const localStore = createDemoStore();
  localStore.projects[0].name = "local store";
  let databaseReadCount = 0;
  const result = bootstrapRuntimeStore({
    localStore,
    createFallbackStore: createDemoStore,
    databaseReader: () => {
      databaseReadCount += 1;
      return databaseResult();
    },
    loadedAt: new Date("2026-06-12T10:00:00.000Z"),
  });

  assert.equal(result.store.projects[0].name, "local store");
  assert.equal(result.status.requestedSource, "json");
  assert.equal(result.status.loadedSource, "json-file");
  assert.equal(result.status.writeBackend, "json-file");
  assert.equal(result.status.loadedAt, "2026-06-12T10:00:00.000Z");
  assert.equal(databaseReadCount, 0);
});

test("runtime store bootstrap marks demo fallback when no JSON file exists", () => {
  const result = bootstrapRuntimeStore({
    mode: "json",
    localStore: null,
    createFallbackStore: createDemoStore,
  });

  assert.equal(result.status.loadedSource, "demo-fallback");
  assert.equal(result.status.fallbackUsed, true);
  assert.equal(result.store.activeProjectId, "project-smart-controller");
});

test("runtime store bootstrap loads and validates a PostgreSQL snapshot", () => {
  const postgresStore = createDemoStore();
  postgresStore.projects[0].name = "postgres snapshot";
  const result = bootstrapRuntimeStore({
    mode: "postgres",
    databaseUrl: "postgresql://workflow:secret@localhost/workflow",
    localStore: createDemoStore(),
    createFallbackStore: createDemoStore,
    databaseReader: () => databaseResult(postgresStore),
  });

  assert.equal(result.store.projects[0].name, "postgres snapshot");
  assert.equal(result.status.loadedSource, "postgres-snapshot");
  assert.equal(result.status.writeBackend, "json-file");
  assert.equal(result.status.fallbackUsed, false);
  assert.equal(result.status.degraded, false);
  assert.equal(result.status.databaseConfigured, true);
  assert.equal(JSON.stringify(result.status).includes("secret"), false);
});

test("runtime store bootstrap selects an explicit active PostgreSQL project", () => {
  const postgresStore = createDemoStore();
  postgresStore.projects.push({
    ...postgresStore.projects[0],
    id: "project-second",
    name: "second project",
  });
  const result = bootstrapRuntimeStore({
    mode: "postgres",
    databaseUrl: "postgresql://localhost/workflow",
    activeProjectId: "project-second",
    databaseReader: () => databaseResult(postgresStore),
  });

  assert.equal(result.store.activeProjectId, "project-second");
  assert.equal(result.status.activeProjectId, "project-second");
});

test("required PostgreSQL startup fails closed", () => {
  assert.throws(
    () => bootstrapRuntimeStore({
      mode: "postgres",
      localStore: createDemoStore(),
      databaseReader: () => ({ ok: false, rows: null, counts: null, errors: ["DATABASE_URL is required"] }),
    }),
    /PostgreSQL startup store failed: DATABASE_URL is required/,
  );
});

test("required PostgreSQL startup rejects an unknown active project", () => {
  assert.throws(
    () => bootstrapRuntimeStore({
      mode: "postgres",
      databaseUrl: "postgresql://localhost/workflow",
      activeProjectId: "project-missing",
      databaseReader: () => databaseResult(),
    }),
    /requested active PostgreSQL project does not exist: project-missing/,
  );
});

test("PostgreSQL fallback mode records degradation and uses JSON", () => {
  const localStore = createDemoStore();
  localStore.projects[0].name = "fallback local";
  const result = bootstrapRuntimeStore({
    mode: "postgres-fallback",
    databaseUrl: "postgresql://localhost/workflow",
    localStore,
    databaseReader: () => ({ ok: false, rows: null, counts: null, errors: ["database unavailable"] }),
  });

  assert.equal(result.store.projects[0].name, "fallback local");
  assert.equal(result.status.loadedSource, "json-file");
  assert.equal(result.status.fallbackUsed, true);
  assert.equal(result.status.degraded, true);
  assert.deepEqual(result.status.errors, ["database unavailable"]);
});

test("PostgreSQL fallback rejects an invalid local fallback", () => {
  assert.throws(
    () => bootstrapRuntimeStore({
      mode: "postgres-fallback",
      databaseUrl: "postgresql://localhost/workflow",
      localStore: { projects: [] },
      databaseReader: () => ({ ok: false, rows: null, counts: null, errors: ["database unavailable"] }),
    }),
    /JSON fallback runtime store is invalid/,
  );
});

test("runtime store bootstrap rejects unknown source modes", () => {
  assert.throws(() => normalizeRuntimeStoreSource("dual-write"), /must be one of: json, postgres, postgres-fallback/);
});

test("PostgreSQL schema CLI stays isolated from HTTP runtime bootstrap", () => {
  const result = spawnSync(process.execPath, ["apps/api/src/postgresSchemaCheck.mjs"], {
    cwd: path.resolve("."),
    encoding: "utf8",
    env: {
      ...process.env,
      HARDWARE_FLOW_STARTUP_STORE_SOURCE: "intentionally-invalid",
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PostgreSQL row mapping covers schema tables and columns/);
});
