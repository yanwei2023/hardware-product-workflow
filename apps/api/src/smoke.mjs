import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const port = Number(process.env.SMOKE_PORT || 3199);
const storePath = path.join(os.tmpdir(), `hardware-flow-smoke-${Date.now()}.json`);
const server = spawn(process.execPath, ["apps/api/src/server.mjs"], {
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    HARDWARE_FLOW_STORE_PATH: storePath,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
server.stdout.on("data", (chunk) => {
  output += chunk.toString("utf8");
});
server.stderr.on("data", (chunk) => {
  output += chunk.toString("utf8");
});

async function request(pathname, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  return { status: response.status, body };
}

async function waitForServer() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const health = await request("/health");
      if (health.status === 200) {
        return health;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`smoke server did not become ready:\n${output}`);
}

try {
  const health = await waitForServer();
  assert.equal(health.body.ok, true);

  const project = await request("/projects/demo");
  assert.equal(project.status, 200);
  assert.equal(project.body.latestGateCheck.status, "BLOCKED");

  const snapshot = await request("/projects/project-smart-controller/snapshot");
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.body.summary.phaseCount, 7);

  const riskRegister = await request("/projects/project-smart-controller/risk-register");
  assert.equal(riskRegister.status, 200);
  assert.equal(riskRegister.body.summary.totalRiskCount, 1);

  console.log("Smoke check passed");
} finally {
  server.kill("SIGTERM");
  await Promise.race([once(server, "exit"), new Promise((resolve) => setTimeout(resolve, 1000))]);
}
