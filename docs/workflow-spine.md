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

```text
立项
需求冻结
设计冻结
EVT Exit
DVT Exit
PVT Exit
量产准备
```
