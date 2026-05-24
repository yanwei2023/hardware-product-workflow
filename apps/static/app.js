const state = {
  project: null,
  actionItems: null,
  gateReviewPack: null,
  storageStatus: null,
  users: [],
  actorUserId: "user-project-manager",
  currentView: "overview",
  selectedWorkPackageId: null,
  busy: false,
};

const statusText = {
  NOT_STARTED: "未开始",
  GATE_BLOCKED: "阶段门阻塞",
  GATE_READY: "阶段门可通过",
  AGENT_DRAFT_READY: "Agent 草稿完成",
  NEEDS_AGENT_REVISION: "需要 Agent 修改",
  HUMAN_APPROVED: "人类已批准",
  PENDING_REVIEW: "待审核",
  APPROVED: "已批准",
  NEEDS_REVISION: "需要修改",
  REJECTED: "已驳回",
  OPEN: "打开",
  ACCEPTED: "已接受",
  CLOSED: "已关闭",
  OUTPUT_READY: "输出完成",
  OUTPUT_INVALID: "输出无效",
  BLOCKED: "阻塞",
  READY: "可通过",
  LOCKED: "已锁定",
  IN_PROGRESS: "进行中",
};

function q(selector) {
  return document.querySelector(selector);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function statusBadge(status) {
  return `<span class="status ${status}">${statusText[status] || status}</span>`;
}

function setMessage(message, type = "info") {
  q("#message").innerHTML = message ? `<div class="message ${type}">${escapeHtml(message)}</div>` : "";
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.error || JSON.stringify(body));
    error.body = body;
    throw error;
  }
  return body;
}

async function withBusy(action) {
  if (state.busy) return;
  state.busy = true;
  setMessage("");
  render();
  try {
    await action();
  } catch (error) {
    setMessage(error.body ? JSON.stringify(error.body, null, 2) : error.message, "error");
  } finally {
    state.busy = false;
    render();
  }
}

async function loadProject() {
  const [project, users, storageStatus] = await Promise.all([
    api("/projects/demo"),
    api("/users/demo"),
    api("/storage/status"),
  ]);
  state.project = project;
  state.users = users.users;
  state.storageStatus = storageStatus;
  const gate = activeGate();
  const [actionItems, gateReviewPack] = await Promise.all([
    api(`/users/${state.actorUserId}/action-items`),
    gate ? api(`/gates/${gate.id}/review-pack`) : Promise.resolve(null),
  ]);
  state.actionItems = actionItems;
  state.gateReviewPack = gateReviewPack;
  if (!state.selectedWorkPackageId) {
    state.selectedWorkPackageId = workPackagesForActivePhase()[0]?.id || null;
  }
  q("#projectMeta").textContent = `${state.project.project.name} · 当前阶段 ${activePhase()?.name || "-"}`;
  renderActorSelector();
  render();
}

function renderActorSelector() {
  q("#actorUser").innerHTML = state.users
    .map(
      (user) => `
        <option value="${escapeHtml(user.userId)}" ${user.userId === state.actorUserId ? "selected" : ""}>
          ${escapeHtml(user.name)} · ${escapeHtml(user.roles.join("/"))}
        </option>
      `,
    )
    .join("");
}

function activePhase() {
  return state.project?.phases.find((phase) => phase.id === state.project.project.currentPhaseId);
}

function activeGate() {
  const phase = activePhase();
  return state.project?.gates.find((gate) => gate.phaseId === phase.id);
}

function workPackagesForActivePhase() {
  const phase = activePhase();
  return state.project?.workPackages.filter((item) => item.phaseId === phase.id) || [];
}

function selectedWorkPackage() {
  return state.project?.workPackages.find((item) => item.id === state.selectedWorkPackageId) || null;
}

function artifactsFor(workPackageId) {
  return state.project.artifactVersions.filter((item) => item.workPackageId === workPackageId);
}

function agentRunsFor(workPackageId) {
  return state.project.agentRuns.filter((item) => item.workPackageId === workPackageId);
}

function reviewsFor(workPackageId) {
  return state.project.reviews.filter((item) => item.workPackageId === workPackageId);
}

function latestArtifact(workPackageId) {
  return artifactsFor(workPackageId).at(-1) || null;
}

function latestAgentRun(workPackageId) {
  return agentRunsFor(workPackageId).at(-1) || null;
}

