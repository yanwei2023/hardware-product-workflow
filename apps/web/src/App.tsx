const phases = [
  { name: "立项", status: "APPROVED" },
  { name: "需求冻结", status: "APPROVED" },
  { name: "设计冻结", status: "APPROVED" },
  { name: "EVT Exit", status: "GATE_BLOCKED" },
  { name: "DVT Exit", status: "NOT_STARTED" },
  { name: "PVT Exit", status: "NOT_STARTED" },
  { name: "量产准备", status: "NOT_STARTED" },
];

const reviewQueue = [
  "审核 Test Agent 生成的 EVT Exit 报告草稿",
  "处理热设计裕量不足风险",
  "在 EVT 阶段门前处理 Agent 发现项",
];

const statusLabels: Record<string, string> = {
  APPROVED: "已批准",
  GATE_BLOCKED: "阶段门阻塞",
  NOT_STARTED: "未开始",
};

export function App() {
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <h1>硬件流程</h1>
        <nav>
          <a>项目总览</a>
          <a>我的审核</a>
          <a>阶段门</a>
          <a>交付物</a>
          <a>系统管理</a>
        </nav>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">智能控制器项目</p>
            <h2>EVT Exit 被阻塞，必须完成必要的人类审核和风险处理后才能通过。</h2>
          </div>
          <button>打开阶段门审核</button>
        </header>

        <section className="phase-strip">
          {phases.map((phase) => (
            <article className={`phase-card ${phase.status.toLowerCase()}`} key={phase.name}>
              <span>{statusLabels[phase.status] ?? phase.status}</span>
              <strong>{phase.name}</strong>
            </article>
          ))}
        </section>

        <section className="content-grid">
          <article className="panel">
            <h3>阶段门阻塞项</h3>
            <ul>
              <li>缺少已批准交付物：EVT Exit 报告</li>
              <li>人类审核尚未批准：EVT Exit 报告</li>
              <li>高风险未关闭：热设计裕量不足</li>
            </ul>
          </article>

          <article className="panel">
            <h3>人类审核队列</h3>
            <ul>
              {reviewQueue.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>

          <article className="panel agent-panel">
            <h3>Agent 状态</h3>
            <p>Test Agent 已准备草稿。在测试负责人批准前，该内容只作为建议，不能进入正式基线。</p>
            <button>要求修改</button>
            <button>开始人类审核</button>
          </article>
        </section>
      </section>
    </main>
  );
}
