import assert from "node:assert/strict";
import test from "node:test";
import {
  queueReadyAgentJobs,
  queueRevisionAgentJob,
} from "./agentDispatcher.mjs";
import { buildS0CandidateGraph } from "./candidateProjectBuilder.mjs";

function candidateStore() {
  const project = { id: "project-candidate", name: "候选项目" };
  const graph = buildS0CandidateGraph(project);
  return {
    projects: [project],
    phases: graph.phases,
    gates: graph.gates,
    rolePairs: graph.rolePairs,
    workPackages: graph.workPackages,
    gateRequirements: graph.gateRequirements,
    agentJobs: [],
  };
}

test("dispatcher queues every ready S0 work package once", () => {
  const store = candidateStore();
  let nextId = 0;
  const options = {
    projectId: "project-candidate",
    phaseId: "project-candidate-phase-s0_governance",
    requestedByUserId: "user-project-manager",
    now: () => "2026-07-31T00:00:00.000Z",
    idFactory: () => `job-${++nextId}`,
  };

  const first = queueReadyAgentJobs(store, options);
  const second = queueReadyAgentJobs(store, options);

  assert.equal(first.length, 10);
  assert.equal(second.length, 0);
  assert.equal(store.agentJobs.length, 10);
  assert.equal(
    store.agentJobs.every(
      (job) => job.status === "QUEUED" && job.dispatchReason === "WORK_READY",
    ),
    true,
  );
});

test("revision dispatch creates one replacement job after the old job is terminal", () => {
  const store = candidateStore();
  const workPackage = store.workPackages[0];
  store.agentJobs.push({
    id: "old-job",
    projectId: workPackage.projectId,
    workPackageId: workPackage.id,
    status: "COMPLETED",
  });
  workPackage.status = "NEEDS_AGENT_REVISION";

  const first = queueRevisionAgentJob(store, workPackage, {
    requestedByUserId: "user-product-owner",
    now: () => "2026-07-31T01:00:00.000Z",
    idFactory: () => "revision-job",
  });
  const second = queueRevisionAgentJob(store, workPackage, {
    requestedByUserId: "user-product-owner",
    now: () => "2026-07-31T01:01:00.000Z",
    idFactory: () => "duplicate-job",
  });

  assert.equal(first.id, "revision-job");
  assert.equal(first.dispatchReason, "HUMAN_REQUESTED_REVISION");
  assert.equal(second, null);
  assert.equal(workPackage.status, "READY_FOR_AGENT");
});
