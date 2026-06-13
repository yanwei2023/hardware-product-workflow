import http from "node:http";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildProjectFromTemplate, getHardwarePhaseTemplate } from "./templateEngine.mjs";
import {
  getArtifactTemplateRegistry,
  loadArtifactTemplateByKey,
  loadArtifactTemplateByType,
} from "./artifactTemplateStore.mjs";
import { validateArtifactMarkdown } from "./artifactValidator.mjs";
import {
  createStoreCheckpoint,
  deleteStoreFromDisk,
  getBackupPath,
  getStorePath,
  listStoreCheckpoints,
  loadStoreFromDisk,
  restoreStoreFromBackup,
  restoreStoreFromCheckpoint,
  saveStoreToDisk,
} from "./persistence.mjs";
import {
  canAcceptRisk,
  canCloseRisk,
  canApproveGate,
  canApproveWorkPackage,
  canReviewWorkPackage,
  findUser,
  getDemoUsers,
} from "./permissionStore.mjs";
import { firstPilotAcceptanceCriteria, firstPilotBoundaries, firstPilotRunbookSteps, pilotIssueReport, pilotRollbackCard } from "./pilotPlan.mjs";
import {
  addAuditEventInStore,
  addAgentJobInStore,
  addGateApprovalPackInStore,
  addNotificationInStore,
  addProjectGraphInStore,
  addRiskInStore,
  addWorkPackageEvidenceRefInStore,
  approveGateInStore,
  archiveProjectInStore,
  completeReviewConditionsInStore,
  completeAgentJobInStore,
  completeRiskMitigationInStore,
  countWorkPackagesByRolePair,
  findGate,
  findNextQueuedAgentJob,
  findLatestPendingArtifactForWorkPackage,
  findNotification,
  findPhase,
  findProject,
  findReview,
  findRolePair,
  findRisk,
  findWorkPackage,
  getGateReviewPackReadModel,
  getLatestGateApprovalPack,
  getActiveProjectReadModel,
  getCurrentGate,
  getCurrentProject,
  getGateReadinessReadModel,
  getProjectRiskRegisterReadModel,
  getProjectSnapshotReadModel,
  getProjectUserNotifications,
  getStoreRuntimeSummary,
  getUserActionItemsReadModel,
  getWorkPackageReadModel,
  markNotificationReadInStore,
  markProjectUserNotificationsReadInStore,
  projectExists,
  recordInvalidAgentOutputInStore,
  recordReadyAgentOutputInStore,
  restoreProjectInStore,
  selectProjectInStore,
  startAgentJobInStore,
  submitHumanReviewInStore,
  updateRolePairOwnerInStore,
  updateGateReadinessInStore,
  updateRiskMitigationInStore,
  updateRiskStatusInStore,
  updateWorkPackageScheduleInStore,
} from "./storeRepository.mjs";
import { validateStoreFile } from "./storeDoctor.mjs";
import { bootstrapRuntimeStore } from "./runtimeStoreBootstrap.mjs";
import { createDemoStore } from "./demoStoreFactory.mjs";
import { checkRuntimeWriteAccess, resolveRuntimeWritePolicy } from "./runtimeWritePolicy.mjs";
import { createRuntimePersistence } from "./runtimePersistence.mjs";

export { createDemoStore } from "./demoStoreFactory.mjs";

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || "127.0.0.1";
const workspaceRoot = path.resolve(import.meta.dirname, "../../..");
const reactStaticRoot = path.join(workspaceRoot, "apps/web/dist");
const fallbackStaticRoot = path.join(workspaceRoot, "apps/static");
const evidenceFilesRoot = path.join(workspaceRoot, "data/evidence-files");
const reactStaticAvailable = fs.existsSync(path.join(reactStaticRoot, "index.html"));
const staticRoot = reactStaticAvailable ? reactStaticRoot : fallbackStaticRoot;
const staticMode = reactStaticAvailable ? "react" : "static";
const packageMetadata = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "package.json"), "utf8"));
const serviceMetadata = {
  service: "hardware-flow-api",
  packageName: packageMetadata.name,
  version: packageMetadata.version,
};

function parsePositiveIntegerEnv(name, fallbackValue) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallbackValue;
}

const accessLogEnabled = process.env.HARDWARE_FLOW_ACCESS_LOG !== "0";
const maxJsonBodyBytes = parsePositiveIntegerEnv("HARDWARE_FLOW_MAX_JSON_BODY_BYTES", 1_048_576);
const requestTimeoutMs = parsePositiveIntegerEnv("HARDWARE_FLOW_REQUEST_TIMEOUT_MS", 120_000);
const pilotAccessCode = String(process.env.HARDWARE_FLOW_PILOT_ACCESS_CODE || "").trim();
const pilotAccessEnabled = Boolean(pilotAccessCode);
const requestCounters = {
  total: 0,
  clientErrors: 0,
  errors: 0,
  durationMsTotal: 0,
  durationMsMax: 0,
  byMethod: new Map(),
};
let isShuttingDown = false;
const allowedReviewDecisions = new Set(["APPROVE", "APPROVE_WITH_CONDITIONS", "REQUEST_REVISION", "REJECT"]);
const allowedRiskStatuses = new Set(["OPEN", "ACCEPTED", "CLOSED"]);
const allowedRiskSeverities = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const closedWorkPackageStatuses = new Set(["HUMAN_APPROVED", "LOCKED", "REJECTED", "CANCELLED"]);

function validationError(message, details = {}) {
  return {
    statusCode: 400,
    body: {
      error: message,
      ...details,
    },
  };
}

function dateOnly(value = new Date()) {
  return new Date(value).toISOString().slice(0, 10);
}

function daysUntil(dateValue, fromValue = new Date()) {
  const target = Date.parse(`${dateValue}T00:00:00.000Z`);
  const from = Date.parse(`${dateOnly(fromValue)}T00:00:00.000Z`);
  return Math.round((target - from) / 86400000);
}

function workPackageScheduleStatus(workPackage, today = new Date()) {
  if (!workPackage.dueAt) {
    return "UNSCHEDULED";
  }
  if (closedWorkPackageStatuses.has(workPackage.status)) {
    return "DONE";
  }
  const remainingDays = daysUntil(workPackage.dueAt, today);
  if (remainingDays < 0) {
    return "OVERDUE";
  }
  if (remainingDays <= 3) {
    return "DUE_SOON";
  }
  return "ON_TRACK";
}

function hasRiskMitigationPlan(risk) {
  return Boolean(risk.mitigationOwnerUserId || risk.mitigationDueAt || risk.mitigation);
}

function summarizeRiskMitigations(risks) {
  const plannedRisks = risks.filter(hasRiskMitigationPlan);
  const openRisks = plannedRisks.filter((risk) => risk.mitigationStatus !== "DONE" && risk.status !== "CLOSED");
  return {
    mitigationPlanCount: plannedRisks.length,
    openMitigationCount: openRisks.length,
    overdueMitigationCount: openRisks.filter((risk) => workPackageScheduleStatus({ dueAt: risk.mitigationDueAt, status: "OPEN" }) === "OVERDUE").length,
    completedMitigationCount: plannedRisks.filter((risk) => risk.mitigationStatus === "DONE").length,
  };
}

const runtimeStoreBootstrap = bootstrapRuntimeStore({
  localStore: loadStoreFromDisk(),
  createFallbackStore: createDemoStore,
  activeProjectId: process.env.HARDWARE_FLOW_POSTGRES_ACTIVE_PROJECT_ID || null,
});
let store = runtimeStoreBootstrap.store;
const runtimeStoreSourceStatus = runtimeStoreBootstrap.status;
ensureStoreShape();
saveStoreToDisk(store);
const runtimePersistence = createRuntimePersistence({ initialStore: store });
runtimeStoreSourceStatus.writeBackend = runtimePersistence.backend === "postgres-mirror"
  ? "json-file+postgres-mirror"
  : "json-file";
let runtimeWritePolicy = resolveRuntimeWritePolicy({
  runtimeSource: runtimeStoreSourceStatus,
  persistenceBackend: runtimePersistence.backend,
});

function persistStore() {
  try {
    runtimePersistence.persist(store);
  } catch (error) {
    store = runtimePersistence.getCommittedStore();
    throw error;
  }
}

function ensureStoreShape() {
  store.notifications ||= [];
  store.evidenceRefs ||= [];
  store.gateApprovalPacks ||= [];
  store.agentJobs ||= [];
}

export function getStorageStatus() {
  const storePath = getStorePath();
  const backupPath = getBackupPath(storePath);
  const exists = fs.existsSync(storePath);
  const backupExists = fs.existsSync(backupPath);
  const stat = exists ? fs.statSync(storePath) : null;
  const backupStat = backupExists ? fs.statSync(backupPath) : null;
  const runtimeSummary = getStoreRuntimeSummary(store);
  return {
    storePath,
    backupPath,
    exists,
    backupExists,
    sizeBytes: stat?.size || 0,
    backupSizeBytes: backupStat?.size || 0,
    updatedAt: stat?.mtime?.toISOString() || null,
    backupUpdatedAt: backupStat?.mtime?.toISOString() || null,
    checkpoints: listStoreCheckpoints({ storePath }).slice(0, 8),
    runtimeSource: runtimeStoreSourceStatus,
    runtimeWrite: runtimeWritePolicy,
    runtimePersistence: runtimePersistence.getStatus(),
    ...runtimeSummary,
  };
}

export function getRuntimeConfigStatus() {
  return {
    ...serviceMetadata,
    nodeEnv: process.env.NODE_ENV || "development",
    host,
    port,
    workspaceRoot,
    storePath: getStorePath(),
    runtimeStoreSource: runtimeStoreSourceStatus,
    runtimeWrite: runtimeWritePolicy,
    runtimePersistence: runtimePersistence.getStatus(),
    staticMode,
    staticRoot,
    reactStaticRoot,
    fallbackStaticRoot,
    reactStaticAvailable,
    accessLogEnabled,
    pilotAccessEnabled,
    maxJsonBodyBytes,
    requestTimeoutMs,
    shuttingDown: isShuttingDown,
  };
}

function getPrivateNetworkAddresses() {
  return Object.entries(os.networkInterfaces())
    .flatMap(([name, entries = []]) =>
      entries
        .filter((entry) => entry.family === "IPv4" && !entry.internal)
        .map((entry) => ({
          name,
          address: entry.address,
          family: entry.family,
          mac: entry.mac,
        })),
    )
    .sort((a, b) => a.name.localeCompare(b.name) || a.address.localeCompare(b.address));
}

export function getRuntimeNetworkStatus() {
  const localUrls = [
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
  ];
  const networkInterfaces = getPrivateNetworkAddresses();
  const lanUrls = networkInterfaces.map((item) => `http://${item.address}:${port}`);
  const lanMode = host === "0.0.0.0" || host === "::";
  const warnings = [];

  if (!lanMode) {
    warnings.push({
      code: "LOOPBACK_ONLY",
      message: "当前服务只监听本机地址。局域网试点请使用 npm run start:lan 或 HOST=0.0.0.0 npm start。",
    });
  }
  if (networkInterfaces.length === 0) {
    warnings.push({
      code: "NO_LAN_ADDRESS",
      message: "未发现可用于局域网访问的 IPv4 地址，请确认网络连接。",
    });
  }
  const ready = lanMode && networkInterfaces.length > 0;
  const preferredUrl = ready ? lanUrls[0] : localUrls[0];
  const shareableUrls = ready ? lanUrls : localUrls;
  const shareText = [
    "内部试点访问地址",
    `推荐地址：${preferredUrl}`,
    `监听模式：${lanMode ? "LAN" : "本机"}`,
    ready ? "同一局域网成员可直接打开推荐地址。" : "当前仅适合本机访问；局域网试点请使用 npm run start:lan 重新启动。",
    "诊断：/runtime/network、/ready、/pilot/launch",
  ].join("\n");

  return {
    host,
    port,
    ready,
    lanMode,
    preferredUrl,
    shareableUrls,
    shareText,
    localUrls,
    lanUrls,
    networkInterfaces,
    warnings,
    command: "npm run start:lan",
  };
}

export function getOpsSummaryStatus() {
  const readiness = getReadinessStatus();
  const runtimeConfig = getRuntimeConfigStatus();
  const runtimeNetwork = getRuntimeNetworkStatus();
  const storageStatus = getStorageStatus();
  const pilotReadiness = getPilotReadinessStatus();
  const avgDurationMs = requestCounters.total ? requestCounters.durationMsTotal / requestCounters.total : 0;
  const warnings = [
    ...(runtimeNetwork.warnings || []),
    ...(pilotReadiness.warnings || []),
  ];
  if (runtimeStoreSourceStatus.degraded) {
    warnings.push({
      code: "POSTGRES_STARTUP_FALLBACK",
      message: "PostgreSQL 启动快照不可用，当前进程已降级到 JSON store。",
      details: runtimeStoreSourceStatus.errors,
    });
  }
  if (!runtimeWritePolicy.writable) {
    warnings.push({
      code: "RUNTIME_READ_ONLY",
      message: "当前 API 运行时为只读模式，业务修改请求会被拒绝。",
      details: runtimeWritePolicy,
    });
  }
  const persistenceStatus = runtimePersistence.getStatus();
  if (persistenceStatus.lastError) {
    warnings.push({
      code: "RUNTIME_PERSISTENCE_DEGRADED",
      message: "最近一次 PostgreSQL 镜像写入失败，业务修改已回滚。",
      details: persistenceStatus,
    });
  }
  const blockers = [
    ...(readiness.ready ? [] : [{ code: "SERVICE_NOT_READY", message: "服务或本地数据未就绪" }]),
    ...(pilotReadiness.blockers || []),
  ];

  if (runtimeConfig.staticMode !== "react") {
    warnings.push({
      code: "STATIC_FALLBACK",
      message: "当前正在使用无构建备用工作台；试点前建议运行 npm run web:build 以启用 React 工作台。",
    });
  }
  if (requestCounters.errors > 0) {
    warnings.push({
      code: "HTTP_5XX_SEEN",
      message: `当前进程已记录 ${requestCounters.errors} 个 HTTP 5xx 响应，请结合访问日志和请求 ID 排查。`,
    });
  }

  return {
    ready: blockers.length === 0,
    generatedAt: new Date().toISOString(),
    service: readiness.service,
    packageName: readiness.packageName,
    version: readiness.version,
    runtime: {
      nodeEnv: runtimeConfig.nodeEnv,
      host: runtimeConfig.host,
      port: runtimeConfig.port,
      staticMode: runtimeConfig.staticMode,
      accessLogEnabled: runtimeConfig.accessLogEnabled,
      shuttingDown: runtimeConfig.shuttingDown,
      writeMode: runtimeWritePolicy.effectiveMode,
      writable: runtimeWritePolicy.writable,
      persistenceBackend: persistenceStatus.backend,
      uptimeSeconds: Number(process.uptime().toFixed(3)),
    },
    network: {
      ready: runtimeNetwork.ready,
      lanMode: runtimeNetwork.lanMode,
      preferredUrl: runtimeNetwork.preferredUrl,
      shareableUrls: runtimeNetwork.shareableUrls,
      localUrls: runtimeNetwork.localUrls,
      lanUrls: runtimeNetwork.lanUrls,
      warnings: runtimeNetwork.warnings,
    },
    http: {
      total: requestCounters.total,
      clientErrors: requestCounters.clientErrors,
      serverErrors: requestCounters.errors,
      avgDurationMs: Number(avgDurationMs.toFixed(2)),
      maxDurationMs: Number(requestCounters.durationMsMax.toFixed(2)),
      byMethod: Object.fromEntries(requestCounters.byMethod.entries()),
    },
    storage: {
      valid: readiness.storage.valid,
      exists: readiness.storage.exists,
      storePath: storageStatus.storePath,
      updatedAt: storageStatus.updatedAt,
      backupExists: storageStatus.backupExists,
      backupValid: readiness.storage.backupValid,
      latestCheckpoint: storageStatus.checkpoints?.[0] || null,
      runtimeSource: runtimeStoreSourceStatus,
      runtimeWrite: runtimeWritePolicy,
      runtimePersistence: persistenceStatus,
    },
    pilot: {
      ready: pilotReadiness.ready,
      project: pilotReadiness.project,
      gate: pilotReadiness.gate,
      checklistSummary: pilotReadiness.checklist?.summary || null,
      commands: pilotReadiness.commands,
      links: pilotReadiness.links,
    },
    blockers,
    warnings,
    nextActions: blockers.length
      ? blockers.map((item) => item.message)
      : [
          "运行 npm run pilot:check 做试点前完整验证。",
          "试点开始前创建数据检查点。",
          "需要局域网访问时使用 npm run start:lan 启动。",
        ],
  };
}

function pilotChecklistItem({
  key,
  title,
  status,
  severity = "RECOMMENDED",
  done = 0,
  total = 1,
  detail = "",
  action = "",
} = {}) {
  return {
    key,
    title,
    status,
    severity,
    done,
    total,
    detail,
    action,
  };
}

