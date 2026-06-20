# 快速试用说明

当前版本是一个无外部依赖的本地试用版，使用 Node.js 内置能力运行。

## 启动

```text
npm start
```

默认监听：

```text
http://localhost:3001
```

如果需要修改端口：

```text
PORT=3100 npm start
```

如果需要让局域网内其他电脑访问：

```text
npm run start:lan
```

如果需要给局域网试点加一层访问保护，可以设置试点访问码：

```text
HARDWARE_FLOW_PILOT_ACCESS_CODE=your-code npm run start:lan
```

启用后，页面会要求输入访问码；这不是正式登录或 SSO，只适合作为内部试点的轻量保护。

## 打开页面

浏览器访问：

```text
http://localhost:3001
```

页面包含：

- 项目总览
- 项目创建与切换
- 项目复制
- 项目快照导出
- 项目快照导入前校验与安全导入
- 本地数据状态
- 当前阶段工作包
- 工作包截止日期、逾期和临期提醒
- 工作包审核详情
- 工作包活动记录
- 工作包 Markdown 导出
- 工作包证据引用和本地附件上传/下载
- 我的待办
- 站内通知与已读状态
- Agent 输出草稿预览
- 模板校验结果
- Agent 同步生成和异步队列处理
- 人类批准、要求修改、驳回
- 要求修改或驳回时必须填写审核意见
- 阶段门检查
- 阶段门审核包
- 阶段门缺口处理动作
- 当前阶段风险创建
- 风险接受与关闭处置说明
- 项目风险台账与 Markdown 导出
- 审计记录
- 当前操作者选择

## 数据持久化

当前使用 JSON 文件持久化：

```text
data/demo-store.json
```

服务重启后数据不会丢失。

每次数据发生变化时，后台会先把已有文件复制为 `data/demo-store.json.bak`，再通过临时文件原子替换主文件。重复保存相同内容不会刷新备份。

点击页面左侧“重置演示数据”会删除并重建演示项目数据；直接调用 `/demo/reset` 时也必须发送 `confirm: true`。

如果主文件损坏，可以先检查，再从备份恢复：

```text
npm run store:doctor
npm run store:restore-backup
```

恢复时会先把当前主文件另存为 `*.pre-restore-时间.bak`，再把 `.bak` 复制回主文件。

页面“项目管理 -> 本地数据”区域也会显示主文件与备份文件的健康状态；存在备份时可以直接点击“从备份恢复”。

如果需要指定其他数据文件：

```text
HARDWARE_FLOW_STORE_PATH=/path/to/store.json npm start
```

完成 PostgreSQL 同步和一致性校验后，可从数据库加载一次启动快照：

```text
HARDWARE_FLOW_STARTUP_STORE_SOURCE=postgres DATABASE_URL=postgres://user:password@localhost/hardware_flow npm start
```

启动快照会先通过完整映射和 store doctor，再写入 JSON store。默认 `HARDWARE_FLOW_RUNTIME_WRITE_MODE=auto` 会让 PostgreSQL 快照自动只读，工作台显示只读提示并在前后端同时阻止修改；数据库不可用时严格模式拒绝启动，`postgres-fallback` 模式则回退到可写 JSON 并在运行状态中标记降级。

需要验证可写链路时，显式增加 `HARDWARE_FLOW_RUNTIME_WRITE_MODE=read-write HARDWARE_FLOW_RUNTIME_PERSISTENCE_BACKEND=postgres-mirror`。该模式会同步阻塞到 PostgreSQL 精确镜像和写后校验完成；失败请求返回 503，并自动恢复修改前的 JSON 与内存状态。运行状态和 `/metrics` 会暴露持久化后端、最近错误及累计同步失败数。

切换前先用同一组环境变量运行 `npm run runtime:persistence-check`。镜像模式只有在当前 JSON 与 PostgreSQL 全表一致时才通过；API 启动会重复执行该门禁，因此数据库漂移不会等到第一次用户修改才暴露。

