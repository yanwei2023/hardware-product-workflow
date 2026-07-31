import assert from "node:assert/strict";
import test from "node:test";
import { composeProjectTemplate } from "./projectTemplateComposer.mjs";

test("generic new product preview excludes HFCT documents unless selected", () => {
  const result = composeProjectTemplate({
    templateKey: "company_product_lifecycle_v1_0",
  });
  const codes = result.phases.flatMap((phase) => (
    phase.documentRequirements.map((item) => item.documentCode)
  ));
  assert.equal(result.summary.phaseCount, 11);
  assert.ok(codes.includes("PM-001"));
  assert.ok(!codes.includes("FS-002"));
  assert.ok(!codes.includes("HW-001"));
});

test("selected capability and product packs add only their documents", () => {
  const result = composeProjectTemplate({
    templateKey: "company_product_lifecycle_v1_0",
    capabilityKeys: ["electronic_hardware", "embedded_firmware"],
    productPackKeys: ["hfct"],
  });
  const codes = result.phases.flatMap((phase) => (
    phase.documentRequirements.map((item) => item.documentCode)
  ));
  assert.ok(codes.includes("HW-003"));
  assert.ok(codes.includes("FW-001"));
  assert.ok(codes.includes("FS-002"));
  assert.ok(!codes.includes("FW-002"));
});

test("conditional documents remain unresolved in the preview", () => {
  const result = composeProjectTemplate({
    templateKey: "company_product_lifecycle_v1_0",
  });
  const poc = result.phases
    .flatMap((phase) => phase.documentRequirements)
    .find((item) => item.documentCode === "FS-003");
  assert.equal(poc.effectiveRequirementLevel, "CONDITIONAL");
  assert.equal(poc.applicabilityStatus, "UNASSESSED");
  assert.ok(result.summary.unresolvedApplicabilityCount > 0);
});

test("unknown templates and packs produce explicit validation errors", () => {
  assert.throws(
    () => composeProjectTemplate({ templateKey: "unknown" }),
    /unknown lifecycle template/,
  );
  assert.throws(
    () => composeProjectTemplate({
      templateKey: "company_product_lifecycle_v1_0",
      capabilityKeys: ["unknown"],
    }),
    /unknown capability pack/,
  );
  assert.throws(
    () => composeProjectTemplate({
      templateKey: "company_product_lifecycle_v1_0",
      productPackKeys: ["unknown"],
    }),
    /unknown product pack/,
  );
});

test("legacy work-package templates cannot masquerade as document previews", () => {
  assert.throws(
    () => composeProjectTemplate({
      templateKey: "standard_hardware_development_v0_1",
    }),
    /does not support document requirements preview/,
  );
});
