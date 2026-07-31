# S0 立项后编译、Agent 驱动执行增量修订设计

日期：2026-07-31

状态：用户已逐节确认

适用仓库：`hardware-product-workflow`

关联设计：`2026-07-31-company-product-lifecycle-platform-design.md`

## 1. 修订目的和优先级

本修订不新建系统，也不推翻现有 Project、Phase、Gate、RolePair、
WorkPackage、ArtifactVersion、Review、Risk、AgentRun、Notification、
AuditEvent、JSON store 或 PostgreSQL 链路。

本修订解决三个边界错误：

1. 平台标准不能预置 HFCT 或其他具体产品。
2. 项目创建时只能实例化 S0；S0 Gate 批准前不得生成 S1-S10 正式对象。
3. Agent 是工作包默认执行主体；人员审核和批准，系统根据批准事件自动推进。

若本修订与关联设计冲突，按本修订执行。其他生命周期、文档治理、权限、门禁、
审计、备份恢复和兼容性要求继续有效。

## 2. 已有实现差异审计

| 已有能力 | 处理方式 | 原因 |
|---|---|---|
| 七阶段 Project/Phase/Gate 图 | 保留为旧项目兼容模式 | 已有项目、试点数据和回归测试依赖 |
| WorkPackage、ArtifactVersion、Review | 继续复用 | 已具备 Agent 提交、人工审核和门禁证据闭环 |
| AgentRun、AgentJob | 增量扩展 | 已有队列，但派发仍依赖人工触发 |
| 风险、通知、审计 | 保留 | 可直接服务新生命周期 |
| 100 份公司文档目录 | 保留编号和三级分类，修正文案和来源 | 目录结构有价值，但含 8 个 HFCT 专用定义 |
| 公司 S0-S10 模板 | 保留为公司方法骨架 | 不再在创建项目时直接实例化全流程 |
| 项目模板预览 | 改为 S0 立项基线编译预览 | 当前允许人工提前选择具体产品包 |
| `hfct` 产品包 | 从平台核心删除 | 违反产品无关原则 |
| React 项目管理页 | 原位改造 | 不另建应用 |
| JSON/PostgreSQL 映射 | 增量增加 JSON 元数据列 | 保证结构化立项定义不会在数据库往返时丢失 |

## 3. 平台层和项目层边界

### 3.1 平台层

平台层只保存公司受控资产：

- S0-S10 生命周期方法和版本；
- 阶段、Gate 和准入准出规则；
- 100 份产品无关的文档类型定义；
- 标准文档模板和版本；
- 项目类型及通用能力模块；
- 适用性、分级和例外规则；
- Agent 能力、角色和工作包规则。

平台标准不得包含 HFCT、局放或其他具体产品名称。特定产品只存在于项目数据中。

### 3.2 项目层

项目按四类对象演进：

1. `S0_CANDIDATE`：只包含 S0、立项输入、S0 工作包和 S0 Gate。
2. `INITIATION_BASELINE`：S0 Gate 批准时冻结的结构化立项基线。
3. `PROJECT_BLUEPRINT`：规则引擎和 Agent 根据立项基线生成的项目配置草案。
4. `ACTIVE_BASELINE`：负责人批准蓝图后发布的正式 S1-S10 项目图。

S0 Gate 批准前，当前项目不得存在任何属于 S1-S10 的 Phase、Gate、正式工作包、
文档实例或 AgentJob；S0 自身的 AgentJob 正常运行。

## 4. 状态和事件

项目状态：

```text
S0_DRAFT
→ S0_IN_REVIEW
→ S0_REJECTED / S0_ON_HOLD
→ CONFIGURATION_DRAFT
→ CONFIGURATION_REVIEW
→ IN_PROGRESS
→ CHANGE_CONTROL / PAUSED / COMPLETED / ARCHIVED
```

核心事件：

| 事件 | 原子结果 |
|---|---|
| 创建候选项目 | 创建 Project、S0 Phase、S0 Gate、S0 工作包并自动排队 AgentJob |
| 更新 S0 定义 | 新版本覆盖项目当前立项定义并记录审计 |
| S0 Gate 批准 | 锁定 S0、冻结立项基线、创建蓝图工作包并自动排队 AgentJob |
| Agent 提交蓝图 | 创建待审 PROJECT_BLUEPRINT ArtifactVersion |
| 人员批准蓝图 | 发布 S1-S10 图、创建适用文档工作包并自动排队 S1 AgentJob |
| 人员退回成果 | 保留原版本，工作包进入返工并自动排队新 AgentJob |
| 普通 Gate 批准 | 锁定当前阶段、激活下一阶段并自动排队该阶段 AgentJob |

