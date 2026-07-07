export const firstPilotBoundaries = [
  "用户登录和单点登录不作为第一轮内部试点验收项。",
  "原生 PostgreSQL 运行时读写不作为第一轮内部试点验收项；当前提供启动快照、只读保护、全量镜像写入、一致性门禁，以及角色、排期、证据、人工审核、风险闭环和阶段门批准的原生增量事务。",
  "文件上传和附件存储不作为第一轮内部试点验收项。",
  "真实大模型调用和异步 Agent 队列不作为第一轮内部试点验收项。",
  "飞书、企业微信或邮件通知不作为第一轮内部试点验收项。",
  "生产级 TLS、反向代理、数据库备份和灾备不作为第一轮内部试点验收项。",
  "多人高并发编辑冲突处理不作为第一轮内部试点验收项。",
];

export const firstPilotAcceptanceCriteria = [
  "参与者可以独立完成工作包生成、审核、风险处理和阶段门批准。",
  "待办和通知能帮助成员找到自己下一步动作。",
  "阶段门审核包可以直接用于一次内部评审会。",
  "项目快照和 Markdown 导出足够用于会后归档。",
  "审计记录能回答“谁在什么时候做了什么”。",
  "npm run pilot:check 通过，且 /ready 返回 200。",
  "试点期间没有出现数据文件损坏；如出现，能通过 .bak 恢复。",
];

export const firstPilotRunbookSteps = [
  "项目经理创建一个试点项目，填写产品线。",
  "在项目页配置每个角色的人类负责人。",
  "在工作包页为当前阶段关键工作包设置截止日期。",
  "对测试计划、测试报告、问题关闭计划执行 Agent 生成。",
  "让对应负责人分别批准、要求修改、驳回或有条件批准。",
  "在风险页创建一个高风险，设置缓解负责人、截止日期和缓解措施。",
  "在待办页确认审核、排期、风险缓解和阶段门批准都能正确出现。",
  "在通知页确认通知可以筛选、跳转到对象并标记已读。",
  "在阶段门页导出审核包，确认证据、风险、条款和阻塞项可用于评审会。",
  "证据和风险满足条件后批准阶段门，确认项目进入下一阶段。",
  "在审计页搜索关键事件，确认操作链路可追踪。",
  "导出项目快照 JSON 和 Markdown，作为试点记录。",
];

export const pilotIssueReport = {
  templateName: "pilot-issue-report.md",
  severityGuide: "S1 数据/放行/回滚风险，S2 核心流程阻塞，S3 可用性或非关键问题。",
  requiredFields: [
    "发生时间",
    "报告人和角色",
    "页面或 API 路径",
    "请求 ID",
    "服务版本",
    "复现步骤",
    "预期结果",
    "实际结果",
    "是否影响阶段门或数据完整性",
    "已尝试的诊断端点",
    "是否需要回滚",
  ],
};

export const pilotRollbackCard = {
  templateName: "pilot-rollback-card.md",
  severityGuide: "S1 数据损坏、无法启动、阶段门错误放行或无法回滚时立即执行；S2/S3 先记录问题并确认是否影响阶段门。",
  steps: [
    "暂停试点操作，记录当前页面、请求 ID、服务版本和发生时间。",
    "打开 /storage/doctor 和 /ops/summary，确认 store、备份、检查点和 HTTP 5xx 状态。",
    "若存在试点前检查点，优先恢复检查点；页面路径：项目 -> 本地数据状态 -> 最近检查点 -> 恢复。",
    "若没有可用检查点但 .bak 有效，执行 npm run store:restore-backup 或页面按钮“从备份恢复”。",
    "恢复后重新打开 /ready、/pilot/launch 和项目页面，确认服务、阶段门和数据摘要恢复到预期状态。",
    "把 pre-restore 备份路径、恢复来源和问题上报模板一起归档。",
  ],
  requiredEvidence: [
    "请求 ID 和服务版本",
    "恢复来源：checkpoint 或 .bak",
    "恢复前保留的 pre-restore 备份路径",
    "/storage/doctor 结果",
    "/pilot/launch 结果",
  ],
};

