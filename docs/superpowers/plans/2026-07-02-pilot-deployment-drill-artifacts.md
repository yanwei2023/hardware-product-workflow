# Pilot Deployment Drill Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deployment drill artifacts to each pilot archive so a non-core developer can rehearse startup, checks, access sharing, rollback evidence, and PostgreSQL policy before a trial.

**Architecture:** Extend the existing pilot archive generator instead of adding a separate command. The manifest will include a `deploymentDrill` object and two generated files: `pilot-deployment-drill.md` for the human runbook and `pilot-deployment-drill.json` for machine-readable review.

**Tech Stack:** Node.js ESM, `node:test`, existing pilot archive and pilot plan modules.

## Global Constraints

- Keep first pilot runtime default as JSON store.
- PostgreSQL import/preflight/startup snapshot/mirror are migration verification materials unless explicitly selected for a database write drill.
- Do not introduce new dependencies.
- Generated files must be referenced from `pilot-archive-manifest.json`.

---

### Task 1: Add Archive Coverage For Deployment Drill Files

**Files:**
- Modify: `apps/api/src/pilotArchive.test.mjs`

**Interfaces:**
- Consumes: `preparePilotArchive(outputDir)` existing result.
- Produces: failing assertions for `manifest.files.deploymentDrillMarkdown`, `manifest.files.deploymentDrillJson`, `manifest.deploymentDrill`, and generated markdown content.

- [ ] **Step 1: Add failing assertions**

Add assertions to `pilot archive writes review, risk, runtime, and import artifacts`:

```js
assert.equal(manifest.files.deploymentDrillMarkdown, "pilot-deployment-drill.md");
assert.equal(manifest.files.deploymentDrillJson, "pilot-deployment-drill.json");
assert.equal(manifest.deploymentDrill.defaultRuntimeSource, "json");
assert.equal(manifest.deploymentDrill.postgresDefaultPolicy, "migration_verification_only");
assert.equal(manifest.deploymentDrill.steps.some((item) => item.key === "start_lan"), true);
assert.equal(manifest.deploymentDrill.requiredEvidence.includes("/runtime/network 结果"), true);
assert.equal(fs.existsSync(path.join(outputDir, manifest.files.deploymentDrillMarkdown)), true);
assert.equal(fs.existsSync(path.join(outputDir, manifest.files.deploymentDrillJson)), true);
const deploymentDrillMarkdown = fs.readFileSync(path.join(outputDir, "pilot-deployment-drill.md"), "utf8");
assert.match(deploymentDrillMarkdown, /内部试点部署演练清单/);
assert.match(deploymentDrillMarkdown, /npm run start:lan/);
assert.match(deploymentDrillMarkdown, /HARDWARE_FLOW_PILOT_ACCESS_CODE/);
assert.match(deploymentDrillMarkdown, /JSON store/);
assert.match(deploymentDrillMarkdown, /\/runtime\/network/);
assert.match(deploymentDrillMarkdown, /pilot-rollback-card\.md/);
```

- [ ] **Step 2: Run focused test to verify RED**

Run: `node --test apps/api/src/pilotArchive.test.mjs`

Expected: FAIL because `manifest.files.deploymentDrillMarkdown` is undefined.

### Task 2: Generate Deployment Drill Data And Markdown

**Files:**
- Modify: `apps/api/src/pilotPlan.mjs`
- Modify: `apps/api/src/pilotArchive.mjs`

**Interfaces:**
- Produces: `pilotDeploymentDrill` export with default runtime policy, steps, and evidence.
- Produces: `renderPilotDeploymentDrillMarkdown(manifest)`.
- Produces: manifest keys `deploymentDrill`, `files.deploymentDrillMarkdown`, `files.deploymentDrillJson`.

- [ ] **Step 1: Add plan data**

Add this export to `apps/api/src/pilotPlan.mjs`:

```js
export const pilotDeploymentDrill = {
  templateName: "pilot-deployment-drill.md",
  defaultRuntimeSource: "json",
  postgresDefaultPolicy: "migration_verification_only",
  steps: [
    { key: "release_candidate", title: "确认发布候选包", command: "npm run pilot:check", evidence: "/tmp/hardware-flow-pilot-archive/pilot-launch-summary.json" },
    { key: "data_checkpoint", title: "创建试点前检查点", command: "页面：项目 -> 本地数据状态 -> 创建检查点", evidence: "/storage/status 结果" },
    { key: "start_lan", title: "按局域网模式启动服务", command: "HARDWARE_FLOW_PILOT_ACCESS_CODE=your-code npm run start:lan", evidence: "/runtime/network 结果" },
    { key: "health_checks", title: "确认健康和运行配置", command: "打开 /ready、/ops/summary、/runtime/config、/storage/doctor", evidence: "/ready 与 /storage/doctor 结果" },
    { key: "share_access", title: "发布推荐访问地址", command: "复制页面中的推荐 URL 和邀请文本", evidence: "发给试点成员的访问消息" },
    { key: "rollback_probe", title: "确认回滚材料可用", command: "打开 pilot-rollback-card.md 并确认 .bak 或检查点存在", evidence: "pilot-rollback-card.md 与最近检查点名称" },
    { key: "postgres_policy", title: "确认 PostgreSQL 策略", command: "默认仅保留导入包和 preflight；严格演练需另行设置 DATABASE_URL 与 psql", evidence: "db:preflight 输出或不启用数据库写入的记录" },
  ],
  requiredEvidence: [
    "服务版本和 Git 提交",
    "/ready 结果",
    "/runtime/network 结果",
    "/runtime/config 结果",
    "/storage/doctor 结果",
    "试点访问码保管人",
    "检查点名称或 .bak 路径",
    "PostgreSQL 默认策略记录",
  ],
};
```

- [ ] **Step 2: Wire archive files and manifest**

In `pilotArchive.mjs`, import `pilotDeploymentDrill`, add two files, add `deploymentDrill` to manifest, write the JSON and markdown files.

- [ ] **Step 3: Run focused test to verify GREEN**

Run: `node --test apps/api/src/pilotArchive.test.mjs`

Expected: PASS.

### Task 3: Document The New Archive Files

**Files:**
- Modify: `docs/internal-pilot.md`
- Modify: `docs/lan-deployment.md`
- Modify: `roadmap.md`

**Interfaces:**
- Consumes: generated `pilot-deployment-drill.md` and `pilot-deployment-drill.json`.
- Produces: docs that tell operators where to find the drill checklist and how it relates to the manual handoff.

- [ ] **Step 1: Update docs**

Mention the deployment drill files in archive contents and deployment handoff checklist.

- [ ] **Step 2: Update roadmap**

Append a 2026-07-02 M6 progress row saying the pilot archive now includes deployment drill artifacts.

- [ ] **Step 3: Run verification**

Run: `node --test apps/api/src/pilotArchive.test.mjs`

Run: `npm run pilot:check`

Expected: both commands exit 0.
