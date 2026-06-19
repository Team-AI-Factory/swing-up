import type { CSSProperties } from "react";

type HealthStatus = "not checked" | "pass" | "fail" | "partial";

type HealthcheckRow = {
  build?: number;
  feature: string;
  url: string;
  expected: string;
  status: HealthStatus;
};

type HealthcheckGroup = {
  title: string;
  summary: string;
  rows: HealthcheckRow[];
};

const healthcheckGroups: HealthcheckGroup[] = [
  {
    title: "Core health",
    summary: "Small baseline checks that confirm the app is reachable before deeper review.",
    rows: [
      { build: 1, feature: "API heartbeat", url: "/api/health", expected: "Returns a healthy JSON heartbeat without requiring database content.", status: "not checked" },
      { feature: "Database health endpoint", url: "/api/health/db", expected: "Responds with database connectivity status when runtime configuration is available.", status: "not checked" },
      { feature: "Homepage", url: "/", expected: "Loads the public landing page without redirect loops or runtime errors.", status: "not checked" },
    ],
  },
  {
    title: "Ears/data sources",
    summary: "Source-layer routes and pages used to verify upstream data visibility and freshness.",
    rows: [
      { build: 22, feature: "Source dictionary", url: "/sources", expected: "Explains source categories and how Swing Up treats source limitations.", status: "not checked" },
      { feature: "Source health overview", url: "/source-health", expected: "Loads the source health explanation page for founder review.", status: "not checked" },
      { feature: "Data sources", url: "/data-sources", expected: "Shows the static data-source overview with no live API dependency.", status: "not checked" },
      { feature: "Data freshness", url: "/data-freshness", expected: "Explains freshness expectations and caveats clearly.", status: "not checked" },
      { feature: "SEC EDGAR status", url: "/api/ears/sec-edgar/status", expected: "Returns current SEC EDGAR ear status payload.", status: "not checked" },
      { feature: "GDELT status", url: "/api/ears/gdelt/status", expected: "Returns current GDELT ear status payload.", status: "not checked" },
      { feature: "CoinGecko status", url: "/api/ears/coingecko/status", expected: "Returns current CoinGecko ear status payload.", status: "not checked" },
      { feature: "Frankfurter status", url: "/api/ears/frankfurter/status", expected: "Returns current FX ear status payload.", status: "not checked" },
    ],
  },
  {
    title: "Scoring and brain",
    summary: "Checks for score explanations, preview contracts, and AI input clarity.",
    rows: [
      { build: 25, feature: "Score glossary", url: "/score-glossary", expected: "Defines scoring language without implying investment advice or certainty.", status: "not checked" },
      { build: 21, feature: "Methodology", url: "/methodology", expected: "Explains the methodology in plain, conservative language.", status: "not checked" },
      { feature: "AI input contract", url: "/ai-input-contract", expected: "Loads the public contract overview for AI-facing inputs.", status: "not checked" },
      { feature: "Admin AI brain input contract", url: "/admin/ai-brain-input-contract", expected: "Loads the internal review contract page.", status: "not checked" },
      { feature: "Brain score preview API", url: "/api/brain/score-preview", expected: "Returns a deterministic preview payload for scoring review.", status: "not checked" },
      { build: 17, feature: "Rule filter preview API", url: "/api/rule-filter/preview", expected: "Returns a preview of filter behavior without production side effects.", status: "not checked" },
      { build: 18, feature: "Mini AI scan preview API", url: "/api/mini-ai-scan/preview", expected: "Returns a contract-safe mini scan preview payload.", status: "not checked" },
    ],
  },
  {
    title: "Historical patterns",
    summary: "Routes for historical context, pattern explanations, and pattern-match previews.",
    rows: [
      { feature: "Historical patterns explained", url: "/historical-patterns-explained", expected: "Explains historical pattern use without promising repeat outcomes.", status: "not checked" },
      { feature: "Admin historical events", url: "/admin/historical-events", expected: "Loads the internal historical-event review surface.", status: "not checked" },
      { feature: "Admin pattern matches", url: "/admin/pattern-matches", expected: "Loads the internal pattern-match review surface.", status: "not checked" },
      { feature: "Pattern matches preview API", url: "/api/pattern-matches/preview", expected: "Returns a preview payload for pattern-match review.", status: "not checked" },
      { feature: "Historical events route", url: "/api/historical-events", expected: "Returns the historical events API response for configured data.", status: "not checked" },
    ],
  },
  {
    title: "AI Committee",
    summary: "Founder-facing committee review and explanation routes.",
    rows: [
      { build: 16, feature: "AI committee queue API", url: "/api/ai-committee/queue", expected: "Returns committee queue data or an empty queue safely.", status: "not checked" },
      { feature: "AI committee preview API", url: "/api/ai-committee/preview", expected: "Returns a static or deterministic committee preview response.", status: "not checked" },
      { feature: "AI Committee explained", url: "/ai-committee-explained", expected: "Explains committee review with clear limits and calm wording.", status: "not checked" },
      { feature: "AI review funnel", url: "/ai-review-funnel", expected: "Loads the funnel explanation page for review flow context.", status: "not checked" },
    ],
  },
  {
    title: "Receipts",
    summary: "Evidence and receipt pages that support transparency around generated alerts.",
    rows: [
      { build: 19, feature: "Admin receipts", url: "/admin/receipts", expected: "Loads the internal receipts review page.", status: "not checked" },
      { build: 19, feature: "Receipt normalizer preview API", url: "/api/receipts/normalize-preview", expected: "Returns normalized receipt preview data without requiring writes.", status: "not checked" },
      { feature: "Receipts guide", url: "/receipts-guide", expected: "Explains how receipts support user trust and evidence review.", status: "not checked" },
      { feature: "Receipts explained", url: "/receipts-explained", expected: "Loads the public explanation of receipt meaning and limits.", status: "not checked" },
    ],
  },
  {
    title: "Ledger",
    summary: "Public and internal ledger surfaces used for accountability and outcome tracking.",
    rows: [
      { feature: "Ledger", url: "/ledger", expected: "Loads the ledger index without requiring live writes.", status: "not checked" },
      { feature: "Public ledger", url: "/public-ledger", expected: "Loads the public accountability surface.", status: "not checked" },
      { feature: "Ledger outcome preview API", url: "/api/ledger/outcome-preview", expected: "Returns a deterministic outcome-preview payload.", status: "not checked" },
    ],
  },
  {
    title: "Public pages",
    summary: "Public trust, safety, education, and alert explanation surfaces.",
    rows: [
      { build: 24, feature: "Alert examples", url: "/alert-examples", expected: "Shows educational examples without live recommendation framing.", status: "not checked" },
      { feature: "Alert anatomy", url: "/alert-anatomy", expected: "Breaks down alert parts in a user-safe way.", status: "not checked" },
      { feature: "Alert quality", url: "/alert-quality", expected: "Explains quality controls and uncertainty clearly.", status: "not checked" },
      { build: 23, feature: "Disclaimer", url: "/disclaimer", expected: "Loads the risk disclaimer page.", status: "not checked" },
      { build: 23, feature: "Risk disclaimer", url: "/risk-disclaimer", expected: "Loads expanded risk language for user review.", status: "not checked" },
      { feature: "Trust center", url: "/trust-center", expected: "Loads public trust and safety copy.", status: "not checked" },
      { feature: "How it works", url: "/how-it-works", expected: "Explains the product flow without backend dependency.", status: "not checked" },
    ],
  },
  {
    title: "Ops pages",
    summary: "Standalone internal pages that help sequence builds and post-deploy checks.",
    rows: [
      { feature: "Build queue", url: "/ops/build-queue", expected: "Loads the static build sequencing and guardrail page.", status: "not checked" },
      { feature: "Ops checklist", url: "/ops/checklist", expected: "Loads the static pre-merge and post-deploy checklist.", status: "not checked" },
      { build: 59, feature: "Healthcheck report", url: "/ops/healthcheck-report", expected: "Loads this standalone static report page.", status: "not checked" },
    ],
  },
];

