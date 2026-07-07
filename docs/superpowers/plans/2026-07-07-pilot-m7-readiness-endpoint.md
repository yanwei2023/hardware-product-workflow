# Pilot M7 Readiness Endpoint

## Goal

Expose whether the M7 feedback closure infrastructure is ready while clearly separating it from external real-feedback inputs that cannot be completed by code alone.

## Scope

- Add `/pilot/m7-readiness` as a read-only endpoint.
- Report feedback plan, triage rules, backlog template, offline archive, and real feedback as separate criteria.
- Link the endpoint from `/pilot/readiness`, the React pilot readiness panel, and pilot archive diagnostics.
- Document the endpoint in API flow, internal pilot guide, and roadmap.

## Acceptance

- Server tests cover readiness links and the M7 readiness response.
- Pilot archive tests cover diagnostics.
- `npm run pilot:check` passes before reporting completion.

