import type { CSSProperties } from "react";

type ReadinessStatus = "live" | "partial" | "mock-only" | "verify" | "user/auth" | "payment" | "notification";

type ReadinessItem = {
  area: string;
  status: ReadinessStatus;
  note: string;
  nextStep: string;
};

type ReadinessSection = {
  title: string;
  summary: string;
  items: ReadinessItem[];
};

const readinessSections: ReadinessSection[] = [
  {
    title: "Already live",
    summary: "Surfaces or concepts that can be treated as operationally live enough for internal readiness tracking.",
    items: [
      {
        area: "Source ears",
        status: "live",
        note: "Live ear routes exist for source status and manual run visibility.",
        nextStep: "Keep source health language conservative and verify each source after deploy.",
      },
      {
        area: "Public ledger",
        status: "live",
        note: "The public trust surface is available as a user-facing ledger experience.",
        nextStep: "Confirm ledger entries remain clearly separated from private review workflows.",
      },
    ],
  },
  {
    title: "Partial but safe",
    summary: "These areas can support demos or internal review because the copy is cautious and the dependency is visible.",
    items: [
      {
        area: "Raw signals",
        status: "partial",
        note: "Signal visibility exists as an operational concept, but end-to-end production promotion still needs verification.",
        nextStep: "Confirm raw signal freshness, source attribution, and review state before launch use.",
      },
      {
        area: "Candidate alerts",
        status: "partial",
        note: "Candidate review is safe for internal workflow framing while the full live pipeline matures.",
        nextStep: "Connect candidate records to receipts, rule outcomes, and human review decisions.",
      },
      {
        area: "Receipts",
        status: "partial",
        note: "Receipt language and normalization previews support evidence-first product review.",
        nextStep: "Attach durable receipts to approved candidates and public ledger records.",
      },
      {
        area: "Scores",
        status: "partial",
        note: "Score education is present, but live scoring must be tied to reviewed alert data.",
        nextStep: "Verify score components, timestamps, and auditability before production display.",
      },
    ],
  },
  {
    title: "Mock-only and needs connection",
    summary: "These should remain clearly labeled until they are connected to durable source-backed records.",
    items: [
      {
        area: "Mini AI Scan",
        status: "mock-only",
        note: "Useful for previewing language and reviewer expectations, not a production decision record yet.",
        nextStep: "Connect scans to candidate alerts with prompt/version metadata and reviewer visibility.",
      },
      {
        area: "Price snapshots",
        status: "mock-only",
        note: "Price context should not imply live market coverage until snapshots are persisted by alert timestamp.",
        nextStep: "Store source, instrument, timestamp, and retrieval status for each alert-linked snapshot.",
      },
      {
        area: "Historical patterns",
        status: "mock-only",
        note: "Pattern examples can explain product intent but need verified historical event records.",
        nextStep: "Connect approved patterns to receipts and known outcome context.",
      },
    ],
  },
  {
    title: "Needs live production verification",
    summary: "These areas may have routes or previews, but production readiness depends on deployed behavior checks.",
    items: [
      {
        area: "AI Committee",
        status: "verify",
        note: "Committee output must be checked as a traceable queue rather than a black-box summary.",
        nextStep: "Verify queue persistence, rationale, timestamps, and disposition states in production.",
      },
      {
        area: "Rule Filter",
        status: "verify",
        note: "Rule filtering is only launch-ready when deterministic decisions can be repeated and audited.",
        nextStep: "Run production payload checks against known-safe and known-reject examples.",
      },
      {
        area: "Source ears",
        status: "verify",
        note: "Every source ear needs post-deploy status checks before relying on downstream signal claims.",
        nextStep: "Verify source-specific status routes, freshness, and failure language after deploy.",
      },
    ],
  },
  {
    title: "Needs user/auth readiness",
    summary: "Personalized surfaces should wait for clear account state, privacy, and access-control confidence.",
    items: [
      {
        area: "Watchlists",
        status: "user/auth",
        note: "Watchlists are user-specific and should not be treated as production-ready without auth state confidence.",
        nextStep: "Verify logged-in, logged-out, empty, and unauthorized states before launch.",
      },
      {
        area: "Candidate alerts",
        status: "user/auth",
        note: "Private review views must remain separated from public user experiences.",
        nextStep: "Confirm role boundaries before exposing any reviewed alert management UI.",
      },
    ],
  },
  {
    title: "Needs payment readiness",
    summary: "Revenue-related flows need careful verification before they can gate access or imply a live subscription state.",
    items: [
      {
        area: "Payments",
        status: "payment",
        note: "Pricing and plan education can exist, but payment state must be verified before access decisions.",
        nextStep: "Confirm checkout, cancellation, failed payment, and plan-status handling before enforcing gates.",
      },
      {
        area: "Watchlists",
        status: "payment",
        note: "If watchlist limits become plan-based, billing state and product limits must agree.",
        nextStep: "Map plan entitlements to watchlist behavior only after payment readiness is confirmed.",
      },
    ],
  },
  {
    title: "Needs notification readiness",
    summary: "Outbound messages must wait for consent, delivery checks, and safe alert wording.",
    items: [
      {
        area: "Notifications",
        status: "notification",
        note: "Notification previews are helpful, but live sends require user consent and delivery observability.",
        nextStep: "Verify opt-in state, quiet failure handling, unsubscribe paths, and delivery logs.",
      },
      {
        area: "Candidate alerts",
        status: "notification",
        note: "An approved alert should not send until notification copy, timing, and recipient rules are ready.",
        nextStep: "Add a final send-readiness gate after candidate approval and before outbound delivery.",
      },
    ],
  },
];