审批和发布操作必须幂等；重复请求不能生成重复阶段、工作包、交付物或任务。

## 5. S0 立项定义

候选项目创建只要求：

- 暂定项目名称；
- 初步产品构想；
- 发起人。

S0 期间由 Agent 研究和起草，人类审核后逐步补齐结构化立项定义：

```json
{
  "version": 1,
  "productConcept": "待开发产品及拟解决问题",
  "projectTypeKey": "new_product_development",
  "targetMarkets": ["目标市场"],
  "customerScenarios": ["客户和使用场景"],
  "capabilityKeys": ["electronic_hardware"],
  "technicalScope": ["硬件"],
  "complianceRequirements": ["适用法规或认证"],
  "supplyMode": "自研加外协",
  "deliveryModel": "产品发布后项目交付",
  "operationsRequirements": ["培训", "售后"],
  "riskLevel": "MEDIUM"
}
```

S0 Gate 批准必须满足：

- 所有 S0 必需工作包已由 Agent 提交并由对应人员批准；
- 不存在未处置的高风险；
- `productConcept`、`projectTypeKey`、`targetMarkets`、`capabilityKeys`、
  `supplyMode`、`deliveryModel` 和 `riskLevel` 已填写；
- 项目类型和能力键均来自当前公司标准版本；
- S0 Gate 批准人具有规定权限。

缺失信息必须作为明确 blocker 返回，不允许系统或 Agent 猜测。

## 6. 项目蓝图编译

项目蓝图由确定性规则引擎编译，Agent 负责组织、解释和提交审核。

输入：

- 冻结的 S0 立项基线；
- 公司生命周期模板版本；
- 公司文档目录版本；
- 项目类型规则版本；
- 能力模块规则版本；
- 文档模板版本；
- 经批准的项目级调整。

输出 `ProjectBlueprint`：

```json
{
  "blueprintVersion": 1,
  "projectId": "project-example",
  "sourceInitiationBaselineVersion": 1,
  "lifecycleTemplateKey": "company_product_lifecycle_v1_0",
  "lifecycleTemplateVersion": "1.0.0",
  "projectTypeKey": "new_product_development",
  "capabilityKeys": ["electronic_hardware"],
  "phases": [],
  "documentRequirements": [],
  "agentAssignments": [],
  "decisionTrace": []
}
```

规则顺序：

```text
法规、认证和合同强制要求
> 公司强制规则
> S0 批准约束
> 通用能力适用规则
> 项目类型默认规则
> 经批准的人工调整
```

相同输入版本必须生成相同蓝图内容。每项文档、阶段和 Agent 判定都保存来源和
解释。AI 不得绕过规则引擎直接改变正式配置。

## 7. 100 份文档和标准模板

100 份文件是公司级文档类型目录，不是每个项目固定生成的文件包。

每项文档定义包含：

- 通用代码和名称；
- 默认等级；
- 所属阶段；
- 来源类别和适用规则；
- 编制、审核和批准角色；
- 标准模板键和模板版本。

项目蓝图只带入公司通用、当前项目类型和已批准能力范围内的文档。未带入项保存
规则判定，但不创建空文件。

三级控制：

- `MANDATORY`：必须由 Agent 提交并由人员批准，才能通过 Gate。
- `CONDITIONAL`：必须形成适用性结论；适用后按必需项执行。
- `CONTROLLED`：不直接阻塞 Gate；一旦生成必须使用受控模板和版本流程。

项目可逐份调整等级。升级可直接进入蓝图修订；降低公司或法规强制要求必须走
例外审批并记录原因。

首个增量版本使用两类模板：

1. 已存在的专业模板继续用于已映射的文档。
2. 尚无专业模板的文档使用公司受控通用文档模板；后续可逐份替换为专业模板，
   不改变文档代码和项目实例接口。

项目文件生成时锁定模板版本。公司模板升级不能静默覆盖在编或已批准文件。

## 8. 产品解耦修正

当前 `hfct` 产品包从平台核心删除，产品包标准查询保留兼容接口但默认返回空集合。

原 8 个专用文档定义保留代码和序号，改为通用能力文档：

