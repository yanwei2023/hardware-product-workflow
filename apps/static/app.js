const state = {
  project: null,
  actionItems: null,
  notifications: null,
  gateReviewPack: null,
  storageStatus: null,
  storageDoctor: null,
  importValidation: null,
  importSnapshotRaw: "",
  users: [],
  actorUserId: "user-project-manager",
  currentView: "overview",
  selectedWorkPackageId: null,
  notificationFilter: "ALL",
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
  UNREAD: "未读",
  READ: "已读",
  UNSCHEDULED: "未排期",
  ON_TRACK: "正常",
  DUE_SOON: "临期",
  OVERDUE: "逾期",
  DONE: "完成",
  LOCKED: "已锁定",
  IN_PROGRESS: "进行中",
  ARCHIVED: "已归档",
};

const riskSeverityOptions = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

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

function jsStringAttr(value) {
  return escapeHtml(JSON.stringify(String(value ?? "")));
}

function statusBadge(status) {
  return `<span class="status ${status}">${statusText[status] || status}</span>`;
}

function setMessage(message, type = "info") {
  if (!message) {
    q("#message").innerHTML = "";
    return;
  }
  const detail = [message.requestId ? `请求ID ${message.requestId}` : "", message.serviceVersion ? `版本 ${message.serviceVersion}` : ""]
    .filter(Boolean)
    .join(" · ");
  q("#message").innerHTML = `
    <div class="message ${type}" role="${type === "error" ? "alert" : "status"}">
      <strong>${type === "error" ? "操作失败" : "操作完成"}</strong>
      <span>${escapeHtml(message.text || message)}</span>
      ${detail ? `<small>${escapeHtml(detail)}</small>` : ""}
    </div>
  `;
}

function successMessage(text) {
  return { text };
}

function errorMessage(error) {
  return {
    text: error.message || String(error),
    requestId: error.requestId || null,
    serviceVersion: error.serviceVersion || null,
  };
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
    error.requestId = response.headers.get("x-request-id");
    error.serviceVersion = response.headers.get("x-service-version");
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
    setMessage(errorMessage(error), "error");
  } finally {
    state.busy = false;
    render();
  }
}

async function loadProject() {
  const [project, users, storageStatus, storageDoctor] = await Promise.all([
    api("/projects/demo"),
    api("/users/demo"),
    api("/storage/status"),
    api("/storage/doctor"),
  ]);
  state.project = project;
  state.users = users.users;
  state.storageStatus = storageStatus;
  state.storageDoctor = storageDoctor;
  const gate = activeGate();
  const [actionItems, notifications, gateReviewPack] = await Promise.all([
    api(`/users/${state.actorUserId}/action-items`),
    api(notificationPath()),
    gate ? api(`/gates/${gate.id}/review-pack`) : Promise.resolve(null),
  ]);
  state.actionItems = actionItems;
  state.notifications = notifications;
  state.gateReviewPack = gateReviewPack;
  if (!state.selectedWorkPackageId) {
    state.selectedWorkPackageId = workPackagesForActivePhase()[0]?.id || null;
  }
  q("#projectMeta").textContent = `${state.project.project.name} · 当前阶段 ${activePhase()?.name || "-"}`;
  renderActorSelector();
  render();
}

