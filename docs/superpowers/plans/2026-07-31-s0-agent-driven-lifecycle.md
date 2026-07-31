# S0 Agent-Driven Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create product-neutral S0 candidate projects, compile an approved initiation baseline into an auditable project blueprint, publish S1-S10 only after human blueprint approval, and automatically dispatch Agent work after each approved transition.

**Architecture:** Preserve the existing project graph, Agent job, artifact, review, gate, audit, JSON store, PostgreSQL, and React workbench. Add product-neutral standards, JSON metadata on Project and WorkPackage, a deterministic blueprint compiler, an S0-only candidate builder, and orchestration hooks that queue Agent work on creation, revision, blueprint publication, and gate advancement.

**Tech Stack:** Node.js ESM, JSON registries, Node test runner, React, TypeScript, Vite, PostgreSQL SQL schema and JSONB mapping.

## Global Constraints

- Work in the existing `hardware-product-workflow` repository and isolated `codex/agent-driven-lifecycle` worktree.
- The correction spec at `docs/superpowers/specs/2026-07-31-s0-agent-driven-lifecycle-correction.md` overrides conflicting creation, HFCT-pack, and Agent-positioning requirements in the earlier design.
- Do not create another backend, frontend, repository, or parallel project model.
- Preserve `POST /projects` and the legacy seven-phase project behavior for compatibility.
- New UI project creation must use the S0 candidate flow.
- Before S0 Gate approval, create no S1-S10 Phase, Gate, WorkPackage, ArtifactVersion, or AgentJob.
- Agent performs work and submits; the assigned person reviews; only approval events advance the workflow.
- Add no external runtime dependencies.
- Use RED-GREEN-REFACTOR for every behavior change.
- Keep old projects and snapshots readable when new metadata is absent.
- Keep JSON and PostgreSQL round-trips lossless for the new metadata.

---

### Task 1: Remove Product-Specific Defaults From Company Standards

**Files:**
- Modify: `schemas/company-document-definition-registry.json`
- Modify: `schemas/capability-pack-registry.json`
- Modify: `schemas/product-pack-registry.json`
- Modify: `schemas/company-product-lifecycle-template.json`
- Modify: `apps/api/src/companyStandardStore.mjs`
- Modify: `apps/api/src/companyStandardStore.test.mjs`
- Modify: `apps/api/src/projectTemplateComposer.mjs`
- Modify: `apps/api/src/projectTemplateComposer.test.mjs`
- Modify: `apps/api/src/server.test.mjs`

**Interfaces:**
- Preserves: `getProductPacks(): []` as an empty compatibility result.
- Changes: `composeProjectTemplate({ templateKey, projectTypeKey, capabilityKeys })`.
- Produces: no product-specific name, `PRODUCT_PACK` source, or default product pack.

- [x] **Step 1: Write failing product-neutral standards tests**

Add tests that independently assert the forbidden defaults and the corrected source mappings:

```js
test("company standards contain no product-specific defaults", () => {
  const documents = getCompanyDocumentDefinitions();
  assert.equal(getProductPacks().length, 0);
  assert.deepEqual(
    documents.filter((item) => /HFCT|局放/.test(item.name)),
    [],
  );
  assert.deepEqual(
    documents.filter((item) => item.sourceCategory === "PRODUCT_PACK"),
    [],
  );
  assert.deepEqual(validateCompanyStandards(), []);
});

test("project preview is selected by project type and capabilities only", () => {
  const result = composeProjectTemplate({
    templateKey: "company_product_lifecycle_v1_0",
    projectTypeKey: "new_product_development",
    capabilityKeys: ["measurement_signal_chain", "algorithm_ai"],
  });
  const codes = result.phases.flatMap((phase) =>
    phase.documentRequirements.map((item) => item.documentCode));
  assert.ok(codes.includes("HW-001"));
  assert.ok(codes.includes("ALG-001"));
  assert.equal("selectedProductPackKeys" in result, false);
});
```

- [x] **Step 2: Run focused tests and verify RED**

Run:

```bash
node --test apps/api/src/companyStandardStore.test.mjs apps/api/src/projectTemplateComposer.test.mjs apps/api/src/server.test.mjs
```

Expected: FAIL because the `hfct` pack, names, `PRODUCT_PACK` sources, and product-pack composer input still exist.

