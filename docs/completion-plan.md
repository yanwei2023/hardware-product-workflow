# 项目完成安排

本文档用于把当前连续开发工作收束为可交付状态。目标不是继续扩功能，而是尽快完成内部试点发布闭环。

## 当前判断

- M0-M5 已完成基础验证，`roadmap.md` 中均已进入 `Done`。
- M6 处于收尾阶段，代码和归档材料已经覆盖发布候选包、局域网部署、回滚、运维告警、交接走查、反馈台账和 M6 收尾判定。
- M7 仍保持 `Planned`，不应阻塞 M6 发布；M7 只接收真实试点后产生的反馈和增强项。

## 最短完成路径

### 1. 冻结当前开发批次

目标：把当前 M5/M6 连续开发从“工作区变更”变成可复核交付。

动作：

1. 运行 `npm run pilot:check`。
2. 运行 `git diff --check`。
3. 检查 `git status --short`，确认只包含本批次相关文件。
4. 生成并保留 `/tmp/hardware-flow-pilot-archive`。
5. 将本批次变更整理为一次提交或 PR。

完成标准：

- `npm run pilot:check` 通过。
- 没有空白 diff 问题。
- 试点归档包包含 `pilot-archive-index.md`、`pilot-handoff-walkthrough.md`、`pilot-m6-closeout.md`、`pilot-feedback-ledger.md` 和 `pilot-m7-backlog.md`。

### 2. 执行 M6 真实交接走查

目标：验证非核心开发同事能按材料完成试点部署和故障处理路径。

动作：

1. 让操作者先打开 `/tmp/hardware-flow-pilot-archive/pilot-archive-index.md`。
2. 按 `pilot-handoff-walkthrough.md` 完成入口、启动前检查、现场报错、回滚路径和复盘记录走查。
3. 按 `pilot-deployment-drill.md` 留存 `/ready`、`/ops/summary`、`/runtime/network`、`/runtime/config` 和 `/storage/doctor` 结果。
4. 按 `pilot-m6-closeout.md` 填写结论。

完成标准：

- 结论为 `PASS` 或 `PASS_WITH_NOTES`。
- 若为 `PASS_WITH_NOTES`，备注只能是材料措辞、操作者熟悉度或待确认用户范围，不能是无法启动、无法回滚或数据风险。

### 3. 关闭 M6

目标：把 M6 从 `In Progress` 收束为 `Done`。

动作：

1. 将 `roadmap.md` 中 M6 状态改为 `Done`。
2. 在推进记录中追加 M6 关闭记录。
3. 把 `pilot-m6-closeout.md` 中遗留的真实试点反馈转入 `pilot-feedback-ledger.md`，并把 `PLANNED` 项整理到 `pilot-m7-backlog.md`。
4. 保留 `docs/internal-pilot.md` 和 `docs/lan-deployment.md` 作为 M6 发布材料入口。

完成标准：

- M6 验收标准全部有材料支撑。
- 真实试点前必须确认的事项只剩“首批用户范围”和“试点时间”，不再有工程阻塞。

### 4. 启动 M7

目标：只处理真实试点暴露出的产品化增强，不再回头扩 M6。

默认进入 M7 的事项：

- 反馈台账中的 P0/P1。
- 权限模型细化。
- 仪表盘和报表增强。
- Agent 任务队列真实化。
- 试点中发现的高频部署或操作问题。

## 当前未决事项

| 事项 | 当前处理 |
| --- | --- |
| 内部试点首批用户范围 | 由试点负责人确认部门、人数和项目类型；不阻塞工程冻结。 |
| PostgreSQL 是否作为默认运行后端 | M6 默认仍使用 JSON store；PostgreSQL 只作为迁移验证和可选严格演练。 |
| 真实 Agent 任务队列 | 放入 M7，不阻塞 M6。 |
| 权限模型细化 | M7 处理；M6 保持角色级权限和审核责任边界。 |

## 建议完成顺序

1. 今天完成当前工作区冻结和提交准备。
2. 下一次操作只做真实交接走查，不再追加 M6 新材料。
3. 走查结论为 `PASS` 或 `PASS_WITH_NOTES` 后，立即关闭 M6。
4. 关闭 M6 后再进入 M7。
