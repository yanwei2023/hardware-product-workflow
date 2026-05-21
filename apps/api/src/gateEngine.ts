import type { GateBlocker, GateCheckResult, ReviewRecord, WorkPackage } from "../../../schemas/domain";

export interface GateRequirement {
  id: string;
  gateId: string;
  requiredWorkPackageTitle: string;
  requiredArtifactType: string;
  requiredRoleKey: string;
}

export interface ArtifactVersion {
  id: string;
  workPackageId: string;
  artifactType: string;
  status: "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "LOCKED";
  version: string;
}

export interface RiskIssue {
  id: string;
  projectId: string;
  phaseId: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "OPEN" | "MITIGATING" | "CLOSED" | "ACCEPTED";
  acceptedByUserId?: string;
}

export interface AgentFinding {
  id: string;
  workPackageId: string;
  severity: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "OPEN" | "DISMISSED" | "CONVERTED_TO_RISK" | "RESOLVED";
}

export interface GateCheckInput {
  gateId: string;
  projectId: string;
  phaseId: string;
  requirements: GateRequirement[];
  workPackages: WorkPackage[];
  artifactVersions: ArtifactVersion[];
  reviews: ReviewRecord[];
  risks: RiskIssue[];
  agentFindings: AgentFinding[];
}

export function checkGateReadiness(input: GateCheckInput): GateCheckResult {
  const blockers: GateBlocker[] = [];

  for (const requirement of input.requirements) {
    const workPackage = input.workPackages.find(
      (item) =>
        item.phaseId === input.phaseId &&
        item.title === requirement.requiredWorkPackageTitle &&
        item.requiredArtifactType === requirement.requiredArtifactType,
    );

    if (!workPackage) {
      blockers.push({
        code: "MISSING_WORK_PACKAGE",
        message: `Missing required work package: ${requirement.requiredWorkPackageTitle}`,
      });
      continue;
    }

    const approvedArtifact = input.artifactVersions.find(
      (item) =>
        item.workPackageId === workPackage.id &&
        item.artifactType === requirement.requiredArtifactType &&
        (item.status === "APPROVED" || item.status === "LOCKED"),
    );

    if (!approvedArtifact) {
      blockers.push({
        code: "MISSING_ARTIFACT",
        message: `Required artifact is not approved: ${requirement.requiredArtifactType}`,
        ownerRolePairId: workPackage.rolePairId,
        relatedObjectId: workPackage.id,
      });
    }

    const approvedReview = input.reviews.find(
      (item) =>
        item.workPackageId === workPackage.id &&
        (item.decision === "APPROVE" || item.decision === "APPROVE_WITH_CONDITIONS"),
    );

    if (!approvedReview) {
      blockers.push({
        code: "REVIEW_NOT_APPROVED",
        message: `Human review is not approved: ${workPackage.title}`,
        ownerRolePairId: workPackage.rolePairId,
        relatedObjectId: workPackage.id,
      });
    }
  }

  for (const risk of input.risks) {
    const isBlocking =
      risk.phaseId === input.phaseId &&
      (risk.severity === "HIGH" || risk.severity === "CRITICAL") &&
      risk.status !== "CLOSED" &&
      risk.status !== "ACCEPTED";

    if (isBlocking) {
      blockers.push({
        code: "OPEN_HIGH_RISK",
        message: `Open ${risk.severity.toLowerCase()} risk blocks the gate`,
        relatedObjectId: risk.id,
      });
    }
  }

  for (const finding of input.agentFindings) {
    const workPackage = input.workPackages.find((item) => item.id === finding.workPackageId);
    const isBlocking =
      workPackage?.phaseId === input.phaseId &&
      (finding.severity === "HIGH" || finding.severity === "CRITICAL") &&
      finding.status === "OPEN";

    if (isBlocking) {
      blockers.push({
        code: "UNRESOLVED_AGENT_FINDING",
        message: `Unresolved ${finding.severity.toLowerCase()} agent finding blocks the gate`,
        ownerRolePairId: workPackage.rolePairId,
        relatedObjectId: finding.id,
      });
    }
  }

  return {
    gateId: input.gateId,
    status: blockers.length > 0 ? "BLOCKED" : "READY",
    blockers,
  };
}

