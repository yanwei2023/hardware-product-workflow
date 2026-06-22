# Agent Job Process Incremental Transaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a native PostgreSQL incremental transaction for one `processNextAgentJob` call.

**Architecture:** Follow the existing `postgresIncrementalTransaction.mjs` builder pattern: derive a store delta from previous and next stores, reject unrelated drift, render a narrow SQL transaction, and let runtime persistence perform execution, verification, and compensation. The server will pass `incrementalMutation: { kind: "agent-job-process", agentJobId }` after processing a queued Agent job.

**Tech Stack:** Node.js ESM, `node:test`, existing JSON store and PostgreSQL row mapper utilities.

## Global Constraints

- Do not change Agent output validation behavior.
- Do not split job processing into separate start and complete transactions.
- Do not introduce external queue infrastructure.
- The transaction must fail fast on unrelated store drift.
- Queue processing includes Agent output notifications; the process transaction must model those inserts.
- Use TDD: write the failing test before production code.

---

### Task 1: Add Agent Job Process Transaction Builder

**Files:**
- Modify: `apps/api/src/postgresIncrementalTransaction.test.mjs`
- Modify: `apps/api/src/postgresIncrementalTransaction.mjs`

**Interfaces:**
- Consumes: existing `addAgentJobInStore`, `startAgentJobInStore`, `completeAgentJobInStore`, `recordReadyAgentOutputInStore`, `addAuditEventInStore`.
- Produces: `buildAgentJobProcessTransaction({ previousStore, nextStore, agentJobId })`.

- [x] **Step 1: Write the failing builder test**

Add a helper that queues and processes an Agent job in memory, then add a test asserting the generated SQL label and key table operations:

```js
function agentJobProcessedStores() {
  const previousStore = createDemoStore();
  const nextStore = structuredClone(previousStore);
  const projectId = nextStore.activeProjectId;
  const workPackageId = "wp-evt_exit-evt_test_report";
  const agentJobId = "agent-job-process-target";
  addAgentJobInStore(previousStore, {
    id: agentJobId,
    projectId,
    workPackageId,
    agentKey: "test_agent",
    inputRefs: [],
    draftMarkdown: "## Test Summary\n\nPass.\n\n## Defects\n\nNone.\n\n## Evidence\n\nLab run.",
    requestedByUserId: "user-test-lead",
    status: "QUEUED",
    createdAt: "2026-06-14T04:00:00.000Z",
  });
  addAgentJobInStore(nextStore, structuredClone(previousStore.agentJobs.at(-1)));
  startAgentJobInStore(nextStore, agentJobId, { startedAt: "2026-06-14T04:01:00.000Z" });
  recordReadyAgentOutputInStore(nextStore, workPackageId, {
    runId: "agent-run-process-target",
    agentKey: "test_agent",
    inputRefs: [],
    outputRef: "artifact-agent-run-process-target",
    artifactType: "EVT_TEST_REPORT",
    artifactTemplateKey: "test_report",
    artifactVersion: "v1",
    artifactContent: { markdown: "## Test Summary\n\nPass." },
    validation: { valid: true, missingSections: [] },
    requiredSections: ["Test Summary", "Defects", "Evidence"],
    requiredReviewRoles: ["test_lead"],
    createdAt: "2026-06-14T04:02:00.000Z",
  });
  completeAgentJobInStore(nextStore, agentJobId, {
    status: "COMPLETED",
    resultStatusCode: 200,
    agentRunId: "agent-run-process-target",
    completedAt: "2026-06-14T04:03:00.000Z",
  });
  addAuditEventInStore(nextStore, {
    id: "audit-agent-job-processed",
    projectId,
    actorType: "system",
    actorId: "agent-worker",
    eventType: "AGENT_JOB_PROCESSED",
    objectType: "workPackage",
    objectId: workPackageId,
    payload: {
      agentJobId,
      status: "COMPLETED",
      resultStatusCode: 200,
      agentRunId: "agent-run-process-target",
    },
    createdAt: "2026-06-14T04:03:00.000Z",
  });
  return { previousStore, nextStore, agentJobId };
}

test("builds native incremental agent job process transaction", () => {
  const { previousStore, nextStore, agentJobId } = agentJobProcessedStores();
  const transaction = buildAgentJobProcessTransaction({ previousStore, nextStore, agentJobId });
  assert.equal(transaction.mutationKind, "agent-job-process");
  assert.equal(transaction.mutationId, agentJobId);
  assert.match(transaction.applySql, /^-- Native incremental agent-job-process transaction/m);
  assert.match(transaction.applySql, /UPDATE agent_jobs SET/m);
  assert.match(transaction.applySql, /INSERT INTO agent_runs/m);
  assert.match(transaction.applySql, /INSERT INTO artifact_versions/m);
  assert.match(transaction.applySql, /UPDATE work_packages SET/m);
  assert.match(transaction.applySql, /INSERT INTO audit_events/m);
  assert.match(transaction.applySql, /INSERT INTO notifications/m);
});
```

