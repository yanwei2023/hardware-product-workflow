import {
  checkGate,
  getDemoProject,
  resetDemoStore,
  runAgentWorkPackage,
  submitHumanReview,
  updateRiskStatus,
  approveGate,
} from "./server.mjs";

function printStep(title, value) {
  console.log(`\n## ${title}`);
  console.log(JSON.stringify(value, null, 2));
}

resetDemoStore();

printStep("初始阶段门检查：应被阻塞", checkGate("gate-evt_exit"));

printStep(
  "无效 Agent 输出：缺少测试报告必填章节，应被系统拒绝",
  runAgentWorkPackage({
    workPackageId: "wp-evt_exit-evt_test_report",
    agentKey: "test_agent",
    inputRefs: ["artifact:evt-test-results"],
    draftMarkdown: "# EVT Exit 报告草稿\n\n只有标题，没有必填章节。\n",
  }).body,
);

printStep(
  "人类批准 EVT 测试计划",
  submitHumanReview({
    workPackageId: "wp-evt_exit-evt_test_plan",
    reviewerUserId: "user-test-lead",
    decision: "APPROVE",
    comment: "测试计划可用于 EVT。",
  }).body.latestGateCheck,
);

printStep(
  "Agent 生成 EVT Exit 报告草稿，并加载测试报告模板",
  (() => {
    const result = runAgentWorkPackage({
    workPackageId: "wp-evt_exit-evt_test_report",
    agentKey: "test_agent",
    inputRefs: ["artifact:evt-test-results", "artifact:issue-log"],
    }).body;
    return {
      workPackage: result.workPackage,
      templateKey: result.artifactTemplate.templateKey,
      requiredSections: result.artifactTemplate.requiredSections,
    };
  })(),
);

printStep("报告尚未人审，阶段门继续阻塞", checkGate("gate-evt_exit"));

printStep(
  "人类接受高风险",
  updateRiskStatus("risk-thermal-margin", "ACCEPTED", {
    userId: "user-project-manager",
  }).body.latestGateCheck,
);

printStep(
  "Quality Agent 生成 EVT 问题关闭计划草稿，并加载问题关闭计划模板",
  (() => {
    const result = runAgentWorkPackage({
    workPackageId: "wp-evt_exit-evt_issue_closure",
    agentKey: "quality_agent",
    inputRefs: ["artifact:evt-issue-log", "artifact:evt-test-report-draft"],
    }).body;
    return {
      workPackage: result.workPackage,
      templateKey: result.artifactTemplate.templateKey,
      requiredSections: result.artifactTemplate.requiredSections,
    };
  })(),
);

printStep(
  "人类批准 EVT 问题关闭计划",
  submitHumanReview({
    workPackageId: "wp-evt_exit-evt_issue_closure",
    reviewerUserId: "user-quality-lead",
    decision: "APPROVE",
    comment: "问题关闭计划已确认，可用于 EVT Exit 阶段门。",
  }).body.latestGateCheck,
);

printStep(
  "人类批准 EVT Exit 报告",
  submitHumanReview({
    workPackageId: "wp-evt_exit-evt_test_report",
    reviewerUserId: "user-test-lead",
    decision: "APPROVE",
    comment: "EVT 报告批准，允许提交阶段门。",
  }).body.latestGateCheck,
);

printStep("最终项目快照", getDemoProject());

printStep(
  "项目经理正式批准 EVT Exit 阶段门，项目进入下一阶段",
  approveGate("gate-evt_exit", {
    userId: "user-project-manager",
  }).body,
);
