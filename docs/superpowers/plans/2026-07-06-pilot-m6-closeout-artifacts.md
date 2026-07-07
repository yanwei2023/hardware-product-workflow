# Pilot M6 Closeout Artifacts Implementation Plan

**Goal:** Add a closeout decision artifact to every pilot archive so the team can decide whether M6 release materials are ready to close after the operator walkthrough.

**Architecture:** Extend the existing pilot archive generator with `pilotM6Closeout` plan data, a `manifest.m6Closeout` object, and generated `pilot-m6-closeout.md/json` files.

**Constraints:**

- No new dependencies.
- Keep the closeout page short and decision-oriented.
- Reference existing archive artifacts instead of duplicating their content.
- `npm run pilot:check` must continue to pass.

## Tasks

- [x] Add failing archive assertions for `pilot-m6-closeout.md/json`.
- [x] Verify RED with `node --test apps/api/src/pilotArchive.test.mjs`.
- [x] Add M6 closeout plan data covering archive completeness, operator walkthrough, rollback readiness, feedback capture, and PostgreSQL policy.
- [x] Render Markdown with recommendation, criteria, current archive status, remaining decisions, and closeout record fields.
- [x] Wire file paths, manifest data, and write calls.
- [x] Verify GREEN with `node --test apps/api/src/pilotArchive.test.mjs`.
- [x] Update internal pilot docs, LAN deployment handoff checklist, and roadmap.