const statusStyles: Record<ReadinessStatus, CSSProperties> = {
  live: { background: "rgba(34, 197, 94, 0.16)", borderColor: "rgba(74, 222, 128, 0.34)", color: "#bbf7d0" },
  partial: { background: "rgba(251, 191, 36, 0.15)", borderColor: "rgba(251, 191, 36, 0.34)", color: "#fde68a" },
  "mock-only": { background: "rgba(248, 113, 113, 0.14)", borderColor: "rgba(248, 113, 113, 0.34)", color: "#fecaca" },
  verify: { background: "rgba(96, 165, 250, 0.15)", borderColor: "rgba(96, 165, 250, 0.34)", color: "#bfdbfe" },
  "user/auth": { background: "rgba(192, 132, 252, 0.15)", borderColor: "rgba(192, 132, 252, 0.34)", color: "#e9d5ff" },
  payment: { background: "rgba(45, 212, 191, 0.14)", borderColor: "rgba(45, 212, 191, 0.34)", color: "#99f6e4" },
  notification: { background: "rgba(251, 146, 60, 0.14)", borderColor: "rgba(251, 146, 60, 0.34)", color: "#fed7aa" },
};

const trackedAreas = Array.from(new Set(readinessSections.flatMap((section) => section.items.map((item) => item.area))));

