import type { GateCheckInput } from "./gateEngine";

export const sampleGateCheckInput: GateCheckInput = {
  gateId: "gate-evt-exit",
  projectId: "project-smart-controller",
  phaseId: "phase-evt",
  requirements: [
    {
      id: "req-evt-test-plan",
      gateId: "gate-evt-exit",
      requiredWorkPackageTitle: "EVT test plan",
      requiredArtifactType: "TEST_PLAN",
      requiredRoleKey: "test_engineer",
    },
    {
      id: "req-evt-report",
      gateId: "gate-evt-exit",
      requiredWorkPackageTitle: "EVT exit report",
      requiredArtifactType: "TEST_REPORT",
      requiredRoleKey: "test_engineer",
    },
  ],
  workPackages: [
    {
      id: "wp-evt-test-plan",
      projectId: "project-smart-controller",
      phaseId: "phase-evt",
      rolePairId: "pair-test",
      title: "EVT test plan",
      requiredArtifactType: "TEST_PLAN",
      status: "HUMAN_APPROVED",
    },
    {
      id: "wp-evt-report",
      projectId: "project-smart-controller",
      phaseId: "phase-evt",
      rolePairId: "pair-test",
      title: "EVT exit report",
      requiredArtifactType: "TEST_REPORT",
      status: "AGENT_DRAFT_READY",
    },
  ],
  artifactVersions: [
    {
      id: "artifact-evt-test-plan-v1",
      workPackageId: "wp-evt-test-plan",
      artifactType: "TEST_PLAN",
      status: "APPROVED",
      version: "1.0",
    },
  ],
  reviews: [
    {
      id: "review-evt-test-plan",
      workPackageId: "wp-evt-test-plan",
      reviewerUserId: "user-test-lead",
      decision: "APPROVE",
      comment: "Approved for EVT execution.",
      conditions: [],
      reviewedAt: "2026-05-13T09:00:00.000Z",
    },
  ],
  risks: [
    {
      id: "risk-thermal-margin",
      projectId: "project-smart-controller",
      phaseId: "phase-evt",
      severity: "HIGH",
      status: "OPEN",
    },
  ],
  agentFindings: [],
};

