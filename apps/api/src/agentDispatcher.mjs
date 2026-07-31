import { randomUUID } from "node:crypto";

const dispatchableStatuses = new Set([
  "READY_FOR_AGENT",
  "NEEDS_AGENT_REVISION",
]);
const activeJobStatuses = new Set(["QUEUED", "RUNNING"]);

function activeJobExists(store, workPackageId) {
  return (store.agentJobs || []).some(
    (job) => (
      job.workPackageId === workPackageId
      && activeJobStatuses.has(job.status)
    ),
  );
}

function queueWorkPackage(
  store,
  workPackage,
  {
    requestedByUserId = "system",
    dispatchReason = "WORK_READY",
    now = () => new Date().toISOString(),
    idFactory = () => `agent-job-${randomUUID()}`,
  } = {},
) {
  if (
    !workPackage
    || !dispatchableStatuses.has(workPackage.status)
    || activeJobExists(store, workPackage.id)
  ) {
    return null;
  }
  const rolePair = (store.rolePairs || []).find(
    (item) => item.id === workPackage.rolePairId,
  );
  if (!rolePair?.agentKey) {
    return null;
  }

  const createdAt = now();
  const job = {
    id: idFactory(),
    projectId: workPackage.projectId,
    workPackageId: workPackage.id,
    agentKey: rolePair.agentKey,
    inputRefs: [
      `project:${workPackage.projectId}`,
      `work-package:${workPackage.id}`,
    ],
    draftMarkdown: null,
    requestedByUserId,
    dispatchReason,
    status: "QUEUED",
    createdAt,
    startedAt: null,
    completedAt: null,
    resultStatusCode: null,
    agentRunId: null,
    error: "",
  };
  store.agentJobs ||= [];
  store.agentJobs.push(job);
  workPackage.status = "READY_FOR_AGENT";
  return job;
}

export function queueReadyAgentJobs(
  store,
  {
    projectId,
    phaseId,
    requestedByUserId = "system",
    now,
    idFactory,
  } = {},
) {
  return (store.workPackages || [])
    .filter((item) => item.projectId === projectId)
    .filter((item) => !phaseId || item.phaseId === phaseId)
    .map((workPackage) => queueWorkPackage(store, workPackage, {
      requestedByUserId,
      dispatchReason: "WORK_READY",
      now,
      idFactory,
    }))
    .filter(Boolean);
}

export function queueRevisionAgentJob(store, workPackage, options = {}) {
  return queueWorkPackage(store, workPackage, {
    ...options,
    dispatchReason: "HUMAN_REQUESTED_REVISION",
  });
}