export const pilotDeploymentDrill = {
  templateName: "pilot-deployment-drill.md",
  defaultRuntimeSource: "json",
  postgresDefaultPolicy: "migration_verification_only",
  steps: [
    {
      key: "release_candidate",
      title: "确认发布候选包",
      command: "npm run pilot:check",
      evidence: "/tmp/hardware-flow-pilot-archive/pilot-launch-summary.json",
    },
    {
      key: "data_checkpoint",
      title: "创建试点前检查点",
      command: "页面：项目 -> 本地数据状态 -> 创建检查点",
      evidence: "/storage/status 结果",
    },
    {
      key: "start_lan",
      title: "按局域网模式启动服务",
      command: "HARDWARE_FLOW_PILOT_ACCESS_CODE=your-code npm run start:lan",
      evidence: "/runtime/network 结果",
    },
    {
      key: "health_checks",
      title: "确认健康和运行配置",
      command: "打开 /ready、/ops/summary、/runtime/config、/storage/doctor",
      evidence: "/ready 与 /storage/doctor 结果",
    },
    {
      key: "share_access",
      title: "发布推荐访问地址",
      command: "复制页面中的推荐 URL 和邀请文本",
      evidence: "发给试点成员的访问消息",
    },
    {
      key: "rollback_probe",
      title: "确认回滚材料可用",
      command: "打开 pilot-rollback-card.md 并确认 .bak 或检查点存在",
      evidence: "pilot-rollback-card.md 与最近检查点名称",
    },
    {
      key: "postgres_policy",
      title: "确认 PostgreSQL 策略",
      command: "默认仅保留导入包和 preflight；严格演练需另行设置 DATABASE_URL 与 psql",
      evidence: "db:preflight 输出或不启用数据库写入的记录",
    },
  ],
  requiredEvidence: [
    "服务版本和 Git 提交",
    "/ready 结果",
    "/runtime/network 结果",
    "/runtime/config 结果",
    "/storage/doctor 结果",
    "试点访问码保管人",
    "检查点名称或 .bak 路径",
    "PostgreSQL 默认策略记录",
  ],
};

export const pilotFeedbackLedger = {
  templateName: "pilot-feedback-ledger.md",
  defaultMilestone: "M7",
  fields: [
    "编号",
    "来源",
    "反馈类型",
    "严重度",
    "优先级",
    "状态",
    "摘要",
    "复现或证据",
    "负责人",
    "后续节点",
    "下一步",
  ],
  categories: [
    "流程适配",
    "页面体验",
    "数据完整性",
    "部署运维",
    "权限责任",
    "Agent 输出",
    "报表归档",
  ],
  priorities: ["P0", "P1", "P2", "P3"],
  statuses: ["OPEN", "TRIAGED", "PLANNED", "DONE", "DEFERRED"],
  severityGuide: "P0 阻塞试点或存在数据/放行风险；P1 阻塞核心流程；P2 影响效率但可绕过；P3 为体验或文案改进。",
  triage: {
    priorityLanes: {
      P0: {
        trigger: "阻塞试点继续、存在数据完整性风险、错误放行风险或无法回滚。",
        decision: "FIX_BEFORE_NEXT_PILOT",
        owner: "试点负责人和对应模块负责人",
      },
      P1: {
        trigger: "阻塞核心流程，但存在可控人工绕过方式。",
        decision: "PLAN_IN_M7",
        owner: "对应流程或模块负责人",
      },
      P2: {
        trigger: "影响效率、理解成本或材料质量，但不阻塞核心流程。",
        decision: "BATCH_IN_M7",
        owner: "产品负责人统一排期",
      },
      P3: {
        trigger: "文案、提示、视觉密度或低风险便利性改进。",
        decision: "DEFER_OR_BATCH",
        owner: "产品负责人按批次处理",
      },
    },
    statusTransitions: {
      OPEN: {
        next: ["TRIAGED", "DEFERRED"],
        rule: "反馈进入台账后先判断是否可复现、是否有证据、是否影响试点继续。",
      },
      TRIAGED: {
        next: ["PLANNED", "DEFERRED"],
        rule: "已明确优先级、负责人和后续节点后，决定进入 M7 计划或延期。",
      },
      PLANNED: {
        next: ["DONE", "DEFERRED"],
        rule: "进入 M7 实施计划后，按验收证据关闭或延期。",
      },
      DONE: {
        next: [],
        rule: "已有修复、验证记录或明确不再需要处理。",
      },
      DEFERRED: {
        next: ["OPEN"],
        rule: "条件变化或重复出现时可重新打开。",
      },
    },
    readyForPlanningCriteria: [
      "问题或建议已归类",
      "优先级已明确",
      "负责人已明确",
      "复现步骤、截图、请求 ID 或归档证据至少具备一项",
      "后续节点为 M7 或明确延期原因",
    ],
  },
  m7Backlog: {
    itemFields: [
      "Backlog ID",
      "来源反馈编号",
      "标题",
      "优先级",
      "分类",
      "负责人",
      "状态",
      "目标版本",
      "验收证据",
      "风险或阻塞说明",
    ],
    sortOrder: ["P0", "P1", "P2", "P3"],
    readyDefinition: [
      "负责人已明确",
      "优先级已明确",
      "验收证据已定义",
      "影响范围已写清",
      "能追溯到反馈编号或复盘结论",
    ],
    acceptanceEvidence: [
      "复测结果或截图",
      "相关 API 响应或请求 ID",
      "更新后的归档材料路径",
      "通过的验证命令",
    ],
    defaultBuckets: [
      {
        key: "stability",
        label: "稳定性和数据安全",
        priorityHint: "P0/P1",
      },
      {
        key: "workflow",
        label: "核心流程效率",
        priorityHint: "P1/P2",
      },
      {
        key: "experience",
        label: "页面体验和文案",
        priorityHint: "P2/P3",
      },
      {
        key: "reporting",
        label: "报表、归档和复盘材料",
        priorityHint: "P2/P3",
      },
    ],
  },
};

