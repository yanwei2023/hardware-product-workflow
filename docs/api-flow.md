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
| `GET` | `/storage/status` | 查看当前 JSON 存储文件与项目统计 |
| `POST` | `/demo/reset` | 重置演示数据 |
| `GET` | `/projects/demo` | 查看演示项目状态 |
| `GET` | `/projects/:id/snapshot` | 导出项目快照 JSON |
| `GET` | `/projects/:id/snapshot.md` | 导出项目快照 Markdown |
| `POST` | `/projects/import/validate` | 导入项目前校验快照结构与引用完整性 |
| `POST` | `/projects/import` | 安全导入通过校验且不冲突的项目快照 |
| `POST` | `/projects/:id/clone` | 复制已有项目并自动切换到副本 |
| `GET` | `/work-packages/:id/export.md` | 导出单个工作包 Markdown，包含交付物、模板校验和审核记录 |
| `POST` | `/agent-runs` | 模拟 Agent 执行工作包 |
| `POST` | `/reviews` | 提交人类审核结果 |
| `POST` | `/risks/:id/accept` | 人类接受风险 |
| `POST` | `/risks/:id/close` | 人类关闭风险 |
| `GET` | `/gates/:id/check` | 检查阶段门是否可通过 |
| `GET` | `/gates/:id/review-pack` | 查看阶段门审核包、证据状态、风险和阻塞项 |
| `GET` | `/gates/:id/review-pack.md` | 导出阶段门审核包 Markdown |
| `GET` | `/users/:id/action-items` | 查看指定用户在当前项目中的待办 |

## 强制规则

- Agent 只能生成草稿和发现项，不能批准工作包。
- 人类审核通过后，交付物才算正式可用于阶段门。
- 人类要求修改或驳回后，原待审草稿不能继续作为待审交付物。
- 高风险未关闭或未接受时，阶段门必须阻塞。
- 阶段门检查结果必须明确列出阻塞原因。
- JSON 请求体格式错误必须返回 `400`，不能作为服务器错误处理。
- 项目快照导入必须先通过结构与引用完整性校验，且不能覆盖已有项目 ID。
- 项目复制必须生成新的项目 ID，并写入 `PROJECT_CLONED` 审计事件。
- 工作包 Markdown 导出必须带上最新交付物、模板校验结果、审核记录和 Agent 草稿，便于离线归档。