| 代码 | 修订后通用名称 | 通用能力来源 |
|---|---|---|
| FS-002 | 安装环境与系统接口适配性研究报告 | 现场安装 |
| HW-001 | 核心传感与检测单元硬件设计说明书 | 测量与信号链 |
| ALG-001 | 信号处理与诊断算法设计说明书 | 算法与 AI |
| ALG-002 | 多通道关联与干扰抑制设计说明书 | 算法与 AI |
| ME-002 | 安装附件与测试接口设计说明书 | 现场安装 |
| TEST-002 | 核心传感与检测单元性能测试规范 | 测量与信号链 |
| TEST-004 | 模拟源与校准测试方案 | 认证与计量 |
| TEST-005 | 典型应用场景与安装拓扑验证方案 | 现场安装 |

HFCT 将来只能以以下形式存在：

- 使用者创建的具体项目；
- 经批准导入的历史项目；
- 显式安装且不参与默认规则的行业扩展。

## 9. Agent 驱动执行主循环

系统默认闭环：

```text
工作包满足依赖
→ 系统自动创建 AgentJob
→ Agent 执行并按模板提交 ArtifactVersion
→ 系统执行模板和完整性检查
→ 对应人员审核
→ 批准后系统关闭当前工作包并解锁后续工作
```

执行控制：

- 正式蓝图发布前，不派发 S1-S10 AgentJob。
- Agent 必须使用锁定模板并提交证据、假设、风险和未决问题。
- Agent 不能审核或批准自己的成果。
- 人员退回后，系统自动创建修订任务，不要求人工再次入队。
- Gate 批准后，系统自动派发下一阶段可执行任务。
- 实物试验、样机制造、客户确认等由 Agent 创建和跟踪人工执行任务，收集证据后
  再提交审核。
- Agent 输入、提示、工具、模板版本、输出、审核和重试全部进入审计链。
- Agent 遇到缺失或冲突必须阻塞并报告，不能猜测。

AgentJob 入队代表系统已自动派发。实际执行由当前 worker 接口完成；后续可以
替换为常驻 worker，不改变工作包、审核或推进契约。

## 10. 增量数据模型

不新增第二套项目模型。新增元数据通过现有主表扩展：

- `projects.definition_json`：当前 S0 定义、立项基线版本、模板键和配置状态。
- `work_packages.metadata_json`：文档代码、等级、适用性、模板版本、依赖和特殊
  工作包类型。
- `ProjectBlueprint` 存入现有 `artifact_versions.content_json`。

现有旧项目在缺少这些字段时按旧七阶段模式读取。JSON store、PostgreSQL 映射、
导入导出、备份恢复和 store doctor 必须保持往返不丢失。

## 11. API 增量

保留现有接口，增加或修订：

```text
POST  /projects/candidates
PATCH /projects/:id/initiation-definition
POST  /projects/:id/blueprint/preview
POST  /projects/:id/blueprint/publish
```

首个增量版本可以由现有审核接口在批准 `PROJECT_BLUEPRINT` 时内部触发 publish，
但 publish 操作必须保持独立、幂等和可测试。

兼容规则：

- `POST /projects` 继续支持旧七阶段项目，不作为新界面的默认创建入口。
- `GET /standards/product-packs` 保留，默认返回空集合。
- 旧项目、旧快照和旧 PostgreSQL 数据继续可读、可运行和可导出。

## 12. 首个开发增量验收

本次开发完成以下可端到端验证的纵向切片：

1. 公司标准中不再存在 HFCT 或局放专用默认项。
2. 新界面创建候选项目时只生成 S0。
3. S0 工作包自动生成 AgentJob。
4. S0 定义不完整时 Gate 明确阻塞。
5. S0 Gate 批准后生成蓝图任务，不生成 S1-S10 正式对象。
6. Agent 提交蓝图后由项目负责人审核。
7. 蓝图批准后一次性发布适用的 S1-S10 项目图并自动派发 S1 任务。
8. 普通成果被退回后自动派发修订任务。
9. 普通 Gate 批准后自动派发下一阶段任务。
10. 旧七阶段项目和全部既有回归测试继续工作。
11. JSON 和 PostgreSQL 往返保留新增项目及工作包元数据。
12. React 项目页展示候选状态、立项定义、自动编译和 Agent 派发状态。

本增量不承诺一次性提供 100 份各自完全专业化的 Word 模板。尚未专业化的文档
先使用公司受控通用模板，并保留逐份替换能力。
