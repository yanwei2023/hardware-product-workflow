import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDemoStore } from "./server.mjs";
import { getBackupPath } from "./persistence.mjs";
import { validateStoreFile, validateStoreObject, validateStoreReferences } from "./storeDoctor.mjs";

test("store doctor accepts the demo store shape", () => {
  assert.deepEqual(validateStoreObject(createDemoStore()), []);
});

test("store doctor reports missing required arrays", () => {
  assert.deepEqual(validateStoreObject({ activeProjectId: "project-1", projects: [] }).slice(0, 3), [
    "phases must be an array",
    "gates must be an array",
    "rolePairs must be an array",
  ]);
});

test("store doctor reports broken internal references", () => {
  const store = createDemoStore();
  store.workPackages[0] = {
    ...store.workPackages[0],
    phaseId: "missing-phase",
    rolePairId: "missing-role-pair",
  };
  store.gateRequirements[0] = {
    ...store.gateRequirements[0],
    gateId: "missing-gate",
  };

  const errors = validateStoreReferences(store);

  assert.equal(errors.some((error) => error.includes("workPackage.phaseId does not reference a phase")), true);
  assert.equal(errors.some((error) => error.includes("workPackage.rolePairId does not reference a rolePair")), true);
  assert.equal(errors.some((error) => error.includes("gateRequirement.gateId does not reference a gate")), true);
});

test("store doctor reports duplicate ids", () => {
  const store = createDemoStore();
  store.projects.push({ ...store.projects[0] });

  assert.equal(validateStoreReferences(store).some((error) => error === "projects has duplicate id project-smart-controller"), true);
});

test("store doctor validates JSON files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-store-doctor-"));
  const validPath = path.join(dir, "valid.json");
  const invalidPath = path.join(dir, "invalid.json");
  fs.writeFileSync(validPath, `${JSON.stringify(createDemoStore())}\n`);
  fs.writeFileSync(invalidPath, "{");

  assert.equal(validateStoreFile(validPath).valid, true);
  const invalid = validateStoreFile(invalidPath);
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors[0], /store JSON is invalid/);
  assert.deepEqual(validateStoreFile(path.join(dir, "missing.json")), {
    exists: false,
    valid: true,
    errors: [],
    store: null,
  });
});

test("store backup path uses the store file location", () => {
  assert.equal(getBackupPath("/tmp/hardware-flow/store.json"), "/tmp/hardware-flow/store.json.bak");
});
