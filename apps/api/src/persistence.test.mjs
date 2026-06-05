import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createStoreCheckpoint,
  deleteStoreFromDisk,
  getBackupPath,
  getPreRestorePath,
  listStoreCheckpoints,
  loadStoreFromDisk,
  restoreStoreFromBackup,
  restoreStoreFromCheckpoint,
  saveStoreToDisk,
} from "./persistence.mjs";

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

test("restoreStoreFromBackup restores backup content and preserves the current store", () => {
  withTempStore(({ storePath, backupPath }) => {
    const currentStore = { activeProjectId: "project-current", projects: [{ id: "project-current" }] };
    const backupStore = { activeProjectId: "project-backup", projects: [{ id: "project-backup" }] };
    const restoredAt = new Date("2026-05-26T08:30:00.000Z");

    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, `${JSON.stringify(currentStore, null, 2)}\n`);
    fs.writeFileSync(backupPath, `${JSON.stringify(backupStore, null, 2)}\n`);

    const result = restoreStoreFromBackup({ storePath, restoredAt });

    assert.deepEqual(loadStoreFromDisk(), backupStore);
    assert.equal(result.preRestorePath, getPreRestorePath(storePath, restoredAt));
    assert.deepEqual(JSON.parse(fs.readFileSync(result.preRestorePath, "utf8")), currentStore);
  });
});

test("restoreStoreFromBackup rejects missing backups", () => {
  withTempStore(({ storePath }) => {
    assert.throws(() => restoreStoreFromBackup({ storePath }), /backup store file not found/);
  });
});

test("store checkpoints can be listed and restored", () => {
  withTempStore(({ storePath }) => {
    const firstStore = { activeProjectId: "project-first", projects: [{ id: "project-first" }] };
    const secondStore = { activeProjectId: "project-second", projects: [{ id: "project-second" }] };

    saveStoreToDisk(firstStore);
    const checkpoint = createStoreCheckpoint({
      storePath,
      label: "pilot start",
      createdAt: new Date("2026-05-26T09:00:00.000Z"),
    });
    saveStoreToDisk(secondStore);

    assert.match(checkpoint.checkpointPath, /checkpoint-2026-05-26T09-00-00-000Z-pilot-start\.json$/);
    assert.equal(listStoreCheckpoints({ storePath }).length, 1);

    const result = restoreStoreFromCheckpoint({ storePath, checkpointPath: checkpoint.checkpointPath });

    assert.deepEqual(loadStoreFromDisk(), firstStore);
    assert.equal(result.checkpointPath, checkpoint.checkpointPath);
    assert.ok(result.preRestorePath.endsWith(".bak"));
  });
});
