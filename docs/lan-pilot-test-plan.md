# 局域网试点测试方案

本文档用于指导硬件产品工作流系统在局域网环境下的安装验收、功能测试、异常测试和试点前放行。测试目标是确认当前版本可以支持 4-8 人内部试点，覆盖项目创建、角色负责人配置、Agent 草稿、人类审核、风险闭环、阶段门批准、归档导出、运行诊断和数据回滚。

## 1. 测试范围

本轮测试覆盖：

- 局域网安装、启动和访问；
- 试点访问码；
- 健康检查、运行时配置、网络地址和运维摘要；
- 本地 JSON store 健康检查、检查点、备份和恢复；
- 项目主流程：创建项目、配置负责人、设置工作包排期、生成 Agent 草稿、人工审核、补充证据、风险缓解、阶段门批准；
- 待办、通知、审计和导出；
- 试点就绪总览、反馈计划、反馈分诊、M7 readiness 和 M7 backlog；
- 归档包生成和试点材料完整性；
- 局域网常见故障和回滚路径。

本轮不把以下事项作为通过条件：

- 正式用户登录、SSO 或细粒度权限系统；
- 生产级 TLS、反向代理和公网访问；
- PostgreSQL 作为默认运行时读写源；
- 真实大模型 Agent 接入；
- 飞书、企业微信等正式通知集成。

## 2. 测试环境

建议准备：

- 1 台服务器主机：macOS、Linux 或 Windows 均可，安装 Git、Node.js、npm；
- 2-3 台局域网客户端：使用 Chrome、Edge 或 Safari；
- 所有设备连接同一局域网或同一 VPN；
- 服务器防火墙允许 TCP `3001` 端口入站；
- 当前代码分支：`codex/agent-job-process-incremental`，或 PR 合并后的 `main`。

服务器主机安装命令：

```text
git clone --branch codex/agent-job-process-incremental https://github.com/yanwei2023/hardware-product-workflow.git
cd hardware-product-workflow
npm install
```

试点前完整检查：

```text
npm run pilot:check
```

如果只看到 PostgreSQL 相关非严格 preflight 提示，例如 `DATABASE_URL is not configured` 或 `psql is not available`，在 JSON store 试点模式下不阻塞本轮测试。

## 3. 放行标准

测试通过需同时满足：

- `npm run pilot:check` 执行成功；
- 服务器本机可以访问 `/ready`、`/runtime/config`、`/runtime/network`、`/storage/doctor` 和 `/pilot/readiness`；
- 至少 2 台局域网客户端可以打开首页并完成核心流程；
- 试点访问码启用后，未输入访问码不能执行数据修改操作；
- 项目、工作包、审核、风险、阶段门、通知、审计和导出主流程无阻塞缺陷；
- 创建检查点、恢复检查点或 `.bak` 备份恢复路径至少验证一种；
- `/tmp/hardware-flow-pilot-archive` 可以生成，且关键 Markdown/JSON 文件齐全；
- 未出现数据损坏、服务崩溃、阶段门错误放行或无法回滚的问题。

缺陷分级：

- S1：数据损坏、服务无法启动、阶段门错误放行、无法恢复或安全边界失效；
- S2：核心流程阻塞，包括 Agent 草稿、人工审核、风险处理、阶段门批准、导出失败；
- S3：页面文案、布局、局域网访问提示、非关键导出或体验问题。

S1 必须修复后才能试点；S2 必须修复或有明确绕行方案；S3 可进入反馈台账排入 M7。

## 4. 测试数据准备

首次测试前建议丰富演示数据：

```text
npm run demo:enrich
```

正式测试前创建基线：

```text
cp data/demo-store.json data/demo-store.before-lan-test.json
npm run store:doctor
```

在页面中进入“项目 -> 本地数据状态”，创建一个检查点，标签建议：

```text
lan-test-start
```

## 5. 安装与启动测试

### TC-01 依赖安装

步骤：

1. 在新目录 clone 项目；
2. 执行 `npm install`；
3. 执行 `npm run pilot:check`。

期望结果：

- 依赖安装成功；
- `pilot:check` 成功结束；
- 生成 `/tmp/hardware-flow-pilot-archive`。

通过标准：

- 无 npm 安装失败；
- 无测试失败、构建失败或 store doctor 失败。

### TC-02 本机启动

步骤：

1. 执行 `npm start`；
2. 打开 `http://localhost:3001`；
3. 打开 `http://localhost:3001/ready`。

期望结果：

- 首页正常打开；
- `/ready` 返回 200；
- 页面可以加载项目数据。

### TC-03 局域网启动

步骤：

1. 停止本机启动进程；
2. 执行 `npm run start:lan`；
3. 在服务器上获取内网 IP；
4. 客户端打开 `http://服务器内网IP:3001`；
5. 客户端打开 `http://服务器内网IP:3001/ready`。

期望结果：

- 局域网客户端可以访问首页；
- `/ready` 返回 200；
- 页面“项目 -> 本地数据状态 -> 访问地址”显示推荐访问地址和 LAN 提醒。

