import fs from "node:fs";
import path from "node:path";

const workspaceRoot = path.resolve(import.meta.dirname, "../../..");
const dataDir = path.join(workspaceRoot, "data");
const defaultStorePath = path.join(dataDir, "demo-store.json");

export function getStorePath() {
  return process.env.HARDWARE_FLOW_STORE_PATH || defaultStorePath;
}

export function loadStoreFromDisk() {
  const storePath = getStorePath();
  if (!fs.existsSync(storePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(storePath, "utf8"));
}

export function saveStoreToDisk(store) {
  const storePath = getStorePath();
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`);
}

export function deleteStoreFromDisk() {
  const storePath = getStorePath();
  if (fs.existsSync(storePath)) {
    fs.unlinkSync(storePath);
  }
}

