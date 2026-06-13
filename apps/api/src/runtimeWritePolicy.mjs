export const runtimeWriteModes = ["auto", "read-write", "read-only"];

export function normalizeRuntimeWriteMode(value = "auto") {
  const mode = String(value || "auto").trim().toLowerCase();
  if (!runtimeWriteModes.includes(mode)) {
    throw new Error(`HARDWARE_FLOW_RUNTIME_WRITE_MODE must be one of: ${runtimeWriteModes.join(", ")}`);
  }
  return mode;
}

export function resolveRuntimeWritePolicy({
  configuredMode = process.env.HARDWARE_FLOW_RUNTIME_WRITE_MODE || "auto",
  runtimeSource = {},
  persistenceBackend = process.env.HARDWARE_FLOW_RUNTIME_PERSISTENCE_BACKEND || "json",
} = {}) {
  const normalizedMode = normalizeRuntimeWriteMode(configuredMode);
  const postgresSnapshot = runtimeSource.loadedSource === "postgres-snapshot";
  if (postgresSnapshot && normalizedMode === "read-write" && persistenceBackend !== "postgres-mirror") {
    throw new Error(
      "PostgreSQL startup snapshots require HARDWARE_FLOW_RUNTIME_PERSISTENCE_BACKEND=postgres-mirror for read-write mode",
    );
  }
  const effectiveMode = normalizedMode === "auto"
    ? (postgresSnapshot ? "read-only" : "read-write")
    : normalizedMode;

  return {
    configuredMode: normalizedMode,
    effectiveMode,
    writable: effectiveMode === "read-write",
    persistenceBackend,
    reason: normalizedMode === "auto"
      ? (postgresSnapshot ? "postgres-startup-snapshot" : "json-runtime-store")
      : "explicit-configuration",
  };
}

export function isRuntimeMutationRequest(method, pathname) {
  const normalizedMethod = String(method || "GET").toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(normalizedMethod)) {
    return false;
  }
  return !(normalizedMethod === "POST" && pathname === "/projects/import/validate");
}

export function checkRuntimeWriteAccess(policy, method, pathname) {
  if (policy.writable || !isRuntimeMutationRequest(method, pathname)) {
    return { allowed: true };
  }
  return {
    allowed: false,
    statusCode: 409,
    body: {
      error: "当前运行时为只读模式",
      code: "RUNTIME_READ_ONLY",
      writeMode: policy.effectiveMode,
      reason: policy.reason,
    },
  };
}
