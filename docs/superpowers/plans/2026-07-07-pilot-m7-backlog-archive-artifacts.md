# Pilot M7 Backlog Archive Artifacts

## Goal

Make the M7 backlog planning template available in the offline pilot archive, not only through the live API.

## Scope

- Add `pilot-m7-backlog.md` and `pilot-m7-backlog.json` to the pilot archive.
- Render the Markdown from the same M7 backlog status model used by `/pilot/m7-backlog.md`.
- Add the backlog template to archive navigation for retrospective workflows.
- Document the new archive files in the internal pilot guide and roadmap.

## Acceptance

- Pilot archive tests cover manifest files, written files, Markdown content, and navigation links.
- `npm run pilot:check` passes before reporting completion.

