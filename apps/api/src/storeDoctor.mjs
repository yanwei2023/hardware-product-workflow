import fs from "node:fs";
import { getBackupPath, getStorePath } from "./persistence.mjs";

const requiredArrays = [
  "projects",
  "phases",
  "gates",
  "rolePairs",
  "gateRequirements",
  "workPackages",
  "artifactVersions",
  "reviews",
  "risks",
  "agentRuns",
  "agentFindings",
  "evidenceRefs",
  "gateApprovalPacks",
  "auditEvents",
  "notifications",
];

export function validateStoreObject(store) {
  const errors = [];
  if (!store || typeof store !== "object" || Array.isArray(store)) {
    return ["store must be a JSON object"];
  }
  if (!store.activeProjectId) {
    errors.push("activeProjectId is required");
  }
  for (const key of requiredArrays) {
    if (!Array.isArray(store[key])) {
      errors.push(`${key} must be an array`);
    }
  }
  return errors;
}

export function validateStoreFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return { exists: false, valid: true, errors: [], store: null };
  }

  try {
    const store = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const errors = validateStoreObject(store);
    return { exists: true, valid: errors.length === 0, errors, store };
  } catch (error) {
    return {
      exists: true,
      valid: false,
      errors: [`store JSON is invalid: ${error instanceof Error ? error.message : String(error)}`],
      store: null,
    };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const filePath = process.argv[2] || getStorePath();
  const backupPath = getBackupPath(filePath);
  const result = validateStoreFile(filePath);
  const summary = {
    filePath,
    backupPath,
    backupExists: fs.existsSync(backupPath),
    exists: result.exists,
    valid: result.valid,
    errors: result.errors,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!result.valid) {
    process.exitCode = 1;
  }
}
