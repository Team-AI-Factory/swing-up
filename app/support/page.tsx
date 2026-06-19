const supportTopics = [
  ["Account and access", "Help users understand login, planned account controls, access tiers, and safe next steps when something looks wrong."],
  ["Alerts and receipts", "Explain where an alert came from, what receipts mean, and why an alert may be delayed, limited, or not available."],
  ["Billing readiness", "Prepare support language before paid access exists, without pretending that production payments or refunds are already active."],
  ["Data and status", "Direct users to source health, public status, and route explanations when data freshness or availability is the question."],
];

const contactPaths = ["Check the FAQ and support topics first", "Use public status for outage-style questions", "Use account security guidance for login or device concerns", "Escalate billing questions only after paid plans are enabled"];

export default function SupportPage() {
  return <div className="page">
    <section className="hero trust-hero"><div><div className="eyebrow">Build 97 · Support center</div><h1>Support that keeps expectations clear.</h1><p>The Support Center gives users a calm place to understand accounts, alert access, data freshness, and payment-readiness boundaries before paid users are introduced.</p></div><article className="card risk-callout"><span className="badge">Support scope</span><h2>Help with the product, not trades.</h2><p>Support can explain Swing Up features and records. It cannot provide personalized investment, legal, tax, or trading advice.</p></article></section>
    <section className="grid two trust-section">{supportTopics.map(([title, body]) => <article className="card" key={title}><span className="badge">Topic</span><h2>{title}</h2><p>{body}</p></article>)}</section>
    <section className="grid two trust-section"><article className="card"><span className="badge">Triage</span><h2>Before opening a ticket</h2><div className="disclaimer-list">{contactPaths.map((path) => <div className="metric" key={path}><span>{path}</span></div>)}</div></article><article className="card"><span className="badge">Current state</span><h2>Payments are still gated.</h2><p>This build creates support structure before real paid subscriptions, so future billing support has a visible home without claiming live payment operations today.</p></article></section>
  </div>;
}
