# 第一条 API 闭环

这一阶段先做内存版 API，用来验证流程规则。真实数据库、登录权限、文件存储会在下一阶段接入。

## 目标

跑通以下链路：

```text
创建项目
-> 自动生成 EVT 阶段与必需工作包
-> Agent 提交 EVT 报告草稿
-> 人类审核测试计划
-> 阶段门检查，发现仍被阻塞
-> 人类关闭或接受高风险
-> Quality Agent 提交 EVT 问题关闭计划
-> 人类审核 EVT 问题关闭计划
-> 人类审核 EVT 报告
-> 阶段门变为可通过
```

## 核心 API

| 方法 | 路径 | 作用 |
|---|---|---|
| `GET` | `/health` | 检查后台是否运行 |
| `GET` | `/ready` | 检查 API 与本地 store 是否就绪 |
| `GET` | `/runtime/config` | 查看非敏感运行配置和静态资源模式 |
| `GET` | `/metrics` | 导出 Prometheus 文本格式运行指标 |
| `GET` | `/storage/status` | 查看当前 JSON 存储文件与项目统计 |
| `GET` | `/storage/doctor` | 检查当前 JSON 存储文件结构与引用完整性 |
| `POST` | `/storage/restore-backup` | 显式确认后从 `.bak` 恢复当前 JSON 存储 |
| `POST` | `/demo/reset` | 重置演示数据 |
| `GET` | `/projects/demo` | 查看演示项目状态 |
| `GET` | `/projects/:id/snapshot` | 导出项目快照 JSON |
| `GET` | `/projects/:id/snapshot.md` | 导出项目快照 Markdown |
| `GET` | `/projects/:id/risk-register` | 查看项目风险台账与阻塞风险汇总 |
| `GET` | `/projects/:id/risk-register.md` | 导出项目风险台账 Markdown |
| `POST` | `/projects/import/validate` | 导入项目前校验快照结构与引用完整性 |
| `POST` | `/projects/import` | 安全导入通过校验且不冲突的项目快照 |
| `POST` | `/projects/:id/clone` | 复制已有项目并自动切换到副本 |
| `POST` | `/projects/:id/archive` | 归档项目但保留全部数据和快照能力 |
| `POST` | `/projects/:id/restore` | 恢复已归档项目并切换为当前项目 |
| `PATCH` | `/role-pairs/:id` | 更新角色负责人，并通知新旧负责人和项目经理 |
| `GET` | `/work-packages/:id/export.md` | 导出单个工作包 Markdown，包含交付物、模板校验、审核记录和活动记录 |
| `PATCH` | `/work-packages/:id/schedule` | 设置或清空工作包截止日期，并刷新计划状态 |
| `POST` | `/work-packages/:id/evidence-refs` | 为工作包添加人工证据引用，进入快照、工作包导出和阶段门审核包 |
| `POST` | `/agent-runs` | 模拟 Agent 执行工作包 |
| `POST` | `/reviews` | 提交人类审核结果 |
| `POST` | `/reviews/:id/conditions/complete` | 完成有条件批准条款，记录完成说明并清除负责人待办 |
| `POST` | `/risks/current-phase` | 在当前阶段创建指定标题和严重度的风险 |
| `PATCH` | `/risks/:id/mitigation` | 更新风险缓解负责人、截止日期和措施说明，并通知负责人 |
| `POST` | `/risks/:id/mitigation/complete` | 完成风险缓解任务，保留风险状态并清除缓解待办 |
| `POST` | `/risks/:id/accept` | 人类接受风险 |
| `POST` | `/risks/:id/close` | 人类关闭风险 |
| `GET` | `/gates/:id/check` | 检查阶段门是否可通过 |
| `GET` | `/gates/:id/review-pack` | 查看阶段门审核包、证据状态、风险和阻塞项 |
| `GET` | `/gates/:id/review-pack.md` | 导出阶段门审核包 Markdown |
| `GET` | `/gates/:id/approval-pack` | 查看阶段门批准时固化的审核包归档 |
| `GET` | `/gates/:id/approval-pack.md` | 导出阶段门批准包 Markdown |
| `GET` | `/users/:id/action-items` | 查看指定用户在当前项目中的待办 |
| `GET` | `/users/:id/notifications` | 查看指定用户在当前项目中的站内通知，可用 `status` 或 `type` 筛选 |
| `POST` | `/notifications/:id/read` | 将站内通知标记为已读 |
| `POST` | `/users/:id/notifications/read` | 将指定用户在当前项目中的全部通知标记为已读 |