export function getPilotChecklistStatus() {
  const project = currentProject();
  const gate = currentGate();
  const snapshot = project ? getProjectSnapshot(project.id) : null;
  const reviewPack = gate ? getGateReviewPack(gate.id) : null;
  const storageStatus = getStorageStatus();
  const phaseWorkPackages = project
    ? store.workPackages.filter((item) => item.projectId === project.id && item.phaseId === project.currentPhaseId)
    : [];
  const rolePairs = project ? store.rolePairs.filter((item) => item.projectId === project.id) : [];
  const agentReadyWorkPackages = phaseWorkPackages.filter((workPackage) =>
    store.artifactVersions.some(
      (artifact) =>
        artifact.workPackageId === workPackage.id &&
        (artifact.status === "PENDING_REVIEW" || artifact.status === "APPROVED" || artifact.status === "LOCKED"),
    ),
  );
  const reviewedWorkPackages = phaseWorkPackages.filter((workPackage) =>
    store.reviews.some(
      (review) =>
        review.workPackageId === workPackage.id &&
        (review.decision === "APPROVE" || review.decision === "APPROVE_WITH_CONDITIONS"),
    ),
  );
  const requiredEvidenceCount = reviewPack?.summary?.requiredEvidenceCount || 0;
  const readyEvidenceCount = reviewPack?.summary?.readyEvidenceCount || 0;
  const hasBlockingRiskWorkflow = (snapshot?.risks || []).some(
    (risk) =>
      risk.blocksGate &&
      (risk.status === "ACCEPTED" ||
        risk.status === "CLOSED" ||
        risk.mitigationOwnerUserId ||
        risk.mitigationDueAt ||
        risk.mitigation),
  );

  const items = [
    pilotChecklistItem({
      key: "checkpoint",
      title: "试点前创建数据检查点",
      status: storageStatus.checkpoints?.length ? "DONE" : "PENDING",
      severity: "REQUIRED",
      done: storageStatus.checkpoints?.length ? 1 : 0,
      detail: storageStatus.checkpoints?.length
        ? `最近检查点：${storageStatus.checkpoints[0].fileName}`
        : "尚未创建显式检查点。",
      action: "项目 -> 本地数据状态 -> 创建检查点",
    }),
    pilotChecklistItem({
      key: "role_owners",
      title: "角色负责人已分配",
      status: rolePairs.length > 0 && rolePairs.every((item) => item.humanUserId) ? "DONE" : "PENDING",
      severity: "REQUIRED",
      done: rolePairs.filter((item) => item.humanUserId).length,
      total: rolePairs.length,
      detail: `${rolePairs.filter((item) => item.humanUserId).length}/${rolePairs.length} 个角色已有负责人。`,
      action: "项目 -> 当前项目角色配对",
    }),
    pilotChecklistItem({
      key: "schedule",
      title: "当前阶段工作包设置截止日期",
      status: phaseWorkPackages.length > 0 && phaseWorkPackages.every((item) => item.dueAt) ? "DONE" : "PENDING",
      done: phaseWorkPackages.filter((item) => item.dueAt).length,
      total: phaseWorkPackages.length,
      detail: `${phaseWorkPackages.filter((item) => item.dueAt).length}/${phaseWorkPackages.length} 个当前阶段工作包已有截止日期。`,
      action: "工作包 -> 计划 -> 保存截止日期",
    }),
    pilotChecklistItem({
      key: "agent_drafts",
      title: "当前阶段生成 Agent 草稿",
      status: phaseWorkPackages.length > 0 && agentReadyWorkPackages.length === phaseWorkPackages.length ? "DONE" : "PENDING",
      severity: "REQUIRED",
      done: agentReadyWorkPackages.length,
      total: phaseWorkPackages.length,
      detail: `${agentReadyWorkPackages.length}/${phaseWorkPackages.length} 个当前阶段工作包已有可审核草稿。`,
      action: "工作包 -> Agent 生成",
    }),
    pilotChecklistItem({
      key: "human_reviews",
      title: "人类审核阶段门证据",
      status: requiredEvidenceCount > 0 && readyEvidenceCount >= requiredEvidenceCount ? "DONE" : "PENDING",
      severity: "REQUIRED",
      done: readyEvidenceCount,
      total: requiredEvidenceCount,
      detail: `阶段门证据 ${readyEvidenceCount}/${requiredEvidenceCount} 已就绪；当前阶段已审核工作包 ${reviewedWorkPackages.length}/${phaseWorkPackages.length}。`,
      action: "工作包 -> 批准/有条件批准",
    }),
    pilotChecklistItem({
      key: "risk_workflow",
      title: "阻塞风险已有处置动作",
      status: hasBlockingRiskWorkflow || (snapshot?.summary?.openHighRiskCount || 0) === 0 ? "DONE" : "PENDING",
      severity: "REQUIRED",
      done: hasBlockingRiskWorkflow || (snapshot?.summary?.openHighRiskCount || 0) === 0 ? 1 : 0,
      detail: hasBlockingRiskWorkflow
        ? "至少一个阻塞风险已有接受、关闭或缓解计划。"
        : "仍有高风险未接受、关闭或设置缓解计划。",
      action: "风险 -> 保存缓解计划/接受/关闭",
    }),
    pilotChecklistItem({
      key: "notifications",
      title: "通知链路已触发",
      status: (snapshot?.summary?.notificationCount || 0) > 0 ? "DONE" : "PENDING",
      done: snapshot?.summary?.notificationCount || 0,
      detail: `当前项目通知 ${snapshot?.summary?.notificationCount || 0} 条。`,
      action: "执行 Agent 生成、审核、分配负责人或风险动作",
    }),
    pilotChecklistItem({
      key: "audit",
      title: "审计链路已记录",
      status: (snapshot?.summary?.auditEventCount || 0) > 0 ? "DONE" : "PENDING",
      severity: "REQUIRED",
      done: snapshot?.summary?.auditEventCount || 0,
      detail: `当前项目审计事件 ${snapshot?.summary?.auditEventCount || 0} 条。`,
      action: "审计 -> 搜索关键操作",
    }),
    pilotChecklistItem({
      key: "archive",
      title: "生成试点归档包",
      status: "PENDING",
      detail: "运行 pilot:archive 后会在 /tmp/hardware-flow-pilot-archive 生成归档材料。",
      action: "npm run pilot:archive -- /tmp/hardware-flow-pilot-archive",
    }),
  ];
  const requiredItems = items.filter((item) => item.severity === "REQUIRED");

  return {
    generatedAt: new Date().toISOString(),
    projectId: project?.id || null,
    currentPhaseId: project?.currentPhaseId || null,
    currentGateId: gate?.id || null,
    summary: {
      total: items.length,
      done: items.filter((item) => item.status === "DONE").length,
      requiredTotal: requiredItems.length,
      requiredDone: requiredItems.filter((item) => item.status === "DONE").length,
      blocked: items.filter((item) => item.status === "BLOCKED").length,
      pending: items.filter((item) => item.status === "PENDING").length,
    },
    items,
  };
}

export function getStorageDoctorStatus() {
  const storePath = getStorePath();
  const backupPath = getBackupPath(storePath);
  const result = validateStoreFile(storePath);
  const backupResult = validateStoreFile(backupPath);
  return {
    storePath,
    backupPath,
    backupExists: fs.existsSync(backupPath),
    backupValid: backupResult.valid,
    backupErrors: backupResult.errors,
    exists: result.exists,
    valid: result.valid,
    errors: result.errors,
  };
}

export function getReadinessStatus() {
  const runtimeSummary = getStoreRuntimeSummary(store);
  const storageDoctor = getStorageDoctorStatus();
  const storageReady = storageDoctor.exists && storageDoctor.valid;
  return {
    ready: storageReady && !isShuttingDown,
    shuttingDown: isShuttingDown,
    ...serviceMetadata,
    ...runtimeSummary,
    storage: {
      exists: storageDoctor.exists,
      valid: storageDoctor.valid,
      errors: storageDoctor.errors,
      backupExists: storageDoctor.backupExists,
      backupValid: storageDoctor.backupValid,
      backupErrors: storageDoctor.backupErrors,
      runtimeSource: runtimeStoreSourceStatus,
      runtimeWrite: runtimeWritePolicy,
      runtimePersistence: runtimePersistence.getStatus(),
    },
  };
}

export function getPilotReadinessStatus() {
  const project = currentProject();
  const gate = currentGate();
  const storageDoctor = getStorageDoctorStatus();
  const storageStatus = getStorageStatus();
  const readiness = getReadinessStatus();
  const snapshot = project ? getProjectSnapshot(project.id) : null;
  const reviewPack = gate ? getGateReviewPack(gate.id) : null;
  const checklist = getPilotChecklistStatus();
  const requiredPendingItems = checklist.items.filter((item) => item.severity === "REQUIRED" && item.status !== "DONE");
  const blockers = [];
  const warnings = [];

  if (!readiness.ready) {
    blockers.push({
      code: "SERVICE_NOT_READY",
      message: isShuttingDown ? "服务正在关停" : "服务或本地数据未就绪",
    });
  }
  if (!storageDoctor.exists || !storageDoctor.valid) {
    blockers.push({
      code: "STORE_INVALID",
      message: "JSON store 不存在或校验失败",
      details: storageDoctor.errors,
    });
  }
  if (storageDoctor.backupExists && !storageDoctor.backupValid) {
    warnings.push({
      code: "BACKUP_INVALID",
      message: "备份文件存在但校验失败，试点前应重新生成或清理备份",
      details: storageDoctor.backupErrors,
    });
  }
  if (reviewPack?.summary?.blockerCount > 0) {
    warnings.push({
      code: "GATE_BLOCKED",
      message: `当前阶段门仍有 ${reviewPack.summary.blockerCount} 个阻塞项`,
    });
  }
  if (requiredPendingItems.length > 0) {
    warnings.push({
      code: "REQUIRED_CHECKLIST_PENDING",
      message: `试点演练清单仍有 ${requiredPendingItems.length} 个必需项未完成`,
      details: requiredPendingItems.map((item) => ({
        key: item.key,
        title: item.title,
        status: item.status,
        action: item.action,
      })),
    });
  }
  if ((snapshot?.summary?.notificationCount || 0) === 0) {
    warnings.push({
      code: "NO_NOTIFICATIONS_YET",
      message: "当前项目还没有通知记录，试点时需要覆盖通知和已读流程",
    });
  }
  if ((snapshot?.summary?.auditEventCount || 0) === 0) {
    warnings.push({
      code: "NO_AUDIT_EVENTS_YET",
      message: "当前项目还没有审计事件，试点时需要覆盖关键操作链路",
    });
  }

  return {
    ready: blockers.length === 0,
    generatedAt: new Date().toISOString(),
    project: project
      ? {
          id: project.id,
          name: project.name,
          status: project.status,
          currentPhaseId: project.currentPhaseId,
          currentPhaseName: snapshot?.currentPhase?.name || null,
        }
      : null,
    gate: reviewPack
      ? {
          id: reviewPack.gate.id,
          name: reviewPack.gate.name,
          status: reviewPack.gate.status,
          readiness: reviewPack.readiness.status,
          blockerCount: reviewPack.summary.blockerCount,
          readyEvidenceCount: reviewPack.summary.readyEvidenceCount,
          requiredEvidenceCount: reviewPack.summary.requiredEvidenceCount,
        }
      : null,
    storage: {
      exists: storageDoctor.exists,
      valid: storageDoctor.valid,
      backupExists: storageDoctor.backupExists,
      backupValid: storageDoctor.backupValid,
      storePath: storageStatus.storePath,
      backupPath: storageStatus.backupPath,
      updatedAt: storageStatus.updatedAt,
    },
    summary: snapshot?.summary || null,
    blockers,
    warnings,
    checklist,
    commands: {
      check: "npm run pilot:check",
      rehearse: "npm run pilot:rehearse",
      archive: "npm run pilot:archive -- /tmp/hardware-flow-pilot-archive",
      startLan: "npm run start:lan",
    },
    acceptanceCriteria: firstPilotAcceptanceCriteria,
    boundaries: firstPilotBoundaries,
    runbookSteps: firstPilotRunbookSteps,
    issueReport: pilotIssueReport,
    rollbackCard: pilotRollbackCard,
    links: {
      launch: "/pilot/launch",
      readiness: "/pilot/readiness",
      checklist: "/pilot/checklist",
      health: "/health",
      ready: "/ready",
      opsSummary: "/ops/summary",
      metrics: "/metrics",
      runtimeConfig: "/runtime/config",
      runtimeNetwork: "/runtime/network",
      storageStatus: "/storage/status",
      storageDoctor: "/storage/doctor",
      projectSnapshot: project ? `/projects/${project.id}/snapshot.md` : null,
      riskRegister: project ? `/projects/${project.id}/risk-register.md` : null,
      gateReviewPack: gate ? `/gates/${gate.id}/review-pack.md` : null,
    },
  };
}

export function getPilotLaunchStatus() {
  const pilotReadiness = getPilotReadinessStatus();
  const opsSummary = getOpsSummaryStatus();
  const checklistItems = pilotReadiness.checklist?.items || [];
  const requiredPending = checklistItems.filter((item) => item.severity === "REQUIRED" && item.status !== "DONE");
  const seenCodes = new Set();
  const hardBlockers = [...(pilotReadiness.blockers || []), ...(opsSummary.blockers || [])].filter((item) => {
    const code = item.code || item.message;
    if (seenCodes.has(code)) return false;
    seenCodes.add(code);
    return true;
  });
  const warnings = [...(pilotReadiness.warnings || []), ...(opsSummary.warnings || [])].filter((item) => {
    const code = item.code || item.message;
    if (seenCodes.has(code)) return false;
    seenCodes.add(code);
    return true;
  });
  const decision = hardBlockers.length ? "NO_GO" : requiredPending.length || warnings.length ? "GO_WITH_CAUTION" : "GO";
  const checkpointItem = checklistItems.find((item) => item.key === "checkpoint");

  return {
    generatedAt: new Date().toISOString(),
    decision,
    canStart: decision !== "NO_GO",
    project: pilotReadiness.project,
    gate: pilotReadiness.gate,
    summary: {
      requiredDone: pilotReadiness.checklist?.summary?.requiredDone || 0,
      requiredTotal: pilotReadiness.checklist?.summary?.requiredTotal || 0,
      requiredPending: requiredPending.length,
      blockers: hardBlockers.length,
      warnings: warnings.length,
      httpServerErrors: opsSummary.http?.serverErrors || 0,
    },
    criteria: [
      {
        key: "service_data",
        label: "服务和本地数据可用",
        status: pilotReadiness.ready ? "PASS" : "FAIL",
        detail: pilotReadiness.storage?.valid ? "Store 校验通过。" : "Store 未通过校验。",
      },
      {
        key: "required_checklist",
        label: "必需试点项完成",
        status: requiredPending.length ? "WARN" : "PASS",
        detail: `${pilotReadiness.checklist?.summary?.requiredDone || 0}/${pilotReadiness.checklist?.summary?.requiredTotal || 0} 个必需项已完成。`,
      },
      {
        key: "gate_evidence",
        label: "阶段门证据状态明确",
        status: pilotReadiness.gate?.blockerCount ? "WARN" : "PASS",
        detail: `证据 ${pilotReadiness.gate?.readyEvidenceCount || 0}/${pilotReadiness.gate?.requiredEvidenceCount || 0}，阻塞 ${pilotReadiness.gate?.blockerCount || 0}。`,
      },
      {
        key: "data_protection",
        label: "试点前数据保护",
        status: checkpointItem?.status === "DONE" ? "PASS" : "WARN",
        detail: checkpointItem?.detail || "建议试点开始前创建检查点。",
      },
      {
        key: "operations",
        label: "运维观测无硬阻塞",
        status: opsSummary.ready ? "PASS" : "FAIL",
        detail: `HTTP 5xx ${opsSummary.http?.serverErrors || 0}，提醒 ${opsSummary.warnings?.length || 0}。`,
      },
    ],
    blockers: hardBlockers,
    warnings,
    requiredPending: requiredPending.map((item) => ({
      key: item.key,
      title: item.title,
      action: item.action,
    })),
    commands: pilotReadiness.commands,
    links: {
      launch: "/pilot/launch",
      readiness: pilotReadiness.links?.readiness,
      checklist: pilotReadiness.links?.checklist,
      opsSummary: pilotReadiness.links?.opsSummary,
      metrics: pilotReadiness.links?.metrics,
      storageDoctor: pilotReadiness.links?.storageDoctor,
    },
    nextActions: hardBlockers.length
      ? hardBlockers.map((item) => item.message)
      : requiredPending.length
        ? requiredPending.map((item) => item.action || item.title)
        : opsSummary.nextActions,
  };
}

