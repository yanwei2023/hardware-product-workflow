# Pilot M7 Backlog Markdown

## Goal

Make the M7 backlog planning rules usable in a retrospective by exporting a meeting-ready Markdown template from the existing backlog status model.

## Scope

- Add `/pilot/m7-backlog.md` as a read-only Markdown endpoint.
- Render the template from `getPilotM7BacklogStatus()` to avoid duplicating backlog rules.
- Link the Markdown endpoint from `/pilot/readiness`, the React pilot readiness panel, and pilot archive diagnostics.
- Document the endpoint in the internal pilot guide and API flow.

## Acceptance

- Server tests cover the Markdown endpoint and readiness link.
- Pilot archive tests cover diagnostics for the Markdown endpoint.
- `npm run pilot:check` passes before reporting completion.

