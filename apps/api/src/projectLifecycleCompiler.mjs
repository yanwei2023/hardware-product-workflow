import {
  getCapabilityPacks,
  getCompanyDocumentDefinitions,
  getProjectTypes,
} from "./companyStandardStore.mjs";
import { composeProjectTemplate } from "./projectTemplateComposer.mjs";

const lifecycleTemplateKey = "company_product_lifecycle_v1_0";
const genericDocumentTemplateKey = "company_controlled_document_v1_0";
const genericDocumentTemplateVersion = "1.0.0";
const allowedRiskLevels = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

const executionByOwnerRole = {
  项目经理: ["project_manager", "user-project-manager", "pm_agent"],
  配置管理员: ["configuration_manager", "user-project-manager", "pm_agent"],
  产品经理: ["product_manager", "user-product-owner", "product_agent"],
  系统工程师: ["system_engineer", "user-system-lead", "system_agent"],
  硬件工程师: ["hardware_engineer", "user-ee-lead", "ee_agent"],
  结构工程师: ["mechanical_engineer", "user-me-lead", "me_agent"],
  固件工程师: ["firmware_engineer", "user-fw-lead", "fw_agent"],
  算法工程师: ["algorithm_engineer", "user-fw-lead", "fw_agent"],
  软件工程师: ["software_engineer", "user-fw-lead", "fw_agent"],
  测试负责人: ["test_engineer", "user-test-lead", "test_agent"],
  质量负责人: ["quality_engineer", "user-quality-lead", "quality_agent"],
  供应链负责人: ["supply_engineer", "user-supply-lead", "supply_agent"],
  制造负责人: ["manufacturing_engineer", "user-mfg-lead", "manufacturing_agent"],
  交付负责人: ["delivery_manager", "user-project-manager", "pm_agent"],
  售后服务负责人: ["operations_manager", "user-project-manager", "pm_agent"],
};

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function missing(field, message) {
  return {
    code: "MISSING_INITIATION_FIELD",
    field,
    message,
  };
}

export function validateInitiationDefinition(definition = {}) {
  const errors = [];
  if (!isNonEmptyString(definition.productConcept)) {
    errors.push(missing("productConcept", "必须说明拟开发产品及其解决的问题"));
  }
  if (!isNonEmptyString(definition.projectTypeKey)) {
    errors.push(missing("projectTypeKey", "必须选择项目类型"));
  }
  if (!isNonEmptyArray(definition.targetMarkets)) {
    errors.push(missing("targetMarkets", "必须至少确定一个目标市场"));
  }
  if (!isNonEmptyArray(definition.capabilityKeys)) {
    errors.push(missing("capabilityKeys", "必须至少确定一个产品能力范围"));
  }
  if (!isNonEmptyString(definition.supplyMode)) {
    errors.push(missing("supplyMode", "必须确定自研、外协或供应链模式"));
  }
  if (!isNonEmptyString(definition.deliveryModel)) {
    errors.push(missing("deliveryModel", "必须确定产品或项目交付模式"));
  }
  if (!isNonEmptyString(definition.riskLevel)) {
    errors.push(missing("riskLevel", "必须确定项目风险等级"));
  }

  if (
    isNonEmptyString(definition.projectTypeKey)
    && !getProjectTypes().some((item) => item.key === definition.projectTypeKey)
  ) {
    errors.push({
      code: "UNKNOWN_PROJECT_TYPE",
      field: "projectTypeKey",
      message: `未知项目类型：${definition.projectTypeKey}`,
    });
  }

  const knownCapabilities = new Set(getCapabilityPacks().map((item) => item.key));
  for (const capabilityKey of Array.isArray(definition.capabilityKeys)
    ? definition.capabilityKeys
    : []) {
    if (!knownCapabilities.has(capabilityKey)) {
      errors.push({
        code: "UNKNOWN_CAPABILITY",
        field: "capabilityKeys",
        message: `未知能力范围：${capabilityKey}`,
      });
    }
  }

  if (
    isNonEmptyString(definition.riskLevel)
    && !allowedRiskLevels.has(definition.riskLevel)
  ) {
    errors.push({
      code: "INVALID_RISK_LEVEL",
      field: "riskLevel",
      message: `风险等级必须是 ${[...allowedRiskLevels].join("、")}`,
    });
  }

  return errors;
}

function resolveExecution(document) {
  const execution = executionByOwnerRole[document.ownerRole];
  if (!execution) {
    throw new Error(`no Agent execution mapping for owner role ${document.ownerRole}`);
  }
  return {
    roleKey: execution[0],
    humanUserId: execution[1],
    agentKey: execution[2],
    humanRole: document.ownerRole,
  };
}

function effectiveRequirement(document) {
  if (document.defaultRequirementLevel === "CONDITIONAL") {
    return {
      effectiveRequirementLevel: "MANDATORY",
      applicabilityStatus: "APPLICABLE",
      decisionReason: "CONDITIONAL_DEFAULT_APPLICABLE",
    };
  }
  return {
    effectiveRequirementLevel: document.defaultRequirementLevel,
    applicabilityStatus: "APPLICABLE",
    decisionReason: document.sourceCategory,
  };
}

