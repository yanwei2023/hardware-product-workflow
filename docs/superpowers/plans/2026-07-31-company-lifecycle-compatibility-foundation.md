# Company Lifecycle Compatibility Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only company lifecycle standards foundation and project-template preview to the existing application without changing existing project creation, persisted stores, APIs, or pilot behavior.

**Architecture:** Add validated JSON registries for the 100 document definitions, project types, capability packs, product packs, and lifecycle templates. Compose those registries through focused API modules, expose read-only standards and preview endpoints, and add a preview panel to the existing React project page. Persistence and actual creation of S0-S10 projects are deliberately deferred to the next independently testable plan.

**Tech Stack:** Node.js ESM, TypeScript/JavaScript, React, Vite, JSON registries, Node test runner.

## Global Constraints

- Work in the existing `hardware-product-workflow` repository and current branch.
- Do not create another backend service, frontend application, or repository.
- Do not rename or remove existing Project, Phase, Gate, WorkPackage, ArtifactVersion, Review, Risk, notification, audit, or persistence interfaces.
- Do not change the behavior of `POST /projects` in this batch.
- Do not add required arrays or columns to persisted stores or PostgreSQL in this batch.
- Keep `hardware-phase-template.json` and the current seven-phase pilot behavior unchanged.
- Add no external runtime dependencies.
- Keep all 303 existing tests passing.
- Add tests before each implementation change.
- Use the confirmed source of truth at `docs/superpowers/specs/2026-07-31-company-product-lifecycle-platform-design.md`.

## File Structure

**Create**

- `schemas/company-document-definition-registry.json` — the 100 canonical document definitions and their source/level metadata.
- `schemas/project-type-registry.json` — project-type metadata and included document codes.
- `schemas/capability-pack-registry.json` — capability-pack metadata and included document codes.
- `schemas/product-pack-registry.json` — product-specific packs; initially contains the HFCT example pack.
- `schemas/company-product-lifecycle-template.json` — S0-S10 phase order, gate names, and document codes.
- `schemas/lifecycle-template-registry.json` — discoverable metadata for legacy and company lifecycle templates.
- `apps/api/src/companyStandardStore.mjs` — loads and validates document/project/capability/product registries.
- `apps/api/src/companyStandardStore.test.mjs` — validates exact counts, unique codes, source references, and levels.
- `apps/api/src/lifecycleTemplateStore.mjs` — resolves legacy and company lifecycle templates.
- `apps/api/src/lifecycleTemplateStore.test.mjs` — validates template lookup and S0-S10 coverage.
- `apps/api/src/projectTemplateComposer.mjs` — composes a non-persistent project preview from selected template and packs.
- `apps/api/src/projectTemplateComposer.test.mjs` — verifies inclusion, exclusion, applicability, and summaries.

**Modify**

- `apps/api/src/server.mjs` — add read-only standards and project-preview functions/routes.
- `apps/api/src/server.test.mjs` — cover the new endpoints and error responses.
- `apps/api/src/runtimeWritePolicy.mjs` — classify the non-persistent preview POST as a read operation.
- `apps/api/src/runtimeWritePolicy.test.mjs` — prove preview remains available in read-only runtime mode.
- `apps/web/src/App.tsx` — add a read-only company process preview panel to the existing project page.
- `apps/web/src/styles.css` — add only the layout styles required by the preview panel.
- `docs/project-creation.md` — document the preview API and clarify that persisted S0-S10 creation is the next batch.

---

### Task 1: Company Standards Registries

**Files:**
- Create: `schemas/company-document-definition-registry.json`
- Create: `schemas/project-type-registry.json`
- Create: `schemas/capability-pack-registry.json`
- Create: `schemas/product-pack-registry.json`
- Create: `apps/api/src/companyStandardStore.mjs`
- Test: `apps/api/src/companyStandardStore.test.mjs`

