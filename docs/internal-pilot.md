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
- 使用临时 store 自动执行一遍 EVT 内部试点演练；
- 生成一份试点归档包到 `/tmp/hardware-flow-pilot-archive`；
- diff 空白检查；
- PostgreSQL 导入包 preflight。

如果没有配置 `DATABASE_URL` 或本机没有 `psql`，preflight 会报告 blockers，但不会让试点检查失败。当前试点仍使用 JSON store 持久化；这些 blockers 只表示 PostgreSQL 运行时切换尚未完成。

如果只想单独验证试点主流程，不运行完整构建和数据库检查：

```text
npm run pilot:rehearse
```

该命令使用临时 store，不会修改 `data/demo-store.json`。它会自动创建检查点、设置当前阶段截止日期、模拟无效 Agent 输出、生成并审核 EVT 工作包、补充证据、处理风险、确认清单必需项完成，并批准 EVT Exit 阶段门。输出中的 `completedSteps` 会列出每个已完成的演练步骤，便于试点前快速定位脚本覆盖范围。

## 试点归档包

内部评审会或会后归档前，可以手动生成一份完整材料包：

```text
npm run pilot:archive -- /tmp/hardware-flow-pilot-archive
```

归档包包含：

- 试点交接页 `pilot-handoff.md`，汇总就绪、试点命令、未完成必需项、数据保护/回滚、试点问题上报、第一轮验收标准、第一轮试点边界、运维、诊断端点、PostgreSQL 导入包和 `psql` 执行命令；
- 现场简报 `pilot-brief.md`，用于会前/会中同步项目、阶段门、必需项、阻塞提醒、命令和诊断链接；
- 启动判定 `pilot-launch-summary.json`，用于快速判断 `GO`、`GO_WITH_CAUTION` 或 `NO_GO`，并列出硬阻塞、必需待处理项和下一步动作；
- 试点问题上报模板 `pilot-issue-report.md`，用于记录请求 ID、服务版本、复现步骤、影响范围、诊断端点和是否需要回滚；
- 回滚卡片 `pilot-rollback-card.md`，用于现场 S1/S2 数据或放行风险时按步骤暂停、诊断、恢复检查点或 `.bak`，并保留恢复证据；
- 项目快照 JSON/Markdown；
- 风险台账 JSON/Markdown；
- 当前阶段门审核包 JSON/Markdown；
- 最近一次阶段门批准包 JSON/Markdown（如果已批准）；
- 试点就绪状态和试点演练清单 JSON；
- 运维摘要 `ops-summary.json`，包含服务、网络、HTTP 错误计数、store、试点阶段门和下一步动作；
- runtime config、storage status、storage doctor；
- PostgreSQL 导入包和 `pilot-archive-manifest.json`。

`pilot-archive-manifest.json` 会记录项目、当前阶段门、阻塞数量、试点清单必需项完成度、试点命令、未完成必需项、数据保护/回滚状态、试点问题上报字段、第一轮验收标准、第一轮试点边界、运维摘要 ready 状态、storage 校验结果和 PostgreSQL 导入包校验结果，并汇总运维阻塞/警告数量、HTTP 错误计数、下一步动作、常用诊断端点和 `psql` 导入命令，方便试点负责人快速判断这份材料是否可交付。

## 启动方式

本机试点（首次建议先丰富演示数据）：

```text
npm run demo:enrich
npm start
```

局域网试点：

```text
npm run start:lan
```

局域网试点建议启用访问码：

```text
HARDWARE_FLOW_PILOT_ACCESS_CODE=your-code npm run start:lan
```

启用后页面会提示输入访问码。该能力只用于内部试点轻量保护，不替代正式用户登录或 SSO。

其他成员访问：

```text
http://本机内网IP:3001
```

启动后先确认：

```text
http://localhost:3001/health
http://localhost:3001/ready
http://localhost:3001/pilot/readiness
http://localhost:3001/pilot/launch
http://localhost:3001/pilot/checklist
http://localhost:3001/ops/summary
http://localhost:3001/storage/status
http://localhost:3001/storage/doctor
http://localhost:3001/runtime/network
http://localhost:3001/runtime/config
http://localhost:3001/metrics
```

