import Link from "next/link";

const adminCards = [
  {
    title: "GDELT Market-Wide Firehose",
    description: "Run the broad market-wide GDELT firehose, local watched-company detection, and source health checks.",
    stage: "Live",
    href: "/admin/gdelt",
    cta: "Open GDELT Ear",
  },
  {
    title: "SEC EDGAR Ear",
    description: "Run a safe dry-run check of the first real public ear and inspect its latest source health details.",
    stage: "Live",
    href: "/admin/sec-edgar",
    cta: "Open SEC EDGAR Ear",
  },
  {
    title: "Source Health",
    description: "Check whether each signal source is connected, stubbed, missing keys, degraded, or returning errors.",
    stage: "Live",
    href: "/source-health",
    cta: "Open Source Health",
  },
  {
    title: "Raw Signal Store",
    description: "Review the raw market-signal inbox before any filtering, scoring, history matching, or AI review.",
    stage: "Live",
    href: "/admin/raw-signals",
    cta: "Open Raw Signal Store",
  },
  {
    title: "Signal Filter",
    description: "Run and inspect the deterministic rule filter that screens raw signals without deleting receipts.",
    stage: "Live",
    href: "/admin/signal-filter",
    cta: "Open Signal Filter",
  },
  {
    title: "Historical Event Library",
    description: "Inspect the database-backed memory bank of past market events and later price reactions.",
    stage: "Live",
    href: "/admin/historical-events",
    cta: "Open Historical Events",
  },
  {
    title: "Historical Pattern Match",
    description: "Compare promoted or queued raw signals with past events using simple rule-based research clues.",
    stage: "Live",
    href: "/admin/pattern-matches",
    cta: "Open Pattern Matches",
  },
  {
    title: "Public Ledger",
    description: "Preview the public accountability ledger that will track alert outcomes and supporting receipts.",
    stage: "Stubbed",
    href: "/public-ledger",
    cta: "View Public Ledger",
  },
  {
    title: "Methodology",
    description: "Explain how Swing Up collects signals, filters noise, scores evidence, and frames research alerts.",
    stage: "Live",
    href: "/methodology",
    cta: "Read Methodology",
  },
  {
    title: "Risk Disclaimer",
    description: "Show the investor-facing risk language that keeps alerts positioned as research, not financial advice.",
    stage: "Live",
    href: "/risk-disclaimer",
    cta: "Read Disclaimer",
  },
  {
    title: "Database Health",
    description: "Verify the database health endpoint used by operators and deployment checks.",
    stage: "Live",
    href: "/api/health/db",
    cta: "Check Database Health",
  },
];

const pipelineSteps = [
  "SEC EDGAR Ear",
  "GDELT Market-Wide Firehose",
  "Source Health",
  "Raw Signal Store",
  "Signal Filter",
  "Historical Event Library",
  "Historical Pattern Engine",
  "Scoring Engine",
  "AI Committee",
  "Public Ledger",
  "Notifications",
  "Stripe Managed Payments",
];

export default function AdminPage() {
  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Admin</div>
          <h1>Admin Control Room</h1>
          <p>
            A clean operator hub for checking live infrastructure, reviewing raw receipts, running the signal filter,
            and tracking what is still stubbed or planned for later builds.
          </p>
          <p className="muted">
            Payments, Telegram, real AI calls, and real market APIs are intentionally not connected yet.
          </p>
        </div>
        <div className="card">
          <div className="metric"><span>SEC EDGAR Ear</span><strong>Live</strong></div>
          <div className="metric"><span>GDELT Market-Wide Firehose</span><strong>Live</strong></div>
          <div className="metric"><span>Source Health</span><strong>Live</strong></div>
          <div className="metric"><span>Raw Signal Store</span><strong>Live</strong></div>
          <div className="metric"><span>Signal Filter</span><strong>Live</strong></div>
          <div className="metric"><span>Historical Events</span><strong>Live</strong></div>
          <div className="metric"><span>Pattern Match</span><strong>Live</strong></div>
          <div className="metric"><span>Public Ledger</span><strong>Stubbed</strong></div>
        </div>
      </section>

      <section className="grid two trust-section">
        {adminCards.map((card) => (
          <article className="card" key={card.title}>
            <span className="badge">{card.stage}</span>
            <h2>{card.title}</h2>
            <p>{card.description}</p>
            <div className="button-row">
              <Link className="button" href={card.href}>{card.cta}</Link>
            </div>
          </article>
        ))}
      </section>

      <section className="card trust-section">
        <div className="eyebrow">Build Pipeline</div>
        <h2>Signal-to-alert build path</h2>
        <p>
          The current admin surface keeps completed pieces visible while making the remaining sequence clear for future work.
        </p>
        <div className="grid three">
          {pipelineSteps.map((step, index) => (
            <div className="metric" key={step}>
              <span>Step {index + 1}</span>
              <strong>{step}</strong>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
