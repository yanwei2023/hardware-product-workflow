import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("S0 lifecycle rehearsal reaches S1 with queued Agent work", () => {
  const scriptPath = fileURLToPath(
    new URL("./s0LifecycleRehearsal.mjs", import.meta.url),
  );
  const result = spawnSync(process.execPath, [scriptPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      HARDWARE_FLOW_ACCESS_LOG: "0",
    },
  });

  assert.equal(
    result.status,
    0,
    `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.phaseCount, 11);
  assert.equal(report.currentPhaseKey, "s1_market_definition");
  assert.equal(report.formalPhaseCount, 10);
  assert.equal(report.s1QueuedAgentJobCount > 0, true);
  assert.equal(report.completedSteps.includes("PROJECT_BLUEPRINT_PUBLISHED"), true);
});
