const roadmapItems = [
  {
    title: "Built foundation",
    status: "Built",
    summary:
      "Core public education pages, safer product language, preview experiences, and trust-oriented explanations are in place as the product base.",
    note: "Preview/static status only; roadmap status is informational and may change.",
  },
  {
    title: "Source ears and source health",
    status: "In progress",
    summary:
      "Source monitoring, freshness labels, and reliability checks are being shaped so market inputs can be understood before they support alerts.",
    note: "Some features are working as preview contracts before live production connection.",
  },
  {
    title: "Scoring and market sentiment",
    status: "Preview only",
    summary:
      "Scoring language and sentiment framing are available as static previews to show how Swing Up may explain research context later.",
    note: "Preview/mock pages are not real market alerts.",
  },
  {
    title: "Historical pattern engine",
    status: "In progress",
    summary:
      "Historical comparison tools are being prepared to place current research signals beside prior market examples without implying future outcomes.",
    note: "Pattern context is decision-support information, not a return forecast.",
  },
  {
    title: "AI Committee review",
    status: "In progress",
    summary:
      "The AI review flow is being connected as a challenge layer that can summarize uncertainty, evidence quality, and review decisions.",
    note: "Public ledger and AI queue are being connected to live records in backend builds.",
  },
  {
    title: "Receipts and evidence",
    status: "Built",
    summary:
      "Receipt-centered pages and evidence explanations are present so users can understand why a research item exists and what supported it.",
    note: "Evidence previews are static until connected workflows mark production records.",
  },
  {
    title: "Public ledger and tracking",
    status: "In progress",
    summary:
      "Ledger and tracking views are being prepared to show public accountability, timestamps, evidence, and outcome follow-up.",
    note: "Public ledger and AI queue are being connected to live records in backend builds.",
  },
  {
    title: "Payments and subscriptions",
    status: "Planned",
    summary:
      "Paid plans and subscription access are intended to come after the research experience, safety language, and operational readiness are stronger.",
    note: "Payments, Telegram, email, and native apps are later milestones.",
  },
  {
    title: "Notifications",
    status: "Planned",
    summary:
      "Notification concepts will need conservative wording, quiet defaults, rate limits, preferences, unsubscribe paths, and evidence links.",
    note: "Payments, Telegram, email, and native apps are later milestones.",
  },
  {
    title: "Native apps later",
    status: "Later",
    summary:
      "Mobile app work is a later milestone after the web experience, live records, payments, and notification foundations are ready.",
    note: "Native apps are not part of the current preview connection phase.",
  },
];

const statusClassNames: Record<string, string> = {
  Built: "status-connected",
  "In progress": "status-stubbed",
  "Preview only": "outcome-unknown",
  Planned: "status-not_configured",
  Later: "outcome-unknown",
};

export default function RoadmapPreviewPage() {
  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Preview/static roadmap</div>
          <h1>Product roadmap preview</h1>
          <p>
            A calm, standalone overview of what Swing Up has built, what is being connected now, and what comes
            later. All labels on this page are preview/static and do not read from production systems.
          </p>
        </div>
        <div className="card risk-callout">
          <span className="badge outcome-unknown">Preview only</span>
          <h2>Informational status</h2>
          <p>Roadmap status is informational and may change.</p>
          <p>
            Swing Up provides market research and decision-support information. It does not guarantee returns.
          </p>
        </div>
      </section>

      <section className="grid three trust-section" aria-label="Roadmap preview notes">
        <article className="card">
          <span className="badge status-stubbed">Preview/static</span>
          <h3>Connection phase</h3>
          <p>Some features are working as preview contracts before live production connection.</p>
        </article>
        <article className="card">
          <span className="badge outcome-unknown">Not live alerts</span>
          <h3>Mock pages</h3>
          <p>Preview/mock pages are not real market alerts.</p>
        </article>
        <article className="card">
          <span className="badge status-not_configured">Later milestones</span>
          <h3>Future channels</h3>
          <p>Payments, Telegram, email, and native apps are later milestones.</p>
        </article>
      </section>

      <section className="grid two trust-section" aria-label="Product roadmap preview sections">
        {roadmapItems.map((item) => (
          <article className="card" key={item.title}>
            <span className={`badge ${statusClassNames[item.status]}`}>Preview/static status: {item.status}</span>
            <h3>{item.title}</h3>
            <div className="metric">
              <span>Roadmap area</span>
              <strong>{item.summary}</strong>
            </div>
            <div className="metric">
              <span>Preview note</span>
              <strong>{item.note}</strong>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
