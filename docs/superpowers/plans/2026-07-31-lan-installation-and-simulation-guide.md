# LAN Installation and Product Simulation Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a standalone Chinese guide that lets a first-time internal pilot team install the system on one Node.js LAN host and simulate a simple product project from S0 candidate creation through S1 Agent dispatch.

**Architecture:** Create one root-level operator guide as the user-facing entry point and link it from `README.md`. The guide uses the current React labels, company project/capability registries, verified npm commands, and the approved S0→human review→blueprint→S1 flow; it does not modify platform defaults or runtime behavior.

**Tech Stack:** Markdown, Node.js 22, npm, Git, React workbench, JSON store, zsh/bash host commands.

## Global Constraints

- The service host is macOS or Linux with Node.js 22; Windows machines are browser clients only for this first guide.
- The repository branch is `codex/agent-driven-lifecycle`.
- The example product is “便携式温湿度记录仪” and must remain documentation-only.
- The default project path is `POST /projects/candidates`; the guide must not teach legacy `POST /projects` as the new-project path.
- Agent work is processed through the existing Agent job queue and reviewed by humans.
- The guide must state that external LLM execution, production authentication, full PostgreSQL repository operation, and individual-document level override workflow are not complete.
- Do not modify business code, registries, templates, or default product data.

---

### Task 1: Write the Standalone Operator Guide

**Files:**
- Create: `局域网安装与产品开发模拟测试指南.md`

**Interfaces:**
- Consumes: `README.md`, `docs/internal-pilot.md`, `docs/lan-deployment.md`, `apps/web/src/App.tsx`, `schemas/project-type-registry.json`, `schemas/capability-pack-registry.json`, and npm scripts in `package.json`.
- Produces: A self-contained Chinese Markdown guide usable without reading other repository documents.

- [x] **Step 1: Record exact installation prerequisites and host/client boundary**

Document:

```text
主机：macOS/Linux、Node.js 22、Git、局域网固定或稳定 IP、端口 3001 可访问
客户端：同一局域网、现代浏览器
数据：只保存在运行服务的主机；客户端不安装、不各自启动、不自动合并数据
```

- [x] **Step 2: Add copyable clone, verification, and LAN start commands**

Use:

```bash
git clone --branch codex/agent-driven-lifecycle https://github.com/yanwei2023/hardware-product-workflow.git
cd hardware-product-workflow
npm install
npm run pilot:check
HARDWARE_FLOW_PILOT_ACCESS_CODE=change-this-code npm run start:lan
```

Explain the non-strict PostgreSQL preflight warning and show `/health`, `/ready`, and `/runtime/network` checks.

- [x] **Step 3: Add client connection and role allocation**

Specify one host and three logical roles:

```text
项目经理：创建候选、保存定义、批准 S0 Gate、批准蓝图
研发负责人：审核技术类 S0 交付物
质量负责人：审核质量/合规交付物并观察 Gate 阻塞
```

Explain that the current pilot has no formal login, so roles are simulated through the workbench’s current-user/reviewer controls and must not be presented as authenticated identities.

- [x] **Step 4: Add exact example initiation values**

Use:

```text
项目名称：便携式温湿度记录仪试点
产品构想：为实验室、仓储和小型工业现场提供可连续记录、现场查看和导出数据的便携式温湿度记录产品
项目类型：全新产品开发
目标市场：实验室；仓储；小型工业现场
客户场景：环境巡检；连续记录；现场查看；数据导出
产品能力：电子硬件；嵌入式固件；结构与工业设计；测量与信号链；实体产品验证
技术范围：传感器；采集电路；低功耗固件；显示与存储；便携外壳
合规要求：电气安全适用性；EMC 适用性；环保要求；计量适用性
供应方式：核心设计自研，PCB 和结构件外协
交付模式：标准产品销售，提供说明书和基础售后
运营要求：校准建议；固件维护；客户问题处理
风险等级：中
```

- [x] **Step 5: Add the S0-to-S1 guided scenario**

For each step, write “操作 / 预期结果 / 异常处理” and cover:

```text
创建 S0 候选
确认只有 S0、10 个 Agent 任务
保存立项定义并预览蓝图
处理 Agent 队列
对一个交付物要求修改并确认重新排队
批准 8 个 Gate 必需交付物
确认 S0 Gate READY
批准 S0 Gate 并确认基线冻结
处理并批准项目蓝图
确认 11 个阶段、当前 S1、S1 Agent 任务已排队
检查待办、通知和审计
```

- [x] **Step 6: Add result recording, rollback, and troubleshooting**

Include a Markdown result table for host, client access, S0 boundary, revision loop, Gate, blueprint, S1 dispatch, audit, and backup. Add safe stop (`Ctrl+C`), checkpoint/backup guidance, `npm run store:doctor`, and common failures for port occupancy, firewall, wrong access code, missing Node/npm, and optional PostgreSQL warnings.

- [x] **Step 7: State current boundaries without overclaiming**

Explicitly state:

```text
局域网模拟试点就绪，不是生产就绪
外部大模型未接入
试点访问码不是登录/SSO
默认是 JSON store
单份文档等级调整、条件 N/A、降级例外审批闭环未完成
TLS、反向代理、高并发冲突和生产灾备未完成
```

### Task 2: Link and Verify the Guide

**Files:**
- Modify: `README.md`
- Verify: `局域网安装与产品开发模拟测试指南.md`

**Interfaces:**
- Consumes: the completed standalone guide from Task 1.
- Produces: a discoverable guide and verification evidence that its commands and labels match the repository.

- [x] **Step 1: Add the guide to README**

Add `局域网安装与产品开发模拟测试指南.md` to the “详细说明见” list and describe it as the first LAN pilot entry point.

- [x] **Step 2: Verify commands and registered sample values**

Run:

```bash
node --version
npm run pilot:rehearse:s0
node --input-type=module -e 'import fs from "node:fs"; const projectTypes=JSON.parse(fs.readFileSync("schemas/project-type-registry.json","utf8")); const capabilities=JSON.parse(fs.readFileSync("schemas/capability-pack-registry.json","utf8")); const requiredType="全新产品开发"; const requiredCapabilities=["电子硬件","嵌入式固件","结构与工业设计","测量与信号链","实体产品验证"]; if(!projectTypes.projectTypes.some((item)=>item.name===requiredType)) process.exit(1); for(const name of requiredCapabilities){if(!capabilities.capabilityPacks.some((item)=>item.name===name)) process.exit(1)} console.log("Guide registry values verified")'
```

Expected:

```text
Node.js major version is 22 or higher
pilot:rehearse:s0 reports ok: true and currentPhaseKey: s1_market_definition
Guide registry values verified
```

- [x] **Step 3: Verify document consistency**

Run:

```bash
rg -n "TB[D]|TO[D]O|待[定]|占[位]|稍后[补]充" 局域网安装与产品开发模拟测试指南.md
git diff --check
git status --short
```

Expected:

```text
placeholder scan has no output
git diff --check has no output
status lists only the guide, README, and this plan checkbox update
```

- [x] **Step 4: Commit the guide**

```bash
git add README.md 局域网安装与产品开发模拟测试指南.md docs/superpowers/plans/2026-07-31-lan-installation-and-simulation-guide.md
git commit -m "Add LAN installation and product simulation guide"
```

### Task 3: Publish and Confirm the Handoff

**Files:**
- Modify: `docs/superpowers/plans/2026-07-31-lan-installation-and-simulation-guide.md`

**Interfaces:**
- Consumes: committed guide and verified branch.
- Produces: a GitHub branch whose remote SHA equals local `HEAD`.

- [x] **Step 1: Push the current branch**

Run:

```bash
git push origin codex/agent-driven-lifecycle
```

- [x] **Step 2: Confirm remote equality**

Run:

```bash
git rev-parse HEAD
git ls-remote --heads origin codex/agent-driven-lifecycle
```

Expected: both commands show the same 40-character SHA.

- [x] **Step 3: Record publication and push the audit update**

Mark all plan steps complete, commit only this plan, push again, and repeat the SHA comparison:

```bash
git add docs/superpowers/plans/2026-07-31-lan-installation-and-simulation-guide.md
git commit -m "Record LAN guide publication"
git push origin codex/agent-driven-lifecycle
git rev-parse HEAD
git ls-remote --heads origin codex/agent-driven-lifecycle
```