export const pilotTrialScope = {
  templateName: "pilot-trial-scope.md",
  participantRange: "4-8",
  projectRecommendation: "1 个真实或半真实硬件项目",
  phaseRange: "EVT Exit 到 DVT Exit",
  defaultRuntimeSource: "json",
  postgresPolicy: "migration_verification_only",
  roles: [
    "项目经理",
    "测试负责人",
    "质量负责人",
    "阶段门批准人",
    "观察者",
  ],
  prerequisites: [
    "运行 npm run pilot:check 并保留归档包。",
    "试点开始前创建检查点。",
    "确认局域网访问地址和试点访问码。",
    "确认回滚卡片和反馈台账已生成。",
  ],
  excludedScopes: [
    "用户登录和单点登录",
    "完整原生 PostgreSQL repository",
    "真实大模型调用",
    "飞书、企业微信或邮件通知",
    "生产级 TLS、反向代理、数据库备份和灾备",
    "多人高并发编辑冲突处理",
  ],
  pendingDecisions: [
    "首批试点部门、人数和典型项目类型",
    "是否单独安排 PostgreSQL 严格导入或镜像写入演练",
    "试点反馈复盘负责人",
  ],
};

export const pilotOpsAlerts = {
  templateName: "pilot-ops-alerts.md",
  watchEndpoints: [
    "/ready",
    "/ops/summary",
    "/storage/doctor",
    "/runtime/config",
    "/runtime/network",
    "/metrics",
  ],
  rules: [
    {
      code: "READY_DOWN",
      severity: "S1",
      endpoint: "/ready",
      metric: "hardware_flow_ready",
      trigger: "非 200 或指标值为 0",
      action: "暂停试点写入，打开 /storage/doctor 和 /ops/summary，必要时执行回滚卡片。",
    },
    {
      code: "HTTP_5XX",
      severity: "S1",
      endpoint: "/ops/summary",
      metric: "hardware_flow_http_5xx_total",
      trigger: "试点期间出现任意 5xx 增量",
      action: "记录请求 ID 和服务版本，归档问题模板，暂停阶段门批准。",
    },
    {
      code: "RUNTIME_PERSISTENCE",
      severity: "S1",
      endpoint: "/metrics",
      metric: "hardware_flow_runtime_persistence_ready",
      trigger: "值为 0，或 postgres sync failure 计数增加",
      action: "停止写入，保留 store 与 .bak，按回滚卡片处理。",
    },
    {
      code: "STORAGE_INVALID",
      severity: "S1",
      endpoint: "/storage/doctor",
      metric: "hardware_flow_store_valid",
      trigger: "store 无效或备份无效",
      action: "不要继续试点；优先恢复检查点，其次恢复 .bak。",
    },
    {
      code: "LOOPBACK_ONLY",
      severity: "S2",
      endpoint: "/runtime/network",
      metric: null,
      trigger: "局域网试点却只监听本机地址",
      action: "改用 npm run start:lan 启动，并重新发送推荐访问地址。",
    },
    {
      code: "POSTGRES_PREFLIGHT_BLOCKED",
      severity: "S3",
      endpoint: "db:preflight",
      metric: null,
      trigger: "未配置 DATABASE_URL 或缺少 psql",
      action: "默认 JSON 试点不阻塞；只有数据库演练时才升级为 S2。",
    },
  ],
  escalation: "S1 立即暂停写入和阶段门批准；S2 由试点主持人决定是否继续；S3 记录到反馈台账。",
};

