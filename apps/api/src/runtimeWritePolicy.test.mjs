import assert from "node:assert/strict";
import test from "node:test";
import {
  checkRuntimeWriteAccess,
  isRuntimeMutationRequest,
  normalizeRuntimeWriteMode,
  resolveRuntimeWritePolicy,
} from "./runtimeWritePolicy.mjs";

test("runtime write policy keeps JSON runtimes writable in auto mode", () => {
  const policy = resolveRuntimeWritePolicy({
    configuredMode: "auto",
    runtimeSource: { loadedSource: "json-file" },
  });

  assert.deepEqual(policy, {
    configuredMode: "auto",
    effectiveMode: "read-write",
    writable: true,
    reason: "json-runtime-store",
  });
});

test("runtime write policy makes PostgreSQL startup snapshots read-only in auto mode", () => {
  const policy = resolveRuntimeWritePolicy({
    configuredMode: "auto",
    runtimeSource: { loadedSource: "postgres-snapshot" },
  });

  assert.equal(policy.effectiveMode, "read-only");
  assert.equal(policy.writable, false);
  assert.equal(policy.reason, "postgres-startup-snapshot");
});

test("explicit runtime write modes override the startup source default", () => {
  assert.equal(resolveRuntimeWritePolicy({
    configuredMode: "read-write",
    runtimeSource: { loadedSource: "postgres-snapshot" },
  }).writable, true);
  assert.equal(resolveRuntimeWritePolicy({
    configuredMode: "read-only",
    runtimeSource: { loadedSource: "json-file" },
  }).writable, false);
});

test("runtime mutation classification preserves read and validation requests", () => {
  assert.equal(isRuntimeMutationRequest("GET", "/projects/demo"), false);
  assert.equal(isRuntimeMutationRequest("OPTIONS", "/projects"), false);
  assert.equal(isRuntimeMutationRequest("POST", "/projects/import/validate"), false);
  assert.equal(isRuntimeMutationRequest("POST", "/projects"), true);
  assert.equal(isRuntimeMutationRequest("PATCH", "/risks/risk-1/mitigation"), true);
  assert.equal(isRuntimeMutationRequest("DELETE", "/projects/project-1"), true);
});

test("read-only runtime returns a stable mutation rejection", () => {
  const access = checkRuntimeWriteAccess(
    { writable: false, effectiveMode: "read-only", reason: "postgres-startup-snapshot" },
    "POST",
    "/projects",
  );

  assert.equal(access.allowed, false);
  assert.equal(access.statusCode, 409);
  assert.deepEqual(access.body, {
    error: "当前运行时为只读模式",
    code: "RUNTIME_READ_ONLY",
    writeMode: "read-only",
    reason: "postgres-startup-snapshot",
  });
});

test("runtime write policy rejects unknown configuration", () => {
  assert.throws(() => normalizeRuntimeWriteMode("dual-write"), /must be one of: auto, read-write, read-only/);
});
