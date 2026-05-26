import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDemoStore } from "./server.mjs";
import { validateStoreFile, validateStoreObject } from "./storeDoctor.mjs";

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
