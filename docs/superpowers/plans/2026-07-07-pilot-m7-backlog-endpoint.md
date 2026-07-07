# Pilot M7 Backlog Endpoint

## Goal

Continue M7 by defining how triaged pilot feedback becomes a verifiable backlog item without requiring real feedback data yet.

## Scope

- Add M7 backlog fields, sort order, Ready definition, acceptance evidence, and default buckets to `pilotFeedbackLedger`.
- Expose `/pilot/m7-backlog` as a read-only planning endpoint.
- Link the endpoint from `/pilot/readiness`, the React pilot readiness panel, and pilot archive diagnostics.
- Document the endpoint in the internal pilot guide and API flow.

## Acceptance

- Server tests cover the readiness link and endpoint response.
- Pilot archive tests cover backlog metadata and diagnostics.
- `npm run pilot:check` passes before reporting completion.