function render() {
  if (!state.project) return;
  q("#pageTitle").textContent = {
    overview: "项目总览",
    projects: "项目管理",
    workpackages: "工作包审核",
    gate: "阶段门",
    audit: "审计",
  }[state.currentView];

  document.querySelectorAll(".view").forEach((item) => item.classList.add("hidden"));
  q(`#${state.currentView}View`).classList.remove("hidden");

  renderOverview();
  renderProjects();
  renderWorkPackages();
  renderGate();
  renderAudit();
}

function renderProjects() {
  q("#projectsView").innerHTML = `
    <div class="grid cols-3">
      <article class="panel">
        <h3>创建项目</h3>
        <label class="field">
          项目名称
          <input id="newProjectName" placeholder="例如：智能门锁 V2" />
        </label>
        <label class="field">
          产品线
          <input id="newProductLine" placeholder="例如：IoT 产品线" />
        </label>
        <button onclick="createNewProject()" ${state.busy ? "disabled" : ""}>按标准模板创建</button>
      </article>
      <article class="panel wide">
        <h3>项目列表</h3>
        <table class="table">
          <thead><tr><th>项目</th><th>当前阶段</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            ${state.project.projectSummaries
              .map((project) => {
                const isActive = project.id === state.project.activeProjectId;
                return `
                  <tr>
                    <td>${escapeHtml(project.name)} ${isActive ? statusBadge("IN_PROGRESS") : ""}</td>
                    <td>${escapeHtml(project.currentPhaseName || project.currentPhaseId)}</td>
                    <td>${escapeHtml(project.status)}</td>
                    <td>
                      <div class="actions">
                        <button onclick="selectProject('${project.id}')" ${state.busy || isActive ? "disabled" : ""}>切换</button>
                        <button class="ghost" onclick="openProjectSnapshotMarkdown('${project.id}')">导出快照</button>
                      </div>
                    </td>
                  </tr>
                `;
              })
              .join("")}
          </tbody>
        </table>
      </article>
      <article class="panel wide">
        <h3>当前项目角色配对</h3>
        <table class="table">
          <thead><tr><th>人类角色</th><th>Agent</th><th>负责人</th><th>操作</th></tr></thead>
          <tbody>
            ${state.project.rolePairs
              .map(
                (pair) => `
                  <tr>
                    <td>${escapeHtml(pair.humanRole || pair.roleKey)}</td>
                    <td>${escapeHtml(pair.agentKey)}</td>
                    <td>
                      <select id="rolePairUser-${pair.id}">
                        ${state.users
                          .map(
                            (user) => `
                              <option value="${escapeHtml(user.userId)}" ${user.userId === pair.humanUserId ? "selected" : ""}>
                                ${escapeHtml(user.name)} · ${escapeHtml(user.roles.join("/"))}
                              </option>
                            `,
                          )
                          .join("")}
                      </select>
                    </td>
                    <td><button onclick="updateRolePair('${pair.id}')" ${state.busy ? "disabled" : ""}>保存</button></td>
                  </tr>
                `,
              )
              .join("")}
          </tbody>
        </table>
      </article>
      <article class="panel wide">
        <h3>本地数据</h3>
        ${renderStorageStatus()}
      </article>
    </div>
  `;
}

function renderStorageStatus() {
  const status = state.storageStatus;
  if (!status) {
    return "<p class='muted'>加载中。</p>";
  }

  return `
    <table class="table">
      <tbody>
        <tr><th>数据文件</th><td>${escapeHtml(status.storePath)}</td></tr>
        <tr><th>文件状态</th><td>${status.exists ? "存在" : "不存在"}</td></tr>
        <tr><th>文件大小</th><td>${escapeHtml(status.sizeBytes)} bytes</td></tr>
        <tr><th>更新时间</th><td>${escapeHtml(status.updatedAt || "-")}</td></tr>
        <tr><th>项目数</th><td>${escapeHtml(status.projectCount)}</td></tr>
        <tr><th>审计事件</th><td>${escapeHtml(status.auditEventCount)}</td></tr>
      </tbody>
    </table>
  `;
}

