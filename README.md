# 人机协同硬件开发流程系统

这是一个面向公司内部局域网部署的硬件产品开发流程管理系统骨架。

系统的核心规则很明确：

- Agent 负责执行工作包、生成草稿、检查遗漏、准备证据。
- 人类负责审核、修改、批准、驳回，并承担最终责任。
- 后台流程引擎控制项目状态；必要步骤、交付物、审核或证据缺失时，阶段门必须被卡住。

## 仓库结构

```text
apps/web       React API 工作台
apps/api       后台流程引擎
agents/worker  Agent 执行 worker 骨架
docs           产品、流程、架构文档
schemas        共享领域模型与数据库草案
infra          本地部署配置
```

## 第一阶段目标

先搭建最小可运行的流程主干：

1. 根据硬件开发阶段模板创建项目。
2. 自动生成每个阶段必需的工作包。
3. 让 Agent 生成草稿、检查结果和风险发现。
4. 将 Agent 输出路由给对应人类负责人审核。
5. 在必要审批和证据齐全前，阶段门保持阻塞。
6. 对每一次 Agent 行为和人类决策写入审计记录。

## 本地开发

本地 API 与静态工作台可以直接启动：

```text
npm start
```

局域网试用：

```text
npm run start:lan
```

开发脚本：

```text
npm --workspace apps/api run demo
npm run demo:multi-phase
npm run dev:web
npm run web:build
npm run agent:sample
```

本地基础设施：

```text
cd infra
docker compose up -d
```

## 快速试用

当前已有无外部依赖的本地试用版：

```text
node apps/api/src/server.mjs
```

然后访问静态工作台：

```text
http://localhost:3001
```

React 工作台开发模式：

```text
npm start
npm run dev:web
```

然后访问：

```text
http://localhost:5173
```

详细说明见：

```text
docs/quick-use.md
docs/lan-deployment.md
docs/internal-pilot.md
docs/postgres-migration.md
```

## 当前骨架

- `schemas/domain.ts` 定义共享流程模型。
- `schemas/agent-registry.json` 定义第一版角色 Agent 配置草案。
- `schemas/hardware-phase-template.json` 定义第一版硬件开发阶段模板。
- `apps/api/src/gateEngine.ts` 检查阶段门是阻塞还是可通过。
- `apps/api/src/artifactValidator.mjs` 检查 Agent 输出是否满足交付物模板要求。
- `apps/api/src/server.mjs` 提供本地可运行 API、静态工作台、项目快照、阶段门、审核、风险、通知和导入导出链路。
- `Dockerfile` 构建生产镜像时会先构建 React 工作台，并由 API 服务优先托管 `apps/web/dist`；未构建时本地仍回退到 `apps/static`。
- `/health` 用于 API 活性检查，`/ready` 会同时校验当前 store 文件，可作为容器 healthcheck。
- `/runtime/config` 暴露非敏感运行配置，用于部署后确认端口、store 路径和当前静态资源模式。
- `/metrics` 暴露 Prometheus 文本格式的轻量运行指标，覆盖 ready、关停状态、进程 uptime、内存、HTTP 计数、4xx/5xx、响应耗时和当前项目业务状态。
- API 响应会带 `x-service-version` 和 `x-request-id`，便于把前端问题、访问日志和后端响应关联起来。
- `HARDWARE_FLOW_ACCESS_LOG=0` 可关闭 JSON 访问日志；默认开启。
- `HARDWARE_FLOW_MAX_JSON_BODY_BYTES` 可调整 JSON 请求体大小上限；默认 `1048576` bytes。
- `HARDWARE_FLOW_REQUEST_TIMEOUT_MS` 可调整单个 HTTP 请求超时；默认 `120000` ms。
- `apps/static` 提供无构建依赖的本地工作台，保留错误请求 ID 提示、备份恢复和检查点回滚入口。
- `apps/web/src/App.tsx` 提供真实 API 驱动的 React 工作台，覆盖总览、项目、项目快照导入、本地数据运维、演示数据重置、角色负责人配置、工作包计划/证据/审核、阶段门审核包、风险台账、待办、通知和审计主流程。
- `agents/worker/worker.py` 展示受控 Agent 输出协议。
- `schemas/database.sql` 定义当前 PostgreSQL 目标表结构。
- `migrations/001_initial_schema.sql` 提供第一版可执行 PostgreSQL 初始化迁移。
- `apps/api/src/postgresMapper.mjs`、`postgresExportReport.mjs`、`postgresImportBundle.mjs`、`postgresImporter.mjs` 和相关 CLI 脚本提供 JSON store 到 PostgreSQL rows/seed SQL、导入包、自检、preflight、受控执行、导入后表计数校验和可独立复核的脱敏结果报告。
- `npm run release:check` 会执行完整测试、前端构建、smoke、store doctor、PostgreSQL 迁移/导出/导入包校验和 diff 空白检查，适合提交或发布前运行。
- `npm run pilot:check` 会在 `release:check` 后追加 PostgreSQL 导入包 preflight，适合每次内部试点前运行。
- Docker Compose 会等待 PostgreSQL 健康，并让应用容器具备执行数据库迁移、门禁和镜像写入所需的连接串与 `psql` 客户端；API 默认运行时仍使用 JSON store。
- PostgreSQL rows 支持完整反向映射为 JSON store；`db:restore-store` 默认预览并校验，只有显式确认才原子写入并保留备份。配置 `DATABASE_URL` 后，`db:export-live-rows` 可生成经过校验的数据库快照，`db:pull-store` 可直接预览或确认恢复运行时 store，`db:compare-store` 与独立复核命令可在读源切换前阻止数据漂移。
- `db:sync-store` 提供 JSON 主存到 PostgreSQL 的受控精确镜像预演和确认执行：事务内 upsert、反向依赖清理、advisory lock、写后全量比较和独立结果复核；确认模式会删除数据库独有行，只用于迁移维护窗口。
- `HARDWARE_FLOW_STARTUP_STORE_SOURCE=postgres` 可在 API 启动前从 PostgreSQL 加载并校验运行时快照；`postgres-fallback` 支持带降级告警的 JSON 回退。默认运行期写入后端为 JSON，并会在状态接口明确暴露。
- `HARDWARE_FLOW_RUNTIME_WRITE_MODE=auto` 默认把 PostgreSQL 启动快照置为只读，HTTP 门禁与 React 工作台共同阻止修改，并导出 `hardware_flow_runtime_writable` 指标。
- `HARDWARE_FLOW_RUNTIME_PERSISTENCE_BACKEND=postgres-mirror` 提供严格的运行时镜像写入：JSON 原子落盘后执行 PostgreSQL 精确镜像和全量写后校验；失败时恢复上一份 JSON 与内存状态并返回 503。PostgreSQL 启动快照只有显式配置该后端后才允许 `read-write`。
- `npm run runtime:persistence-check` 可在 API 启动前独立执行持久化门禁；`postgres-mirror` 会只读比较完整 JSON store 与数据库，缺连接、读取失败或任一表漂移都会返回非零状态，API 启动时也执行同一门禁并失败关闭。
- 角色负责人变更、工作包计划日期更新、人工审核提交、风险接受/关闭、风险缓解计划更新、缓解完成和阶段门批准已接入原生 PostgreSQL 增量事务链路：业务状态、审计事件和站内通知在同一事务提交，并执行全表写后校验；校验漂移时运行补偿事务恢复旧值并删除本次审计/通知/批准包。其他业务写入暂时继续使用精确镜像。
