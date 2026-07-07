# 2026-07-07 工程冻结记录

本记录冻结当前 M5/M6 连续开发批次，作为提交、PR 或真实交接走查前的复核入口。

## 冻结范围

本批次包含两类工作：

- M5 PostgreSQL 增量事务收尾：补齐关键写入路径的原生 PostgreSQL 增量事务、运行时持久化意图分类和相关回归测试。
- M6 内部试点发布固化：补齐试点归档包、部署演练、反馈台账、试点范围、运维告警、归档总目录、交接走查、M6 收尾判定和完成安排。
- M7 反馈闭环启动：补齐反馈计划、反馈分诊、M7 backlog JSON/Markdown 入口，以及离线归档包中的 M7 backlog 模板。

## 关键交付物

代码：

- `apps/api/src/postgresIncrementalTransaction.mjs`
- `apps/api/src/runtimePersistence.mjs`
- `apps/api/src/server.mjs`
- `apps/api/src/pilotArchive.mjs`
- `apps/api/src/pilotPlan.mjs`

测试：

- `apps/api/src/postgresIncrementalTransaction.test.mjs`
- `apps/api/src/runtimePersistence.test.mjs`
- `apps/api/src/server.test.mjs`
- `apps/api/src/pilotArchive.test.mjs`

文档：

- `README.md`
- `docs/internal-pilot.md`
- `docs/lan-deployment.md`
- `docs/completion-plan.md`
- `roadmap.md`
- `docs/superpowers/plans/2026-07-02-pilot-deployment-drill-artifacts.md`
- `docs/superpowers/plans/2026-07-02-pilot-feedback-ledger-artifacts.md`
- `docs/superpowers/plans/2026-07-02-pilot-trial-scope-artifacts.md`
- `docs/superpowers/plans/2026-07-04-pilot-archive-index-artifacts.md`
- `docs/superpowers/plans/2026-07-04-pilot-ops-alert-artifacts.md`
- `docs/superpowers/plans/2026-07-06-pilot-handoff-walkthrough-artifacts.md`
- `docs/superpowers/plans/2026-07-06-pilot-m6-closeout-artifacts.md`
- `docs/superpowers/plans/2026-07-07-pilot-archive-index-closeout-navigation.md`
- `docs/superpowers/plans/2026-07-07-pilot-feedback-plan-endpoint.md`
- `docs/superpowers/plans/2026-07-07-pilot-feedback-triage-endpoint.md`
- `docs/superpowers/plans/2026-07-07-pilot-m7-backlog-endpoint.md`
- `docs/superpowers/plans/2026-07-07-pilot-m7-backlog-markdown.md`
- `docs/superpowers/plans/2026-07-07-pilot-m7-backlog-archive-artifacts.md`

## 生成归档包

当前内部试点归档包路径：

```text
/tmp/hardware-flow-pilot-archive
```

必须存在的收尾入口：

- `/tmp/hardware-flow-pilot-archive/pilot-archive-index.md`
- `/tmp/hardware-flow-pilot-archive/pilot-handoff-walkthrough.md`
- `/tmp/hardware-flow-pilot-archive/pilot-m6-closeout.md`
- `/tmp/hardware-flow-pilot-archive/pilot-feedback-ledger.md`
- `/tmp/hardware-flow-pilot-archive/pilot-m7-backlog.md`

## 冻结验证

冻结前必须通过：

```text
npm run pilot:check
git diff --check
```

`npm run pilot:check` 覆盖：

- API 测试
- React 构建
- smoke 测试
- store doctor
- runtime persistence check
- PostgreSQL migration/schema/export/import bundle/sync 预览链路
- pilot rehearsal
- pilot archive generation
- PostgreSQL preflight

## 当前结论

工程侧结论：可以进入真实交接走查。

M6 尚未标记为 `Done` 的唯一原因是外部验收未完成：需要一名非核心开发同事按 `pilot-handoff-walkthrough.md` 执行真实走查，并在 `pilot-m6-closeout.md` 中填写 `PASS` 或 `PASS_WITH_NOTES`。

## 后续动作

1. 提交或创建 PR，冻结当前批次。
2. 安排真实交接走查。
3. 走查通过后将 `roadmap.md` 中 M6 改为 `Done`。
4. 将真实试点反馈转入 `pilot-feedback-ledger.md` 和 `pilot-m7-backlog.md`。