所有 API 响应都会带上 `x-service-version`；请求未提供 `x-request-id` 时服务端会生成一个，请求提供时会透传，便于把前端报错、访问日志和后端响应串起来。

`/ops/summary` 会聚合 `/ready`、`/runtime/config`、`/runtime/network`、`/storage/status`、HTTP 计数和试点就绪状态，适合内部试点主持人在现场快速判断服务、网络、store、阶段门和下一步动作。

`/metrics` 当前包含：

- 进程状态：ready、shutting down、uptime、RSS/heap 内存；
- HTTP 状态：总响应数、4xx 响应数、5xx 响应数、总/平均/最大响应耗时、按方法聚合的响应数；
- 存储状态：store 是否有效、项目数、通知数、审计事件数、批准包数；
- 当前项目业务状态：工作包总数、已批准数、逾期数、风险数、打开高风险、打开缓解计划和阶段门是否可批准。

## 强制规则

- Agent 只能生成草稿和发现项，不能批准工作包。
- 人类审核通过后，交付物才算正式可用于阶段门。
- 人类要求修改或驳回后，原待审草稿不能继续作为待审交付物。
- 高风险未关闭或未接受时，阶段门必须阻塞。
- 阶段门检查结果必须明确列出阻塞原因。
- JSON 请求体格式错误必须返回 `400`，不能作为服务器错误处理。
- 项目快照导入必须先通过结构与引用完整性校验，且不能覆盖已有项目 ID。
- 项目复制必须生成新的项目 ID，并写入 `PROJECT_CLONED` 审计事件。
- 项目归档必须保留原始项目数据，支持恢复并写入审计事件。
- 项目列表必须展示每个项目的当前阶段门、打开高风险、逾期工作包、未完成条件条款和风险缓解待闭环数量。
- 角色负责人变更必须写入审计事件，并通知新负责人、旧负责人和项目经理。
- 工作包 Markdown 导出必须带上最新交付物、模板校验结果、审核记录、活动记录和 Agent 草稿，便于离线归档。
- 工作包 Markdown 导出必须带上有条件批准条款及其完成状态。
- 工作包截止日期必须生成逾期/临期状态，并进入负责人待办。
- 阶段门审核包必须展示工作包审核决定、审核说明和有条件批准条款。
- 有条件批准条款必须进入工作包负责人的待办，并支持记录完成说明后清除待办。
- 阶段门审核包必须展示有条件批准条款的完成状态和完成说明。
- 阶段门审核包摘要必须统计有条件批准条款完成数和未完成数。
- 项目快照和首页总览必须统计有条件批准条款完成数和未完成数。
- 站内通知必须支持未读和类型筛选，同时保留全量计数便于前端分段展示。
- 风险台账必须按项目隔离，并标记哪些打开的高/严重风险会阻塞阶段门。
- 风险缓解计划必须支持负责人、截止日期、措施说明和独立完成状态，并通知缓解负责人，同时进入负责人的待办。
- 项目快照、首页总览、风险台账 JSON 和风险台账 Markdown 必须统计风险缓解计划总数、进行中数、逾期数和完成数。
- 阶段门审核包和批准包归档必须包含风险缓解状态，便于批准前确认残余风险缓解闭环。
- Agent 输出、审核、风险和阶段门事件必须生成可追踪的站内通知，允许单条或批量标记已读，并随项目快照导入/复制。
