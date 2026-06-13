import assert from "node:assert/strict";
import test from "node:test";
import {
  checkRuntimePersistenceStartup,
  createRuntimePersistence,
  normalizeRuntimePersistenceBackend,
  RuntimePersistenceError,
} from "./runtimePersistence.mjs";
import { createDemoStore } from "./demoStoreFactory.mjs";
import { mapStoreToPostgresRows } from "./postgresMapper.mjs";

test("JSON persistence startup check does not require PostgreSQL", () => {
  const result = checkRuntimePersistenceStartup({
    initialStore: { value: 1 },
    backend: "json",
    databaseReader: () => assert.fail("JSON startup must not read PostgreSQL"),
  });

  assert.equal(result.ready, true);
  assert.equal(result.required, false);
  assert.equal(result.inSync, null);
});

test("PostgreSQL mirror startup check accepts an exact database snapshot", () => {
  const store = createDemoStore();
  const result = checkRuntimePersistenceStartup({
    initialStore: store,
    backend: "postgres-mirror",
    databaseUrl: "postgres://example",
    databaseReader: () => ({ ok: true, rows: mapStoreToPostgresRows(store), errors: [] }),
    checkedAt: new Date("2026-06-13T02:00:00.000Z"),
  });

  assert.equal(result.ready, true);
  assert.equal(result.required, true);
  assert.equal(result.inSync, true);
  assert.equal(result.checkedAt, "2026-06-13T02:00:00.000Z");
  assert.equal(result.summary.changedRowCount, 0);
});

test("PostgreSQL mirror startup check rejects missing configuration and drift", () => {
  const store = createDemoStore();
  const missingUrl = checkRuntimePersistenceStartup({ initialStore: store, backend: "postgres-mirror" });
  const databaseRows = mapStoreToPostgresRows(store);
  databaseRows.projects[0] = { ...databaseRows.projects[0], name: "database drift" };
  const drift = checkRuntimePersistenceStartup({
    initialStore: store,
    backend: "postgres-mirror",
    databaseUrl: "postgres://example",
    databaseReader: () => ({ ok: true, rows: databaseRows, errors: [] }),
  });

  assert.equal(missingUrl.ready, false);
  assert.match(missingUrl.errors[0], /DATABASE_URL is required/);
  assert.equal(drift.ready, false);
  assert.equal(drift.inSync, false);
  assert.equal(drift.summary.changedRowCount, 1);
});

test("PostgreSQL mirror startup check contains reader failures", () => {
  const result = checkRuntimePersistenceStartup({
    initialStore: createDemoStore(),
    backend: "postgres-mirror",
    databaseUrl: "postgres://example",
    databaseReader: () => {
      throw new Error("database reader crashed");
    },
  });

  assert.equal(result.ready, false);
  assert.deepEqual(result.errors, ["database reader crashed"]);
});

test("PostgreSQL mirror startup check rejects an invalid local store before reading the database", () => {
  const result = checkRuntimePersistenceStartup({
    initialStore: { projects: [] },
    backend: "postgres-mirror",
    databaseUrl: "postgres://example",
    databaseReader: () => assert.fail("invalid stores must fail before database access"),
  });

  assert.equal(result.ready, false);
  assert.equal(result.errors.length > 0, true);
});

test("JSON runtime persistence commits without PostgreSQL synchronization", () => {
  const writes = [];
  const persistence = createRuntimePersistence({
    initialStore: { value: 1 },
    backend: "json",
    saveStore: (store) => writes.push(structuredClone(store)),
    synchronize: () => assert.fail("JSON backend must not synchronize PostgreSQL"),
  });

  const status = persistence.persist({ value: 2 }, { persistedAt: new Date("2026-06-13T00:00:00.000Z") });

  assert.deepEqual(writes, [{ value: 2 }]);
  assert.deepEqual(persistence.getCommittedStore(), { value: 2 });
  assert.equal(status.backend, "json");
  assert.equal(status.lastPersistedAt, "2026-06-13T00:00:00.000Z");
  assert.equal(status.lastPostgresSyncAt, null);
});

test("PostgreSQL mirror persistence commits only after verified synchronization", () => {
  const writes = [];
  const syncCalls = [];
  const persistence = createRuntimePersistence({
    initialStore: { value: 1 },
    backend: "postgres-mirror",
    databaseUrl: "postgres://example",
    outputDir: "/tmp/runtime-sync-test",
    startupChecker: () => ({ required: true, ready: true, inSync: true, summary: {}, errors: [] }),
    saveStore: (store) => writes.push(structuredClone(store)),
    synchronize: (options) => {
      syncCalls.push(options);
      return { ok: true, errors: [] };
    },
  });

  const status = persistence.persist({ value: 2 }, { persistedAt: new Date("2026-06-13T01:00:00.000Z") });

  assert.deepEqual(writes, [{ value: 2 }]);
  assert.equal(syncCalls[0].confirm, true);
  assert.equal(syncCalls[0].databaseUrl, "postgres://example");
  assert.deepEqual(persistence.getCommittedStore(), { value: 2 });
  assert.equal(status.lastPostgresSyncAt, "2026-06-13T01:00:00.000Z");
  assert.equal(status.postgresSyncFailureCount, 0);
});

test("PostgreSQL mirror failure restores the last committed JSON store", () => {
  const writes = [];
  const persistence = createRuntimePersistence({
    initialStore: { value: 1 },
    backend: "postgres-mirror",
    databaseUrl: "postgres://example",
    startupChecker: () => ({ required: true, ready: true, inSync: true, summary: {}, errors: [] }),
    saveStore: (store, options) => writes.push({ store: structuredClone(store), options }),
    synchronize: () => ({ ok: false, errors: ["database unavailable"] }),
  });

  assert.throws(
    () => persistence.persist({ value: 2 }),
    (error) => error instanceof RuntimePersistenceError && error.statusCode === 503,
  );
  assert.deepEqual(writes, [
    { store: { value: 2 }, options: undefined },
    { store: { value: 1 }, options: { backup: false } },
  ]);
  assert.deepEqual(persistence.getCommittedStore(), { value: 1 });
  assert.equal(persistence.getStatus().postgresSyncFailureCount, 1);
  assert.equal(persistence.getStatus().lastError, "database unavailable");
});

test("PostgreSQL mirror persistence fails closed when startup consistency is not ready", () => {
  assert.throws(
    () => createRuntimePersistence({
      initialStore: createDemoStore(),
      backend: "postgres-mirror",
      databaseUrl: "postgres://example",
      startupChecker: () => ({ required: true, ready: false, errors: ["store drift"] }),
    }),
    /startup check failed: store drift/,
  );
});

test("runtime persistence rejects unknown backends", () => {
  assert.throws(
    () => normalizeRuntimePersistenceBackend("dual-write"),
    /must be one of: json, postgres-mirror/,
  );
});
