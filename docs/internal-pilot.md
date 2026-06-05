# 内部试点运行手册

这份手册用于把当前原型尽快推进到小团队内部试点。试点目标不是替代正式 PLM 或项目管理系统，而是验证硬件开发阶段门、Agent 草稿、人类审核、风险闭环、通知和审计主流程是否适合团队日常协作。

## 试点范围

建议第一轮只选择 1 个真实或半真实硬件项目，参与者控制在 4-8 人：

- 项目经理：创建项目、跟踪阶段门、处理风险决策。
- 测试负责人：审核测试计划和测试报告。
- 质量负责人：处理问题关闭、风险关闭和质量类通知。
- 阶段门批准人：在证据齐备后批准阶段门。
- 观察者：只看总览、通知、审计和导出物。

第一轮试点建议覆盖 EVT Exit 到 DVT Exit，不建议一开始覆盖全部量产流程。

## 试点前检查

每次给团队试用前，在项目根目录运行：

```text
npm run pilot:check
```

该命令会执行：

- 完整单元测试、React 构建、API smoke 和 store doctor；
- PostgreSQL schema/migration/export/import bundle 校验；
- 生成一份试点归档包到 `/tmp/hardware-flow-pilot-archive`；
- diff 空白检查；
- PostgreSQL 导入包 preflight。

如果没有配置 `DATABASE_URL` 或本机没有 `psql`，preflight 会报告 blockers，但不会让试点检查失败。当前试点仍使用 JSON store 持久化；这些 blockers 只表示 PostgreSQL 运行时切换尚未完成。

## 试点归档包

内部评审会或会后归档前，可以手动生成一份完整材料包：

```text
npm run pilot:archive -- /tmp/hardware-flow-pilot-archive
```

归档包包含：

- 项目快照 JSON/Markdown；
- 风险台账 JSON/Markdown；
- 当前阶段门审核包 JSON/Markdown；
- 最近一次阶段门批准包 JSON/Markdown（如果已批准）；
- runtime config、storage status、storage doctor；
- PostgreSQL 导入包和 `pilot-archive-manifest.json`。

`pilot-archive-manifest.json` 会记录项目、当前阶段门、阻塞数量、storage 校验结果和 PostgreSQL 导入包校验结果，方便试点负责人快速判断这份材料是否可交付。

## 启动方式

本机试点：

```text
npm start
```

局域网试点：

```text
npm run start:lan
```

其他成员访问：

```text
http://本机内网IP:3001
```

启动后先确认：

```text
http://localhost:3001/health
http://localhost:3001/ready
http://localhost:3001/pilot/readiness
http://localhost:3001/runtime/config
http://localhost:3001/metrics
```

页面“项目 -> 本地数据状态”也应显示 store 健康、服务版本、请求上限、请求超时、HTTP 4xx/5xx、平均/最大耗时、内存和阶段门业务指标。

页面“项目 -> 试点就绪总览”会聚合服务状态、本地 store、当前阶段门阻塞、证据齐备度、风险、审计、通知以及常用导出入口。试点负责人可以先看这个面板判断是否可以组织内部评审或试用。

## 建议试点流程

1. 项目经理创建一个试点项目，填写产品线。
2. 在“项目”页配置每个角色的人类负责人。
3. 在“工作包”页为当前阶段关键工作包设置截止日期。
4. 对测试计划、测试报告、问题关闭计划执行 Agent 生成。
5. 让对应负责人分别批准、要求修改、驳回或有条件批准。
6. 在“风险”页创建一个高风险，设置缓解负责人、截止日期和缓解措施。
7. 在“待办”页确认审核、排期、风险缓解和阶段门批准都能正确出现。
8. 在“通知”页确认通知可以筛选、跳转到对象并标记已读。
9. 在“阶段门”页导出审核包，确认证据、风险、条款和阻塞项可用于评审会。
10. 证据和风险满足条件后批准阶段门，确认项目进入下一阶段。
11. 在“审计”页搜索关键事件，确认操作链路可追踪。
12. 导出项目快照 JSON 和 Markdown，作为试点记录。

## 试点验收标准

第一轮内部试点通过的标准：

- 参与者可以独立完成工作包生成、审核、风险处理和阶段门批准。
- 待办和通知能帮助成员找到自己下一步动作。
- 阶段门审核包可以直接用于一次内部评审会。
- 项目快照和 Markdown 导出足够用于会后归档。
- 审计记录能回答“谁在什么时候做了什么”。
- `npm run pilot:check` 通过，且 `/ready` 返回 200。
- 试点期间没有出现数据文件损坏；如出现，能通过 `.bak` 恢复。

## 数据保护和回滚

当前试点使用 JSON store：

```text
data/demo-store.json
```

每次写入前会保留 `.bak`。试点前建议复制一份快照：

```text
cp data/demo-store.json data/demo-store.before-pilot.json
```

如果试点数据异常：

```text
npm run store:doctor
npm run store:restore-backup
```

如果需要完全回到演示数据，可以在页面点击“重置演示数据”。重置前会保留最近一次旧数据备份。

## 当前不承诺范围

以下能力不应作为第一轮内部试点验收项：

- 用户登录和单点登录；
- PostgreSQL 运行时读写；
- 文件上传和附件存储；
- 真实大模型调用和异步 Agent 队列；
- 飞书、企业微信或邮件通知；
- 生产级 TLS、反向代理、数据库备份和灾备；
- 多人高并发编辑冲突处理。

这些能力进入第二轮试点或生产化阶段。
