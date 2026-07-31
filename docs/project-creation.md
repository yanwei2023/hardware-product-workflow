# 项目创建

系统面向公司所有产品开发和产品交付项目。新界面的默认入口是创建产品无关的
S0 立项候选，而不是预先选择某个具体产品模板或一次性生成完整流程。

## 默认创建流程

```text
创建 S0 候选
→ 系统生成 S0 工作包并自动排队 AgentJob
→ Agent 按标准模板提交 S0 草稿
→ 对应人员逐项审核
→ S0 Gate 批准并冻结立项基线
→ Agent 生成项目正式配置蓝图
→ 项目负责人审核蓝图
→ 系统发布 S1-S10 正式项目图并自动排队 S1 AgentJob
→ 后续 Gate 批准后自动派发下一阶段
```

在 S0 Gate 批准前，候选项目只有 S0 Phase、S0 Gate、S0 工作包和 S0
AgentJob，不会提前创建 S1-S10 的正式对象。Agent 是默认执行主体；人员审核和
批准；只有批准事件才能触发正式推进。

## 创建 S0 候选

```text
POST /projects/candidates
```

请求示例：

```json
{
  "name": "通用新产品候选",
  "productConcept": "面向目标客户的新产品",
  "userId": "user-project-manager"
}
```

创建后系统会生成：

- 项目记录和版本 1 的结构化立项定义；
- 1 个 S0 阶段和 1 个 S0 Gate；
- 10 个 S0 工作包，其中 8 个是 Gate 必需项；
- 产品经理、项目经理与对应 Agent 配对；
- 10 个自动排队的 S0 AgentJob；
- 项目创建审计记录。

前端“项目”页面的“创建 S0 立项候选”是默认新建入口。创建时只要求暂定名称和
初步产品构想。

## 完善立项定义

```text
PATCH /projects/:id/initiation-definition
```

结构化字段包括项目类型、目标市场、客户场景、能力范围、技术范围、合规要求、
供应模式、交付模式、运营要求和风险等级。每次保存都会增加定义版本并记录审计。

S0 Gate 至少要求以下字段完整：

```text
productConcept
projectTypeKey
targetMarkets
capabilityKeys
supplyMode
deliveryModel
riskLevel
```

字段缺失或使用未知标准键时，Gate 返回明确 blocker，系统和 Agent 不得猜测。
S0 Gate 批准后立项基线冻结，不能继续直接修改。

## 项目蓝图预览和发布

只读预览：

```text
POST /projects/:id/blueprint/preview
```

预览根据当前项目的立项定义、公司 S0-S10 生命周期、项目类型、能力范围和 100
份公司文档目录确定性编译，不写入项目数据。结果包括正式阶段、适用文档、文档
等级、模板、Agent/人员配对和规则判定轨迹。

S0 Gate 批准后，系统自动创建 `PROJECT_BLUEPRINT` 工作包并派发给 `pm_agent`。
Agent 生成的蓝图必须通过模板校验并由绑定的项目负责人批准。审核批准会内部调用
幂等发布函数；也保留独立接口：

```text
POST /projects/:id/blueprint/publish
```

请求体需要：

```json
{
  "blueprintArtifactId": "artifact-id",
  "actorUserId": "user-project-manager"
}
```

只有状态为 `APPROVED` 且属于当前项目的结构化蓝图可以发布。首次发布生成
S1-S10；重复发布返回现有基线，不创建重复阶段、工作包或任务。

## 公司标准查询

```text
GET /standards/lifecycle-templates
GET /standards/document-definitions
GET /standards/project-types
GET /standards/capability-packs
GET /standards/product-packs
```

`GET /standards/product-packs` 只为旧客户端兼容保留，产品无关核心返回空集合。公司
标准中没有 HFCT、局放或其他具体产品默认项。100 份文件是公司级文档类型目录，
每个项目只实例化公司通用、当前项目类型和已批准能力范围内的适用文件。

## 旧项目兼容

```text
POST /projects
```

该接口继续按 `standard_hardware_development_v0_1` 创建旧七阶段项目，供已有项目、
试点数据和调用方兼容使用，不再是新界面的默认入口。

旧项目仍支持：

```text
POST /projects/:id/select
POST /projects/:id/clone
POST /projects/:id/archive
POST /projects/:id/restore
GET  /projects/:id/snapshot
GET  /projects/:id/snapshot.md
```

前端可以查看、切换、复制、归档、恢复和导出旧项目。缺少新元数据的旧快照和
PostgreSQL 数据仍可读取。

## 当前边界

- 还没有真实登录，操作者通过演示 `userId` 传入；
- 阶段角色负责人暂时使用演示用户；
- 项目删除未开放，使用可恢复的归档；
- 100 份文档中，已有专业模板的继续使用专业模板，其余使用公司受控通用模板；
- 文档的默认等级、项目有效等级和判定轨迹已进入蓝图与工作包元数据；
- 逐份文档人工调级、条件项不适用审批和强制项降级例外审批尚未形成操作接口，
  后续必须按“升级可直接申请、降级需质量和 Gate 权限批准、全程审计”的设计增量
  实现，不能把当前默认编译结果误认为已具备人工调级功能。
