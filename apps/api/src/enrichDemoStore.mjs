/**
 * enrichDemoStore.mjs
 *
 * 在现有 demo store 基础上生成更丰富的演示数据：
 * - 为当前阶段全部工作包生成 Agent 草稿
 * - 补充证据引用
 * - 模拟一次人类审核（批准）
 * - 记录审计事件和通知
 *
 * 运行方式：
 *   npm run demo:enrich
 *
 * 不会修改现有核心逻辑和测试期望值。
 */

import { resetDemoStore, getDemoProject, runAgentWorkPackage, addWorkPackageEvidenceRef, submitHumanReview } from "./server.mjs";

resetDemoStore();

const project = getDemoProject();
const phaseId = project.project.currentPhaseId;
const workPackages = project.workPackages.filter((wp) => wp.phaseId === phaseId);
const rolePairs = project.rolePairs;

function rolePairFor(wp) {
  return rolePairs.find((rp) => rp.id === wp.rolePairId);
}

const enriched = { agentDrafts: 0, evidenceRefs: 0, reviews: 0 };

for (const wp of workPackages) {
  const rp = rolePairFor(wp);
  if (!rp) continue;

  // Generate Agent draft for each work package
  try {
    runAgentWorkPackage({
      workPackageId: wp.id,
      agentKey: rp.agentKey,
      inputRefs: [`artifact:${wp.id}:enrich`],
    });
    enriched.agentDrafts++;
  } catch {
    // Skip if already has a draft
  }

  // Add evidence ref
  try {
    addWorkPackageEvidenceRef(wp.id, {
      actorUserId: rp.humanUserId,
      label: `${wp.title} 演示证据`,
      ref: `demo-enrich://${wp.id}`,
    });
    enriched.evidenceRefs++;
  } catch {
    // Skip if already has evidence
  }

  // Simulate human approval
  try {
    submitHumanReview({
      workPackageId: wp.id,
      reviewerUserId: rp.humanUserId,
      decision: "APPROVE",
      comment: "演示环境自动批准。",
    });
    enriched.reviews++;
  } catch {
    // Skip if already reviewed
  }
}

const currentPhaseId = getDemoProject().project.currentPhaseId;

console.log(JSON.stringify({
  ok: true,
  enriched,
  currentPhaseId,
  totalWorkPackages: workPackages.length,
  message: "演示数据已丰富。",
  usage: "需要回到原始演示数据时访问 /demo/reset 或调用 resetDemoStore()。",
}, null, 2));
