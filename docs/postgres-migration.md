# PostgreSQL 迁移计划

当前试用版使用 `data/demo-store.json` 保存完整流程状态。迁移到 PostgreSQL 时，先保持 API 行为不变，只替换持久化层。

## 第一阶段：表结构落地

- 以 `schemas/database.sql` 建库，先覆盖当前 JSON store 中已经出现的实体。
- `migrations/001_initial_schema.sql` 是第一版可执行迁移文件，当前必须与 `schemas/database.sql` 保持一致。
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
- 当前已提供 `npm run db:export-seed`，可生成面向 PostgreSQL schema 的幂等 SQL 种子文件。该文件使用延迟外键事务和主键 upsert，适合验证 schema 与 JSON store 的字段映射。
- 当前已提供 `npm run db:export-report`，可只输出 PostgreSQL 导出诊断报告，不写 rows 或 SQL 文件；适合在导入前快速确认 `valid: true`、表行数和错误列表。
- 当前已提供 `npm run db:schema-check`，可在没有 PostgreSQL 服务的情况下校验：
  - `schemas/database.sql` 的表/列是否被 rows 映射覆盖；
  - `not null` 和主键列是否会被导出为非空值；
  - rows 内部常见外键引用是否能找到目标记录。
- 当前已提供 `npm run db:migration-check`，可校验第一版迁移文件没有和 `schemas/database.sql` 漂移。

## 当前导出约束

- JSON 中没有显式 `workPackageId` 的阶段门条件，会按同项目、同阶段、同交付物类型解析到目标工作包，再写入 `gate_requirements.work_package_id`。
- 旧 JSON 缺少 `createdAt/updatedAt` 时，PostgreSQL rows 会使用 `1970-01-01T00:00:00.000Z` 作为迁移占位时间，便于识别历史补齐字段。
- 旧角色配对缺少 Agent 权限级别时，PostgreSQL rows 会使用 `L1_DRAFT`，与当前 Agent 只能生成草稿的产品约束一致。

## 第四阶段：运行约束

- 阶段门批准、工作包审核、风险处置必须放入事务。
- 审计事件与业务状态更新必须在同一事务提交。
- Agent 运行状态和交付物版本写入必须幂等，避免任务重试生成重复正式记录。
- 通知生成可以在业务事务内写入站内通知，外部通知后续再由通知网关异步发送。
