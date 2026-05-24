import demoUsers from "../../../schemas/demo-users.json" with { type: "json" };

export function getDemoUsers() {
  return demoUsers.users;
}

export function findUser(userId) {
  return getDemoUsers().find((user) => user.userId === userId) || null;
}

export function userHasRole(userId, role) {
  const user = findUser(userId);
  return Boolean(user?.roles.includes(role));
}

export function canReviewWorkPackage(userId, workPackage, rolePair, artifactTemplate) {
  if (!findUser(userId)) {
    return {
      allowed: false,
      reason: "用户不存在",
    };
  }

  if (rolePair?.humanUserId === userId) {
    return {
      allowed: true,
      reason: "用户是工作包绑定的人类负责人",
    };
  }

  const allowedRoles = artifactTemplate?.requiredReviewRoles || [];
  const matchedRole = allowedRoles.find((role) => userHasRole(userId, role));
  if (matchedRole) {
    return {
      allowed: true,
      reason: `用户具有审核角色：${matchedRole}`,
    };
  }

  return {
    allowed: false,
    reason: `用户没有审核该工作包所需角色：${allowedRoles.join("、") || "未配置"}`,
  };
}

export function canApproveWorkPackage(userId, rolePair) {
  if (!findUser(userId)) {
    return {
      allowed: false,
      reason: "用户不存在",
    };
  }

  return rolePair?.humanUserId === userId
    ? {
        allowed: true,
        reason: "用户是工作包绑定的人类负责人",
      }
    : {
        allowed: false,
        reason: "只有工作包绑定的人类负责人可以批准该工作包进入阶段门证据链",
      };
}

export function canAcceptRisk(userId) {
  if (!findUser(userId)) {
    return {
      allowed: false,
      reason: "用户不存在",
    };
  }

  const allowedRoles = ["项目经理", "质量负责人", "阶段门批准人"];
  const matchedRole = allowedRoles.find((role) => userHasRole(userId, role));
  return matchedRole
    ? { allowed: true, reason: `用户具有风险接受角色：${matchedRole}` }
    : { allowed: false, reason: `用户没有风险接受权限，需要角色：${allowedRoles.join("、")}` };
}

export function canCloseRisk(userId) {
  return canAcceptRisk(userId);
}

export function canApproveGate(userId) {
  if (!findUser(userId)) {
    return {
      allowed: false,
      reason: "用户不存在",
    };
  }

  const allowedRoles = ["项目经理", "阶段门批准人"];
  const matchedRole = allowedRoles.find((role) => userHasRole(userId, role));
  return matchedRole
    ? { allowed: true, reason: `用户具有阶段门批准角色：${matchedRole}` }
    : { allowed: false, reason: `用户没有阶段门批准权限，需要角色：${allowedRoles.join("、")}` };
}
