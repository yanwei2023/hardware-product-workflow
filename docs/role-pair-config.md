# 项目角色配对配置

每个项目都由 `人类角色 + Agent` 配对驱动。

当前试用版已经支持在前端“项目管理”页修改当前项目的角色负责人。

## API

```text
PATCH /role-pairs/:id
```

请求示例：

```json
{
  "humanUserId": "user-test-lead",
  "actorUserId": "user-project-manager"
}
```

## 权限影响

角色负责人变更后立即影响审批权限。

例如：

```text
测试工程师 + Test Agent
负责人从 user-test-lead 改为 user-project-manager
```

则：

```text
user-test-lead 不能再批准该工作包
user-project-manager 可以批准该工作包
```

这是为了保证“谁批准，谁负责”的责任边界清晰。

## 当前限制

- 当前没有限制谁可以修改角色负责人；
- 后续应只允许项目经理、管理员或项目负责人修改；
- 后续需要记录角色负责人变更历史；
- 后续需要支持按阶段配置不同负责人。

