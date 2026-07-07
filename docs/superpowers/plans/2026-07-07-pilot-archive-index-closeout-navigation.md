# Pilot Archive Index Closeout Navigation Implementation Plan

**Goal:** Make `pilot-archive-index.md` the real single entrypoint by adding navigation to the handoff walkthrough and M6 closeout artifacts.

**Architecture:** Update `pilotArchiveIndex` plan data only. The existing archive renderer already turns `primaryReadOrder` and `bySituation` into Markdown and JSON.

**Constraints:**

- No new generated artifact.
- Keep the index short and operator-focused.
- Preserve existing archive generation and `npm run pilot:check`.

## Tasks

- [x] Add failing assertions that `pilot-archive-index.md/json` include `pilot-handoff-walkthrough.md` and `pilot-m6-closeout.md`.
- [x] Verify RED with `node --test apps/api/src/pilotArchive.test.mjs`.
- [x] Add the two artifacts to the primary read order.
- [x] Add scene navigation for `交接走查` and `M6 收尾`.
- [x] Verify GREEN with `node --test apps/api/src/pilotArchive.test.mjs`.
- [x] Update docs and roadmap.