**Interfaces:**
- Produces: `getCompanyDocumentDefinitions(): Array<DocumentDefinition>`
- Produces: `getProjectTypes(): Array<ProjectTypeDefinition>`
- Produces: `getCapabilityPacks(): Array<PackDefinition>`
- Produces: `getProductPacks(): Array<PackDefinition>`
- Produces: `validateCompanyStandards(): string[]`
- `DocumentDefinition.sourceCategory` is one of `COMPANY_COMMON`, `PROJECT_TYPE`, `CAPABILITY_PACK`, `PRODUCT_PACK`.
- `DocumentDefinition.defaultRequirementLevel` is one of `MANDATORY`, `CONDITIONAL`, `CONTROLLED`.

- [ ] **Step 1: Write the failing registry validation tests**

Create `apps/api/src/companyStandardStore.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  getCapabilityPacks,
  getCompanyDocumentDefinitions,
  getProductPacks,
  getProjectTypes,
  validateCompanyStandards,
} from "./companyStandardStore.mjs";

test("company standards contain all 100 uniquely numbered documents", () => {
  const documents = getCompanyDocumentDefinitions();
  assert.equal(documents.length, 100);
  assert.deepEqual(
    documents.map((item) => item.sequence),
    Array.from({ length: 100 }, (_, index) => index + 1),
  );
  assert.equal(new Set(documents.map((item) => item.code)).size, 100);
});

test("company standards preserve the approved requirement-level totals", () => {
  const totals = getCompanyDocumentDefinitions().reduce(
    (result, item) => ({ ...result, [item.defaultRequirementLevel]: result[item.defaultRequirementLevel] + 1 }),
    { MANDATORY: 0, CONDITIONAL: 0, CONTROLLED: 0 },
  );
  assert.deepEqual(totals, { MANDATORY: 87, CONDITIONAL: 8, CONTROLLED: 5 });
});

test("company standards reference declared project and pack sources", () => {
  assert.ok(getProjectTypes().some((item) => item.key === "new_product_development"));
  assert.ok(getCapabilityPacks().some((item) => item.key === "electronic_hardware"));
  assert.ok(getProductPacks().some((item) => item.key === "hfct"));
  assert.deepEqual(validateCompanyStandards(), []);
});
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run:

```bash
node --test apps/api/src/companyStandardStore.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `companyStandardStore.mjs`.

- [ ] **Step 3: Create the four JSON registries**

Use section 14 of the approved design specification as the exact 100-row source. Store each document as:

```json
{
  "sequence": 1,
  "code": "PM-001",
  "name": "项目建议书",
  "phaseKey": "s0_governance",
  "sourceCategory": "COMPANY_COMMON",
  "sourceKey": "company",
  "defaultRequirementLevel": "MANDATORY",
  "ownerRole": "产品经理",
  "reviewRoles": ["技术负责人", "市场负责人", "财务负责人"],
  "approvalRole": "项目发起人",
  "artifactTemplateKey": null
}
```

Use these phase keys for all entries:

```text
s0_governance
s1_market_definition
s2_requirements_feasibility
s3_system_design
s4_detailed_design
s5_evt
s6_dvt
s7_pvt
s8_release
s9_delivery_operations
s10_lifecycle
```

Represent `包内必需` as `defaultRequirementLevel: "MANDATORY"` with a non-company source category. Preserve the approved totals: 87 mandatory, 8 conditional, and 5 controlled.

Create project type keys:

```text
new_product_development
derivative_product
technology_poc
software_platform
customer_custom_product
product_delivery
major_engineering_change
product_eol
```

Create capability pack keys:

```text
electronic_hardware
embedded_firmware
fpga
algorithm_ai
structure_industrial_design
software_application
data_platform
network_security
certification_metrology
reliability
manufacturing_supply_chain
field_installation
customer_delivery
after_sales_operations
physical_product_validation
measurement_signal_chain
sales_enablement
```

Create one product pack:

```json
{
  "key": "hfct",
  "name": "HFCT产品专用包",
  "documentCodes": [
    "FS-002",
    "HW-001",
    "ALG-001",
    "ALG-002",
    "ME-002",
    "TEST-002",
    "TEST-004",
    "TEST-005"
  ]
}
```

- [ ] **Step 4: Implement the standards loader and validator**

Create `apps/api/src/companyStandardStore.mjs`:

```js
import documentRegistry from "../../../schemas/company-document-definition-registry.json" with { type: "json" };
import projectTypeRegistry from "../../../schemas/project-type-registry.json" with { type: "json" };
import capabilityPackRegistry from "../../../schemas/capability-pack-registry.json" with { type: "json" };
import productPackRegistry from "../../../schemas/product-pack-registry.json" with { type: "json" };

const phaseKeys = new Set([
  "s0_governance",
  "s1_market_definition",
  "s2_requirements_feasibility",
  "s3_system_design",
  "s4_detailed_design",
  "s5_evt",
  "s6_dvt",
  "s7_pvt",
  "s8_release",
  "s9_delivery_operations",
  "s10_lifecycle",
]);
const sourceCategories = new Set(["COMPANY_COMMON", "PROJECT_TYPE", "CAPABILITY_PACK", "PRODUCT_PACK"]);
const requirementLevels = new Set(["MANDATORY", "CONDITIONAL", "CONTROLLED"]);

export function getCompanyDocumentDefinitions() {
  return documentRegistry.documents;
}

export function getProjectTypes() {
  return projectTypeRegistry.projectTypes;
}

export function getCapabilityPacks() {
  return capabilityPackRegistry.capabilityPacks;
}

export function getProductPacks() {
  return productPackRegistry.productPacks;
}

export function validateCompanyStandards() {
  const errors = [];
  const documents = getCompanyDocumentDefinitions();
  const codes = new Set();
  const sourceKeys = {
    PROJECT_TYPE: new Set(getProjectTypes().map((item) => item.key)),
    CAPABILITY_PACK: new Set(getCapabilityPacks().map((item) => item.key)),
    PRODUCT_PACK: new Set(getProductPacks().map((item) => item.key)),
  };

  for (const document of documents) {
    if (codes.has(document.code)) errors.push(`duplicate document code ${document.code}`);
    codes.add(document.code);
    if (!phaseKeys.has(document.phaseKey)) errors.push(`unknown phase ${document.phaseKey} for ${document.code}`);
    if (!sourceCategories.has(document.sourceCategory)) errors.push(`unknown source category for ${document.code}`);
    if (!requirementLevels.has(document.defaultRequirementLevel)) errors.push(`unknown level for ${document.code}`);
    if (document.sourceCategory !== "COMPANY_COMMON" && !sourceKeys[document.sourceCategory]?.has(document.sourceKey)) {
      errors.push(`unknown source ${document.sourceCategory}:${document.sourceKey} for ${document.code}`);
    }
  }

  for (const [sourceCategory, registry] of [
    ["PROJECT_TYPE", getProjectTypes()],
    ["CAPABILITY_PACK", getCapabilityPacks()],
    ["PRODUCT_PACK", getProductPacks()],
  ]) {
    for (const source of registry) {
      for (const documentCode of source.documentCodes) {
        const document = documents.find((item) => item.code === documentCode);
        if (!document) {
          errors.push(`unknown document ${documentCode} in ${sourceCategory}:${source.key}`);
        } else if (document.sourceCategory !== sourceCategory || document.sourceKey !== source.key) {
          errors.push(`source mismatch for ${documentCode} in ${sourceCategory}:${source.key}`);
        }
      }
    }
  }
  return errors;
}
```

The validator must also report a non-company document that is missing from its source registry's `documentCodes`. This makes the document definition and its owning project/capability/product registry agree in both directions.

- [ ] **Step 5: Run the focused test**

Run:

```bash
node --test apps/api/src/companyStandardStore.test.mjs
```

Expected: PASS, 3 tests.

- [ ] **Step 6: Commit the standards registries**

```bash
git add schemas/company-document-definition-registry.json schemas/project-type-registry.json schemas/capability-pack-registry.json schemas/product-pack-registry.json apps/api/src/companyStandardStore.mjs apps/api/src/companyStandardStore.test.mjs
git commit -m "Add company lifecycle standards registries"
```

---

### Task 2: Lifecycle Template Registry

**Files:**
- Create: `schemas/company-product-lifecycle-template.json`
- Create: `schemas/lifecycle-template-registry.json`
- Create: `apps/api/src/lifecycleTemplateStore.mjs`
- Test: `apps/api/src/lifecycleTemplateStore.test.mjs`