export const pilotArchiveIndex = {
  templateName: "pilot-archive-index.md",
  primaryReadOrder: [
    {
      file: "pilot-trial-scope.md",
      purpose: "确认本轮试点范围、参与角色、阶段边界和运行策略。",
    },
    {
      file: "pilot-launch-summary.json",
      purpose: "确认启动判定是 GO 或 GO_WITH_CAUTION，而不是 NO_GO。",
    },
    {
      file: "pilot-deployment-drill.md",
      purpose: "按步骤完成局域网启动、访问码、诊断端点和回滚材料检查。",
    },
    {
      file: "pilot-test-plan.md",
      purpose: "按用例完成安装验收、核心流程、异常恢复和放行记录。",
    },
    {
      file: "pilot-handoff.md",
      purpose: "交接给试点主持人和操作者的完整说明。",
    },
    {
      file: "pilot-handoff-walkthrough.md",
      purpose: "让非核心开发同事按入口、启动、报错、回滚和复盘完整走查一次。",
    },
    {
      file: "pilot-m6-closeout.md",
      purpose: "在真实走查后判断 M6 发布材料是 PASS、PASS_WITH_NOTES 还是 BLOCKED。",
    },
    {
      file: "pilot-brief.md",
      purpose: "会前或会中快速同步项目、阶段门、命令和诊断链接。",
    },
  ],
  bySituation: [
    {
      situation: "试点启动前",
      files: ["pilot-trial-scope.md", "pilot-deployment-drill.md", "pilot-test-plan.md", "pilot-ops-alerts.md"],
    },
    {
      situation: "测试执行",
      files: ["pilot-test-plan.md", "pilot-deployment-drill.md", "pilot-feedback-ledger.md"],
    },
    {
      situation: "交接走查",
      files: ["pilot-archive-index.md", "pilot-handoff-walkthrough.md", "pilot-m6-closeout.md"],
    },
    {
      situation: "现场报错",
      files: ["pilot-issue-report.md", "pilot-ops-alerts.md", "pilot-rollback-card.md"],
    },
    {
      situation: "需要回滚",
      files: ["pilot-rollback-card.md", "storage-status.json", "storage-doctor.json"],
    },
    {
      situation: "会后复盘",
      files: ["pilot-feedback-ledger.md", "pilot-m7-backlog.md", "project-snapshot.md", "risk-register.md"],
    },
    {
      situation: "M6 收尾",
      files: ["pilot-m6-closeout.md", "pilot-handoff-walkthrough.md", "pilot-feedback-ledger.md"],
    },
    {
      situation: "数据库迁移演练",
      files: ["postgres-import/postgres-import-manifest.json", "pilot-ops-alerts.md", "pilot-trial-scope.md"],
    },
  ],
};

