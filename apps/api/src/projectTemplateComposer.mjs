import {
  getCapabilityPacks,
  getCompanyDocumentDefinitions,
  getProductPacks,
} from "./companyStandardStore.mjs";
import { findLifecycleTemplate } from "./lifecycleTemplateStore.mjs";

function normalizeSelectedKeys(value, label) {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return [...new Set(value.map((item) => String(item)))];
}

function assertKnownKeys(selectedKeys, definitions, label) {
  const knownKeys = new Set(definitions.map((item) => item.key));
  for (const key of selectedKeys) {
    if (!knownKeys.has(key)) {
      throw new Error(`unknown ${label} ${key}`);
    }
  }
}

function sourceIsSelected(
  document,
  template,
  selectedCapabilityKeys,
  selectedProductPackKeys,
) {
  if (document.sourceCategory === "COMPANY_COMMON") {
    return true;
  }
  if (document.sourceCategory === "PROJECT_TYPE") {
    return document.sourceKey === template.projectTypeKey;
  }
  if (document.sourceCategory === "CAPABILITY_PACK") {
    return selectedCapabilityKeys.has(document.sourceKey);
  }
  if (document.sourceCategory === "PRODUCT_PACK") {
    return selectedProductPackKeys.has(document.sourceKey);
  }
  return false;
}

export function composeProjectTemplate(input = {}) {
  const template = findLifecycleTemplate(input.templateKey);
  if (!template) {
    throw new Error(`unknown lifecycle template ${input.templateKey || ""}`.trim());
  }

  const capabilityKeys = normalizeSelectedKeys(input.capabilityKeys, "capabilityKeys");
  const productPackKeys = normalizeSelectedKeys(input.productPackKeys, "productPackKeys");
  assertKnownKeys(capabilityKeys, getCapabilityPacks(), "capability pack");
  assertKnownKeys(productPackKeys, getProductPacks(), "product pack");

  const selectedCapabilityKeys = new Set(capabilityKeys);
  const selectedProductPackKeys = new Set(productPackKeys);
  const documentsByCode = new Map(
    getCompanyDocumentDefinitions().map((item) => [item.code, item]),
  );

  const phases = [...template.phases]
    .sort((left, right) => left.sequence - right.sequence)
    .map((phase) => {
      const documentRequirements = (phase.documentCodes || [])
        .map((documentCode) => documentsByCode.get(documentCode))
        .filter(Boolean)
        .filter((document) => sourceIsSelected(
          document,
          template,
          selectedCapabilityKeys,
          selectedProductPackKeys,
        ))
        .sort((left, right) => left.sequence - right.sequence)
        .map((document) => {
          const applicabilityStatus = document.defaultRequirementLevel === "CONDITIONAL"
            ? "UNASSESSED"
            : "APPLICABLE";
          return {
            documentCode: document.code,
            documentName: document.name,
            sourceCategory: document.sourceCategory,
            sourceKey: document.sourceKey,
            defaultRequirementLevel: document.defaultRequirementLevel,
            effectiveRequirementLevel: document.defaultRequirementLevel,
            applicabilityStatus,
          };
        });
      return {
        phaseKey: phase.phaseKey,
        name: phase.name,
        sequence: phase.sequence,
        gateName: phase.gateName,
        documentRequirements,
      };
    });

  const requirements = phases.flatMap((phase) => phase.documentRequirements);
  const countLevel = (level) => requirements
    .filter((item) => item.effectiveRequirementLevel === level)
    .length;

  return {
    template: {
      templateKey: template.templateKey,
      name: template.name,
      version: template.version,
    },
    selectedCapabilityKeys: capabilityKeys,
    selectedProductPackKeys: productPackKeys,
    phases,
    summary: {
      phaseCount: phases.length,
      documentCount: requirements.length,
      mandatoryCount: countLevel("MANDATORY"),
      conditionalCount: countLevel("CONDITIONAL"),
      controlledCount: countLevel("CONTROLLED"),
      unresolvedApplicabilityCount: requirements
        .filter((item) => item.applicabilityStatus === "UNASSESSED")
        .length,
    },
  };
}