- [x] **Step 3: Generalize the eight document definitions**

Apply the exact mappings from correction spec section 8:

```text
FS-002   安装环境与系统接口适配性研究报告       CAPABILITY_PACK field_installation
HW-001   核心传感与检测单元硬件设计说明书       CAPABILITY_PACK measurement_signal_chain
ALG-001  信号处理与诊断算法设计说明书           CAPABILITY_PACK algorithm_ai
ALG-002  多通道关联与干扰抑制设计说明书         CAPABILITY_PACK algorithm_ai
ME-002   安装附件与测试接口设计说明书           CAPABILITY_PACK field_installation
TEST-002 核心传感与检测单元性能测试规范         CAPABILITY_PACK measurement_signal_chain
TEST-004 模拟源与校准测试方案                   CAPABILITY_PACK certification_metrology
TEST-005 典型应用场景与安装拓扑验证方案         CAPABILITY_PACK field_installation
```

Move each code into the owning capability pack and set:

```json
{
  "version": "1.1.0",
  "productPacks": []
}
```

Remove `projectTypeKey` from the company lifecycle template because project type is an S0 result, not a platform default.

- [x] **Step 4: Remove product packs from the composer contract**

Make project type explicit and validated:

```js
export function composeProjectTemplate(input = {}) {
  const projectTypeKey = String(input.projectTypeKey || "");
  assertKnownKeys([projectTypeKey], getProjectTypes(), "project type");
  const capabilityKeys = normalizeSelectedKeys(input.capabilityKeys, "capabilityKeys");
  // Include COMPANY_COMMON, matching PROJECT_TYPE, and selected CAPABILITY_PACK only.
}
```

Keep `/standards/product-packs` returning `{ productPacks: [] }` for compatibility. Reject non-empty legacy `productPackKeys` with `product packs are not supported by the product-neutral core`.

- [x] **Step 5: Run focused tests and verify GREEN**

Run the same focused test command. Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add schemas/company-document-definition-registry.json schemas/capability-pack-registry.json schemas/product-pack-registry.json schemas/company-product-lifecycle-template.json apps/api/src/companyStandardStore.mjs apps/api/src/companyStandardStore.test.mjs apps/api/src/projectTemplateComposer.mjs apps/api/src/projectTemplateComposer.test.mjs apps/api/src/server.test.mjs
git commit -m "Remove product-specific lifecycle defaults"
```

---

### Task 2: Persist Project Definition and Work-Package Metadata

**Files:**
- Modify: `schemas/database.sql`
- Modify: `migrations/001_initial_schema.sql`
- Modify: `apps/api/src/postgresMapper.mjs`
- Modify: `apps/api/src/postgresMapper.test.mjs`
- Modify: `schemas/domain.ts`

**Interfaces:**
- Project field: `definition: Record<string, unknown>`.
- WorkPackage field: `metadata: Record<string, unknown>`.
- PostgreSQL columns: `projects.definition_json jsonb`, `work_packages.metadata_json jsonb`.

- [x] **Step 1: Write failing PostgreSQL round-trip tests**

Add literal metadata to the demo store copy:

```js
store.projects[0].definition = {
  lifecycleMode: "S0_COMPILED",
  initiation: { version: 2, productConcept: "通用检测产品" },
};
store.workPackages[0].metadata = {
  workType: "DOCUMENT",
  documentCode: "PM-001",
  effectiveRequirementLevel: "MANDATORY",
};

const rows = mapStoreToPostgresRows(store);
assert.deepEqual(rows.projects[0].definition_json, store.projects[0].definition);
assert.deepEqual(rows.work_packages[0].metadata_json, store.workPackages[0].metadata);

