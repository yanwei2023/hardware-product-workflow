import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deleteStoreFromDisk, getBackupPath, loadStoreFromDisk, saveStoreToDisk } from "./persistence.mjs";

function withTempStore(callback) {
  const originalStorePath = process.env.HARDWARE_FLOW_STORE_PATH;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-persistence-"));
  const storePath = path.join(dir, "store.json");
  process.env.HARDWARE_FLOW_STORE_PATH = storePath;

  try {
    callback({ storePath, backupPath: getBackupPath(storePath) });
  } finally {
    if (originalStorePath === undefined) {
      delete process.env.HARDWARE_FLOW_STORE_PATH;
    } else {
      process.env.HARDWARE_FLOW_STORE_PATH = originalStorePath;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("saveStoreToDisk writes the first store without a backup", () => {
  withTempStore(({ storePath, backupPath }) => {
    saveStoreToDisk({ activeProjectId: "project-1", projects: [] });

    assert.deepEqual(loadStoreFromDisk(), { activeProjectId: "project-1", projects: [] });
    assert.equal(fs.existsSync(storePath), true);
    assert.equal(fs.existsSync(backupPath), false);
  });
});

test("saveStoreToDisk backs up the previous store before replacing it", () => {
  withTempStore(({ backupPath }) => {
    const firstStore = { activeProjectId: "project-1", projects: [{ id: "project-1" }] };
    const secondStore = { activeProjectId: "project-2", projects: [{ id: "project-2" }] };

    saveStoreToDisk(firstStore);
    saveStoreToDisk(secondStore);

    assert.deepEqual(loadStoreFromDisk(), secondStore);
    assert.deepEqual(JSON.parse(fs.readFileSync(backupPath, "utf8")), firstStore);
  });
});

test("saveStoreToDisk skips unchanged content without refreshing the backup", () => {
  withTempStore(({ backupPath }) => {
    const firstStore = { activeProjectId: "project-1", projects: [{ id: "project-1" }] };
    const secondStore = { activeProjectId: "project-2", projects: [{ id: "project-2" }] };

    saveStoreToDisk(firstStore);
    saveStoreToDisk(secondStore);
    const backupUpdatedAt = fs.statSync(backupPath).mtimeMs;
    saveStoreToDisk(secondStore);

    assert.equal(fs.statSync(backupPath).mtimeMs, backupUpdatedAt);
    assert.deepEqual(JSON.parse(fs.readFileSync(backupPath, "utf8")), firstStore);
  });
});

test("deleteStoreFromDisk keeps a backup before removing the store", () => {
  withTempStore(({ storePath, backupPath }) => {
    const store = { activeProjectId: "project-1", projects: [{ id: "project-1" }] };

    saveStoreToDisk(store);
    deleteStoreFromDisk();

    assert.equal(fs.existsSync(storePath), false);
    assert.deepEqual(JSON.parse(fs.readFileSync(backupPath, "utf8")), store);
  });
});
