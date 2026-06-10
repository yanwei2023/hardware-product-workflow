import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { after, test } from "node:test";

const tempDir = mkdtempSync(path.join(tmpdir(), "hardware-flow-access-test-"));
process.env.HARDWARE_FLOW_STORE_PATH = path.join(tempDir, "store.json");
process.env.HARDWARE_FLOW_ACCESS_LOG = "0";
process.env.HARDWARE_FLOW_PILOT_ACCESS_CODE = "pilot-123";

const workflow = await import(`./server.mjs?access-test=${Date.now()}`);
const requestHandler = workflow.server.listeners("request")[0];

after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

async function dispatch(pathname, options = {}) {
  const body = options.body || "";
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.method = options.method || "GET";
  req.url = pathname;
  req.headers = { host: "127.0.0.1", "content-type": "application/json", ...(options.headers || {}) };

  return await new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headers: {},
      chunks: [],
      setHeader(name, value) {
        this.headers[name.toLowerCase()] = value;
      },
      writeHead(statusCode, headers) {
        this.statusCode = statusCode;
        this.headers = { ...this.headers, ...headers };
      },
      write(chunk) {
        if (chunk) this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      },
      end(rawBody) {
        if (rawBody) this.write(rawBody);
        const text = this.chunks.length ? Buffer.concat(this.chunks).toString("utf8") : "";
        const contentType = this.headers?.["content-type"] || "";
        resolve({
          status: this.statusCode,
          headers: this.headers,
          body: contentType.includes("application/json") && text ? JSON.parse(text) : text || null,
        });
      },
      on() {},
    };
    Promise.resolve(requestHandler(req, res)).catch((error) => {
      resolve({ status: Number(error?.statusCode) || 500, headers: {}, body: { error: error.message } });
    });
  });
}

test("pilot access code protects data APIs while leaving public diagnostics open", async () => {
  const runtime = await dispatch("/runtime/config");
  assert.equal(runtime.status, 200);
  assert.equal(runtime.body.pilotAccessEnabled, true);

  const staticPage = await dispatch("/");
  assert.equal(staticPage.status, 200);
  assert.match(staticPage.body, /<html|<div id="root">/);

  const denied = await dispatch("/projects/demo");
  assert.equal(denied.status, 401);
  assert.equal(denied.body.code, "PILOT_ACCESS_REQUIRED");
  assert.equal(denied.headers["access-control-allow-headers"], "content-type,x-request-id,x-pilot-access-code");

  const allowed = await dispatch("/projects/demo", {
    headers: { "x-pilot-access-code": "pilot-123" },
  });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.project.id, "project-smart-controller");
});