页面“项目 -> 本地数据状态”也应显示 store 健康、服务版本、请求上限、请求超时、HTTP 4xx/5xx、平均/最大耗时、内存和阶段门业务指标。
其中“访问地址”区会显示推荐 URL、可复制邀请文本、本机 URL、局域网 URL 和 LAN 模式提醒，方便试点负责人把正确地址发给其他成员。

页面“项目 -> 试点就绪总览”会聚合服务状态、本地 store、当前阶段门阻塞、证据齐备度、风险、审计、通知以及常用导出入口。试点负责人可以先看这个面板判断是否可以组织内部评审或试用。
其中“试点演练清单”会按当前项目数据列出检查点、角色负责人、工作包排期、Agent 草稿、人类审核、风险处置、通知、审计和归档包等事项的 DONE/PENDING 状态；未完成的必需项也会出现在就绪提醒中，可作为试点主持人的现场脚本。
其中“现场简报”可以一键复制当前项目、阶段门状态、阻塞提醒、试点命令和诊断链接；“建议试点流程”可以一键复制到会议纪要或群消息；“现场问题上报”可以一键复制问题模板；试点命令也可以逐条复制。
如果页面操作失败，顶部会以红色提示显示错误内容、请求 ID 和服务版本；试点参与者反馈问题时应一并截图或复制请求 ID。
归档包中的 `pilot-issue-report.md` 可以直接作为现场问题模板，`pilot-rollback-card.md` 可以直接作为主持人的暂停和恢复清单。S1 代表数据损坏、无法启动、阶段门错误放行或无法回滚；S2 代表工作包生成、审核、风险处理、阶段门批准或导出等核心流程阻塞；S3 代表页面可用性、文案、性能、局域网访问或非关键导出问题。

试点开始前，建议在“项目 -> 本地数据状态”点击“创建检查点”，标签可使用 `pilot-start` 或当天会议名。检查点是当前 JSON store 的显式副本，适合在试点前后做可控回滚。

## 建议试点流程

1. 项目经理创建一个试点项目，填写产品线。
2. 在“项目”页配置每个角色的人类负责人。
3. 在“工作包”页为当前阶段关键工作包设置截止日期。
4. 对测试计划、测试报告、问题关闭计划执行 Agent 同步生成，或先加入 Agent 队列再处理下一条。
5. 让对应负责人分别批准、要求修改、驳回或有条件批准。
6. 在“工作包”页为关键证据补充 URL/文档编号，或上传本地附件作为阶段门证据。
7. 在“风险”页创建一个高风险，设置缓解负责人、截止日期和缓解措施。
8. 在“待办”页确认审核、排期、风险缓解和阶段门批准都能正确出现。
9. 在“通知”页确认通知可以筛选、跳转到对象并标记已读。
10. 在“阶段门”页导出审核包，确认证据、附件、风险、条款和阻塞项可用于评审会。
11. 证据和风险满足条件后批准阶段门，确认项目进入下一阶段。
12. 在“审计”页搜索关键事件，确认操作链路可追踪。
13. 导出项目快照 JSON 和 Markdown，作为试点记录。

## 试点验收标准

第一轮内部试点通过的标准：

- 参与者可以独立完成工作包生成、审核、风险处理和阶段门批准。
- Agent 生成可以通过同步按钮或队列方式完成，队列状态可见。
- 待办和通知能帮助成员找到自己下一步动作。
- 阶段门审核包可以直接用于一次内部评审会。
- 工作包证据可以补充 URL、文档编号或本地附件，并能在阶段门审核包中看到。
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

如果试点前已经创建检查点，优先在页面“项目 -> 本地数据状态”的“最近检查点”列表中选择目标检查点恢复；也可以直接点击“恢复最新检查点”回到最近一次状态。恢复前系统会保留当前文件的 `.pre-restore-*.bak` 副本，方便二次排查。

如果需要完全回到演示数据，可以在页面点击“重置演示数据”。重置前会保留最近一次旧数据备份；直接调用 `/demo/reset` 时也必须发送 `confirm: true`。

## 当前不承诺范围

以下能力不应作为第一轮内部试点验收项：

- 用户登录和单点登录；
- PostgreSQL 运行时读写；
- 真实大模型调用；
- 飞书、企业微信或邮件通知；
- 生产级 TLS、反向代理、数据库备份和灾备；
- 多人高并发编辑冲突处理。

这些能力进入第二轮试点或生产化阶段。
