import { type ReactNode, useEffect, useMemo, useState } from "react";

type ViewKey = "overview" | "projects" | "workpackages" | "gate" | "risks" | "actions" | "notifications" | "audit";

type ApiState = {
  project: any | null;
  users: any[];
  actionItems: any | null;
  notifications: any | null;
  gateReviewPack: any | null;
  storageStatus: any | null;
  storageDoctor: any | null;
  readiness: any | null;
  pilotReadiness: any | null;
  pilotLaunch: any | null;
  opsSummary: any | null;
  runtimeConfig: any | null;
  runtimeNetwork: any | null;
  runtimeMetrics: Record<string, number> | null;
};

const statusText: Record<string, string> = {
  APPROVED: "已批准",
  GATE_BLOCKED: "阶段门阻塞",
  GATE_READY: "阶段门可通过",
  NOT_STARTED: "未开始",
  IN_PROGRESS: "进行中",
  HUMAN_APPROVED: "人类已批准",
  AGENT_DRAFT_READY: "草稿待审",
  NEEDS_AGENT_REVISION: "需要修改",
  PENDING: "待处理",
  PENDING_REVIEW: "待审核",
  NEEDS_REVISION: "需要修改",
  REJECTED: "已驳回",
  OPEN: "打开",
  ACCEPTED: "已接受",
  CLOSED: "已关闭",
  ARCHIVED: "已归档",
  PLANNED: "已计划",
  READY: "可通过",
  BLOCKED: "阻塞",
  GO: "可启动",
  GO_WITH_CAUTION: "谨慎启动",
  NO_GO: "暂缓启动",
  PASS: "通过",
  FAIL: "失败",
  WARN: "提醒",
  YES: "是",
  NO: "否",
  READ: "已读",
  UNREAD: "未读",
  OVERDUE: "逾期",
  DUE_SOON: "临期",
  ON_TRACK: "正常",
  UNSCHEDULED: "未排期",
  DONE: "完成",
  LOCKED: "已锁定",
};

const navItems: Array<{ key: ViewKey; label: string }> = [
  { key: "overview", label: "总览" },
  { key: "projects", label: "项目" },
  { key: "workpackages", label: "工作包" },
  { key: "gate", label: "阶段门" },
  { key: "risks", label: "风险" },
  { key: "actions", label: "待办" },
  { key: "notifications", label: "通知" },
  { key: "audit", label: "审计" },
];

const riskSeverityOptions = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

const apiBase = import.meta.env.VITE_API_BASE || "";
const pilotAccessStorageKey = "hardware-flow-pilot-access-code";
let runtimeWritable = true;

type ApiRequestOptions = RequestInit & { allowError?: boolean };

type UiMessage = {
  kind: "success" | "error";
  text: string;
  requestId?: string | null;
  serviceVersion?: string | null;
};

class ApiError extends Error {
  requestId: string | null;
  serviceVersion: string | null;

  constructor(message: string, requestId: string | null, serviceVersion: string | null) {
    super(message);
    this.name = "ApiError";
    this.requestId = requestId;
    this.serviceVersion = serviceVersion;
  }
}

function successMessage(text: string): UiMessage {
  return { kind: "success", text };
}

function errorMessage(error: unknown): UiMessage {
  if (error instanceof ApiError) {
    return {
      kind: "error",
      text: error.message,
      requestId: error.requestId,
      serviceVersion: error.serviceVersion,
    };
  }
  return { kind: "error", text: error instanceof Error ? error.message : String(error) };
}

async function api(path: string, options: ApiRequestOptions = {}) {
  const { allowError = false, ...fetchOptions } = options;
  const method = String(fetchOptions.method || "GET").toUpperCase();
  const mutationRequest = ["POST", "PUT", "PATCH", "DELETE"].includes(method) && path !== "/projects/import/validate";
  if (!runtimeWritable && mutationRequest) {
    throw new ApiError("当前运行时为只读模式", null, null);
  }
  const pilotAccessCode = window.localStorage.getItem(pilotAccessStorageKey) || "";
  const response = await fetch(`${apiBase}${path}`, {
    ...fetchOptions,
    headers: {
      "content-type": "application/json",
      ...(pilotAccessCode ? { "x-pilot-access-code": pilotAccessCode } : {}),
      ...(fetchOptions.headers || {}),
    },
  });
  const body = await response.json();
  if (!response.ok && !allowError) {
    throw new ApiError(
      body.error || JSON.stringify(body),
      response.headers.get("x-request-id"),
      response.headers.get("x-service-version"),
    );
  }
  return body;
}

