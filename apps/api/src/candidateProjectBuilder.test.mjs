import assert from "node:assert/strict";
import test from "node:test";
import { buildS0CandidateGraph } from "./candidateProjectBuilder.mjs";

const project = {
  id: "project-candidate",
  name: "候选项目",
};

test("candidate graph contains S0 only", () => {
  const graph = buildS0CandidateGraph(project);

  assert.deepEqual(
    graph.phases.map((item) => item.phaseKey),
    ["s0_governance"],
  );
  assert.equal(graph.gates.length, 1);
  assert.equal(graph.workPackages.length, 10);
  assert.equal(graph.gateRequirements.length, 8);
  assert.equal(
    graph.workPackages.every(
      (item) => item.phaseId === graph.phases[0].id,
    ),
    true,
  );
  assert.equal(
    graph.workPackages.every((item) => item.status === "READY_FOR_AGENT"),
    true,
  );
  assert.equal(
    graph.workPackages.filter((item) => item.requiredForGate === false).length,
    2,
  );
});

test("candidate graph binds standard templates and human-Agent role pairs", () => {
  const graph = buildS0CandidateGraph(project);
  const businessCase = graph.workPackages.find(
    (item) => item.metadata.documentCode === "PM-001",
  );
  const documentList = graph.workPackages.find(
    (item) => item.metadata.documentCode === "CM-002",
  );

  assert.equal(businessCase.requiredArtifactType, "BUSINESS_CASE");
  assert.equal(businessCase.artifactTemplateKey, "business_case_v0_1");
  assert.equal(documentList.requiredArtifactType, "CM-002");
  assert.equal(
    documentList.artifactTemplateKey,
    "company_controlled_document_v1_0",
  );
  assert.deepEqual(
    graph.rolePairs.map((item) => [item.humanRole, item.agentKey]),
    [
      ["产品经理", "product_agent"],
      ["项目经理", "pm_agent"],
    ],
  );
});
