# Pilot Feedback Triage Endpoint

## Goal

Continue M7 by turning pilot feedback priority and status rules into a read-only API that can be used during the first real retrospective.

## Scope

- Add triage rules to `pilotFeedbackLedger`.
- Expose `/pilot/feedback-triage` with priority lanes, status transitions, planning criteria, and links.
- Link the endpoint from `/pilot/readiness`, the React pilot readiness panel, and the pilot archive diagnostics.
- Document the endpoint in the internal pilot guide and API flow.

## Acceptance

- Server tests cover the readiness link and endpoint response.
- Pilot archive tests cover triage metadata and diagnostics.
- `npm run pilot:check` passes before reporting completion.