export function compileProjectBlueprint({ project, definition } = {}) {
  if (!project?.id || !project?.name) {
    throw new Error("project id and name are required");
  }
  const validationErrors = validateInitiationDefinition(definition);
  if (validationErrors.length > 0) {
    const error = new Error("initiation definition is incomplete or invalid");
    error.validationErrors = validationErrors;
    throw error;
  }

  const preview = composeProjectTemplate({
    templateKey: lifecycleTemplateKey,
    projectTypeKey: definition.projectTypeKey,
    capabilityKeys: definition.capabilityKeys,
  });
  const documentsByCode = new Map(
    getCompanyDocumentDefinitions().map((item) => [item.code, item]),
  );
  const phases = preview.phases
    .filter((phase) => phase.phaseKey !== "s0_governance")
    .map(({ documentRequirements, ...phase }) => ({
      ...phase,
      documentCount: documentRequirements.length,
    }));
  const documentRequirements = preview.phases
    .filter((phase) => phase.phaseKey !== "s0_governance")
    .flatMap((phase) => phase.documentRequirements.map((requirement) => {
      const document = documentsByCode.get(requirement.documentCode);
      const effective = effectiveRequirement(document);
      const execution = resolveExecution(document);
      return {
        documentCode: document.code,
        documentName: document.name,
        phaseKey: phase.phaseKey,
        sourceCategory: document.sourceCategory,
        sourceKey: document.sourceKey,
        defaultRequirementLevel: document.defaultRequirementLevel,
        ...effective,
        ownerRole: document.ownerRole,
        reviewRoles: [...document.reviewRoles],
        approvalRole: document.approvalRole,
        artifactTemplateKey: document.artifactTemplateKey
          || genericDocumentTemplateKey,
        artifactTemplateVersion: genericDocumentTemplateVersion,
        execution,
      };
    }));
  const agentAssignments = documentRequirements.map((requirement) => ({
    documentCode: requirement.documentCode,
    phaseKey: requirement.phaseKey,
    ...requirement.execution,
    artifactTemplateKey: requirement.artifactTemplateKey,
  }));
  const decisionTrace = documentRequirements.map((requirement) => ({
    documentCode: requirement.documentCode,
    sourceCategory: requirement.sourceCategory,
    sourceKey: requirement.sourceKey,
    defaultRequirementLevel: requirement.defaultRequirementLevel,
    effectiveRequirementLevel: requirement.effectiveRequirementLevel,
    applicabilityStatus: requirement.applicabilityStatus,
    reason: requirement.decisionReason,
  }));

  return {
    blueprintVersion: 1,
    projectId: project.id,
    projectName: project.name,
    sourceInitiationBaselineVersion: Number(definition.version || 1),
    lifecycleTemplateKey: preview.template.templateKey,
    lifecycleTemplateVersion: preview.template.version,
    projectTypeKey: definition.projectTypeKey,
    capabilityKeys: [...definition.capabilityKeys],
    initiationBaseline: structuredClone(definition),
    phases,
    documentRequirements,
    agentAssignments,
    decisionTrace,
    summary: {
      phaseCount: phases.length,
      documentCount: documentRequirements.length,
      mandatoryCount: documentRequirements.filter(
        (item) => item.effectiveRequirementLevel === "MANDATORY",
      ).length,
      controlledCount: documentRequirements.filter(
        (item) => item.effectiveRequirementLevel === "CONTROLLED",
      ).length,
      agentAssignmentCount: agentAssignments.length,
    },
  };
}

