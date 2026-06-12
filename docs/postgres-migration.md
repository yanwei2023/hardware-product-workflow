# PostgreSQL 迁移计划

当前试用版使用 `data/demo-store.json` 保存完整流程状态。迁移到 PostgreSQL 时，先保持 API 行为不变，只替换持久化层。

## 第一阶段：表结构落地

- 以 `schemas/database.sql` 建库，先覆盖当前 JSON store 中已经出现的实体。
- `migrations/001_initial_schema.sql` 是第一版可执行迁移文件，当前必须与 `schemas/database.sql` 保持一致。
- 保留 `jsonb` 字段存储交付物内容、Agent 校验结果、阶段门审核包快照和审计 payload。
- 所有正式状态流转仍由流程引擎负责，数据库只做持久化和查询索引。

## 第二阶段：Repository 层

将 `apps/api/src/server.mjs` 中直接读写 `store.*` 的代码逐步替换为 Repository：

- 当前已建立 `apps/api/src/storeRepository.mjs` 作为只读 Repository 起点，已覆盖当前项目视图、用户待办视图、项目聚合 read model、项目列表摘要、项目快照、风险台账、阶段门就绪检查、阶段门评审包、阶段门批准包、通知列表和工作包详情，不改变现有 JSON 持久化行为。
- 当前已补充项目、阶段、阶段门、角色配对、工作包、Agent 任务、审核、风险和通知的基础定位 helper，后续写入 Repository 可复用这些入口，减少服务层直接扫描 JSON store。
- 当前已开始迁移写入 helper：项目图谱批量新增、审计事件新增、通知新增、项目选择/归档/恢复、阶段门就绪状态同步、阶段门批准推进、阶段门批准包新增、通知单条已读、用户项目通知批量已读、角色配对负责人更新、工作包排期更新、工作包证据引用新增、Agent 任务排队/开始/完成、Agent 输出记录、人工审核提交、审核条件完成、风险新增、风险状态更新、风险缓解计划更新/完成已由 Repository 层执行，服务层仍负责权限校验、审计/通知、持久化提交和响应组装。
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
- 当前已提供 `npm run db:prepare-import -- /tmp/hardware-flow-postgres-import`，可一次性生成 rows JSON、seed SQL、report JSON 和 manifest。manifest 中包含基于 `DATABASE_URL` 的 `psql` 建表与导入命令。
- 当前已提供 `npm run db:verify-import-bundle -- /tmp/hardware-flow-postgres-import`，可在不连接数据库的情况下检查导入包文件完整性、report 是否有效、seed SQL 是否包含事务和幂等 upsert。
- 当前已提供 `npm run db:preflight -- /tmp/hardware-flow-postgres-import`，可检查 `DATABASE_URL`、本机 `psql` 客户端和导入包完整性。默认只输出 `ready/blockers`，不会因为未配置数据库而失败；需要在部署脚本中强制失败时追加 `--strict`。
- 当前已提供 `npm run db:import -- /tmp/hardware-flow-postgres-import` 预览实际导入计划；只有追加 `--confirm` 才会按 schema、seed 顺序调用 `psql`。执行时启用 `ON_ERROR_STOP`，schema 失败不会继续写入 seed，输出中的数据库密码保持脱敏；seed 完成后会查询各表行数并与 manifest 比对，不一致时导入仍判定失败。
- `db:import` 预览会写入 `postgres-import-preview.json`，确认执行会写入 `postgres-import-result.json`，避免后续预览覆盖正式导入证据。报告记录脱敏数据库目标、bundle、执行阶段和计数结果；确认导入后使用 `npm run db:verify-import-result -- /tmp/hardware-flow-postgres-import/postgres-import-result.json` 独立复核报告与原始 manifest 是否一致。
- 当前已提供 `npm run db:schema-check`，可在没有 PostgreSQL 服务的情况下校验：
  - `schemas/database.sql` 的表/列是否被 rows 映射覆盖；
  - `not null` 和主键列是否会被导出为非空值；
  - rows 内部常见外键引用是否能找到目标记录。
