# 交付物模板完整性校验

本系统要求 Agent 输出在进入人类审核前，先通过交付物模板完整性校验。

## 目标

防止 Agent 生成随意文本，遗漏公司模板中的必要章节或字段。

## 当前 MVP 校验规则

系统根据工作包的 `artifactTemplateKey` 加载模板，并检查 Agent 输出中是否包含注册表声明的 `requiredSections`。

当前检查范围：

- 必填章节是否出现；
- 必填字段名是否出现；
- 输出是否使用了对应交付物模板；
- 校验结果是否写入 Agent run 和 artifact content。

当前不会严格判断字段内容是否真实有效。字段内容有效性会在下一阶段升级为结构化校验。

## 校验失败时

当 Agent 输出缺少必填项时：

```text
Agent run -> OUTPUT_INVALID
WorkPackage -> NEEDS_AGENT_REVISION
Artifact -> 不进入 PENDING_REVIEW
Human Review -> 不允许创建
```

也就是说，模板不完整的 Agent 输出不能交给人类审核，只能退回 Agent 修改。

## 校验通过时

当 Agent 输出满足模板要求时：

```text
Agent run -> OUTPUT_READY
WorkPackage -> AGENT_DRAFT_READY
Artifact -> PENDING_REVIEW
Human Review -> 可以创建
```

人类批准后，交付物才会进入正式可用于阶段门的状态。

## 下一阶段增强

后续应升级为结构化校验：

- 必填字段不能为空；
- 表格行数满足要求；
- 风险项必须有等级和负责人；
- 问题单必须有关联 ID；
- 审核结论必须由人类填写；
- 证据引用必须指向真实文件或记录；
- 不允许 Agent 自行填写人类批准结论。

