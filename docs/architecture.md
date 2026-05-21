# 系统架构

## 产品原则

这个系统不是聊天工具，也不是松散的任务看板。它的本质是一个面向硬件开发的**受控流程引擎**。

项目只有在满足以下条件时，才能继续推进：

- 必需的工作包已经生成；
- 必需的交付物已经产出；
- Agent 的工作结果已经由对应人类角色审核；
- 关键风险已经关闭，或被人类明确接受；
- 阶段门拥有足够证据，可以被人类批准通过。

## 运行分层

```text
浏览器工作台
  -> API / 流程引擎
  -> 数据库、对象存储、队列、审计日志
  -> Agent 编排器
  -> Agent Workers
  -> 本地模型网关 / 工具 / 知识库
```

## 前端

建议生产技术栈：

- React
- TypeScript
- Vite
- Ant Design or TDesign
- TanStack Query
- React Flow or AntV X6 for dependency views
- ECharts for dashboards

主要页面：

- 项目总览
- 阶段详情
- 人类审核页
- 我的工作台
- 阶段门审核页
- 交付物详情
- 管理后台与流程模板

## 后台

建议生产技术栈：

- NestJS + TypeScript
- PostgreSQL 作为主数据库
- Redis 用于缓存和轻量锁
- RabbitMQ 或 NATS 用于流程事件和 Agent 任务
- MinIO 用于文件存储

后台拥有所有正式状态流转权。Agent 不能直接批准、冻结、发布交付物，也不能直接推进阶段门。

## Agent 层

建议生产技术栈：

- Python workers
- FastAPI 提供内部 Agent 服务 API
- 本地模型网关，例如生产推理使用 vLLM
- 早期本地开发可使用 Ollama
- 文档解析 worker，用于 PDF、DOCX、XLSX、BOM、测试报告等

Agent 产出的是建议和草稿：

- 交付物草稿；
- 审查发现；
- 风险候选项；
- 缺失证据报告；
- 阶段门摘要。

只有人类审核通过后，Agent 建议才能转为正式项目记录。

## 通知层

通知采用事件驱动。业务代码只发出事件，通知服务根据规则决定推送渠道。

通知渠道：

- 站内通知；
- 邮件；
- 飞书；
- 企业微信。

所有外部通知集成都必须经过通知网关，让局域网系统只有一个受控的外联出口。
