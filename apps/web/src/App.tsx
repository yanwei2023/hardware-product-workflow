import { useEffect, useMemo, useState } from "react";

type ViewKey = "overview" | "projects" | "workpackages" | "gate" | "risks" | "actions" | "notifications";

type ApiState = {
  project: any | null;
  users: any[];
  actionItems: any | null;
  notifications: any | null;
  gateReviewPack: any | null;
  storageStatus: any | null;
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
];

const apiBase = import.meta.env.VITE_API_BASE || "";

async function api(path: string, options: RequestInit = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error || JSON.stringify(body));
  }
  return body;
}

function badge(status?: string) {
  const value = status || "-";
  return <span className={`badge ${value}`}>{statusText[value] || value}</span>;
}

function formatUser(users: any[], userId?: string) {
  const user = users.find((item) => item.userId === userId);
  return user ? `${user.name}` : userId || "-";
}

export function App() {
  const [state, setState] = useState<ApiState>({
    project: null,
    users: [],
    actionItems: null,
    notifications: null,
    gateReviewPack: null,
    storageStatus: null,
  });
  const [view, setView] = useState<ViewKey>("overview");
  const [actorUserId, setActorUserId] = useState("user-project-manager");
  const [selectedWorkPackageId, setSelectedWorkPackageId] = useState<string | null>(null);
  const [notificationFilter, setNotificationFilter] = useState("ALL");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

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
    const [project, users, storageStatus] = await Promise.all([
      api("/projects/demo"),
      api("/users/demo"),
      api("/storage/status"),
    ]);
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
    });
    setSelectedWorkPackageId((current) => current || project.workPackages.find((item: any) => item.phaseId === phase?.id)?.id || null);
  }

  async function runAction(label: string, action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await action();
      await load();
      setMessage(label);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function reloadNotifications(filter = notificationFilter, userId = actorUserId) {
    const notifications = await api(`/users/${userId}/notifications${notificationQuery(filter)}`);
    setState((current) => ({ ...current, notifications }));
  }

  useEffect(() => {
    load().catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
  }, []);

  useEffect(() => {
    load(actorUserId).catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
  }, [actorUserId]);

  useEffect(() => {
    reloadNotifications().catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
  }, [notificationFilter]);

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

        {message ? <div className={message.includes("错误") || message.includes("无权") ? "message error" : "message"}>{message}</div> : null}

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
          />
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

function Projects({ actorUserId, busy, project, runAction, setSelectedWorkPackageId, storageStatus, users }: any) {
  const [name, setName] = useState("");
  const [productLine, setProductLine] = useState("");

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
                    <button className="ghost" onClick={() => window.open(`/projects/${item.id}/snapshot.md`, "_blank")}>导出快照</button>
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
        <h2>本地数据状态</h2>
        <div className="runtime-grid">
          <Metric label="项目数" value={storageStatus?.projectCount || 0} />
          <Metric label="审计事件" value={storageStatus?.auditEventCount || 0} />
          <Metric label="批准包" value={storageStatus?.gateApprovalPackCount || 0} />
          <Metric label="通知" value={storageStatus?.notificationCount || 0} />
        </div>
      </article>
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
  const latestArtifact = artifacts.at(-1);

  return (
    <section className="split">
      <article className="panel">
        <h2>当前阶段工作包</h2>
        <div className="work-list">
          {phaseWorkPackages.map((item: any) => (
            <button className={item.id === selectedWorkPackage?.id ? "selected" : ""} key={item.id} onClick={() => setSelectedWorkPackageId(item.id)}>
              <strong>{item.title}</strong>
              <span>{item.requiredArtifactType}</span>
              {badge(item.status)}
            </button>
          ))}
        </div>
      </article>
      <article className="panel">
        {selectedWorkPackage ? (
          <>
            <div className="detail-head">
              <div>
                <h2>{selectedWorkPackage.title}</h2>
                <p className="muted">{selectedWorkPackage.requiredArtifactType} · {selectedWorkPackage.artifactTemplateKey}</p>
              </div>
              {badge(selectedWorkPackage.status)}
            </div>
            <div className="actions">
              <button disabled={busy} onClick={() => runAction("Agent 输出已生成", () => api("/agent/run", {
                method: "POST",
                body: JSON.stringify({ workPackageId: selectedWorkPackage.id }),
              }))}>Agent 生成</button>
              <button disabled={busy || !latestArtifact} onClick={() => runAction("工作包已批准", () => api("/reviews", {
                method: "POST",
                body: JSON.stringify({ workPackageId: selectedWorkPackage.id, reviewerUserId: actorUserId, decision: "APPROVE", comment: "React 工作台批准" }),
              }))}>批准</button>
              <button disabled={busy || !latestArtifact} className="ghost" onClick={() => runAction("已要求修改", () => api("/reviews", {
                method: "POST",
                body: JSON.stringify({ workPackageId: selectedWorkPackage.id, reviewerUserId: actorUserId, decision: "REQUEST_REVISION", comment: "请补充关键章节" }),
              }))}>要求修改</button>
            </div>
            <section className="subpanel">
              <h3>交付物</h3>
              {latestArtifact ? (
                <pre>{latestArtifact.content?.draftMarkdown || latestArtifact.content?.summary || "已有交付物记录"}</pre>
              ) : <p className="muted">尚无 Agent 输出。</p>}
            </section>
            <section className="subpanel">
              <h3>审核记录</h3>
              {reviews.length ? reviews.map((review: any) => (
                <p key={review.id}>{review.reviewedAt} · {review.reviewerUserId} · {review.decision} · {review.comment}</p>
              )) : <p className="muted">暂无审核记录。</p>}
            </section>
          </>
        ) : <p className="muted">当前阶段暂无工作包。</p>}
      </article>
    </section>
  );
}

function Gate({ activeGate, busy, gateReviewPack, latestGateCheck, runAction }: any) {
  return (
    <section className="content-grid gate-grid">
      <article className="panel">
        <h2>阶段门检查</h2>
        <p>{badge(latestGateCheck.status)}</p>
        <div className="actions">
          <button disabled={busy} onClick={() => runAction("阶段门检查已更新", () => api(`/gates/${activeGate.id}/check`))}>重新检查</button>
          <button disabled={busy || latestGateCheck.status !== "READY"} onClick={() => runAction("阶段门已批准", () => api(`/gates/${activeGate.id}/approve`, {
            method: "POST",
            body: JSON.stringify({ userId: "user-project-manager", comment: "React 工作台批准" }),
          }))}>批准阶段门</button>
        </div>
      </article>
      <article className="panel span-2">
        <h2>审核包证据</h2>
        <table>
          <thead><tr><th>交付物</th><th>工作包</th><th>状态</th><th>证据</th></tr></thead>
          <tbody>
            {(gateReviewPack?.evidence || []).map((item: any) => (
              <tr key={item.workPackageId}>
                <td>{item.requiredArtifactType}</td>
                <td>{item.requiredWorkPackageTitle}</td>
                <td>{item.ready ? badge("READY") : badge("BLOCKED")}</td>
                <td>{item.manualEvidenceRefs?.length || 0}</td>
              </tr>
            ))}
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
            onClick={() => runAction("有条件批准条款已完成", () => api(`/reviews/${item.reviewId}/conditions/complete`, {
              method: "POST",
              body: JSON.stringify({ actorUserId, comment: "React 工作台记录条款已完成。" }),
            }))}
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
            onClick={() => runAction("风险缓解已完成", () => api(`/risks/${item.riskId}/mitigation/complete`, {
              method: "POST",
              body: JSON.stringify({ actorUserId, comment: "React 工作台记录缓解措施已完成。" }),
            }))}
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

function Notifications({ actorUserId, busy, filter, notifications, runAction, setFilter }: any) {
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
          <p className="muted">{notifications.filteredCount || 0} 条匹配 · {notifications.unreadCount || 0} 条未读</p>
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
                ) : "-"}
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

function Risks({ actorUserId, busy, project, runAction, users }: any) {
  const [title, setTitle] = useState("");

  return (
    <article className="panel">
      <div className="detail-head">
        <div>
          <h2>风险台账</h2>
          <p className="muted">{project.project.name}</p>
        </div>
        <div className="inline-create">
          <input placeholder="新增风险标题" value={title} onChange={(event) => setTitle(event.target.value)} />
          <button disabled={busy || !title.trim()} onClick={() => runAction("风险已创建", () => api("/risks/current-phase", {
            method: "POST",
            body: JSON.stringify({ title, severity: "HIGH", userId: actorUserId }),
          }))}>新增风险</button>
        </div>
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
            method: "POST",
            body: JSON.stringify({ userId: actorUserId, mitigationOwnerUserId: owner, mitigationDueAt: dueAt, mitigation }),
          }))}>保存</button>
          <button disabled={busy || risk.status !== "OPEN"} className="ghost" onClick={() => runAction("风险已接受", () => api(`/risks/${risk.id}/status`, {
            method: "POST",
            body: JSON.stringify({ userId: actorUserId, status: "ACCEPTED", comment: "React 工作台接受" }),
          }))}>接受</button>
          <button disabled={busy || risk.status !== "OPEN"} className="ghost" onClick={() => runAction("风险已关闭", () => api(`/risks/${risk.id}/status`, {
            method: "POST",
            body: JSON.stringify({ userId: actorUserId, status: "CLOSED", comment: "React 工作台关闭" }),
          }))}>关闭</button>
        </div>
      </td>
    </tr>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}