const restored = mapPostgresRowsToStore(rows);
assert.deepEqual(restored.projects[0].definition, store.projects[0].definition);
assert.deepEqual(restored.workPackages[0].metadata, store.workPackages[0].metadata);
```

- [x] **Step 2: Run the mapper test and verify RED**

Run:

```bash
node --test apps/api/src/postgresMapper.test.mjs
```

Expected: FAIL because the new JSONB fields are not mapped.

- [x] **Step 3: Add additive JSONB columns and mapper support**

Add:

```sql
definition_json jsonb not null default '{}'::jsonb
```

to `projects`, and:

```sql
metadata_json jsonb not null default '{}'::jsonb
```

to `work_packages` in both schema files.

Add both columns to `jsonbColumns`, map missing runtime fields to `{}`, and restore missing database values to `{}`. Extend the TypeScript interfaces without making the fields required for legacy callers.

- [x] **Step 4: Run persistence and schema tests**

Run:

```bash
node --test apps/api/src/postgresMapper.test.mjs apps/api/src/postgresMigrationCheck.test.mjs apps/api/src/postgresSchemaCheck.test.mjs
npm run db:migration-check
npm run db:schema-check
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add schemas/database.sql migrations/001_initial_schema.sql schemas/domain.ts apps/api/src/postgresMapper.mjs apps/api/src/postgresMapper.test.mjs
git commit -m "Persist lifecycle definition metadata"
```

---

### Task 3: Add Standard Document Template and Deterministic Blueprint Compiler

**Files:**
- Create: `templates/artifacts/company-controlled-document.md`
- Create: `templates/artifacts/project-blueprint.md`
- Modify: `schemas/artifact-template-registry.json`
- Create: `apps/api/src/projectLifecycleCompiler.mjs`
- Create: `apps/api/src/projectLifecycleCompiler.test.mjs`

**Interfaces:**
- Produces: `validateInitiationDefinition(definition): Array<{ code, field, message }>`.
- Produces: `compileProjectBlueprint({ project, definition }): ProjectBlueprint`.
- Produces: `buildPublishedProjectGraph(project, blueprint): ProjectGraph`.
- Produces: `renderProjectBlueprintMarkdown(blueprint): string`.

- [x] **Step 1: Write failing definition and compiler tests**

Cover completeness, determinism, product-neutral selection, and graph creation:

```js
test("initiation definition reports every missing required field", () => {
  assert.deepEqual(
    validateInitiationDefinition({ productConcept: "产品构想" }).map((item) => item.field),
    ["projectTypeKey", "targetMarkets", "capabilityKeys", "supplyMode", "deliveryModel", "riskLevel"],
  );
});

test("same baseline and standards produce the same blueprint", () => {
  const first = compileProjectBlueprint({ project, definition });
  const second = compileProjectBlueprint({ project, definition });
  assert.deepEqual(first, second);
  assert.equal(first.phases[0].phaseKey, "s1_market_definition");
  assert.equal(first.phases.at(-1).phaseKey, "s10_lifecycle");
  assert.equal(first.documentRequirements.some((item) => /HFCT|局放/.test(item.documentName)), false);
});

test("published graph contains S1-S10 and no duplicate S0", () => {
  const graph = buildPublishedProjectGraph(project, blueprint);
  assert.deepEqual(graph.phases.map((item) => item.phaseKey), [
    "s1_market_definition", "s2_requirements_feasibility", "s3_system_design",
    "s4_detailed_design", "s5_evt", "s6_dvt", "s7_pvt", "s8_release",
    "s9_delivery_operations", "s10_lifecycle",
  ]);
  assert.ok(graph.workPackages.every((item) => item.metadata.documentCode));
});
```

- [x] **Step 2: Run the compiler test and verify RED**

Run:

```bash
node --test apps/api/src/projectLifecycleCompiler.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [x] **Step 3: Add the two controlled Markdown templates**

Register:

```json
{
  "artifactType": "COMPANY_CONTROLLED_DOCUMENT",
  "templateKey": "company_controlled_document_v1_0",
  "path": "templates/artifacts/company-controlled-document.md",
  "requiredReviewRoles": ["项目经理"],
  "requiredSections": ["基本信息", "目的与范围", "输入依据", "正文", "证据与引用", "风险与未决问题", "审核结论"]
}
```

and:

```json
{
  "artifactType": "PROJECT_BLUEPRINT",
  "templateKey": "project_blueprint_v1_0",
  "path": "templates/artifacts/project-blueprint.md",
  "requiredReviewRoles": ["项目经理", "质量负责人"],
  "requiredSections": ["立项基线", "流程配置", "文档配置", "Agent 配置", "规则判定", "审核结论"]
}
```

- [x] **Step 4: Implement the compiler**

Use `composeProjectTemplate` to select requirements. Convert selected `CONDITIONAL` items to a fail-safe effective `MANDATORY` status with trace reason `CONDITIONAL_DEFAULT_APPLICABLE`; keep `CONTROLLED` non-gating.

