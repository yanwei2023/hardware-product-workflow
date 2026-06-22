# Agent Job Process Incremental Transaction Design

## Context

M5 is extending runtime PostgreSQL mirror mode from exact full-store mirroring toward native incremental transactions for high-value write paths. Agent job queue creation is already covered by the `agent-job-queue` incremental mutation, but `processNextAgentJob` still persists through the fallback exact mirror path.

This path is important because an Agent worker can call it repeatedly. A single processed job can update the queued job, create an Agent run, create a draft artifact, update the work package status, and append an audit event.

## Goal

Add a native PostgreSQL incremental mutation for one synchronous `processNextAgentJob` call.

The new mutation kind is:

```text
agent-job-process
```

It is keyed by `agentJobId`.

## Scope

The transaction should support the data changes produced by processing one queued Agent job:

- `agent_jobs`: update started/completed metadata, final status, result status code, linked Agent run, and error.
- `agent_runs`: insert the Agent run created by the local worker execution, when present.
- `artifact_versions`: insert the generated draft artifact, when present.
- `work_packages`: update the work package status caused by the Agent output result.
- `audit_events`: insert the `AGENT_JOB_PROCESSED` audit event.
- `notifications`: insert Agent output notifications produced during job processing.

The transaction should reject unrelated store drift. If the worker result later changes additional tables, the builder must fail fast until those tables are explicitly modeled.

## Out Of Scope

- Splitting job processing into separate start and complete transactions.
- Introducing an asynchronous external queue.
- Changing Agent output validation behavior.
- Changing the worker API response shape.
- Converting project import, project creation, backup restore, checkpoint restore, or demo reset to incremental writes.

## Data Flow

1. `processNextAgentJob` finds the oldest queued job.
2. The server starts the job in memory.
3. The local worker runs and records the Agent output through existing store logic.
4. `runAgentWorkPackage` can defer its internal persistence when called from queue processing.
5. The server completes the job in memory and appends an audit event.
6. `persistStore` receives `incrementalMutation: { kind: "agent-job-process", agentJobId }`.
7. Runtime persistence writes JSON first, then executes the native PostgreSQL transaction.
8. The transaction verifies the full PostgreSQL store against the next JSON store.
9. On verification drift, existing compensation and fail-closed handling are used.

## Error Handling

The builder should throw clear errors when:

- The target Agent job is missing in either previous or next store.
- The Agent job row did not change.
- The mutation contains unrelated table drift.
- Unsupported row additions, deletions, or changes appear outside the modeled tables.

Runtime persistence should continue using the existing fail-closed behavior for failed execution, verification drift, and failed compensation.

## Testing

Add tests before production changes:

- A builder test that processes a queued Agent job in a demo store and verifies the generated SQL starts with the expected transaction label.
- Assertions that the SQL updates `agent_jobs` and inserts the resulting `agent_runs`, `artifact_versions`, `audit_events`, and `notifications` rows when present.
- An execution wrapper test that reports `mutationKind: "agent-job-process"` and `mutationId` equal to the processed job id.

The focused verification command is:

```text
node --test apps/api/src/postgresIncrementalTransaction.test.mjs
```
