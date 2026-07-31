import candidateTemplate from "../../../schemas/s0-candidate-template.json" with { type: "json" };
import { getCompanyDocumentDefinitions } from "./companyStandardStore.mjs";

const genericArtifactTemplateKey = "company_controlled_document_v1_0";

function idKey(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export function buildS0CandidateGraph(project) {
  if (!project?.id || !project?.name) {
    throw new Error("project id and name are required");
  }
  const documentsByCode = new Map(
    getCompanyDocumentDefinitions().map((item) => [item.code, item]),
  );
  const phaseId = `${project.id}-phase-${candidateTemplate.phaseKey}`;
  const gateId = `${project.id}-gate-${candidateTemplate.phaseKey}`;
  const phases = [{
    id: phaseId,
    projectId: project.id,
    phaseKey: candidateTemplate.phaseKey,
    name: candidateTemplate.phaseName,
    sequence: candidateTemplate.sequence,
    status: "IN_PROGRESS",
  }];
  const gates = [{
    id: gateId,
    projectId: project.id,
    phaseId,
    name: candidateTemplate.gateName,
    status: "GATE_BLOCKED",
  }];
  const rolePairs = [];
  const rolePairByRoleKey = new Map();
  const workPackages = [];
  const gateRequirements = [];

  for (const workDefinition of candidateTemplate.workPackages) {
    const document = documentsByCode.get(workDefinition.documentCode);
    if (!document || document.phaseKey !== candidateTemplate.phaseKey) {
      throw new Error(`invalid S0 document ${workDefinition.documentCode}`);
    }
    if (!rolePairByRoleKey.has(workDefinition.roleKey)) {
      const rolePair = {
        id: `${project.id}-pair-${workDefinition.roleKey}`,
        projectId: project.id,
        roleKey: workDefinition.roleKey,
        humanRole: workDefinition.humanRole,
        humanUserId: workDefinition.humanUserId,
        agentKey: workDefinition.agentKey,
        agentPermissionLevel: "L1_DRAFT",
      };
      rolePairs.push(rolePair);
      rolePairByRoleKey.set(workDefinition.roleKey, rolePair);
    }

    const workPackage = {
      id: `${project.id}-wp-s0-${idKey(document.code)}`,
      projectId: project.id,
      phaseId,
      rolePairId: rolePairByRoleKey.get(workDefinition.roleKey).id,
      title: `${document.code} ${document.name}`,
      requiredArtifactType: workDefinition.requiredArtifactType || document.code,
      artifactTemplateKey: workDefinition.artifactTemplateKey
        || genericArtifactTemplateKey,
      requiredForGate: document.defaultRequirementLevel !== "CONTROLLED",
      status: "READY_FOR_AGENT",
      metadata: {
        workType: "DOCUMENT",
        documentCode: document.code,
        documentName: document.name,
        defaultRequirementLevel: document.defaultRequirementLevel,
        effectiveRequirementLevel: document.defaultRequirementLevel,
        applicabilityStatus: "APPLICABLE",
        sourceCategory: document.sourceCategory,
        sourceKey: document.sourceKey,
        artifactTemplateVersion: workDefinition.artifactTemplateKey
          ? "0.1.0"
          : "1.0.0",
      },
    };
    workPackages.push(workPackage);

    if (workPackage.requiredForGate) {
      gateRequirements.push({
        id: `${project.id}-req-s0-${idKey(document.code)}`,
        gateId,
        workPackageId: workPackage.id,
        requiredWorkPackageTitle: workPackage.title,
        requiredArtifactType: workPackage.requiredArtifactType,
        requiredRoleKey: workDefinition.humanRole,
      });
    }
  }

  return {
    phases,
    gates,
    rolePairs,
    workPackages,
    gateRequirements,
  };
}