Use this product-neutral role mapping:

```js
const executionByOwnerRole = {
  "项目经理": ["project_manager", "user-project-manager", "pm_agent"],
  "配置管理员": ["configuration_manager", "user-project-manager", "pm_agent"],
  "产品经理": ["product_manager", "user-product-owner", "product_agent"],
  "系统工程师": ["system_engineer", "user-system-lead", "system_agent"],
  "硬件工程师": ["hardware_engineer", "user-ee-lead", "ee_agent"],
  "结构工程师": ["mechanical_engineer", "user-me-lead", "me_agent"],
  "固件工程师": ["firmware_engineer", "user-fw-lead", "fw_agent"],
  "算法工程师": ["algorithm_engineer", "user-fw-lead", "fw_agent"],
  "软件工程师": ["software_engineer", "user-fw-lead", "fw_agent"],
  "测试负责人": ["test_engineer", "user-test-lead", "test_agent"],
  "质量负责人": ["quality_engineer", "user-quality-lead", "quality_agent"],
  "供应链负责人": ["supply_engineer", "user-supply-lead", "supply_agent"],
  "制造负责人": ["manufacturing_engineer", "user-mfg-lead", "manufacturing_agent"],
  "交付负责人": ["delivery_manager", "user-project-manager", "pm_agent"],
  "售后服务负责人": ["operations_manager", "user-project-manager", "pm_agent"]
};
```

The first active S1 work packages receive `READY_FOR_AGENT`; later work packages receive `NOT_STARTED`. Each mandatory requirement creates one gate requirement.

- [x] **Step 5: Run compiler and artifact validation tests**

Run:

```bash
node --test apps/api/src/projectLifecycleCompiler.test.mjs apps/api/src/workflow.test.mjs
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add templates/artifacts/company-controlled-document.md templates/artifacts/project-blueprint.md schemas/artifact-template-registry.json apps/api/src/projectLifecycleCompiler.mjs apps/api/src/projectLifecycleCompiler.test.mjs
git commit -m "Add deterministic project blueprint compiler"
```

---

### Task 4: Build S0-Only Candidates and Automatic Agent Dispatch

**Files:**
- Create: `schemas/s0-candidate-template.json`
- Create: `apps/api/src/candidateProjectBuilder.mjs`
- Create: `apps/api/src/candidateProjectBuilder.test.mjs`
- Create: `apps/api/src/agentDispatcher.mjs`
- Create: `apps/api/src/agentDispatcher.test.mjs`
- Modify: `apps/api/src/storeRepository.mjs`
- Modify: `apps/api/src/storeRepository.test.mjs`

**Interfaces:**
- Produces: `buildS0CandidateGraph(project): ProjectGraph`.
- Produces: `queueReadyAgentJobs(store, { projectId, phaseId, requestedByUserId, now, idFactory }): AgentJob[]`.
- Produces: `queueRevisionAgentJob(store, workPackage, options): AgentJob | null`.

- [x] **Step 1: Write failing S0 boundary tests**

```js
test("candidate graph contains S0 only", () => {
  const graph = buildS0CandidateGraph(project);
  assert.deepEqual(graph.phases.map((item) => item.phaseKey), ["s0_governance"]);
  assert.equal(graph.gates.length, 1);
  assert.equal(graph.workPackages.length, 10);
  assert.equal(graph.gateRequirements.length, 8);
});

test("dispatcher queues ready work once", () => {
  const first = queueReadyAgentJobs(store, options);
  const second = queueReadyAgentJobs(store, options);
  assert.equal(first.length, 10);
  assert.equal(second.length, 0);
  assert.equal(store.agentJobs.length, 10);
});
```

- [x] **Step 2: Run focused tests and verify RED**

Run:

```bash
node --test apps/api/src/candidateProjectBuilder.test.mjs apps/api/src/agentDispatcher.test.mjs
```

Expected: FAIL with missing modules.

- [x] **Step 3: Define the S0 candidate template**

Map the ten S0 document codes to Agent/human roles. Use the existing specialized templates for:

```text
PM-001 -> BUSINESS_CASE / business_case_v0_1 / product_agent
PM-003 -> PROJECT_PLAN / project_plan_v0_1 / pm_agent
PM-006 -> RISK_REGISTER / risk_register_v0_1 / pm_agent
```

