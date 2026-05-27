import assert from "node:assert/strict";
import test from "node:test";
import { createDemoStore } from "./server.mjs";
import { getProjectReadModel } from "./storeRepository.mjs";

test("project read model scopes workflow records to one project", () => {
  const store = createDemoStore();
  store.projects.push({
    id: "project-other",
    name: "Other",
    currentPhaseId: "project-other-phase-evt_exit",
    status: "IN_PROGRESS",
  });
  store.phases.push({
    id: "project-other-phase-evt_exit",
    projectId: "project-other",
    name: "EVT Exit",
    sequence: 4,
    status: "GATE_BLOCKED",
  });
  store.gates.push({
    id: "project-other-gate-evt_exit",
    projectId: "project-other",
    phaseId: "project-other-phase-evt_exit",
    name: "Other Gate",
    status: "GATE_BLOCKED",
  });
  store.auditEvents.push(
    { id: "audit-global", eventType: "GLOBAL", actorType: "human", actorId: "user-project-manager", objectType: "system", objectId: "global" },
    { id: "audit-demo", projectId: "project-smart-controller", eventType: "DEMO", actorType: "human", actorId: "user-project-manager", objectType: "project", objectId: "project-smart-controller" },
    { id: "audit-other", projectId: "project-other", eventType: "OTHER", actorType: "human", actorId: "user-project-manager", objectType: "project", objectId: "project-other" },
  );

  const model = getProjectReadModel(store, "project-smart-controller");

  assert.equal(model.project.id, "project-smart-controller");
  assert.equal(model.phases.length, 7);
  assert.equal(model.currentPhase.id, "phase-evt_exit");
  assert.equal(model.currentGate.id, "gate-evt_exit");
  assert.equal(model.gates.some((gate) => gate.projectId === "project-other"), false);
  assert.equal(model.auditEvents.some((event) => event.id === "audit-global"), true);
  assert.equal(model.auditEvents.some((event) => event.id === "audit-demo"), true);
  assert.equal(model.auditEvents.some((event) => event.id === "audit-other"), false);
});

test("project read model returns null for unknown projects", () => {
  assert.equal(getProjectReadModel(createDemoStore(), "missing-project"), null);
});
