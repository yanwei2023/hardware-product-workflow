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
  "agentJobs",
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
  if (errors.length === 0) {
    errors.push(...validateStoreReferences(store));
  }
  return errors;
}

function idSet(items) {
  return new Set(items.map((item) => item?.id).filter(Boolean));
}

function validateUniqueIds(errors, items, collectionName) {
  const seen = new Set();
  for (const item of items) {
    if (!item?.id) {
      errors.push(`${collectionName} item is missing id`);
    } else if (seen.has(item.id)) {
      errors.push(`${collectionName} has duplicate id ${item.id}`);
    }
    seen.add(item?.id);
  }
}

function requireReference(errors, condition, message, itemId, referencedId) {
  if (!condition) {
    errors.push(`${message}: ${itemId || "(missing id)"} -> ${referencedId || "(missing reference)"}`);
  }
}

export function validateStoreReferences(store) {
  const errors = [];
  for (const key of requiredArrays) {
    validateUniqueIds(errors, store[key], key);
  }

  const projectIds = idSet(store.projects);
  const phaseIds = idSet(store.phases);
  const gateIds = idSet(store.gates);
  const rolePairIds = idSet(store.rolePairs);
  const workPackageIds = idSet(store.workPackages);
  const agentRunIds = idSet(store.agentRuns);

  requireReference(errors, projectIds.has(store.activeProjectId), "activeProjectId does not reference a project", "activeProjectId", store.activeProjectId);

  for (const project of store.projects) {
    if (project.currentPhaseId) {
      requireReference(errors, phaseIds.has(project.currentPhaseId), "project.currentPhaseId does not reference a phase", project.id, project.currentPhaseId);
    }
  }

  for (const phase of store.phases) {
    requireReference(errors, projectIds.has(phase.projectId), "phase.projectId does not reference a project", phase.id, phase.projectId);
  }

  for (const gate of store.gates) {
    requireReference(errors, projectIds.has(gate.projectId), "gate.projectId does not reference a project", gate.id, gate.projectId);
    requireReference(errors, phaseIds.has(gate.phaseId), "gate.phaseId does not reference a phase", gate.id, gate.phaseId);
  }

  for (const rolePair of store.rolePairs) {
    requireReference(errors, projectIds.has(rolePair.projectId), "rolePair.projectId does not reference a project", rolePair.id, rolePair.projectId);
  }

  for (const workPackage of store.workPackages) {
    requireReference(errors, projectIds.has(workPackage.projectId), "workPackage.projectId does not reference a project", workPackage.id, workPackage.projectId);
    requireReference(errors, phaseIds.has(workPackage.phaseId), "workPackage.phaseId does not reference a phase", workPackage.id, workPackage.phaseId);
    requireReference(errors, rolePairIds.has(workPackage.rolePairId), "workPackage.rolePairId does not reference a rolePair", workPackage.id, workPackage.rolePairId);
  }

  for (const requirement of store.gateRequirements) {
    requireReference(errors, gateIds.has(requirement.gateId), "gateRequirement.gateId does not reference a gate", requirement.id, requirement.gateId);
    if (requirement.workPackageId) {
      requireReference(
        errors,
        workPackageIds.has(requirement.workPackageId),
        "gateRequirement.workPackageId does not reference a workPackage",
        requirement.id,
        requirement.workPackageId,
      );
    }
  }

  for (const artifact of store.artifactVersions) {
    requireReference(errors, workPackageIds.has(artifact.workPackageId), "artifactVersion.workPackageId does not reference a workPackage", artifact.id, artifact.workPackageId);
  }

  for (const review of store.reviews) {
    requireReference(errors, workPackageIds.has(review.workPackageId), "review.workPackageId does not reference a workPackage", review.id, review.workPackageId);
  }

  for (const risk of store.risks) {
    requireReference(errors, projectIds.has(risk.projectId), "risk.projectId does not reference a project", risk.id, risk.projectId);
    requireReference(errors, phaseIds.has(risk.phaseId), "risk.phaseId does not reference a phase", risk.id, risk.phaseId);
    if (risk.ownerRolePairId) {
      requireReference(errors, rolePairIds.has(risk.ownerRolePairId), "risk.ownerRolePairId does not reference a rolePair", risk.id, risk.ownerRolePairId);
    }
  }

  for (const run of store.agentRuns) {
    requireReference(errors, workPackageIds.has(run.workPackageId), "agentRun.workPackageId does not reference a workPackage", run.id, run.workPackageId);
  }

  for (const job of store.agentJobs) {
    requireReference(errors, projectIds.has(job.projectId), "agentJob.projectId does not reference a project", job.id, job.projectId);
    requireReference(errors, workPackageIds.has(job.workPackageId), "agentJob.workPackageId does not reference a workPackage", job.id, job.workPackageId);
    if (job.agentRunId) {
      requireReference(errors, agentRunIds.has(job.agentRunId), "agentJob.agentRunId does not reference an agentRun", job.id, job.agentRunId);
    }
  }

  for (const finding of store.agentFindings) {
    requireReference(errors, workPackageIds.has(finding.workPackageId), "agentFinding.workPackageId does not reference a workPackage", finding.id, finding.workPackageId);
    requireReference(errors, agentRunIds.has(finding.agentRunId), "agentFinding.agentRunId does not reference an agentRun", finding.id, finding.agentRunId);
  }

  for (const evidenceRef of store.evidenceRefs) {
    requireReference(errors, projectIds.has(evidenceRef.projectId), "evidenceRef.projectId does not reference a project", evidenceRef.id, evidenceRef.projectId);
    requireReference(errors, workPackageIds.has(evidenceRef.workPackageId), "evidenceRef.workPackageId does not reference a workPackage", evidenceRef.id, evidenceRef.workPackageId);
  }

  for (const pack of store.gateApprovalPacks) {
    requireReference(errors, projectIds.has(pack.projectId), "gateApprovalPack.projectId does not reference a project", pack.id, pack.projectId);
    requireReference(errors, gateIds.has(pack.gateId), "gateApprovalPack.gateId does not reference a gate", pack.id, pack.gateId);
    requireReference(errors, phaseIds.has(pack.phaseId), "gateApprovalPack.phaseId does not reference a phase", pack.id, pack.phaseId);
  }

  for (const notification of store.notifications) {
    requireReference(errors, projectIds.has(notification.projectId), "notification.projectId does not reference a project", notification.id, notification.projectId);
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
  const backupResult = validateStoreFile(backupPath);
  const summary = {
    filePath,
    backupPath,
    backupExists: fs.existsSync(backupPath),
    backupValid: backupResult.valid,
    backupErrors: backupResult.errors,
    exists: result.exists,
    valid: result.valid,
    errors: result.errors,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!result.valid) {
    process.exitCode = 1;
  }
}