镜像模式下，角色负责人变更、工作包计划日期更新、工作包证据引用新增、人工审核提交、有条件批准条款完成、当前阶段风险创建、风险接受/关闭、风险缓解计划更新、缓解完成、阶段门批准、单条通知已读和项目内用户通知批量已读已经使用原生 PostgreSQL 增量事务，将业务状态、风险行、证据引用、审计、通知和阶段门批准包一起提交或更新；其他修改仍使用全量精确镜像。页面“本地数据状态”和 `/metrics` 会显示启动一致性、当前持久化就绪状态、最近数据库写入模式及两类事务累计次数。

## 可试用链路

当前默认项目处于 `EVT Exit` 阶段。

你可以按以下顺序操作：

```text
1. 打开“阶段门”查看阻塞项
2. 打开“工作包”
3. 对 EVT Exit 报告点击 Agent 生成
4. 对 EVT 问题关闭计划点击 Agent 生成
5. 对三个 EVT 工作包点击人类批准
6. 回到“阶段门”，接受高风险
7. 重新检查阶段门
8. 阶段门应变为 READY
9. 使用项目经理或阶段门批准人批准阶段门
10. 当前阶段锁定，项目进入下一阶段
```

在工作包页面中，也可以点击“模拟无效输出”。系统会返回模板校验错误，并把该工作包退回 `NEEDS_AGENT_REVISION`。

项目总览会按“当前操作者”显示我的待办：

- 待审核工作包；
- 逾期或 3 天内到期的工作包；
- 有条件批准后的补充条款，完成后会从待办中移除；
- 待处理高风险；
- 分配给自己的风险缓解计划，完成后会从待办中移除；
- 已 READY 的阶段门批准。

Agent 输出、审核、风险创建/处理、阶段门批准等事件会生成站内通知。通知按“当前操作者”和当前项目隔离，可以在项目总览中单条标记已读或全部已读，并会随项目快照导入和项目复制保留。

当前已经有最小权限模型。切换“当前操作者”后：

- 只有工作包绑定的人类负责人能批准该工作包；
- 只有项目经理、质量负责人、阶段门批准人能接受或关闭风险；
- 无权限操作会在页面顶部显示错误。

如果启用了 `HARDWARE_FLOW_PILOT_ACCESS_CODE`，浏览器会把访问码保存在本地，并在请求中带 `x-pilot-access-code`。页面右上角可以清除访问码。

## 多阶段回归脚本

可以运行：

```text
node apps/api/src/multiPhaseDemo.mjs
```

该脚本会自动完成：

```text
EVT Exit -> DVT Exit -> PVT Exit
```

用于验证阶段门流程可以跨阶段重复使用，而不是只针对 EVT 写死。

## 发布前检查

提交或发布前可以运行：

```text
npm run release:check
```

该命令会执行完整测试、React 构建、API smoke、store doctor、PostgreSQL 迁移/导出/导入包校验、rows 反向恢复 store 校验和 diff 空白检查。

内部试点前建议运行：

```text
npm run pilot:check
```

试点角色、验收标准、回滚和边界请看 `docs/internal-pilot.md`。

## 创建新项目

在页面左侧进入“项目管理”，填写项目名称和产品线，点击“按标准模板创建”。

系统会自动生成：

```text
阶段
阶段门
角色 + Agent 配对
必需工作包
交付物模板绑定
阶段门检查条件
```

## 配置角色负责人

进入“项目管理”，在“当前项目角色配对”中选择每个角色对应的人类负责人并保存。

负责人变更会立即影响审批权限：只有工作包绑定的人类负责人可以批准该工作包进入阶段门证据链。

## 当前边界

当前版本用于验证核心流程，不是正式生产版。

尚未接入：

- 用户登录；
- 完整的原生 PostgreSQL repository 与其余业务动作的增量事务写入；
- 真实大模型；
- 飞书/企业微信通知；
- 真实权限审批链；
- 线上托管环境。