function renderMetrics() {
  const runtimeSummary = getStoreRuntimeSummary(store);
  const storageDoctor = getStorageDoctorStatus();
  const memoryUsage = process.memoryUsage();
  const project = currentProject();
  const projectWorkPackages = project ? store.workPackages.filter((item) => item.projectId === project.id) : [];
  const projectPhases = project ? store.phases.filter((item) => item.projectId === project.id) : [];
  const projectPhaseIds = new Set(projectPhases.map((item) => item.id));
  const projectRisks = project ? store.risks.filter((item) => item.projectId === project.id && projectPhaseIds.has(item.phaseId)) : [];
  const gateCheck = currentGateCheck();
  const riskMitigationSummary = summarizeRiskMitigations(projectRisks);
  const approvedWorkPackages = projectWorkPackages.filter((item) => item.status === "HUMAN_APPROVED" || item.status === "LOCKED");
  const overdueWorkPackages = projectWorkPackages.filter((item) => workPackageScheduleStatus(item) === "OVERDUE");
  const openHighRisks = projectRisks.filter(
    (risk) => (risk.severity === "HIGH" || risk.severity === "CRITICAL") && risk.status === "OPEN",
  );
  const lines = [
    "# HELP hardware_flow_ready Whether the API and local store are ready.",
    "# TYPE hardware_flow_ready gauge",
    `hardware_flow_ready ${storageDoctor.exists && storageDoctor.valid && !isShuttingDown ? 1 : 0}`,
    "# HELP hardware_flow_runtime_writable Whether the API accepts runtime mutation requests.",
    "# TYPE hardware_flow_runtime_writable gauge",
    `hardware_flow_runtime_writable ${runtimeWritePolicy.writable ? 1 : 0}`,
    "# HELP hardware_flow_runtime_postgres_sync_failures_total PostgreSQL runtime mirror synchronization failures.",
    "# TYPE hardware_flow_runtime_postgres_sync_failures_total counter",
    `hardware_flow_runtime_postgres_sync_failures_total ${runtimePersistence.getStatus().postgresSyncFailureCount}`,
    "# HELP hardware_flow_runtime_persistence_startup_ready Whether the runtime persistence startup consistency check passed.",
    "# TYPE hardware_flow_runtime_persistence_startup_ready gauge",
    `hardware_flow_runtime_persistence_startup_ready ${runtimePersistence.getStatus().startupCheck.ready ? 1 : 0}`,
    "# HELP hardware_flow_shutting_down Whether the process is draining before exit.",
    "# TYPE hardware_flow_shutting_down gauge",
    `hardware_flow_shutting_down ${isShuttingDown ? 1 : 0}`,
    "# HELP hardware_flow_process_uptime_seconds Process uptime in seconds.",
    "# TYPE hardware_flow_process_uptime_seconds gauge",
    `hardware_flow_process_uptime_seconds ${process.uptime().toFixed(3)}`,
    "# HELP hardware_flow_process_memory_rss_bytes Resident set size in bytes.",
    "# TYPE hardware_flow_process_memory_rss_bytes gauge",
    `hardware_flow_process_memory_rss_bytes ${memoryUsage.rss}`,
    "# HELP hardware_flow_process_memory_heap_used_bytes V8 heap used in bytes.",
    "# TYPE hardware_flow_process_memory_heap_used_bytes gauge",
    `hardware_flow_process_memory_heap_used_bytes ${memoryUsage.heapUsed}`,
    "# HELP hardware_flow_process_memory_heap_total_bytes V8 heap total in bytes.",
    "# TYPE hardware_flow_process_memory_heap_total_bytes gauge",
    `hardware_flow_process_memory_heap_total_bytes ${memoryUsage.heapTotal}`,
    "# HELP hardware_flow_projects_total Number of projects in the active store.",
    "# TYPE hardware_flow_projects_total gauge",
    `hardware_flow_projects_total ${runtimeSummary.projectCount}`,
    "# HELP hardware_flow_audit_events_total Number of audit events in the active store.",
    "# TYPE hardware_flow_audit_events_total gauge",
    `hardware_flow_audit_events_total ${runtimeSummary.auditEventCount}`,
    "# HELP hardware_flow_notifications_total Number of notifications in the active store.",
    "# TYPE hardware_flow_notifications_total gauge",
    `hardware_flow_notifications_total ${runtimeSummary.notificationCount}`,
    "# HELP hardware_flow_gate_approval_packs_total Number of archived gate approval packs.",
    "# TYPE hardware_flow_gate_approval_packs_total gauge",
    `hardware_flow_gate_approval_packs_total ${runtimeSummary.gateApprovalPackCount}`,
    "# HELP hardware_flow_store_valid Whether the JSON store file is valid.",
    "# TYPE hardware_flow_store_valid gauge",
    `hardware_flow_store_valid ${storageDoctor.valid ? 1 : 0}`,
    "# HELP hardware_flow_static_mode_react Whether the API is serving the React build.",
    "# TYPE hardware_flow_static_mode_react gauge",
    `hardware_flow_static_mode_react ${staticMode === "react" ? 1 : 0}`,
    "# HELP hardware_flow_active_work_packages_total Number of work packages in the active project.",
    "# TYPE hardware_flow_active_work_packages_total gauge",
    `hardware_flow_active_work_packages_total ${projectWorkPackages.length}`,
    "# HELP hardware_flow_active_work_packages_approved Number of approved or locked work packages in the active project.",
    "# TYPE hardware_flow_active_work_packages_approved gauge",
    `hardware_flow_active_work_packages_approved ${approvedWorkPackages.length}`,
    "# HELP hardware_flow_active_work_packages_overdue Number of overdue work packages in the active project.",
    "# TYPE hardware_flow_active_work_packages_overdue gauge",
    `hardware_flow_active_work_packages_overdue ${overdueWorkPackages.length}`,
    "# HELP hardware_flow_active_risks_total Number of risks in the active project.",
    "# TYPE hardware_flow_active_risks_total gauge",
    `hardware_flow_active_risks_total ${projectRisks.length}`,
    "# HELP hardware_flow_active_open_high_risks Number of open HIGH or CRITICAL risks in the active project.",
    "# TYPE hardware_flow_active_open_high_risks gauge",
    `hardware_flow_active_open_high_risks ${openHighRisks.length}`,
    "# HELP hardware_flow_active_risk_mitigations_open Number of open risk mitigation plans in the active project.",
    "# TYPE hardware_flow_active_risk_mitigations_open gauge",
    `hardware_flow_active_risk_mitigations_open ${riskMitigationSummary.openMitigationCount || 0}`,
    "# HELP hardware_flow_active_gate_ready Whether the current gate is ready for approval.",
    "# TYPE hardware_flow_active_gate_ready gauge",
    `hardware_flow_active_gate_ready ${gateCheck?.status === "READY" ? 1 : 0}`,
    "# HELP hardware_flow_http_requests_total Total HTTP responses served since process start.",
    "# TYPE hardware_flow_http_requests_total counter",
    `hardware_flow_http_requests_total ${requestCounters.total}`,
    "# HELP hardware_flow_http_client_errors_total Total HTTP 4xx responses served since process start.",
    "# TYPE hardware_flow_http_client_errors_total counter",
    `hardware_flow_http_client_errors_total ${requestCounters.clientErrors}`,
    "# HELP hardware_flow_http_errors_total Total HTTP 5xx responses served since process start.",
    "# TYPE hardware_flow_http_errors_total counter",
    `hardware_flow_http_errors_total ${requestCounters.errors}`,
    "# HELP hardware_flow_http_request_duration_ms_total Total HTTP response duration in milliseconds since process start.",
    "# TYPE hardware_flow_http_request_duration_ms_total counter",
    `hardware_flow_http_request_duration_ms_total ${requestCounters.durationMsTotal.toFixed(2)}`,
    "# HELP hardware_flow_http_request_duration_ms_avg Average HTTP response duration in milliseconds since process start.",
    "# TYPE hardware_flow_http_request_duration_ms_avg gauge",
    `hardware_flow_http_request_duration_ms_avg ${requestCounters.total ? (requestCounters.durationMsTotal / requestCounters.total).toFixed(2) : 0}`,
    "# HELP hardware_flow_http_request_duration_ms_max Maximum HTTP response duration in milliseconds since process start.",
    "# TYPE hardware_flow_http_request_duration_ms_max gauge",
    `hardware_flow_http_request_duration_ms_max ${requestCounters.durationMsMax.toFixed(2)}`,
    "# HELP hardware_flow_http_requests_by_method_total HTTP responses by method since process start.",
    "# TYPE hardware_flow_http_requests_by_method_total counter",
    ...[...requestCounters.byMethod.entries()].map(([method, count]) => `hardware_flow_http_requests_by_method_total{method="${method}"} ${count}`),
  ];
  return `${lines.join("\n")}\n`;
}

export function restoreStorageBackup(body = {}) {
  if (body.confirm !== true) {
    return validationError("恢复备份需要 confirm: true");
  }

  const storePath = getStorePath();
  const backupPath = getBackupPath(storePath);
  const backupValidation = validateStoreFile(backupPath);

  if (!backupValidation.exists) {
    return {
      statusCode: 404,
      body: { error: "备份文件不存在", backupPath },
    };
  }

  if (!backupValidation.valid) {
    return {
      statusCode: 422,
      body: {
        error: "备份文件无效，不能恢复",
        backupPath,
        errors: backupValidation.errors,
      },
    };
  }

  const restoreResult = restoreStoreFromBackup({ storePath });
  store = loadStoreFromDisk() || createDemoStore();
  ensureStoreShape();
  persistStore();

  return {
    statusCode: 200,
    body: {
      restored: true,
      ...restoreResult,
      storageStatus: getStorageStatus(),
      doctor: getStorageDoctorStatus(),
    },
  };
}

export function createStorageCheckpoint(body = {}) {
  const label = body.label || "pilot";
  try {
    const checkpoint = createStoreCheckpoint({ storePath: getStorePath(), label });
    return {
      statusCode: 201,
      body: {
        created: true,
        ...checkpoint,
        storageStatus: getStorageStatus(),
      },
    };
  } catch (error) {
    return {
      statusCode: 422,
      body: {
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export function restoreStorageCheckpoint(body = {}) {
  if (body.confirm !== true) {
    return validationError("恢复检查点需要 confirm: true");
  }
  if (!body.checkpointPath) {
    return validationError("checkpointPath 不能为空");
  }

  const allowedCheckpoint = listStoreCheckpoints({ storePath: getStorePath() })
    .find((item) => item.filePath === body.checkpointPath || item.fileName === body.checkpointPath);
  if (!allowedCheckpoint) {
    return {
      statusCode: 404,
      body: {
        error: `checkpoint file not found or not allowed: ${body.checkpointPath}`,
      },
    };
  }

  const checkpointValidation = validateStoreFile(allowedCheckpoint.filePath);
  if (!checkpointValidation.valid) {
    return {
      statusCode: checkpointValidation.exists ? 422 : 404,
      body: {
        error: checkpointValidation.exists ? "检查点文件无效，不能恢复" : "检查点文件不存在",
        checkpointPath: allowedCheckpoint.filePath,
        errors: checkpointValidation.errors,
      },
    };
  }

  try {
    const restoreResult = restoreStoreFromCheckpoint({
      storePath: getStorePath(),
      checkpointPath: allowedCheckpoint.filePath,
    });
    store = loadStoreFromDisk() || createDemoStore();
    ensureStoreShape();
    persistStore();

    return {
      statusCode: 200,
      body: {
        restored: true,
        ...restoreResult,
        storageStatus: getStorageStatus(),
        doctor: getStorageDoctorStatus(),
      },
    };
  } catch (error) {
    return {
      statusCode: Number(error?.statusCode) || 404,
      body: {
        error: error instanceof Error ? error.message : String(error),
        ...(error?.code ? { code: error.code } : {}),
      },
    };
  }
}

export function resetDemoStore() {
  deleteStoreFromDisk();
  store = createDemoStore();
  persistStore();
  return getActiveProjectView();
}

export function setShuttingDownForTest(value) {
  isShuttingDown = Boolean(value);
}

export function setRuntimeWriteModeForTest(value) {
  runtimeWritePolicy = resolveRuntimeWritePolicy({
    configuredMode: value,
    runtimeSource: runtimeStoreSourceStatus,
    persistenceBackend: runtimePersistence.backend,
  });
}

function writeJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
    "access-control-allow-headers": "content-type,x-request-id,x-pilot-access-code",
    "access-control-expose-headers": "x-request-id,x-service-version",
    "x-service-version": serviceMetadata.version,
    ...(res.hardwareFlowRequestId ? { "x-request-id": res.hardwareFlowRequestId } : {}),
  });
  res.end(JSON.stringify(body, null, 2));
}

function writeText(res, statusCode, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "content-type": contentType,
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
    "access-control-allow-headers": "content-type,x-request-id,x-pilot-access-code",
    "access-control-expose-headers": "x-request-id,x-service-version",
    "x-service-version": serviceMetadata.version,
    ...(res.hardwareFlowRequestId ? { "x-request-id": res.hardwareFlowRequestId } : {}),
  });
  res.end(body);
}

function writeFileDownload(res, filePath, { fileName, mimeType = "application/octet-stream" } = {}) {
  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    "content-type": mimeType,
    "content-disposition": `attachment; filename="${encodeURIComponent(fileName || path.basename(filePath))}"`,
    "content-length": body.length,
    "access-control-allow-origin": "*",
    "access-control-expose-headers": "x-request-id,x-service-version",
    "x-service-version": serviceMetadata.version,
    ...(res.hardwareFlowRequestId ? { "x-request-id": res.hardwareFlowRequestId } : {}),
  });
  res.end(body);
}

function attachAccessLog(req, res, url) {
  const requestId = req.headers["x-request-id"] || randomUUID();
  const startedAt = process.hrtime.bigint();
  res.hardwareFlowRequestId = requestId;
  if (typeof res.setHeader === "function") {
    res.setHeader("x-request-id", requestId);
  }

  if (typeof res.on !== "function") {
    return;
  }

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    requestCounters.total += 1;
    requestCounters.durationMsTotal += durationMs;
    requestCounters.durationMsMax = Math.max(requestCounters.durationMsMax, durationMs);
    requestCounters.byMethod.set(req.method, (requestCounters.byMethod.get(req.method) || 0) + 1);
    if (res.statusCode >= 400 && res.statusCode < 500) {
      requestCounters.clientErrors += 1;
    }
    if (res.statusCode >= 500) {
      requestCounters.errors += 1;
    }
    if (!accessLogEnabled) {
      return;
    }
    console.log(JSON.stringify({
      type: "access",
      requestId,
      method: req.method,
      path: url.pathname,
      statusCode: res.statusCode,
      durationMs: Number(durationMs.toFixed(2)),
    }));
  });
}

function isPublicPath(method, pathname) {
  if (method === "OPTIONS") return true;
  if (method === "GET" && ["/health", "/ready", "/runtime/config", "/runtime/network"].includes(pathname)) return true;
  if (method === "GET" && !pathname.startsWith("/api/")) {
    const staticPath = pathname === "/" ? "/index.html" : pathname;
    const filePath = path.normalize(path.join(staticRoot, staticPath));
    return filePath.startsWith(staticRoot) && fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  }
  return false;
}

function verifyPilotAccess(req, url) {
  if (!pilotAccessEnabled || isPublicPath(req.method, url.pathname)) {
    return { allowed: true };
  }
  const received = String(req.headers["x-pilot-access-code"] || "").trim();
  return received === pilotAccessCode
    ? { allowed: true }
    : {
        allowed: false,
        statusCode: 401,
        body: {
          error: "需要试点访问码",
          code: "PILOT_ACCESS_REQUIRED",
        },
      };
}

export function renderGateReviewPackMarkdown(pack) {
  const evidenceRows = pack.evidence
    .map(
      (item) =>
        `| ${item.requiredWorkPackageTitle} | ${item.requiredArtifactType} | ${item.workPackageStatus} | ${item.latestArtifactStatus} | ${item.manualEvidenceCount} | ${item.reviewerUserId || "-"} | ${item.approvedReviewDecision || "-"} | ${item.approvedReviewConditions?.length ? item.approvedReviewConditions.join("; ") : "-"} | ${item.approvedReviewComment || "-"} | ${item.approvedReviewConditionsCompletedAt ? "DONE" : item.approvedReviewConditions?.length ? "OPEN" : "-"} | ${item.approvedReviewConditionsCompletedByUserId || "-"} | ${item.approvedReviewConditionsCompletionComment || "-"} | ${item.ready ? "READY" : "BLOCKED"} |`,
    )
    .join("\n");
  const riskRows = pack.risks.length
    ? pack.risks
        .map(
          (risk) =>
            `| ${risk.title} | ${risk.severity} | ${risk.status} | ${risk.blocksGate ? "YES" : "NO"} | ${risk.mitigationStatus || "-"} | ${risk.mitigationOwnerUserId || "-"} | ${risk.mitigationDueAt || "-"} | ${risk.mitigationCompletionComment || "-"} |`,
        )
        .join("\n")
    : "| 无 | - | - | NO | - | - | - | - |";
  const blockerRows = pack.blockers.length
    ? pack.blockers.map((blocker) => `- ${blocker.code}: ${blocker.message}`).join("\n")
    : "- 无";

  return `# ${pack.gate.name} 审核包

项目：${pack.project?.name || "-"}
阶段：${pack.phase?.name || "-"}
阶段门状态：${pack.gate.status}
就绪状态：${pack.readiness.status}
批准人：${pack.gate.approvedByUserId || "-"}
批准时间：${pack.gate.approvedAt || "-"}
批准说明：${pack.gate.approvalComment || "-"}

## 摘要

- 必需证据：${pack.summary.readyEvidenceCount}/${pack.summary.requiredEvidenceCount}
- 阻塞项：${pack.summary.blockerCount}
- 阻塞风险：${pack.summary.openBlockingRiskCount}
- 有条件批准条款：${pack.summary.completedConditionalApprovalCount || 0}/${pack.summary.conditionalApprovalCount || 0} 已完成
- 可批准：${pack.summary.readyForApproval ? "是" : "否"}

## 必需证据

| 工作包 | 交付物类型 | 工作包状态 | 最新交付物状态 | 人工证据 | 审核人 | 审核决定 | 批准条件 | 审核说明 | 条款状态 | 条款完成人 | 条款完成说明 | 结论 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
${evidenceRows}

## 风险

| 风险 | 严重度 | 状态 | 阻塞阶段门 | 缓解状态 | 缓解负责人 | 缓解截止 | 缓解完成说明 |
|---|---|---|---|---|---|---|---|
${riskRows}

## 阻塞项

${blockerRows}
`;
}

