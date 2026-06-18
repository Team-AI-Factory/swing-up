import type { CSSProperties } from "react";

const queueRows = [
  {
    number: 16,
    name: "AI Committee Queue",
    type: "Core / backend",
    status: "in progress",
    dependency: "Raw signals and candidate alert review surfaces",
    parallel: "None in the backend chain; non-core standalone pages only",
    riskyFiles: "app/api/ai-committee/queue/route.ts, Prisma models, admin review surfaces",
    healthchecks: ["/api/health", "/api/ai-committee/queue"],
    warning: "Do not overlap with another build that changes AI committee state, schema, or admin routing.",
  },
  {
    number: 17,
    name: "Rule Filter Engine",
    type: "Core / backend",
    status: "pending",
    dependency: "Build 16 merged, deployed, and healthchecked",
    parallel: "Standalone public or ops pages that do not touch shared files",
    riskyFiles: "app/api/rule-filter/preview/route.ts, filtering logic, database writes",
    healthchecks: ["/api/health", "/api/rule-filter/preview"],
    warning: "Start only after Build 16 is stable so queue contracts do not drift.",
  },
  {
    number: 18,
    name: "Mini AI Scan Contract",
    type: "Core / backend",
    status: "pending",
    dependency: "Build 17 merged, deployed, and healthchecked",
    parallel: "Standalone non-core pages with local static data only",
    riskyFiles: "app/api/mini-ai-scan/preview/route.ts, scan payload contracts",
    healthchecks: ["/api/health", "/api/mini-ai-scan/preview"],
    warning: "Avoid contract changes while rule-filter output is still under review.",
  },
  {
    number: 19,
    name: "Alert Receipts Normalizer",
    type: "Core / backend",
    status: "pending",
    dependency: "Build 18 merged, deployed, and healthchecked",
    parallel: "Copy-only pages if they avoid admin, globals, layout, API, and schema files",
    riskyFiles: "receipt models, alert receipt utilities, admin receipts surfaces",
    healthchecks: ["/api/health", "/admin/receipts"],
    warning: "Receipts influence evidence display, so do not merge beside competing receipt edits.",
  },
  {
    number: 20,
    name: "Price Snapshot Tracker",
    type: "Core / backend",
    status: "pending",
    dependency: "Build 19 merged, deployed, and healthchecked",
    parallel: "Standalone informational pages only",
    riskyFiles: "price snapshot storage, alert scoring context, API routes",
    healthchecks: ["/api/health", "/alerts"],
    warning: "Price context touches scoring assumptions; keep it isolated from alert-contract work.",
  },
  {
    number: 21,
    name: "Methodology Page",
    type: "Non-core / frontend",
    status: "merged",
    dependency: "None after public shell exists",
    parallel: "Builds that do not edit the same page or shared navigation",
    riskyFiles: "app/methodology/page.tsx",
    healthchecks: ["/methodology", "/api/health"],
    warning: "Safe when copy-only and not linked through shared navigation during backend chain work.",
  },
  {
    number: 22,
    name: "Source Dictionary Page",
    type: "Non-core / frontend",
    status: "merged",
    dependency: "None after source terminology is stable",
    parallel: "Other standalone page routes with disjoint files",
    riskyFiles: "app/sources/page.tsx or standalone dictionary route",
    healthchecks: ["/sources", "/api/health"],
    warning: "Avoid editing shared source components while source-health backend work is active.",
  },
  {
    number: 23,
    name: "Disclaimer Page",
    type: "Non-core / frontend",
    status: "merged",
    dependency: "Risk language approved",
    parallel: "Standalone copy pages with no shared layout edits",
    riskyFiles: "app/disclaimer/page.tsx, app/risk-disclaimer/page.tsx",
    healthchecks: ["/disclaimer", "/risk-disclaimer", "/api/health"],
    warning: "Legal and risk copy should not be casually overwritten by later marketing-page edits.",
  },
  {
    number: 24,
    name: "Alert Examples Page",
    type: "Non-core / frontend",
    status: "merged",
    dependency: "Alert anatomy and public explanation pages",
    parallel: "Frontend pages that do not touch alert API contracts",
    riskyFiles: "app/alert-examples/page.tsx",
    healthchecks: ["/alert-examples", "/api/health"],
    warning: "Examples must stay clearly educational and must not imply live recommendations.",
  },
  {
    number: 25,
    name: "Score Glossary Page",
    type: "Non-core / frontend",
    status: "merged",
    dependency: "Scoring terms agreed for public explanation",
    parallel: "Other standalone non-core routes",
    riskyFiles: "app/score-glossary/page.tsx",
    healthchecks: ["/score-glossary", "/api/health"],
    warning: "Do not change scoring definitions in code while editing glossary copy.",
  },
] as const;

const guardrails = [
  "Only one core/backend chain build should run at a time.",
  "Standalone non-core pages can run in parallel only if they do not touch shared files.",
  "Never run two builds that both edit app/admin/page.tsx.",
  "Never run two builds that both edit app/globals.css.",
  "Do not start a dependent backend build until the previous build is merged, deployed, and healthchecked.",
  "Codex should open PRs, but the founder should approve merges.",
];

type BuildStatus = "pending" | "in progress" | "merged" | "deployed" | "blocked";

const statusStyles: Record<BuildStatus, string> = {
  pending: "rgba(148, 163, 184, 0.16)",
  "in progress": "rgba(59, 130, 246, 0.2)",
  merged: "rgba(34, 197, 94, 0.18)",
  deployed: "rgba(20, 184, 166, 0.18)",
  blocked: "rgba(248, 113, 113, 0.18)",
};

