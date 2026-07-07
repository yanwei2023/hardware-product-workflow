# Pilot Archive Index Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a top-level pilot archive index so non-core operators can open one file and know which archive artifacts to read first.

**Architecture:** Extend the existing pilot archive generator with an `archiveIndex` manifest object and two generated files: `pilot-archive-index.md` and `pilot-archive-index.json`.

**Tech Stack:** Node.js ESM, `node:test`, existing pilot archive generator.

## Global Constraints

- No new dependencies.
- Keep the index short and operator-focused.
- The index must point to existing generated artifacts, not duplicate their full content.
- `npm run pilot:check` must continue to pass.

---

### Task 1: Add Failing Archive Test

**Files:**
- Modify: `apps/api/src/pilotArchive.test.mjs`

**Interfaces:**
- Consumes: `preparePilotArchive(outputDir)`.
- Produces: assertions for `pilot-archive-index.md/json` and `manifest.archiveIndex`.

- [ ] **Step 1: Add assertions**

Assert the files and high-level reading order exist.

- [ ] **Step 2: Verify RED**

Run: `node --test apps/api/src/pilotArchive.test.mjs`

Expected: FAIL because `manifest.files.archiveIndexMarkdown` is undefined.

### Task 2: Generate Archive Index

**Files:**
- Modify: `apps/api/src/pilotPlan.mjs`
- Modify: `apps/api/src/pilotArchive.mjs`

**Interfaces:**
- Produces: `pilotArchiveIndex`.
- Produces: `manifest.archiveIndex`.
- Produces: `pilot-archive-index.md` and `pilot-archive-index.json`.

- [ ] **Step 1: Add index plan data**

Define primary reading order and situation-specific file pointers.

- [ ] **Step 2: Render Markdown**

Render "先看这几个", "按场景找文件", and "完整文件清单".

- [ ] **Step 3: Wire archive output**

Add file paths, manifest object, and write calls.

- [ ] **Step 4: Verify GREEN**

Run: `node --test apps/api/src/pilotArchive.test.mjs`

Expected: PASS.

### Task 3: Update Docs And Roadmap

**Files:**
- Modify: `docs/internal-pilot.md`
- Modify: `docs/lan-deployment.md`
- Modify: `roadmap.md`

**Interfaces:**
- Documents `pilot-archive-index.md` as the entrypoint for operators.

- [ ] **Step 1: Update docs**

Mention the index in archive contents and handoff checklist.

- [ ] **Step 2: Update roadmap**

Append a 2026-07-04 M6 row.

- [ ] **Step 3: Verify**

Run: `node --test apps/api/src/pilotArchive.test.mjs`

Run: `npm run pilot:check`
