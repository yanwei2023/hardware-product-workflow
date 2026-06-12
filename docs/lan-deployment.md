# 内部局域网部署说明

当前版本是最小可运行原型，适合在公司内网或单台开发机上试用流程主干。

## 适用场景

- 多台电脑访问同一个演示服务；
- 项目经理、工程师、质量负责人在浏览器中试用同一套流程；
- 验证 Agent 生成、人工审核、阶段门卡点、审计记录是否符合预期。

## 本机启动

在项目根目录执行：

```text
npm start
```

默认地址：

```text
http://localhost:3001
```

## 局域网启动

如果需要让同一局域网内的其他电脑访问：

```text
npm run start:lan
```

然后查看本机内网 IP，例如 macOS 可在系统网络设置中查看。其他电脑访问：

```text
http://本机内网IP:3001
```

例如：

```text
http://192.168.1.20:3001
```

## 试点访问码

局域网试点建议设置轻量访问码，避免同网段成员直接打开页面：

```text
HARDWARE_FLOW_PILOT_ACCESS_CODE=your-code npm run start:lan
```

启用后：

- 静态页面、`/health`、`/ready`、`/runtime/config` 和 `/runtime/network` 仍可公开访问；
- 数据接口、导出、审核、风险和阶段门操作需要请求头 `x-pilot-access-code`；
- React 工作台和静态备用工作台都会提示输入访问码，并保存在当前浏览器本地。

这只是内部试点保护，不替代正式用户登录、SSO 或细粒度权限审计。

## Docker 启动

如果希望用容器方式运行试用版：

```text
docker build -t hardware-flow .
docker run --rm -p 3001:3001 -v hardware-flow-data:/app/data hardware-flow
```

也可以连同 PostgreSQL、Redis、MinIO 基础设施一起启动：

```text
cd infra
docker compose up --build
```

当前应用容器仍使用 JSON 文件持久化，数据保存在 `app-data` volume 中。PostgreSQL 服务会按 `migrations/` 中的 SQL 初始化，供后续迁移持久化层使用。

应用镜像包含 `psql` 客户端，Compose 会等待 PostgreSQL 健康并向应用容器注入内部 `DATABASE_URL`。需要在容器内验证或执行 JSON store 导入时：

```text
docker compose exec app npm run db:prepare-import -- /tmp/hardware-flow-postgres-import
docker compose exec app npm run db:preflight -- /tmp/hardware-flow-postgres-import --strict
docker compose exec app npm run db:import -- /tmp/hardware-flow-postgres-import
docker compose exec app npm run db:import -- /tmp/hardware-flow-postgres-import --confirm
docker compose exec app npm run db:verify-import-result -- /tmp/hardware-flow-postgres-import/postgres-import-result.json
docker compose exec app npm run db:restore-store -- /tmp/hardware-flow-postgres-import/postgres-rows.json
```

确认导入命令会实际写入 Compose 的 PostgreSQL，并在结束后逐表核对导入行数、生成脱敏结果报告；复核命令会重新对照原始 manifest。当前 API 运行时仍读取 JSON store；这些命令用于验证迁移数据完整性，不会切换线上读写源。

`db:restore-store` 默认只预览 PostgreSQL rows 反向恢复出的 JSON store，并执行引用完整性检查；只有追加 `--confirm` 才会覆盖当前 store，覆盖前会保留 `.bak`。在试点环境执行确认恢复前，应先停止写操作并创建检查点。

数据库完成导入后，也可以直接从 Compose PostgreSQL 生成经过校验的恢复快照，或预览实时反向恢复：

```text
docker compose exec app npm run db:export-live-rows -- /tmp/hardware-flow-postgres-live-rows.json
docker compose exec app npm run db:pull-store
docker compose exec app npm run db:pull-store -- --output /app/data/demo-store.json --confirm
docker compose exec app npm run db:compare-store -- --report /tmp/hardware-flow-postgres-comparison.json --strict
docker compose exec app npm run db:verify-store-comparison -- /tmp/hardware-flow-postgres-comparison.json
docker compose exec app npm run db:sync-store -- /tmp/hardware-flow-postgres-store-sync
docker compose exec app npm run db:sync-store -- /tmp/hardware-flow-postgres-store-sync --confirm
docker compose exec app npm run db:verify-store-sync -- /tmp/hardware-flow-postgres-store-sync/postgres-store-sync-result.json
```

