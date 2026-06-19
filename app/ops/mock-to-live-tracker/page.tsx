import type { CSSProperties } from "react";

type CurrentMode = "live" | "partial" | "mock" | "preview";
type Priority = "fix now" | "fix soon" | "later";

type ConversionArea = {
  feature: string;
  currentMode: CurrentMode;
  whyItMatters: string;
  neededLiveConnection: string;
  blockingDependency: string;
  suggestedBuildNumber: string;
  priority: Priority;
  status: string;
};

const conversionAreas: ConversionArea[] = [
  {
    feature: "Score preview API",
    currentMode: "preview",
    whyItMatters: "Score explanations shape user trust before an alert is promoted.",
    neededLiveConnection: "Connect scoring output to reviewed candidate alerts and persisted score components.",
    blockingDependency: "Stable alert scoring contract and score audit trail.",
    suggestedBuildNumber: "Build 15 / 16 follow-up",
    priority: "fix now",
    status: "Awaiting live scoring contract",
  },
  {
    feature: "Pattern match preview",
    currentMode: "preview",
    whyItMatters: "Pattern language must reflect real historical comparisons, not demo-only matches.",
    neededLiveConnection: "Read approved historical patterns and attach matches to alert candidates.",
    blockingDependency: "Historical pattern admin data and rule-filter output.",
    suggestedBuildNumber: "Build 17",
    priority: "fix soon",
    status: "Preview only",
  },
  {
    feature: "Public ledger",
    currentMode: "partial",
    whyItMatters: "The ledger is the public trust record for alerts, receipts, and later outcomes.",
    neededLiveConnection: "Publish reviewed alerts, receipts, timestamps, and outcome updates from durable storage.",
    blockingDependency: "Receipt normalizer and public-safe ledger publishing rules.",
    suggestedBuildNumber: "Build 19 follow-up",
    priority: "fix soon",
    status: "Static/partial trust surface",
  },
  {
    feature: "Alert feed mock data",
    currentMode: "mock",
    whyItMatters: "Users need a feed that clearly separates education from real alert activity.",
    neededLiveConnection: "Replace mock cards with reviewed alerts from the live alert pipeline.",
    blockingDependency: "Candidate alert review, AI committee queue, and publishing gate.",
    suggestedBuildNumber: "Build 16+",
    priority: "fix now",
    status: "Mock feed content",
  },
  {
    feature: "Historical event seed preview",
    currentMode: "preview",
    whyItMatters: "Historical examples anchor pattern quality and reduce false confidence.",
    neededLiveConnection: "Seed or import verified historical events with source receipts and review status.",
    blockingDependency: "Historical event schema/content approval and source receipt validation.",
    suggestedBuildNumber: "Known after backend chain",
    priority: "fix soon",
    status: "Seed preview",
  },
  {
    feature: "Historical patterns admin data",
    currentMode: "partial",
    whyItMatters: "Admin pattern review controls which comparisons may appear in user-facing alerts.",
    neededLiveConnection: "Persist pattern definitions, review state, confidence notes, and version history.",
    blockingDependency: "Pattern admin workflow and pattern-match preview contract.",
    suggestedBuildNumber: "Build 17 follow-up",
    priority: "fix soon",
    status: "Admin data incomplete",
  },
  {
    feature: "Candidate alerts admin data",
    currentMode: "partial",
    whyItMatters: "Founder review needs real candidate alerts before anything can be published.",
    neededLiveConnection: "Connect raw signals, scores, rule-filter results, receipts, and review decisions.",
    blockingDependency: "AI Committee queue and rule-filter engine.",
    suggestedBuildNumber: "Build 16 / 17",
    priority: "fix now",
    status: "Needs pipeline connection",
  },
  {
    feature: "Receipts admin data",
    currentMode: "partial",
    whyItMatters: "Receipts are the evidence trail behind alert explanations and ledger entries.",
    neededLiveConnection: "Normalize source receipts and attach them to candidate alerts and ledger records.",
    blockingDependency: "Receipts normalizer and receipt review rules.",
    suggestedBuildNumber: "Build 19",
    priority: "fix now",
    status: "Awaiting normalizer",
  },
  {
    feature: "AI Committee queue",
    currentMode: "partial",
    whyItMatters: "Committee output decides which raw signals are worth human review.",
    neededLiveConnection: "Persist queue items, committee rationale, timestamps, and disposition state.",
    blockingDependency: "Raw signal ingestion and candidate alert review contract.",
    suggestedBuildNumber: "Build 16",
    priority: "fix now",
    status: "Backend chain item",
  },
  {
    feature: "Rule filter preview",
    currentMode: "preview",
    whyItMatters: "Rule filtering keeps noisy or unsafe candidates out of the alert workflow.",
    neededLiveConnection: "Run deterministic filters against real queue/candidate payloads.",
    blockingDependency: "AI Committee queue output contract.",
    suggestedBuildNumber: "Build 17",
    priority: "fix now",
    status: "Preview contract",
  },
  {
    feature: "Mini AI scan preview",
    currentMode: "preview",
    whyItMatters: "AI scan summaries must be traceable before they influence review decisions.",
    neededLiveConnection: "Attach scan results to candidate alerts with prompt/version metadata and safe wording.",
    blockingDependency: "Rule-filter output and AI scan contract approval.",
    suggestedBuildNumber: "Build 18",
    priority: "fix soon",
    status: "Preview contract",
  },
  {
    feature: "Receipts normalizer preview",
    currentMode: "preview",
    whyItMatters: "Evidence must be consistent before it appears in admin review or public ledger views.",
    neededLiveConnection: "Normalize live source payloads into durable receipt records with source metadata.",
    blockingDependency: "Mini AI scan contract and receipt model decisions.",
    suggestedBuildNumber: "Build 19",
    priority: "fix soon",
    status: "Preview contract",
  },
  {
    feature: "Price snapshot preview",
    currentMode: "preview",
    whyItMatters: "Price context helps explain market movement without pretending to predict outcomes.",
    neededLiveConnection: "Store time-bounded price snapshots connected to alert timestamps and tickers.",
    blockingDependency: "Receipt normalization and price snapshot storage plan.",
    suggestedBuildNumber: "Build 20",
    priority: "later",
    status: "Preview contract",
  },
  {
    feature: "Alert examples mock page",
    currentMode: "mock",
    whyItMatters: "Examples are useful for onboarding but must not be confused with real market alerts.",
    neededLiveConnection: "Keep examples educational or replace with clearly labeled published historical alerts.",
    blockingDependency: "Public ledger publishing rules and safe wording review.",
    suggestedBuildNumber: "Build 24 follow-up",
    priority: "later",
    status: "Mock education page",
  },
];