function renderOverview() {
  const gate = activeGate();
  const check = state.project.latestGateCheck;
  q("#overviewView").innerHTML = `
    <div class="phase-strip">
      ${state.project.phases
        .map(
          (phase) => `
            <article class="phase">
              ${statusBadge(phase.status)}
              <strong>${escapeHtml(phase.name)}</strong>
            </article>
          `,
        )
        .join("")}
    </div>
    <div class="grid cols-3">
      <article class="panel">
        <h3>当前阶段门</h3>
        <p>${escapeHtml(gate.name)}</p>
        <p>${statusBadge(gate.status)}</p>
      </article>
      <article class="panel">
        <h3>阻塞项</h3>
        <p class="metric">${check.blockers.length}</p>
      </article>
      <article class="panel">
        <h3>当前阶段工作包</h3>
        <p class="metric">${workPackagesForActivePhase().length}</p>
      </article>
    </div>
    <article class="panel">
      <div class="detail-head">
        <div>
          <h3>我的待办</h3>
          <p class="muted">${escapeHtml(currentActorName())}</p>
        </div>
        <p class="metric">${state.actionItems?.total || 0}</p>
      </div>
      ${renderActionItems()}
    </article>
  `;
}

function currentActorName() {
  const user = state.users.find((item) => item.userId === state.actorUserId);
  return user ? `${user.name} · ${user.roles.join("/")}` : state.actorUserId;
}

