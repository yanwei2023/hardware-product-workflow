# Pilot Handoff Walkthrough Artifacts Implementation Plan

**Goal:** Add a lightweight handoff walkthrough artifact to every pilot archive so a non-core developer can prove they can use the archive without help.

**Architecture:** Extend the existing pilot archive generator with `pilotHandoffWalkthrough` plan data, a `manifest.handoffWalkthrough` object, and generated `pilot-handoff-walkthrough.md/json` files.

**Constraints:**

- No new dependencies.
- Do not duplicate the full archive content; point to the source artifacts.
- Keep the checklist operator-focused.
- `npm run pilot:check` must continue to pass.

## Tasks

- [x] Add failing archive assertions for `pilot-handoff-walkthrough.md/json`.
- [x] Verify RED with `node --test apps/api/src/pilotArchive.test.mjs`.
- [x] Add walkthrough plan data covering archive entry, startup checks, incident simulation, rollback path, and retro capture.
- [x] Render Markdown with steps, required evidence, current status, and a final conclusion area.
- [x] Wire file paths, manifest data, and write calls.
- [x] Verify GREEN with `node --test apps/api/src/pilotArchive.test.mjs`.
- [x] Update internal pilot docs, LAN deployment handoff checklist, and roadmap.