export const pilotTestPlan = {
  templateName: "pilot-test-plan.md",
  environment: {
    serverHosts: "1",
    clientCount: "2-3",
    browsers: ["Chrome", "Edge", "Safari"],
    network: "同一局域网或同一 VPN",
    defaultPort: "3001",
    runtimeSource: "JSON store",
  },
  releaseCriteria: [
    "npm run pilot:check 执行成功",
    "至少 2 台局域网客户端可以打开首页并完成核心流程",
    "试点访问码启用后，未输入访问码不能执行数据修改操作",
    "项目、工作包、审核、风险、阶段门、通知、审计和导出主流程无阻塞缺陷",
    "创建检查点、恢复检查点或 .bak 备份恢复路径至少验证一种",
    "归档包关键 Markdown/JSON 文件齐全",
    "未出现数据损坏、服务崩溃、阶段门错误放行或无法回滚的问题",
  ],
  defectLevels: {
    S1: "数据损坏、服务无法启动、阶段门错误放行、无法恢复或安全边界失效。",
    S2: "核心流程阻塞，包括 Agent 草稿、人工审核、风险处理、阶段门批准、导出失败。",
    S3: "页面文案、布局、局域网访问提示、非关键导出或体验问题。",
  },
  suites: [
    {
      key: "install_preflight",
      title: "安装与启动前检查",
      cases: ["TC-01 依赖安装", "TC-02 本机启动"],
      expected: "依赖安装成功，pilot:check 通过，本机 /ready 返回 200。",
    },
    {
      key: "lan_startup",
      title: "局域网启动和端口",
      cases: ["TC-03 局域网启动", "TC-04 端口调整"],
      expected: "客户端可通过服务器内网 IP 访问，/runtime/network 显示推荐地址。",
    },
    {
      key: "pilot_access_code",
      title: "试点访问码",
      cases: ["TC-05 启用访问码", "TC-20 错误访问码"],
      expected: "错误或缺失访问码不能修改数据，正确访问码可以继续操作。",
    },
    {
      key: "diagnostics",
      title: "诊断端点",
      cases: ["健康检查", "运维摘要", "存储检查", "试点 readiness", "M7 端点"],
      expected: "关键诊断端点无 500，返回内容可用于现场排障。",
    },
    {
      key: "core_workflow",
      title: "核心业务流程",
      cases: [
        "TC-06 创建项目",
        "TC-07 配置角色负责人",
        "TC-08 设置工作包排期",
        "TC-09 Agent 草稿生成",
        "TC-10 人工审核",
        "TC-11 补充阶段门证据",
        "TC-12 风险闭环",
        "TC-13 阶段门批准",
      ],
      expected: "工作包、审核、证据、风险和阶段门状态一致，审计可追踪。",
    },
    {
      key: "pilot_feedback",
      title: "试点总览和反馈闭环",
      cases: ["TC-14 试点就绪总览", "TC-15 反馈计划和分诊", "TC-16 M7 readiness 和 backlog"],
      expected: "试点主持人可以复制简报、记录反馈，并把 PLANNED 项整理到 M7。",
    },
    {
      key: "archive_and_rollback",
      title: "归档包、数据保护和回滚",
      cases: ["归档包测试", "TC-17 检查点恢复", "TC-18 .bak 恢复"],
      expected: "归档材料齐全，至少一种恢复路径验证通过。",
    },
    {
      key: "multi_client",
      title: "异常和多客户端",
      cases: ["TC-19 防火墙或非 LAN 模式", "TC-21 多客户端同时操作"],
      expected: "错误提示可诊断，多客户端刷新后数据一致，无 500 或 store 损坏。",
    },
  ],
  reportFields: [
    "测试日期",
    "测试版本/Git 提交",
    "服务器主机",
    "局域网访问地址",
    "参与客户端数量",
    "执行用例数量",
    "通过数量",
    "失败数量",
    "阻塞数量",
    "S1/S2/S3 数量",
    "是否建议进入内部试点",
    "必须修复项",
    "M7 后续项",
    "归档包路径",
    "负责人签字",
  ],
};

