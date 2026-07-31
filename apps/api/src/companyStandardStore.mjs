import capabilityPackRegistry from "../../../schemas/capability-pack-registry.json" with { type: "json" };
import documentRegistry from "../../../schemas/company-document-definition-registry.json" with { type: "json" };
import productPackRegistry from "../../../schemas/product-pack-registry.json" with { type: "json" };
import projectTypeRegistry from "../../../schemas/project-type-registry.json" with { type: "json" };

const phaseKeys = new Set([
  "s0_governance",
  "s1_market_definition",
  "s2_requirements_feasibility",
  "s3_system_design",
  "s4_detailed_design",
  "s5_evt",
  "s6_dvt",
  "s7_pvt",
  "s8_release",
  "s9_delivery_operations",
  "s10_lifecycle",
]);
const sourceCategories = new Set([
  "COMPANY_COMMON",
  "PROJECT_TYPE",
  "CAPABILITY_PACK",
  "PRODUCT_PACK",
]);
const requirementLevels = new Set(["MANDATORY", "CONDITIONAL", "CONTROLLED"]);

export function getCompanyDocumentDefinitions() {
  return documentRegistry.documents;
}

export function getProjectTypes() {
  return projectTypeRegistry.projectTypes;
}

export function getCapabilityPacks() {
  return capabilityPackRegistry.capabilityPacks;
}

export function getProductPacks() {
  return productPackRegistry.productPacks;
}

function sourceRegistries() {
  return [
    ["PROJECT_TYPE", getProjectTypes()],
    ["CAPABILITY_PACK", getCapabilityPacks()],
    ["PRODUCT_PACK", getProductPacks()],
  ];
}

export function validateCompanyStandards() {
  const errors = [];
  const documents = getCompanyDocumentDefinitions();
  const documentsByCode = new Map();
  const sourceKeys = Object.fromEntries(
    sourceRegistries().map(([category, registry]) => [
      category,
      new Set(registry.map((item) => item.key)),
    ]),
  );

  if (documents.length !== 100) {
    errors.push(`expected 100 documents, received ${documents.length}`);
  }

  for (const [index, document] of documents.entries()) {
    if (document.sequence !== index + 1) {
      errors.push(`unexpected sequence ${document.sequence} for ${document.code}`);
    }
    if (documentsByCode.has(document.code)) {
      errors.push(`duplicate document code ${document.code}`);
    }
    documentsByCode.set(document.code, document);
    if (!phaseKeys.has(document.phaseKey)) {
      errors.push(`unknown phase ${document.phaseKey} for ${document.code}`);
    }
    if (!sourceCategories.has(document.sourceCategory)) {
      errors.push(`unknown source category for ${document.code}`);
    }
    if (!requirementLevels.has(document.defaultRequirementLevel)) {
      errors.push(`unknown level for ${document.code}`);
    }
    if (
      document.sourceCategory === "COMPANY_COMMON"
      && document.sourceKey !== "company"
    ) {
      errors.push(`unknown company source ${document.sourceKey} for ${document.code}`);
    }
    if (
      document.sourceCategory !== "COMPANY_COMMON"
      && !sourceKeys[document.sourceCategory]?.has(document.sourceKey)
    ) {
      errors.push(
        `unknown source ${document.sourceCategory}:${document.sourceKey} for ${document.code}`,
      );
    }
  }

  for (const [sourceCategory, registry] of sourceRegistries()) {
    const registryKeys = new Set();
    for (const source of registry) {
      if (registryKeys.has(source.key)) {
        errors.push(`duplicate source key ${sourceCategory}:${source.key}`);
      }
      registryKeys.add(source.key);
      const sourceDocumentCodes = new Set();
      for (const documentCode of source.documentCodes) {
        if (sourceDocumentCodes.has(documentCode)) {
          errors.push(`duplicate document ${documentCode} in ${sourceCategory}:${source.key}`);
        }
        sourceDocumentCodes.add(documentCode);
        const document = documentsByCode.get(documentCode);
        if (!document) {
          errors.push(`unknown document ${documentCode} in ${sourceCategory}:${source.key}`);
        } else if (
          document.sourceCategory !== sourceCategory
          || document.sourceKey !== source.key
        ) {
          errors.push(`source mismatch for ${documentCode} in ${sourceCategory}:${source.key}`);
        }
      }
    }
  }

  for (const document of documents) {
    if (document.sourceCategory === "COMPANY_COMMON") {
      continue;
    }
    const registry = sourceRegistries()
      .find(([category]) => category === document.sourceCategory)?.[1] || [];
    const source = registry.find((item) => item.key === document.sourceKey);
    if (source && !source.documentCodes.includes(document.code)) {
      errors.push(
        `document ${document.code} missing from ${document.sourceCategory}:${document.sourceKey}`,
      );
    }
  }

  return errors;
}