Use `COMPANY_CONTROLLED_DOCUMENT / company_controlled_document_v1_0` for the remaining seven. Mark the two `CONTROLLED` documents non-gating.

- [x] **Step 4: Implement candidate graph and idempotent queueing**

The candidate builder creates:

```js
{
  phases: [{ phaseKey: "s0_governance", status: "IN_PROGRESS" }],
  gates: [{ status: "GATE_BLOCKED" }],
  rolePairs,
  workPackages,
  gateRequirements
}
```

The dispatcher queues only work packages in `READY_FOR_AGENT` or `NEEDS_AGENT_REVISION` with no existing `QUEUED` or `RUNNING` job, sets initial work-package status to `READY_FOR_AGENT`, and records `dispatchReason`.

- [x] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
node --test apps/api/src/candidateProjectBuilder.test.mjs apps/api/src/agentDispatcher.test.mjs apps/api/src/storeRepository.test.mjs
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add schemas/s0-candidate-template.json apps/api/src/candidateProjectBuilder.mjs apps/api/src/candidateProjectBuilder.test.mjs apps/api/src/agentDispatcher.mjs apps/api/src/agentDispatcher.test.mjs apps/api/src/storeRepository.mjs apps/api/src/storeRepository.test.mjs
git commit -m "Add S0 candidate graph and Agent dispatch"
```

---

### Task 5: Orchestrate S0 Approval, Blueprint Review, Publication, and Rework

**Files:**
- Modify: `apps/api/src/server.mjs`
- Modify: `apps/api/src/server.test.mjs`
- Modify: `apps/api/src/workflow.test.mjs`
- Modify: `apps/api/src/storeRepository.mjs`
- Modify: `apps/api/src/storeRepository.test.mjs`

**Interfaces:**
- Produces: `createProjectCandidate(body)`.
- Produces: `updateInitiationDefinition(projectId, body)`.
- Produces: `previewProjectBlueprint(projectId)`.
- Produces: `publishProjectBlueprint(projectId, blueprintArtifactId, actorUserId)`.
- Extends: `checkGate`, `approveGate`, `runAgentWorkPackage`, `submitHumanReview`.

- [x] **Step 1: Write failing end-to-end workflow tests**

Add a helper that creates a candidate and assert:

```js
const created = workflow.createProjectCandidate({
  name: "通用新产品候选",
  productConcept: "解决目标客户的检测问题",
  userId: "user-project-manager",
});
assert.equal(created.statusCode, 201);
assert.equal(created.body.phases.length, 1);
assert.equal(created.body.phases[0].phaseKey, "s0_governance");
assert.ok(created.body.agentJobs.length > 0);
assert.equal(created.body.phases.some((item) => item.phaseKey === "s1_market_definition"), false);
```

Cover these independent transitions:

1. incomplete initiation definition adds `INCOMPLETE_INITIATION_DEFINITION` blockers;
2. approved S0 creates one blueprint work package/job and no S1 phase;
3. processing the blueprint job creates a pending `PROJECT_BLUEPRINT` artifact;
4. approving that artifact publishes S1-S10 once and queues S1 jobs;
5. repeating publish returns the existing publication without duplicates;
6. requesting revision automatically queues one replacement job;
7. approving a normal Gate queues the newly active phase.

- [x] **Step 2: Run workflow tests and verify RED**

Run:

```bash
node --test apps/api/src/workflow.test.mjs apps/api/src/server.test.mjs
```

Expected: FAIL because the candidate endpoints and transitions do not exist.

- [x] **Step 3: Add candidate creation and definition update**

`createProjectCandidate` sets:

```js
project.status = "S0_DRAFT";
project.definition = {
  lifecycleMode: "S0_COMPILED",
  lifecycleTemplateKey: "company_product_lifecycle_v1_0",
  initiation: {
    version: 1,
    productConcept,
    projectTypeKey: null,
    targetMarkets: [],
    customerScenarios: [],
    capabilityKeys: [],
    technicalScope: [],
    complianceRequirements: [],
    supplyMode: "",
    deliveryModel: "",
    operationsRequirements: [],
    riskLevel: null
  }
};
```

Append the S0 graph, queue ready Agent work, audit `PROJECT_CANDIDATE_CREATED`, and persist once.

Definition update validates known project and capability keys, increments `version`, updates `updatedAt` and `updatedByUserId`, audits `INITIATION_DEFINITION_UPDATED`, and never creates S1-S10 objects.

- [x] **Step 4: Add S0 Gate blockers and blueprint work**

For an S0 candidate gate, append one blocker per missing or invalid definition field. After all normal Gate evidence and definition checks pass:

- approve and lock S0;
- store `definition.initiationBaseline` as an immutable copy with approval metadata;
- set project status `CONFIGURATION_DRAFT`;
- create one post-Gate `PROJECT_BLUEPRINT` work package bound to `pm_agent`;
- queue its AgentJob.

`runAgentWorkPackage` detects `metadata.workType === "PROJECT_BLUEPRINT"`, compiles from the frozen baseline, renders the blueprint template, validates it, and stores the structured blueprint in `artifact.content.blueprint`.

- [x] **Step 5: Publish only after human blueprint approval**

After `submitHumanReviewInStore` approves a blueprint artifact:

- call `publishProjectBlueprint`;
- require the blueprint artifact to have status `APPROVED`;
- reject an artifact without a valid structured blueprint;
- append the S1-S10 graph atomically;
- set the first S1 phase `IN_PROGRESS`;
- update `project.currentPhaseId`;
- set project status `IN_PROGRESS`;
- record blueprint version and publication audit;
- queue S1 work;
- return publication details with the review response.

On `REQUEST_REVISION`, queue the same work package automatically. On ordinary Gate approval, queue the next phase automatically.

S0 approval, blueprint publication, and any ordinary Gate approval that also appends AgentJob
records must use the existing full-store persistence path rather than the gate-only incremental
transaction, because the latter intentionally rejects unrelated row changes.

- [x] **Step 6: Add HTTP routes**

Register:

```text
POST  /projects/candidates
PATCH /projects/:id/initiation-definition
POST  /projects/:id/blueprint/preview
POST  /projects/:id/blueprint/publish
```

The publish route requires `actorUserId` and `blueprintArtifactId`. The internal review hook calls the same exported function.

- [x] **Step 7: Run workflow and HTTP tests**

Run:

```bash
node --test apps/api/src/workflow.test.mjs apps/api/src/server.test.mjs
```

Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add apps/api/src/server.mjs apps/api/src/server.test.mjs apps/api/src/workflow.test.mjs apps/api/src/storeRepository.mjs apps/api/src/storeRepository.test.mjs
git commit -m "Orchestrate S0 approval and blueprint publication"
```