export default function LiveDataReadinessPage() {
  return (
    <main style={styles.page}>
      <section style={styles.hero}>
        <p style={styles.eyebrow}>Internal ops · live data readiness</p>
        <h1 style={styles.title}>Live Data Readiness Matrix</h1>
        <p style={styles.subtitle}>
          A standalone static matrix for seeing which Swing Up surfaces are live, partial, mock-only, or waiting on production readiness checks.
        </p>
        <div style={styles.guardrail}>Static content only. This page does not call APIs, read database data, or trigger backend workflows.</div>
      </section>

      <section style={styles.metrics} aria-label="Readiness summary">
        <div style={styles.metricCard}><strong>{readinessSections.length}</strong><span>readiness sections</span></div>
        <div style={styles.metricCard}><strong>{trackedAreas.length}</strong><span>tracked areas</span></div>
        <div style={styles.metricCard}><strong>0</strong><span>live data calls</span></div>
      </section>

      <section style={styles.matrix} aria-label="Live data readiness matrix">
        {readinessSections.map((section) => (
          <article key={section.title} style={styles.sectionCard}>
            <div style={styles.sectionIntro}>
              <p style={styles.eyebrow}>Readiness lane</p>
              <h2 style={styles.heading}>{section.title}</h2>
              <p style={styles.sectionSummary}>{section.summary}</p>
            </div>
            <div style={styles.items}>
              {section.items.map((item) => (
                <div key={`${section.title}-${item.area}`} style={styles.itemCard}>
                  <div style={styles.itemTop}>
                    <h3 style={styles.itemTitle}>{item.area}</h3>
                    <span style={{ ...styles.statusPill, ...statusStyles[item.status] }}>{item.status}</span>
                  </div>
                  <p style={styles.note}>{item.note}</p>
                  <div style={styles.nextStep}><span>Next check</span>{item.nextStep}</div>
                </div>
              ))}
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: "100vh", padding: "28px 16px 64px", background: "radial-gradient(circle at top left, rgba(59, 130, 246, 0.2), transparent 32%), radial-gradient(circle at 80% 10%, rgba(20, 184, 166, 0.12), transparent 30%), #05070d", color: "#eef2ff", fontFamily: "var(--font-geist-sans), system-ui, sans-serif" },
  hero: { maxWidth: 1120, margin: "0 auto", padding: "30px 0 18px", display: "grid", gap: 14 },
  eyebrow: { margin: 0, color: "#93c5fd", fontSize: 12, fontWeight: 900, letterSpacing: "0.16em", textTransform: "uppercase" },
  title: { margin: 0, maxWidth: 900, fontSize: "clamp(2.25rem, 11vw, 5.4rem)", lineHeight: 0.92, letterSpacing: "-0.07em" },
  subtitle: { margin: 0, maxWidth: 760, color: "#b6c2d9", fontSize: "clamp(1rem, 3vw, 1.2rem)", lineHeight: 1.7 },
  guardrail: { maxWidth: 760, padding: 16, border: "1px solid rgba(147, 197, 253, 0.25)", borderRadius: 20, background: "rgba(15, 23, 42, 0.72)", color: "#dbeafe", lineHeight: 1.6 },
  metrics: { maxWidth: 1120, margin: "18px auto 24px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 },
  metricCard: { display: "grid", gap: 6, padding: 18, border: "1px solid rgba(148, 163, 184, 0.18)", borderRadius: 24, background: "rgba(15, 23, 42, 0.68)" },
  matrix: { maxWidth: 1120, margin: "0 auto", display: "grid", gap: 16 },
  sectionCard: { display: "grid", gap: 16, padding: 18, border: "1px solid rgba(148, 163, 184, 0.18)", borderRadius: 28, background: "linear-gradient(145deg, rgba(15, 23, 42, 0.9), rgba(8, 13, 24, 0.82))", boxShadow: "0 20px 70px rgba(0, 0, 0, 0.24)" },
  sectionIntro: { display: "grid", gap: 8 },
  heading: { margin: 0, fontSize: "clamp(1.35rem, 5vw, 2.2rem)", letterSpacing: "-0.045em" },
  sectionSummary: { margin: 0, maxWidth: 760, color: "#aab7cf", lineHeight: 1.65 },
  items: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))", gap: 12 },
  itemCard: { display: "grid", gap: 12, alignContent: "start", minHeight: 210, padding: 16, border: "1px solid rgba(148, 163, 184, 0.16)", borderRadius: 22, background: "rgba(2, 6, 23, 0.34)" },
  itemTop: { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10 },
  itemTitle: { margin: 0, fontSize: "1.05rem", letterSpacing: "-0.025em" },
  statusPill: { border: "1px solid", borderRadius: 999, padding: "7px 10px", fontSize: 11, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase" },
  note: { margin: 0, color: "#d6deed", lineHeight: 1.6 },
  nextStep: { display: "grid", gap: 5, marginTop: "auto", paddingTop: 12, borderTop: "1px solid rgba(148, 163, 184, 0.14)", color: "#aab7cf", lineHeight: 1.55 },
};
