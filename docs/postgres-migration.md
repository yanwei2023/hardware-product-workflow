# PostgreSQL 迁移计划

当前试用版使用 `data/demo-store.json` 保存完整流程状态。迁移到 PostgreSQL 时，先保持 API 行为不变，只替换持久化层。

## 第一阶段：表结构落地

- 以 `schemas/database.sql` 建库，先覆盖当前 JSON store 中已经出现的实体。
- 保留 `jsonb` 字段存储交付物内容、Agent 校验结果、阶段门审核包快照和审计 payload。
- 所有正式状态流转仍由流程引擎负责，数据库只做持久化和查询索引。

## 第二阶段：Repository 层

将 `apps/api/src/server.mjs` 中直接读写 `store.*` 的代码逐步替换为 Repository：

- `ProjectRepository`
- `WorkPackageRepository`
- `ReviewRepository`
- `RiskRepository`
- `GateRepository`
- `NotificationRepository`
- `AuditRepository`

替换顺序优先从只读查询开始：项目快照、风险台账、工作包详情、通知列表。确认查询稳定后，再迁移写入接口。

## 第三阶段：兼容导入

- 保留 `/projects/:id/snapshot` 作为数据备份出口。
- 新增一次性导入脚本，把现有 JSON store 写入 PostgreSQL。
- 导入脚本必须先复用现有快照校验规则，避免破坏引用完整性。
- 当前已提供 `npm run db:export-rows`，可先把 JSON store 导出为与 PostgreSQL 表名一致的 rows JSON，用于校验字段覆盖和后续批量导入。
- 当前已提供 `npm run db:export-seed`，可生成面向空 PostgreSQL schema 的 SQL 种子文件。该文件使用延迟外键事务，适合验证 schema 与 JSON store 的字段映射。

## 第四阶段：运行约束

- 阶段门批准、工作包审核、风险处置必须放入事务。
- 审计事件与业务状态更新必须在同一事务提交。
- Agent 运行状态和交付物版本写入必须幂等，避免任务重试生成重复正式记录。
- 通知生成可以在业务事务内写入站内通知，外部通知后续再由通知网关异步发送。