---

### Task 6: Update the React Workbench for Candidate-First Operation

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- New project form posts to `/projects/candidates`.
- Candidate definition form patches `/projects/:id/initiation-definition`.
- Preview posts to `/projects/:id/blueprint/preview`.
- Product-pack controls are removed.

- [x] **Step 1: Build once before UI edits to establish GREEN**

Run:

```bash
npm run web:build
```

Expected: PASS.

- [x] **Step 2: Replace the default creation action**

Collect `name` and `productConcept`, then:

```ts
api("/projects/candidates", {
  method: "POST",
  body: JSON.stringify({ name, productConcept, userId: actorUserId }),
});
```

Label the action “创建 S0 立项候选” and state that later stages are not generated until approval.

- [x] **Step 3: Add the S0 definition editor**

When `project.project.definition.lifecycleMode === "S0_COMPILED"` and the current phase is S0, show:

- project type select from `/standards/project-types`;
- capability checkboxes from `/standards/capability-packs`;
- comma-separated target markets, customer scenarios, technical scope, compliance, and operations;
- supply mode, delivery model, and risk level;
- current definition version and missing-field summary.

Save through the PATCH endpoint and refresh the project view.

- [x] **Step 4: Convert preview to project-bound blueprint preview**

Remove product-pack state, requests, controls, and copy. For a candidate with a complete definition, call `/projects/:id/blueprint/preview`; otherwise explain which S0 fields still block compilation.

Show:

- current project status;
- S0-only boundary before approval;
- compiled phase/document/Agent counts;
- queued Agent tasks;
- human review required before publication.

- [x] **Step 5: Build and visually inspect**

Run:

```bash
npm run web:build
```