async function apiText(path: string) {
  const pilotAccessCode = window.localStorage.getItem(pilotAccessStorageKey) || "";
  const response = await fetch(`${apiBase}${path}`, {
    headers: {
      ...(pilotAccessCode ? { "x-pilot-access-code": pilotAccessCode } : {}),
    },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new ApiError(
      body || `请求失败：${response.status}`,
      response.headers.get("x-request-id"),
      response.headers.get("x-service-version"),
    );
  }
  return body;
}

function parsePrometheusMetrics(text: string) {
  const metrics: Record<string, number> = {};
  text.split("\n").forEach((line) => {
    if (!line || line.startsWith("#")) return;
    const match = line.match(/^([a-zA-Z_:][\w:]*)(?:\{[^}]*\})?\s+(-?\d+(?:\.\d+)?)/);
    if (!match) return;
    metrics[match[1]] = Number(match[2]);
  });
  return metrics;
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatSeconds(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0s";
  if (value < 60) return `${value.toFixed(1)}s`;
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}m ${seconds}s`;
}

function badge(status?: string) {
  const value = status || "-";
  return <span className={`badge ${value}`}>{statusText[value] || value}</span>;
}

function formatUser(users: any[], userId?: string) {
  const user = users.find((item) => item.userId === userId);
  return user ? `${user.name}` : userId || "-";
}

function promptComment(message: string, fallback: string) {
  const comment = window.prompt(message, fallback);
  return comment === null ? null : comment.trim() || fallback;
}

async function openApiPath(path: string) {
  const targetWindow = window.open("", "_blank");
  if (targetWindow) {
    targetWindow.opener = null;
  }
  const pilotAccessCode = window.localStorage.getItem(pilotAccessStorageKey) || "";
  try {
    const response = await fetch(`${apiBase}${path}`, {
      headers: {
        ...(pilotAccessCode ? { "x-pilot-access-code": pilotAccessCode } : {}),
      },
    });
    const body = await response.blob();
    if (!response.ok) {
      const message = await body.text();
      if (targetWindow) {
        targetWindow.document.body.innerText = message || `请求失败：${response.status}`;
      } else {
        window.alert(message || `请求失败：${response.status}`);
      }
      return;
    }
    const contentType = response.headers.get("content-type") || body.type || "text/plain; charset=utf-8";
    const objectUrl = URL.createObjectURL(new Blob([body], { type: contentType }));
    if (targetWindow) {
      targetWindow.location.href = objectUrl;
    } else {
      window.open(objectUrl, "_blank", "noopener,noreferrer");
    }
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (targetWindow) {
      targetWindow.document.body.innerText = message;
    } else {
      window.alert(message);
    }
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
    reader.onerror = () => reject(reader.error || new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}

function fallbackCopyText(text: string) {
  if (/^https?:\/\//i.test(text)) {
    window.open(text, "_blank", "noopener,noreferrer");
    return;
  }
  window.prompt("复制以下内容", text);
}

async function copyText(text: string) {
  if (!navigator.clipboard?.writeText) {
    fallbackCopyText(text);
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    fallbackCopyText(text);
  }
}

export function App() {
  const [state, setState] = useState<ApiState>({
    project: null,
    users: [],
    actionItems: null,
    notifications: null,
    gateReviewPack: null,
    storageStatus: null,
    storageDoctor: null,
    readiness: null,
    pilotReadiness: null,
    pilotLaunch: null,
    opsSummary: null,
    runtimeConfig: null,
    runtimeNetwork: null,
    runtimeMetrics: null,
  });
  const [view, setView] = useState<ViewKey>("overview");
  const [actorUserId, setActorUserId] = useState("user-project-manager");
  const [selectedWorkPackageId, setSelectedWorkPackageId] = useState<string | null>(null);
  const [notificationFilter, setNotificationFilter] = useState("ALL");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<UiMessage | null>(null);
  const [pilotAccessCode, setPilotAccessCode] = useState(() => window.localStorage.getItem(pilotAccessStorageKey) || "");
  const [pilotAccessEnabled, setPilotAccessEnabled] = useState(false);

  const activePhase = useMemo(
    () => state.project?.phases.find((phase: any) => phase.id === state.project.project.currentPhaseId),
    [state.project],
  );
  const activeGate = useMemo(
    () => state.project?.gates.find((gate: any) => gate.phaseId === activePhase?.id),
    [activePhase, state.project],
  );
  const phaseWorkPackages = useMemo(
    () => state.project?.workPackages.filter((item: any) => item.phaseId === activePhase?.id) || [],
    [activePhase, state.project],
  );
  const selectedWorkPackage = useMemo(
    () => state.project?.workPackages.find((item: any) => item.id === selectedWorkPackageId) || phaseWorkPackages[0],
    [phaseWorkPackages, selectedWorkPackageId, state.project],
  );

  async function load(nextActorUserId = actorUserId) {
    const publicRuntimeConfig = await api("/runtime/config");
    runtimeWritable = publicRuntimeConfig.runtimeWrite?.writable !== false;
    setPilotAccessEnabled(Boolean(publicRuntimeConfig.pilotAccessEnabled));
    if (publicRuntimeConfig.pilotAccessEnabled && !window.localStorage.getItem(pilotAccessStorageKey)) {
      setState((current) => ({ ...current, runtimeConfig: publicRuntimeConfig }));
      throw new ApiError("请输入试点访问码后继续", null, publicRuntimeConfig.version || null);
    }
    const [project, users, storageStatus, storageDoctor, readiness, pilotReadiness, pilotLaunch, opsSummary, runtimeConfig, runtimeNetwork, metricsText] = await Promise.all([
      api("/projects/demo"),
      api("/users/demo"),
      api("/storage/status"),
      api("/storage/doctor"),
      api("/ready", { allowError: true }),
      api("/pilot/readiness"),
      api("/pilot/launch"),
      api("/ops/summary"),
      api("/runtime/config"),
      api("/runtime/network"),
      apiText("/metrics"),
    ]);
    runtimeWritable = runtimeConfig.runtimeWrite?.writable !== false;
    const phase = project.phases.find((item: any) => item.id === project.project.currentPhaseId);
    const gate = project.gates.find((item: any) => item.phaseId === phase?.id);
    const [actionItems, notifications, gateReviewPack] = await Promise.all([
      api(`/users/${nextActorUserId}/action-items`),
      api(`/users/${nextActorUserId}/notifications${notificationQuery(notificationFilter)}`),
      gate ? api(`/gates/${gate.id}/review-pack`) : Promise.resolve(null),
    ]);

    setState({
      project,
      users: users.users,
      actionItems,
      notifications,
      gateReviewPack,
      storageStatus,
      storageDoctor,
      readiness,
      pilotReadiness,
      pilotLaunch,
      opsSummary,
      runtimeConfig,
      runtimeNetwork,
      runtimeMetrics: parsePrometheusMetrics(metricsText),
    });
    setSelectedWorkPackageId((current) => {
      const activeWorkPackages = project.workPackages.filter((item: any) => item.phaseId === phase?.id);
      const currentIsActive = activeWorkPackages.some((item: any) => item.id === current);
      return currentIsActive ? current : activeWorkPackages[0]?.id || null;
    });
  }

  async function runAction(label: string, action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await action();
      await load();
      setMessage(successMessage(label));
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function reloadNotifications(filter = notificationFilter, userId = actorUserId) {
    const notifications = await api(`/users/${userId}/notifications${notificationQuery(filter)}`);
    setState((current) => ({ ...current, notifications }));
  }

  useEffect(() => {
    load().catch((error) => setMessage(errorMessage(error)));
  }, []);

  useEffect(() => {
    load(actorUserId).catch((error) => setMessage(errorMessage(error)));
  }, [actorUserId]);

  useEffect(() => {
    reloadNotifications().catch((error) => setMessage(errorMessage(error)));
  }, [notificationFilter]);

  function savePilotAccessCode() {
    const code = pilotAccessCode.trim();
    if (!code) {
      window.localStorage.removeItem(pilotAccessStorageKey);
    } else {
      window.localStorage.setItem(pilotAccessStorageKey, code);
    }
    setMessage(null);
    load().catch((error) => setMessage(errorMessage(error)));
  }

  if (pilotAccessEnabled && (!window.localStorage.getItem(pilotAccessStorageKey) || message?.text.includes("访问码"))) {
    return (
      <main className="loading access-screen">
        <section className="access-panel">
          <h1>试点访问码</h1>
          <p>当前服务已启用内部试点访问保护。</p>
          <input
            autoFocus
            placeholder="输入访问码"
            type="password"
            value={pilotAccessCode}
            onChange={(event) => setPilotAccessCode(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") savePilotAccessCode();
            }}
          />
          <button onClick={savePilotAccessCode}>进入工作台</button>
          {message ? <p className="muted">{message.text}</p> : null}
        </section>
      </main>
    );
  }

  if (!state.project) {
    return <main className="loading">正在加载硬件流程工作台...</main>;
  }

  const highOpenRisks = state.project.risks.filter(
    (risk: any) => risk.status === "OPEN" && (risk.severity === "HIGH" || risk.severity === "CRITICAL"),
  );

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <strong>Hardware Flow</strong>
          <span>Human + Agent</span>
        </div>
        <nav>
          {navItems.map((item) => (
            <button className={view === item.key ? "active" : ""} key={item.key} onClick={() => setView(item.key)}>
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{state.project.project.name}</p>
            <h1>{activePhase?.name || "-"} · {activeGate?.name || "无阶段门"}</h1>
          </div>
          <div className="top-actions">
            {pilotAccessEnabled ? (
              <button className="ghost" onClick={() => {
                window.localStorage.removeItem(pilotAccessStorageKey);
                setPilotAccessCode("");
                setMessage(successMessage("访问码已清除"));
              }}>清除访问码</button>
            ) : null}
            <select value={actorUserId} onChange={(event) => setActorUserId(event.target.value)}>
              {state.users.map((user) => (
                <option key={user.userId} value={user.userId}>
                  {user.name} · {user.roles.join("/")}
                </option>
              ))}
            </select>
            <button onClick={() => load()} disabled={busy}>刷新</button>
          </div>
        </header>

        {!state.runtimeConfig?.runtimeWrite?.writable ? (
          <div className="runtime-read-only" role="status">
            <strong>只读运行模式</strong>
            <span>
              当前运行时已关闭业务修改操作。启动数据源：{runtimeConfig.runtimeStoreSource?.loadedSource || "未知"}；写入后端：
              {runtimeConfig.runtimeStoreSource?.writeBackend || "未知"}。
            </span>
          </div>
        ) : null}

        {message ? (
          <div className={message.kind === "error" ? "message error" : "message"} role={message.kind === "error" ? "alert" : "status"}>
            <strong>{message.kind === "error" ? "操作失败" : "操作完成"}</strong>
            <span>{message.text}</span>
            {message.requestId || message.serviceVersion ? (
              <small className="message-detail">
                {message.requestId ? `请求ID ${message.requestId}` : ""}
                {message.requestId && message.serviceVersion ? " · " : ""}
                {message.serviceVersion ? `版本 ${message.serviceVersion}` : ""}
              </small>
            ) : null}
          </div>
        ) : null}

        {view === "overview" ? (
          <Overview
            actionItems={state.actionItems}
            activeGate={activeGate}
            highOpenRisks={highOpenRisks}
            notifications={state.notifications}
            phaseWorkPackages={phaseWorkPackages}
            project={state.project}
            setView={setView}
          />
        ) : null}

        {view === "projects" ? (
          <Projects
            actorUserId={actorUserId}
            busy={busy}
            project={state.project}
            setSelectedWorkPackageId={setSelectedWorkPackageId}
            storageDoctor={state.storageDoctor}
            readiness={state.readiness}
            pilotReadiness={state.pilotReadiness}
            pilotLaunch={state.pilotLaunch}
            opsSummary={state.opsSummary}
            runtimeConfig={state.runtimeConfig}
            runtimeNetwork={state.runtimeNetwork}
            runtimeMetrics={state.runtimeMetrics}
            storageStatus={state.storageStatus}
            runAction={runAction}
            users={state.users}
          />
        ) : null}

        {view === "workpackages" ? (
          <WorkPackages
            actorUserId={actorUserId}
            busy={busy}
            project={state.project}
            selectedWorkPackage={selectedWorkPackage}
            phaseWorkPackages={phaseWorkPackages}
            setSelectedWorkPackageId={setSelectedWorkPackageId}
            runAction={runAction}
          />
        ) : null}

        {view === "gate" ? (
          <Gate
            actorUserId={actorUserId}
            activeGate={activeGate}
            busy={busy}
            gateReviewPack={state.gateReviewPack}
            latestGateCheck={state.project.latestGateCheck}
            runAction={runAction}
          />
        ) : null}

        {view === "risks" ? (
          <Risks
            actorUserId={actorUserId}
            busy={busy}
            project={state.project}
            users={state.users}
            runAction={runAction}
          />
        ) : null}

        {view === "actions" ? (
          <ActionItems
            actionItems={state.actionItems}
            actorUserId={actorUserId}
            busy={busy}
            runAction={runAction}
            setSelectedWorkPackageId={setSelectedWorkPackageId}
            setView={setView}
          />
        ) : null}

        {view === "notifications" ? (
          <Notifications
            actorUserId={actorUserId}
            busy={busy}
            filter={notificationFilter}
            notifications={state.notifications}
            runAction={runAction}
            setFilter={setNotificationFilter}
            setSelectedWorkPackageId={setSelectedWorkPackageId}
            setView={setView}
          />
        ) : null}

        {view === "audit" ? (
          <AuditTrail auditEvents={state.project.auditEvents || []} />
        ) : null}
      </section>
    </main>
  );
}

function notificationQuery(filter: string) {
  const params: Record<string, string> = {
    UNREAD: "?status=UNREAD",
    ACTION: "?type=ACTION",
    WARNING: "?type=WARNING",
    INFO: "?type=INFO",
  };
  return params[filter] || "";
}

function Overview({ actionItems, activeGate, highOpenRisks, notifications, phaseWorkPackages, project, setView }: any) {
  const conditionalSummary = project.conditionalApprovalSummary || {};
  const mitigationSummary = project.riskMitigationSummary || {};
  const scheduleSummary = project.scheduleSummary || {};

  return (
    <>
      <section className="phase-strip">
        {project.phases.map((phase: any) => (
          <article className="phase-card" key={phase.id}>
            {badge(phase.status)}
            <strong>{phase.name}</strong>
          </article>
        ))}
      </section>
      <section className="metric-grid">
        <Metric label="阶段门" value={activeGate?.status || "-"} />
        <Metric label="阻塞项" value={project.latestGateCheck.blockers.length} />
        <Metric label="当前阶段工作包" value={phaseWorkPackages.length} />
        <Metric label="打开高风险" value={highOpenRisks.length} />
        <Metric label="我的待办" value={actionItems?.total || 0} />
        <Metric label="未读通知" value={notifications?.unreadCount || 0} />
        <Metric label="风险缓解" value={`${mitigationSummary.completedMitigationCount || 0}/${mitigationSummary.mitigationPlanCount || 0}`} />
        <Metric label="逾期/临期" value={`${scheduleSummary.overdueWorkPackageCount || 0}/${scheduleSummary.dueSoonWorkPackageCount || 0}`} />
        <Metric label="批准包归档" value={project.gateApprovalPacks?.length || 0} />
        <Metric label="条件条款" value={`${conditionalSummary.completedConditionalApprovalCount || 0}/${conditionalSummary.conditionalApprovalCount || 0}`} />
      </section>
      <section className="content-grid">
        <article className="panel">
          <h2>阶段门阻塞项</h2>
          {project.latestGateCheck.blockers.length ? (
            <ul className="plain-list">
              {project.latestGateCheck.blockers.map((item: any, index: number) => (
                <li key={`${item.code}-${index}`}>
                  <strong>{item.code || item.type}</strong>
                  <span>{item.message || item.riskId || item.relatedObjectId}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">当前阶段门没有阻塞项。</p>
          )}
        </article>
        <article className="panel">
          <h2>我的待办</h2>
          <ul className="plain-list">
            {[...(actionItems?.pendingReviews || []), ...(actionItems?.riskMitigations || []), ...(actionItems?.gateApprovals || [])]
              .slice(0, 8)
              .map((item: any, index: number) => (
                <li key={`${item.workPackageId || item.riskId || item.gateId}-${index}`}>
                  <strong>{item.title}</strong>
                  <span>{item.scheduleStatus || item.requiredArtifactType || item.gateStatus || "待处理"}</span>
                </li>
              ))}
          </ul>
        </article>
        <article className="panel">
          <h2>快速进入</h2>
          <div className="button-grid">
            <button onClick={() => setView("workpackages")}>处理工作包</button>
            <button onClick={() => setView("gate")}>查看阶段门</button>
            <button onClick={() => setView("risks")}>处理风险</button>
            <button onClick={() => setView("actions")}>查看待办</button>
          </div>
        </article>
      </section>
    </>
  );
}

function Projects({
  actorUserId,
  busy,
  opsSummary,
  pilotLaunch,
  pilotReadiness,
  project,
  readiness,
  runAction,
  runtimeConfig,
  runtimeMetrics,
  setSelectedWorkPackageId,
  storageDoctor,
  storageStatus,
  users,
}: any) {
  const [name, setName] = useState("");
  const [productLine, setProductLine] = useState("");
  const [importRaw, setImportRaw] = useState("");
  const [importValidation, setImportValidation] = useState<any | null>(null);
  const [importBusy, setImportBusy] = useState(false);

  function parseImportSnapshot() {
    if (!importRaw.trim()) {
      setImportValidation({ valid: false, canImport: false, errors: [{ message: "请先粘贴项目快照 JSON。" }], warnings: [] });
      return null;
    }
    try {
      return JSON.parse(importRaw);
    } catch (error) {
      setImportValidation({
        valid: false,
        canImport: false,
        errors: [{ message: `JSON 格式错误：${error instanceof Error ? error.message : String(error)}` }],
        warnings: [],
      });
      return null;
    }
  }

  async function validateImportSnapshot() {
    const snapshot = parseImportSnapshot();
    if (!snapshot) return;
    setImportBusy(true);
    try {
      const result = await api("/projects/import/validate", {
        method: "POST",
        allowError: true,
        body: JSON.stringify(snapshot),
      });
      setImportValidation(result);
    } catch (error) {
      setImportValidation({
        valid: false,
        canImport: false,
        errors: [{ message: error instanceof Error ? error.message : String(error) }],
        warnings: [],
      });
    } finally {
      setImportBusy(false);
    }
  }

  return (
    <section className="content-grid projects-grid">
      <article className="panel">
        <h2>创建项目</h2>
        <label>项目名称<input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>产品线<input value={productLine} onChange={(event) => setProductLine(event.target.value)} /></label>
        <button disabled={busy || !name.trim()} onClick={() => runAction("项目已创建", () => api("/projects", {
          method: "POST",
          body: JSON.stringify({ name, productLine }),
        }))}>创建</button>
      </article>
      <article className="panel span-2">
        <h2>项目列表</h2>
        <table>
          <thead><tr><th>项目</th><th>阶段</th><th>阶段门</th><th>风险</th><th>待闭环</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            {project.projectSummaries.map((item: any) => (
              <tr key={item.id}>
                <td>
                  <strong>{item.name}</strong>
                  {item.id === project.activeProjectId ? <span className="inline-badge">当前</span> : null}
                </td>
                <td>{item.currentPhaseName || item.currentPhaseId}</td>
                <td>
                  <div className="table-stack">
                    <span>{item.currentGateName || "-"}</span>
                    {item.currentGateStatus ? badge(item.currentGateStatus) : null}
                  </div>
                </td>
                <td>{item.openHighRiskCount || 0}</td>
                <td>
                  <div className="table-stack muted">
                    <span>逾期 {item.overdueWorkPackageCount || 0}</span>
                    <span>条款 {item.openConditionalApprovalCount || 0}</span>
                    <span>缓解 {item.openMitigationCount || 0}</span>
                  </div>
                </td>
                <td>{badge(item.status)}</td>
                <td>
                  <div className="actions">
                    <button
                      disabled={busy || item.id === project.activeProjectId}
                      onClick={() => runAction("项目已切换", async () => {
                        await api(`/projects/${item.id}/select`, { method: "POST", body: "{}" });
                        setSelectedWorkPackageId(null);
                      })}
                    >
                      切换
                    </button>
                    <button className="ghost" onClick={() => openApiPath(`/projects/${item.id}/snapshot.md`)}>导出 Markdown</button>
                    <button className="ghost" onClick={() => openApiPath(`/projects/${item.id}/snapshot`)}>导出 JSON</button>
                    <button
                      className="ghost"
                      disabled={busy}
                      onClick={() => {
                        const cloneName = window.prompt("输入项目副本名称", `${item.name} 副本`);
                        if (!cloneName) return;
                        runAction("项目副本已创建", async () => {
                          await api(`/projects/${item.id}/clone`, {
                            method: "POST",
                            body: JSON.stringify({ name: cloneName, userId: actorUserId }),
                          });
                          setSelectedWorkPackageId(null);
                        });
                      }}
                    >
                      复制
                    </button>
                    {item.status === "ARCHIVED" ? (
                      <button
                        className="ghost"
                        disabled={busy}
                        onClick={() => runAction("项目已恢复", async () => {
                          await api(`/projects/${item.id}/restore`, {
                            method: "POST",
                            body: JSON.stringify({ userId: actorUserId }),
                          });
                          setSelectedWorkPackageId(null);
                        })}
                      >
                        恢复
                      </button>
                    ) : (
                      <button
                        className="ghost"
                        disabled={busy}
                        onClick={() => {
                          if (!window.confirm(`归档项目「${item.name}」？项目数据会保留，可稍后恢复。`)) return;
                          runAction("项目已归档", async () => {
                            await api(`/projects/${item.id}/archive`, {
                              method: "POST",
                              body: JSON.stringify({ userId: actorUserId }),
                            });
                            setSelectedWorkPackageId(null);
                          });
                        }}
                      >
                        归档
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>
      <article className="panel span-3">
        <h2>当前项目角色配对</h2>
        <table>
          <thead><tr><th>人类角色</th><th>Agent</th><th>负责人</th><th>操作</th></tr></thead>
          <tbody>
            {project.rolePairs.map((pair: any) => (
              <RolePairRow
                actorUserId={actorUserId}
                busy={busy}
                key={pair.id}
                pair={pair}
                runAction={runAction}
                users={users}
              />
            ))}
          </tbody>
        </table>
      </article>
      <article className="panel span-3">
        <h2>试点就绪总览</h2>
        <PilotReadiness opsSummary={opsSummary} pilotLaunch={pilotLaunch} pilotReadiness={pilotReadiness} />
      </article>
      <article className="panel span-3">
        <h2>本地数据状态</h2>
        <StorageStatus
          busy={busy}
          runAction={runAction}
          readiness={readiness}
          runtimeConfig={runtimeConfig}
          runtimeMetrics={runtimeMetrics}
          setSelectedWorkPackageId={setSelectedWorkPackageId}
          storageDoctor={storageDoctor}
          storageStatus={storageStatus}
        />
      </article>
      <article className="panel span-3">
        <h2>项目快照导入</h2>
        <label>
          项目快照 JSON
          <textarea
            placeholder="粘贴 /projects/:id/snapshot 导出的 JSON"
            rows={9}
            value={importRaw}
            onChange={(event) => {
              setImportRaw(event.target.value);
              setImportValidation(null);
            }}
          />
        </label>
        <div className="actions import-actions">
          <button disabled={busy || importBusy} onClick={validateImportSnapshot}>校验快照</button>
          <button
            className="ghost"
            disabled={busy || importBusy || !importValidation?.canImport}
            onClick={() => {
              const snapshot = parseImportSnapshot();
              if (!snapshot) return;
              runAction("项目快照已导入", async () => {
                await api("/projects/import", {
                  method: "POST",
                  body: JSON.stringify({ ...snapshot, actorUserId }),
                });
                setImportRaw("");
                setImportValidation(null);
                setSelectedWorkPackageId(null);
              });
            }}
          >
            导入项目
          </button>
        </div>
        {importValidation ? <ImportValidationResult result={importValidation} /> : null}
      </article>
    </section>
  );
}

function PilotReadiness({ opsSummary, pilotLaunch, pilotReadiness }: any) {
  if (!pilotReadiness) {
    return <p className="muted">试点就绪状态加载中。</p>;
  }

  const checks = [
    ["服务与数据", pilotReadiness.ready ? "READY" : "BLOCKED"],
    ["本地 store", pilotReadiness.storage?.valid ? "READY" : "BLOCKED"],
    ["当前阶段门", pilotReadiness.gate?.readiness || "-"],
    ["证据齐备", `${pilotReadiness.gate?.readyEvidenceCount || 0}/${pilotReadiness.gate?.requiredEvidenceCount || 0}`],
    ["阻塞项", pilotReadiness.gate?.blockerCount || 0],
    ["打开高风险", pilotReadiness.summary?.openHighRiskCount || 0],
    ["审计事件", pilotReadiness.summary?.auditEventCount || 0],
    ["通知", pilotReadiness.summary?.notificationCount || 0],
  ];

  return (
    <>
      <div className="runtime-grid pilot-grid">
        {checks.map(([label, value]) => (
          <Metric key={String(label)} label={label} value={String(value).match(/^[A-Z_]+$/) ? badge(String(value)) : value} />
        ))}
      </div>
      <PilotLaunchSummary pilotLaunch={pilotLaunch} />
      <PilotBrief pilotReadiness={pilotReadiness} />
      <section className="split">
        <div className="subpanel">
          <h3>阻塞</h3>
          <ul className="compact-list">
            {pilotReadiness.blockers?.length ? pilotReadiness.blockers.map((item: any) => (
              <li key={item.code}><strong>{item.code}</strong><span>{item.message}</span></li>
            )) : <li><strong>READY</strong><span>服务和本地数据满足试点启动条件。</span></li>}
          </ul>
        </div>
        <div className="subpanel">
          <h3>提醒</h3>
          <ul className="compact-list">
            {pilotReadiness.warnings?.length ? pilotReadiness.warnings.map((item: any) => (
              <li key={item.code}><strong>{item.code}</strong><span>{item.message}</span></li>
            )) : <li><strong>READY</strong><span>没有额外提醒。</span></li>}
          </ul>
        </div>
      </section>
      <div className="actions">
        <button className="ghost" onClick={() => openApiPath("/pilot/readiness")}>打开就绪 JSON</button>
        <button className="ghost" onClick={() => openApiPath("/pilot/checklist")}>打开演练清单</button>
        {pilotReadiness.links?.opsSummary ? <button className="ghost" onClick={() => openApiPath(pilotReadiness.links.opsSummary)}>运维摘要</button> : null}
        {pilotReadiness.links?.metrics ? <button className="ghost" onClick={() => openApiPath(pilotReadiness.links.metrics)}>Metrics</button> : null}
        {pilotReadiness.links?.storageStatus ? <button className="ghost" onClick={() => openApiPath(pilotReadiness.links.storageStatus)}>Store 状态</button> : null}
        {pilotReadiness.links?.storageDoctor ? <button className="ghost" onClick={() => openApiPath(pilotReadiness.links.storageDoctor)}>Store Doctor</button> : null}
        {pilotReadiness.links?.projectSnapshot ? <button className="ghost" onClick={() => openApiPath(pilotReadiness.links.projectSnapshot)}>项目快照</button> : null}
        {pilotReadiness.links?.riskRegister ? <button className="ghost" onClick={() => openApiPath(pilotReadiness.links.riskRegister)}>风险台账</button> : null}
        {pilotReadiness.links?.gateReviewPack ? <button className="ghost" onClick={() => openApiPath(pilotReadiness.links.gateReviewPack)}>阶段门审核包</button> : null}
      </div>
      {pilotReadiness.checklist ? (
        <section className="subpanel">
          <h3>试点演练清单</h3>
          <div className="runtime-grid pilot-grid">
            <Metric label="总项" value={pilotReadiness.checklist.summary?.total || 0} />
            <Metric label="已完成" value={pilotReadiness.checklist.summary?.done || 0} />
            <Metric label="必需完成" value={`${pilotReadiness.checklist.summary?.requiredDone || 0}/${pilotReadiness.checklist.summary?.requiredTotal || 0}`} />
            <Metric label="待处理" value={pilotReadiness.checklist.summary?.pending || 0} />
          </div>
          <table className="compact-table">
            <thead><tr><th>状态</th><th>事项</th><th>进度</th><th>下一步</th></tr></thead>
            <tbody>
              {pilotReadiness.checklist.items?.map((item: any) => (
                <tr key={item.key}>
                  <td>{badge(item.status)}<br /><span className="muted">{item.severity}</span></td>
                  <td><strong>{item.title}</strong><br /><span className="muted">{item.detail}</span></td>
                  <td>{item.total ? `${item.done || 0}/${item.total}` : item.done || 0}</td>
                  <td><ChecklistAction action={item.action} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
      <PilotRunbook steps={pilotReadiness.runbookSteps} />
      <PilotAcceptance acceptanceCriteria={pilotReadiness.acceptanceCriteria} boundaries={pilotReadiness.boundaries} />
      <PilotRollbackCard rollbackCard={pilotReadiness.rollbackCard} links={pilotReadiness.links} />
      <PilotIssueReport issueReport={pilotReadiness.issueReport} links={pilotReadiness.links} />
      <PilotOpsSummary opsSummary={opsSummary} />
      <table className="storage-table">
        <tbody>
          <CommandRow command={pilotReadiness.commands?.check} label="检查命令" />
          <CommandRow command={pilotReadiness.commands?.rehearse} label="演练命令" />
          <CommandRow command={pilotReadiness.commands?.archive} label="归档命令" />
          <CommandRow command={pilotReadiness.commands?.startLan} label="局域网启动" />
        </tbody>
      </table>
    </>
  );
}

function PilotLaunchSummary({ pilotLaunch }: any) {
  if (!pilotLaunch) {
    return null;
  }

  const criteria = pilotLaunch.criteria || [];
  const requiredPending = pilotLaunch.requiredPending || [];

  return (
    <section className="subpanel pilot-launch">
      <div className="panel-heading">
        <div>
          <h3>启动判定</h3>
          <p className="muted">试点主持人可先看这里决定是否开跑，再展开下方清单处理细节。</p>
        </div>
        {badge(pilotLaunch.decision || "PENDING")}
      </div>
      <div className="runtime-grid pilot-grid">
        <Metric label="可启动" value={pilotLaunch.canStart ? "YES" : "NO"} />
        <Metric label="必需待处理" value={pilotLaunch.summary?.requiredPending || 0} />
        <Metric label="硬阻塞" value={pilotLaunch.summary?.blockers || 0} />
        <Metric label="提醒" value={pilotLaunch.summary?.warnings || 0} />
      </div>
      <table className="compact-table">
        <thead><tr><th>状态</th><th>判定项</th><th>说明</th></tr></thead>
        <tbody>
          {criteria.map((item: any) => (
            <tr key={item.key}>
              <td>{badge(item.status)}</td>
              <td><strong>{item.label}</strong></td>
              <td>{item.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {requiredPending.length ? (
        <ul className="compact-list">
          {requiredPending.map((item: any) => (
            <li key={item.key}><strong>{item.title}</strong><span>{item.action}</span></li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function PilotBrief({ pilotReadiness }: any) {
  const [copied, setCopied] = useState(false);
  const links = Object.entries(pilotReadiness.links || {})
    .filter(([, value]) => Boolean(value))
    .map(([label, value]) => `- ${label}: ${value}`);
  const commands = Object.entries(pilotReadiness.commands || {})
    .filter(([, value]) => Boolean(value))
    .map(([label, value]) => `- ${label}: ${value}`);
  const blockers = (pilotReadiness.blockers || []).map((item: any) => `- ${item.code}: ${item.message}`);
  const warnings = (pilotReadiness.warnings || []).map((item: any) => `- ${item.code}: ${item.message}`);
  const checklist = pilotReadiness.checklist?.summary || {};
  const brief = [
    "# 内部试点现场简报",
    "",
    `项目: ${pilotReadiness.project?.name || "-"} (${pilotReadiness.project?.id || "-"})`,
    `当前阶段: ${pilotReadiness.project?.currentPhaseName || pilotReadiness.project?.currentPhaseId || "-"}`,
    `阶段门: ${pilotReadiness.gate?.name || "-"} / ${pilotReadiness.gate?.readiness || "-"}`,
    `试点状态: ${pilotReadiness.ready ? "READY" : "BLOCKED"}`,
    `必需项: ${checklist.requiredDone || 0}/${checklist.requiredTotal || 0}`,
    `待处理: ${checklist.pending || 0}`,
    "",
    "## 阻塞",
    ...(blockers.length ? blockers : ["- 无"]),
    "",
    "## 提醒",
    ...(warnings.length ? warnings : ["- 无"]),
    "",
    "## 命令",
    ...commands,
    "",
    "## 链接",
    ...links,
  ].join("\n");

  async function onCopy() {
    await copyText(brief);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <section className="subpanel pilot-brief">
      <div className="panel-heading">
        <div>
          <h3>现场简报</h3>
          <p className="muted">复制当前试点状态、阻塞提醒、命令和诊断链接，便于同步到会议纪要或群消息。</p>
        </div>
        <button className="ghost" onClick={onCopy}>{copied ? "已复制" : "复制简报"}</button>
      </div>
    </section>
  );
}

function PilotRunbook({ steps }: { steps?: string[] }) {
  const [copied, setCopied] = useState(false);

  if (!steps?.length) {
    return null;
  }

  async function onCopy() {
    await copyText(steps.map((item, index) => `${index + 1}. ${item}`).join("\n"));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <section className="subpanel">
      <div className="panel-heading">
        <div>
          <h3>建议试点流程</h3>
          <p className="muted">主持人可按顺序走完第一轮内部试点，也可复制到会议纪要或群消息。</p>
        </div>
        <button className="ghost" onClick={onCopy}>{copied ? "已复制" : "复制流程"}</button>
      </div>
      <ol className="runbook-list">
        {steps.map((item, index) => (
          <li key={item}>
            <strong>{String(index + 1).padStart(2, "0")}</strong>
            <span>{item}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function PilotAcceptance({ acceptanceCriteria, boundaries }: any) {
  if (!acceptanceCriteria?.length && !boundaries?.length) {
    return null;
  }

  return (
    <section className="split pilot-acceptance">
      <div className="subpanel">
        <h3>第一轮验收标准</h3>
        <ul className="compact-list">
          {(acceptanceCriteria || []).map((item: string) => (
            <li key={item}><strong>ACCEPT</strong><span>{item}</span></li>
          ))}
        </ul>
      </div>
      <div className="subpanel">
        <h3>第一轮边界</h3>
        <ul className="compact-list">
          {(boundaries || []).map((item: string) => (
            <li key={item}><strong>OUT</strong><span>{item}</span></li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function PilotRollbackCard({ rollbackCard, links }: any) {
  const [copied, setCopied] = useState(false);

  if (!rollbackCard) {
    return null;
  }

  const template = [
    "# 内部试点回滚卡片",
    "",
    rollbackCard.severityGuide || "",
    "",
    "## 执行步骤",
    ...(rollbackCard.steps || []).map((item: string, index: number) => `${index + 1}. ${item}`),
    "",
    "## 必留证据",
    ...(rollbackCard.requiredEvidence || []).map((item: string) => `- ${item}`),
    "",
    "## 诊断端点",
    ...[links?.storageDoctor, links?.opsSummary, links?.launch, links?.ready].filter(Boolean).map((endpoint: string) => `- ${endpoint}`),
  ].join("\n");

  async function onCopy() {
    await copyText(template);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <section className="subpanel">
      <div className="panel-heading">
        <div>
          <h3>回滚卡片</h3>
          <p className="muted">{rollbackCard.severityGuide}</p>
        </div>
        <button className="ghost" onClick={onCopy}>{copied ? "已复制" : "复制卡片"}</button>
      </div>
      <ol className="runbook-list">
        {(rollbackCard.steps || []).map((item: string, index: number) => (
          <li key={item}>
            <strong>{String(index + 1).padStart(2, "0")}</strong>
            <span>{item}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function PilotIssueReport({ issueReport, links }: any) {
  const [copied, setCopied] = useState(false);

  if (!issueReport) {
    return null;
  }

  const diagnostics = [
    links?.readiness,
    links?.checklist,
    links?.opsSummary,
    links?.metrics,
    links?.storageStatus,
    links?.storageDoctor,
  ].filter(Boolean);
  const template = [
    "# 内部试点问题上报",
    "",
    ...(issueReport.requiredFields || []).map((field: string) => `- ${field}: `),
    "",
    "## 严重度",
    issueReport.severityGuide || "",
    "",
    "## 诊断端点",
    ...diagnostics.map((endpoint: string) => `- ${endpoint}`),
    "",
    "## 处理记录",
    "- 临时处置: ",
    "- 负责人: ",
    "- 下一步: ",
  ].join("\n");

  async function onCopy() {
    await copyText(template);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <section className="subpanel">
      <div className="panel-heading">
        <div>
          <h3>现场问题上报</h3>
          <p className="muted">{issueReport.severityGuide}</p>
        </div>
        <button className="ghost" onClick={onCopy}>{copied ? "已复制" : "复制模板"}</button>
      </div>
      <div className="issue-report-grid">
        {(issueReport.requiredFields || []).map((field: string) => (
          <span key={field}>{field}</span>
        ))}
      </div>
      <p className="muted">页面报错时优先保留请求 ID、服务版本和发生时间；必要时同步打开诊断端点。</p>
    </section>
  );
}

function PilotOpsSummary({ opsSummary }: any) {
  if (!opsSummary) {
    return (
      <section className="subpanel">
        <h3>运维摘要</h3>
        <p className="muted">运维摘要加载中。</p>
      </section>
    );
  }

  const checks = [
    ["运维状态", opsSummary.ready ? "READY" : "BLOCKED"],
    ["网络", opsSummary.network?.lanMode ? "LAN" : "LOOPBACK"],
    ["HTTP 4xx", opsSummary.http?.clientErrors || 0],
    ["HTTP 5xx", opsSummary.http?.serverErrors || 0],
    ["Store", opsSummary.storage?.valid ? "READY" : "BLOCKED"],
    ["提醒", opsSummary.warnings?.length || 0],
  ];

  return (
    <section className="subpanel">
      <h3>运维摘要</h3>
      <div className="runtime-grid pilot-grid">
        {checks.map(([label, value]) => (
          <Metric key={String(label)} label={label} value={String(value).match(/^[A-Z_]+$/) ? badge(String(value)) : value} />
        ))}
      </div>
      <section className="split ops-split">
        <div>
          <h3>下一步动作</h3>
          <ul className="compact-list">
            {opsSummary.nextActions?.length ? opsSummary.nextActions.map((item: string, index: number) => (
              <li key={`${item}-${index}`}>
                <CopyableText value={item} />
              </li>
            )) : <li><strong>READY</strong><span>暂无额外动作。</span></li>}
          </ul>
        </div>
        <div>
          <h3>运维提醒</h3>
          <ul className="compact-list">
            {opsSummary.warnings?.length ? opsSummary.warnings.slice(0, 5).map((item: any) => (
              <li key={item.code}><strong>{item.code}</strong><span>{item.message}</span></li>
            )) : <li><strong>READY</strong><span>没有额外提醒。</span></li>}
          </ul>
        </div>
      </section>
    </section>
  );
}

function ChecklistAction({ action }: { action?: string }) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    if (!action) return;
    await copyText(action);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  if (!action) {
    return <span>-</span>;
  }

  return (
    <div className="checklist-action">
      <span>{action}</span>
      <button className="ghost" onClick={onCopy}>{copied ? "已复制" : "复制"}</button>
    </div>
  );
}

function CommandRow({ command, label }: { command?: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    if (!command) return;
    await copyText(command);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <tr>
      <th>{label}</th>
      <td>
        <div className="command-copy">
          <code>{command || "-"}</code>
          <button className="ghost" disabled={!command} onClick={onCopy}>{copied ? "已复制" : "复制"}</button>
        </div>
      </td>
    </tr>
  );
}

function StorageStatus({ busy, readiness, runAction, runtimeConfig, runtimeMetrics, runtimeNetwork, setSelectedWorkPackageId, storageDoctor, storageStatus }: any) {
  const doctorErrors = storageDoctor?.errors || [];
  const backupErrors = storageDoctor?.backupErrors || [];
  const checkpoints = storageStatus?.checkpoints || [];
  const latestCheckpoint = checkpoints[0] || null;
  const metric = (name: string) => runtimeMetrics?.[name] ?? 0;

  if (!storageStatus) {
    return <p className="muted">本地数据状态加载中。</p>;
  }

  function restoreCheckpoint(checkpoint: any) {
    if (!checkpoint) return;
    if (!window.confirm(`将用检查点 ${checkpoint.fileName} 覆盖当前数据文件，并在恢复前保留当前文件副本。确定继续？`)) return;
    runAction("已从检查点恢复本地数据", async () => {
      await api("/storage/restore-checkpoint", {
        method: "POST",
        body: JSON.stringify({ confirm: true, checkpointPath: checkpoint.filePath }),
      });
      setSelectedWorkPackageId(null);
    });
  }

  return (
    <>
      <div className="runtime-grid">
        <Metric label="项目数" value={storageStatus.projectCount || 0} />
        <Metric label="审计事件" value={storageStatus.auditEventCount || 0} />
        <Metric label="批准包" value={storageStatus.gateApprovalPackCount || 0} />
        <Metric label="通知" value={storageStatus.notificationCount || 0} />
        <Metric label="服务版本" value={runtimeConfig?.version || "-"} />
        <Metric label="静态资源" value={runtimeConfig?.staticMode || "-"} />
        <Metric label="访问日志" value={runtimeConfig?.accessLogEnabled ? "开启" : "关闭"} />
        <Metric label="访问码" value={runtimeConfig?.pilotAccessEnabled ? "开启" : "关闭"} />
        <Metric label="运行写入" value={runtimeConfig?.runtimeWrite?.writable ? "可写" : "只读"} />
        <Metric label="持久化后端" value={runtimeConfig?.runtimePersistence?.backend || "-"} />
        <Metric label="启动一致性" value={runtimeConfig?.runtimePersistence?.startupCheck?.ready ? "READY" : "BLOCKED"} />
        <Metric label="启动数据源" value={runtimeConfig?.runtimeStoreSource?.loadedSource || "-"} />
        <Metric label="就绪状态" value={readiness?.ready ? "READY" : "BLOCKED"} />
        <Metric label="请求上限" value={runtimeConfig?.maxJsonBodyBytes || "-"} />
        <Metric label="请求超时" value={runtimeConfig?.requestTimeoutMs ? `${runtimeConfig.requestTimeoutMs}ms` : "-"} />
      </div>
      <section className="subpanel">
        <h3>访问地址</h3>
        <div className="runtime-grid">
          <Metric label="监听模式" value={runtimeNetwork?.lanMode ? "LAN" : "本机"} />
          <Metric label="网络状态" value={runtimeNetwork?.ready ? "READY" : "BLOCKED"} />
          <Metric label="监听地址" value={runtimeNetwork ? `${runtimeNetwork.host}:${runtimeNetwork.port}` : "-"} />
          <Metric label="局域网地址" value={runtimeNetwork?.lanUrls?.length || 0} />
          <Metric label="启动命令" value={runtimeNetwork?.command || "-"} />
        </div>
        <div className="network-share">
          <strong>推荐地址</strong>
          {runtimeNetwork?.preferredUrl ? <NetworkUrl url={runtimeNetwork.preferredUrl} /> : <span className="muted">暂无推荐地址</span>}
          <CopyableText value={runtimeNetwork?.shareText} label={runtimeNetwork?.shareText || "暂无可复制邀请文本"} />
        </div>
        <div className="network-list">
          <div>
            <strong>本机访问</strong>
            {(runtimeNetwork?.localUrls || []).map((url: string) => <NetworkUrl key={url} url={url} />)}
          </div>
          <div>
            <strong>局域网访问</strong>
            {(runtimeNetwork?.lanUrls || []).length ? runtimeNetwork.lanUrls.map((url: string) => (
              <NetworkUrl key={url} url={url} />
            )) : <span className="muted">未发现可用 IPv4 地址</span>}
          </div>
        </div>
        {runtimeNetwork?.warnings?.length ? (
          <ul className="compact-list network-warnings">
            {runtimeNetwork.warnings.map((item: any) => <li key={item.code}><strong>{item.code}</strong><span>{item.message}</span></li>)}
          </ul>
        ) : null}
      </section>
      <section className="subpanel">
        <h3>运行指标</h3>
        <div className="runtime-grid">
          <Metric label="HTTP 请求" value={metric("hardware_flow_http_requests_total")} />
          <Metric label="HTTP 4xx" value={metric("hardware_flow_http_client_errors_total")} />
          <Metric label="HTTP 5xx" value={metric("hardware_flow_http_errors_total")} />
          <Metric label="平均耗时" value={`${metric("hardware_flow_http_request_duration_ms_avg").toFixed(2)}ms`} />
          <Metric label="最大耗时" value={`${metric("hardware_flow_http_request_duration_ms_max").toFixed(2)}ms`} />
          <Metric label="活跃工作包" value={metric("hardware_flow_active_work_packages_total")} />
          <Metric label="打开高风险" value={metric("hardware_flow_active_open_high_risks")} />
          <Metric label="阶段门可过" value={metric("hardware_flow_active_gate_ready") ? "是" : "否"} />
          <Metric label="关停中" value={metric("hardware_flow_shutting_down") ? "是" : "否"} />
          <Metric label="运行时长" value={formatSeconds(metric("hardware_flow_process_uptime_seconds"))} />
          <Metric label="RSS 内存" value={formatBytes(metric("hardware_flow_process_memory_rss_bytes"))} />
          <Metric label="Heap 使用" value={formatBytes(metric("hardware_flow_process_memory_heap_used_bytes"))} />
        </div>
      </section>
      <table className="storage-table">
        <tbody>
          <tr><th>服务</th><td>{runtimeConfig?.packageName || "-"} · {runtimeConfig?.nodeEnv || "-"}</td></tr>
          <tr><th>监听</th><td>{runtimeConfig ? `${runtimeConfig.host}:${runtimeConfig.port}` : "-"}</td></tr>
          <tr><th>静态资源目录</th><td><CopyableText value={runtimeConfig?.staticRoot} /></td></tr>
          <tr><th>健康状态</th><td>{storageDoctor ? badge(storageDoctor.valid ? "READY" : "BLOCKED") : "-"}</td></tr>
          <tr><th>数据文件</th><td><CopyableText value={storageStatus.storePath} /></td></tr>
          <tr><th>文件状态</th><td>{storageStatus.exists ? "存在" : "不存在"}</td></tr>
          <tr><th>文件大小</th><td>{storageStatus.sizeBytes || 0} bytes</td></tr>
          <tr><th>更新时间</th><td>{storageStatus.updatedAt || "-"}</td></tr>
          <tr><th>备份文件</th><td><CopyableText value={storageStatus.backupPath || storageDoctor?.backupPath} /></td></tr>
          <tr>
            <th>备份状态</th>
            <td>
              {storageStatus.backupExists ? (
                <span>{storageDoctor?.backupValid ? badge("READY") : badge("BLOCKED")} {storageStatus.backupSizeBytes || 0} bytes</span>
              ) : "暂无备份"}
            </td>
          </tr>
          <tr><th>备份时间</th><td>{storageStatus.backupUpdatedAt || "-"}</td></tr>
          <tr>
            <th>最近检查点</th>
            <td>
              {latestCheckpoint ? (
                <CopyableText label={`${latestCheckpoint.fileName} · ${latestCheckpoint.updatedAt}`} value={latestCheckpoint.filePath} />
              ) : "暂无检查点"}
            </td>
          </tr>
        </tbody>
      </table>
      <section className="subpanel">
        <h3>最近检查点</h3>
        {checkpoints.length ? (
          <ul className="checkpoint-list">
            {checkpoints.slice(0, 5).map((checkpoint: any) => (
              <li key={checkpoint.filePath}>
                <div>
                  <strong>{checkpoint.fileName}</strong>
                  <span className="muted">{checkpoint.updatedAt || "-"} · {checkpoint.sizeBytes || 0} bytes</span>
                  <CopyableText value={checkpoint.filePath} />
                </div>
                <button className="ghost" disabled={busy} onClick={() => restoreCheckpoint(checkpoint)}>恢复</button>
              </li>
            ))}
          </ul>
        ) : <p className="muted">暂无检查点。试点开始前建议创建 `pilot-start` 检查点。</p>}
      </section>
      <div className="actions storage-actions">
        <button className="ghost" onClick={() => openApiPath("/runtime/config")}>打开运行配置</button>
        <button className="ghost" onClick={() => openApiPath("/ops/summary")}>打开运维摘要</button>
        <button className="ghost" onClick={() => openApiPath("/metrics")}>打开 Metrics</button>
        <button
          className="ghost"
          disabled={busy}
          onClick={() => {
            const label = window.prompt("输入检查点标签", "pilot-start");
            if (label === null) return;
            runAction("本地数据检查点已创建", () => api("/storage/checkpoints", {
              method: "POST",
              body: JSON.stringify({ label }),
            }));
          }}
        >
          创建检查点
        </button>
        <button
          className="ghost"
          disabled={busy || !latestCheckpoint}
          onClick={() => {
            restoreCheckpoint(latestCheckpoint);
          }}
        >
          恢复最新检查点
        </button>
        <button
          className="ghost"
          disabled={busy || !storageStatus.backupExists}
          onClick={() => {
            if (!window.confirm("将用 .bak 备份覆盖当前数据文件，并在恢复前保留当前文件副本。确定继续？")) return;
            runAction("已从备份恢复本地数据", async () => {
              await api("/storage/restore-backup", {
                method: "POST",
                body: JSON.stringify({ confirm: true }),
              });
              setSelectedWorkPackageId(null);
            });
          }}
        >
          从备份恢复
        </button>
        <button
          className="danger"
          disabled={busy}
          onClick={() => {
            if (!window.confirm("重置后会恢复内置演示数据，并覆盖当前本地数据。确定继续？")) return;
            runAction("演示数据已重置", async () => {
              await api("/demo/reset", {
                method: "POST",
                body: JSON.stringify({ confirm: true }),
              });
              setSelectedWorkPackageId(null);
            });
          }}
        >
          重置演示数据
        </button>
      </div>
      {doctorErrors.length ? (
        <section className="subpanel">
          <h3>数据问题</h3>
          <ul className="plain-list">{doctorErrors.map((error: string, index: number) => <li key={index}><span>{error}</span></li>)}</ul>
        </section>
      ) : null}
      {backupErrors.length ? (
        <section className="subpanel">
          <h3>备份问题</h3>
          <ul className="plain-list">{backupErrors.map((error: string, index: number) => <li key={index}><span>{error}</span></li>)}</ul>
        </section>
      ) : null}
    </>
  );
}

function CopyableText({ label, value }: { label?: string; value?: string | null }) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    if (!value) return;
    await copyText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="copyable-text">
      <span>{label || value || "-"}</span>
      <button className="ghost" disabled={!value} onClick={onCopy}>{copied ? "已复制" : "复制"}</button>
    </div>
  );
}

function NetworkUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    await copyText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="network-url">
      <button className="link-button" onClick={() => window.open(url, "_blank", "noopener,noreferrer")}>{url}</button>
      <button className="ghost" onClick={onCopy}>{copied ? "已复制" : "复制"}</button>
    </div>
  );
}

function ImportValidationResult({ result }: any) {
  const errors = result.errors || [];
  const warnings = result.warnings || [];

  return (
    <section className="subpanel import-result">
      <div className="detail-head">
        <h3>校验结果</h3>
        {result.valid ? badge("READY") : badge("BLOCKED")}
      </div>
      {result.summary ? (
        <div className="runtime-grid import-summary">
          <Metric label="项目" value={result.summary.projectName || "-"} />
          <Metric label="阶段" value={result.summary.phaseCount || 0} />
          <Metric label="工作包" value={result.summary.workPackageCount || 0} />
          <Metric label="交付物" value={result.summary.artifactVersionCount || 0} />
        </div>
      ) : null}
      {errors.length ? (
        <>
          <h3>错误</h3>
          <ul className="plain-list">
            {errors.map((item: any, index: number) => <li key={index}><span>{item.message}</span></li>)}
          </ul>
        </>
      ) : null}
      {warnings.length ? (
        <>
          <h3>警告</h3>
          <ul className="plain-list">
            {warnings.map((item: any, index: number) => <li key={index}><span>{item.message}</span></li>)}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function RolePairRow({ actorUserId, busy, pair, runAction, users }: any) {
  const [humanUserId, setHumanUserId] = useState(pair.humanUserId || "");

  useEffect(() => {
    setHumanUserId(pair.humanUserId || "");
  }, [pair.humanUserId]);

  return (
    <tr>
      <td>{pair.humanRole || pair.roleKey}</td>
      <td>{pair.agentKey}</td>
      <td>
        <select value={humanUserId} onChange={(event) => setHumanUserId(event.target.value)}>
          {users.map((user: any) => (
            <option key={user.userId} value={user.userId}>
              {user.name} · {user.roles.join("/")}
            </option>
          ))}
        </select>
      </td>
      <td>
        <button
          disabled={busy || humanUserId === pair.humanUserId}
          onClick={() => runAction("角色负责人已更新", () => api(`/role-pairs/${pair.id}`, {
            method: "PATCH",
            body: JSON.stringify({ actorUserId, humanUserId }),
          }))}
        >
          保存
        </button>
      </td>
    </tr>
  );
}

function WorkPackages({ actorUserId, busy, phaseWorkPackages, project, runAction, selectedWorkPackage, setSelectedWorkPackageId }: any) {
  const artifacts = project.artifactVersions.filter((item: any) => item.workPackageId === selectedWorkPackage?.id);
  const reviews = project.reviews.filter((item: any) => item.workPackageId === selectedWorkPackage?.id);
  const evidenceRefs = (project.evidenceRefs || []).filter((item: any) => item.workPackageId === selectedWorkPackage?.id);
  const agentJobs = (project.agentJobs || []).filter((item: any) => item.workPackageId === selectedWorkPackage?.id);
  const agentRuns = (project.agentRuns || []).filter((item: any) => item.workPackageId === selectedWorkPackage?.id);
  const reviewIds = new Set(reviews.map((review: any) => review.id));
  const auditEvents = (project.auditEvents || []).filter(
    (event: any) =>
      (event.objectType === "workPackage" && event.objectId === selectedWorkPackage?.id) ||
      (event.objectType === "review" && reviewIds.has(event.objectId)),
  );

  return (
    <section className="split">
      <article className="panel">
        <h2>当前阶段工作包</h2>
        <div className="work-list">
          {phaseWorkPackages.map((item: any) => (
            <button className={item.id === selectedWorkPackage?.id ? "selected" : ""} key={item.id} onClick={() => setSelectedWorkPackageId(item.id)}>
              <strong>{item.title}</strong>
              <span>{item.requiredArtifactType}</span>
              <span>{badge(item.status)} {item.scheduleStatus ? badge(item.scheduleStatus) : null}</span>
            </button>
          ))}
        </div>
      </article>
      <article className="panel">
        {selectedWorkPackage ? (
          <WorkPackageDetail
            actorUserId={actorUserId}
            agentJobs={agentJobs}
            agentRuns={agentRuns}
            artifacts={artifacts}
            auditEvents={auditEvents}
            busy={busy}
            evidenceRefs={evidenceRefs}
            reviews={reviews}
            runAction={runAction}
            workPackage={selectedWorkPackage}
          />
        ) : <p className="muted">当前阶段暂无工作包。</p>}
      </article>
    </section>
  );
}

function WorkPackageDetail({ actorUserId, agentJobs, agentRuns, artifacts, auditEvents, busy, evidenceRefs, reviews, runAction, workPackage }: any) {
  const latestArtifact = artifacts.at(-1);
  const latestAgentRun = agentRuns.at(-1);
  const validation = latestArtifact?.content?.validation || latestAgentRun?.validation || null;
  const [dueAt, setDueAt] = useState(workPackage.dueAt || "");
  const [evidenceLabel, setEvidenceLabel] = useState("");
  const [evidenceRef, setEvidenceRef] = useState("");
  const [evidenceFileLabel, setEvidenceFileLabel] = useState("");
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);

  useEffect(() => {
    setDueAt(workPackage.dueAt || "");
    setEvidenceLabel("");
    setEvidenceRef("");
    setEvidenceFileLabel("");
    setEvidenceFile(null);
  }, [workPackage.id, workPackage.dueAt]);

  function submitReview(decision: string, defaultComment: string, extra: Record<string, any> = {}) {
    return runAction("审核已提交", () => api("/reviews", {
      method: "POST",
      body: JSON.stringify({
        workPackageId: workPackage.id,
        reviewerUserId: actorUserId,
        decision,
        comment: defaultComment,
        ...extra,
      }),
    }));
  }

  return (
    <>
      <div className="detail-head">
        <div>
          <h2>{workPackage.title}</h2>
          <p className="muted">{workPackage.requiredArtifactType} · {workPackage.artifactTemplateKey}</p>
          <p className="muted">截止日期：{workPackage.dueAt || "未设置"} · {workPackage.scheduleStatus ? badge(workPackage.scheduleStatus) : null}</p>
        </div>
        {badge(workPackage.status)}
      </div>
      <div className="actions">
        <button disabled={busy} onClick={() => runAction("Agent 输出已生成", () => api("/agent-runs", {
          method: "POST",
          body: JSON.stringify({ workPackageId: workPackage.id, inputRefs: ["artifact:react-workbench"] }),
        }))}>Agent 生成</button>
        <button disabled={busy} className="ghost" onClick={() => runAction("Agent 任务已入队", () => api("/agent-jobs", {
          method: "POST",
          body: JSON.stringify({ workPackageId: workPackage.id, inputRefs: ["artifact:react-queued"], actorUserId }),
        }))}>加入队列</button>
        <button disabled={busy} className="ghost" onClick={() => runAction("Agent 队列已处理", () => api("/agent-jobs/process-next", {
          method: "POST",
          body: JSON.stringify({ workerId: actorUserId }),
          allowError: true,
        }))}>处理下一条</button>
        <button disabled={busy || !latestArtifact} onClick={() => submitReview("APPROVE", "React 工作台批准")}>批准</button>
        <button
          disabled={busy || !latestArtifact}
          className="ghost"
          onClick={() => {
            const conditionText = window.prompt("请输入有条件批准条款，用分号分隔", "补充验证记录；关闭遗留问题");
            if (conditionText === null) return;
            const conditions = conditionText.split(/[;；]/).map((item) => item.trim()).filter(Boolean);
            submitReview("APPROVE_WITH_CONDITIONS", "React 工作台有条件批准", { conditions });
          }}
        >
          有条件批准
        </button>
        <button disabled={busy || !latestArtifact} className="ghost" onClick={() => submitReview("REQUEST_REVISION", "请 Agent 根据审核意见修改后重新提交。")}>要求修改</button>
        <button disabled={busy || !latestArtifact} className="ghost" onClick={() => submitReview("REJECT", "审核驳回。")}>驳回</button>
        <button disabled={busy} className="ghost" onClick={() => runAction("无效输出已模拟", () => api("/agent-runs", {
          method: "POST",
          body: JSON.stringify({
            workPackageId: workPackage.id,
            inputRefs: ["artifact:react-invalid"],
            draftMarkdown: "# 无效草稿\n\n缺少模板必填章节。",
          }),
        }))}>模拟无效输出</button>
        <button className="ghost" onClick={() => openApiPath(`/work-packages/${workPackage.id}/export.md`)}>导出 Markdown</button>
      </div>
      <section className="subpanel">
        <h3>计划</h3>
        <div className="inline-create">
          <label>截止日期<input type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
          <button className="ghost" disabled={busy} onClick={() => runAction("工作包截止日期已保存", () => api(`/work-packages/${workPackage.id}/schedule`, {
            method: "PATCH",
            body: JSON.stringify({ actorUserId, dueAt }),
          }))}>保存截止日期</button>
        </div>
      </section>
      <section className="subpanel">
        <h3>模板校验</h3>
        {validation ? (
          <>
            <p>{badge(validation.status)}</p>
            <p><strong>缺失项：</strong>{validation.missingSections?.length ? validation.missingSections.join("、") : "无"}</p>
            <p><strong>空内容项：</strong>{validation.emptySections?.length ? validation.emptySections.join("、") : "无"}</p>
          </>
        ) : <p className="muted">尚无 Agent 输出。</p>}
      </section>
      <section className="subpanel">
        <h3>证据引用</h3>
        <div className="evidence-form">
          <input placeholder="证据标题" value={evidenceLabel} onChange={(event) => setEvidenceLabel(event.target.value)} />
          <input placeholder="URL、文件路径或文档编号" value={evidenceRef} onChange={(event) => setEvidenceRef(event.target.value)} />
          <button className="ghost" disabled={busy || !evidenceLabel.trim() || !evidenceRef.trim()} onClick={() => runAction("证据引用已添加", async () => {
            await api(`/work-packages/${workPackage.id}/evidence-refs`, {
              method: "POST",
              body: JSON.stringify({ actorUserId, label: evidenceLabel, ref: evidenceRef }),
            });
            setEvidenceLabel("");
            setEvidenceRef("");
          })}>添加证据</button>
        </div>
        <div className="evidence-form file-upload-form">
          <input placeholder="附件标题" value={evidenceFileLabel} onChange={(event) => setEvidenceFileLabel(event.target.value)} />
          <input type="file" onChange={(event) => setEvidenceFile(event.target.files?.[0] || null)} />
          <button className="ghost" disabled={busy || !evidenceFileLabel.trim() || !evidenceFile} onClick={() => runAction("证据附件已上传", async () => {
            if (!evidenceFile) return;
            const contentBase64 = await fileToBase64(evidenceFile);
            await api(`/work-packages/${workPackage.id}/evidence-files`, {
              method: "POST",
              body: JSON.stringify({
                actorUserId,
                label: evidenceFileLabel,
                fileName: evidenceFile.name,
                mimeType: evidenceFile.type || "application/octet-stream",
                contentBase64,
              }),
            });
            setEvidenceFileLabel("");
            setEvidenceFile(null);
          })}>上传附件</button>
        </div>
        {evidenceRefs.length ? (
          <table className="compact-table">
            <thead><tr><th>标题</th><th>引用</th><th>大小</th><th>添加人</th></tr></thead>
            <tbody>
              {[...evidenceRefs].reverse().map((item: any) => (
                <tr key={item.id}>
                  <td>{item.label}</td>
                  <td>{item.kind === "file" ? <button className="link-button" onClick={() => openApiPath(item.ref)}>{item.originalFileName || item.fileName || "下载附件"}</button> : item.ref}</td>
                  <td>{item.kind === "file" ? formatBytes(item.sizeBytes) : "-"}</td>
                  <td>{item.createdByUserId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted">暂无人工补充证据。</p>}
      </section>
      <section className="subpanel">
        <h3>Agent 队列</h3>
        {agentJobs.length ? (
          <table className="compact-table">
            <thead><tr><th>状态</th><th>Agent</th><th>创建时间</th><th>结果</th></tr></thead>
            <tbody>
              {[...agentJobs].reverse().slice(0, 6).map((job: any) => (
                <tr key={job.id}>
                  <td>{badge(job.status)}</td>
                  <td>{job.agentKey}</td>
                  <td>{job.createdAt}</td>
                  <td>{job.resultStatusCode || "-"}{job.error ? ` · ${job.error}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted">暂无排队任务。</p>}
      </section>
      <section className="subpanel">
        <h3>交付物</h3>
        {latestArtifact ? (
          <pre>{latestArtifact.content?.draftMarkdown || latestArtifact.content?.summary || "已有交付物记录"}</pre>
        ) : <p className="muted">尚无 Agent 输出。</p>}
      </section>
      <section className="subpanel">
        <h3>审核记录</h3>
        {reviews.length ? reviews.map((review: any) => (
          <p key={review.id}>
            {review.reviewedAt} · {review.reviewerUserId} · {review.decision} · {review.comment}
            {review.conditions?.length ? <><br /><span className="muted">条件：{review.conditions.join("；")}</span></> : null}
            {review.conditions?.length ? <><br /><span className="muted">条款：{review.conditionsCompletedAt ? "已完成" : "未完成"}{review.conditionsCompletedByUserId ? ` · ${review.conditionsCompletedByUserId}` : ""}</span></> : null}
            {review.conditionsCompletionComment ? <><br /><span className="muted">完成说明：{review.conditionsCompletionComment}</span></> : null}
          </p>
        )) : <p className="muted">暂无审核记录。</p>}
      </section>
      <section className="subpanel">
        <h3>活动记录</h3>
        {auditEvents.length ? (
          <table className="compact-table">
            <thead><tr><th>时间</th><th>事件</th><th>操作者</th><th>对象</th><th>详情</th></tr></thead>
            <tbody>
              {[...auditEvents].reverse().map((event: any) => (
                <tr key={event.id}>
                  <td>{event.createdAt || "-"}</td>
                  <td>{event.eventType || "-"}</td>
                  <td>{event.actorType || "-"}:{event.actorId || "-"}</td>
                  <td>{event.objectType || "-"}:{event.objectId || "-"}</td>
                  <td><AuditPayload payload={event.payload} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted">当前工作包暂无活动记录。</p>}
      </section>
    </>
  );
}

function Gate({ actorUserId, activeGate, busy, gateReviewPack, latestGateCheck, runAction }: any) {
  return (
    <section className="content-grid gate-grid">
      <article className="panel">
        <h2>阶段门检查</h2>
        <p>{badge(latestGateCheck.status)}</p>
        <div className="actions">
          <button disabled={busy} onClick={() => runAction("阶段门检查已更新", () => api(`/gates/${activeGate.id}/check`))}>重新检查</button>
          <button className="ghost" onClick={() => openApiPath(`/gates/${activeGate.id}/review-pack.md`)}>导出审核包</button>
          <button className="ghost" onClick={() => openApiPath(`/gates/${activeGate.id}/approval-pack.md`)}>导出批准包</button>
          <button disabled={busy || latestGateCheck.status !== "READY"} onClick={() => {
            const comment = promptComment("请输入阶段门批准说明", "证据和风险状态已确认，批准进入下一阶段。");
            if (comment === null) return;
            runAction("阶段门已批准", () => api(`/gates/${activeGate.id}/approve`, {
              method: "POST",
              body: JSON.stringify({ userId: actorUserId, comment }),
            }));
          }}>批准阶段门</button>
        </div>
      </article>
      <article className="panel span-2">
        <h2>审核包摘要</h2>
        <div className="runtime-grid">
          <Metric label="证据" value={`${gateReviewPack?.summary?.readyEvidenceCount || 0}/${gateReviewPack?.summary?.requiredEvidenceCount || 0}`} />
          <Metric label="人工证据" value={gateReviewPack?.summary?.manualEvidenceRefCount || 0} />
          <Metric label="阻塞项" value={gateReviewPack?.summary?.blockerCount || 0} />
          <Metric label="阻塞风险" value={gateReviewPack?.summary?.openBlockingRiskCount || 0} />
        </div>
      </article>
      <article className="panel span-2">
        <h2>审核包证据</h2>
        <table>
          <thead><tr><th>交付物</th><th>工作包</th><th>审核</th><th>状态</th><th>证据</th></tr></thead>
          <tbody>
            {(gateReviewPack?.evidence || []).map((item: any) => (
              <tr key={item.workPackageId}>
                <td>{item.requiredArtifactType}</td>
                <td>{item.requiredWorkPackageTitle}<br /><span className="muted">{item.workPackageStatus}</span></td>
                <td>
                  {item.reviewerUserId || "-"}<br />
                  <span className="muted">{item.approvedReviewDecision || "-"}</span>
                  {item.approvedReviewConditions?.length ? <><br /><span className="muted">条件：{item.approvedReviewConditions.join("；")}</span></> : null}
                  {item.approvedReviewConditions?.length ? <><br /><span className="muted">条款：{item.approvedReviewConditionsCompletedAt ? "已完成" : "未完成"}</span></> : null}
                </td>
                <td>{item.ready ? badge("READY") : badge("BLOCKED")}</td>
                <td>{item.manualEvidenceCount || item.manualEvidenceRefs?.length || 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>
      <article className="panel span-3">
        <h2>审核包风险</h2>
        <table>
          <thead><tr><th>风险</th><th>缓解</th><th>严重度</th><th>状态</th><th>阻塞</th></tr></thead>
          <tbody>
            {(gateReviewPack?.risks || []).length ? gateReviewPack.risks.map((risk: any) => (
              <tr key={risk.id}>
                <td>{risk.title}</td>
                <td>{risk.mitigationStatus ? badge(risk.mitigationStatus) : badge("UNSCHEDULED")}<br /><span className="muted">{risk.mitigationOwnerUserId || "未指定"} · {risk.mitigationDueAt || "未设置"}</span></td>
                <td>{risk.severity}</td>
                <td>{badge(risk.status)}</td>
                <td>{risk.blocksGate ? badge("BLOCKED") : badge("READY")}</td>
              </tr>
            )) : <tr><td colSpan={5}>当前阶段暂无风险。</td></tr>}
          </tbody>
        </table>
      </article>
      <article className="panel span-3">
        <h2>阻塞项</h2>
        {latestGateCheck.blockers.length ? (
          <ul className="plain-list">
            {latestGateCheck.blockers.map((item: any, index: number) => (
              <li key={index}><strong>{item.code || item.type}</strong><span>{item.message || item.relatedObjectId}</span></li>
            ))}
          </ul>
        ) : <p className="muted">无阻塞项。</p>}
      </article>
    </section>
  );
}

function ActionItems({ actionItems, actorUserId, busy, runAction, setSelectedWorkPackageId, setView }: any) {
  const rows = [
    ...(actionItems?.pendingReviews || []).map((item: any) => ({
      key: `review-${item.workPackageId}`,
      type: "工作包审核",
      title: item.title,
      detail: `${item.artifactType || item.requiredArtifactType || "交付物"}${item.canApprove ? " · 可批准" : ""}`,
      action: (
        <button onClick={() => {
          setSelectedWorkPackageId(item.workPackageId);
          setView("workpackages");
        }}>处理</button>
      ),
    })),
    ...(actionItems?.scheduleAlerts || []).map((item: any) => ({
      key: `schedule-${item.workPackageId}`,
      type: "计划提醒",
      title: item.title,
      detail: `${statusText[item.scheduleStatus] || item.scheduleStatus || "-"} · ${item.dueAt || "未排期"}`,
      action: (
        <button onClick={() => {
          setSelectedWorkPackageId(item.workPackageId);
          setView("workpackages");
        }}>处理</button>
      ),
    })),
    ...(actionItems?.conditionalApprovals || []).map((item: any) => ({
      key: `condition-${item.reviewId}`,
      type: "有条件批准",
      title: item.title,
      detail: `${item.conditions?.join("；") || "补充条款"}${item.comment ? ` · ${item.comment}` : ""}`,
      action: (
        <div className="actions">
          <button onClick={() => {
            setSelectedWorkPackageId(item.workPackageId);
            setView("workpackages");
          }}>处理</button>
          <button
            className="ghost"
            disabled={busy}
            onClick={() => {
              const comment = promptComment("请输入有条件批准条款完成说明", "补充条款已完成并记录验证结果。");
              if (comment === null) return;
              runAction("有条件批准条款已完成", () => api(`/reviews/${item.reviewId}/conditions/complete`, {
                method: "POST",
                body: JSON.stringify({ actorUserId, comment }),
              }));
            }}
          >
            完成条款
          </button>
        </div>
      ),
    })),
    ...(actionItems?.riskDecisions || []).map((item: any) => ({
      key: `risk-decision-${item.riskId}`,
      type: "风险决策",
      title: item.title,
      detail: item.severity || "-",
      action: <button onClick={() => setView("risks")}>处理</button>,
    })),
    ...(actionItems?.riskMitigations || []).map((item: any) => ({
      key: `risk-mitigation-${item.riskId}`,
      type: "风险缓解",
      title: item.title,
      detail: `${statusText[item.scheduleStatus] || item.scheduleStatus || "-"} · ${item.dueAt || "未排期"}${item.mitigation ? ` · ${item.mitigation}` : ""}`,
      action: (
        <div className="actions">
          <button onClick={() => setView("risks")}>处理</button>
          <button
            className="ghost"
            disabled={busy}
            onClick={() => {
              const comment = promptComment("请输入风险缓解完成说明", "缓解措施已完成并记录验证结果。");
              if (comment === null) return;
              runAction("风险缓解已完成", () => api(`/risks/${item.riskId}/mitigation/complete`, {
                method: "POST",
                body: JSON.stringify({ actorUserId, comment }),
              }));
            }}
          >
            完成缓解
          </button>
        </div>
      ),
    })),
    ...(actionItems?.gateApprovals || []).map((item: any) => ({
      key: `gate-${item.gateId}`,
      type: "阶段门批准",
      title: item.title,
      detail: "阶段门已满足批准条件",
      action: <button onClick={() => setView("gate")}>处理</button>,
    })),
  ];

  return (
    <article className="panel">
      <div className="detail-head">
        <div>
          <h2>我的待办</h2>
          <p className="muted">{actionItems?.total || 0} 个待处理事项</p>
        </div>
        <button className="ghost" disabled={busy} onClick={() => runAction("待办已刷新", () => Promise.resolve())}>刷新</button>
      </div>
      <section className="metric-grid action-summary">
        <Metric label="审核" value={actionItems?.pendingReviews?.length || 0} />
        <Metric label="计划" value={actionItems?.scheduleAlerts?.length || 0} />
        <Metric label="条款" value={actionItems?.conditionalApprovals?.length || 0} />
        <Metric label="风险决策" value={actionItems?.riskDecisions?.length || 0} />
        <Metric label="风险缓解" value={actionItems?.riskMitigations?.length || 0} />
        <Metric label="阶段门" value={actionItems?.gateApprovals?.length || 0} />
      </section>
      <table>
        <thead><tr><th>类型</th><th>事项</th><th>详情</th><th>操作</th></tr></thead>
        <tbody>
          {rows.length ? rows.map((row) => (
            <tr key={row.key}>
              <td>{row.type}</td>
              <td><strong>{row.title}</strong></td>
              <td>{row.detail}</td>
              <td>{row.action}</td>
            </tr>
          )) : (
            <tr><td colSpan={4}>当前没有待办。</td></tr>
          )}
        </tbody>
      </table>
    </article>
  );
}

function Notifications({ actorUserId, busy, filter, notifications, runAction, setFilter, setSelectedWorkPackageId, setView }: any) {
  if (!notifications) {
    return <article className="panel"><p className="muted">通知加载中。</p></article>;
  }

  const counts = notifications.counts || {};
  const filterItems = [
    ["ALL", "全部", notifications.total || 0],
    ["UNREAD", "未读", notifications.unreadCount || 0],
    ["ACTION", "行动项", counts.action || 0],
    ["WARNING", "提醒", counts.warning || 0],
    ["INFO", "信息", counts.info || 0],
  ];

  return (
    <article className="panel">
      <div className="detail-head">
        <div>
          <h2>通知中心</h2>
          <p className="muted">
            {notifications.filteredCount || 0} 条匹配 · {notifications.unreadCount || 0} 条未读 · {counts.action || 0} 个行动项 · {counts.warning || 0} 个提醒
          </p>
        </div>
        <button
          className="ghost"
          disabled={busy || !notifications.unreadCount}
          onClick={() => runAction("通知已全部标记为已读", () => api(`/users/${actorUserId}/notifications/read`, {
            method: "POST",
            body: "{}",
          }))}
        >
          全部已读
        </button>
      </div>

      <div className="segmented" role="tablist" aria-label="通知筛选">
        {filterItems.map(([key, label, count]) => (
          <button
            className={filter === key ? "active" : ""}
            key={key}
            onClick={() => setFilter(key)}
            role="tab"
            aria-selected={filter === key}
          >
            <span>{label}</span>
            <strong>{count}</strong>
          </button>
        ))}
      </div>

      <table>
        <thead><tr><th>状态</th><th>通知</th><th>类型</th><th>对象</th><th>时间</th><th>操作</th></tr></thead>
        <tbody>
          {notifications.notifications?.length ? notifications.notifications.map((item: any) => (
            <tr key={item.id}>
              <td>{badge(item.status)}</td>
              <td>
                <div className="notification-copy">
                  <strong>{item.title}</strong>
                  <span>{item.message}</span>
                </div>
              </td>
              <td>{item.type || "-"}</td>
              <td>{item.objectType || "-"}</td>
              <td>{item.createdAt || "-"}</td>
              <td>
                <div className="actions">
                  {notificationTargetAction(item, setSelectedWorkPackageId, setView)}
                  {item.status === "UNREAD" ? (
                    <button
                      className="ghost"
                      disabled={busy}
                      onClick={() => runAction("通知已标记为已读", () => api(`/notifications/${item.id}/read`, {
                        method: "POST",
                        body: JSON.stringify({ userId: actorUserId }),
                      }))}
                    >
                      标记已读
                    </button>
                  ) : null}
                </div>
              </td>
            </tr>
          )) : (
            <tr><td colSpan={6}>当前筛选下没有通知。</td></tr>
          )}
        </tbody>
      </table>
    </article>
  );
}

function notificationTargetAction(item: any, setSelectedWorkPackageId: (id: string) => void, setView: (view: ViewKey) => void) {
  if (item.objectType === "workPackage" && item.objectId) {
    return (
      <button
        className="ghost"
        onClick={() => {
          setSelectedWorkPackageId(item.objectId);
          setView("workpackages");
        }}
      >
        查看对象
      </button>
    );
  }

  if (item.objectType === "risk") {
    return <button className="ghost" onClick={() => setView("risks")}>查看对象</button>;
  }

  if (item.objectType === "gate") {
    return <button className="ghost" onClick={() => setView("gate")}>查看对象</button>;
  }

  return null;
}

function AuditTrail({ auditEvents }: any) {
  const [eventType, setEventType] = useState("ALL");
  const [query, setQuery] = useState("");
  const eventTypes = Array.from(new Set(auditEvents.map((event: any) => event.eventType).filter(Boolean))).sort();
  const normalizedQuery = query.trim().toLowerCase();
  const events = [...auditEvents]
    .reverse()
    .filter((event: any) => eventType === "ALL" || event.eventType === eventType)
    .filter((event: any) => {
      if (!normalizedQuery) return true;
      return [
        event.eventType,
        event.actorType,
        event.actorId,
        event.objectType,
        event.objectId,
        JSON.stringify(event.payload || {}),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });

  return (
    <article className="panel">
      <div className="detail-head">
        <div>
          <h2>审计事件</h2>
          <p className="muted">{events.length}/{auditEvents.length} 条行为记录</p>
        </div>
      </div>
      <div className="audit-filters">
        <input
          placeholder="搜索事件、操作者、对象或详情"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select value={eventType} onChange={(event) => setEventType(event.target.value)}>
          <option value="ALL">全部事件</option>
          {eventTypes.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
      </div>
      <table>
        <thead><tr><th>时间</th><th>事件</th><th>操作者</th><th>对象</th><th>详情</th></tr></thead>
        <tbody>
          {events.length ? events.map((event: any) => (
            <tr key={event.id}>
              <td>{event.createdAt || "-"}</td>
              <td>{event.eventType || "-"}</td>
              <td>{event.actorType || "-"}:{event.actorId || "-"}</td>
              <td>{event.objectType || "-"}:{event.objectId || "-"}</td>
              <td><AuditPayload payload={event.payload} /></td>
            </tr>
          )) : (
            <tr><td colSpan={5}>当前筛选下没有审计事件。</td></tr>
          )}
        </tbody>
      </table>
    </article>
  );
}

function AuditPayload({ payload }: any) {
  if (!payload || Object.keys(payload).length === 0) {
    return <span className="muted">无</span>;
  }

  return (
    <details className="audit-detail">
      <summary>查看</summary>
      <pre>{JSON.stringify(payload, null, 2)}</pre>
    </details>
  );
}

function Risks({ actorUserId, busy, project, runAction, users }: any) {
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState("HIGH");

  return (
    <article className="panel">
      <div className="detail-head">
        <div>
          <h2>风险台账</h2>
          <p className="muted">{project.project.name}</p>
        </div>
        <div className="inline-create">
          <input placeholder="新增风险标题" value={title} onChange={(event) => setTitle(event.target.value)} />
          <select value={severity} onChange={(event) => setSeverity(event.target.value)}>
            {riskSeverityOptions.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <button disabled={busy || !title.trim()} onClick={() => runAction("风险已创建", async () => {
            await api("/risks/current-phase", {
              method: "POST",
              body: JSON.stringify({ title, severity, userId: actorUserId }),
            });
            setTitle("");
            setSeverity("HIGH");
          })}>新增风险</button>
        </div>
        <button className="ghost" onClick={() => openApiPath(`/projects/${project.project.id}/risk-register.md`)}>导出 Markdown</button>
      </div>
      <table>
        <thead><tr><th>风险</th><th>严重度</th><th>状态</th><th>缓解</th><th>操作</th></tr></thead>
        <tbody>
          {project.risks.map((risk: any) => (
            <RiskRow actorUserId={actorUserId} busy={busy} key={risk.id} risk={risk} runAction={runAction} users={users} />
          ))}
        </tbody>
      </table>
    </article>
  );
}

function RiskRow({ actorUserId, busy, risk, runAction, users }: any) {
  const [owner, setOwner] = useState(risk.mitigationOwnerUserId || "");
  const [dueAt, setDueAt] = useState(risk.mitigationDueAt || "");
  const [mitigation, setMitigation] = useState(risk.mitigation || "");

  return (
    <tr>
      <td>{risk.title}</td>
      <td>{risk.severity}</td>
      <td>{badge(risk.status)} {risk.mitigationStatus ? badge(risk.mitigationStatus) : null}</td>
      <td>
        <div className="risk-plan">
          <select value={owner} onChange={(event) => setOwner(event.target.value)}>
            <option value="">未指定</option>
            {users.map((user: any) => <option key={user.userId} value={user.userId}>{user.name}</option>)}
          </select>
          <input type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
          <input value={mitigation} onChange={(event) => setMitigation(event.target.value)} placeholder="缓解措施" />
        </div>
      </td>
      <td>
        <div className="actions">
          <button disabled={busy} onClick={() => runAction("缓解计划已保存", () => api(`/risks/${risk.id}/mitigation`, {
            method: "PATCH",
            body: JSON.stringify({ actorUserId, mitigationOwnerUserId: owner, mitigationDueAt: dueAt, mitigation }),
          }))}>保存</button>
          <button disabled={busy || !risk.mitigationOwnerUserId || risk.mitigationStatus === "DONE"} className="ghost" onClick={() => {
            const comment = promptComment("请输入风险缓解完成说明", "缓解措施已完成并记录验证结果。");
            if (comment === null) return;
            runAction("风险缓解已完成", () => api(`/risks/${risk.id}/mitigation/complete`, {
              method: "POST",
              body: JSON.stringify({ actorUserId, comment }),
            }));
          }}>完成缓解</button>
          <button disabled={busy || risk.status !== "OPEN"} className="ghost" onClick={() => {
            const comment = promptComment("请输入接受风险的说明", "已评估影响和缓解措施，可接受。");
            if (comment === null) return;
            runAction("风险已接受", () => api(`/risks/${risk.id}/accept`, {
              method: "POST",
              body: JSON.stringify({ userId: actorUserId, comment }),
            }));
          }}>接受</button>
          <button disabled={busy || risk.status !== "OPEN"} className="ghost" onClick={() => {
            const comment = promptComment("请输入关闭风险的说明", "风险已处理并验证关闭。");
            if (comment === null) return;
            runAction("风险已关闭", () => api(`/risks/${risk.id}/close`, {
              method: "POST",
              body: JSON.stringify({ userId: actorUserId, comment }),
            }));
          }}>关闭</button>
        </div>
      </td>
    </tr>
  );
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}