function notificationPath() {
  const filters = {
    UNREAD: "?status=UNREAD",
    ACTION: "?type=ACTION",
    INFO: "?type=INFO",
  };
  return `/users/${state.actorUserId}/notifications${filters[state.notificationFilter] || ""}`;
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

function evidenceRefsFor(workPackageId) {
  return state.project.evidenceRefs?.filter((item) => item.workPackageId === workPackageId) || [];
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
    risks: "风险台账",
    audit: "审计",
  }[state.currentView];

  document.querySelectorAll(".view").forEach((item) => item.classList.add("hidden"));
  q(`#${state.currentView}View`).classList.remove("hidden");

  renderOverview();
  renderProjects();
  renderWorkPackages();
  renderGate();
  renderRisks();
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
          <thead><tr><th>项目</th><th>当前阶段</th><th>阶段门</th><th>风险</th><th>待闭环</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            ${state.project.projectSummaries
              .map((project) => {
                const isActive = project.id === state.project.activeProjectId;
                return `
                  <tr>
                    <td>${escapeHtml(project.name)} ${isActive ? statusBadge("IN_PROGRESS") : ""}</td>
                    <td>${escapeHtml(project.currentPhaseName || project.currentPhaseId)}</td>
                    <td>
                      ${escapeHtml(project.currentGateName || "-")}
                      ${project.currentGateStatus ? `<br>${statusBadge(project.currentGateStatus)}` : ""}
                    </td>
                    <td>${project.openHighRiskCount || 0}</td>
                    <td>
                      <span class="muted">逾期 ${project.overdueWorkPackageCount || 0}</span><br>
                      <span class="muted">条款 ${project.openConditionalApprovalCount || 0}</span><br>
                      <span class="muted">缓解 ${project.openMitigationCount || 0}</span>
                    </td>
                    <td>${statusBadge(project.status)}</td>
                    <td>
                      <div class="actions">
                        <button onclick="selectProject('${project.id}')" ${state.busy || isActive ? "disabled" : ""}>切换</button>
                        <button class="ghost" onclick="openProjectSnapshotMarkdown('${project.id}')">导出快照</button>
                        <button class="ghost" onclick="cloneProject('${project.id}')" ${state.busy ? "disabled" : ""}>复制</button>
                        ${
                          project.status === "ARCHIVED"
                            ? `<button class="secondary" onclick="restoreProject('${project.id}')" ${state.busy ? "disabled" : ""}>恢复</button>`
                            : `<button class="ghost" onclick="archiveProject('${project.id}')" ${state.busy ? "disabled" : ""}>归档</button>`
                        }
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
      <article class="panel wide">
        <h3>导入前校验</h3>
        <label class="field">
          项目快照 JSON
          <textarea id="snapshotImportJson" rows="10" placeholder="粘贴 /projects/:id/snapshot 导出的 JSON">${escapeHtml(state.importSnapshotRaw)}</textarea>
        </label>
        <div class="actions">
          <button onclick="validateProjectSnapshotImport()" ${state.busy ? "disabled" : ""}>校验快照</button>
          <button class="secondary" onclick="importProjectSnapshot()" ${state.busy || !state.importValidation?.canImport ? "disabled" : ""}>导入项目</button>
        </div>
        ${renderImportValidation()}
      </article>
    </div>
  `;
}

function renderImportValidation() {
  const result = state.importValidation;
  if (!result) {
    return "";
  }

  const errors = result.errors || [];
  const warnings = result.warnings || [];
  return `
    <section class="subpanel">
      <h4>校验结果</h4>
      <p>${result.valid ? statusBadge("READY") : statusBadge("BLOCKED")}</p>
      ${result.summary ? `
        <table class="table">
          <tbody>
            <tr><th>项目</th><td>${escapeHtml(result.summary.projectName || "-")}</td></tr>
            <tr><th>项目 ID</th><td>${escapeHtml(result.summary.projectId || "-")}</td></tr>
            <tr><th>阶段</th><td>${escapeHtml(result.summary.phaseCount)}</td></tr>
            <tr><th>工作包</th><td>${escapeHtml(result.summary.workPackageCount)}</td></tr>
            <tr><th>交付物版本</th><td>${escapeHtml(result.summary.artifactVersionCount)}</td></tr>
          </tbody>
        </table>
      ` : ""}
      ${errors.length ? `
        <h4>错误</h4>
        <ul>${errors.map((item) => `<li>${escapeHtml(item.message)}</li>`).join("")}</ul>
      ` : ""}
      ${warnings.length ? `
        <h4>警告</h4>
        <ul>${warnings.map((item) => `<li>${escapeHtml(item.message)}</li>`).join("")}</ul>
      ` : ""}
    </section>
  `;
}

function renderStorageStatus() {
  const status = state.storageStatus;
  const doctor = state.storageDoctor;
  if (!status) {
    return "<p class='muted'>加载中。</p>";
  }
  const doctorErrors = doctor?.errors || [];
  const backupErrors = doctor?.backupErrors || [];
  const latestCheckpoint = status.checkpoints?.[0] || null;

  return `
    <table class="table">
      <tbody>
        <tr><th>健康状态</th><td>${doctor ? statusBadge(doctor.valid ? "READY" : "BLOCKED") : "-"}</td></tr>
        <tr><th>数据文件</th><td>${escapeHtml(status.storePath)}</td></tr>
        <tr><th>文件状态</th><td>${status.exists ? "存在" : "不存在"}</td></tr>
        <tr><th>文件大小</th><td>${escapeHtml(status.sizeBytes)} bytes</td></tr>
        <tr><th>更新时间</th><td>${escapeHtml(status.updatedAt || "-")}</td></tr>
        <tr><th>备份文件</th><td>${escapeHtml(status.backupPath || doctor?.backupPath || "-")}</td></tr>
        <tr><th>备份状态</th><td>${status.backupExists ? `${doctor?.backupValid ? statusBadge("READY") : statusBadge("BLOCKED")} · ${escapeHtml(status.backupSizeBytes)} bytes` : "暂无备份"}</td></tr>
        <tr><th>备份时间</th><td>${escapeHtml(status.backupUpdatedAt || "-")}</td></tr>
        <tr><th>最近检查点</th><td>${latestCheckpoint ? `${escapeHtml(latestCheckpoint.fileName)} · ${escapeHtml(latestCheckpoint.updatedAt || "-")}` : "暂无检查点"}</td></tr>
        <tr><th>项目数</th><td>${escapeHtml(status.projectCount)}</td></tr>
        <tr><th>审计事件</th><td>${escapeHtml(status.auditEventCount)}</td></tr>
        <tr><th>批准包归档</th><td>${escapeHtml(status.gateApprovalPackCount || 0)}</td></tr>
        <tr><th>站内通知</th><td>${escapeHtml(status.notificationCount)}</td></tr>
      </tbody>
    </table>
    <div class="actions">
      <button class="secondary" onclick="window.open('/ops/summary', '_blank')">打开运维摘要</button>
      <button class="secondary" onclick="createStorageCheckpoint()" ${state.busy ? "disabled" : ""}>创建检查点</button>
      <button class="secondary" onclick="restoreStorageCheckpoint(${jsStringAttr(latestCheckpoint?.filePath || "")})" ${state.busy || !latestCheckpoint ? "disabled" : ""}>恢复最新检查点</button>
      <button class="secondary" onclick="restoreStorageBackup()" ${state.busy || !status.backupExists ? "disabled" : ""}>从备份恢复</button>
    </div>
    ${doctorErrors.length ? `
      <section class="subpanel">
        <h4>数据问题</h4>
        <ul>${doctorErrors.map((error) => `<li>${escapeHtml(error)}</li>`).join("")}</ul>
      </section>
    ` : ""}
    ${backupErrors.length ? `
      <section class="subpanel">
        <h4>备份问题</h4>
        <ul>${backupErrors.map((error) => `<li>${escapeHtml(error)}</li>`).join("")}</ul>
      </section>
    ` : ""}
  `;
}

async function createStorageCheckpoint() {
  const label = prompt("输入检查点标签", "pilot-start");
  if (label === null) {
    return;
  }

  await withBusy(async () => {
    await api("/storage/checkpoints", {
      method: "POST",
      body: JSON.stringify({ label }),
    });
    await loadProject();
    setMessage(successMessage("本地数据检查点已创建。"));
  });
}

async function restoreStorageCheckpoint(checkpointPath) {
  if (!checkpointPath) {
    return;
  }
  if (!confirm("将用最新检查点覆盖当前数据文件，并在恢复前保留当前文件副本。确定继续？")) {
    return;
  }

  await withBusy(async () => {
    await api("/storage/restore-checkpoint", {
      method: "POST",
      body: JSON.stringify({ confirm: true, checkpointPath }),
    });
    state.selectedWorkPackageId = null;
    await loadProject();
    setMessage(successMessage("已从检查点恢复本地数据。"));
  });
}

async function restoreStorageBackup() {
  if (!confirm("将用 .bak 备份覆盖当前数据文件，并在恢复前保留当前文件副本。确定继续？")) {
    return;
  }

  await withBusy(async () => {
    await api("/storage/restore-backup", {
      method: "POST",
      body: JSON.stringify({ confirm: true }),
    });
    state.selectedWorkPackageId = null;
    await loadProject();
    setMessage(successMessage("已从备份恢复本地数据。"));
  });
}

function renderOverview() {
  const gate = activeGate();
  const check = state.project.latestGateCheck;
  const conditionalSummary = state.project.conditionalApprovalSummary || {};
  const mitigationSummary = state.project.riskMitigationSummary || {};
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
      <article class="panel">
        <h3>打开高风险</h3>
        <p class="metric">${state.project.risks.filter((risk) => (risk.severity === "HIGH" || risk.severity === "CRITICAL") && risk.status === "OPEN").length}</p>
      </article>
      <article class="panel">
        <h3>风险缓解</h3>
        <p class="metric">${mitigationSummary.completedMitigationCount || 0}/${mitigationSummary.mitigationPlanCount || 0}</p>
      </article>
      <article class="panel">
        <h3>逾期/临期</h3>
        <p class="metric">${state.project.scheduleSummary?.overdueWorkPackageCount || 0}/${state.project.scheduleSummary?.dueSoonWorkPackageCount || 0}</p>
      </article>
      <article class="panel">
        <h3>批准包归档</h3>
        <p class="metric">${state.project.gateApprovalPacks?.length || 0}</p>
      </article>
      <article class="panel">
        <h3>条件条款</h3>
        <p class="metric">${conditionalSummary.completedConditionalApprovalCount || 0}/${conditionalSummary.conditionalApprovalCount || 0}</p>
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
    <article class="panel">
      <div class="detail-head">
        <div>
          <h3>站内通知</h3>
          <p class="muted">${escapeHtml(currentActorName())}</p>
        </div>
        <div class="actions">
          <p class="metric">${state.notifications?.unreadCount || 0}</p>
          <button class="ghost" onclick="markAllNotificationsRead()" ${state.busy || !state.notifications?.unreadCount ? "disabled" : ""}>全部已读</button>
        </div>
      </div>
      ${renderNotifications()}
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
    ...actionItems.scheduleAlerts.map(
      (item) => `
        <tr>
          <td>计划提醒</td>
          <td>${escapeHtml(item.title)} · ${statusText[item.scheduleStatus] || item.scheduleStatus} · ${escapeHtml(item.dueAt)}</td>
          <td><button onclick="goWorkPackage('${item.workPackageId}')">处理</button></td>
        </tr>
      `,
    ),
    ...actionItems.conditionalApprovals.map(
      (item) => `
        <tr>
          <td>有条件批准</td>
          <td>
            ${escapeHtml(item.title)} · ${escapeHtml(item.conditions.join("；"))}
            ${item.comment ? `<br><span class="muted">${escapeHtml(item.comment)}</span>` : ""}
          </td>
          <td>
            <div class="actions">
              <button onclick="goWorkPackage('${item.workPackageId}')">处理</button>
              <button class="secondary" onclick="completeConditionalApproval('${item.reviewId}')" ${state.busy ? "disabled" : ""}>完成条款</button>
            </div>
          </td>
        </tr>
      `,
    ),
    ...actionItems.riskDecisions.map(
      (item) => `
        <tr>
          <td>风险决策</td>
          <td>${escapeHtml(item.title)} · ${escapeHtml(item.severity)}</td>
          <td><button onclick="goRisks()">处理</button></td>
        </tr>
      `,
    ),
    ...actionItems.riskMitigations.map(
      (item) => `
        <tr>
          <td>风险缓解</td>
          <td>${escapeHtml(item.title)} · ${statusText[item.scheduleStatus] || item.scheduleStatus} · ${escapeHtml(item.dueAt || "未排期")}</td>
          <td><button onclick="goRisks()">处理</button></td>
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

function renderNotifications() {
  const notifications = state.notifications;
  if (!notifications) {
    return "<p class='muted'>通知加载中。</p>";
  }
  const counts = notifications.counts || {};
  const filters = [
    ["ALL", "全部", notifications.total || 0],
    ["UNREAD", "未读", counts.unread || 0],
    ["ACTION", "行动项", counts.action || 0],
    ["INFO", "信息", counts.info || 0],
  ];

  return `
    <div class="segmented">
      ${filters
        .map(
          ([value, label, count]) => `
            <button class="${state.notificationFilter === value ? "active" : ""}" onclick="setNotificationFilter('${value}')" ${state.busy ? "disabled" : ""}>
              ${escapeHtml(label)} · ${escapeHtml(count)}
            </button>
          `,
        )
        .join("")}
    </div>
    ${
      notifications.filteredCount === 0
        ? "<p class='muted'>当前筛选下没有通知。</p>"
        : `
    <table class="table">
      <thead><tr><th>状态</th><th>通知</th><th>时间</th><th>操作</th></tr></thead>
      <tbody>
        ${notifications.notifications
          .map(
            (item) => `
              <tr>
                <td>${statusBadge(item.status)}</td>
                <td>
                  <strong>${escapeHtml(item.title)}</strong><br>
                  <span class="muted">${escapeHtml(item.message)}</span>
                </td>
                <td>${escapeHtml(item.createdAt)}</td>
                <td>
                  ${item.status === "UNREAD" ? `<button class="ghost" onclick="markNotificationRead('${item.id}')" ${state.busy ? "disabled" : ""}>标记已读</button>` : "-"}
                </td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
    `
    }
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
                  <span>${statusBadge(item.status)} ${statusBadge(item.scheduleStatus)} ${artifact ? statusBadge(artifact.status) : ""}</span>
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
  const evidenceRefs = evidenceRefsFor(workPackage.id);
  const reviewIds = new Set(reviews.map((review) => review.id));
  const auditEvents = state.project.auditEvents.filter(
    (event) =>
      (event.objectType === "workPackage" && event.objectId === workPackage.id) ||
      (event.objectType === "review" && reviewIds.has(event.objectId)),
  );
  const validation = artifact?.content?.validation || agentRun?.validation || null;
  const draft = artifact?.content?.draftMarkdown || "";

  return `
    <div class="detail-head">
      <div>
        <h3>${escapeHtml(workPackage.title)}</h3>
        <p class="muted">${escapeHtml(workPackage.requiredArtifactType)} · ${escapeHtml(workPackage.artifactTemplateKey)}</p>
        <p class="muted">截止日期：${escapeHtml(workPackage.dueAt || "未设置")} · ${statusBadge(workPackage.scheduleStatus)}</p>
      </div>
      <div>${statusBadge(workPackage.status)}</div>
    </div>

    <div class="actions">
      <button onclick="runAgent('${workPackage.id}')" ${state.busy ? "disabled" : ""}>Agent 生成</button>
      <button class="secondary" onclick="submitReview('${workPackage.id}', 'APPROVE')" ${state.busy ? "disabled" : ""}>人类批准</button>
      <button class="ghost" onclick="submitReview('${workPackage.id}', 'REQUEST_REVISION')" ${state.busy ? "disabled" : ""}>要求修改</button>
      <button class="ghost" onclick="submitReview('${workPackage.id}', 'REJECT')" ${state.busy ? "disabled" : ""}>驳回</button>
      <button class="ghost" onclick="runInvalidAgent('${workPackage.id}')" ${state.busy ? "disabled" : ""}>模拟无效输出</button>
      <button class="ghost" onclick="openWorkPackageMarkdown('${workPackage.id}')">导出 Markdown</button>
    </div>

    <section class="subpanel">
      <h4>计划</h4>
      <label class="field">
        截止日期
        <input id="dueAt-${escapeHtml(workPackage.id)}" type="date" value="${escapeHtml(workPackage.dueAt || "")}" />
      </label>
      <button class="ghost" onclick="updateWorkPackageSchedule('${workPackage.id}')" ${state.busy ? "disabled" : ""}>保存截止日期</button>
    </section>

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
      <h4>证据引用</h4>
      <div class="inline-form evidence-form">
        <label class="field">
          标题
          <input id="evidenceLabel-${escapeHtml(workPackage.id)}" placeholder="例如：热测试报告 v1" />
        </label>
        <label class="field">
          引用
          <input id="evidenceRef-${escapeHtml(workPackage.id)}" placeholder="URL、文件路径或文档编号" />
        </label>
        <button class="ghost" onclick="addEvidenceRef('${workPackage.id}')" ${state.busy ? "disabled" : ""}>添加证据</button>
      </div>
      ${
        evidenceRefs.length
          ? `
            <table class="table compact-table">
              <thead><tr><th>标题</th><th>引用</th><th>添加人</th></tr></thead>
              <tbody>
                ${evidenceRefs
                  .slice()
                  .reverse()
                  .map(
                    (item) => `
                      <tr>
                        <td>${escapeHtml(item.label)}</td>
                        <td>${renderEvidenceRef(item.ref)}</td>
                        <td>${escapeHtml(item.createdByUserId)}</td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          `
          : "<p class='muted'>暂无人工补充证据。</p>"
      }
    </section>

    <section class="subpanel">
      <h4>审核记录</h4>
      ${
        reviews.length
          ? reviews
              .map(
                (review) => `
                  <p>
                    ${escapeHtml(review.reviewerUserId)} · ${escapeHtml(review.decision)} · ${escapeHtml(review.comment)}
                    ${review.conditions?.length ? `<br><span class="muted">条件：${review.conditions.map(escapeHtml).join("；")}</span>` : ""}
                    ${
                      review.conditions?.length
                        ? `<br><span class="muted">条款：${review.conditionsCompletedAt ? "已完成" : "未完成"}${review.conditionsCompletedByUserId ? ` · ${escapeHtml(review.conditionsCompletedByUserId)}` : ""}</span>`
                        : ""
                    }
                    ${review.conditionsCompletionComment ? `<br><span class="muted">完成说明：${escapeHtml(review.conditionsCompletionComment)}</span>` : ""}
                  </p>
                `,
              )
              .join("")
          : "<p class='muted'>尚无人类审核。</p>"
      }
    </section>

    <section class="subpanel">
      <h4>活动记录</h4>
      ${
        auditEvents.length
          ? auditEvents
              .slice()
              .reverse()
              .map(
                (event) => `
                  <p>${escapeHtml(event.createdAt)} · ${escapeHtml(event.eventType)} · ${escapeHtml(event.actorType)}:${escapeHtml(event.actorId)}</p>
                `,
              )
              .join("")
          : "<p class='muted'>暂无活动记录。</p>"
      }
    </section>

    <section class="subpanel">
      <h4>Agent 输出草稿</h4>
      <pre class="markdown-preview">${escapeHtml(draft || "暂无草稿。")}</pre>
    </section>
  `;
}

function renderEvidenceRef(ref) {
  const safeRef = escapeHtml(ref);
  if (/^https?:\/\//i.test(ref)) {
    return `<a href="${safeRef}" target="_blank" rel="noreferrer">${safeRef}</a>`;
  }
  return `<span>${safeRef}</span>`;
}

function renderRisks() {
  const risks = state.project.risks
    .slice()
    .sort((a, b) => {
      const phaseA = state.project.phases.find((phase) => phase.id === a.phaseId)?.sequence || 0;
      const phaseB = state.project.phases.find((phase) => phase.id === b.phaseId)?.sequence || 0;
      return phaseA - phaseB || a.title.localeCompare(b.title);
    });
  const openBlockingRisks = risks.filter(
    (risk) => (risk.severity === "HIGH" || risk.severity === "CRITICAL") && risk.status === "OPEN",
  );

  q("#risksView").innerHTML = `
    <article class="panel">
      <div class="detail-head">
        <div>
          <h3>项目风险台账</h3>
          <p class="muted">${escapeHtml(state.project.project.name)}</p>
        </div>
        <button class="ghost" onclick="openRiskRegisterMarkdown()">导出 Markdown</button>
      </div>
      <div class="grid cols-3">
        <div class="metric-block">
          <span>风险总数</span>
          <strong>${risks.length}</strong>
        </div>
        <div class="metric-block">
          <span>打开风险</span>
          <strong>${risks.filter((risk) => risk.status === "OPEN").length}</strong>
        </div>
        <div class="metric-block">
          <span>阻塞阶段门</span>
          <strong>${openBlockingRisks.length}</strong>
        </div>
      </div>
      ${renderRiskCreateForm("register")}
      <table class="table">
        <thead><tr><th>阶段</th><th>风险</th><th>缓解计划</th><th>严重度</th><th>状态</th><th>决策</th></tr></thead>
        <tbody>
          ${
            risks.length
              ? risks
                  .map((risk) => {
                    const phase = state.project.phases.find((item) => item.id === risk.phaseId);
                    return `
                      <tr>
                        <td>${escapeHtml(phase?.name || risk.phaseId)}</td>
                        <td>
                          ${escapeHtml(risk.title)}
                          ${risk.acceptedByUserId ? `<br><span class="muted">接受人：${escapeHtml(risk.acceptedByUserId)}</span>` : ""}
                          ${risk.closedByUserId ? `<br><span class="muted">关闭人：${escapeHtml(risk.closedByUserId)}</span>` : ""}
                          ${risk.acceptedComment || risk.closedComment ? `<br><span class="muted">说明：${escapeHtml(risk.closedComment || risk.acceptedComment)}</span>` : ""}
                        </td>
                        <td>${renderRiskMitigationEditor(risk)}</td>
                        <td>${escapeHtml(risk.severity)}</td>
                        <td>${statusBadge(risk.status)}</td>
                        <td>
                          <div class="actions">
                            <button onclick="acceptRisk('${risk.id}')" ${state.busy || risk.status !== "OPEN" ? "disabled" : ""}>接受风险</button>
                            <button class="secondary" onclick="closeRisk('${risk.id}')" ${state.busy || risk.status !== "OPEN" ? "disabled" : ""}>关闭风险</button>
                          </div>
                        </td>
                      </tr>
                    `;
                  })
                  .join("")
              : `<tr><td colspan="6">当前项目暂无风险。</td></tr>`
          }
        </tbody>
      </table>
    </article>
  `;
}

function renderRiskMitigationEditor(risk) {
  const hasPlan = risk.mitigationOwnerUserId || risk.mitigationDueAt || risk.mitigation;
  const mitigationStatus = risk.mitigationStatus || (hasPlan ? "OPEN" : "UNSCHEDULED");
  return `
    <div class="risk-plan">
      <span>${statusBadge(mitigationStatus)}</span>
      <select id="riskOwner-${escapeHtml(risk.id)}" aria-label="缓解负责人">
        <option value="">未指定负责人</option>
        ${state.users
          .map(
            (user) => `
              <option value="${escapeHtml(user.userId)}" ${user.userId === risk.mitigationOwnerUserId ? "selected" : ""}>
                ${escapeHtml(user.name)}
              </option>
            `,
          )
          .join("")}
      </select>
      <input id="riskDue-${escapeHtml(risk.id)}" type="date" value="${escapeHtml(risk.mitigationDueAt || "")}" aria-label="缓解截止日期" />
      <input id="riskMitigation-${escapeHtml(risk.id)}" value="${escapeHtml(risk.mitigation || "")}" placeholder="缓解措施" aria-label="缓解措施" />
      <button class="ghost" onclick="updateRiskMitigation('${risk.id}')" ${state.busy ? "disabled" : ""}>保存缓解计划</button>
      <button class="secondary" onclick="completeRiskMitigation('${risk.id}')" ${state.busy || !hasPlan || risk.mitigationStatus === "DONE" ? "disabled" : ""}>完成缓解</button>
      ${risk.mitigationCompletionComment ? `<span class="muted">完成说明：${escapeHtml(risk.mitigationCompletionComment)}</span>` : ""}
    </div>
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
      ${renderRiskCreateForm("gate")}
      <table class="table">
        <tbody>
          ${phaseRisks.length ? phaseRisks
            .map(
              (risk) => `
                <tr>
                  <td>${escapeHtml(risk.title)}</td>
                  <td>
                    ${risk.mitigationOwnerUserId || risk.mitigationDueAt || risk.mitigation
                      ? `<span class="muted">缓解：${escapeHtml(risk.mitigationOwnerUserId || "未指定")} · ${escapeHtml(risk.mitigationDueAt || "未设置")} · ${escapeHtml(risk.mitigation || "未填写")}</span>`
                      : `<span class="muted">未设置缓解计划</span>`}
                  </td>
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
            .join("") : `<tr><td colspan="5">当前阶段暂无风险。</td></tr>`}
        </tbody>
      </table>
    </article>
  `;
}

function renderRiskCreateForm(scope) {
  return `
    <section class="subpanel">
      <h4>创建当前阶段风险</h4>
      <div class="inline-form">
        <label class="field">
          风险标题
          <input id="riskTitle-${scope}" placeholder="例如：关键物料交期不确定" />
        </label>
        <label class="field compact">
          严重度
          <select id="riskSeverity-${scope}">
            ${riskSeverityOptions.map((item) => `<option value="${item}" ${item === "HIGH" ? "selected" : ""}>${item}</option>`).join("")}
          </select>
        </label>
        <button onclick="createCurrentPhaseRisk('${scope}')" ${state.busy ? "disabled" : ""}>创建风险</button>
      </div>
    </section>
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
      <div class="grid cols-4">
        <div class="metric-block">
          <span>证据</span>
          <strong>${pack.summary.readyEvidenceCount}/${pack.summary.requiredEvidenceCount}</strong>
        </div>
        <div class="metric-block">
          <span>人工证据</span>
          <strong>${pack.summary.manualEvidenceRefCount}</strong>
        </div>
        <div class="metric-block">
          <span>阻塞项</span>
          <strong>${pack.summary.blockerCount}</strong>
        </div>
        <div class="metric-block">
          <span>阻塞风险</span>
          <strong>${pack.summary.openBlockingRiskCount}</strong>
        </div>
        <div class="metric-block">
          <span>条件条款</span>
          <strong>${pack.summary.completedConditionalApprovalCount || 0}/${pack.summary.conditionalApprovalCount || 0}</strong>
        </div>
      </div>
      <table class="table">
        <thead><tr><th>必需交付物</th><th>工作包</th><th>交付物</th><th>人工证据</th><th>审核结论</th><th>状态</th></tr></thead>
        <tbody>
          ${pack.evidence
            .map(
              (item) => `
                <tr>
                  <td>${escapeHtml(item.requiredArtifactType)}</td>
                  <td>${escapeHtml(item.requiredWorkPackageTitle)}<br><span class="muted">${escapeHtml(item.workPackageStatus)}</span></td>
                  <td>${escapeHtml(item.latestArtifactStatus)}</td>
                  <td>${escapeHtml(item.manualEvidenceCount)}</td>
                  <td>
                    ${escapeHtml(item.reviewerUserId || "-")}<br>
                    <span class="muted">${escapeHtml(item.approvedReviewDecision || "-")}</span>
                    ${item.approvedReviewConditions?.length ? `<br><span class="muted">条件：${item.approvedReviewConditions.map(escapeHtml).join("；")}</span>` : ""}
                    ${item.approvedReviewComment ? `<br><span class="muted">说明：${escapeHtml(item.approvedReviewComment)}</span>` : ""}
                    ${
                      item.approvedReviewConditions?.length
                        ? `<br><span class="muted">条款：${item.approvedReviewConditionsCompletedAt ? "已完成" : "未完成"}${item.approvedReviewConditionsCompletedByUserId ? ` · ${escapeHtml(item.approvedReviewConditionsCompletedByUserId)}` : ""}</span>`
                        : ""
                    }
                    ${item.approvedReviewConditionsCompletionComment ? `<br><span class="muted">完成说明：${escapeHtml(item.approvedReviewConditionsCompletionComment)}</span>` : ""}
                  </td>
                  <td>${item.ready ? statusBadge("READY") : statusBadge("BLOCKED")}</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
      <table class="table">
        <thead><tr><th>风险</th><th>缓解</th><th>严重度</th><th>状态</th><th>阻塞</th></tr></thead>
        <tbody>
          ${
            pack.risks.length
              ? pack.risks
                  .map(
                    (risk) => `
                      <tr>
                        <td>${escapeHtml(risk.title)}</td>
                        <td>
                          ${statusBadge(risk.mitigationStatus || "UNSCHEDULED")}<br>
                          <span class="muted">${escapeHtml(risk.mitigationOwnerUserId || "未指定")} · ${escapeHtml(risk.mitigationDueAt || "未设置")}</span>
                          ${risk.mitigationCompletionComment ? `<br><span class="muted">${escapeHtml(risk.mitigationCompletionComment)}</span>` : ""}
                        </td>
                        <td>${escapeHtml(risk.severity)}</td>
                        <td>${statusBadge(risk.status)}</td>
                        <td>${risk.blocksGate ? statusBadge("BLOCKED") : statusBadge("READY")}</td>
                      </tr>
                    `,
                  )
                  .join("")
              : `<tr><td colspan="5">当前阶段暂无风险。</td></tr>`
          }
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

function goRisks() {
  state.currentView = "risks";
  document.querySelectorAll(".nav").forEach((item) => item.classList.toggle("active", item.dataset.view === "risks"));
  render();
}

function openWorkPackageMarkdown(workPackageId) {
  window.open(`/work-packages/${workPackageId}/export.md`, "_blank");
}

function openRiskRegisterMarkdown() {
  window.open(`/projects/${state.project.project.id}/risk-register.md`, "_blank");
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

async function markNotificationRead(notificationId) {
  await withBusy(async () => {
    await api(`/notifications/${notificationId}/read`, {
      method: "POST",
      body: JSON.stringify({ userId: state.actorUserId }),
    });
    await loadProject();
  });
}

async function markAllNotificationsRead() {
  await withBusy(async () => {
    await api(`/users/${state.actorUserId}/notifications/read`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    await loadProject();
  });
}

async function setNotificationFilter(filter) {
  state.notificationFilter = filter;
  await withBusy(loadProject);
}

async function updateWorkPackageSchedule(workPackageId) {
  const dueAt = q(`#dueAt-${CSS.escape(workPackageId)}`).value;
  await withBusy(async () => {
    await api(`/work-packages/${workPackageId}/schedule`, {
      method: "PATCH",
      body: JSON.stringify({
        dueAt,
        actorUserId: state.actorUserId,
      }),
    });
    await loadProject();
  });
}

async function addEvidenceRef(workPackageId) {
  const label = q(`#evidenceLabel-${CSS.escape(workPackageId)}`).value.trim();
  const ref = q(`#evidenceRef-${CSS.escape(workPackageId)}`).value.trim();
  await withBusy(async () => {
    await api(`/work-packages/${workPackageId}/evidence-refs`, {
      method: "POST",
      body: JSON.stringify({
        label,
        ref,
        actorUserId: state.actorUserId,
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
  const comment = window.prompt("请输入审核意见", commentByDecision[decision] || "审核完成。");
  if (comment === null) return;

  await withBusy(async () => {
    await api("/reviews", {
      method: "POST",
      body: JSON.stringify({
        workPackageId,
        reviewerUserId: state.actorUserId,
        decision,
        comment,
      }),
    });
    await loadProject();
  });
}

async function completeConditionalApproval(reviewId) {
  const comment = window.prompt("请输入有条件批准条款完成说明", "补充条款已完成并记录验证结果。");
  if (comment === null) return;
  await withBusy(async () => {
    await api(`/reviews/${reviewId}/conditions/complete`, {
      method: "POST",
      body: JSON.stringify({
        actorUserId: state.actorUserId,
        comment,
      }),
    });
    await loadProject();
  });
}

async function acceptRisk(riskId) {
  const comment = window.prompt("请输入接受风险的说明", "已评估影响和缓解措施，可接受。");
  if (comment === null) return;
  await withBusy(async () => {
    await api(`/risks/${riskId}/accept`, {
      method: "POST",
      body: JSON.stringify({ userId: state.actorUserId, comment }),
    });
    await loadProject();
  });
}

async function closeRisk(riskId) {
  const comment = window.prompt("请输入关闭风险的说明", "风险已处理并验证关闭。");
  if (comment === null) return;
  await withBusy(async () => {
    await api(`/risks/${riskId}/close`, {
      method: "POST",
      body: JSON.stringify({ userId: state.actorUserId, comment }),
    });
    await loadProject();
  });
}

async function updateRiskMitigation(riskId) {
  const safeId = CSS.escape(riskId);
  const mitigationOwnerUserId = q(`#riskOwner-${safeId}`).value;
  const mitigationDueAt = q(`#riskDue-${safeId}`).value;
  const mitigation = q(`#riskMitigation-${safeId}`).value.trim();
  await withBusy(async () => {
    await api(`/risks/${riskId}/mitigation`, {
      method: "PATCH",
      body: JSON.stringify({
        mitigationOwnerUserId,
        mitigationDueAt,
        mitigation,
        actorUserId: state.actorUserId,
      }),
    });
    await loadProject();
  });
}

async function completeRiskMitigation(riskId) {
  const comment = window.prompt("请输入风险缓解完成说明", "缓解措施已完成并记录验证结果。");
  if (comment === null) return;
  await withBusy(async () => {
    await api(`/risks/${riskId}/mitigation/complete`, {
      method: "POST",
      body: JSON.stringify({
        actorUserId: state.actorUserId,
        comment,
      }),
    });
    await loadProject();
  });
}

async function createCurrentPhaseRisk(scope) {
  const title = q(`#riskTitle-${CSS.escape(scope)}`).value.trim();
  const severity = q(`#riskSeverity-${CSS.escape(scope)}`).value;
  await withBusy(async () => {
    await api("/risks/current-phase", {
      method: "POST",
      body: JSON.stringify({
        title,
        severity,
        userId: state.actorUserId,
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

async function archiveProject(projectId) {
  const current = state.project.projectSummaries.find((item) => item.id === projectId);
  const confirmed = window.confirm(`归档项目「${current?.name || projectId}」？项目数据会保留，可稍后恢复。`);
  if (!confirmed) return;
  await withBusy(async () => {
    await api(`/projects/${projectId}/archive`, {
      method: "POST",
      body: JSON.stringify({ userId: state.actorUserId }),
    });
    state.selectedWorkPackageId = null;
    state.currentView = "projects";
    await loadProject();
  });
}

async function restoreProject(projectId) {
  await withBusy(async () => {
    await api(`/projects/${projectId}/restore`, {
      method: "POST",
      body: JSON.stringify({ userId: state.actorUserId }),
    });
    state.selectedWorkPackageId = null;
    state.currentView = "projects";
    await loadProject();
  });
}

function openProjectSnapshotMarkdown(projectId) {
  window.open(`/projects/${projectId}/snapshot.md`, "_blank");
}

async function cloneProject(projectId) {
  const current = state.project.projectSummaries.find((item) => item.id === projectId);
  const name = window.prompt("输入项目副本名称", `${current?.name || "项目"} 副本`);
  if (!name) {
    return;
  }

  await withBusy(async () => {
    await api(`/projects/${projectId}/clone`, {
      method: "POST",
      body: JSON.stringify({
        name,
        userId: state.actorUserId,
      }),
    });
    state.selectedWorkPackageId = null;
    state.currentView = "projects";
    await loadProject();
  });
}

async function validateProjectSnapshotImport() {
  const raw = q("#snapshotImportJson").value.trim();
  state.importSnapshotRaw = raw;
  if (!raw) {
    setMessage("请先粘贴项目快照 JSON。", "error");
    return;
  }

  let snapshot;
  try {
    snapshot = JSON.parse(raw);
  } catch (error) {
    setMessage(`JSON 格式错误：${error.message}`, "error");
    return;
  }

  await withBusy(async () => {
    const response = await fetch("/projects/import/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(snapshot),
    });
    state.importValidation = await response.json();
    if (!response.ok && !state.importValidation) {
      throw new Error("快照校验失败。");
    }
  });
}

async function importProjectSnapshot() {
  const raw = q("#snapshotImportJson").value.trim() || state.importSnapshotRaw;
  if (!raw) {
    setMessage("请先粘贴项目快照 JSON。", "error");
    return;
  }

  let snapshot;
  try {
    snapshot = JSON.parse(raw);
  } catch (error) {
    setMessage(`JSON 格式错误：${error.message}`, "error");
    return;
  }

  await withBusy(async () => {
    await api("/projects/import", {
      method: "POST",
      body: JSON.stringify({
        ...snapshot,
        actorUserId: state.actorUserId,
      }),
    });
    state.importValidation = null;
    state.importSnapshotRaw = "";
    state.selectedWorkPackageId = null;
    state.currentView = "projects";
    await loadProject();
  });
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
  const comment = window.prompt("请输入阶段门批准说明", "证据和风险状态已确认，批准进入下一阶段。");
  if (comment === null) return;
  await withBusy(async () => {
    const gate = activeGate();
    await api(`/gates/${gate.id}/approve`, {
      method: "POST",
      body: JSON.stringify({ userId: state.actorUserId, comment }),
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
  if (!confirm("重置后会恢复内置演示数据，并覆盖当前本地数据。确定继续？")) {
    return;
  }
  await withBusy(async () => {
    await api("/demo/reset", {
      method: "POST",
      body: JSON.stringify({ confirm: true }),
    });
    state.selectedWorkPackageId = null;
    await loadProject();
  });
});

loadProject().catch((error) => {
  document.body.innerHTML = `<pre>${escapeHtml(error.stack || error.message)}</pre>`;
});
