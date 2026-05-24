import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { after, beforeEach, test } from "node:test";

const tempDir = mkdtempSync(path.join(tmpdir(), "hardware-flow-http-test-"));
process.env.HARDWARE_FLOW_STORE_PATH = path.join(tempDir, "store.json");

const workflow = await import("./server.mjs");
const requestHandler = workflow.server.listeners("request")[0];

after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(() => {
  workflow.resetDemoStore();
});

async function dispatch(pathname, options = {}) {
  const body = options.body || "";
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.method = options.method || "GET";
  req.url = pathname;
  req.headers = { host: "127.0.0.1", "content-type": "application/json" };

  return await new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headers: {},
      writeHead(statusCode, headers) {
        this.statusCode = statusCode;
        this.headers = headers;
      },
      end(rawBody) {
        resolve({
          status: this.statusCode,
          headers: this.headers,
          body: rawBody ? JSON.parse(String(rawBody)) : null,
        });
      },
    };
    requestHandler(req, res);
  });
}

test("health endpoint reports the active project", async () => {
  const result = await dispatch("/health");

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.activeProjectId, "project-smart-controller");
  assert.equal(result.body.projectCount, 1);
});

test("project endpoint returns the current workflow snapshot", async () => {
  const result = await dispatch("/projects/demo");

  assert.equal(result.status, 200);
  assert.equal(result.body.project.currentPhaseId, "phase-evt_exit");
  assert.equal(result.body.phases.length, 7);
  assert.equal(result.body.gates.length, 7);
  assert.equal(result.body.latestGateCheck.status, "BLOCKED");
});

test("action items endpoint returns user-specific work", async () => {
  const result = await dispatch("/users/user-project-manager/action-items");

  assert.equal(result.status, 200);
  assert.equal(result.body.userId, "user-project-manager");
  assert.equal(result.body.pendingReviews.length, 0);
  assert.equal(result.body.riskDecisions.length, 1);
  assert.equal(result.body.total, 1);
});

test("agent run endpoint rejects invalid draft output", async () => {
  const result = await dispatch("/agent-runs", {
    method: "POST",
    body: JSON.stringify({
      workPackageId: "wp-evt_exit-evt_test_report",
      agentKey: "test_agent",
      draftMarkdown: "# 不完整草稿\n\n缺少必填章节。",
    }),
  });

  assert.equal(result.status, 422);
  assert.equal(result.body.agentRun.status, "OUTPUT_INVALID");
  assert.equal(result.body.workPackage.status, "NEEDS_AGENT_REVISION");
});

test("unauthorized approval attempt returns a clear permission error", async () => {
  await dispatch("/agent-runs", {
    method: "POST",
    body: JSON.stringify({
      workPackageId: "wp-evt_exit-evt_test_report",
      agentKey: "test_agent",
      inputRefs: ["artifact:test-input"],
    }),
  });

  const result = await dispatch("/reviews", {
    method: "POST",
    body: JSON.stringify({
      workPackageId: "wp-evt_exit-evt_test_report",
      reviewerUserId: "user-project-manager",
      decision: "APPROVE",
      comment: "越权批准。",
    }),
  });

  assert.equal(result.status, 403);
  assert.equal(result.body.error, "当前用户无权批准该工作包");
});

test("risk close endpoint enforces risk decision permission", async () => {
  const denied = await dispatch("/risks/risk-thermal-margin/close", {
    method: "POST",
    body: JSON.stringify({ userId: "user-test-lead" }),
  });

  assert.equal(denied.status, 403);
  assert.equal(denied.body.error, "当前用户无权关闭风险");

  const approved = await dispatch("/risks/risk-thermal-margin/close", {
    method: "POST",
    body: JSON.stringify({ userId: "user-project-manager" }),
  });

  assert.equal(approved.status, 200);
  assert.equal(approved.body.risk.status, "CLOSED");
});

test("unknown API path returns JSON 404", async () => {
  const result = await dispatch("/not-a-real-api", { method: "POST" });

  assert.equal(result.status, 404);
  assert.equal(result.body.error, "接口不存在");
});
