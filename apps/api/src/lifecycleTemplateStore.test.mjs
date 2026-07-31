import assert from "node:assert/strict";
import test from "node:test";
import {
  findLifecycleTemplate,
  getLifecycleTemplateSummaries,
  validateLifecycleTemplates,
} from "./lifecycleTemplateStore.mjs";

test("lifecycle registry keeps the legacy seven-phase template", () => {
  const template = findLifecycleTemplate("standard_hardware_development_v0_1");
  assert.equal(template.phases.length, 7);
  assert.equal(template.compatibilityMode, "LEGACY_WORK_PACKAGES");
});

test("company template covers S0 through S10 exactly once", () => {
  const template = findLifecycleTemplate("company_product_lifecycle_v1_0");
  assert.equal(template.phases.length, 11);
  assert.deepEqual(
    template.phases.map((phase) => phase.sequence),
    [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
  );
  assert.equal(
    template.phases.flatMap((phase) => phase.documentCodes).length,
    100,
  );
  assert.deepEqual(validateLifecycleTemplates(), []);
});

test("lifecycle registry exposes discoverable summaries", () => {
  assert.deepEqual(
    getLifecycleTemplateSummaries().map((item) => item.templateKey),
    ["standard_hardware_development_v0_1", "company_product_lifecycle_v1_0"],
  );
});
