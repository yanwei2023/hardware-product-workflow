export type WorkPackageStatus =
  | "NOT_STARTED"
  | "READY_FOR_AGENT"
  | "AGENT_WORKING"
  | "AGENT_DRAFT_READY"
  | "HUMAN_REVIEWING"
  | "NEEDS_AGENT_REVISION"
  | "HUMAN_APPROVED"
  | "SUBMITTED_TO_BASELINE"
  | "LOCKED"
  | "BLOCKED"
  | "CONFLICT_DETECTED"
  | "ESCALATED"
  | "REJECTED"
  | "CANCELLED";

export type PhaseStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "GATE_PREPARING"
  | "GATE_BLOCKED"
  | "GATE_READY"
  | "APPROVED"
  | "REWORK_REQUIRED"
  | "LOCKED";

export type ReviewDecision =
  | "APPROVE"
  | "APPROVE_WITH_CONDITIONS"
  | "REJECT"
  | "REQUEST_REVISION"
  | "REQUEST_MORE_EVIDENCE"
  | "ESCALATE";

export interface RolePair {
  id: string;
  projectId: string;
  roleKey: string;
  humanUserId: string;
  agentKey: string;
  agentPermissionLevel: "L0_READ" | "L1_DRAFT" | "L2_PROPOSE" | "L3_SANDBOX_WRITE";
}

export interface WorkPackage {
  id: string;
  projectId: string;
  phaseId: string;
  rolePairId: string;
  title: string;
  requiredArtifactType: string;
  status: WorkPackageStatus;
  dueAt?: string;
}

export interface AgentRun {
  id: string;
  workPackageId: string;
  agentKey: string;
  status: "QUEUED" | "RUNNING" | "OUTPUT_READY" | "FAILED" | "CANCELLED";
  inputRefs: string[];
  outputRef?: string;
  riskLevel?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}

export interface ReviewRecord {
  id: string;
  workPackageId: string;
  reviewerUserId: string;
  decision: ReviewDecision;
  comment: string;
  conditions: string[];
  reviewedAt: string;
}

export interface GateCheckResult {
  gateId: string;
  status: "BLOCKED" | "READY";
  blockers: GateBlocker[];
}

export interface GateBlocker {
  code:
    | "MISSING_WORK_PACKAGE"
    | "MISSING_ARTIFACT"
    | "REVIEW_NOT_APPROVED"
    | "OPEN_HIGH_RISK"
    | "MISSING_SIGNOFF"
    | "STALE_ARTIFACT_VERSION"
    | "UNRESOLVED_AGENT_FINDING";
  message: string;
  ownerRolePairId?: string;
  relatedObjectId?: string;
}