`db:compare-store` 逐表核对当前 JSON store 与数据库，严格模式适合放在导入验收和读源切换前的部署门禁中。`db:sync-store --confirm` 是精确镜像操作，会删除数据库独有行，只能在停止写入、创建检查点并评审预览 SQL 后执行。`db:pull-store` 仍是受控恢复工具，不代表 API 已切换为 PostgreSQL 在线读写。

## 端口调整

如果 `3001` 被占用：

```text
PORT=3100 npm start
```

局域网模式下：

```text
HOST=0.0.0.0 PORT=3100 npm start
```

## 健康检查

启动后访问：

```text
http://localhost:3001/health
http://localhost:3001/ready
http://localhost:3001/ops/summary
http://localhost:3001/storage/status
http://localhost:3001/storage/doctor
http://localhost:3001/runtime/network
http://localhost:3001/runtime/config
http://localhost:3001/metrics
```

`/health` 返回 `ok: true` 表示后台进程正常；`/ready` 会额外校验本地 store 文件是否存在且可解析，并在进程关停时返回非 200；`/ops/summary` 会聚合服务、网络、HTTP 错误计数、store、试点阶段门和下一步动作；`/storage/status` 和 `/storage/doctor` 用于检查数据文件、备份和检查点；`/runtime/network` 会列出本机访问地址、可尝试的局域网 URL、推荐访问地址、可复制邀请文本、当前是否 LAN 模式，以及是否只监听本机地址；`/runtime/config` 用于确认当前端口、store 路径、服务版本、请求体上限、请求超时、静态资源模式和是否启用试点访问码；`/metrics` 输出 Prometheus 文本格式指标，包含 ready、关停状态、进程 uptime、RSS/heap 内存、HTTP 请求计数、4xx/5xx、平均/最大响应耗时、store 状态和当前项目工作包/风险/阶段门业务指标。

页面“项目 -> 本地数据状态 -> 访问地址”也会显示推荐地址和可复制邀请文本。如果看到 `LOOPBACK_ONLY` 提醒，说明当前不是局域网监听模式，需要用 `npm run start:lan` 重新启动。

所有响应会带 `x-service-version` 和 `x-request-id`。如果调用方传入 `x-request-id`，服务端会原样返回；否则服务端生成一个。跨端口页面也可以通过 CORS 读取这两个响应头，方便对齐访问日志和前端报错。

## 数据文件

当前原型使用本地 JSON 文件保存数据：

```text
data/demo-store.json
```

这个文件不会提交到 GitHub。多机开发时，每台机器会有自己的本地演示数据。

后台写入本地 JSON 时会先保留同目录 `.bak` 备份，再原子替换主文件；点击“重置演示数据”前也会留下最近一次旧数据备份。

如果主文件损坏，先运行 `npm run store:doctor` 确认状态，再运行 `npm run store:restore-backup` 从 `.bak` 恢复。恢复动作会额外保留当前主文件的 `*.pre-restore-时间.bak` 副本，便于排查损坏原因。

正式内部部署时，应把该 JSON 持久化替换为 PostgreSQL，并把文件上传、Agent 执行记录、通知回调等数据统一写入数据库。

## GitHub 多机开发

新电脑拉取项目：

```text
git clone git@github.com:yanwei2023/hardware-product-workflow.git
cd hardware-product-workflow
npm start
```

日常同步：

```text
git pull
git status
git add .
git commit -m "说明本次修改"
git push
```

## 当前限制

- 还没有接入用户登录；
- 还没有接入 PostgreSQL；
- 还没有接入真实大模型 Agent；
- 还没有接入飞书、企业微信通知；
- 还没有生产级反向代理、TLS 和数据库级备份策略。