function idKey(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export function buildPublishedProjectGraph(project, blueprint) {
  if (!project?.id || blueprint?.projectId !== project.id) {
    throw new Error("blueprint does not belong to project");
  }
  const phases = blueprint.phases.map((phase, index) => ({
    id: `${project.id}-phase-${phase.phaseKey}`,
    projectId: project.id,
    phaseKey: phase.phaseKey,
    name: phase.name,
    sequence: phase.sequence,
    status: index === 0 ? "IN_PROGRESS" : "NOT_STARTED",
  }));
  const phaseByKey = new Map(phases.map((phase) => [phase.phaseKey, phase]));
  const gates = blueprint.phases.map((phase, index) => ({
    id: `${project.id}-gate-${phase.phaseKey}`,
    projectId: project.id,
    phaseId: phaseByKey.get(phase.phaseKey).id,
    name: phase.gateName,
    status: index === 0 ? "GATE_BLOCKED" : "NOT_STARTED",
  }));
  const gateByPhaseKey = new Map(
    blueprint.phases.map((phase, index) => [phase.phaseKey, gates[index]]),
  );
  const rolePairs = [];
  const rolePairByRoleKey = new Map();
  for (const assignment of blueprint.agentAssignments) {
    if (rolePairByRoleKey.has(assignment.roleKey)) {
      continue;
    }
    const rolePair = {
      id: `${project.id}-pair-${assignment.roleKey}`,
      projectId: project.id,
      roleKey: assignment.roleKey,
      humanRole: assignment.humanRole,
      humanUserId: assignment.humanUserId,
      agentKey: assignment.agentKey,
      agentPermissionLevel: "L1_DRAFT",
    };
    rolePairs.push(rolePair);
    rolePairByRoleKey.set(assignment.roleKey, rolePair);
  }

  const firstPhaseKey = blueprint.phases[0]?.phaseKey || null;
  const workPackages = blueprint.documentRequirements.map((requirement) => ({
    id: `${project.id}-wp-${idKey(requirement.documentCode)}`,
    projectId: project.id,
    phaseId: phaseByKey.get(requirement.phaseKey).id,
    rolePairId: rolePairByRoleKey.get(requirement.execution.roleKey).id,
    title: `${requirement.documentCode} ${requirement.documentName}`,
    requiredArtifactType: requirement.documentCode,
    artifactTemplateKey: requirement.artifactTemplateKey,
    requiredForGate: requirement.effectiveRequirementLevel === "MANDATORY",
    status: requirement.phaseKey === firstPhaseKey
      ? "READY_FOR_AGENT"
      : "NOT_STARTED",
    metadata: {
      workType: "DOCUMENT",
      documentCode: requirement.documentCode,
      documentName: requirement.documentName,
      defaultRequirementLevel: requirement.defaultRequirementLevel,
      effectiveRequirementLevel: requirement.effectiveRequirementLevel,
      applicabilityStatus: requirement.applicabilityStatus,
      sourceCategory: requirement.sourceCategory,
      sourceKey: requirement.sourceKey,
      artifactTemplateVersion: requirement.artifactTemplateVersion,
      blueprintVersion: blueprint.blueprintVersion,
    },
  }));
  const workPackageByDocumentCode = new Map(
    workPackages.map((item) => [item.metadata.documentCode, item]),
  );
  const gateRequirements = blueprint.documentRequirements
    .filter((item) => item.effectiveRequirementLevel === "MANDATORY")
    .map((requirement) => {
      const workPackage = workPackageByDocumentCode.get(requirement.documentCode);
      return {
        id: `${project.id}-req-${idKey(requirement.documentCode)}`,
        gateId: gateByPhaseKey.get(requirement.phaseKey).id,
        workPackageId: workPackage.id,
        requiredWorkPackageTitle: workPackage.title,
        requiredArtifactType: workPackage.requiredArtifactType,
        requiredRoleKey: requirement.ownerRole,
      };
    });

  return {
    phases,
    gates,
    rolePairs,
    workPackages,
    gateRequirements,
  };
}

function markdownList(values) {
  return Array.isArray(values) && values.length > 0 ? values.join("、") : "无";
}

export function renderProjectBlueprintMarkdown(blueprint) {
  const phaseRows = blueprint.phases
    .map((phase) => `| ${phase.name} | ${phase.gateName} | ${phase.documentCount} |`)
    .join("\n");
  const documentRows = blueprint.documentRequirements
    .map((item) => (
      `| ${item.documentCode} | ${item.documentName} | ${item.phaseKey} | ${item.effectiveRequirementLevel} | ${item.artifactTemplateKey} |`
    ))
    .join("\n");
  const agentRows = blueprint.agentAssignments
    .map((item) => (
      `| ${item.documentCode} | ${item.agentKey} | ${item.humanRole} | ${item.humanUserId} |`
    ))
    .join("\n");
  const traceRows = blueprint.decisionTrace
    .map((item) => (
      `| ${item.documentCode} | ${item.sourceCategory}:${item.sourceKey} | ${item.defaultRequirementLevel} | ${item.effectiveRequirementLevel} | ${item.reason} |`
    ))
    .join("\n");

  return `# ${blueprint.projectName} 项目正式配置蓝图

## 1. 立项基线

- 项目：${blueprint.projectName}（${blueprint.projectId}）
- 产品构想：${blueprint.initiationBaseline.productConcept}
- 项目类型：${blueprint.projectTypeKey}
- 目标市场：${markdownList(blueprint.initiationBaseline.targetMarkets)}
- 能力范围：${markdownList(blueprint.capabilityKeys)}
- 供应模式：${blueprint.initiationBaseline.supplyMode}
- 交付模式：${blueprint.initiationBaseline.deliveryModel}
- 风险等级：${blueprint.initiationBaseline.riskLevel}

## 2. 流程配置

| 阶段 | Gate | 文档数 |
|---|---|---:|
${phaseRows}

## 3. 文档配置

| 代码 | 文档 | 阶段 | 有效等级 | 模板 |
|---|---|---|---|---|
${documentRows}

## 4. Agent 配置

| 文档 | 执行 Agent | 人员角色 | 审核负责人 |
|---|---|---|---|
${agentRows}

## 5. 规则判定

| 文档 | 来源 | 默认等级 | 有效等级 | 判定依据 |
|---|---|---|---|---|
${traceRows}

## 6. 审核结论

本蓝图由规则引擎确定性生成并由 Agent 提交。项目负责人批准后，系统才发布 S1-S10 正式执行基线。
`;
}
