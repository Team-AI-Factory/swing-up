const milestones = [
  {
    title: "Foundation app shell",
    status: "Live",
    explanation: "The core Next.js application structure, shared shell, public pages, and baseline routing are in place.",
    matters: "A stable shell gives every public and internal workflow a consistent place to grow without rebuilding the product frame each time.",
  },
  {
    title: "Railway deployment",
    status: "Live",
    explanation: "Swing Up has a deployment target so the product can be built and checked outside a local developer machine.",
    matters: "Deployment makes it possible to review real build behavior, environment settings, and production-readiness early.",
  },
  {
    title: "Railway PostgreSQL database",
    status: "Live",
    explanation: "A PostgreSQL-backed persistence layer exists for application records and pipeline state.",
    matters: "Durable storage is required before signals, source checks, reviews, and outcomes can be tracked responsibly.",
  },
  {
    title: "PWA foundation",
    status: "Live",
    explanation: "The public app includes progressive web app basics such as manifest and icon assets.",
    matters: "PWA groundwork keeps the product accessible and prepares it for more app-like usage later.",
  },
  {
    title: "Source Health",
    status: "Live",
    explanation: "Source status labels and checks are visible so users can see whether inputs are connected, stubbed, degraded, or unavailable.",
    matters: "Source reliability has to be understood before any downstream alert or score can be trusted.",
  },
  {
    title: "Public methodology and risk pages",
    status: "Live",
    explanation: "Public explanation pages describe the research workflow, limitations, and investment-risk boundaries.",
    matters: "Clear methodology and risk language reduce hype and make the product safer to evaluate while it is being built.",
  },
  {
    title: "Raw Signal Store",
    status: "Live",
    explanation: "Early signal records can be stored with basic source, payload, status, and review context.",
    matters: "Keeping raw inputs creates receipts and prevents the pipeline from relying on memory, screenshots, or one-off manual notes.",
  },
  {
    title: "Signal Filter",
    status: "Live",
    explanation: "A filtering step exists to separate noisy or weak raw signals from candidates worth deeper review.",
    matters: "Filtering is the first safety layer between raw market noise and anything that might later become user-facing research.",
  },
  {
    title: "Admin Control Room",
    status: "Live",
    explanation: "Internal review pages exist for operating and inspecting parts of the build workflow.",
    matters: "Admin visibility helps the builder review pipeline state before exposing stronger user-facing claims.",
  },
  {
    title: "Historical Event Library",
    status: "Live",
    explanation: "Past event examples can be recorded with context, outcomes, and lessons for future comparison.",
    matters: "Historical examples help prevent every new signal from being treated as unique or automatically important.",
  },
  {
    title: "Historical Pattern Match",
    status: "Live",
    explanation: "Current setups can be compared against historical event patterns with confidence labels and notes.",
    matters: "Pattern comparison adds context, but keeps uncertainty visible instead of turning history into a guarantee.",
  },
  {
    title: "Data Sources Directory",
    status: "Live",
    explanation: "A public directory lists planned and current input categories, what they watch, and their limitations.",
    matters: "Users can see which sources are real, stubbed, not configured, or reserved for later before trusting the workflow.",
  },
  {
    title: "Watchlist Preview",
    status: "Live",
    explanation: "A public watchlist preview shows the intended shape of monitored ideas before full alerts are enabled.",
    matters: "The preview communicates product direction without pretending that mature scoring or recommendations already exist.",
  },
  {
    title: "SEC EDGAR public ear",
    status: "Live",
    explanation: "A public SEC EDGAR ear page explains the filing-monitoring input and its safety boundaries.",
    matters: "Filings are important source material, but they need careful labeling before they influence research outputs.",
  },
  {
    title: "SEC EDGAR Admin Run Panel",
    status: "Building",
    explanation: "An internal run panel exists for controlled SEC EDGAR workflow checks and operational review.",
    matters: "Manual run controls help test ingestion safely before automated filing signals are relied on more heavily.",
  },
  {
    title: "GDELT public ear planned/in progress",
    status: "Planned",
    explanation: "A public GDELT ear is planned to explain broad news and event monitoring before it becomes a real signal input.",
    matters: "Global news data can be noisy, so its public explanation should come with clear limitations before deeper integration.",
  },
];

const statusClassNames: Record<string, string> = {
  Live: "status-connected",
  Building: "status-not_configured",
  Planned: "status-stubbed",
  Later: "outcome-unknown",
};

export default function BuildLogPage() {
  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Public build status</div>
          <h1>Swing Up Build Log</h1>
          <p>This page tracks the major product milestones as Swing Up is built.</p>
        </div>
        <article className="card risk-callout">
          <span className="badge">Safety note</span>
          <h2>Build status is not performance.</h2>
          <p>
            Build status does not mean investment performance. Swing Up is being built step by step, with real alerts and scoring added only after the data pipeline is reliable.
          </p>
        </article>
      </section>

      <section className="grid two trust-section">
        {milestones.map((milestone) => (
          <article className="card" key={milestone.title}>
            <span className={`badge ${statusClassNames[milestone.status]}`}>{milestone.status}</span>
            <h3 style={{ marginTop: 12 }}>{milestone.title}</h3>
            <div className="metric">
              <span>What has been built</span>
              <strong>{milestone.explanation}</strong>
            </div>
            <div className="metric">
              <span>Why it matters</span>
              <strong>{milestone.matters}</strong>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
