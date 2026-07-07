# Pilot Trial Scope Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-trial scope and runtime strategy artifacts to every pilot archive.

**Architecture:** Extend existing `pilotPlan.mjs` with trial scope defaults and wire them through `pilotArchive.mjs` into Markdown/JSON files plus manifest references.

**Tech Stack:** Node.js ESM, `node:test`, existing pilot archive generator.

## Global Constraints

- First trial scope is 4-8 people and one real or semi-real hardware project.
- First trial runtime default remains JSON store.
- PostgreSQL is migration verification only unless explicitly selected for a separate database drill.
- No new dependencies.

---

### Task 1: Add Failing Archive Test

**Files:**
- Modify: `apps/api/src/pilotArchive.test.mjs`

**Interfaces:**
- Consumes: `preparePilotArchive(outputDir)`.
- Produces: assertions for `pilot-trial-scope.md/json` and `manifest.trialScope`.

- [ ] **Step 1: Add assertions**

Assert the manifest has:

```js
assert.equal(manifest.files.trialScopeMarkdown, "pilot-trial-scope.md");
assert.equal(manifest.files.trialScopeJson, "pilot-trial-scope.json");
assert.equal(manifest.trialScope.templatePath, "pilot-trial-scope.md");
assert.equal(manifest.trialScope.participantRange, "4-8");
assert.equal(manifest.trialScope.defaultRuntimeSource, "json");
assert.equal(manifest.trialScope.postgresPolicy, "migration_verification_only");
assert.equal(manifest.trialScope.roles.includes("项目经理"), true);
assert.equal(manifest.trialScope.excludedScopes.includes("生产级 TLS、反向代理、数据库备份和灾备"), true);
assert.equal(fs.existsSync(path.join(outputDir, manifest.files.trialScopeMarkdown)), true);
assert.equal(fs.existsSync(path.join(outputDir, manifest.files.trialScopeJson)), true);
const trialScopeMarkdown = fs.readFileSync(path.join(outputDir, "pilot-trial-scope.md"), "utf8");
assert.match(trialScopeMarkdown, /内部试点范围与运行策略/);
assert.match(trialScopeMarkdown, /4-8/);
assert.match(trialScopeMarkdown, /JSON store/);
assert.match(trialScopeMarkdown, /PostgreSQL/);
assert.match(trialScopeMarkdown, /项目经理/);
```

- [ ] **Step 2: Verify RED**

Run: `node --test apps/api/src/pilotArchive.test.mjs`

Expected: FAIL because `manifest.files.trialScopeMarkdown` is undefined.

### Task 2: Generate Trial Scope Artifacts

**Files:**
- Modify: `apps/api/src/pilotPlan.mjs`
- Modify: `apps/api/src/pilotArchive.mjs`

**Interfaces:**
- Produces: `pilotTrialScope`.
- Produces: `manifest.trialScope`.
- Produces: `pilot-trial-scope.md` and `pilot-trial-scope.json`.

- [ ] **Step 1: Add scope data**

Include participant range, roles, project recommendation, phase range, runtime policy, PostgreSQL policy, prerequisites, and excluded scopes.

- [ ] **Step 2: Add Markdown renderer**

Render a decision record with "决策", "参与者", "运行策略", "不纳入本轮", and "待确认".

- [ ] **Step 3: Wire archive output**

Add files, manifest property, and write calls.

- [ ] **Step 4: Verify GREEN**

Run: `node --test apps/api/src/pilotArchive.test.mjs`

Expected: PASS.

### Task 3: Update Docs And Roadmap

**Files:**
- Modify: `docs/internal-pilot.md`
- Modify: `roadmap.md`

**Interfaces:**
- Documents the new scope artifact as the owner of first-trial audience and runtime strategy decisions.

- [ ] **Step 1: Update docs**

Mention `pilot-trial-scope.md/json` in archive contents and release candidate checks.

- [ ] **Step 2: Update roadmap**

Append a 2026-07-02 M6 row noting the trial scope artifact.

- [ ] **Step 3: Verify**

Run: `node --test apps/api/src/pilotArchive.test.mjs`

Run: `npm run pilot:check`
