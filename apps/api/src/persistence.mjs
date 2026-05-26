import fs from "node:fs";
import path from "node:path";

const workspaceRoot = path.resolve(import.meta.dirname, "../../..");
const dataDir = path.join(workspaceRoot, "data");
const defaultStorePath = path.join(dataDir, "demo-store.json");

export function getStorePath() {
  return process.env.HARDWARE_FLOW_STORE_PATH || defaultStorePath;
}

export function getBackupPath(storePath = getStorePath()) {
  return `${storePath}.bak`;
}

export function loadStoreFromDisk() {
  const storePath = getStorePath();
  if (!fs.existsSync(storePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(storePath, "utf8"));
}

function backupExistingStore(storePath) {
  if (!fs.existsSync(storePath)) {
    return;
  }

  const stat = fs.statSync(storePath);
  if (stat.size === 0) {
    return;
  }

  fs.copyFileSync(storePath, getBackupPath(storePath));
}

export function saveStoreToDisk(store) {
  const storePath = getStorePath();
  const serializedStore = `${JSON.stringify(store, null, 2)}\n`;

  fs.mkdirSync(path.dirname(storePath), { recursive: true });

  if (fs.existsSync(storePath) && fs.readFileSync(storePath, "utf8") === serializedStore) {
    return;
  }

  backupExistingStore(storePath);
  const tempPath = `${storePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, serializedStore);
  fs.renameSync(tempPath, storePath);
}

export function deleteStoreFromDisk() {
  const storePath = getStorePath();
  if (fs.existsSync(storePath)) {
    backupExistingStore(storePath);
    fs.unlinkSync(storePath);
  }
}