export default function OpsBuildQueuePage() {
  return (
    <main style={styles.page}>
      <section style={styles.hero}>
        <div>
          <p style={styles.eyebrow}>Internal ops</p>
          <h1 style={styles.title}>Build Queue + Guardrails</h1>
          <p style={styles.subtitle}>
            A standalone, static control sheet for sequencing Codex builds without touching shared navigation, admin home, global styles, layouts, APIs, or backend logic.
          </p>
        </div>
        <div style={styles.heroCard}>
          <span style={styles.badge}>Conflict-safe route</span>
          <strong style={styles.heroMetric}>/ops/build-queue</strong>
          <p style={styles.cardText}>Local static data only. No database calls. No backend calls. Not linked from the admin homepage yet.</p>
        </div>
      </section>

      <section style={styles.section} aria-labelledby="queue-heading">
        <div style={styles.sectionHeader}>
          <p style={styles.eyebrow}>Current build queue</p>
          <h2 id="queue-heading" style={styles.heading}>Backend chain first, standalone pages in parallel only when isolated.</h2>
        </div>
        <div style={styles.queueGrid}>
          {queueRows.map((build) => (
            <article key={build.number} style={styles.buildCard}>
              <div style={styles.cardHeader}>
                <div>
                  <span style={styles.buildNumber}>Build {build.number}</span>
                  <h3 style={styles.cardTitle}>{build.name}</h3>
                </div>
                <span style={{ ...styles.status, background: statusStyles[build.status] }}>{build.status}</span>
              </div>
              <dl style={styles.details}>
                <div style={styles.detailRow}><dt>Type</dt><dd>{build.type}</dd></div>
                <div style={styles.detailRow}><dt>Dependency</dt><dd>{build.dependency}</dd></div>
                <div style={styles.detailRow}><dt>Safe parallel builds</dt><dd>{build.parallel}</dd></div>
                <div style={styles.detailRow}><dt>Risky files</dt><dd>{build.riskyFiles}</dd></div>
                <div style={styles.detailRow}><dt>Healthchecks</dt><dd>{build.healthchecks.join(" · ")}</dd></div>
              </dl>
              <p style={styles.warning}>{build.warning}</p>
            </article>
          ))}
        </div>
      </section>

      <section style={styles.guardrails} aria-labelledby="guardrails-heading">
        <p style={styles.eyebrow}>Guardrails</p>
        <h2 id="guardrails-heading" style={styles.heading}>Rules before starting the next build</h2>
        <ol style={styles.guardrailList}>
          {guardrails.map((guardrail) => (
            <li key={guardrail} style={styles.guardrailItem}>{guardrail}</li>
          ))}
        </ol>
      </section>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: "100vh", background: "#05070d", color: "#eef2ff", padding: "28px 16px 56px", fontFamily: "var(--font-geist-sans), system-ui, sans-serif" },
  hero: { display: "grid", gap: 18, maxWidth: 1180, margin: "0 auto 28px", padding: "24px 0" },
  eyebrow: { margin: 0, color: "#93c5fd", fontSize: 12, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase" },
  title: { margin: "10px 0", fontSize: "clamp(2rem, 9vw, 4.6rem)", lineHeight: 0.95, letterSpacing: "-0.06em" },
  subtitle: { margin: 0, maxWidth: 760, color: "#b6c2d9", fontSize: "clamp(1rem, 3vw, 1.2rem)", lineHeight: 1.7 },
  heroCard: { border: "1px solid rgba(148, 163, 184, 0.22)", borderRadius: 28, padding: 22, background: "linear-gradient(145deg, rgba(15, 23, 42, 0.94), rgba(15, 23, 42, 0.58))", boxShadow: "0 24px 80px rgba(0,0,0,0.35)" },
  badge: { display: "inline-flex", border: "1px solid rgba(147, 197, 253, 0.3)", borderRadius: 999, padding: "7px 11px", color: "#bfdbfe", fontSize: 12, fontWeight: 800 },
  heroMetric: { display: "block", marginTop: 18, fontSize: 28, letterSpacing: "-0.04em" },
  cardText: { margin: "10px 0 0", color: "#aab8cf", lineHeight: 1.6 },
  section: { maxWidth: 1180, margin: "0 auto" },
  sectionHeader: { marginBottom: 16 },
  heading: { margin: "8px 0 0", fontSize: "clamp(1.35rem, 5vw, 2.3rem)", letterSpacing: "-0.04em" },
  queueGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 310px), 1fr))", gap: 14 },
  buildCard: { border: "1px solid rgba(148, 163, 184, 0.18)", borderRadius: 24, padding: 18, background: "rgba(15, 23, 42, 0.72)" },
  cardHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  buildNumber: { color: "#93c5fd", fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.12em" },
  cardTitle: { margin: "6px 0 0", fontSize: 20, letterSpacing: "-0.03em" },
  status: { flexShrink: 0, border: "1px solid rgba(255,255,255,0.12)", borderRadius: 999, padding: "7px 10px", color: "#e5edff", fontSize: 12, fontWeight: 800, textTransform: "capitalize" },
  details: { display: "grid", gap: 10, margin: "18px 0", color: "#cbd5e1" },
  detailRow: { display: "grid", gap: 4 },
  warning: { margin: 0, borderLeft: "3px solid #fbbf24", paddingLeft: 12, color: "#fde68a", lineHeight: 1.55 },
  guardrails: { maxWidth: 1180, margin: "28px auto 0", border: "1px solid rgba(147, 197, 253, 0.2)", borderRadius: 28, padding: 22, background: "rgba(8, 13, 24, 0.9)" },
  guardrailList: { margin: "18px 0 0", paddingLeft: 22, display: "grid", gap: 12, color: "#dbeafe", lineHeight: 1.6 },
  guardrailItem: { paddingLeft: 4 },
};