function renderActionItems() {
  const actionItems = state.actionItems;
  if (!actionItems || actionItems.total === 0) {
    return "<p class='muted'>当前没有待办。</p>";
  }

  const rows = [
    ...actionItems.pendingReviews.map(
      (item) => `
        <tr>
          <td>工作包审核</td>
          <td>${escapeHtml(item.title)}</td>
          <td><button onclick="goWorkPackage('${item.workPackageId}')">处理</button></td>
        </tr>
      `,
    ),
    ...actionItems.riskDecisions.map(
      (item) => `
        <tr>
          <td>风险决策</td>
          <td>${escapeHtml(item.title)} · ${escapeHtml(item.severity)}</td>
          <td><button onclick="goGate()">处理</button></td>
        </tr>
      `,
    ),
    ...actionItems.gateApprovals.map(
      (item) => `
        <tr>
          <td>阶段门批准</td>
          <td>${escapeHtml(item.title)}</td>
          <td><button onclick="goGate()">处理</button></td>
        </tr>
      `,
    ),
  ].join("");

  return `
    <table class="table">
      <thead><tr><th>类型</th><th>事项</th><th>操作</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderWorkPackages() {
  const selected = selectedWorkPackage();
  q("#workpackagesView").innerHTML = `
    <div class="split">
      <article class="panel">
        <h3>当前阶段工作包</h3>
        <div class="work-list">
          ${workPackagesForActivePhase()
            .map((item) => {
              const artifact = latestArtifact(item.id);
              return `
                <button class="work-item ${item.id === state.selectedWorkPackageId ? "selected" : ""}" onclick="selectWorkPackage('${item.id}')">
                  <strong>${escapeHtml(item.title)}</strong>
                  <span>${escapeHtml(item.requiredArtifactType)}</span>
                  <span>${statusBadge(item.status)} ${artifact ? statusBadge(artifact.status) : ""}</span>
                </button>
              `;
            })
            .join("")}
        </div>
      </article>
      <article class="panel">
        ${selected ? renderWorkPackageDetail(selected) : "<p>请选择一个工作包。</p>"}
      </article>
    </div>
  `;
}

function renderWorkPackageDetail(workPackage) {
  const artifact = latestArtifact(workPackage.id);
  const agentRun = latestAgentRun(workPackage.id);
  const reviews = reviewsFor(workPackage.id);
  const validation = artifact?.content?.validation || agentRun?.validation || null;
  const draft = artifact?.content?.draftMarkdown || "";

  return `
    <div class="detail-head">
      <div>
        <h3>${escapeHtml(workPackage.title)}</h3>
        <p class="muted">${escapeHtml(workPackage.requiredArtifactType)} · ${escapeHtml(workPackage.artifactTemplateKey)}</p>
      </div>
      <div>${statusBadge(workPackage.status)}</div>
    </div>

    <div class="actions">
      <button onclick="runAgent('${workPackage.id}')" ${state.busy ? "disabled" : ""}>Agent 生成</button>
      <button class="secondary" onclick="submitReview('${workPackage.id}', 'APPROVE')" ${state.busy ? "disabled" : ""}>人类批准</button>
      <button class="ghost" onclick="submitReview('${workPackage.id}', 'REQUEST_REVISION')" ${state.busy ? "disabled" : ""}>要求修改</button>
      <button class="ghost" onclick="submitReview('${workPackage.id}', 'REJECT')" ${state.busy ? "disabled" : ""}>驳回</button>
      <button class="ghost" onclick="runInvalidAgent('${workPackage.id}')" ${state.busy ? "disabled" : ""}>模拟无效输出</button>
    </div>

    <section class="subpanel">
      <h4>模板校验</h4>
      ${
        validation
          ? `
            <p>${statusBadge(validation.status)}</p>
            <p><strong>缺失项：</strong>${validation.missingSections?.length ? validation.missingSections.map(escapeHtml).join("、") : "无"}</p>
            <p><strong>空内容项：</strong>${validation.emptySections?.length ? validation.emptySections.map(escapeHtml).join("、") : "无"}</p>
          `
          : "<p class='muted'>尚无 Agent 输出。</p>"
      }
    </section>

    <section class="subpanel">
      <h4>审核记录</h4>
      ${
        reviews.length
          ? reviews
              .map(
                (review) => `
                  <p>${escapeHtml(review.reviewerUserId)} · ${escapeHtml(review.decision)} · ${escapeHtml(review.comment)}</p>
                `,
              )
              .join("")
          : "<p class='muted'>尚无人类审核。</p>"
      }
    </section>

    <section class="subpanel">
      <h4>Agent 输出草稿</h4>
      <pre class="markdown-preview">${escapeHtml(draft || "暂无草稿。")}</pre>
    </section>
  `;
}

function renderGate() {
  const check = state.project.latestGateCheck;
  const phase = activePhase();
  const phaseRisks = state.project.risks.filter((risk) => risk.phaseId === phase.id);
  q("#gateView").innerHTML = `
    <article class="panel">
      <h3>阶段门检查</h3>
      <p>${statusBadge(check.status)}</p>
      <button onclick="checkGate()" ${state.busy ? "disabled" : ""}>重新检查阶段门</button>
      <button class="ghost" onclick="openGateReviewPackMarkdown()" ${state.busy ? "disabled" : ""}>导出审核包 Markdown</button>
      <button class="secondary" onclick="approveGate()" ${state.busy || check.status !== "READY" ? "disabled" : ""}>批准阶段门并进入下一阶段</button>
    </article>
    ${renderGateReviewPack()}
    <article class="panel">
      <h3>还差什么</h3>
      ${
        check.blockers.length === 0
          ? "<p>无阻塞项，阶段门已具备通过条件。</p>"
          : `<table class="table">
            <thead><tr><th>类型</th><th>说明</th><th>关联对象</th><th>处理动作</th></tr></thead>
            <tbody>
              ${check.blockers.map(renderBlockerRow).join("")}
            </tbody>
          </table>`
      }
    </article>
    <article class="panel">
      <h3>风险</h3>
      <button class="ghost" onclick="createCurrentPhaseRisk()" ${state.busy ? "disabled" : ""}>创建当前阶段演示风险</button>
      <table class="table">
        <tbody>
          ${phaseRisks.length ? phaseRisks
            .map(
              (risk) => `
                <tr>
                  <td>${escapeHtml(risk.title)}</td>
                  <td>${escapeHtml(risk.severity)}</td>
                  <td>${statusBadge(risk.status)}</td>
                  <td>
                    <div class="actions">
                      <button onclick="acceptRisk('${risk.id}')" ${state.busy || risk.status !== "OPEN" ? "disabled" : ""}>接受风险</button>
                      <button class="secondary" onclick="closeRisk('${risk.id}')" ${state.busy || risk.status !== "OPEN" ? "disabled" : ""}>关闭风险</button>
                    </div>
                  </td>
                </tr>
              `,
            )
            .join("") : `<tr><td colspan="4">当前阶段暂无风险。</td></tr>`}
        </tbody>
      </table>
    </article>
  `;
}

function renderGateReviewPack() {
  const pack = state.gateReviewPack;
  if (!pack) {
    return "";
  }

  return `
    <article class="panel">
      <div class="detail-head">
        <div>
          <h3>阶段门审核包</h3>
          <p class="muted">${escapeHtml(pack.project?.name || "")} · ${escapeHtml(pack.phase?.name || "")}</p>
        </div>
        <div>${statusBadge(pack.readiness.status)}</div>
      </div>
      <div class="grid cols-3">
        <div class="metric-block">
          <span>证据</span>
          <strong>${pack.summary.readyEvidenceCount}/${pack.summary.requiredEvidenceCount}</strong>
        </div>
        <div class="metric-block">
          <span>阻塞项</span>
          <strong>${pack.summary.blockerCount}</strong>
        </div>
        <div class="metric-block">
          <span>阻塞风险</span>
          <strong>${pack.summary.openBlockingRiskCount}</strong>
        </div>
      </div>
      <table class="table">
        <thead><tr><th>必需交付物</th><th>工作包</th><th>交付物</th><th>审核人</th><th>状态</th></tr></thead>
        <tbody>
          ${pack.evidence
            .map(
              (item) => `
                <tr>
                  <td>${escapeHtml(item.requiredArtifactType)}</td>
                  <td>${escapeHtml(item.requiredWorkPackageTitle)}<br><span class="muted">${escapeHtml(item.workPackageStatus)}</span></td>
                  <td>${escapeHtml(item.latestArtifactStatus)}</td>
                  <td>${escapeHtml(item.reviewerUserId || "-")}</td>
                  <td>${item.ready ? statusBadge("READY") : statusBadge("BLOCKED")}</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    </article>
  `;
}

function renderBlockerRow(blocker) {
  const relatedWorkPackage = state.project.workPackages.find((item) => item.id === blocker.relatedObjectId);
  const action = relatedWorkPackage
    ? `<button onclick="goWorkPackage('${relatedWorkPackage.id}')">处理工作包</button>`
    : blocker.code === "OPEN_HIGH_RISK"
      ? `
        <div class="actions">
          <button onclick="acceptRisk('${blocker.relatedObjectId}')">接受风险</button>
          <button class="secondary" onclick="closeRisk('${blocker.relatedObjectId}')">关闭风险</button>
        </div>
      `
      : "";

  return `
    <tr>
      <td>${escapeHtml(blocker.code)}</td>
      <td>${escapeHtml(blocker.message)}</td>
      <td>${escapeHtml(blocker.relatedObjectId || "")}</td>
      <td>${action}</td>
    </tr>
  `;
}

function renderAudit() {
  q("#auditView").innerHTML = `
    <article class="panel">
      <h3>审计事件</h3>
      <table class="table">
        <thead><tr><th>时间</th><th>事件</th><th>操作者</th><th>对象</th><th>详情</th></tr></thead>
        <tbody>
          ${state.project.auditEvents
            .slice()
            .reverse()
            .map(
              (event) => `
                <tr>
                  <td>${escapeHtml(event.createdAt)}</td>
                  <td>${escapeHtml(event.eventType)}</td>
                  <td>${escapeHtml(event.actorType)}:${escapeHtml(event.actorId)}</td>
                  <td>${escapeHtml(event.objectType)}:${escapeHtml(event.objectId)}</td>
                  <td>${renderAuditPayload(event.payload)}</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    </article>
  `;
}

function renderAuditPayload(payload) {
  if (!payload || Object.keys(payload).length === 0) {
    return "<span class='muted'>无</span>";
  }

  return `
    <details class="audit-detail">
      <summary>查看</summary>
      <pre>${escapeHtml(JSON.stringify(payload, null, 2))}</pre>
    </details>
  `;
}

function selectWorkPackage(workPackageId) {
  state.selectedWorkPackageId = workPackageId;
  render();
}

function goWorkPackage(workPackageId) {
  state.currentView = "workpackages";
  state.selectedWorkPackageId = workPackageId;
  document.querySelectorAll(".nav").forEach((item) => item.classList.toggle("active", item.dataset.view === "workpackages"));
  render();
}

function goGate() {
  state.currentView = "gate";
  document.querySelectorAll(".nav").forEach((item) => item.classList.toggle("active", item.dataset.view === "gate"));
  render();
}

async function runAgent(workPackageId) {
  await withBusy(async () => {
    await api("/agent-runs", {
      method: "POST",
      body: JSON.stringify({
        workPackageId,
        inputRefs: ["artifact:demo-input"],
      }),
    });
    await loadProject();
  });
}

async function runInvalidAgent(workPackageId) {
  await withBusy(async () => {
    await api("/agent-runs", {
      method: "POST",
      body: JSON.stringify({
        workPackageId,
        inputRefs: ["artifact:demo-input"],
        draftMarkdown: "# 无效草稿\n\n缺少模板必填章节。",
      }),
    });
    await loadProject();
  });
}

async function approveWorkPackage(workPackageId) {
  await submitReview(workPackageId, "APPROVE");
}

async function submitReview(workPackageId, decision) {
  const commentByDecision = {
    APPROVE: "演示批准。",
    REQUEST_REVISION: "请 Agent 根据审核意见修改后重新提交。",
    REJECT: "审核驳回。",
  };

  await withBusy(async () => {
    await api("/reviews", {
      method: "POST",
      body: JSON.stringify({
        workPackageId,
        reviewerUserId: state.actorUserId,
        decision,
        comment: commentByDecision[decision] || "审核完成。",
      }),
    });
    await loadProject();
  });
}

async function acceptRisk(riskId) {
  await withBusy(async () => {
    await api(`/risks/${riskId}/accept`, {
      method: "POST",
      body: JSON.stringify({ userId: state.actorUserId }),
    });
    await loadProject();
  });
}

async function closeRisk(riskId) {
  await withBusy(async () => {
    await api(`/risks/${riskId}/close`, {
      method: "POST",
      body: JSON.stringify({ userId: state.actorUserId }),
    });
    await loadProject();
  });
}

async function createCurrentPhaseRisk() {
  await withBusy(async () => {
    const phase = activePhase();
    await api("/risks/demo-current-phase", {
      method: "POST",
      body: JSON.stringify({
        title: `${phase.name} 演示高风险`,
        severity: "HIGH",
      }),
    });
    await loadProject();
  });
}

async function checkGate() {
  await withBusy(async () => {
    const gate = activeGate();
    await api(`/gates/${gate.id}/check`);
    await loadProject();
  });
}

function openGateReviewPackMarkdown() {
  const gate = activeGate();
  if (gate) {
    window.open(`/gates/${gate.id}/review-pack.md`, "_blank");
  }
}

async function createNewProject() {
  await withBusy(async () => {
    const name = q("#newProjectName").value.trim();
    const productLine = q("#newProductLine").value.trim();
    await api("/projects", {
      method: "POST",
      body: JSON.stringify({
        name,
        productLine,
        userId: state.actorUserId,
      }),
    });
    state.currentView = "projects";
    state.selectedWorkPackageId = null;
    await loadProject();
  });
}

async function selectProject(projectId) {
  await withBusy(async () => {
    await api(`/projects/${projectId}/select`, { method: "POST" });
    state.selectedWorkPackageId = null;
    await loadProject();
  });
}

function openProjectSnapshotMarkdown(projectId) {
  window.open(`/projects/${projectId}/snapshot.md`, "_blank");
}

async function updateRolePair(rolePairId) {
  await withBusy(async () => {
    const humanUserId = q(`#rolePairUser-${CSS.escape(rolePairId)}`).value;
    await api(`/role-pairs/${rolePairId}`, {
      method: "PATCH",
      body: JSON.stringify({
        humanUserId,
        actorUserId: state.actorUserId,
      }),
    });
    await loadProject();
  });
}

async function approveGate() {
  await withBusy(async () => {
    const gate = activeGate();
    await api(`/gates/${gate.id}/approve`, {
      method: "POST",
      body: JSON.stringify({ userId: state.actorUserId }),
    });
    state.selectedWorkPackageId = null;
    await loadProject();
  });
}

document.querySelectorAll(".nav").forEach((button) => {
  button.addEventListener("click", () => {
    state.currentView = button.dataset.view;
    document.querySelectorAll(".nav").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    render();
  });
});

q("#refresh").addEventListener("click", () => withBusy(loadProject));
q("#actorUser").addEventListener("change", (event) => {
  state.actorUserId = event.target.value;
  withBusy(loadProject);
});
q("#resetDemo").addEventListener("click", async () => {
  await withBusy(async () => {
    await api("/demo/reset", { method: "POST" });
    state.selectedWorkPackageId = null;
    await loadProject();
  });
});

loadProject().catch((error) => {
  document.body.innerHTML = `<pre>${escapeHtml(error.stack || error.message)}</pre>`;
});