export function renderProjectSnapshotMarkdown(snapshot) {
  const phaseRows = snapshot.phases
    .map((phase) => `| ${phase.sequence} | ${phase.name} | ${phase.status} |`)
    .join("\n");
  const workPackageRows = snapshot.workPackages
    .map(
      (item) =>
        `| ${item.phaseName} | ${item.title} | ${item.requiredArtifactType} | ${item.status} | ${item.dueAt || "-"} | ${item.scheduleStatus || "-"} | ${item.ownerUserId || "-"} |`,
    )
    .join("\n");
  const riskRows = snapshot.risks.length
    ? snapshot.risks
        .map(
          (risk) =>
            `| ${risk.phaseName} | ${risk.title} | ${risk.severity} | ${risk.status} | ${risk.mitigationStatus || "-"} | ${risk.mitigationOwnerUserId || "-"} | ${risk.mitigationDueAt || "-"} | ${risk.mitigation || "-"} | ${risk.mitigationCompletionComment || "-"} | ${risk.decisionComment || "-"} |`,
        )
        .join("\n")
    : "| 无 | - | - | - | - | - | - | - | - | - |";
  const auditRows = snapshot.auditEvents.length
    ? snapshot.auditEvents
        .slice(-12)
        .map((event) => `| ${event.createdAt} | ${event.eventType} | ${event.actorType}:${event.actorId} | ${event.objectType}:${event.objectId} |`)
        .join("\n")
    : "| 无 | - | - | - |";
  const notificationRows = snapshot.notifications.length
    ? snapshot.notifications
        .slice(-12)
        .map((item) => `| ${item.createdAt} | ${item.userId} | ${item.status} | ${item.title} |`)
        .join("\n")
    : "| 无 | - | - | - |";
  const evidenceRefRows = snapshot.evidenceRefs.length
    ? snapshot.evidenceRefs
        .slice(-12)
        .map((item) => {
          const workPackage = snapshot.workPackages.find((workPackage) => workPackage.id === item.workPackageId);
          return `| ${item.createdAt} | ${workPackage?.title || item.workPackageId} | ${item.label} | ${item.ref} |`;
        })
        .join("\n")
    : "| 无 | - | - | - |";
  const gateApprovalPackRows = snapshot.gateApprovalPacks.length
    ? snapshot.gateApprovalPacks
        .slice(-12)
        .map((item) => {
          const gate = snapshot.gates.find((gate) => gate.id === item.gateId);
          return `| ${item.approvedAt} | ${gate?.name || item.gateId} | ${item.approvedByUserId} | ${item.approvalComment || "-"} |`;
        })
        .join("\n")
    : "| 无 | - | - | - |";

  return `# ${snapshot.project.name} 项目快照

项目状态：${snapshot.project.status}
当前阶段：${snapshot.currentPhase?.name || "-"}
当前阶段门：${snapshot.currentGate?.name || "-"} / ${snapshot.currentGate?.status || "-"}
导出时间：${snapshot.exportedAt}

## 汇总

- 阶段：${snapshot.summary.phaseCount}
- 工作包：${snapshot.summary.workPackageCount}
- 已批准工作包：${snapshot.summary.approvedWorkPackageCount}
- 逾期工作包：${snapshot.summary.overdueWorkPackageCount}
- 临期工作包：${snapshot.summary.dueSoonWorkPackageCount}
- 风险：${snapshot.summary.riskCount}
- 打开高风险：${snapshot.summary.openHighRiskCount}
- 风险缓解：${snapshot.summary.completedMitigationCount || 0}/${snapshot.summary.mitigationPlanCount || 0} 已完成，${snapshot.summary.openMitigationCount || 0} 进行中，${snapshot.summary.overdueMitigationCount || 0} 逾期
- 证据引用：${snapshot.summary.evidenceRefCount}
- 批准包归档：${snapshot.summary.gateApprovalPackCount}
- 有条件批准条款：${snapshot.summary.completedConditionalApprovalCount || 0}/${snapshot.summary.conditionalApprovalCount || 0} 已完成，${snapshot.summary.openConditionalApprovalCount || 0} 未完成
- 站内通知：${snapshot.summary.notificationCount}
- 审计事件：${snapshot.summary.auditEventCount}

## 阶段

| 序号 | 阶段 | 状态 |
|---|---|---|
${phaseRows}

## 工作包

| 阶段 | 工作包 | 交付物类型 | 状态 | 截止日期 | 计划状态 | 负责人 |
|---|---|---|---|---|---|---|
${workPackageRows}

## 风险

| 阶段 | 风险 | 严重度 | 状态 | 缓解状态 | 缓解负责人 | 缓解截止 | 缓解措施 | 缓解完成说明 | 处置说明 |
|---|---|---|---|---|---|---|---|---|---|
${riskRows}

## 最近证据引用

| 时间 | 工作包 | 标题 | 引用 |
|---|---|---|---|
${evidenceRefRows}

## 阶段门批准包

| 批准时间 | 阶段门 | 批准人 | 批准说明 |
|---|---|---|---|
${gateApprovalPackRows}

## 最近通知

| 时间 | 用户 | 状态 | 标题 |
|---|---|---|---|
${notificationRows}

## 最近审计

| 时间 | 事件 | 操作者 | 对象 |
|---|---|---|---|
${auditRows}
`;
}

function renderWorkPackageMarkdown(detail) {
  const latestArtifact = detail.artifacts.at(-1) || null;
  const latestAgentRun = detail.agentRuns.at(-1) || null;
  const validation = latestArtifact?.content?.validation || latestAgentRun?.validation || null;
  const reviewRows = detail.reviews.length
    ? detail.reviews
        .map(
          (review) =>
            `| ${review.reviewedAt} | ${review.reviewerUserId} | ${review.decision} | ${review.comment || "-"} | ${review.conditions?.length ? review.conditions.join("; ") : "-"} | ${review.conditionsCompletedAt ? "DONE" : review.conditions?.length ? "OPEN" : "-"} | ${review.conditionsCompletedByUserId || "-"} | ${review.conditionsCompletionComment || "-"} |`,
        )
        .join("\n")
    : "| 无 | - | - | - | - | - | - | - |";
  const evidenceRows = detail.evidenceRefs.length
    ? detail.evidenceRefs
        .map((item) => `| ${item.createdAt} | ${item.label} | ${item.ref} | ${item.createdByUserId} |`)
        .join("\n")
    : "| 无 | - | - | - |";
  const activityRows = detail.auditEvents.length
    ? detail.auditEvents
        .map((event) => `| ${event.createdAt} | ${event.eventType} | ${event.actorType}:${event.actorId} | ${JSON.stringify(event.payload || {})} |`)
        .join("\n")
    : "| 无 | - | - | - |";
  const missingSections = validation?.missingSections?.length ? validation.missingSections.join("、") : "无";
  const emptySections = validation?.emptySections?.length ? validation.emptySections.join("、") : "无";
  const draft = latestArtifact?.content?.draftMarkdown || latestArtifact?.content?.summary || "暂无草稿。";

  return `# ${detail.workPackage.title} 工作包

项目 ID：${detail.workPackage.projectId}
工作包 ID：${detail.workPackage.id}
状态：${detail.workPackage.status}
交付物类型：${detail.workPackage.requiredArtifactType}
交付物模板：${detail.workPackage.artifactTemplateKey || "-"}
截止日期：${detail.workPackage.dueAt || "-"}
计划状态：${detail.scheduleStatus || "-"}
负责人：${detail.rolePair?.humanUserId || "-"}
Agent：${detail.rolePair?.agentKey || "-"}

## 最新交付物

- 交付物 ID：${latestArtifact?.id || "-"}
- 状态：${latestArtifact?.status || "-"}
- 版本：${latestArtifact?.version || "-"}
- 创建者：${latestArtifact?.createdByActor || "-"}

## 模板校验

- 状态：${validation?.status || "未校验"}
- 缺失项：${missingSections}
- 空内容项：${emptySections}

## 审核记录

| 时间 | 审核人 | 决定 | 备注 | 批准条件 | 条款状态 | 条款完成人 | 条款完成说明 |
|---|---|---|---|---|---|---|---|
${reviewRows}

## 证据引用

| 时间 | 标题 | 引用 | 添加人 |
|---|---|---|---|
${evidenceRows}

## 活动记录

| 时间 | 事件 | 操作者 | 详情 |
|---|---|---|---|
${activityRows}

## Agent 输出草稿

${draft}
`;
}

export function renderRiskRegisterMarkdown(register) {
  const riskRows = register.risks.length
    ? register.risks
        .map(
          (risk) =>
            `| ${risk.phaseName} | ${risk.title} | ${risk.severity} | ${risk.status} | ${risk.blocksGate ? "是" : "否"} | ${risk.mitigationStatus || "-"} | ${risk.mitigationOwnerUserId || "-"} | ${risk.mitigationDueAt || "-"} | ${risk.mitigation || "-"} | ${risk.mitigationCompletionComment || "-"} | ${risk.decisionUserId || "-"} | ${risk.decisionComment || "-"} |`,
        )
        .join("\n")
    : "| 无 | - | - | - | - | - | - | - | - | - | - | - |";

  return `# ${register.project.name} 风险台账

导出时间：${register.exportedAt}
项目 ID：${register.project.id}

## 汇总

- 风险总数：${register.summary.totalRiskCount}
- 打开风险：${register.summary.openRiskCount}
- 阻塞阶段门风险：${register.summary.openBlockingRiskCount}
- 已接受风险：${register.summary.acceptedRiskCount}
- 已关闭风险：${register.summary.closedRiskCount}
- 缓解计划：${register.summary.completedMitigationCount || 0}/${register.summary.mitigationPlanCount || 0} 已完成，${register.summary.openMitigationCount || 0} 进行中，${register.summary.overdueMitigationCount || 0} 逾期

## 风险明细

| 阶段 | 风险 | 严重度 | 状态 | 阻塞阶段门 | 缓解状态 | 缓解负责人 | 缓解截止 | 缓解措施 | 缓解完成说明 | 处置人 | 处置说明 |
|---|---|---|---|---|---|---|---|---|---|---|---|
${riskRows}
`;
}

