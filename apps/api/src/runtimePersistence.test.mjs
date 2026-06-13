import assert from "node:assert/strict";
import test from "node:test";
import {
  createRuntimePersistence,
  normalizeRuntimePersistenceBackend,
  RuntimePersistenceError,
} from "./runtimePersistence.mjs";

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

test("runtime persistence rejects unknown backends", () => {
  assert.throws(
    () => normalizeRuntimePersistenceBackend("dual-write"),
    /must be one of: json, postgres-mirror/,
  );
});