const statusStyles: Record<HealthStatus, CSSProperties> = {
  "not checked": { background: "rgba(148, 163, 184, 0.14)", color: "#cbd5e1", borderColor: "rgba(148, 163, 184, 0.24)" },
  pass: { background: "rgba(34, 197, 94, 0.16)", color: "#bbf7d0", borderColor: "rgba(34, 197, 94, 0.28)" },
  fail: { background: "rgba(248, 113, 113, 0.16)", color: "#fecaca", borderColor: "rgba(248, 113, 113, 0.28)" },
  partial: { background: "rgba(251, 191, 36, 0.16)", color: "#fde68a", borderColor: "rgba(251, 191, 36, 0.28)" },
};

export default function HealthcheckReportPage() {
  const totalChecks = healthcheckGroups.reduce((count, group) => count + group.rows.length, 0);

  return (
    <main style={styles.page}>
      <section style={styles.hero}>
        <div>
          <p style={styles.eyebrow}>Internal ops · Build 59</p>
          <h1 style={styles.title}>Healthcheck Report</h1>
          <p style={styles.subtitle}>
            A standalone, static index of important Swing Up healthcheck links. It does not call live APIs, does not read database data, and is intentionally not linked from the admin homepage yet.
          </p>
        </div>
        <aside style={styles.heroCard} aria-label="Report summary">
          <span style={styles.badge}>Static route</span>
          <strong style={styles.heroMetric}>{totalChecks} checks</strong>
          <p style={styles.cardText}>Use this page as a calm manual checklist after deploys or before starting dependent work.</p>
        </aside>
      </section>

      <section style={styles.notice} aria-label="Operating rules">
        <p style={styles.noticeText}>Manual review only: open each link separately, record the observed result outside the app, and leave placeholders unchanged until a future build adds persistence intentionally.</p>
      </section>

      <div style={styles.groups}>
        {healthcheckGroups.map((group) => (
          <section key={group.title} style={styles.group} aria-labelledby={`${group.title.toLowerCase().replaceAll(" ", "-")}-heading`}>
            <div style={styles.groupHeader}>
              <div>
                <p style={styles.eyebrow}>Healthcheck group</p>
                <h2 id={`${group.title.toLowerCase().replaceAll(" ", "-")}-heading`} style={styles.heading}>{group.title}</h2>
                <p style={styles.groupSummary}>{group.summary}</p>
              </div>
              <span style={styles.countBadge}>{group.rows.length} links</span>
            </div>

            <div style={styles.table} role="table" aria-label={`${group.title} healthchecks`}>
              <div style={{ ...styles.row, ...styles.headerRow }} role="row">
                <span role="columnheader">Build</span>
                <span role="columnheader">Feature</span>
                <span role="columnheader">URL</span>
                <span role="columnheader">Expected result</span>
                <span role="columnheader">Status</span>
              </div>
              {group.rows.map((row) => (
                <div key={`${group.title}-${row.feature}-${row.url}`} style={styles.row} role="row">
                  <span style={styles.buildCell} role="cell">{row.build ? `Build ${row.build}` : "—"}</span>
                  <strong style={styles.featureCell} role="cell">{row.feature}</strong>
                  <a style={styles.linkCell} href={row.url} role="cell">{row.url}</a>
                  <span style={styles.expectedCell} role="cell">{row.expected}</span>
                  <span style={{ ...styles.status, ...statusStyles[row.status] }} role="cell">{row.status}</span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: "100vh", background: "radial-gradient(circle at top left, rgba(30, 64, 175, 0.2), transparent 34rem), #05070d", color: "#eef2ff", padding: "28px 16px 64px", fontFamily: "var(--font-geist-sans), system-ui, sans-serif" },
  hero: { display: "grid", gap: 18, maxWidth: 1180, margin: "0 auto 20px", padding: "24px 0" },
  eyebrow: { margin: 0, color: "#93c5fd", fontSize: 12, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase" },
  title: { margin: "10px 0", fontSize: "clamp(2.2rem, 10vw, 4.8rem)", lineHeight: 0.95, letterSpacing: "-0.06em" },
  subtitle: { margin: 0, maxWidth: 780, color: "#b6c2d9", fontSize: "clamp(1rem, 3vw, 1.18rem)", lineHeight: 1.7 },
  heroCard: { border: "1px solid rgba(148, 163, 184, 0.22)", borderRadius: 28, padding: 22, background: "linear-gradient(145deg, rgba(15, 23, 42, 0.94), rgba(15, 23, 42, 0.58))", boxShadow: "0 24px 80px rgba(0,0,0,0.35)" },
  badge: { display: "inline-flex", border: "1px solid rgba(147, 197, 253, 0.3)", borderRadius: 999, padding: "7px 11px", color: "#bfdbfe", fontSize: 12, fontWeight: 800 },
  heroMetric: { display: "block", marginTop: 18, fontSize: 34, letterSpacing: "-0.05em" },
  cardText: { margin: "10px 0 0", color: "#aab8cf", lineHeight: 1.6 },
  notice: { maxWidth: 1180, margin: "0 auto 18px", border: "1px solid rgba(251, 191, 36, 0.22)", borderRadius: 22, padding: 16, background: "rgba(113, 63, 18, 0.14)" },
  noticeText: { margin: 0, color: "#fde68a", lineHeight: 1.6 },
  groups: { maxWidth: 1180, margin: "0 auto", display: "grid", gap: 18 },
  group: { border: "1px solid rgba(148, 163, 184, 0.18)", borderRadius: 28, padding: 18, background: "rgba(15, 23, 42, 0.72)", overflow: "hidden" },
  groupHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 16, flexWrap: "wrap" },
  heading: { margin: "8px 0 0", fontSize: "clamp(1.35rem, 5vw, 2.25rem)", letterSpacing: "-0.04em" },
  groupSummary: { margin: "8px 0 0", maxWidth: 760, color: "#aab8cf", lineHeight: 1.6 },
  countBadge: { border: "1px solid rgba(255,255,255,0.12)", borderRadius: 999, padding: "8px 11px", color: "#dbeafe", background: "rgba(15, 23, 42, 0.8)", fontSize: 12, fontWeight: 800 },
  table: { display: "grid", gap: 10 },
  row: { display: "grid", gridTemplateColumns: "minmax(72px, 0.55fr) minmax(150px, 1fr) minmax(180px, 1fr) minmax(220px, 1.5fr) minmax(110px, 0.65fr)", gap: 12, alignItems: "center", padding: 14, border: "1px solid rgba(148, 163, 184, 0.14)", borderRadius: 18, background: "rgba(2, 6, 23, 0.36)" },
  headerRow: { color: "#93c5fd", fontSize: 12, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase", background: "rgba(30, 41, 59, 0.58)" },
  buildCell: { color: "#cbd5e1", fontSize: 13, fontWeight: 800 },
  featureCell: { color: "#f8fafc", fontSize: 15 },
  linkCell: { color: "#bfdbfe", overflowWrap: "anywhere", textDecoration: "none", fontWeight: 750 },
  expectedCell: { color: "#b6c2d9", lineHeight: 1.55, fontSize: 14 },
  status: { justifySelf: "start", border: "1px solid", borderRadius: 999, padding: "7px 10px", fontSize: 12, fontWeight: 900, textTransform: "capitalize", whiteSpace: "nowrap" },
};
