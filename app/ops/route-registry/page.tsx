import type { CSSProperties } from "react";

type RouteStatus = "live" | "preview" | "mock" | "redirect" | "planned";

type RouteRow = {
  route: string;
  purpose: string;
  build?: number;
  status: RouteStatus;
  expectedOutput: string;
  notes: string;
  healthcheck?: string;
};

type RouteGroup = {
  title: string;
  summary: string;
  routes: RouteRow[];
};

const routeGroups: RouteGroup[] = [
  {
    title: "Core health",
    summary: "Small always-on checks used before deeper operational review.",
    routes: [
      { route: "/", purpose: "Public landing page", status: "live", expectedOutput: "Marketing homepage renders without auth or database data.", notes: "Useful first check for frontend availability.", healthcheck: "/" },
      { route: "/api/health", purpose: "API heartbeat", status: "live", expectedOutput: "JSON health payload returns successfully.", notes: "Baseline backend healthcheck; no page UI.", healthcheck: "/api/health" },
      { route: "/api/health/db", purpose: "Database connectivity health", status: "live", expectedOutput: "JSON database health status when runtime config is present.", notes: "May depend on environment database configuration.", healthcheck: "/api/health/db" },
    ],
  },
  {
    title: "Ears/data sources",
    summary: "Source visibility pages and source-ear status or run endpoints.",
    routes: [
      { route: "/sources", purpose: "Source dictionary", build: 22, status: "live", expectedOutput: "Static explanation of source categories and limitations.", notes: "Public education page.", healthcheck: "/sources" },
      { route: "/data-sources", purpose: "Data-source overview", status: "live", expectedOutput: "Static data-source coverage overview.", notes: "No live API dependency.", healthcheck: "/data-sources" },
      { route: "/source-health", purpose: "Source health explanation", status: "live", expectedOutput: "Readable overview of source reliability and freshness concepts.", notes: "Public-facing source confidence language.", healthcheck: "/source-health" },
      { route: "/source-reliability", purpose: "Source reliability registry", status: "live", expectedOutput: "Reliability information for tracked source categories.", notes: "Canonical route for source reliability.", healthcheck: "/source-reliability" },
      { route: "/api/ears/sec-edgar/status", purpose: "SEC EDGAR ear status", status: "live", expectedOutput: "JSON status payload for SEC EDGAR ingestion.", notes: "API route; not called by this registry.", healthcheck: "/api/ears/sec-edgar/status" },
      { route: "/api/ears/gdelt/status", purpose: "GDELT ear status", status: "live", expectedOutput: "JSON status payload for GDELT ingestion.", notes: "API route; not called by this registry.", healthcheck: "/api/ears/gdelt/status" },
      { route: "/api/ears/coingecko/status", purpose: "CoinGecko ear status", status: "live", expectedOutput: "JSON status payload for CoinGecko ingestion.", notes: "API route; not called by this registry.", healthcheck: "/api/ears/coingecko/status" },
      { route: "/api/ears/frankfurter/status", purpose: "FX ear status", status: "live", expectedOutput: "JSON status payload for Frankfurter FX ingestion.", notes: "API route; not called by this registry.", healthcheck: "/api/ears/frankfurter/status" },
    ],
  },
  {
    title: "Brain/scoring",
    summary: "Scoring language, input contracts, and deterministic scoring previews.",
    routes: [
      { route: "/score-glossary", purpose: "Score term definitions", build: 25, status: "live", expectedOutput: "Conservative definitions for score-related language.", notes: "Public explanation; not financial advice.", healthcheck: "/score-glossary" },
      { route: "/methodology", purpose: "Methodology explanation", build: 21, status: "live", expectedOutput: "Plain-language scoring and review methodology.", notes: "Static content page.", healthcheck: "/methodology" },
      { route: "/ai-input-contract", purpose: "Canonical AI input contract", status: "live", expectedOutput: "Contract description for AI-facing inputs.", notes: "Canonical location for input contract review.", healthcheck: "/ai-input-contract" },
      { route: "/api/brain/score-preview", purpose: "Brain score preview", status: "preview", expectedOutput: "Deterministic preview scoring payload.", notes: "Preview API; no production write expected.", healthcheck: "/api/brain/score-preview" },
      { route: "/api/rule-filter/preview", purpose: "Rule filter preview", build: 17, status: "preview", expectedOutput: "Preview payload showing rule-filter behavior.", notes: "Safe review endpoint.", healthcheck: "/api/rule-filter/preview" },
      { route: "/api/mini-ai-scan/preview", purpose: "Mini AI scan contract preview", build: 18, status: "preview", expectedOutput: "Deterministic mini scan preview payload.", notes: "Contract review endpoint.", healthcheck: "/api/mini-ai-scan/preview" },
    ],
  },
  {
    title: "Pipeline/AI committee",
    summary: "Routes that explain or preview committee review and alert candidate flow.",
    routes: [
      { route: "/api/ai-committee/queue", purpose: "AI committee queue", build: 16, status: "live", expectedOutput: "Committee queue JSON or a safe empty queue.", notes: "Core pipeline API route.", healthcheck: "/api/ai-committee/queue" },
      { route: "/api/ai-committee/preview", purpose: "AI committee preview", status: "preview", expectedOutput: "Static or deterministic committee preview response.", notes: "No live write expected.", healthcheck: "/api/ai-committee/preview" },
      { route: "/ai-committee-explained", purpose: "Committee explainer", status: "live", expectedOutput: "Public explanation of committee review limits.", notes: "Education page.", healthcheck: "/ai-committee-explained" },
      { route: "/ai-review-funnel", purpose: "Review funnel explainer", status: "live", expectedOutput: "Static description of alert review stages.", notes: "Public-friendly pipeline context.", healthcheck: "/ai-review-funnel" },
      { route: "/admin/candidate-alerts", purpose: "Candidate alert review", status: "live", expectedOutput: "Internal candidate alert review page.", notes: "Admin surface; this registry does not link from admin home.", healthcheck: "/admin/candidate-alerts" },
    ],
  },
  {
    title: "Ledger/tracking",
    summary: "Accountability, public tracking, receipts, and outcome preview surfaces.",
    routes: [
      { route: "/ledger", purpose: "Ledger index", status: "live", expectedOutput: "Ledger overview page renders.", notes: "Uses local/public ledger context where available.", healthcheck: "/ledger" },
      { route: "/ledger/[id]", purpose: "Ledger detail", status: "live", expectedOutput: "Detail page for an individual ledger entry when an id exists.", notes: "Dynamic route; verify with a known id.", healthcheck: "/ledger" },
      { route: "/public-ledger", purpose: "Public accountability ledger", status: "live", expectedOutput: "Public ledger explanation and tracking surface.", notes: "Public route separate from dynamic ledger details.", healthcheck: "/public-ledger" },
      { route: "/public-tracking", purpose: "Public tracking explainer", status: "live", expectedOutput: "Explains how tracking and accountability work.", notes: "Static public education page.", healthcheck: "/public-tracking" },
      { route: "/api/ledger/outcome-preview", purpose: "Outcome preview", status: "preview", expectedOutput: "Deterministic outcome-preview JSON.", notes: "No production write expected.", healthcheck: "/api/ledger/outcome-preview" },
      { route: "/receipts-guide", purpose: "Receipts guide", status: "live", expectedOutput: "Guide explaining evidence receipts.", notes: "Public static page.", healthcheck: "/receipts-guide" },
      { route: "/api/receipts/normalize-preview", purpose: "Receipt normalization preview", build: 19, status: "preview", expectedOutput: "Normalized receipt preview payload.", notes: "Review endpoint only.", healthcheck: "/api/receipts/normalize-preview" },
    ],
  },
  {
    title: "Admin pages",
    summary: "Internal pages that exist under admin routing today.",
    routes: [
      { route: "/admin", purpose: "Admin homepage", status: "live", expectedOutput: "Internal admin landing page renders.", notes: "Not edited in this build.", healthcheck: "/admin" },
      { route: "/admin/raw-signals", purpose: "Raw signal review", status: "live", expectedOutput: "Internal raw signal review surface.", notes: "Admin-only operational page.", healthcheck: "/admin/raw-signals" },
      { route: "/admin/signal-filter", purpose: "Signal filter review", status: "live", expectedOutput: "Internal signal filtering page.", notes: "Admin-only operational page.", healthcheck: "/admin/signal-filter" },
      { route: "/admin/patterns", purpose: "Pattern management", status: "live", expectedOutput: "Internal pattern management surface.", notes: "Admin-only operational page.", healthcheck: "/admin/patterns" },
      { route: "/admin/pattern-matches", purpose: "Pattern match review", status: "live", expectedOutput: "Internal pattern-match review surface.", notes: "Admin-only operational page.", healthcheck: "/admin/pattern-matches" },
      { route: "/admin/receipts", purpose: "Receipt review", build: 19, status: "live", expectedOutput: "Internal receipt review surface.", notes: "Admin-only operational page.", healthcheck: "/admin/receipts" },
      { route: "/admin/source-reliability", purpose: "Legacy source reliability admin route", status: "redirect", expectedOutput: "Redirects or aliases to /source-reliability.", notes: "Known alias included to avoid route confusion.", healthcheck: "/admin/source-reliability" },
      { route: "/admin/ai-brain-input-contract", purpose: "Legacy AI input contract admin route", status: "redirect", expectedOutput: "Redirects or aliases to /ai-input-contract.", notes: "Known alias included to avoid route confusion.", healthcheck: "/admin/ai-brain-input-contract" },
    ],
  },
  {
    title: "Public explainer pages",
    summary: "Public education, safety, pricing, and product explanation pages.",
    routes: [
      { route: "/alerts", purpose: "Alerts index", status: "live", expectedOutput: "Public alerts page renders.", notes: "Canonical alert feed route.", healthcheck: "/alerts" },
      { route: "/alerts/[id]", purpose: "Alert detail", status: "live", expectedOutput: "Detail page for a known alert id.", notes: "Dynamic route; verify with a known id.", healthcheck: "/alerts" },
      { route: "/alert-examples", purpose: "Educational alert examples", build: 24, status: "live", expectedOutput: "Static examples with safe wording.", notes: "Does not imply investment recommendations.", healthcheck: "/alert-examples" },
      { route: "/alert-anatomy", purpose: "Alert anatomy explainer", status: "live", expectedOutput: "Breakdown of alert components.", notes: "Public educational route.", healthcheck: "/alert-anatomy" },
      { route: "/how-it-works", purpose: "Product flow explainer", status: "live", expectedOutput: "Static explanation of Swing Up flow.", notes: "Public page.", healthcheck: "/how-it-works" },
      { route: "/trust-center", purpose: "Trust and safety hub", status: "live", expectedOutput: "Trust-centered public copy.", notes: "Public page.", healthcheck: "/trust-center" },
      { route: "/risk-disclaimer", purpose: "Risk disclaimer", build: 23, status: "live", expectedOutput: "Expanded risk disclaimer renders.", notes: "Public risk language.", healthcheck: "/risk-disclaimer" },
      { route: "/pricing", purpose: "Pricing page", status: "live", expectedOutput: "Pricing information renders.", notes: "Public page.", healthcheck: "/pricing" },
    ],
  },
  {
    title: "Ops pages",
    summary: "Standalone internal ops pages with local static content only.",
    routes: [
      { route: "/ops/build-queue", purpose: "Build sequencing guide", status: "live", expectedOutput: "Static build queue and guardrails page.", notes: "Existing ops route.", healthcheck: "/ops/build-queue" },
      { route: "/ops/checklist", purpose: "Ops checklist", status: "live", expectedOutput: "Static checklist for merge and deploy review.", notes: "Existing ops route.", healthcheck: "/ops/checklist" },
      { route: "/ops/healthcheck-report", purpose: "Healthcheck report", build: 59, status: "live", expectedOutput: "Static healthcheck link report.", notes: "Existing ops route.", healthcheck: "/ops/healthcheck-report" },
      { route: "/ops/route-registry", purpose: "Production route registry", build: 63, status: "live", expectedOutput: "Static route registry grouped by operational area.", notes: "This page; no live API calls or database reads.", healthcheck: "/ops/route-registry" },
    ],
  },
  {
    title: "Redirects/aliases",
    summary: "Known alternate paths that should resolve to canonical pages.",
    routes: [
      { route: "/admin/source-reliability → /source-reliability", purpose: "Source reliability alias", status: "redirect", expectedOutput: "Request resolves to canonical source reliability page.", notes: "Known admin-to-public mismatch captured for audit clarity.", healthcheck: "/admin/source-reliability" },
      { route: "/admin/ai-brain-input-contract → /ai-input-contract", purpose: "AI input contract alias", status: "redirect", expectedOutput: "Request resolves to canonical AI input contract page.", notes: "Known admin-to-public mismatch captured for audit clarity.", healthcheck: "/admin/ai-brain-input-contract" },
      { route: "/alert-feed → /alerts", purpose: "Alert feed alias", status: "redirect", expectedOutput: "Request resolves to canonical alerts page.", notes: "Legacy feed naming kept visible for QA.", healthcheck: "/alert-feed" },
    ],
  },
];