export const pilotHandoffWalkthrough = {
  templateName: "pilot-handoff-walkthrough.md",
  steps: [
    {
      key: "open_archive_index",
      title: "打开归档包总目录",
      action: "打开 pilot-archive-index.md，确认先读顺序和按场景找文件表能被理解。",
      files: ["pilot-archive-index.md", "pilot-trial-scope.md"],
      evidence: "操作者能说出本轮范围、默认运行时写入源和 PostgreSQL 策略。",
    },
    {
      key: "pre_start",
      title: "完成启动前检查",
      action: "按 pilot-deployment-drill.md 检查发布候选包、检查点、访问码、诊断端点和回滚材料。",
      files: ["pilot-deployment-drill.md", "pilot-launch-summary.json", "pilot-ops-alerts.md"],
      evidence: "/ready、/ops/summary、/runtime/network 和 /storage/doctor 结果已留存。",
    },
    {
      key: "simulate_incident",
      title: "模拟现场报错",
      action: "打开 pilot-issue-report.md，填写请求 ID、服务版本、复现步骤、影响范围和诊断端点。",
      files: ["pilot-issue-report.md", "pilot-ops-alerts.md"],
      evidence: "问题可以被分为 S1/S2/S3，并能找到下一步处理材料。",
    },
    {
      key: "rollback_path",
      title: "确认回滚路径",
      action: "打开 pilot-rollback-card.md，确认检查点或 .bak、恢复命令和恢复后诊断步骤。",
      files: ["pilot-rollback-card.md", "storage-status.json", "storage-doctor.json"],
      evidence: "操作者能说明优先恢复检查点，其次恢复 .bak，并知道恢复后要复查 /ready。",
    },
    {
      key: "retro_capture",
      title: "确认复盘记录",
      action: "打开 pilot-feedback-ledger.md 和 pilot-m7-backlog.md，把模拟问题映射到优先级、负责人、状态、后续节点和 M7 backlog 条目。",
      files: ["pilot-feedback-ledger.md", "pilot-m7-backlog.md", "project-snapshot.md", "risk-register.md"],
      evidence: "至少一条反馈能被记录到 M7 backlog 或明确延期。",
    },
  ],
  requiredEvidence: [
    "走查主持人",
    "操作者姓名",
    "服务版本或 Git 提交",
    "归档包路径",
    "诊断端点截图或复制结果",
    "走查结论：PASS、PASS_WITH_NOTES 或 BLOCKED",
  ],
};

export const pilotM6Closeout = {
  templateName: "pilot-m6-closeout.md",
  recommendedDecision: "PASS_WITH_NOTES",
  criteria: [
    {
      key: "archive_complete",
      title: "归档包完整",
      status: "READY",
      evidence: "pilot-archive-index.md、pilot-handoff-walkthrough.md、pilot-deployment-drill.md、pilot-ops-alerts.md、pilot-feedback-ledger.md 均已生成。",
    },
    {
      key: "operator_walkthrough",
      title: "交接走查",
      status: "NEEDS_REAL_OPERATOR",
      evidence: "需要真实非核心开发操作者按 pilot-handoff-walkthrough.md 执行一次并记录结论。",
    },
    {
      key: "rollback_ready",
      title: "回滚路径",
      status: "READY_WITH_CHECKPOINT_REQUIRED",
      evidence: "pilot-rollback-card.md、storage-status.json 和 storage-doctor.json 已生成；正式试点前仍需创建检查点。",
    },
    {
      key: "feedback_capture",
      title: "反馈闭环",
      status: "READY",
      evidence: "pilot-feedback-ledger.md 可记录 P0/P1/P2/P3、负责人、状态和后续节点。",
    },
    {
      key: "postgres_policy",
      title: "PostgreSQL 策略",
      status: "READY_WITH_OPTIONAL_STRICT_DRILL",
      evidence: "默认 JSON 试点不阻塞；严格数据库演练需单独提供 DATABASE_URL 和 psql。",
    },
  ],
  remainingDecisions: [
    "内部试点的首批用户范围",
    "真实操作者走查结论",
    "是否安排 PostgreSQL 严格导入或镜像写入演练",
    "M7 反馈复盘负责人",
  ],
};
