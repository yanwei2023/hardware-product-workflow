# Pilot Feedback Plan Endpoint

## Goal

Start M7 without expanding the frozen M6 release scope by exposing the existing pilot feedback ledger model through a read-only API and workbench link.

## Scope

- Add `/pilot/feedback-plan` as a read-only endpoint.
- Reuse `pilotFeedbackLedger` as the source of fields, categories, priorities, statuses, and severity guidance.
- Link the endpoint from `/pilot/readiness` and the React pilot readiness panel.
- Document the endpoint in the internal pilot and API flow docs.

## Acceptance

- `apps/api/src/server.test.mjs` covers the endpoint and readiness link.
- The web build succeeds with the new button.
- `npm run pilot:check` passes before claiming completion.

