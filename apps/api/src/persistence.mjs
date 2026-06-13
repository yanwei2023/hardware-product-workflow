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

export function getPreRestorePath(storePath = getStorePath(), restoredAt = new Date()) {
  const timestamp = restoredAt.toISOString().replace(/[:.]/g, "-");
  return `${storePath}.pre-restore-${timestamp}.bak`;
}

function safeLabel(label = "") {
  return String(label).trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

export function getCheckpointPath(storePath = getStorePath(), createdAt = new Date(), label = "") {
  const timestamp = createdAt.toISOString().replace(/[:.]/g, "-");
  const suffix = safeLabel(label);
  return `${storePath}.checkpoint-${timestamp}${suffix ? `-${suffix}` : ""}.json`;
}

function checkpointPrefix(storePath = getStorePath()) {
  return `${path.basename(storePath)}.checkpoint-`;
}

export function listStoreCheckpoints({ storePath = getStorePath() } = {}) {
  const dir = path.dirname(storePath);
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs.readdirSync(dir)
    .filter((fileName) => fileName.startsWith(checkpointPrefix(storePath)) && fileName.endsWith(".json"))
    .map((fileName) => {
      const filePath = path.join(dir, fileName);
      const stat = fs.statSync(filePath);
      return {
        fileName,
        filePath,
        sizeBytes: stat.size,
        createdAt: stat.birthtime?.toISOString() || stat.mtime.toISOString(),
        updatedAt: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export function createStoreCheckpoint({ storePath = getStorePath(), label = "", createdAt = new Date() } = {}) {
  if (!fs.existsSync(storePath)) {
    throw new Error(`store file not found: ${storePath}`);
  }

  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  const checkpointPath = getCheckpointPath(storePath, createdAt, label);
  fs.copyFileSync(storePath, checkpointPath);
  return {
    storePath,
    checkpointPath,
    label: safeLabel(label),
  };
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

export function saveStoreToDisk(store, { storePath = getStorePath(), backup = true } = {}) {
  const serializedStore = `${JSON.stringify(store, null, 2)}\n`;

  fs.mkdirSync(path.dirname(storePath), { recursive: true });

  if (fs.existsSync(storePath) && fs.readFileSync(storePath, "utf8") === serializedStore) {
    return;
  }

  if (backup) {
    backupExistingStore(storePath);
  }
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

export function restoreStoreFromBackup({ storePath = getStorePath(), restoredAt = new Date() } = {}) {
  const backupPath = getBackupPath(storePath);
  if (!fs.existsSync(backupPath)) {
    throw new Error(`backup store file not found: ${backupPath}`);
  }

  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  const backupContent = fs.readFileSync(backupPath, "utf8");
  const tempPath = `${storePath}.${process.pid}.restore.tmp`;
  const preRestorePath = fs.existsSync(storePath) ? getPreRestorePath(storePath, restoredAt) : null;

  if (preRestorePath) {
    fs.copyFileSync(storePath, preRestorePath);
  }

  fs.writeFileSync(tempPath, backupContent);
  fs.renameSync(tempPath, storePath);

  return {
    storePath,
    backupPath,
    preRestorePath,
  };
}

export function restoreStoreFromCheckpoint({ storePath = getStorePath(), checkpointPath, restoredAt = new Date() } = {}) {
  const checkpoints = listStoreCheckpoints({ storePath });
  const checkpoint = checkpoints.find((item) => item.filePath === checkpointPath || item.fileName === checkpointPath);
  if (!checkpoint) {
    throw new Error(`checkpoint file not found or not allowed: ${checkpointPath}`);
  }

  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  const checkpointContent = fs.readFileSync(checkpoint.filePath, "utf8");
  const tempPath = `${storePath}.${process.pid}.checkpoint-restore.tmp`;
  const preRestorePath = fs.existsSync(storePath) ? getPreRestorePath(storePath, restoredAt) : null;

  if (preRestorePath) {
    fs.copyFileSync(storePath, preRestorePath);
  }

  fs.writeFileSync(tempPath, checkpointContent);
  fs.renameSync(tempPath, storePath);

  return {
    storePath,
    checkpointPath: checkpoint.filePath,
    preRestorePath,
  };
}