### TC-04 端口调整

步骤：

1. 使用其他服务占用 `3001`，或直接改用新端口；
2. 执行 `PORT=3100 npm run start:lan`；
3. 客户端访问 `http://服务器内网IP:3100`。

期望结果：

- 服务在 `3100` 端口正常访问；
- `/runtime/config` 显示实际端口。

## 6. 访问码测试

### TC-05 启用访问码

步骤：

1. 执行 `HARDWARE_FLOW_PILOT_ACCESS_CODE=test-code npm run start:lan`；
2. 客户端打开首页；
3. 不输入访问码，尝试执行数据修改操作；
4. 输入 `test-code` 后再次执行。

期望结果：

- 页面提示输入访问码；
- 未输入或输入错误访问码时，数据修改接口被拒绝；
- 输入正确访问码后，数据读取和修改恢复正常；
- `/runtime/config` 可以看到访问码已启用的配置状态，但不会泄露访问码明文。

## 7. 诊断端点测试

逐项访问：

```text
/health
/ready
/ops/summary
/storage/status
/storage/doctor
/runtime/network
/runtime/config
/metrics
/pilot/readiness
/pilot/launch
/pilot/checklist
/pilot/test-plan
/pilot/feedback-plan
/pilot/feedback-triage
/pilot/m7-readiness
/pilot/m7-backlog
/pilot/m7-backlog.md
```

期望结果：

- `/health`、`/ready` 返回成功状态；
- `/ops/summary` 显示服务、网络、HTTP 错误、store 和下一步动作；
- `/runtime/network` 显示本机 URL、局域网 URL、推荐地址和邀请文本；
- `/storage/doctor` 显示 store 可解析、引用完整性正常；
- `/metrics` 返回 Prometheus 文本；
- 试点相关端点返回 JSON 或 Markdown 内容，且无 500 错误。

## 8. 核心业务流程测试

### TC-06 创建项目

步骤：

1. 在首页创建一个试点项目；
2. 填写项目名称和产品线；
3. 打开项目详情页。

期望结果：

- 项目创建成功；
- 项目出现在列表中；
- 审计记录出现项目创建事件。

### TC-07 配置角色负责人

步骤：

1. 在项目页配置项目经理、测试负责人、质量负责人、阶段门批准人；
2. 保存配置；
3. 刷新页面。

期望结果：

- 负责人配置保存成功；
- 刷新后配置仍存在；
- 待办和试点就绪状态能识别负责人配置。

### TC-08 设置工作包排期

步骤：

1. 进入工作包页；
2. 为当前阶段关键工作包设置截止日期；
3. 保存后进入待办页。

期望结果：

- 工作包排期保存成功；
- 待办页出现对应排期或审核事项；
- 试点演练清单中排期项状态更新。

### TC-09 Agent 草稿生成

步骤：

1. 选择测试计划、测试报告或问题关闭计划工作包；
2. 执行 Agent 同步生成或加入队列后处理；
3. 查看生成结果。

期望结果：

- Agent 生成完成；
- 工作包出现草稿内容；
- 队列状态可见；
- 审计记录可追踪生成动作。

### TC-10 人工审核

步骤：

1. 以对应负责人身份审核工作包；
2. 分别测试批准、要求修改、驳回或有条件批准；
3. 查看待办和通知变化。

期望结果：

- 审核状态正确保存；
- 待办数量变化符合预期；
- 通知能跳转到相关对象；
- 审计记录包含审核动作。

### TC-11 补充阶段门证据

步骤：

1. 为关键工作包补充 URL 或文档编号；
2. 如环境允许，上传本地附件；
3. 打开阶段门审核包。

期望结果：

- 证据保存成功；
- 阶段门审核包中可看到证据；
- 缺少必需证据时阶段门不能批准。

### TC-12 风险闭环

步骤：

1. 创建一个高风险；
2. 设置缓解负责人、截止日期和缓解措施；
3. 完成缓解并关闭风险；
4. 查看阶段门阻塞状态。

期望结果：

- 高风险未处理时阻塞阶段门；
- 缓解完成后阻塞解除；
- 风险记录、待办、通知和审计一致。

### TC-13 阶段门批准

步骤：

1. 确认关键工作包、证据和风险均满足条件；
2. 导出阶段门审核包；
3. 执行阶段门批准；
4. 查看项目阶段变化。

期望结果：

- 未满足条件时不能批准；
- 满足条件后批准成功；
- 项目进入下一阶段；
- 最近一次批准包可导出；
- 审计记录完整。

## 9. 试点总览和反馈闭环测试

### TC-14 试点就绪总览

步骤：

1. 进入“项目 -> 试点就绪总览”；
2. 查看服务状态、本地 store、阶段门阻塞、证据、风险、审计、通知和导出入口；
3. 复制现场简报和建议试点流程。

期望结果：

- 面板状态与当前项目数据一致；
- 未完成必需项明确显示；
- 复制内容可直接粘贴到会议纪要或群消息。