- [x] **Step 2: Run the focused test and confirm RED**

Run: `node --test apps/api/src/postgresIncrementalTransaction.test.mjs`

Expected: FAIL because `buildAgentJobProcessTransaction` is not exported or not implemented.

- [x] **Step 3: Implement the transaction builder**

In `postgresIncrementalTransaction.mjs`, add a builder that:

- Computes previous and next PostgreSQL rows.
- Compares the delta.
- Allows only `agent_jobs`, `agent_runs`, `artifact_versions`, `work_packages`, `audit_events`, and `notifications`.
- Requires the target `agent_jobs` row to change.
- Allows inserted rows only for `agent_runs`, `artifact_versions`, `audit_events`, and `notifications`.
- Allows changed rows only for the target `agent_jobs` row and its work package.
- Emits SQL to update the changed job row, update the changed work package row, insert new agent runs, insert new artifacts, insert new audit events, and insert new notifications.
- Emits compensation SQL by reversing changed rows and deleting inserted rows.

- [x] **Step 4: Run focused tests and confirm GREEN**

Run: `node --test apps/api/src/postgresIncrementalTransaction.test.mjs`

Expected: PASS for the new builder test and existing transaction builder tests.

### Task 2: Wire Runtime Mutation Into Server

**Files:**
- Modify: `apps/api/src/server.mjs`
- Modify: `apps/api/src/postgresIncrementalTransaction.test.mjs`

**Interfaces:**
- Consumes: `executePostgresIncrementalTransaction({ mutation: { kind: "agent-job-process", agentJobId } })`.
- Produces: `processNextAgentJob` passes the new incremental mutation to `persistStore`.

- [x] **Step 1: Write the failing execution wrapper test**

Add a test mirroring the existing execution wrapper tests:

```js
test("incremental agent job process transaction executes and reports its mutation identity", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hardware-flow-incremental-"));
  const { previousStore, nextStore, agentJobId } = agentJobProcessedStores();
  const result = executePostgresIncrementalTransaction({
    previousStore,
    nextStore,
    mutation: { kind: "agent-job-process", agentJobId },
    databaseUrl: "postgres://user:secret@example.test/db",
    outputDir: dir,
    executeSqlFile: () => ({ status: 0, stdout: "BEGIN\nCOMMIT\n", stderr: "" }),
    readDatabaseRows: () => mapStoreToPostgresRows(nextStore),
  });
  assert.equal(result.ok, true);
  assert.equal(result.mode, "INCREMENTAL_TRANSACTION");
  assert.equal(result.mutationKind, "agent-job-process");
  assert.equal(result.mutationId, agentJobId);
});
```

- [x] **Step 2: Run focused tests and confirm RED**

Run: `node --test apps/api/src/postgresIncrementalTransaction.test.mjs`

Expected: FAIL because `executePostgresIncrementalTransaction` does not route `agent-job-process`.

- [x] **Step 3: Route the mutation and update server persistence options**

In `postgresIncrementalTransaction.mjs`, add `agent-job-process` to the mutation switch.

In `server.mjs`, replace the final `persistStore()` in `processNextAgentJob` with:

```js
persistStore({
  incrementalMutation: {
    kind: "agent-job-process",
    agentJobId: queuedJob.id,
  },
});
```

- [x] **Step 4: Run focused tests and confirm GREEN**

Run: `node --test apps/api/src/postgresIncrementalTransaction.test.mjs`

Expected: PASS.

### Task 3: Update Roadmap and Run Verification

**Files:**
- Modify: `roadmap.md`

**Interfaces:**
- Consumes: completed implementation and passing focused tests.
- Produces: roadmap progress entry for the M5 Agent job process transaction.

- [x] **Step 1: Update roadmap progress**

Append a `2026-06-22` M5 row describing the completed `agent-job-process` incremental transaction and the next remaining M5 step.

- [x] **Step 2: Run focused verification**

Run: `node --test apps/api/src/postgresIncrementalTransaction.test.mjs`

Expected: PASS.

- [x] **Step 3: Run broader release-facing verification if feasible**

Run: `npm run release:check`

Expected: PASS, or document the exact blocker if local dependencies or services prevent it.
