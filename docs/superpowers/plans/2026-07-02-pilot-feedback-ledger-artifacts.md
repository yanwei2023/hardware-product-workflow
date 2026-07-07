# Pilot Feedback Ledger Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a feedback ledger template to every pilot archive so trial feedback can be recorded consistently and mapped to M6/M7 follow-up.

**Architecture:** Extend the existing pilot archive generator. Keep the issue report template for individual incidents, and add a separate feedback ledger for grouped follow-up, ownership, priority, milestone mapping, and status.

**Tech Stack:** Node.js ESM, `node:test`, existing `pilotPlan.mjs` and `pilotArchive.mjs`.

## Global Constraints

- Do not add dependencies.
- Keep generated artifacts inside `pilot:archive`.
- Feedback ledger must be usable offline as Markdown and machine-readable as JSON.
- Preserve existing issue report and rollback card behavior.

---

### Task 1: Add Failing Archive Test

**Files:**
- Modify: `apps/api/src/pilotArchive.test.mjs`

**Interfaces:**
- Consumes: `preparePilotArchive(outputDir)`.
- Produces: assertions for `pilot-feedback-ledger.md`, `pilot-feedback-ledger.json`, `manifest.feedbackLedger`, categories, priorities, statuses, and milestone mapping.

- [ ] **Step 1: Add assertions**

Add checks that manifest and files include the feedback ledger:

```js
assert.equal(manifest.files.feedbackLedgerMarkdown, "pilot-feedback-ledger.md");
assert.equal(manifest.files.feedbackLedgerJson, "pilot-feedback-ledger.json");
assert.equal(manifest.feedbackLedger.templatePath, "pilot-feedback-ledger.md");
assert.equal(manifest.feedbackLedger.fields.includes("后续节点"), true);
assert.equal(manifest.feedbackLedger.categories.includes("流程适配"), true);
assert.equal(manifest.feedbackLedger.priorities.includes("P0"), true);
assert.equal(manifest.feedbackLedger.statuses.includes("OPEN"), true);
assert.equal(manifest.feedbackLedger.defaultMilestone, "M7");
assert.equal(fs.existsSync(path.join(outputDir, manifest.files.feedbackLedgerMarkdown)), true);
assert.equal(fs.existsSync(path.join(outputDir, manifest.files.feedbackLedgerJson)), true);
const feedbackLedgerMarkdown = fs.readFileSync(path.join(outputDir, "pilot-feedback-ledger.md"), "utf8");
assert.match(feedbackLedgerMarkdown, /内部试点反馈台账/);
assert.match(feedbackLedgerMarkdown, /后续节点/);
assert.match(feedbackLedgerMarkdown, /M7/);
assert.match(feedbackLedgerMarkdown, /P0/);
assert.match(feedbackLedgerMarkdown, /OPEN/);
```

- [ ] **Step 2: Verify RED**

Run: `node --test apps/api/src/pilotArchive.test.mjs`

Expected: FAIL because `manifest.files.feedbackLedgerMarkdown` is undefined.

### Task 2: Generate Feedback Ledger Artifacts

**Files:**
- Modify: `apps/api/src/pilotPlan.mjs`
- Modify: `apps/api/src/pilotArchive.mjs`

**Interfaces:**
- Produces: `pilotFeedbackLedger` export.
- Produces: `manifest.feedbackLedger`.
- Produces: `pilot-feedback-ledger.md` and `pilot-feedback-ledger.json`.

- [ ] **Step 1: Add feedback ledger plan data**

Define fields, categories, priorities, statuses, and default milestone in `pilotPlan.mjs`.

- [ ] **Step 2: Render Markdown**

Add `renderPilotFeedbackLedgerMarkdown(manifest)` that outputs a blank table and field guide.

- [ ] **Step 3: Write files**

Add files to `files`, manifest, and archive writes.

- [ ] **Step 4: Verify GREEN**

Run: `node --test apps/api/src/pilotArchive.test.mjs`

Expected: PASS.

### Task 3: Update Docs And Roadmap

**Files:**
- Modify: `docs/internal-pilot.md`
- Modify: `roadmap.md`

**Interfaces:**
- Documents: feedback ledger appears in the archive and is the bridge into M7.

- [ ] **Step 1: Update docs**

Mention `pilot-feedback-ledger.md` and `.json` in archive contents and issue handling guidance.

- [ ] **Step 2: Update roadmap**

Append a 2026-07-02 M6 row noting feedback ledger artifacts.

- [ ] **Step 3: Verify**

Run: `node --test apps/api/src/pilotArchive.test.mjs`

Run: `npm run pilot:check`