- 当前已提供 `npm run db:migration-check`，可校验第一版迁移文件没有和 `schemas/database.sql` 漂移。
- 当前已提供 PostgreSQL rows 到运行时 JSON store 的完整反向映射。`npm run db:restore-store -- /tmp/hardware-flow-postgres-import/postgres-rows.json` 只预览并执行 store doctor 引用校验，追加 `--confirm` 后才原子写入当前 store，并保留原文件 `.bak`；可用 `--output` 和 `--active-project` 指定目标文件与活动项目。
- 当前已提供 PostgreSQL 实时只读桥接。配置 `DATABASE_URL` 后，`npm run db:export-live-rows -- /tmp/postgres-live-rows.json` 会通过单条只读查询导出所有映射表，执行 schema、必填字段和引用校验后才写入快照；`npm run db:pull-store` 会直接把同一份数据库读取结果反向映射为运行时 store，默认仅预览，追加 `--confirm` 才写盘并保留 `.bak`。
- 当前已提供 JSON store 与 PostgreSQL 的逐行一致性审计。`npm run db:compare-store -- --report /tmp/postgres-store-comparison.json --strict` 会归一化时间戳与 JSON 对象键顺序，再按表、主键和字段报告数据库缺失、store 缺失及内容变化；`--strict` 在发现漂移时返回非零状态。`npm run db:verify-store-comparison -- /tmp/postgres-store-comparison.json` 可独立复核报告完整性、汇总统计和同步结论。
- 当前已提供受控精确镜像同步。`npm run db:sync-store -- /tmp/postgres-store-sync` 只生成事务 SQL 和预览报告；追加 `--confirm` 后才执行全表 upsert，并按反向依赖顺序删除数据库独有行。同步使用 PostgreSQL advisory transaction lock，执行后立即重读全部映射表并逐字段比较；`npm run db:verify-store-sync -- /tmp/postgres-store-sync/postgres-store-sync-result.json` 可独立复核执行证据和 SQL 护栏。
- `db:sync-store --confirm` 会删除不在当前 JSON store 中的数据库记录，只能在停止应用写入、已创建 store 检查点且预览 SQL 完成评审的维护窗口执行。它是从 JSON 主存向 PostgreSQL 迁移的过渡工具，不是长期双写实现。
- 当前 API 支持显式 PostgreSQL 启动快照源。`HARDWARE_FLOW_STARTUP_STORE_SOURCE=postgres` 会在监听端口前读取全部映射表、反向构建 store 并执行 doctor 校验，失败时拒绝启动；`postgres-fallback` 会在失败时降级到 JSON，并通过运行状态暴露降级原因。可用 `HARDWARE_FLOW_POSTGRES_ACTIVE_PROJECT_ID` 指定活动项目，不存在时严格失败。
- 启动快照加载成功后会物化到 `HARDWARE_FLOW_STORE_PATH`，本进程后续写入仍以 JSON 文件为准。该模式用于验证 PostgreSQL 数据可被真实 API 读取，不是在线 PostgreSQL 读写切换；切换前必须先运行严格一致性比较。
- 实时读取命令不会在报告中保留查询结果、数据库 URL 或密码。当前桥接用于迁移核验、回滚与灾备演练，不会把 API 的在线写入源切换为 PostgreSQL。
- `npm run check` 会把导出的 rows 反向恢复到 `/tmp`、运行 store doctor，并通过 `store:runtime-check` 动态加载服务模块、构建活动项目 read model 和执行当前阶段门检查，验证恢复数据不仅结构合法，而且能被真实运行时读取。

## 当前导出约束

- JSON 中没有显式 `workPackageId` 的阶段门条件，会按同项目、同阶段、同交付物类型解析到目标工作包，再写入 `gate_requirements.work_package_id`。
- 旧 JSON 缺少 `createdAt/updatedAt` 时，PostgreSQL rows 会使用 `1970-01-01T00:00:00.000Z` 作为迁移占位时间，便于识别历史补齐字段。
- 旧角色配对缺少 Agent 权限级别时，PostgreSQL rows 会使用 `L1_DRAFT`，与当前 Agent 只能生成草稿的产品约束一致。

## 手工验证导入包

```text
npm run db:prepare-import -- /tmp/hardware-flow-postgres-import
npm run db:verify-import-bundle -- /tmp/hardware-flow-postgres-import
npm run db:preflight -- /tmp/hardware-flow-postgres-import
export DATABASE_URL=postgres://user:password@localhost:5432/hardware_flow
npm run db:preflight -- /tmp/hardware-flow-postgres-import --strict
npm run db:import -- /tmp/hardware-flow-postgres-import
npm run db:import -- /tmp/hardware-flow-postgres-import --confirm
npm run db:verify-import-result -- /tmp/hardware-flow-postgres-import/postgres-import-result.json
npm run db:restore-store -- /tmp/hardware-flow-postgres-import/postgres-rows.json
npm run db:restore-store -- /tmp/hardware-flow-postgres-import/postgres-rows.json --confirm
npm run db:export-live-rows -- /tmp/hardware-flow-postgres-live-rows.json
npm run db:pull-store
npm run db:pull-store -- --output /tmp/hardware-flow-live-store.json --confirm
npm run db:compare-store -- --report /tmp/hardware-flow-postgres-comparison.json --strict
npm run db:verify-store-comparison -- /tmp/hardware-flow-postgres-comparison.json
npm run db:sync-store -- /tmp/hardware-flow-postgres-store-sync
npm run db:sync-store -- /tmp/hardware-flow-postgres-store-sync --confirm
npm run db:verify-store-sync -- /tmp/hardware-flow-postgres-store-sync/postgres-store-sync-result.json
HARDWARE_FLOW_STARTUP_STORE_SOURCE=postgres npm start
HARDWARE_FLOW_STARTUP_STORE_SOURCE=postgres-fallback npm start
```

导入前先查看 `/tmp/hardware-flow-postgres-import/postgres-export-report.json`，必须确认 `valid: true` 且 `errors: []`。

## 第四阶段：运行约束

- 阶段门批准、工作包审核、风险处置必须放入事务。
- 审计事件与业务状态更新必须在同一事务提交。
- Agent 运行状态和交付物版本写入必须幂等，避免任务重试生成重复正式记录。
- 通知生成可以在业务事务内写入站内通知，外部通知后续再由通知网关异步发送。
