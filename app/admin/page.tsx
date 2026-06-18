import Link from "next/link";

type Stage = "Live" | "Stubbed" | "Building" | "Later" | "Not configured";

type AdminCard = {
  title: string;
  explanation: string;
  stage: Stage;
  href: string;
  linkLabel: string;
};

const adminCards: AdminCard[] = [
  {
    title: "Source Health",
    explanation: "Monitor configured data sources, connection status, and operational readiness.",
    stage: "Live",
    href: "/source-health",
    linkLabel: "Open Source Health",
  },
  {
    title: "Raw Signal Store",
    explanation: "Review received raw signals before they move into filtering and scoring.",
    stage: "Live",
    href: "/admin/raw-signals",
    linkLabel: "Open Raw Signals",
  },
  {
    title: "Signal Filter",
    explanation: "Track the next build step that will classify, deduplicate, and prepare signals.",
    stage: "Building",
    href: "/admin/raw-signals",
    linkLabel: "Review Input Queue",
  },
  {
    title: "Public Ledger",
    explanation: "Inspect the public-facing record of alerts, outcomes, and accountability receipts.",
    stage: "Stubbed",
    href: "/public-ledger",
    linkLabel: "Open Ledger",
  },
  {
    title: "Methodology",
    explanation: "Read the public explanation of how Swing Up plans to evaluate signals.",
    stage: "Live",
    href: "/methodology",
    linkLabel: "Open Methodology",
  },
  {
    title: "Risk Disclaimer",
    explanation: "Confirm the user-facing risk language and non-advisory positioning.",
    stage: "Live",
    href: "/risk-disclaimer",
    linkLabel: "Open Disclaimer",
  },
  {
    title: "Database Health",
    explanation: "Check the lightweight database health endpoint used for deployment confidence.",
    stage: "Live",
    href: "/api/health/db",
    linkLabel: "Open DB Health",
  },
];

const buildPipeline = [
  "Source Health",
  "Raw Signal Store",
  "Signal Filter",
  "Historical Pattern Engine",
  "Scoring Engine",
  "AI Committee",
  "Public Ledger",
  "Notifications",
  "Stripe Managed Payments",
];

function stageClassName(stage: Stage) {
  return `badge admin-stage admin-stage-${stage.toLowerCase().replaceAll(" ", "-")}`;
}

export default function AdminPage() {
  return (
    <div className="page admin-hub">
      <section className="hero admin-hero">
        <div>
          <div className="eyebrow">Admin</div>
          <h1>Control room</h1>
          <p>
            A mobile-first operating hub for Swing Up&apos;s build stages, live system checks,
            and public trust surfaces.
          </p>
        </div>
        <div className="card admin-status-card">
          <h2>System stage</h2>
          <p>
            Source Health and Raw Signal Store are live. Signal Filter is the active build step;
            downstream scoring, notifications, payments, and integrations remain intentionally gated.
          </p>
          <div className="button-row">
            <Link className="button primary" href="/source-health">Source Health</Link>
            <Link className="button" href="/admin/raw-signals">Raw Signal Store</Link>
          </div>
        </div>
      </section>

      <section className="admin-section" aria-labelledby="admin-areas-heading">
        <div className="section-heading">
          <div>
            <div className="eyebrow">Operations</div>
            <h2 id="admin-areas-heading">Admin areas</h2>
          </div>
          <p>Each card links to the current operational surface and shows its build stage.</p>
        </div>
        <div className="grid three admin-card-grid">
          {adminCards.map((card) => (
            <article className="card admin-area-card" key={card.title}>
              <div className="admin-card-topline">
                <h3>{card.title}</h3>
                <span className={stageClassName(card.stage)}>{card.stage}</span>
              </div>
              <p>{card.explanation}</p>
              <Link className="button" href={card.href}>{card.linkLabel}</Link>
            </article>
          ))}
        </div>
      </section>

      <section className="admin-section grid two" aria-labelledby="pipeline-heading">
        <div className="card">
          <div className="eyebrow">Build Pipeline</div>
          <h2 id="pipeline-heading">System roadmap</h2>
          <ol className="admin-pipeline">
            {buildPipeline.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
        <div className="card risk-callout">
          <div className="eyebrow">Safety note</div>
          <h2>Guardrails</h2>
          <p>
            Payments, Telegram, real AI calls, and real market APIs are intentionally not connected yet.
          </p>
          <p>
            Keep using this room to verify live surfaces without enabling external money movement,
            automated messaging, model calls, or market data integrations before they are approved.
          </p>
        </div>
      </section>
    </div>
  );
}
