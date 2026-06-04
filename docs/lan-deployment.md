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
http://localhost:3001/runtime/config
http://localhost:3001/metrics
```

`/health` 返回 `ok: true` 表示后台进程正常；`/ready` 会额外校验本地 store 文件是否存在且可解析，并在进程关停时返回非 200；`/runtime/config` 用于确认当前端口、store 路径、服务版本、请求体上限、请求超时和静态资源模式；`/metrics` 输出 Prometheus 文本格式指标，包含 ready、关停状态、进程 uptime、RSS/heap 内存、HTTP 请求计数、4xx/5xx、平均/最大响应耗时、store 状态和当前项目工作包/风险/阶段门业务指标。

所有响应会带 `x-service-version` 和 `x-request-id`。如果调用方传入 `x-request-id`，服务端会原样返回；否则服务端生成一个，方便对齐访问日志和前端报错。

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