### TC-15 反馈计划和分诊

步骤：

1. 打开 `/pilot/feedback-plan`；
2. 打开 `/pilot/feedback-triage`；
3. 检查优先级、状态流转、负责人和证据要求。

期望结果：

- 反馈字段完整；
- P0/P1/P2/P3 分流规则清晰；
- 能指导真实试点后的问题归档。

### TC-16 M7 readiness 和 backlog

步骤：

1. 打开 `/pilot/m7-readiness`；
2. 打开 `/pilot/m7-backlog`；
3. 打开 `/pilot/m7-backlog.md`。

期望结果：

- M7 readiness 能区分已就绪事项和仍需真实操作者反馈的事项；
- backlog 字段包含负责人、Ready 条件和验收证据；
- Markdown 模板可复制到复盘纪要。

## 10. 归档包测试

步骤：

1. 执行 `npm run pilot:archive -- /tmp/hardware-flow-pilot-archive`；
2. 检查以下文件是否存在：

```text
/tmp/hardware-flow-pilot-archive/pilot-archive-index.md
/tmp/hardware-flow-pilot-archive/pilot-handoff-walkthrough.md
/tmp/hardware-flow-pilot-archive/pilot-m6-closeout.md
/tmp/hardware-flow-pilot-archive/pilot-feedback-ledger.md
/tmp/hardware-flow-pilot-archive/pilot-m7-backlog.md
/tmp/hardware-flow-pilot-archive/pilot-deployment-drill.md
/tmp/hardware-flow-pilot-archive/pilot-ops-alerts.md
/tmp/hardware-flow-pilot-archive/pilot-rollback-card.md
/tmp/hardware-flow-pilot-archive/pilot-archive-manifest.json
```

期望结果：

- 文件全部生成；
- `pilot-archive-index.md` 能指导非开发同事找到材料；
- `pilot-archive-manifest.json` 记录项目、阶段门、阻塞项、检查清单、运维摘要和 PostgreSQL 导入包状态。

## 11. 数据保护和回滚测试

### TC-17 检查点恢复

步骤：

1. 在“项目 -> 本地数据状态”创建检查点；
2. 修改一个非关键字段，例如通知已读或工作包排期；
3. 从页面恢复刚才的检查点；
4. 刷新页面。

期望结果：

- 检查点创建成功；
- 恢复后数据回到检查点状态；
- 恢复前当前文件被保留为 `.pre-restore-*.bak`。

### TC-18 `.bak` 恢复

步骤：

1. 停止服务；
2. 执行 `npm run store:doctor`；
3. 执行 `npm run store:restore-backup`；
4. 重新启动服务并访问 `/ready`。

期望结果：

- store doctor 能报告当前状态；
- restore-backup 可以从 `.bak` 恢复；
- 恢复后 `/ready` 返回 200。

## 12. 异常和兼容测试

### TC-19 防火墙或非 LAN 模式

步骤：

1. 使用 `npm start` 启动；
2. 客户端尝试访问 `http://服务器内网IP:3001`；
3. 打开 `/runtime/network`。

期望结果：

- 客户端可能无法访问；
- `/runtime/network` 或页面访问地址区域提示当前只监听本机地址；
- 改用 `npm run start:lan` 后恢复。

### TC-20 错误访问码

步骤：

1. 启用访问码；
2. 客户端输入错误访问码；
3. 执行数据修改操作。

期望结果：

- 请求被拒绝；
- 页面显示可理解的错误；
- 响应包含 `x-request-id`，便于上报。

### TC-21 多客户端同时操作

步骤：

1. 两台客户端同时打开同一项目；
2. 一台修改工作包排期；
3. 另一台执行审核或风险更新；
4. 刷新双方页面。

期望结果：

- 操作可以保存；
- 刷新后双方看到一致数据；
- 无 500 错误或数据损坏。

## 13. 测试记录模板

每个缺陷建议记录：

```text
缺陷编号：
发现时间：
测试人：
设备/浏览器：
访问地址：
服务版本：
请求 ID：
用例编号：
复现步骤：
实际结果：
期望结果：
影响范围：
严重级别：S1 / S2 / S3
截图或日志：
是否需要回滚：
处理结论：
```

试点反馈进入：

```text
/tmp/hardware-flow-pilot-archive/pilot-feedback-ledger.md
```

计划进入 M7 的事项再整理到：

```text
/tmp/hardware-flow-pilot-archive/pilot-m7-backlog.md
```

## 14. 测试完成报告

测试结束后输出一页结论：

```text
测试日期：
测试版本/Git 提交：
服务器主机：
局域网访问地址：
参与客户端数量：
执行用例数量：
通过数量：
失败数量：
阻塞数量：
S1 数量：
S2 数量：
S3 数量：
是否建议进入内部试点：是 / 否 / 有条件
有条件放行说明：
必须修复项：
M7 后续项：
归档包路径：
负责人签字：
```

建议只有在没有 S1，且 S2 均已修复或具备明确绕行方案时，才进入真实内部试点。
