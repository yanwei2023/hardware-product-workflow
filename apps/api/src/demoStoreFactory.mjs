import { buildProjectFromTemplate } from "./templateEngine.mjs";

export function createDemoStore() {
  const projectId = "project-smart-controller";
  const project = {
    id: projectId,
    name: "智能控制器项目",
    currentPhaseId: "phase-evt_exit",
    status: "IN_PROGRESS",
  };
  const generated = buildProjectFromTemplate(project);

  return {
    activeProjectId: project.id,
    projects: [project],
    phases: generated.phases,
    gates: generated.gates,
    rolePairs: generated.rolePairs,
    gateRequirements: generated.gateRequirements,
    workPackages: generated.workPackages,
    artifactVersions: [
      {
        id: "artifact-evt-test-plan-draft",
        workPackageId: "wp-evt_exit-evt_test_plan",
        artifactType: "TEST_PLAN",
        status: "PENDING_REVIEW",
        version: "0.1",
        createdByActor: "agent:test_agent",
        content: {
          title: "EVT 测试计划草稿",
          summary: "由 Test Agent 根据需求和历史模板生成，等待测试负责人审核。",
          templateKey: "test_plan_v0_1",
          validation: {
            status: "PASSED",
            missingSections: [],
            emptySections: [],
          },
        },
      },
    ],
    reviews: [],
    risks: [
      {
        id: "risk-thermal-margin",
        projectId,
        phaseId: "phase-evt_exit",
        title: "热设计裕量不足",
        severity: "HIGH",
        status: "OPEN",
      },
    ],
    agentJobs: [],
    agentRuns: [],
    agentFindings: [],
    evidenceRefs: [],
    gateApprovalPacks: [],
    auditEvents: [],
    notifications: [],
  };
}