const statusStyles: Record<RouteStatus, CSSProperties> = {
  live: { background: "rgba(34, 197, 94, 0.16)", borderColor: "rgba(34, 197, 94, 0.3)", color: "#bbf7d0" },
  preview: { background: "rgba(59, 130, 246, 0.16)", borderColor: "rgba(96, 165, 250, 0.32)", color: "#bfdbfe" },
  mock: { background: "rgba(168, 85, 247, 0.16)", borderColor: "rgba(196, 181, 253, 0.32)", color: "#ddd6fe" },
  redirect: { background: "rgba(251, 191, 36, 0.16)", borderColor: "rgba(251, 191, 36, 0.32)", color: "#fde68a" },
  planned: { background: "rgba(148, 163, 184, 0.14)", borderColor: "rgba(148, 163, 184, 0.26)", color: "#cbd5e1" },
};

export default function RouteRegistryPage() {
  const totalRoutes = routeGroups.reduce((total, group) => total + group.routes.length, 0);

  return (
    <main style={styles.page}>
      <section style={styles.hero}>
        <div>
          <p style={styles.eyebrow}>Internal ops · Build 63</p>
          <h1 style={styles.title}>Production Route Registry</h1>
          <p style={styles.subtitle}>
            A standalone static map of important Swing Up routes, why they exist, and whether each one is live, preview, mock, redirect, or planned. This page does not call APIs, read database data, or change shared navigation.
          </p>
        </div>
        <aside style={styles.heroCard} aria-label="Registry summary">
          <span style={styles.badge}>Static route</span>
          <strong style={styles.heroMetric}>{totalRoutes} routes</strong>
          <p style={styles.cardText}>Use this registry during audits to confirm canonical routes, preview endpoints, and legacy aliases before opening a conflicting build.</p>
        </aside>
      </section>

      <section style={styles.notice} aria-label="Operating note">
        <strong>Manual registry only.</strong> Links are rendered as normal anchors for reviewer convenience, but no route is fetched by this page. Treat status labels as static operational notes, not live monitoring.
      </section>

      <div style={styles.groups}>
        {routeGroups.map((group) => {
          const headingId = `${group.title.toLowerCase().replaceAll("/", "-").replaceAll(" ", "-")}-heading`;

          return (
            <section key={group.title} style={styles.group} aria-labelledby={headingId}>
              <div style={styles.groupHeader}>
                <div>
                  <p style={styles.eyebrow}>Route group</p>
                  <h2 id={headingId} style={styles.heading}>{group.title}</h2>
                  <p style={styles.groupSummary}>{group.summary}</p>
                </div>
                <span style={styles.countBadge}>{group.routes.length} routes</span>
              </div>

              <div style={styles.table} role="table" aria-label={`${group.title} route registry`}>
                <div style={{ ...styles.row, ...styles.headerRow }} role="row">
                  <span role="columnheader">Route</span>
                  <span role="columnheader">Purpose</span>
                  <span role="columnheader">Build</span>
                  <span role="columnheader">Status</span>
                  <span role="columnheader">Expected output</span>
                  <span role="columnheader">Notes</span>
                  <span role="columnheader">Healthcheck</span>
                </div>
                {group.routes.map((route) => (
                  <div key={`${group.title}-${route.route}`} style={styles.row} role="row">
                    <a style={styles.routeLink} href={route.healthcheck ?? route.route} role="cell">{route.route}</a>
                    <strong style={styles.purposeCell} role="cell">{route.purpose}</strong>
                    <span style={styles.mutedCell} role="cell">{route.build ? `Build ${route.build}` : "—"}</span>
                    <span style={{ ...styles.status, ...statusStyles[route.status] }} role="cell">{route.status}</span>
                    <span style={styles.bodyCell} role="cell">{route.expectedOutput}</span>
                    <span style={styles.bodyCell} role="cell">{route.notes}</span>
                    {route.healthcheck ? (
                      <a style={styles.healthLink} href={route.healthcheck} role="cell">Open</a>
                    ) : (
                      <span style={styles.mutedCell} role="cell">—</span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: "100vh", background: "radial-gradient(circle at top left, rgba(14, 165, 233, 0.18), transparent 32rem), radial-gradient(circle at top right, rgba(99, 102, 241, 0.12), transparent 30rem), #05070d", color: "#eef2ff", padding: "28px 16px 64px", fontFamily: "var(--font-geist-sans), system-ui, sans-serif" },
  hero: { display: "grid", gap: 18, maxWidth: 1240, margin: "0 auto 20px", padding: "24px 0" },
  eyebrow: { margin: 0, color: "#93c5fd", fontSize: 12, fontWeight: 850, letterSpacing: "0.16em", textTransform: "uppercase" },
  title: { margin: "10px 0", fontSize: "clamp(2.25rem, 10vw, 5rem)", lineHeight: 0.95, letterSpacing: "-0.065em" },
  subtitle: { margin: 0, maxWidth: 860, color: "#b6c2d9", fontSize: "clamp(1rem, 3vw, 1.18rem)", lineHeight: 1.7 },
  heroCard: { border: "1px solid rgba(148, 163, 184, 0.22)", borderRadius: 28, padding: 22, background: "linear-gradient(145deg, rgba(15, 23, 42, 0.94), rgba(15, 23, 42, 0.58))", boxShadow: "0 24px 80px rgba(0,0,0,0.35)" },
  badge: { display: "inline-flex", border: "1px solid rgba(147, 197, 253, 0.3)", borderRadius: 999, padding: "7px 11px", color: "#bfdbfe", fontSize: 12, fontWeight: 850 },
  heroMetric: { display: "block", marginTop: 18, fontSize: 34, letterSpacing: "-0.05em" },
  cardText: { margin: "10px 0 0", color: "#aab8cf", lineHeight: 1.6 },
  notice: { maxWidth: 1240, margin: "0 auto 18px", border: "1px solid rgba(251, 191, 36, 0.22)", borderRadius: 22, padding: 16, background: "rgba(113, 63, 18, 0.14)", color: "#fde68a", lineHeight: 1.6 },
  groups: { maxWidth: 1240, margin: "0 auto", display: "grid", gap: 18 },
  group: { border: "1px solid rgba(148, 163, 184, 0.18)", borderRadius: 28, padding: 18, background: "rgba(15, 23, 42, 0.72)", overflow: "hidden" },
  groupHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 16, flexWrap: "wrap" },
  heading: { margin: "8px 0 0", fontSize: "clamp(1.35rem, 5vw, 2.25rem)", letterSpacing: "-0.04em" },
  groupSummary: { margin: "8px 0 0", maxWidth: 760, color: "#aab8cf", lineHeight: 1.6 },
  countBadge: { border: "1px solid rgba(255,255,255,0.12)", borderRadius: 999, padding: "8px 11px", color: "#dbeafe", background: "rgba(15, 23, 42, 0.8)", fontSize: 12, fontWeight: 850 },
  table: { display: "grid", gap: 10 },
  row: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, alignItems: "center", padding: 14, border: "1px solid rgba(148, 163, 184, 0.14)", borderRadius: 18, background: "rgba(2, 6, 23, 0.36)" },
  headerRow: { color: "#93c5fd", fontSize: 12, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase", background: "rgba(30, 41, 59, 0.58)" },
  routeLink: { color: "#bfdbfe", overflowWrap: "anywhere", textDecoration: "none", fontWeight: 800 },
  purposeCell: { color: "#f8fafc", fontSize: 15, lineHeight: 1.45 },
  mutedCell: { color: "#cbd5e1", fontSize: 13, fontWeight: 800 },
  bodyCell: { color: "#b6c2d9", lineHeight: 1.55, fontSize: 14 },
  healthLink: { justifySelf: "start", color: "#e0f2fe", border: "1px solid rgba(147, 197, 253, 0.25)", borderRadius: 999, padding: "7px 10px", textDecoration: "none", fontSize: 12, fontWeight: 900, background: "rgba(14, 165, 233, 0.1)" },
  status: { justifySelf: "start", border: "1px solid", borderRadius: 999, padding: "7px 10px", fontSize: 12, fontWeight: 900, textTransform: "capitalize", whiteSpace: "nowrap" },
};