async function readJson(req) {
  const chunks = [];
  let byteLength = 0;
  for await (const chunk of req) {
    byteLength += chunk.length;
    if (byteLength > maxJsonBodyBytes) {
      const bodyTooLargeError = new Error(`请求体超过 ${maxJsonBodyBytes} bytes 限制`);
      bodyTooLargeError.statusCode = 413;
      throw bodyTooLargeError;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    const parseError = new Error("请求体不是合法 JSON");
    parseError.statusCode = 400;
    parseError.details = error instanceof Error ? error.message : String(error);
    throw parseError;
  }
}

function audit(eventType, actorType, actorId, objectType, objectId, payload = {}) {
  addAuditEventInStore(store, {
    id: randomUUID(),
    projectId: currentProject()?.id || null,
    eventType,
    actorType,
    actorId,
    objectType,
    objectId,
    payload,
    createdAt: new Date().toISOString(),
  });
}

function notifyUser(userId, notification) {
  if (!userId || !findUser(userId)) {
    return null;
  }

  return addNotificationInStore(store, {
    id: randomUUID(),
    projectId: notification.projectId || currentProject()?.id || null,
    userId,
    title: notification.title,
    message: notification.message || "",
    type: notification.type || "INFO",
    status: "UNREAD",
    objectType: notification.objectType || null,
    objectId: notification.objectId || null,
    createdAt: new Date().toISOString(),
  });
}

function notifyRole(roleName, notification) {
  return getDemoUsers()
    .filter((user) => user.roles.includes(roleName))
    .map((user) => notifyUser(user.userId, notification))
    .filter(Boolean);
}

function currentProject() {
  return getCurrentProject(store);
}

function currentGate() {
  return getCurrentGate(store);
}

function currentGateCheck() {
  const gate = currentGate();
  return gate ? checkGate(gate.id) : null;
}

export function checkGate(gateId) {
  const readiness = getGateReadinessReadModel(store, gateId);
  if (!readiness) {
    return null;
  }

  if (readiness.status === "APPROVED") {
    return readiness;
  }

  updateGateReadinessInStore(store, gateId, readiness.status);
  persistStore();

  return readiness;
}

export function getActiveProjectView() {
  const project = currentProject();
  const gate = currentGate();
  return getActiveProjectReadModel(store, project.id, {
    latestGateCheck: gate ? checkGate(gate.id) : null,
    scheduleStatus: workPackageScheduleStatus,
    summarizeRiskMitigations,
  });
}

export function getDemoProject() {
  return getActiveProjectView();
}

export function getProjectSnapshot(projectId) {
  return getProjectSnapshotReadModel(store, projectId, {
    scheduleStatus: workPackageScheduleStatus,
    summarizeRiskMitigations,
  });
}

export function getProjectRiskRegister(projectId) {
  return getProjectRiskRegisterReadModel(store, projectId, {
    summarizeRiskMitigations,
  });
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function pushIfMissing(errors, condition, message, details = {}) {
  if (!condition) {
    errors.push({ message, ...details });
  }
}

export function validateProjectSnapshotImport(input = {}) {
  const snapshot = input.snapshot || input;
  const errors = [];
  const warnings = [];

  if (!snapshot || typeof snapshot !== "object") {
    return {
      valid: false,
      canImport: false,
      errors: [{ message: "快照必须是对象" }],
      warnings,
      summary: null,
    };
  }

  const project = snapshot.project || null;
  pushIfMissing(errors, project && typeof project === "object", "快照缺少 project 对象");
  pushIfMissing(errors, Boolean(project?.id), "project.id 不能为空");
  pushIfMissing(errors, Boolean(project?.name), "project.name 不能为空");
  pushIfMissing(errors, Boolean(project?.currentPhaseId), "project.currentPhaseId 不能为空");

  const phases = asArray(snapshot.phases);
  const gates = asArray(snapshot.gates);
  const rolePairs = asArray(snapshot.rolePairs);
  const workPackages = asArray(snapshot.workPackages);
  const gateRequirements = asArray(snapshot.gateRequirements);
  const artifactVersions = asArray(snapshot.artifactVersions);
  const reviews = asArray(snapshot.reviews);
  const evidenceRefs = asArray(snapshot.evidenceRefs);
  const gateApprovalPacks = asArray(snapshot.gateApprovalPacks);
  const risks = asArray(snapshot.risks);
  const agentJobs = asArray(snapshot.agentJobs);
  const agentRuns = asArray(snapshot.agentRuns);
  const agentFindings = asArray(snapshot.agentFindings);
  const notifications = asArray(snapshot.notifications);
  const auditEvents = asArray(snapshot.auditEvents);

  pushIfMissing(errors, Array.isArray(snapshot.phases), "phases 必须是数组");
  pushIfMissing(errors, Array.isArray(snapshot.gates), "gates 必须是数组");
  pushIfMissing(errors, Array.isArray(snapshot.rolePairs), "rolePairs 必须是数组");
  pushIfMissing(errors, Array.isArray(snapshot.workPackages), "workPackages 必须是数组");

  if (project?.id && projectExists(store, project.id)) {
    errors.push({
      message: "项目 ID 已存在，不能直接导入",
      projectId: project.id,
    });
  }

  const phaseIds = new Set(phases.map((item) => item.id));
  const gateIds = new Set(gates.map((item) => item.id));
  const rolePairIds = new Set(rolePairs.map((item) => item.id));
  const workPackageIds = new Set(workPackages.map((item) => item.id));

  if (project?.currentPhaseId) {
    pushIfMissing(errors, phaseIds.has(project.currentPhaseId), "project.currentPhaseId 未指向快照内阶段", {
      currentPhaseId: project.currentPhaseId,
    });
  }

  for (const phase of phases) {
    pushIfMissing(errors, phase.projectId === project?.id, "阶段 projectId 与项目不一致", {
      phaseId: phase.id,
      projectId: phase.projectId,
    });
  }

  for (const gate of gates) {
    pushIfMissing(errors, gate.projectId === project?.id, "阶段门 projectId 与项目不一致", {
      gateId: gate.id,
      projectId: gate.projectId,
    });
    pushIfMissing(errors, phaseIds.has(gate.phaseId), "阶段门 phaseId 未指向快照内阶段", {
      gateId: gate.id,
      phaseId: gate.phaseId,
    });
  }

  for (const rolePair of rolePairs) {
    pushIfMissing(errors, rolePair.projectId === project?.id, "角色配对 projectId 与项目不一致", {
      rolePairId: rolePair.id,
      projectId: rolePair.projectId,
    });
    if (rolePair.humanUserId && !findUser(rolePair.humanUserId)) {
      warnings.push({
        message: "角色负责人不在当前演示用户列表中，导入后可能无法审批",
        rolePairId: rolePair.id,
        humanUserId: rolePair.humanUserId,
      });
    }
  }

  for (const workPackage of workPackages) {
    pushIfMissing(errors, workPackage.projectId === project?.id, "工作包 projectId 与项目不一致", {
      workPackageId: workPackage.id,
      projectId: workPackage.projectId,
    });
    pushIfMissing(errors, phaseIds.has(workPackage.phaseId), "工作包 phaseId 未指向快照内阶段", {
      workPackageId: workPackage.id,
      phaseId: workPackage.phaseId,
    });
    pushIfMissing(errors, rolePairIds.has(workPackage.rolePairId), "工作包 rolePairId 未指向快照内角色配对", {
      workPackageId: workPackage.id,
      rolePairId: workPackage.rolePairId,
    });
  }

  for (const requirement of gateRequirements) {
    pushIfMissing(errors, gateIds.has(requirement.gateId), "阶段门条件 gateId 未指向快照内阶段门", {
      requirementId: requirement.id,
      gateId: requirement.gateId,
    });
  }

  for (const artifact of artifactVersions) {
    pushIfMissing(errors, workPackageIds.has(artifact.workPackageId), "交付物 workPackageId 未指向快照内工作包", {
      artifactId: artifact.id,
      workPackageId: artifact.workPackageId,
    });
  }

  for (const review of reviews) {
    pushIfMissing(errors, workPackageIds.has(review.workPackageId), "审核记录 workPackageId 未指向快照内工作包", {
      reviewId: review.id,
      workPackageId: review.workPackageId,
    });
  }

  for (const evidenceRef of evidenceRefs) {
    pushIfMissing(errors, evidenceRef.projectId === project?.id, "证据引用 projectId 与项目不一致", {
      evidenceRefId: evidenceRef.id,
      projectId: evidenceRef.projectId,
    });
    pushIfMissing(errors, workPackageIds.has(evidenceRef.workPackageId), "证据引用 workPackageId 未指向快照内工作包", {
      evidenceRefId: evidenceRef.id,
      workPackageId: evidenceRef.workPackageId,
    });
  }

  for (const approvalPack of gateApprovalPacks) {
    pushIfMissing(errors, approvalPack.projectId === project?.id, "阶段门批准包 projectId 与项目不一致", {
      approvalPackId: approvalPack.id,
      projectId: approvalPack.projectId,
    });
    pushIfMissing(errors, gateIds.has(approvalPack.gateId), "阶段门批准包 gateId 未指向快照内阶段门", {
      approvalPackId: approvalPack.id,
      gateId: approvalPack.gateId,
    });
    pushIfMissing(errors, phaseIds.has(approvalPack.phaseId), "阶段门批准包 phaseId 未指向快照内阶段", {
      approvalPackId: approvalPack.id,
      phaseId: approvalPack.phaseId,
    });
  }

  for (const risk of risks) {
    pushIfMissing(errors, risk.projectId === project?.id, "风险 projectId 与项目不一致", {
      riskId: risk.id,
      projectId: risk.projectId,
    });
    pushIfMissing(errors, phaseIds.has(risk.phaseId), "风险 phaseId 未指向快照内阶段", {
      riskId: risk.id,
      phaseId: risk.phaseId,
    });
    if (risk.mitigationOwnerUserId && !findUser(risk.mitigationOwnerUserId)) {
      warnings.push({
        message: "风险缓解负责人用户不存在，导入后仍会保留原始负责人 ID",
        riskId: risk.id,
        mitigationOwnerUserId: risk.mitigationOwnerUserId,
      });
    }
  }

  for (const agentRun of agentRuns) {
    pushIfMissing(errors, workPackageIds.has(agentRun.workPackageId), "Agent run workPackageId 未指向快照内工作包", {
      agentRunId: agentRun.id,
      workPackageId: agentRun.workPackageId,
    });
  }

  for (const agentJob of agentJobs) {
    pushIfMissing(errors, agentJob.projectId === project?.id, "Agent job projectId 与项目不一致", {
      agentJobId: agentJob.id,
      projectId: agentJob.projectId,
    });
    pushIfMissing(errors, workPackageIds.has(agentJob.workPackageId), "Agent job workPackageId 未指向快照内工作包", {
      agentJobId: agentJob.id,
      workPackageId: agentJob.workPackageId,
    });
  }

  for (const finding of agentFindings) {
    pushIfMissing(errors, workPackageIds.has(finding.workPackageId), "Agent 发现 workPackageId 未指向快照内工作包", {
      findingId: finding.id,
      workPackageId: finding.workPackageId,
    });
  }

  for (const notification of notifications) {
    pushIfMissing(errors, notification.projectId === project?.id, "通知 projectId 与项目不一致", {
      notificationId: notification.id,
      projectId: notification.projectId,
    });
    if (notification.userId && !findUser(notification.userId)) {
      warnings.push({
        message: "通知接收人不在当前演示用户列表中",
        notificationId: notification.id,
        userId: notification.userId,
      });
    }
  }

  return {
    valid: errors.length === 0,
    canImport: errors.length === 0,
    errors,
    warnings,
    summary: {
      projectId: project?.id || null,
      projectName: project?.name || null,
      phaseCount: phases.length,
      gateCount: gates.length,
      rolePairCount: rolePairs.length,
      workPackageCount: workPackages.length,
      gateRequirementCount: gateRequirements.length,
      artifactVersionCount: artifactVersions.length,
      reviewCount: reviews.length,
      evidenceRefCount: evidenceRefs.length,
      gateApprovalPackCount: gateApprovalPacks.length,
      riskCount: risks.length,
      agentJobCount: agentJobs.length,
      agentRunCount: agentRuns.length,
      agentFindingCount: agentFindings.length,
      notificationCount: notifications.length,
      auditEventCount: auditEvents.length,
    },
  };
}

export function importProjectSnapshot(input = {}) {
  const snapshot = input.snapshot || input;
  const validation = validateProjectSnapshotImport(snapshot);
  if (!validation.valid) {
    return {
      statusCode: 422,
      body: validation,
    };
  }

  const project = { ...snapshot.project };
  const phases = asArray(snapshot.phases).map((item) => ({ ...item }));
  const gates = asArray(snapshot.gates).map((item) => ({ ...item }));
  const rolePairs = asArray(snapshot.rolePairs).map((item) => ({ ...item }));
  const gateRequirements = asArray(snapshot.gateRequirements).map((item) => ({ ...item }));
  const workPackages = asArray(snapshot.workPackages).map(({ phaseName, ownerUserId, agentKey, ...item }) => ({ ...item }));
  const artifactVersions = asArray(snapshot.artifactVersions).map((item) => ({ ...item }));
  const reviews = asArray(snapshot.reviews).map((item) => ({ ...item }));
  const evidenceRefs = asArray(snapshot.evidenceRefs).map((item) => ({ ...item }));
  const gateApprovalPacks = asArray(snapshot.gateApprovalPacks).map((item) => ({ ...item }));
  const risks = asArray(snapshot.risks).map(({ phaseName, ...item }) => ({ ...item }));
  const agentJobs = asArray(snapshot.agentJobs).map((item) => ({ ...item }));
  const agentRuns = asArray(snapshot.agentRuns).map((item) => ({ ...item }));
  const agentFindings = asArray(snapshot.agentFindings).map((item) => ({ ...item }));
  const notifications = asArray(snapshot.notifications).map((item) => ({ ...item }));
  const auditEvents = asArray(snapshot.auditEvents).map((item) => ({
    ...item,
    id: `imported-${item.id}`,
    projectId: project.id,
  }));

  addProjectGraphInStore(store, {
    project,
    phases,
    gates,
    rolePairs,
    gateRequirements,
    workPackages,
    artifactVersions,
    reviews,
    evidenceRefs,
    gateApprovalPacks,
    risks,
    agentJobs,
    agentRuns,
    agentFindings,
    notifications,
    auditEvents,
  });

  audit(input.importEventType || "PROJECT_IMPORTED", "human", input.actorUserId || "user-project-manager", "project", project.id, {
    sourceExportedAt: snapshot.exportedAt || null,
    ...(input.importPayload || {}),
    importedCounts: validation.summary,
  });
  persistStore();

  return {
    statusCode: 201,
    body: {
      validation,
      project: getActiveProjectView(),
    },
  };
}

function uniqueProjectIdFromName(name) {
  let baseId = `project-${slugifyProjectName(name)}`;
  if (projectExists(store, baseId)) {
    baseId = `${baseId}-${Date.now()}`;
  }
  return baseId;
}

function remapSnapshotForProjectCopy(snapshot, projectId, name) {
  const copy = structuredClone(snapshot);
  const phaseIdMap = new Map();
  const gateIdMap = new Map();
  const rolePairIdMap = new Map();
  const workPackageIdMap = new Map();

  copy.project = {
    ...copy.project,
    id: projectId,
    name,
    createdAt: new Date().toISOString(),
    clonedFromProjectId: snapshot.project.id,
  };

  copy.phases = asArray(copy.phases).map((phase) => {
    const id = `${projectId}-${phase.id}`;
    phaseIdMap.set(phase.id, id);
    return { ...phase, id, projectId };
  });
  copy.project.currentPhaseId = phaseIdMap.get(snapshot.project.currentPhaseId) || copy.project.currentPhaseId;

  copy.gates = asArray(copy.gates).map((gate) => {
    const id = `${projectId}-${gate.id}`;
    gateIdMap.set(gate.id, id);
    return {
      ...gate,
      id,
      projectId,
      phaseId: phaseIdMap.get(gate.phaseId),
    };
  });

  copy.rolePairs = asArray(copy.rolePairs).map((rolePair) => {
    const id = `${projectId}-${rolePair.id}`;
    rolePairIdMap.set(rolePair.id, id);
    return { ...rolePair, id, projectId };
  });

  copy.workPackages = asArray(copy.workPackages).map(({ phaseName, ownerUserId, agentKey, ...workPackage }) => {
    const id = `${projectId}-${workPackage.id}`;
    workPackageIdMap.set(workPackage.id, id);
    return {
      ...workPackage,
      id,
      projectId,
      phaseId: phaseIdMap.get(workPackage.phaseId),
      rolePairId: rolePairIdMap.get(workPackage.rolePairId),
    };
  });

  copy.gateRequirements = asArray(copy.gateRequirements).map((requirement) => ({
    ...requirement,
    id: `${projectId}-${requirement.id}`,
    gateId: gateIdMap.get(requirement.gateId),
  }));

  copy.artifactVersions = asArray(copy.artifactVersions).map((artifact) => ({
    ...artifact,
    id: `${projectId}-${artifact.id}`,
    workPackageId: workPackageIdMap.get(artifact.workPackageId),
  }));

  copy.reviews = asArray(copy.reviews).map((review) => ({
    ...review,
    id: `${projectId}-${review.id}`,
    workPackageId: workPackageIdMap.get(review.workPackageId),
  }));

  copy.evidenceRefs = asArray(copy.evidenceRefs).map((evidenceRef) => ({
    ...evidenceRef,
    id: `${projectId}-${evidenceRef.id}`,
    projectId,
    workPackageId: workPackageIdMap.get(evidenceRef.workPackageId),
  }));

  copy.gateApprovalPacks = asArray(copy.gateApprovalPacks).map((approvalPack) => ({
    ...approvalPack,
    id: `${projectId}-${approvalPack.id}`,
    projectId,
    gateId: gateIdMap.get(approvalPack.gateId),
    phaseId: phaseIdMap.get(approvalPack.phaseId),
    reviewPack: remapGateReviewPackForProjectCopy(approvalPack.reviewPack, {
      projectId,
      phaseIdMap,
      gateIdMap,
      workPackageIdMap,
    }),
  }));

  copy.risks = asArray(copy.risks).map(({ phaseName, ...risk }) => ({
    ...risk,
    id: `${projectId}-${risk.id}`,
    projectId,
    phaseId: phaseIdMap.get(risk.phaseId),
  }));

  copy.agentRuns = asArray(copy.agentRuns).map((run) => ({
    ...run,
    id: `${projectId}-${run.id}`,
    workPackageId: workPackageIdMap.get(run.workPackageId),
  }));

  copy.agentJobs = asArray(copy.agentJobs).map((job) => ({
    ...job,
    id: `${projectId}-${job.id}`,
    projectId,
    workPackageId: workPackageIdMap.get(job.workPackageId),
    agentRunId: job.agentRunId ? `${projectId}-${job.agentRunId}` : null,
  }));

  copy.agentFindings = asArray(copy.agentFindings).map((finding) => ({
    ...finding,
    id: `${projectId}-${finding.id}`,
    workPackageId: workPackageIdMap.get(finding.workPackageId),
  }));

  copy.notifications = asArray(copy.notifications).map((notification) => ({
    ...notification,
    id: `${projectId}-${notification.id}`,
    projectId,
    objectId:
      notification.objectType === "workPackage"
        ? workPackageIdMap.get(notification.objectId)
        : notification.objectType === "risk"
          ? `${projectId}-${notification.objectId}`
          : notification.objectType === "gate"
            ? gateIdMap.get(notification.objectId)
            : notification.objectId,
  }));

  copy.auditEvents = asArray(copy.auditEvents).map((event) => ({
    ...event,
    id: `${projectId}-${event.id}`,
    projectId,
  }));

  return copy;
}

function remapGateReviewPackForProjectCopy(reviewPack, maps) {
  if (!reviewPack) {
    return reviewPack;
  }

  return {
    ...reviewPack,
    project: reviewPack.project ? { ...reviewPack.project, id: maps.projectId } : reviewPack.project,
    phase: reviewPack.phase
      ? {
          ...reviewPack.phase,
          id: maps.phaseIdMap.get(reviewPack.phase.id) || reviewPack.phase.id,
        }
      : reviewPack.phase,
    gate: reviewPack.gate
      ? {
          ...reviewPack.gate,
          id: maps.gateIdMap.get(reviewPack.gate.id) || reviewPack.gate.id,
        }
      : reviewPack.gate,
    readiness: reviewPack.readiness
      ? {
          ...reviewPack.readiness,
          gateId: maps.gateIdMap.get(reviewPack.readiness.gateId) || reviewPack.readiness.gateId,
          blockers: asArray(reviewPack.readiness.blockers).map((blocker) => ({
            ...blocker,
            relatedObjectId: maps.workPackageIdMap.get(blocker.relatedObjectId) || blocker.relatedObjectId,
          })),
        }
      : reviewPack.readiness,
    evidence: asArray(reviewPack.evidence).map((item) => ({
      ...item,
      workPackageId: maps.workPackageIdMap.get(item.workPackageId) || item.workPackageId,
      manualEvidenceRefs: asArray(item.manualEvidenceRefs).map((evidenceRef) => ({
        ...evidenceRef,
        id: `${maps.projectId}-${evidenceRef.id}`,
        projectId: maps.projectId,
        workPackageId: maps.workPackageIdMap.get(evidenceRef.workPackageId) || evidenceRef.workPackageId,
      })),
    })),
    blockers: asArray(reviewPack.blockers).map((blocker) => ({
      ...blocker,
      relatedObjectId: maps.workPackageIdMap.get(blocker.relatedObjectId) || blocker.relatedObjectId,
    })),
  };
}

export function cloneProject(projectId, body = {}) {
  const snapshot = getProjectSnapshot(projectId);
  if (!snapshot) {
    return {
      statusCode: 404,
      body: { error: "项目不存在" },
    };
  }

  const name = body.name?.trim() || `${snapshot.project.name} 副本`;
  const newProjectId = uniqueProjectIdFromName(name);
  const copy = remapSnapshotForProjectCopy(snapshot, newProjectId, name);

  return importProjectSnapshot({
    ...copy,
    actorUserId: body.userId || "user-project-manager",
    importEventType: "PROJECT_CLONED",
    importPayload: {
      sourceProjectId: projectId,
    },
  });
}

function slugifyProjectName(name) {
  const ascii = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii || `project-${Date.now()}`;
}

export function createProject(body = {}) {
  const name = body.name?.trim();
  if (!name) {
    return {
      statusCode: 400,
      body: { error: "项目名称不能为空" },
    };
  }

  const baseId = uniqueProjectIdFromName(name);

  const activePhaseKey = body.activePhaseKey || "initiation";
  const phaseDefinition = getHardwarePhaseTemplate().phases.find((phase) => phase.phaseKey === activePhaseKey);
  if (!phaseDefinition) {
    return validationError("activePhaseKey 不存在于硬件阶段模板", {
      activePhaseKey,
      allowedPhaseKeys: getHardwarePhaseTemplate().phases.map((phase) => phase.phaseKey),
    });
  }

  const project = {
    id: baseId,
    name,
    productLine: body.productLine || "",
    currentPhaseId: `${baseId}-phase-${activePhaseKey}`,
    status: "IN_PROGRESS",
    createdAt: new Date().toISOString(),
  };
  const generated = buildProjectFromTemplate(project, activePhaseKey);
  addProjectGraphInStore(store, {
    project,
    phases: generated.phases,
    gates: generated.gates,
    rolePairs: generated.rolePairs,
    gateRequirements: generated.gateRequirements,
    workPackages: generated.workPackages,
  });

  audit("PROJECT_CREATED", "human", body.userId || "user-project-manager", "project", project.id, {
    templateKey: "standard_hardware_development_v0_1",
  });
  persistStore();

  return {
    statusCode: 201,
    body: getActiveProjectView(),
  };
}

export function selectProject(projectId) {
  const project = findProject(store, projectId);
  if (!project) {
    return {
      statusCode: 404,
      body: { error: "项目不存在" },
    };
  }
  selectProjectInStore(store, project.id);
  persistStore();
  return {
    statusCode: 200,
    body: getActiveProjectView(),
  };
}

export function archiveProject(projectId, body = {}) {
  const project = findProject(store, projectId);
  if (!project) {
    return {
      statusCode: 404,
      body: { error: "项目不存在" },
    };
  }
  if (project.status === "ARCHIVED") {
    return {
      statusCode: 409,
      body: { error: "项目已经归档", projectId: project.id },
    };
  }

  archiveProjectInStore(store, project.id, {
    archivedByUserId: body.userId || body.actorUserId || "user-project-manager",
  });

  audit("PROJECT_ARCHIVED", "human", project.archivedByUserId, "project", project.id, {
    previousStatus: project.previousStatus,
  });
  persistStore();

  return {
    statusCode: 200,
    body: getActiveProjectView(),
  };
}

export function restoreProject(projectId, body = {}) {
  const project = findProject(store, projectId);
  if (!project) {
    return {
      statusCode: 404,
      body: { error: "项目不存在" },
    };
  }
  if (project.status !== "ARCHIVED") {
    return {
      statusCode: 409,
      body: { error: "项目未归档，不能恢复", projectId: project.id },
    };
  }

  const restoreResult = restoreProjectInStore(store, project.id, {
    restoredByUserId: body.userId || body.actorUserId || "user-project-manager",
  });

  audit("PROJECT_RESTORED", "human", project.restoredByUserId, "project", project.id, {
    restoredStatus: restoreResult.restoredStatus,
  });
  persistStore();

  return {
    statusCode: 200,
    body: getActiveProjectView(),
  };
}

export function updateRolePair(rolePairId, body = {}) {
  const rolePair = findRolePair(store, rolePairId);
  if (!rolePair) {
    return {
      statusCode: 404,
      body: { error: "角色配对不存在" },
    };
  }

  if (!body.humanUserId) {
    return {
      statusCode: 400,
      body: { error: "humanUserId 不能为空" },
    };
  }

  if (!findUser(body.humanUserId)) {
    return validationError("负责人用户不存在", {
      humanUserId: body.humanUserId,
    });
  }

  const previousHumanUserId = rolePair.humanUserId;
  if (previousHumanUserId === body.humanUserId) {
    return {
      statusCode: 200,
      body: {
        rolePair,
        unchanged: true,
        project: getActiveProjectView(),
      },
    };
  }

  updateRolePairOwnerInStore(store, rolePair.id, body.humanUserId);
  const actorUserId = body.actorUserId || "user-project-manager";
  const affectedWorkPackageCount = countWorkPackagesByRolePair(store, rolePair.id);
  audit("ROLE_PAIR_UPDATED", "human", actorUserId, "rolePair", rolePair.id, {
    previousHumanUserId,
    humanUserId: body.humanUserId,
    affectedWorkPackageCount,
  });
  notifyUser(body.humanUserId, {
    projectId: rolePair.projectId,
    title: "角色负责人已指派给你",
    message: `${rolePair.humanRole || rolePair.roleKey} 已由 ${actorUserId} 指派给你，关联工作包 ${affectedWorkPackageCount} 个。`,
    type: "INFO",
    objectType: "rolePair",
    objectId: rolePair.id,
  });
  notifyUser(previousHumanUserId, {
    projectId: rolePair.projectId,
    title: "角色负责人已变更",
    message: `${rolePair.humanRole || rolePair.roleKey} 已转交给 ${body.humanUserId}。`,
    type: "INFO",
    objectType: "rolePair",
    objectId: rolePair.id,
  });
  notifyRole("项目经理", {
    projectId: rolePair.projectId,
    title: "角色负责人已更新",
    message: `${rolePair.humanRole || rolePair.roleKey} 负责人由 ${previousHumanUserId} 更新为 ${body.humanUserId}。`,
    type: "INFO",
    objectType: "rolePair",
    objectId: rolePair.id,
  });
  persistStore();

  return {
    statusCode: 200,
    body: {
      rolePair,
      project: getActiveProjectView(),
    },
  };
}

export function updateWorkPackageSchedule(workPackageId, body = {}) {
  const workPackage = findWorkPackage(store, workPackageId);
  if (!workPackage) {
    return { statusCode: 404, body: { error: "工作包不存在" } };
  }

  const dueAt = String(body.dueAt || "").trim();
  if (dueAt && !/^\d{4}-\d{2}-\d{2}$/.test(dueAt)) {
    return validationError("dueAt 必须是 YYYY-MM-DD 格式", {
      dueAt,
    });
  }

  updateWorkPackageScheduleInStore(store, workPackage.id, dueAt);
  audit("WORK_PACKAGE_SCHEDULE_UPDATED", "human", body.actorUserId || "user-project-manager", "workPackage", workPackage.id, {
    dueAt: workPackage.dueAt,
    scheduleStatus: workPackageScheduleStatus(workPackage),
  });

  const rolePair = findRolePair(store, workPackage.rolePairId);
  notifyUser(rolePair?.humanUserId, {
    title: "工作包截止日期已更新",
    message: `${workPackage.title} 的截止日期更新为 ${workPackage.dueAt || "未设置"}。`,
    type: "INFO",
    objectType: "workPackage",
    objectId: workPackage.id,
  });
  persistStore();

  return {
    statusCode: 200,
    body: {
      workPackage: {
        ...workPackage,
        scheduleStatus: workPackageScheduleStatus(workPackage),
      },
      project: getActiveProjectView(),
    },
  };
}

export function addWorkPackageEvidenceRef(workPackageId, body = {}) {
  const workPackage = findWorkPackage(store, workPackageId);
  if (!workPackage) {
    return { statusCode: 404, body: { error: "工作包不存在" } };
  }

  const label = String(body.label || "").trim();
  const ref = String(body.ref || body.url || "").trim();
  if (!label) {
    return validationError("证据标题不能为空");
  }
  if (!ref) {
    return validationError("证据引用不能为空");
  }

  const evidenceRef = addWorkPackageEvidenceRefInStore(store, workPackage.id, {
    id: `evidence-${randomUUID()}`,
    label,
    ref,
    createdByUserId: body.actorUserId || body.userId || "user-project-manager",
  });
  audit("WORK_PACKAGE_EVIDENCE_ADDED", "human", evidenceRef.createdByUserId, "workPackage", workPackage.id, {
    evidenceRefId: evidenceRef.id,
    label: evidenceRef.label,
    ref: evidenceRef.ref,
  });
  persistStore();

  return {
    statusCode: 201,
    body: {
      evidenceRef,
      workPackage: getWorkPackageDetail(workPackage.id),
      project: getActiveProjectView(),
    },
  };
}

export function uploadWorkPackageEvidenceFile(workPackageId, body = {}) {
  const workPackage = findWorkPackage(store, workPackageId);
  if (!workPackage) {
    return { statusCode: 404, body: { error: "工作包不存在" } };
  }

  const label = String(body.label || "").trim();
  const originalFileName = path.basename(String(body.fileName || "").trim());
  const mimeType = String(body.mimeType || "application/octet-stream").trim() || "application/octet-stream";
  const contentBase64 = String(body.contentBase64 || "").trim();
  if (!label) {
    return validationError("证据标题不能为空");
  }
  if (!originalFileName) {
    return validationError("文件名不能为空");
  }
  if (!contentBase64) {
    return validationError("文件内容不能为空");
  }

  let fileBuffer;
  try {
    fileBuffer = Buffer.from(contentBase64, "base64");
  } catch {
    return validationError("文件内容不是合法 base64");
  }
  if (!fileBuffer.length || fileBuffer.toString("base64").replace(/=+$/, "") !== contentBase64.replace(/=+$/, "")) {
    return validationError("文件内容不是合法 base64");
  }
  if (fileBuffer.length > maxJsonBodyBytes) {
    return validationError(`文件大小不能超过 ${maxJsonBodyBytes} bytes`);
  }

  fs.mkdirSync(evidenceFilesRoot, { recursive: true });
  const evidenceId = `evidence-${randomUUID()}`;
  const extension = path.extname(originalFileName).slice(0, 24);
  const storedFileName = `${evidenceId}${extension}`;
  const storagePath = path.join(evidenceFilesRoot, storedFileName);
  fs.writeFileSync(storagePath, fileBuffer);

  const evidenceRef = addWorkPackageEvidenceRefInStore(store, workPackage.id, {
    id: evidenceId,
    label,
    ref: `/evidence-files/${evidenceId}/download`,
    kind: "file",
    fileName: storedFileName,
    originalFileName,
    mimeType,
    sizeBytes: fileBuffer.length,
    storagePath,
    createdByUserId: body.actorUserId || body.userId || "user-project-manager",
  });
  audit("WORK_PACKAGE_EVIDENCE_FILE_UPLOADED", "human", evidenceRef.createdByUserId, "workPackage", workPackage.id, {
    evidenceRefId: evidenceRef.id,
    label: evidenceRef.label,
    originalFileName: evidenceRef.originalFileName,
    sizeBytes: evidenceRef.sizeBytes,
  });
  try {
    persistStore();
  } catch (error) {
    if (fs.existsSync(storagePath)) {
      fs.unlinkSync(storagePath);
    }
    throw error;
  }

  return {
    statusCode: 201,
    body: {
      evidenceRef,
      workPackage: getWorkPackageDetail(workPackage.id),
      project: getActiveProjectView(),
    },
  };
}

export function getEvidenceFile(evidenceRefId) {
  const evidenceRef = (store.evidenceRefs || []).find((item) => item.id === evidenceRefId);
  if (!evidenceRef || evidenceRef.kind !== "file") {
    return { statusCode: 404, body: { error: "附件不存在" } };
  }
  const resolvedPath = path.resolve(evidenceRef.storagePath || "");
  if (!resolvedPath.startsWith(path.resolve(evidenceFilesRoot)) || !fs.existsSync(resolvedPath)) {
    return { statusCode: 404, body: { error: "附件文件不存在" } };
  }

  return {
    statusCode: 200,
    body: {
      filePath: resolvedPath,
      fileName: evidenceRef.originalFileName || evidenceRef.fileName,
      mimeType: evidenceRef.mimeType || "application/octet-stream",
    },
  };
}

export function getWorkPackageDetail(workPackageId) {
  return getWorkPackageReadModel(store, workPackageId, {
    scheduleStatus: workPackageScheduleStatus,
  });
}

export function getWorkPackageMarkdown(workPackageId) {
  const detail = getWorkPackageDetail(workPackageId);
  return detail ? renderWorkPackageMarkdown(detail) : null;
}

export function getAgentJobs(filters = {}) {
  const project = currentProject();
  const projectWorkPackageIds = new Set(store.workPackages.filter((item) => item.projectId === project.id).map((item) => item.id));
  const status = String(filters.status || "").trim();
  const jobs = (store.agentJobs || [])
    .filter((job) => projectWorkPackageIds.has(job.workPackageId))
    .filter((job) => !status || job.status === status)
    .map((job) => ({
      ...job,
      workPackage: findWorkPackage(store, job.workPackageId),
    }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  return {
    jobs,
    summary: {
      total: jobs.length,
      queued: jobs.filter((job) => job.status === "QUEUED").length,
      running: jobs.filter((job) => job.status === "RUNNING").length,
      completed: jobs.filter((job) => job.status === "COMPLETED").length,
      failed: jobs.filter((job) => job.status === "FAILED").length,
    },
  };
}

export function enqueueAgentJob(body = {}) {
  const workPackage = findWorkPackage(store, body.workPackageId);
  if (!workPackage) {
    return { statusCode: 404, body: { error: "工作包不存在" } };
  }
  if (body.inputRefs && !Array.isArray(body.inputRefs)) {
    return validationError("inputRefs 必须是数组");
  }

  const rolePair = findRolePair(store, workPackage.rolePairId);
  const agentKey = body.agentKey || rolePair?.agentKey;
  if (!agentKey) {
    return {
      statusCode: 409,
      body: {
        error: "工作包缺少绑定 Agent",
        workPackageId: workPackage.id,
      },
    };
  }
  if (body.agentKey && rolePair?.agentKey && body.agentKey !== rolePair.agentKey) {
    return validationError("agentKey 与工作包绑定 Agent 不一致", {
      expectedAgentKey: rolePair.agentKey,
      receivedAgentKey: body.agentKey,
    });
  }

  const job = {
    id: `agent-job-${randomUUID()}`,
    projectId: workPackage.projectId,
    workPackageId: workPackage.id,
    agentKey,
    inputRefs: body.inputRefs || ["artifact:queued-agent"],
    draftMarkdown: body.draftMarkdown || null,
    requestedByUserId: body.actorUserId || body.userId || "user-project-manager",
    status: "QUEUED",
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    resultStatusCode: null,
    agentRunId: null,
    error: "",
  };
  addAgentJobInStore(store, job);
  audit("AGENT_JOB_QUEUED", "human", job.requestedByUserId, "workPackage", workPackage.id, {
    agentJobId: job.id,
    agentKey: job.agentKey,
  });
  persistStore();

  return {
    statusCode: 201,
    body: {
      job,
      agentJobs: getAgentJobs(),
      project: getActiveProjectView(),
    },
  };
}

export function processNextAgentJob(body = {}) {
  const queuedJob = findNextQueuedAgentJob(store);
  if (!queuedJob) {
    return { statusCode: 200, body: { processed: false, agentJobs: getAgentJobs() } };
  }

  startAgentJobInStore(store, queuedJob.id);
  const result = runAgentWorkPackage({
    workPackageId: queuedJob.workPackageId,
    agentKey: queuedJob.agentKey,
    inputRefs: queuedJob.inputRefs,
    ...(queuedJob.draftMarkdown ? { draftMarkdown: queuedJob.draftMarkdown } : {}),
  });

  completeAgentJobInStore(store, queuedJob.id, {
    status: result.statusCode >= 200 && result.statusCode < 300 ? "COMPLETED" : "FAILED",
    resultStatusCode: result.statusCode,
    agentRunId: result.body?.agentRun?.id || null,
    error: result.body?.error || "",
  });
  audit("AGENT_JOB_PROCESSED", "system", body.workerId || "agent-worker", "workPackage", queuedJob.workPackageId, {
    agentJobId: queuedJob.id,
    status: queuedJob.status,
    resultStatusCode: queuedJob.resultStatusCode,
    agentRunId: queuedJob.agentRunId,
  });
  persistStore();

  return {
    statusCode: queuedJob.status === "COMPLETED" ? 200 : 422,
    body: {
      processed: true,
      job: queuedJob,
      result: result.body,
      agentJobs: getAgentJobs(),
      project: getActiveProjectView(),
    },
  };
}

export function getUserActionItems(userId) {
  const project = currentProject();
  const gate = currentGate();
  const gateApprovalPermission = canApproveGate(userId);
  return getUserActionItemsReadModel(store, project.id, userId, {
    scheduleStatus: workPackageScheduleStatus,
    loadArtifactTemplate: (workPackage) =>
      (workPackage.artifactTemplateKey && loadArtifactTemplateByKey(workPackage.artifactTemplateKey)) ||
      loadArtifactTemplateByType(workPackage.requiredArtifactType),
    canReviewWorkPackage,
    canApproveWorkPackage,
    canAcceptRisk,
    canApproveGate: () => gateApprovalPermission,
    currentGateReadiness: gate && gateApprovalPermission.allowed ? checkGate(gate.id) : null,
  });
}

export function getUserNotifications(userId, filters = {}) {
  const project = currentProject();
  return getProjectUserNotifications(store, project.id, userId, filters);
}

export function markNotificationRead(notificationId, body = {}) {
  const notification = findNotification(store, notificationId);
  if (!notification) {
    return { statusCode: 404, body: { error: "通知不存在" } };
  }

  if (body.userId && notification.userId !== body.userId) {
    return {
      statusCode: 403,
      body: {
        error: "当前用户无权处理该通知",
        notificationId,
      },
    };
  }

  markNotificationReadInStore(store, notification.id);
  persistStore();

  return {
    statusCode: 200,
    body: {
      notification,
      notifications: getUserNotifications(notification.userId),
    },
  };
}

export function markUserNotificationsRead(userId) {
  const project = currentProject();
  const updatedCount = markProjectUserNotificationsReadInStore(store, project.id, userId);

  persistStore();

  return {
    statusCode: 200,
    body: {
      updatedCount,
      notifications: getUserNotifications(userId),
    },
  };
}

export function getGateReviewPack(gateId) {
  const gate = findGate(store, gateId);
  if (!gate) {
    return null;
  }

  const readiness = checkGate(gate.id);
  return getGateReviewPackReadModel(store, gateId, { readiness });
}

export function getGateApprovalPack(gateId) {
  return getLatestGateApprovalPack(store, gateId);
}

function createGateApprovalPack(gate, reviewPack, approval) {
  const frozenPack = structuredClone({
    ...reviewPack,
    gate: {
      ...reviewPack.gate,
      status: "APPROVED",
      approvedByUserId: approval.approvedByUserId,
      approvedAt: approval.approvedAt,
      approvalComment: approval.approvalComment,
    },
    readiness: {
      ...reviewPack.readiness,
      status: "READY",
      blockers: [],
    },
    blockers: [],
    summary: {
      ...reviewPack.summary,
      blockerCount: 0,
      readyForApproval: true,
    },
  });
  return addGateApprovalPackInStore(store, {
    id: `gate-pack-${randomUUID()}`,
    projectId: gate.projectId,
    gateId: gate.id,
    phaseId: gate.phaseId,
    approvedByUserId: approval.approvedByUserId,
    approvedAt: approval.approvedAt,
    approvalComment: approval.approvalComment,
    reviewPack: frozenPack,
  });
}

export function runAgentWorkPackage(body) {
  const workPackage = findWorkPackage(store, body.workPackageId);
  if (!workPackage) {
    return { statusCode: 404, body: { error: "工作包不存在" } };
  }

  if (body.inputRefs && !Array.isArray(body.inputRefs)) {
    return validationError("inputRefs 必须是数组");
  }

  const rolePair = findRolePair(store, workPackage.rolePairId);
  const agentKey = body.agentKey || rolePair?.agentKey;
  if (!agentKey) {
    return {
      statusCode: 409,
      body: {
        error: "工作包缺少绑定 Agent",
        workPackageId: workPackage.id,
      },
    };
  }

  if (body.agentKey && rolePair?.agentKey && body.agentKey !== rolePair.agentKey) {
    return validationError("agentKey 与工作包绑定 Agent 不一致", {
      expectedAgentKey: rolePair.agentKey,
      receivedAgentKey: body.agentKey,
    });
  }

  const artifactTemplate =
    (workPackage.artifactTemplateKey && loadArtifactTemplateByKey(workPackage.artifactTemplateKey)) ||
    loadArtifactTemplateByType(workPackage.requiredArtifactType);

  if (!artifactTemplate) {
    return {
      statusCode: 409,
      body: {
        error: "工作包缺少交付物模板",
        workPackageId: workPackage.id,
        artifactType: workPackage.requiredArtifactType,
      },
    };
  }

  const agentRun = {
    id: randomUUID(),
    workPackageId: workPackage.id,
    agentKey,
    status: "OUTPUT_READY",
    inputRefs: body.inputRefs || [],
    artifactTemplateKey: artifactTemplate.templateKey,
    requiredSections: artifactTemplate.requiredSections,
    requiredReviewRoles: artifactTemplate.requiredReviewRoles,
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };
  const draftMarkdown = body.draftMarkdown || artifactTemplate.contentMarkdown;
  const validation = validateArtifactMarkdown(draftMarkdown, artifactTemplate);

  if (validation.status !== "PASSED") {
    const failedRun = {
      ...agentRun,
      status: "OUTPUT_INVALID",
      validation,
    };
    recordInvalidAgentOutputInStore(store, workPackage.id, failedRun);
    audit("AGENT_OUTPUT_INVALID", "agent", failedRun.agentKey, "workPackage", workPackage.id, {
      artifactTemplateKey: artifactTemplate.templateKey,
      validation,
    });
    notifyUser(rolePair?.humanUserId, {
      title: "Agent 输出未通过模板校验",
      message: `${workPackage.title} 需要重新生成或补齐必需章节。`,
      type: "WARNING",
      objectType: "workPackage",
      objectId: workPackage.id,
    });
    persistStore();

    return {
      statusCode: 422,
      body: {
        error: "Agent 输出未满足交付物模板要求，不能进入人类审核",
        agentRun: failedRun,
        workPackage,
        artifactTemplate: {
          templateKey: artifactTemplate.templateKey,
          name: artifactTemplate.name,
          requiredSections: artifactTemplate.requiredSections,
        },
        validation,
      },
    };
  }

  const artifact = {
    id: randomUUID(),
    workPackageId: workPackage.id,
    artifactType: workPackage.requiredArtifactType,
    status: "PENDING_REVIEW",
    version: "0.1",
    createdByActor: `agent:${agentRun.agentKey}`,
    content: {
      title: `${workPackage.title}草稿`,
      summary: "Agent 已生成草稿。该输出仅为建议，必须由人类负责人审核后才可进入正式版本。",
      evidenceRefs: agentRun.inputRefs,
      templateKey: artifactTemplate.templateKey,
      templateName: artifactTemplate.name,
      requiredSections: artifactTemplate.requiredSections,
      requiredReviewRoles: artifactTemplate.requiredReviewRoles,
      draftMarkdown,
      validation,
    },
  };

  recordReadyAgentOutputInStore(store, workPackage.id, agentRun, artifact);
  audit("AGENT_OUTPUT_READY", "agent", agentRun.agentKey, "workPackage", workPackage.id, {
    artifactId: artifact.id,
  });
  notifyUser(rolePair?.humanUserId, {
    title: "工作包待审核",
    message: `${workPackage.title} 已生成 Agent 草稿，等待人类负责人审核。`,
    type: "ACTION",
    objectType: "workPackage",
    objectId: workPackage.id,
  });
  persistStore();

  return { statusCode: 201, body: { agentRun, artifact, workPackage, artifactTemplate } };
}

export function submitHumanReview(body) {
  const workPackage = findWorkPackage(store, body.workPackageId);
  if (!workPackage) {
    return { statusCode: 404, body: { error: "工作包不存在" } };
  }

  if (!allowedReviewDecisions.has(body.decision)) {
    return validationError("审核决定不合法", {
      decision: body.decision,
      allowedDecisions: [...allowedReviewDecisions],
    });
  }

  const reviewerUserId = body.reviewerUserId || "";
  const rolePair = findRolePair(store, workPackage.rolePairId);
  const artifactTemplate =
    (workPackage.artifactTemplateKey && loadArtifactTemplateByKey(workPackage.artifactTemplateKey)) ||
    loadArtifactTemplateByType(workPackage.requiredArtifactType);
  const permission = canReviewWorkPackage(reviewerUserId, workPackage, rolePair, artifactTemplate);
  if (!permission.allowed) {
    audit("HUMAN_REVIEW_DENIED", "human", reviewerUserId || "unknown", "workPackage", workPackage.id, {
      reason: permission.reason,
    });
    persistStore();
    return {
      statusCode: 403,
      body: {
        error: "当前用户无权审核该工作包",
        reason: permission.reason,
        workPackageId: workPackage.id,
      },
    };
  }

  if (body.decision === "APPROVE" || body.decision === "APPROVE_WITH_CONDITIONS") {
    const approvePermission = canApproveWorkPackage(reviewerUserId, rolePair);
    if (!approvePermission.allowed) {
      audit("HUMAN_APPROVAL_DENIED", "human", reviewerUserId || "unknown", "workPackage", workPackage.id, {
        reason: approvePermission.reason,
      });
      persistStore();
      return {
        statusCode: 403,
        body: {
          error: "当前用户无权批准该工作包",
          reason: approvePermission.reason,
          workPackageId: workPackage.id,
        },
      };
    }
  }

  const reviewComment = String(body.comment || "").trim();
  if ((body.decision === "REQUEST_REVISION" || body.decision === "REJECT") && !reviewComment) {
    return validationError("要求修改或驳回必须填写审核意见", {
      decision: body.decision,
    });
  }

  const review = {
    id: randomUUID(),
    workPackageId: workPackage.id,
    reviewerUserId,
    decision: body.decision,
    comment: reviewComment,
    conditions: body.conditions || [],
    reviewedAt: new Date().toISOString(),
  };

  const pendingArtifact = findLatestPendingArtifactForWorkPackage(store, workPackage.id);

  if (!pendingArtifact) {
    return {
      statusCode: 409,
      body: {
        error: "没有可审核的待审交付物",
        workPackageId: workPackage.id,
        currentStatus: workPackage.status,
      },
    };
  }

  if (pendingArtifact.content?.validation?.status && pendingArtifact.content.validation.status !== "PASSED") {
    return {
      statusCode: 409,
      body: {
        error: "交付物模板校验未通过，不能进入人类审核",
        workPackageId: workPackage.id,
        validation: pendingArtifact.content.validation,
      },
    };
  }

  submitHumanReviewInStore(store, workPackage.id, pendingArtifact.id, review);

  audit("HUMAN_REVIEW_SUBMITTED", "human", review.reviewerUserId, "workPackage", workPackage.id, {
    decision: review.decision,
    comment: review.comment,
  });
  if (body.decision === "APPROVE" || body.decision === "APPROVE_WITH_CONDITIONS") {
    notifyRole("项目经理", {
      title: "工作包已批准",
      message: `${workPackage.title} 已由 ${review.reviewerUserId} 批准。`,
      type: "INFO",
      objectType: "workPackage",
      objectId: workPackage.id,
    });
  } else {
    notifyRole("项目经理", {
      title: "工作包需要返工",
      message: `${workPackage.title} 的审核结果为 ${body.decision}。`,
      type: "WARNING",
      objectType: "workPackage",
      objectId: workPackage.id,
    });
  }
  persistStore();

  return { statusCode: 201, body: { review, workPackage, latestGateCheck: currentGateCheck() } };
}

export function completeConditionalApproval(reviewId, body = {}) {
  const review = findReview(store, reviewId);
  if (!review) {
    return { statusCode: 404, body: { error: "审核记录不存在" } };
  }
  if (review.decision !== "APPROVE_WITH_CONDITIONS" || !Array.isArray(review.conditions) || review.conditions.length === 0) {
    return validationError("审核记录不是有条件批准", { reviewId });
  }

  const workPackage = findWorkPackage(store, review.workPackageId);
  if (!workPackage) {
    return { statusCode: 404, body: { error: "工作包不存在" } };
  }

  const rolePair = findRolePair(store, workPackage.rolePairId);
  const actorUserId = body.userId || body.actorUserId || "";
  const isOwner = rolePair?.humanUserId === actorUserId;
  const canApprove = canApproveWorkPackage(actorUserId, rolePair).allowed;
  if (!isOwner && !canApprove) {
    return {
      statusCode: 403,
      body: {
        error: "当前用户无权完成有条件批准条款",
        workPackageId: workPackage.id,
        reviewId: review.id,
      },
    };
  }

  completeReviewConditionsInStore(store, review.id, {
    completedByUserId: actorUserId,
    completionComment: String(body.comment || "").trim(),
  });

  audit("CONDITIONAL_APPROVAL_COMPLETED", "human", actorUserId, "review", review.id, {
    workPackageId: workPackage.id,
    conditions: review.conditions,
    comment: review.conditionsCompletionComment,
  });
  notifyRole("项目经理", {
    title: "有条件批准条款已完成",
    message: `${workPackage.title} 的补充条款已由 ${actorUserId} 完成。`,
    type: "INFO",
    objectType: "review",
    objectId: review.id,
  });
  persistStore();
  return {
    statusCode: 200,
    body: {
      review,
      workPackage,
      actionItems: getUserActionItems(actorUserId),
      latestGateCheck: currentGateCheck(),
    },
  };
}

export function updateRiskStatus(riskId, status, body = {}) {
  const risk = findRisk(store, riskId);
  if (!risk) {
    return { statusCode: 404, body: { error: "风险不存在" } };
  }

  if (!allowedRiskStatuses.has(status)) {
    return validationError("风险状态不合法", {
      status,
      allowedStatuses: [...allowedRiskStatuses],
    });
  }

  const actorUserId = body.userId || "";
  if (status === "ACCEPTED") {
    const permission = canAcceptRisk(actorUserId);
    if (!permission.allowed) {
      audit("RISK_ACCEPT_DENIED", "human", actorUserId || "unknown", "risk", risk.id, {
        reason: permission.reason,
      });
      persistStore();
      return {
        statusCode: 403,
        body: {
          error: "当前用户无权接受风险",
          reason: permission.reason,
          riskId: risk.id,
        },
      };
    }
  }

  if (status === "CLOSED") {
    const permission = canCloseRisk(actorUserId);
    if (!permission.allowed) {
      audit("RISK_CLOSE_DENIED", "human", actorUserId || "unknown", "risk", risk.id, {
        reason: permission.reason,
      });
      persistStore();
      return {
        statusCode: 403,
        body: {
          error: "当前用户无权关闭风险",
          reason: permission.reason,
          riskId: risk.id,
        },
      };
    }
  }

  updateRiskStatusInStore(store, risk.id, {
    status,
    actorUserId,
    comment: body.comment || "",
  });

  audit(`RISK_${status}`, "human", actorUserId, "risk", risk.id, {
    comment: body.comment || "",
  });
  notifyRole("项目经理", {
    title: status === "ACCEPTED" ? "风险已接受" : "风险已关闭",
    message: `${risk.title} 状态更新为 ${status}。`,
    type: "INFO",
    objectType: "risk",
    objectId: risk.id,
  });
  notifyRole("质量负责人", {
    title: status === "ACCEPTED" ? "风险已接受" : "风险已关闭",
    message: `${risk.title} 状态更新为 ${status}。`,
    type: "INFO",
    objectType: "risk",
    objectId: risk.id,
  });
  persistStore();
  return { statusCode: 200, body: { risk, latestGateCheck: currentGateCheck() } };
}

export function updateRiskMitigation(riskId, body = {}) {
  const risk = findRisk(store, riskId);
  if (!risk) {
    return { statusCode: 404, body: { error: "风险不存在" } };
  }

  const actorUserId = body.userId || body.actorUserId || "user-project-manager";
  const mitigation = String(body.mitigation || "").trim();
  const mitigationDueAt = String(body.mitigationDueAt || body.dueAt || "").trim();
  if (mitigationDueAt && !/^\d{4}-\d{2}-\d{2}$/.test(mitigationDueAt)) {
    return validationError("mitigationDueAt 必须是 YYYY-MM-DD 格式", { mitigationDueAt });
  }

  const mitigationOwnerUserId = String(body.mitigationOwnerUserId || body.ownerUserId || "").trim();
  if (mitigationOwnerUserId && !findUser(mitigationOwnerUserId)) {
    return validationError("缓解负责人用户不存在", { mitigationOwnerUserId });
  }

  updateRiskMitigationInStore(store, risk.id, {
    mitigation,
    mitigationDueAt,
    mitigationOwnerUserId,
    updatedByUserId: actorUserId,
  });

  audit("RISK_MITIGATION_UPDATED", "human", actorUserId, "risk", risk.id, {
    mitigationOwnerUserId: risk.mitigationOwnerUserId,
    mitigationDueAt: risk.mitigationDueAt,
    mitigation: risk.mitigation,
  });

  if (risk.mitigationOwnerUserId) {
    notifyUser(risk.mitigationOwnerUserId, {
      projectId: risk.projectId,
      title: "风险缓解任务已分配",
      message: `${risk.title} 的缓解措施已更新，截止日期 ${risk.mitigationDueAt || "未设置"}。`,
      type: "ACTION",
      objectType: "risk",
      objectId: risk.id,
    });
  }

  persistStore();
  return { statusCode: 200, body: { risk, latestGateCheck: currentGateCheck() } };
}

export function completeRiskMitigation(riskId, body = {}) {
  const risk = findRisk(store, riskId);
  if (!risk) {
    return { statusCode: 404, body: { error: "风险不存在" } };
  }

  if (!risk.mitigationOwnerUserId && !risk.mitigation && !risk.mitigationDueAt) {
    return validationError("风险缓解计划尚未设置", { riskId: risk.id });
  }

  const actorUserId = body.userId || body.actorUserId || "user-project-manager";
  const ownerCanComplete = risk.mitigationOwnerUserId && risk.mitigationOwnerUserId === actorUserId;
  const riskDecisionPermission = canAcceptRisk(actorUserId);
  if (!ownerCanComplete && !riskDecisionPermission.allowed) {
    return {
      statusCode: 403,
      body: {
        error: "当前用户无权完成风险缓解任务",
        reason: riskDecisionPermission.reason,
        riskId: risk.id,
      },
    };
  }

  completeRiskMitigationInStore(store, risk.id, {
    completedByUserId: actorUserId,
    completionComment: body.comment || "",
  });

  audit("RISK_MITIGATION_DONE", "human", actorUserId, "risk", risk.id, {
    mitigationOwnerUserId: risk.mitigationOwnerUserId,
    comment: risk.mitigationCompletionComment,
  });
  notifyRole("项目经理", {
    title: "风险缓解已完成",
    message: `${risk.title} 的缓解任务已由 ${actorUserId} 完成。`,
    type: "INFO",
    objectType: "risk",
    objectId: risk.id,
  });
  notifyRole("质量负责人", {
    title: "风险缓解已完成",
    message: `${risk.title} 的缓解任务已由 ${actorUserId} 完成。`,
    type: "INFO",
    objectType: "risk",
    objectId: risk.id,
  });

  persistStore();
  return { statusCode: 200, body: { risk, latestGateCheck: currentGateCheck() } };
}

function createRiskForCurrentPhase(body = {}, options = {}) {
  const project = currentProject();
  if (project.status === "COMPLETED") {
    return {
      statusCode: 409,
      body: {
        error: "项目已完成，不能继续创建阶段风险",
        projectId: project.id,
      },
    };
  }

  const phase = findPhase(store, project.currentPhaseId);
  if (!phase) {
    return { statusCode: 404, body: { error: "当前阶段不存在" } };
  }

  const title = String(body.title || "").trim();
  if (options.requireTitle && !title) {
    return validationError("风险标题不能为空");
  }

  const severity = body.severity || "HIGH";
  if (!allowedRiskSeverities.has(severity)) {
    return validationError("风险严重度不合法", {
      severity,
      allowedSeverities: [...allowedRiskSeverities],
    });
  }

  const risk = {
    id: `risk-${phase.phaseKey}-${Date.now()}`,
    projectId: project.id,
    phaseId: phase.id,
    title: title || `${phase.name} 演示高风险`,
    severity,
    status: "OPEN",
    createdByUserId: body.userId || options.defaultActorId || "demo",
    createdAt: new Date().toISOString(),
  };

  addRiskInStore(store, risk);
  audit("RISK_CREATED", options.actorType || "system", risk.createdByUserId, "risk", risk.id, {
    phaseId: phase.id,
    severity: risk.severity,
  });
  notifyRole("项目经理", {
    title: "新风险待处理",
    message: `${risk.title} 已创建，严重度为 ${risk.severity}。`,
    type: "ACTION",
    objectType: "risk",
    objectId: risk.id,
  });
  notifyRole("质量负责人", {
    title: "新风险待处理",
    message: `${risk.title} 已创建，严重度为 ${risk.severity}。`,
    type: "ACTION",
    objectType: "risk",
    objectId: risk.id,
  });
  persistStore();

  return {
    statusCode: 201,
    body: {
      risk,
      latestGateCheck: currentGateCheck(),
    },
  };
}

export function createCurrentPhaseRisk(body = {}) {
  return createRiskForCurrentPhase(body, {
    actorType: "human",
    defaultActorId: "user-project-manager",
    requireTitle: true,
  });
}

export function createDemoRiskForCurrentPhase(body = {}) {
  return createRiskForCurrentPhase(body, {
    actorType: "system",
    defaultActorId: "demo",
    requireTitle: false,
  });
}

export function approveGate(gateId, body = {}) {
  const gate = findGate(store, gateId);
  if (!gate) {
    return { statusCode: 404, body: { error: "阶段门不存在" } };
  }

  if (gate.status === "APPROVED") {
    return {
      statusCode: 409,
      body: {
        error: "阶段门已经批准，不能重复批准",
        gateId: gate.id,
      },
    };
  }

  const actorUserId = body.userId || "";
  const permission = canApproveGate(actorUserId);
  if (!permission.allowed) {
    audit("GATE_APPROVAL_DENIED", "human", actorUserId || "unknown", "gate", gate.id, {
      reason: permission.reason,
    });
    persistStore();
    return {
      statusCode: 403,
      body: {
        error: "当前用户无权批准阶段门",
        reason: permission.reason,
        gateId: gate.id,
      },
    };
  }

  const readiness = checkGate(gateId);
  if (!readiness || readiness.status !== "READY") {
    return {
      statusCode: 409,
      body: {
        error: "阶段门尚未满足通过条件，不能批准",
        gateId: gate.id,
        readiness,
      },
    };
  }
  const reviewPack = getGateReviewPack(gateId);

  const approval = approveGateInStore(store, gate.id, {
    approvedByUserId: actorUserId,
    approvalComment: body.comment || "",
  });
  const phase = approval.phase;
  const project = approval.project;
  const approvalPack = createGateApprovalPack(gate, reviewPack, {
    approvedByUserId: actorUserId,
    approvedAt: gate.approvedAt,
    approvalComment: gate.approvalComment,
  });

  audit("GATE_APPROVED", "human", actorUserId, "gate", gate.id, {
    nextPhaseId: project.currentPhaseId,
    comment: gate.approvalComment,
    approvalPackId: approvalPack.id,
  });
  notifyRole("项目经理", {
    title: "阶段门已批准",
    message: `${phase?.name || gate.phaseId} 阶段门已批准。`,
    type: "INFO",
    objectType: "gate",
    objectId: gate.id,
  });
  persistStore();

  return {
    statusCode: 200,
    body: {
      gate,
      approvalPack,
      project,
      phases: store.phases,
    },
  };
}

async function handleAgentRun(req, res) {
  const result = runAgentWorkPackage(await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleAgentJobCreate(req, res) {
  const result = enqueueAgentJob(await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleAgentJobProcessNext(req, res) {
  const result = processNextAgentJob(await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleReview(req, res) {
  const result = submitHumanReview(await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleConditionalApprovalComplete(req, res, reviewId) {
  const result = completeConditionalApproval(reviewId, await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleRiskUpdate(req, res, riskId, status) {
  const result = updateRiskStatus(riskId, status, await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleRiskMitigationUpdate(req, res, riskId) {
  const result = updateRiskMitigation(riskId, await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleRiskMitigationComplete(req, res, riskId) {
  const result = completeRiskMitigation(riskId, await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleCreateRisk(req, res) {
  const result = createCurrentPhaseRisk(await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleCreateDemoRisk(req, res) {
  const result = createDemoRiskForCurrentPhase(await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleCreateProject(req, res) {
  const result = createProject(await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleStorageRestoreBackup(req, res) {
  const result = restoreStorageBackup(await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleCreateStorageCheckpoint(req, res) {
  const result = createStorageCheckpoint(await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleRestoreStorageCheckpoint(req, res) {
  const result = restoreStorageCheckpoint(await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleValidateProjectImport(req, res) {
  const result = validateProjectSnapshotImport(await readJson(req));
  return writeJson(res, result.valid ? 200 : 422, result);
}

async function handleImportProject(req, res) {
  const result = importProjectSnapshot(await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleCloneProject(req, res, projectId) {
  const result = cloneProject(projectId, await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleSelectProject(req, res, projectId) {
  const result = selectProject(projectId);
  return writeJson(res, result.statusCode, result.body);
}

async function handleArchiveProject(req, res, projectId) {
  const result = archiveProject(projectId, await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleRestoreProject(req, res, projectId) {
  const result = restoreProject(projectId, await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleUpdateRolePair(req, res, rolePairId) {
  const result = updateRolePair(rolePairId, await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleUpdateWorkPackageSchedule(req, res, workPackageId) {
  const result = updateWorkPackageSchedule(workPackageId, await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleAddWorkPackageEvidenceRef(req, res, workPackageId) {
  const result = addWorkPackageEvidenceRef(workPackageId, await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleUploadWorkPackageEvidenceFile(req, res, workPackageId) {
  const result = uploadWorkPackageEvidenceFile(workPackageId, await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleGateApproval(req, res, gateId) {
  const result = approveGate(gateId, await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleMarkNotificationRead(req, res, notificationId) {
  const result = markNotificationRead(notificationId, await readJson(req));
  return writeJson(res, result.statusCode, result.body);
}

async function handleMarkUserNotificationsRead(req, res, userId) {
  await readJson(req);
  const result = markUserNotificationsRead(userId);
  return writeJson(res, result.statusCode, result.body);
}

function serveStatic(req, res, url) {
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(staticRoot, pathname));

  if (!filePath.startsWith(staticRoot)) {
    return writeText(res, 403, "Forbidden");
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return writeText(res, 404, "Not found");
  }

  const ext = path.extname(filePath);
  const contentType =
    ext === ".html"
      ? "text/html; charset=utf-8"
      : ext === ".css"
        ? "text/css; charset=utf-8"
        : ext === ".js"
          ? "application/javascript; charset=utf-8"
          : "application/octet-stream";

  return writeText(res, 200, fs.readFileSync(filePath), contentType);
}

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  attachAccessLog(req, res, url);

  if (req.method === "OPTIONS") {
    return writeJson(res, 204, {});
  }

  try {
    const access = verifyPilotAccess(req, url);
    if (!access.allowed) {
      return writeJson(res, access.statusCode, access.body);
    }

    const writeAccess = checkRuntimeWriteAccess(runtimeWritePolicy, req.method, url.pathname);
    if (!writeAccess.allowed) {
      return writeJson(res, writeAccess.statusCode, writeAccess.body);
    }

    if (req.method === "GET" && url.pathname === "/health") {
      const runtimeSummary = getStoreRuntimeSummary(store);
      return writeJson(res, 200, {
        ok: true,
        ...serviceMetadata,
        activeProjectId: runtimeSummary.activeProjectId,
        projectCount: runtimeSummary.projectCount,
      });
    }

    if (req.method === "GET" && url.pathname === "/ready") {
      const readiness = getReadinessStatus();
      return writeJson(res, readiness.ready ? 200 : 503, readiness);
    }

    if (req.method === "GET" && url.pathname === "/pilot/readiness") {
      return writeJson(res, 200, getPilotReadinessStatus());
    }

    if (req.method === "GET" && url.pathname === "/pilot/launch") {
      return writeJson(res, 200, getPilotLaunchStatus());
    }

    if (req.method === "GET" && url.pathname === "/pilot/checklist") {
      return writeJson(res, 200, getPilotChecklistStatus());
    }

    if (req.method === "GET" && url.pathname === "/runtime/config") {
      return writeJson(res, 200, getRuntimeConfigStatus());
    }

    if (req.method === "GET" && url.pathname === "/runtime/network") {
      return writeJson(res, 200, getRuntimeNetworkStatus());
    }

    if (req.method === "GET" && url.pathname === "/ops/summary") {
      return writeJson(res, 200, getOpsSummaryStatus());
    }

    if (req.method === "GET" && url.pathname === "/metrics") {
      return writeText(res, 200, renderMetrics(), "text/plain; version=0.0.4; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/storage/status") {
      return writeJson(res, 200, getStorageStatus());
    }

    if (req.method === "GET" && url.pathname === "/storage/doctor") {
      return writeJson(res, 200, getStorageDoctorStatus());
    }

    if (req.method === "POST" && url.pathname === "/storage/restore-backup") {
      return await handleStorageRestoreBackup(req, res);
    }

    if (req.method === "POST" && url.pathname === "/storage/checkpoints") {
      return await handleCreateStorageCheckpoint(req, res);
    }

    if (req.method === "POST" && url.pathname === "/storage/restore-checkpoint") {
      return await handleRestoreStorageCheckpoint(req, res);
    }

    if (req.method === "POST" && url.pathname === "/demo/reset") {
      const body = await readJson(req);
      if (body.confirm !== true) {
        return writeJson(res, 400, validationError("重置演示数据需要 confirm: true").body);
      }
      return writeJson(res, 200, resetDemoStore());
    }

    if (req.method === "GET" && url.pathname === "/projects/demo") {
      return writeJson(res, 200, getActiveProjectView());
    }

    if (req.method === "POST" && url.pathname === "/projects") {
      return await handleCreateProject(req, res);
    }

    if (req.method === "POST" && url.pathname === "/projects/import/validate") {
      return await handleValidateProjectImport(req, res);
    }

    if (req.method === "POST" && url.pathname === "/projects/import") {
      return await handleImportProject(req, res);
    }

    const cloneProjectMatch = url.pathname.match(/^\/projects\/([^/]+)\/clone$/);
    if (req.method === "POST" && cloneProjectMatch) {
      return await handleCloneProject(req, res, cloneProjectMatch[1]);
    }

    const projectSnapshotMarkdownMatch = url.pathname.match(/^\/projects\/([^/]+)\/snapshot\.md$/);
    if (req.method === "GET" && projectSnapshotMarkdownMatch) {
      const snapshot = getProjectSnapshot(projectSnapshotMarkdownMatch[1]);
      return snapshot
        ? writeText(res, 200, renderProjectSnapshotMarkdown(snapshot), "text/markdown; charset=utf-8")
        : writeJson(res, 404, { error: "项目不存在" });
    }

    const projectSnapshotMatch = url.pathname.match(/^\/projects\/([^/]+)\/snapshot$/);
    if (req.method === "GET" && projectSnapshotMatch) {
      const snapshot = getProjectSnapshot(projectSnapshotMatch[1]);
      return snapshot ? writeJson(res, 200, snapshot) : writeJson(res, 404, { error: "项目不存在" });
    }

    const projectRiskRegisterMarkdownMatch = url.pathname.match(/^\/projects\/([^/]+)\/risk-register\.md$/);
    if (req.method === "GET" && projectRiskRegisterMarkdownMatch) {
      const register = getProjectRiskRegister(projectRiskRegisterMarkdownMatch[1]);
      return register
        ? writeText(res, 200, renderRiskRegisterMarkdown(register), "text/markdown; charset=utf-8")
        : writeJson(res, 404, { error: "项目不存在" });
    }

    const projectRiskRegisterMatch = url.pathname.match(/^\/projects\/([^/]+)\/risk-register$/);
    if (req.method === "GET" && projectRiskRegisterMatch) {
      const register = getProjectRiskRegister(projectRiskRegisterMatch[1]);
      return register ? writeJson(res, 200, register) : writeJson(res, 404, { error: "项目不存在" });
    }

    const selectProjectMatch = url.pathname.match(/^\/projects\/([^/]+)\/select$/);
    if (req.method === "POST" && selectProjectMatch) {
      return await handleSelectProject(req, res, selectProjectMatch[1]);
    }

    const archiveProjectMatch = url.pathname.match(/^\/projects\/([^/]+)\/archive$/);
    if (req.method === "POST" && archiveProjectMatch) {
      return await handleArchiveProject(req, res, archiveProjectMatch[1]);
    }

    const restoreProjectMatch = url.pathname.match(/^\/projects\/([^/]+)\/restore$/);
    if (req.method === "POST" && restoreProjectMatch) {
      return await handleRestoreProject(req, res, restoreProjectMatch[1]);
    }

    const rolePairMatch = url.pathname.match(/^\/role-pairs\/([^/]+)$/);
    if (req.method === "PATCH" && rolePairMatch) {
      return await handleUpdateRolePair(req, res, rolePairMatch[1]);
    }

    if (req.method === "GET" && url.pathname === "/users/demo") {
      return writeJson(res, 200, { users: getDemoUsers() });
    }

    const userActionItemsMatch = url.pathname.match(/^\/users\/([^/]+)\/action-items$/);
    if (req.method === "GET" && userActionItemsMatch) {
      return writeJson(res, 200, getUserActionItems(userActionItemsMatch[1]));
    }

    const userNotificationsMatch = url.pathname.match(/^\/users\/([^/]+)\/notifications$/);
    if (req.method === "GET" && userNotificationsMatch) {
      return writeJson(res, 200, getUserNotifications(userNotificationsMatch[1], Object.fromEntries(url.searchParams)));
    }

    const userNotificationsReadMatch = url.pathname.match(/^\/users\/([^/]+)\/notifications\/read$/);
    if (req.method === "POST" && userNotificationsReadMatch) {
      return await handleMarkUserNotificationsRead(req, res, userNotificationsReadMatch[1]);
    }

    const notificationReadMatch = url.pathname.match(/^\/notifications\/([^/]+)\/read$/);
    if (req.method === "POST" && notificationReadMatch) {
      return await handleMarkNotificationRead(req, res, notificationReadMatch[1]);
    }

    const workPackageMatch = url.pathname.match(/^\/work-packages\/([^/]+)$/);
    if (req.method === "GET" && workPackageMatch) {
      const result = getWorkPackageDetail(workPackageMatch[1]);
      return result ? writeJson(res, 200, result) : writeJson(res, 404, { error: "工作包不存在" });
    }

    const workPackageMarkdownMatch = url.pathname.match(/^\/work-packages\/([^/]+)\/export\.md$/);
    if (req.method === "GET" && workPackageMarkdownMatch) {
      const result = getWorkPackageMarkdown(workPackageMarkdownMatch[1]);
      return result
        ? writeText(res, 200, result, "text/markdown; charset=utf-8")
        : writeJson(res, 404, { error: "工作包不存在" });
    }

    const workPackageScheduleMatch = url.pathname.match(/^\/work-packages\/([^/]+)\/schedule$/);
    if (req.method === "PATCH" && workPackageScheduleMatch) {
      return await handleUpdateWorkPackageSchedule(req, res, workPackageScheduleMatch[1]);
    }

    const workPackageEvidenceRefMatch = url.pathname.match(/^\/work-packages\/([^/]+)\/evidence-refs$/);
    if (req.method === "POST" && workPackageEvidenceRefMatch) {
      return await handleAddWorkPackageEvidenceRef(req, res, workPackageEvidenceRefMatch[1]);
    }

    const workPackageEvidenceFileMatch = url.pathname.match(/^\/work-packages\/([^/]+)\/evidence-files$/);
    if (req.method === "POST" && workPackageEvidenceFileMatch) {
      return await handleUploadWorkPackageEvidenceFile(req, res, workPackageEvidenceFileMatch[1]);
    }

    const evidenceFileDownloadMatch = url.pathname.match(/^\/evidence-files\/([^/]+)\/download$/);
    if (req.method === "GET" && evidenceFileDownloadMatch) {
      const result = getEvidenceFile(evidenceFileDownloadMatch[1]);
      return result.statusCode === 200
        ? writeFileDownload(res, result.body.filePath, result.body)
        : writeJson(res, result.statusCode, result.body);
    }

    if (req.method === "GET" && url.pathname === "/templates/hardware") {
      return writeJson(res, 200, getHardwarePhaseTemplate());
    }

    if (req.method === "GET" && url.pathname === "/templates/artifacts") {
      return writeJson(res, 200, getArtifactTemplateRegistry());
    }

    const artifactTemplateMatch = url.pathname.match(/^\/templates\/artifacts\/([^/]+)$/);
    if (req.method === "GET" && artifactTemplateMatch) {
      const template = loadArtifactTemplateByKey(artifactTemplateMatch[1]);
      return template ? writeJson(res, 200, template) : writeJson(res, 404, { error: "交付物模板不存在" });
    }

    if (req.method === "GET" && url.pathname === "/agent-jobs") {
      return writeJson(res, 200, getAgentJobs(Object.fromEntries(url.searchParams)));
    }

    if (req.method === "POST" && url.pathname === "/agent-jobs") {
      return await handleAgentJobCreate(req, res);
    }

    if (req.method === "POST" && url.pathname === "/agent-jobs/process-next") {
      return await handleAgentJobProcessNext(req, res);
    }

    if (req.method === "POST" && url.pathname === "/agent-runs") {
      return await handleAgentRun(req, res);
    }

    if (req.method === "POST" && url.pathname === "/reviews") {
      return await handleReview(req, res);
    }

    const conditionalApprovalCompleteMatch = url.pathname.match(/^\/reviews\/([^/]+)\/conditions\/complete$/);
    if (req.method === "POST" && conditionalApprovalCompleteMatch) {
      return await handleConditionalApprovalComplete(req, res, conditionalApprovalCompleteMatch[1]);
    }

    const riskMitigationMatch = url.pathname.match(/^\/risks\/([^/]+)\/mitigation$/);
    if (req.method === "PATCH" && riskMitigationMatch) {
      return await handleRiskMitigationUpdate(req, res, riskMitigationMatch[1]);
    }

    const riskMitigationCompleteMatch = url.pathname.match(/^\/risks\/([^/]+)\/mitigation\/complete$/);
    if (req.method === "POST" && riskMitigationCompleteMatch) {
      return await handleRiskMitigationComplete(req, res, riskMitigationCompleteMatch[1]);
    }

    const riskAcceptMatch = url.pathname.match(/^\/risks\/([^/]+)\/accept$/);
    if (req.method === "POST" && riskAcceptMatch) {
      return await handleRiskUpdate(req, res, riskAcceptMatch[1], "ACCEPTED");
    }

    const riskCloseMatch = url.pathname.match(/^\/risks\/([^/]+)\/close$/);
    if (req.method === "POST" && riskCloseMatch) {
      return await handleRiskUpdate(req, res, riskCloseMatch[1], "CLOSED");
    }

    if (req.method === "POST" && url.pathname === "/risks/demo-current-phase") {
      return await handleCreateDemoRisk(req, res);
    }

    if (req.method === "POST" && url.pathname === "/risks/current-phase") {
      return await handleCreateRisk(req, res);
    }

    const gateCheckMatch = url.pathname.match(/^\/gates\/([^/]+)\/check$/);
    if (req.method === "GET" && gateCheckMatch) {
      const result = checkGate(gateCheckMatch[1]);
      return result ? writeJson(res, 200, result) : writeJson(res, 404, { error: "阶段门不存在" });
    }

    const gateReviewPackMatch = url.pathname.match(/^\/gates\/([^/]+)\/review-pack$/);
    if (req.method === "GET" && gateReviewPackMatch) {
      const result = getGateReviewPack(gateReviewPackMatch[1]);
      return result ? writeJson(res, 200, result) : writeJson(res, 404, { error: "阶段门不存在" });
    }

    const gateReviewPackMarkdownMatch = url.pathname.match(/^\/gates\/([^/]+)\/review-pack\.md$/);
    if (req.method === "GET" && gateReviewPackMarkdownMatch) {
      const result = getGateReviewPack(gateReviewPackMarkdownMatch[1]);
      return result
        ? writeText(res, 200, renderGateReviewPackMarkdown(result), "text/markdown; charset=utf-8")
        : writeJson(res, 404, { error: "阶段门不存在" });
    }

    const gateApprovalPackMarkdownMatch = url.pathname.match(/^\/gates\/([^/]+)\/approval-pack\.md$/);
    if (req.method === "GET" && gateApprovalPackMarkdownMatch) {
      const result = getGateApprovalPack(gateApprovalPackMarkdownMatch[1]);
      return result
        ? writeText(res, 200, renderGateReviewPackMarkdown(result.reviewPack), "text/markdown; charset=utf-8")
        : writeJson(res, 404, { error: "阶段门批准包不存在" });
    }

    const gateApprovalPackMatch = url.pathname.match(/^\/gates\/([^/]+)\/approval-pack$/);
    if (req.method === "GET" && gateApprovalPackMatch) {
      const result = getGateApprovalPack(gateApprovalPackMatch[1]);
      return result ? writeJson(res, 200, result) : writeJson(res, 404, { error: "阶段门批准包不存在" });
    }

    const gateApproveMatch = url.pathname.match(/^\/gates\/([^/]+)\/approve$/);
    if (req.method === "POST" && gateApproveMatch) {
      return await handleGateApproval(req, res, gateApproveMatch[1]);
    }

    if (req.method === "GET") {
      return serveStatic(req, res, url);
    }

    return writeJson(res, 404, { error: "接口不存在" });
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500;
    return writeJson(res, statusCode, {
      error: error?.code === "RUNTIME_PERSISTENCE_FAILED"
        ? "持久化失败，修改已回滚"
        : statusCode >= 400 && statusCode < 500 ? error.message : "服务器错误",
      ...(error?.code ? { code: error.code } : {}),
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});
server.requestTimeout = requestTimeoutMs;

if (import.meta.url === `file://${process.argv[1]}`) {
  function shutdown(signal) {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    console.log(JSON.stringify({ type: "lifecycle", event: "shutdown_started", signal }));

    const forceExit = setTimeout(() => {
      console.error(JSON.stringify({ type: "lifecycle", event: "shutdown_forced", signal }));
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    server.close((error) => {
      clearTimeout(forceExit);
      if (error) {
        console.error(JSON.stringify({ type: "lifecycle", event: "shutdown_failed", signal, error: error.message }));
        process.exit(1);
      }

      console.log(JSON.stringify({ type: "lifecycle", event: "shutdown_complete", signal }));
      process.exit(0);
    });
  }

  server.on("error", (error) => {
    console.error("服务启动失败。请确认当前环境允许监听端口，或通过 PORT 指定其他端口。");
    console.error(error);
    process.exit(1);
  });

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  server.listen(port, host, () => {
    const displayHost = host === "0.0.0.0" ? "localhost" : host;
    console.log(`Hardware Flow API listening on http://${displayHost}:${port}`);
    if (host === "0.0.0.0") {
      console.log("LAN mode enabled. Use this machine's LAN IP from other devices.");
    }
  });
}
