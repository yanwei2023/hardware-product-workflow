import companyLifecycleTemplate from "../../../schemas/company-product-lifecycle-template.json" with { type: "json" };
import legacyHardwareTemplate from "../../../schemas/hardware-phase-template.json" with { type: "json" };
import lifecycleTemplateRegistry from "../../../schemas/lifecycle-template-registry.json" with { type: "json" };
import { getCompanyDocumentDefinitions } from "./companyStandardStore.mjs";

const templatesByKey = new Map([
  [
    legacyHardwareTemplate.templateKey,
    {
      ...legacyHardwareTemplate,
      compatibilityMode: "LEGACY_WORK_PACKAGES",
    },
  ],
  [companyLifecycleTemplate.templateKey, companyLifecycleTemplate],
]);

export function getLifecycleTemplateSummaries() {
  return lifecycleTemplateRegistry.templates.map((item) => ({
    templateKey: item.templateKey,
    name: item.name,
    version: item.version,
    compatibilityMode: item.compatibilityMode,
  }));
}

export function findLifecycleTemplate(templateKey) {
  return templatesByKey.get(templateKey) || null;
}

export function validateLifecycleTemplates() {
  const errors = [];
  const registryKeys = new Set();
  const companyDocumentCodes = new Set(
    getCompanyDocumentDefinitions().map((item) => item.code),
  );

  for (const metadata of lifecycleTemplateRegistry.templates) {
    if (registryKeys.has(metadata.templateKey)) {
      errors.push(`duplicate lifecycle template ${metadata.templateKey}`);
    }
    registryKeys.add(metadata.templateKey);
    const template = templatesByKey.get(metadata.templateKey);
    if (!template) {
      errors.push(`unloaded lifecycle template ${metadata.templateKey}`);
      continue;
    }
    if (template.name !== metadata.name || template.version !== metadata.version) {
      errors.push(`metadata mismatch for lifecycle template ${metadata.templateKey}`);
    }

    const phaseKeys = new Set();
    const documentCodes = new Set();
    for (const phase of template.phases) {
      if (phaseKeys.has(phase.phaseKey)) {
        errors.push(`duplicate phase ${phase.phaseKey} in ${metadata.templateKey}`);
      }
      phaseKeys.add(phase.phaseKey);
      for (const documentCode of phase.documentCodes || []) {
        if (documentCodes.has(documentCode)) {
          errors.push(`duplicate document ${documentCode} in ${metadata.templateKey}`);
        }
        documentCodes.add(documentCode);
        if (!companyDocumentCodes.has(documentCode)) {
          errors.push(`unknown document ${documentCode} in ${metadata.templateKey}`);
        }
      }
    }

    if (metadata.templateKey === companyLifecycleTemplate.templateKey) {
      for (const documentCode of companyDocumentCodes) {
        if (!documentCodes.has(documentCode)) {
          errors.push(`company document ${documentCode} omitted from ${metadata.templateKey}`);
        }
      }
    }
  }

  for (const templateKey of templatesByKey.keys()) {
    if (!registryKeys.has(templateKey)) {
      errors.push(`lifecycle template ${templateKey} missing from registry`);
    }
  }

  return errors;
}
