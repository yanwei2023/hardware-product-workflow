# 流程主干

## 核心对象

| 对象 | 含义 |
|---|---|
| Project | 一个硬件产品开发项目 |
| Phase | 生命周期阶段，例如需求冻结、设计冻结、EVT、DVT、PVT |
| Gate | 正式阶段门，用于决定当前阶段是否可以退出 |
| RolePair | 人类角色与 Agent 角色的配对 |
| WorkPackage | 最小受控流程单元 |
| Artifact | 带版本的交付物，例如 PRD、BOM、测试计划、测试报告、评审包 |
| Review | 人类对 Agent 或他人提交内容的审核记录 |
| Risk | 被追踪的技术、进度、成本、供应、质量或合规风险 |
| Decision | 带证据的人类决策记录 |
| AuditEvent | 不可随意篡改的行为记录，用于说明谁或什么系统做了什么 |

## 产品项目主循环

新产品项目不在创建时一次性实例化整个生命周期。正式主循环为：

```text
创建 S0 候选
→ 自动派发 S0 AgentJob
→ Agent 按标准模板提交
→ 对应人员审核
→ S0 Gate 批准并冻结立项基线
→ 自动派发项目蓝图 AgentJob
→ 人员批准项目蓝图
→ 发布 S1-S10 并自动派发 S1 AgentJob
→ Agent 提交 / 人员审核 / Gate 批准
→ 自动派发下一阶段
```

S0 Gate 批准前不得出现 S1-S10 正式 Phase、Gate、WorkPackage、ArtifactVersion
或 AgentJob。项目蓝图由确定性规则引擎编译，Agent 负责组织和提交；人员批准后
系统才把蓝图发布为正式执行基线。

## 工作包状态机

```text
NOT_STARTED
  -> READY_FOR_AGENT
  -> AGENT_WORKING
  -> AGENT_DRAFT_READY
  -> HUMAN_REVIEWING
  -> NEEDS_AGENT_REVISION
  -> AGENT_WORKING
  -> AGENT_DRAFT_READY
  -> HUMAN_APPROVED
  -> SUBMITTED_TO_BASELINE
  -> LOCKED
```

异常状态：

```text
BLOCKED
CONFLICT_DETECTED
ESCALATED
REJECTED
CANCELLED
```

硬性规则：

- Agent 可以把工作包推进到 `AGENT_DRAFT_READY`。
- Agent 不能把工作包推进到 `HUMAN_APPROVED`。
- Agent 不能把工作包推进到 `SUBMITTED_TO_BASELINE`。
- Agent 不能直接推进 `Gate`。
- 任何正式状态变化都必须来自人类动作，或来自此前人类批准后触发的系统规则。
- 工作包可执行时系统自动创建 `AgentJob`，不要求人员手工入队。
- 人员要求修改后系统自动创建修订 `AgentJob`，保留原交付物和审核记录。
- Gate 批准后系统自动激活并派发下一阶段工作包。

## 阶段门规则

当任一必要条件不满足时，阶段门必须被阻塞：

- 必需工作包缺失；
- 必需交付物缺失；
- 必需审核尚未批准；
- 高风险仍然打开，且没有被人类明确接受；
- 必需角色尚未签核；
- 交付物版本过期；
- Agent 发现的问题尚未处理。

## 第一版 MVP 阶段

公司正式产品开发流程覆盖：

```text
S0 立项与治理
S1 市场与产品定义
S2 需求与可行性
S3 系统总体设计
S4 详细设计
S5 EVT 工程验证
S6 DVT 设计验证
S7 PVT 生产验证
S8 发布与量产
S9 交付与运营
S10 生命周期管理
```

以下七阶段图仅用于既有项目和试点数据兼容：

```text
立项
需求冻结
设计冻结
EVT Exit
DVT Exit
PVT Exit
量产准备
```
