import phaseTemplate from "../../../schemas/hardware-phase-template.json" with { type: "json" };
import { findArtifactTemplateByType } from "./artifactTemplateStore.mjs";

const demoRolePairByAgent = {
  product_agent: {
    roleKey: "product_manager",
    humanUserId: "user-product-owner",
  },
  pm_agent: {
    roleKey: "project_manager",
    humanUserId: "user-project-manager",
  },
  system_agent: {
    roleKey: "system_engineer",
    humanUserId: "user-system-lead",
  },
  ee_agent: {
    roleKey: "hardware_engineer",
    humanUserId: "user-ee-lead",
  },
  me_agent: {
    roleKey: "mechanical_engineer",
    humanUserId: "user-me-lead",
  },
  fw_agent: {
    roleKey: "firmware_engineer",
    humanUserId: "user-fw-lead",
  },
  test_agent: {
    roleKey: "test_engineer",
    humanUserId: "user-test-lead",
  },
  supply_agent: {
    roleKey: "supply_engineer",
    humanUserId: "user-supply-lead",
  },
  quality_agent: {
    roleKey: "quality_engineer",
    humanUserId: "user-quality-lead",
  },
  manufacturing_agent: {
    roleKey: "manufacturing_engineer",
    humanUserId: "user-mfg-lead",
  },
};

export function getHardwarePhaseTemplate() {
  return phaseTemplate;
}

export function buildProjectFromTemplate(project, activePhaseKey = "evt_exit") {
  const phases = [];
  const gates = [];
  const rolePairs = [];
  const gateRequirements = [];
  const workPackages = [];
  const rolePairIdsByAgent = new Map();
  const legacyDemoIds = project.id === "project-smart-controller";
  const idPrefix = legacyDemoIds ? "" : `${project.id}-`;

  for (const phaseDefinition of phaseTemplate.phases) {
    const phaseId = `${idPrefix}phase-${phaseDefinition.phaseKey}`;
    const gateId = `${idPrefix}gate-${phaseDefinition.phaseKey}`;
    const isActivePhase = phaseDefinition.phaseKey === activePhaseKey;

    phases.push({
      id: phaseId,
      projectId: project.id,
      phaseKey: phaseDefinition.phaseKey,
      name: phaseDefinition.name,
      sequence: phaseDefinition.sequence,
      status: isActivePhase ? "GATE_BLOCKED" : "NOT_STARTED",
    });

    gates.push({
      id: gateId,
      projectId: project.id,
      phaseId,
      name: phaseDefinition.gateName,
      status: isActivePhase ? "GATE_BLOCKED" : "NOT_STARTED",
    });

    for (const workPackageDefinition of phaseDefinition.requiredWorkPackages) {
      if (!rolePairIdsByAgent.has(workPackageDefinition.agentKey)) {
        const roleDefaults = demoRolePairByAgent[workPackageDefinition.agentKey] || {
          roleKey: workPackageDefinition.humanRole,
          humanUserId: `user-${workPackageDefinition.agentKey}`,
        };
        const rolePair = {
          id: `${idPrefix}pair-${workPackageDefinition.agentKey}`,
          projectId: project.id,
          roleKey: roleDefaults.roleKey,
          humanRole: workPackageDefinition.humanRole,
          humanUserId: roleDefaults.humanUserId,
          agentKey: workPackageDefinition.agentKey,
        };
        rolePairs.push(rolePair);
        rolePairIdsByAgent.set(workPackageDefinition.agentKey, rolePair.id);
      }

      const workPackageId = `${idPrefix}wp-${phaseDefinition.phaseKey}-${workPackageDefinition.workPackageKey}`;
      const artifactTemplate = findArtifactTemplateByType(workPackageDefinition.requiredArtifactType);
      workPackages.push({
        id: workPackageId,
        projectId: project.id,
        phaseId,
        rolePairId: rolePairIdsByAgent.get(workPackageDefinition.agentKey),
        title: workPackageDefinition.title,
        requiredArtifactType: workPackageDefinition.requiredArtifactType,
        artifactTemplateKey: workPackageDefinition.artifactTemplateKey || artifactTemplate?.templateKey || null,
        status:
          phaseDefinition.phaseKey === "evt_exit" && workPackageDefinition.workPackageKey === "evt_test_plan"
            ? "AGENT_DRAFT_READY"
            : "NOT_STARTED",
      });

      if (workPackageDefinition.requiredForGate) {
        gateRequirements.push({
          id: `req-${phaseDefinition.phaseKey}-${workPackageDefinition.workPackageKey}`,
          gateId,
          requiredWorkPackageTitle: workPackageDefinition.title,
          requiredArtifactType: workPackageDefinition.requiredArtifactType,
          requiredRoleKey: workPackageDefinition.humanRole,
        });
      }
    }
  }

  return {
    phases,
    gates,
    rolePairs,
    gateRequirements,
    workPackages,
  };
}