const modeStyles: Record<CurrentMode, CSSProperties> = {
  live: { background: "rgba(34, 197, 94, 0.18)", color: "#bbf7d0" },
  partial: { background: "rgba(251, 191, 36, 0.18)", color: "#fde68a" },
  mock: { background: "rgba(248, 113, 113, 0.18)", color: "#fecaca" },
  preview: { background: "rgba(96, 165, 250, 0.18)", color: "#bfdbfe" },
};

const priorityStyles: Record<Priority, CSSProperties> = {
  "fix now": { borderColor: "rgba(248, 113, 113, 0.45)", color: "#fecaca" },
  "fix soon": { borderColor: "rgba(251, 191, 36, 0.45)", color: "#fde68a" },
  later: { borderColor: "rgba(148, 163, 184, 0.35)", color: "#cbd5e1" },
};

export default function MockToLiveTrackerPage() {
  return (
    <main style={styles.page}>
      <section style={styles.hero}>
        <p style={styles.eyebrow}>Internal ops · mock-to-live conversion</p>
        <h1 style={styles.title}>Mock-to-Live Conversion Tracker</h1>
        <p style={styles.subtitle}>
          A standalone static tracker for the Swing Up surfaces that still need a live data connection before launch confidence work is complete.
        </p>
        <div style={styles.notice}>
          <strong>Important wording:</strong> Preview/mock data is for product testing and is not a real market alert.
        </div>
      </section>

      <section style={styles.summaryGrid} aria-label="Tracker summary">
        <div style={styles.summaryCard}><span style={styles.summaryValue}>{conversionAreas.length}</span><span style={styles.summaryLabel}>areas tracked</span></div>
        <div style={styles.summaryCard}><span style={styles.summaryValue}>0</span><span style={styles.summaryLabel}>live API calls</span></div>
        <div style={styles.summaryCard}><span style={styles.summaryValue}>static</span><span style={styles.summaryLabel}>local content only</span></div>
      </section>

      <section style={styles.tableSection} aria-labelledby="conversion-heading">
        <div style={styles.sectionHeader}>
          <p style={styles.eyebrow}>Conversion queue</p>
          <h2 id="conversion-heading" style={styles.heading}>What has to change before preview surfaces become live product surfaces.</h2>
        </div>
        <div style={styles.rows}>
          {conversionAreas.map((area) => (
            <article key={area.feature} style={styles.row}>
              <div style={styles.rowTop}>
                <h3 style={styles.feature}>{area.feature}</h3>
                <div style={styles.pills}>
                  <span style={{ ...styles.modePill, ...modeStyles[area.currentMode] }}>{area.currentMode}</span>
                  <span style={{ ...styles.priorityPill, ...priorityStyles[area.priority] }}>{area.priority}</span>
                </div>
              </div>
              <dl style={styles.details}>
                <div style={styles.detail}><dt>Why it matters</dt><dd>{area.whyItMatters}</dd></div>
                <div style={styles.detail}><dt>Needed live connection</dt><dd>{area.neededLiveConnection}</dd></div>
                <div style={styles.detail}><dt>Blocking dependency</dt><dd>{area.blockingDependency}</dd></div>
                <div style={styles.detail}><dt>Suggested build</dt><dd>{area.suggestedBuildNumber}</dd></div>
                <div style={styles.detail}><dt>Status placeholder</dt><dd>{area.status}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: "100vh", background: "radial-gradient(circle at top left, rgba(37, 99, 235, 0.18), transparent 34%), #05070d", color: "#eef2ff", padding: "28px 16px 56px", fontFamily: "var(--font-geist-sans), system-ui, sans-serif" },
  hero: { maxWidth: 1180, margin: "0 auto", padding: "28px 0 18px", display: "grid", gap: 14 },
  eyebrow: { margin: 0, color: "#93c5fd", fontSize: 12, fontWeight: 900, letterSpacing: "0.16em", textTransform: "uppercase" },
  title: { margin: 0, maxWidth: 920, fontSize: "clamp(2.1rem, 10vw, 5.1rem)", lineHeight: 0.94, letterSpacing: "-0.065em" },
  subtitle: { margin: 0, maxWidth: 760, color: "#b6c2d9", fontSize: "clamp(1rem, 3vw, 1.22rem)", lineHeight: 1.7 },
  notice: { maxWidth: 760, border: "1px solid rgba(147, 197, 253, 0.28)", borderRadius: 20, padding: 16, background: "rgba(15, 23, 42, 0.72)", color: "#dbeafe", lineHeight: 1.6 },
  summaryGrid: { maxWidth: 1180, margin: "18px auto", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 },
  summaryCard: { border: "1px solid rgba(148, 163, 184, 0.18)", borderRadius: 22, padding: 18, background: "rgba(15, 23, 42, 0.68)", display: "grid", gap: 6 },
  summaryValue: { fontSize: 30, fontWeight: 900, letterSpacing: "-0.05em" },
  summaryLabel: { color: "#94a3b8", fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em" },
  tableSection: { maxWidth: 1180, margin: "26px auto 0" },
  sectionHeader: { marginBottom: 16 },
  heading: { margin: "8px 0 0", maxWidth: 860, fontSize: "clamp(1.35rem, 5vw, 2.35rem)", letterSpacing: "-0.045em" },
  rows: { display: "grid", gap: 14 },
  row: { border: "1px solid rgba(148, 163, 184, 0.18)", borderRadius: 24, padding: 18, background: "linear-gradient(145deg, rgba(15, 23, 42, 0.88), rgba(8, 13, 24, 0.82))", boxShadow: "0 18px 60px rgba(0,0,0,0.22)" },
  rowTop: { display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start", justifyContent: "space-between" },
  feature: { margin: 0, fontSize: "clamp(1.15rem, 4vw, 1.45rem)", letterSpacing: "-0.03em" },
  pills: { display: "flex", flexWrap: "wrap", gap: 8 },
  modePill: { borderRadius: 999, padding: "7px 10px", fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em" },
  priorityPill: { border: "1px solid", borderRadius: 999, padding: "7px 10px", fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", background: "rgba(2, 6, 23, 0.32)" },
  details: { margin: "16px 0 0", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 230px), 1fr))", gap: 12 },
  detail: { display: "grid", alignContent: "start", gap: 5, borderTop: "1px solid rgba(148, 163, 184, 0.14)", paddingTop: 12 },
};
