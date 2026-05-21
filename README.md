# 人机协同硬件开发流程系统

这是一个面向公司内部局域网部署的硬件产品开发流程管理系统骨架。

系统的核心规则很明确：

- Agent 负责执行工作包、生成草稿、检查遗漏、准备证据。
- 人类负责审核、修改、批准、驳回，并承担最终责任。
- 后台流程引擎控制项目状态；必要步骤、交付物、审核或证据缺失时，阶段门必须被卡住。

## 仓库结构

```text
apps/web       前端工作台骨架
apps/api       后台流程引擎骨架
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

依赖已经声明，但当前工作区还没有安装依赖。

```text
npm install
npm run dev:web
npm run dev:api
npm --workspace apps/api run demo
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

然后访问：

```text
http://localhost:3001
```

详细说明见：

```text
docs/quick-use.md
```

## 当前骨架

- `schemas/domain.ts` 定义共享流程模型。
- `schemas/agent-registry.json` 定义第一版角色 Agent 配置草案。
- `schemas/hardware-phase-template.json` 定义第一版硬件开发阶段模板。
- `apps/api/src/gateEngine.ts` 检查阶段门是阻塞还是可通过。
- `apps/api/src/artifactValidator.mjs` 检查 Agent 输出是否满足交付物模板要求。
- `apps/api/src/server.mjs` 提供第一条端到端 API 演示链路。
- `agents/worker/worker.py` 展示受控 Agent 输出协议。
- `apps/web/src/App.tsx` 勾勒第一版项目工作台页面。
- `schemas/database.sql` 起草第一版 PostgreSQL 表结构。
