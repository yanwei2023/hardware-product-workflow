import assert from "node:assert/strict";
import test from "node:test";
import {
  getCapabilityPacks,
  getCompanyDocumentDefinitions,
  getProductPacks,
  getProjectTypes,
  validateCompanyStandards,
} from "./companyStandardStore.mjs";

test("company standards contain all 100 uniquely numbered documents", () => {
  const documents = getCompanyDocumentDefinitions();
  assert.equal(documents.length, 100);
  assert.deepEqual(
    documents.map((item) => item.sequence),
    Array.from({ length: 100 }, (_, index) => index + 1),
  );
  assert.equal(new Set(documents.map((item) => item.code)).size, 100);
});

test("company standards preserve the approved requirement-level totals", () => {
  const totals = getCompanyDocumentDefinitions().reduce(
    (result, item) => ({
      ...result,
      [item.defaultRequirementLevel]: result[item.defaultRequirementLevel] + 1,
    }),
    { MANDATORY: 0, CONDITIONAL: 0, CONTROLLED: 0 },
  );
  assert.deepEqual(totals, { MANDATORY: 87, CONDITIONAL: 8, CONTROLLED: 5 });
});

test("company standards reference declared project and pack sources", () => {
  assert.ok(getProjectTypes().some((item) => item.key === "new_product_development"));
  assert.ok(getCapabilityPacks().some((item) => item.key === "electronic_hardware"));
  assert.ok(getProductPacks().some((item) => item.key === "hfct"));
  assert.deepEqual(validateCompanyStandards(), []);
});