Then start the app and inspect the candidate creation, S0 edit, Agent queue, blueprint preview, and legacy project views in the browser.

Expected: build passes; no HFCT or product-pack controls appear; legacy project pages remain usable.

- [x] **Step 6: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/styles.css
git commit -m "Make S0 candidates the default project flow"
```

---

### Task 7: Update Operating Documentation and Run Full Verification

**Files:**
- Modify: `docs/project-creation.md`
- Modify: `docs/workflow-spine.md`
- Modify: `docs/agent-definitions.md`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-07-31-s0-agent-driven-lifecycle.md`

**Interfaces:**
- Documents the candidate-to-blueprint-to-active flow and legacy compatibility.
- Marks completed plan steps only after their test and commit evidence exists.

- [x] **Step 1: Update user and API documentation**

Document:

```text
创建 S0 候选
→ Agent 自动执行 S0 工作包
→ 人员审核
→ S0 Gate 批准
→ Agent 提交项目蓝图
→ 项目负责人审核
→ 发布 S1-S10
→ Agent 自动执行下一阶段
```

Explicitly state that `POST /projects` is legacy compatibility and
`POST /projects/candidates` is the default new-project path.

- [x] **Step 2: Run focused regression tests**

Run:

```bash
node --test apps/api/src/companyStandardStore.test.mjs apps/api/src/projectTemplateComposer.test.mjs apps/api/src/postgresMapper.test.mjs apps/api/src/projectLifecycleCompiler.test.mjs apps/api/src/candidateProjectBuilder.test.mjs apps/api/src/agentDispatcher.test.mjs apps/api/src/storeRepository.test.mjs apps/api/src/workflow.test.mjs apps/api/src/server.test.mjs
```

Expected: PASS with zero failures.

- [x] **Step 3: Run the complete project verification**

Run:

```bash
npm run check
git diff --check
git status --short
```

Expected:

- all Node tests pass;
- React production build passes;
- smoke, store doctor, persistence, migration, schema, export, restore, import, and sync checks pass;
- `git diff --check` has no output;
- status contains only the plan checkbox/documentation update before the final commit.

- [x] **Step 4: Review requirement coverage**

Confirm every acceptance item in correction spec section 12 has code or test evidence. Record any deliberately deferred item explicitly; do not report it as complete.

- [ ] **Step 5: Commit final documentation**

```bash
git add README.md docs/project-creation.md docs/workflow-spine.md docs/agent-definitions.md docs/superpowers/plans/2026-07-31-s0-agent-driven-lifecycle.md
git commit -m "Document the Agent-driven lifecycle flow"
```

---

### Task 8: Prove LAN Pilot Readiness and Publish the Handoff

**Files:**
- Create: `apps/api/src/s0LifecycleRehearsal.mjs`
- Create: `apps/api/src/s0LifecycleRehearsal.test.mjs`
- Modify: `package.json`
- Modify: `docs/internal-pilot.md`
- Modify: `docs/lan-deployment.md`
- Create: `自动接续说明.md`

- [ ] **Step 1: Add an isolated S0-to-S1 rehearsal**

Use a temporary JSON store to create an S0 candidate, save a complete initiation definition,
process and approve S0 work, approve S0 Gate, process and approve the blueprint, publish
S1-S10, and verify S1 Agent jobs are queued.

- [ ] **Step 2: Include the S0 rehearsal in the pilot gate**

Add `pilot:rehearse:s0` and run it from `pilot:check` alongside the legacy EVT rehearsal.

- [ ] **Step 3: Run the complete pilot check**

Run `npm run pilot:check`. PostgreSQL preflight may report an environment blocker when
`DATABASE_URL` is absent, but JSON-backed LAN pilot checks must pass.

- [ ] **Step 4: Start in LAN mode and verify live endpoints**

Start with a temporary store, `HOST=0.0.0.0`, a non-default port, and a pilot access code.
Verify `/health`, `/ready`, `/runtime/network`, protected data access, candidate creation, and
the React workbench.

- [ ] **Step 5: Create cross-device handoff and commit**

Document exact clone, branch, install, verification, LAN start, access-code, data-volume, and
known-boundary instructions in `自动接续说明.md`.

- [ ] **Step 6: Push the verified branch to GitHub**

Push `codex/agent-driven-lifecycle` and confirm the remote branch points to the final commit.