**Interfaces:**
- Consumes: `getCompanyDocumentDefinitions()`
- Produces: `getLifecycleTemplateSummaries(): Array<LifecycleTemplateSummary>`
- Produces: `findLifecycleTemplate(templateKey: string): LifecycleTemplate | null`
- Produces: `validateLifecycleTemplates(): string[]`

- [ ] **Step 1: Write the failing lifecycle-template tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  findLifecycleTemplate,
  getLifecycleTemplateSummaries,
  validateLifecycleTemplates,
} from "./lifecycleTemplateStore.mjs";

test("lifecycle registry keeps the legacy seven-phase template", () => {
  const template = findLifecycleTemplate("standard_hardware_development_v0_1");
  assert.equal(template.phases.length, 7);
  assert.equal(template.compatibilityMode, "LEGACY_WORK_PACKAGES");
});

test("company template covers S0 through S10 exactly once", () => {
  const template = findLifecycleTemplate("company_product_lifecycle_v1_0");
  assert.equal(template.phases.length, 11);
  assert.deepEqual(template.phases.map((phase) => phase.sequence), [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  assert.equal(template.phases.flatMap((phase) => phase.documentCodes).length, 100);
  assert.deepEqual(validateLifecycleTemplates(), []);
});

test("lifecycle registry exposes discoverable summaries", () => {
  assert.deepEqual(
    getLifecycleTemplateSummaries().map((item) => item.templateKey),
    ["standard_hardware_development_v0_1", "company_product_lifecycle_v1_0"],
  );
});
```

- [ ] **Step 2: Run and verify the missing module failure**

Run:

```bash
node --test apps/api/src/lifecycleTemplateStore.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Create the company lifecycle template**

Create `schemas/company-product-lifecycle-template.json` with:

```json
{
  "templateKey": "company_product_lifecycle_v1_0",
  "name": "公司产品全生命周期流程",
  "version": "1.0.0",
  "projectTypeKey": "new_product_development",
  "compatibilityMode": "DOCUMENT_REQUIREMENTS_PREVIEW",
  "phases": [
    {
      "phaseKey": "s0_governance",
      "name": "立项与治理",
      "sequence": 0,
      "gateName": "立项评审",
      "documentCodes": ["PM-001", "PM-002", "PM-003", "PM-004", "PM-005", "PM-006", "CM-001", "CM-002", "CM-003", "CM-004"]
    }
  ]
}
```

Add the remaining ten phases with the exact code ranges from the approved 100-document list:

```text
S1: MR-001 through MR-008
S2: PRD-001, REQ-001, REQ-002, FS-001, FS-002, FS-003, UX-001, COST-001, FMEA-001, REVIEW-002
S3: SYS-001 through SYS-007
S4: HW-001 through HW-005, FW-001, FW-002, ALG-001, ALG-002, SW-001, SW-002, ME-001, ME-002, DFMEA-002, REVIEW-003
S5: EVT-001, EVT-002, TEST-001 through TEST-005, BUG-001, EVT-003, REVIEW-004
S6: DVT-001 through DVT-008, REVIEW-005
S7: MFG-001 through MFG-005, SCM-001, PVT-001, PVT-002, REVIEW-006
S8: CERT-001, CERT-002, REL-001 through REL-006, REVIEW-007
S9: DEL-001 through DEL-004, OPS-001 through OPS-003
S10: CHG-001, QA-001, REL-007, LCM-001 through LCM-003
```

- [ ] **Step 4: Implement registry lookup and validation**

Create `lifecycle-template-registry.json` with ordered metadata for:

```text
standard_hardware_development_v0_1 -> hardware-phase-template.json
company_product_lifecycle_v1_0 -> company-product-lifecycle-template.json
```

Import the existing `hardware-phase-template.json`, the new company template, and the registry metadata. Use the registry metadata as the source of discovery order, resolve each metadata entry through an explicit in-memory template map, and report a validation error if registry metadata refers to an unloaded template. Normalize the legacy template with `compatibilityMode: "LEGACY_WORK_PACKAGES"` without changing its source JSON.

Validation must report:

- duplicate template keys;
- duplicate phase keys in one template;
- duplicate document codes;
- document codes missing from the company document registry;
- company documents omitted from the S0-S10 template.

- [ ] **Step 5: Run the focused test**

Run:

```bash
node --test apps/api/src/lifecycleTemplateStore.test.mjs
```

Expected: PASS, 3 tests.

- [ ] **Step 6: Commit the lifecycle templates**

```bash
git add schemas/company-product-lifecycle-template.json schemas/lifecycle-template-registry.json apps/api/src/lifecycleTemplateStore.mjs apps/api/src/lifecycleTemplateStore.test.mjs
git commit -m "Add company S0-S10 lifecycle template"
```

---

### Task 3: Non-Persistent Project Template Composer

**Files:**
- Create: `apps/api/src/projectTemplateComposer.mjs`
- Test: `apps/api/src/projectTemplateComposer.test.mjs`

**Interfaces:**
- Consumes: `findLifecycleTemplate(templateKey)`
- Consumes: company standards getters from `companyStandardStore.mjs`
- Produces:

```ts
composeProjectTemplate(input: {
  templateKey: string;
  capabilityKeys?: string[];
  productPackKeys?: string[];
}): {
  template: { templateKey: string; name: string; version: string };
  selectedCapabilityKeys: string[];
  selectedProductPackKeys: string[];
  phases: Array<{
    phaseKey: string;
    name: string;
    sequence: number;
    gateName: string;
    documentRequirements: Array<{
      documentCode: string;
      documentName: string;
      sourceCategory: string;
      sourceKey: string;
      defaultRequirementLevel: "MANDATORY" | "CONDITIONAL" | "CONTROLLED";
      effectiveRequirementLevel: "MANDATORY" | "CONDITIONAL" | "CONTROLLED";
      applicabilityStatus: "APPLICABLE" | "UNASSESSED";
    }>;
  }>;
  summary: {
    phaseCount: number;
    documentCount: number;
    mandatoryCount: number;
    conditionalCount: number;
    controlledCount: number;
    unresolvedApplicabilityCount: number;
  };
}
```

- [ ] **Step 1: Write failing composition tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { composeProjectTemplate } from "./projectTemplateComposer.mjs";

test("generic new product preview excludes HFCT documents unless selected", () => {
  const result = composeProjectTemplate({ templateKey: "company_product_lifecycle_v1_0" });
  const codes = result.phases.flatMap((phase) => phase.documentRequirements.map((item) => item.documentCode));
  assert.equal(result.summary.phaseCount, 11);
  assert.ok(codes.includes("PM-001"));
  assert.ok(!codes.includes("FS-002"));
  assert.ok(!codes.includes("HW-001"));
});

test("selected capability and product packs add only their documents", () => {
  const result = composeProjectTemplate({
    templateKey: "company_product_lifecycle_v1_0",
    capabilityKeys: ["electronic_hardware", "embedded_firmware"],
    productPackKeys: ["hfct"],
  });
  const codes = result.phases.flatMap((phase) => phase.documentRequirements.map((item) => item.documentCode));
  assert.ok(codes.includes("HW-003"));
  assert.ok(codes.includes("FW-001"));
  assert.ok(codes.includes("FS-002"));
  assert.ok(!codes.includes("FW-002"));
});

test("conditional documents remain unresolved in the preview", () => {
  const result = composeProjectTemplate({ templateKey: "company_product_lifecycle_v1_0" });
  const poc = result.phases.flatMap((phase) => phase.documentRequirements).find((item) => item.documentCode === "FS-003");
  assert.equal(poc.effectiveRequirementLevel, "CONDITIONAL");
  assert.equal(poc.applicabilityStatus, "UNASSESSED");
  assert.ok(result.summary.unresolvedApplicabilityCount > 0);
});

test("unknown templates and packs produce explicit validation errors", () => {
  assert.throws(
    () => composeProjectTemplate({ templateKey: "unknown" }),
    /unknown lifecycle template/,
  );
  assert.throws(
    () => composeProjectTemplate({ templateKey: "company_product_lifecycle_v1_0", capabilityKeys: ["unknown"] }),
    /unknown capability pack/,
  );
});
```

- [ ] **Step 2: Run and verify the missing module failure**

Run:

```bash
node --test apps/api/src/projectTemplateComposer.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement deterministic composition**

Composition rules:

```js
function sourceIsSelected(document, template, selectedCapabilityKeys, selectedProductPackKeys) {
  if (document.sourceCategory === "COMPANY_COMMON") return true;
  if (document.sourceCategory === "PROJECT_TYPE") return document.sourceKey === template.projectTypeKey;
  if (document.sourceCategory === "CAPABILITY_PACK") return selectedCapabilityKeys.has(document.sourceKey);
  if (document.sourceCategory === "PRODUCT_PACK") return selectedProductPackKeys.has(document.sourceKey);
  return false;
}
```

For included documents:

```js
const applicabilityStatus =
  document.defaultRequirementLevel === "CONDITIONAL" ? "UNASSESSED" : "APPLICABLE";
```

Sort phases by sequence and documents by the canonical `sequence`. Never mutate imported JSON objects.

- [ ] **Step 4: Run the focused test**

Run:

```bash
node --test apps/api/src/projectTemplateComposer.test.mjs
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit the composer**

```bash
git add apps/api/src/projectTemplateComposer.mjs apps/api/src/projectTemplateComposer.test.mjs
git commit -m "Add lifecycle template preview composer"
```

---

### Task 4: Standards and Preview API

**Files:**
- Modify: `apps/api/src/server.mjs`
- Test: `apps/api/src/server.test.mjs`
- Modify: `apps/api/src/runtimeWritePolicy.mjs`
- Test: `apps/api/src/runtimeWritePolicy.test.mjs`

**Interfaces:**
- Consumes: standards getters, `getLifecycleTemplateSummaries()`, and `composeProjectTemplate()`
- Produces: `GET /standards/lifecycle-templates`
- Produces: `GET /standards/document-definitions`
- Produces: `GET /standards/project-types`
- Produces: `GET /standards/capability-packs`
- Produces: `GET /standards/product-packs`
- Produces: `POST /projects/preview`

- [ ] **Step 1: Add failing HTTP tests**

Add tests to `apps/api/src/server.test.mjs`:

```js
test("standards endpoints expose lifecycle templates and document definitions", async () => {
  const templates = await dispatch("/standards/lifecycle-templates");
  assert.equal(templates.status, 200);
  assert.ok(templates.body.templates.some((item) => item.templateKey === "company_product_lifecycle_v1_0"));

  const documents = await dispatch("/standards/document-definitions?phaseKey=s0_governance");
  assert.equal(documents.status, 200);
  assert.equal(documents.body.documents.length, 10);

  const projectTypes = await dispatch("/standards/project-types");
  assert.equal(projectTypes.status, 200);
  assert.ok(projectTypes.body.projectTypes.some((item) => item.key === "new_product_development"));
});

test("project preview composes selected packs without persisting a project", async () => {
  const before = (await dispatch("/projects/demo")).body.projectSummaries.length;
  const preview = await dispatch("/projects/preview", {
    method: "POST",
    body: JSON.stringify({
      templateKey: "company_product_lifecycle_v1_0",
      capabilityKeys: ["electronic_hardware"],
      productPackKeys: [],
    }),
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.summary.phaseCount, 11);
  assert.ok(preview.body.phases.some((phase) => phase.phaseKey === "s4_detailed_design"));
  const after = (await dispatch("/projects/demo")).body.projectSummaries.length;
  assert.equal(after, before);
});

test("project preview rejects unknown standard keys", async () => {
  const result = await dispatch("/projects/preview", {
    method: "POST",
    body: JSON.stringify({ templateKey: "unknown" }),
  });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /unknown lifecycle template/);
});

test("read-only runtime permits project preview but still rejects project creation", async () => {
  workflow.setRuntimeWriteModeForTest("read-only");
  const preview = await dispatch("/projects/preview", {
    method: "POST",
    body: JSON.stringify({ templateKey: "company_product_lifecycle_v1_0" }),
  });
  const create = await dispatch("/projects", {
    method: "POST",
    body: JSON.stringify({ name: "should-not-be-created" }),
  });
  assert.equal(preview.status, 200);
  assert.equal(create.status, 409);
});
```

- [ ] **Step 2: Run the focused tests and verify 404 failures**

Run:

```bash
node --test --test-name-pattern="standards endpoints|project preview" apps/api/src/server.test.mjs
```

Expected: FAIL because the new routes return 404.

- [ ] **Step 3: Add pure exported API functions**

Add:

```js
export function getLifecycleStandards() {
  return { statusCode: 200, body: { templates: getLifecycleTemplateSummaries() } };
}

export function getDocumentStandards(filters = {}) {
  const documents = getCompanyDocumentDefinitions()
    .filter((item) => !filters.phaseKey || item.phaseKey === filters.phaseKey)
    .filter((item) => !filters.sourceCategory || item.sourceCategory === filters.sourceCategory)
    .filter((item) => !filters.sourceKey || item.sourceKey === filters.sourceKey)
    .map((item) => ({ ...item }));
  return { statusCode: 200, body: { documents } };
}

export function getProjectTypeStandards() {
  return { statusCode: 200, body: { projectTypes: getProjectTypes() } };
}

export function getCapabilityPackStandards() {
  return { statusCode: 200, body: { capabilityPacks: getCapabilityPacks() } };
}

export function getProductPackStandards() {
  return { statusCode: 200, body: { productPacks: getProductPacks() } };
}

export function previewProjectTemplate(body = {}) {
  try {
    return { statusCode: 200, body: composeProjectTemplate(body) };
  } catch (error) {
    return validationError(error instanceof Error ? error.message : String(error));
  }
}
```

Filter `GET /standards/document-definitions` by optional `phaseKey`, `sourceCategory`, and `sourceKey` query parameters without mutating the registry.

- [ ] **Step 4: Add routes using existing response helpers**

Register the five `GET /standards/...` routes and `POST /projects/preview` before the generic 404 route. The preview route must read its JSON body, call `previewProjectTemplate()`, and pass its `statusCode` and `body` to the existing `writeJson()` helper. Keep `POST /projects` untouched.

- [ ] **Step 5: Update runtime write classification**

In `apps/api/src/runtimeWritePolicy.mjs`, keep all existing mutation classification behavior but treat these two POST routes as non-persistent:

```js
const nonPersistentPostPaths = new Set([
  "/projects/import/validate",
  "/projects/preview",
]);
```

Extend `apps/api/src/runtimeWritePolicy.test.mjs` so `isRuntimeMutationRequest("POST", "/projects/preview")` is false while `POST /projects` remains true.

- [ ] **Step 6: Run focused and full API tests**

Run:

```bash
node --test --test-name-pattern="standards endpoints|project preview" apps/api/src/server.test.mjs
node --test apps/api/src/runtimeWritePolicy.test.mjs
node --test apps/api/src/server.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit the read-only API**

```bash
git add apps/api/src/server.mjs apps/api/src/server.test.mjs apps/api/src/runtimeWritePolicy.mjs apps/api/src/runtimeWritePolicy.test.mjs
git commit -m "Expose lifecycle standards preview API"
```

---

### Task 5: Existing React Project Page Preview

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: `GET /standards/lifecycle-templates`, `GET /standards/capability-packs`, `GET /standards/product-packs`, and `POST /projects/preview`.
- Produces: a `LifecycleTemplatePreview` component rendered inside the existing Projects view.
- Does not alter the existing Create Project button or its `POST /projects` body.

- [ ] **Step 1: Add preview state and loading behavior**

Inside the existing project-management component, add:

```tsx
const [lifecycleTemplates, setLifecycleTemplates] = useState<any[]>([]);
const [capabilityPacks, setCapabilityPacks] = useState<any[]>([]);
const [productPacks, setProductPacks] = useState<any[]>([]);
const [previewTemplateKey, setPreviewTemplateKey] = useState("company_product_lifecycle_v1_0");
const [previewCapabilityKeys, setPreviewCapabilityKeys] = useState<string[]>([]);
const [previewProductPackKeys, setPreviewProductPackKeys] = useState<string[]>([]);
const [templatePreview, setTemplatePreview] = useState<any | null>(null);
const [previewError, setPreviewError] = useState("");
```

Load the three registries with the existing `api()` helper when the Projects view mounts. Treat load failures as panel-local errors so existing project management remains usable.

Because `POST /projects/preview` is computational and non-persistent, add it to the existing `mutationRequest` exception alongside `/projects/import/validate`. Do not weaken the read-only guard for any other POST route.

- [ ] **Step 2: Add the preview action**

```tsx
async function previewLifecycleTemplate() {
  setPreviewError("");
  try {
    const result = await api("/projects/preview", {
      method: "POST",
      body: JSON.stringify({
        templateKey: previewTemplateKey,
        capabilityKeys: previewCapabilityKeys,
        productPackKeys: previewProductPackKeys,
      }),
    });
    setTemplatePreview(result);
  } catch (error) {
    setTemplatePreview(null);
    setPreviewError(error instanceof Error ? error.message : String(error));
  }
}
```

- [ ] **Step 3: Render a separate read-only preview panel**

Render:

- template selector;
- capability-pack checkboxes;
- product-pack checkboxes;
- Preview button;
- summary metrics for phases, documents, mandatory, conditional, controlled, and unresolved applicability;
- one compact row per phase with its document count;
- explicit text: `当前为标准预览，不会创建或修改项目。`

Do not add the selected template or packs to the existing `POST /projects` request in this batch.

- [ ] **Step 4: Add scoped styles**

Add only classes prefixed with `.lifecycle-preview-` for checkbox grids, summary rows, and phase rows. Reuse existing panel, metric, button, and badge styles.

- [ ] **Step 5: Build the React application**

Run:

```bash
npm run web:build
```

Expected: Vite build succeeds with no TypeScript errors.

- [ ] **Step 6: Commit the preview UI**

```bash
git add apps/web/src/App.tsx apps/web/src/styles.css
git commit -m "Add company lifecycle preview to project page"
```

---

### Task 6: Documentation and Release Verification

**Files:**
- Modify: `docs/project-creation.md`

**Interfaces:**
- Documents the exact behavior delivered by Tasks 1-5.
- Declares persisted S0-S10 project creation, project-level overrides, version signoff, and baselines as subsequent plans.

- [ ] **Step 1: Update project-creation documentation**

Document:

```text
GET /standards/lifecycle-templates
GET /standards/document-definitions
GET /standards/project-types
GET /standards/capability-packs
GET /standards/product-packs
POST /projects/preview
```

Include a preview request:

```json
{
  "templateKey": "company_product_lifecycle_v1_0",
  "capabilityKeys": ["electronic_hardware", "embedded_firmware"],
  "productPackKeys": []
}
```

State explicitly that this batch is read-only and that existing `POST /projects` behavior is unchanged.

- [ ] **Step 2: Run standards validation tests**

```bash
node --test apps/api/src/companyStandardStore.test.mjs apps/api/src/lifecycleTemplateStore.test.mjs apps/api/src/projectTemplateComposer.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Run the complete verification suite**

```bash
npm run check
git diff --check
```

Expected:

- all existing and new tests pass through the repository's complete `check` workflow;
- Vite build succeeds;
- smoke succeeds;
- the current JSON store remains valid;
- no whitespace errors.

- [ ] **Step 4: Confirm no persistence drift**

Run:

```bash
git diff -- schemas/database.sql migrations/001_initial_schema.sql apps/api/src/postgresMapper.mjs apps/api/src/storeDoctor.mjs
```

Expected: no output. This batch must not change persisted schemas.

- [ ] **Step 5: Commit the documentation**

```bash
git add docs/project-creation.md
git commit -m "Document lifecycle standards preview"
```

## Follow-on Plans

After this foundation passes review, create separate plans in this order:

1. Persisted S0-S10 project creation, project document requirement instances, and additive JSON/PostgreSQL schema changes.
2. Applicability decisions, manual level adjustment, and two-person downgrade approval.
3. Document master records, exact version-bound reviews, multi-role signoff, and version state transitions.
4. Stage baselines, typed trace links, stale-impact assessment, and enhanced gate computation.
5. ECR/ECN, CAPA, release, product-to-delivery project derivation, operations, and EOL.
6. Company standards administration UI and production authorization.
