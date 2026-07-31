import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPublishedProjectGraph,
  compileProjectBlueprint,
  renderProjectBlueprintMarkdown,
  validateInitiationDefinition,
} from "./projectLifecycleCompiler.mjs";

const project = {
  id: "project-generic-product",
  name: "通用新产品",
};

const definition = {
  version: 3,
  productConcept: "面向工业现场的通用检测产品",
  projectTypeKey: "new_product_development",
  targetMarkets: ["工业客户"],
  customerScenarios: ["现场检测"],
  capabilityKeys: [
    "electronic_hardware",
    "measurement_signal_chain",
    "algorithm_ai",
  ],
  technicalScope: ["硬件", "算法"],
  complianceRequirements: ["目标市场准入要求"],
  supplyMode: "自研加外协",
  deliveryModel: "产品发布后项目交付",
  operationsRequirements: ["培训", "售后"],
  riskLevel: "MEDIUM",
};

test("initiation definition reports every missing required field", () => {
  assert.deepEqual(
    validateInitiationDefinition({
      productConcept: "产品构想",
    }).map((item) => item.field),
    [
      "projectTypeKey",
      "targetMarkets",
      "capabilityKeys",
      "supplyMode",
      "deliveryModel",
      "riskLevel",
    ],
  );
});

test("initiation definition rejects unknown standard keys", () => {
  assert.deepEqual(
    validateInitiationDefinition({
      ...definition,
      projectTypeKey: "unknown",
      capabilityKeys: ["electronic_hardware", "unknown"],
    }).map((item) => item.code),
    ["UNKNOWN_PROJECT_TYPE", "UNKNOWN_CAPABILITY"],
  );
});

test("same baseline and standards produce the same product-neutral blueprint", () => {
  const first = compileProjectBlueprint({ project, definition });
  const second = compileProjectBlueprint({ project, definition });

  assert.deepEqual(first, second);
  assert.equal(first.phases[0].phaseKey, "s1_market_definition");
  assert.equal(first.phases.at(-1).phaseKey, "s10_lifecycle");
  assert.equal(first.phases.length, 10);
  assert.equal(
    first.documentRequirements.some((item) => /HFCT|局放/.test(item.documentName)),
    false,
  );
  assert.equal(
    first.documentRequirements.some(
      (item) => item.defaultRequirementLevel === "CONDITIONAL"
        && item.effectiveRequirementLevel === "MANDATORY",
    ),
    true,
  );
  assert.equal(
    first.decisionTrace.length,
    first.documentRequirements.length,
  );
});

test("published graph contains S1-S10 document work and no duplicate S0", () => {
  const blueprint = compileProjectBlueprint({ project, definition });
  const graph = buildPublishedProjectGraph(project, blueprint);

  assert.deepEqual(
    graph.phases.map((item) => item.phaseKey),
    [
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
    ],
  );
  assert.equal(graph.phases[0].status, "IN_PROGRESS");
  assert.equal(graph.phases.slice(1).every((item) => item.status === "NOT_STARTED"), true);
  assert.equal(
    graph.workPackages.every((item) => item.metadata.documentCode),
    true,
  );
  assert.equal(
    graph.workPackages
      .filter((item) => item.phaseId === graph.phases[0].id)
      .every((item) => item.status === "READY_FOR_AGENT"),
    true,
  );
  assert.equal(
    graph.gateRequirements.length,
    blueprint.documentRequirements.filter(
      (item) => item.effectiveRequirementLevel === "MANDATORY",
    ).length,
  );
});

test("blueprint markdown satisfies the controlled review structure", () => {
  const blueprint = compileProjectBlueprint({ project, definition });
  const markdown = renderProjectBlueprintMarkdown(blueprint);

  for (const heading of [
    "立项基线",
    "流程配置",
    "文档配置",
    "Agent 配置",
    "规则判定",
    "审核结论",
  ]) {
    assert.match(markdown, new RegExp(`## \\d+\\. ${heading}`));
  }
  assert.match(markdown, /通用新产品/);
  assert.doesNotMatch(markdown, /HFCT|局放/);
});
