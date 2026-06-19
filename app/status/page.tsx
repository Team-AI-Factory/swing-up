const systemAreas = [
  ["Web app", "Available", "Public pages and core navigation should render without requiring market data."],
  ["Source health", "Review", "Source status can vary by configured environment and should be checked before trusting freshness."],
  ["Alert pipeline", "Preview", "Candidate alerts and access tiers are still being staged behind safety checks."],
  ["Payments", "Not enabled", "Paid billing operations are not presented as live in this build."],
];

const statusRules = ["Static page only; it does not poll live services", "Use source-health pages for data-input context", "Use ops healthchecks for deploy review", "Treat stale or missing source data as a reason to slow down"];

export default function StatusPage() {
  return <div className="page">
    <section className="hero trust-hero"><div><div className="eyebrow">Build 98 · Public status</div><h1>System status, written plainly.</h1><p>This public status page gives users a simple view of whether Swing Up surfaces are available, limited, preview-only, or not enabled yet.</p></div><article className="card risk-callout"><span className="badge">Status boundary</span><h2>Not a live monitor yet.</h2><p>This page is a public status explainer. It does not continuously ping services, databases, or third-party data sources.</p></article></section>
    <section className="grid two trust-section">{systemAreas.map(([area, state, note]) => <article className="card" key={area}><span className="badge">{state}</span><h2>{area}</h2><p>{note}</p></article>)}</section>
    <section className="card trust-section"><span className="badge">How to read status</span><h2>Availability is not data certainty.</h2><div className="disclaimer-list">{statusRules.map((rule) => <div className="metric" key={rule}><span>{rule}</span></div>)}</div></section>
  </div>;
}
