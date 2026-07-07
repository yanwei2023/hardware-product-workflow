# Pilot Ops Alert Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add operations alert recommendation artifacts to each pilot archive so trial hosts know which diagnostics and metrics to watch during an internal pilot.

**Architecture:** Extend `pilotPlan.mjs` with static alert recommendations and wire them through `pilotArchive.mjs` into Markdown/JSON files plus manifest references.

**Tech Stack:** Node.js ESM, `node:test`, existing pilot archive generator.

## Global Constraints

- Do not add an actual alerting service.
- Keep recommendations usable by a non-core developer with only browser access to diagnostic endpoints.
- Cover readiness, HTTP errors, runtime persistence, storage health, LAN mode, and PostgreSQL preflight policy.
- No new dependencies.

---

### Task 1: Add Failing Archive Test

**Files:**
- Modify: `apps/api/src/pilotArchive.test.mjs`

**Interfaces:**
- Consumes: `preparePilotArchive(outputDir)`.
- Produces: assertions for `pilot-ops-alerts.md/json` and `manifest.opsAlerts`.

- [ ] **Step 1: Add assertions**

Assert:

```js
assert.equal(manifest.files.opsAlertsMarkdown, "pilot-ops-alerts.md");
assert.equal(manifest.files.opsAlertsJson, "pilot-ops-alerts.json");
assert.equal(manifest.opsAlerts.templatePath, "pilot-ops-alerts.md");
assert.equal(manifest.opsAlerts.watchEndpoints.includes("/ops/summary"), true);
assert.equal(manifest.opsAlerts.watchEndpoints.includes("/metrics"), true);
assert.equal(manifest.opsAlerts.rules.some((item) => item.code === "READY_DOWN"), true);
assert.equal(manifest.opsAlerts.rules.some((item) => item.metric === "hardware_flow_http_5xx_total"), true);
assert.equal(manifest.opsAlerts.escalation.includes("S1"), true);
assert.equal(fs.existsSync(path.join(outputDir, manifest.files.opsAlertsMarkdown)), true);
assert.equal(fs.existsSync(path.join(outputDir, manifest.files.opsAlertsJson)), true);
const opsAlertsMarkdown = fs.readFileSync(path.join(outputDir, "pilot-ops-alerts.md"), "utf8");
assert.match(opsAlertsMarkdown, /内部试点运维告警建议/);
assert.match(opsAlertsMarkdown, /\/ops\/summary/);
assert.match(opsAlertsMarkdown, /hardware_flow_http_5xx_total/);
assert.match(opsAlertsMarkdown, /RUNTIME_PERSISTENCE/);
assert.match(opsAlertsMarkdown, /S1/);
```

- [ ] **Step 2: Verify RED**

Run: `node --test apps/api/src/pilotArchive.test.mjs`

Expected: FAIL because `manifest.files.opsAlertsMarkdown` is undefined.

### Task 2: Generate Ops Alert Artifacts

**Files:**
- Modify: `apps/api/src/pilotPlan.mjs`
- Modify: `apps/api/src/pilotArchive.mjs`

**Interfaces:**
- Produces: `pilotOpsAlerts`.
- Produces: `manifest.opsAlerts`.
- Produces: `pilot-ops-alerts.md` and `pilot-ops-alerts.json`.

- [ ] **Step 1: Add alert recommendation data**

Add watch endpoints, rules, and escalation text in `pilotPlan.mjs`.

- [ ] **Step 2: Add Markdown renderer**

Render current ops summary counts plus static rules.

- [ ] **Step 3: Wire archive output**

Add file paths, manifest property, and write calls.

- [ ] **Step 4: Verify GREEN**

Run: `node --test apps/api/src/pilotArchive.test.mjs`

Expected: PASS.

### Task 3: Update Docs And Roadmap

**Files:**
- Modify: `docs/internal-pilot.md`
- Modify: `docs/lan-deployment.md`
- Modify: `roadmap.md`

**Interfaces:**
- Documents `pilot-ops-alerts.md/json` as the M6 operations alert guidance.

- [ ] **Step 1: Update docs**

Mention the alert recommendation artifacts in archive contents and deployment handoff.

- [ ] **Step 2: Update roadmap**

Append a 2026-07-04 M6 row noting ops alert recommendations.

- [ ] **Step 3: Verify**

Run: `node --test apps/api/src/pilotArchive.test.mjs`

Run: `npm run pilot:check`
