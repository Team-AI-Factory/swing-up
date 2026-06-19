import type { CSSProperties } from "react";

type GuardrailSection = {
  title: string;
  intent: string;
  rules: string[];
};

const guardrailSections: GuardrailSection[] = [
  {
    title: "Free deterministic checks",
    intent: "Use code, thresholds, fixtures, and review checklists before any paid model is considered.",
    rules: [
      "Run source freshness, duplicate detection, score thresholds, and route health checks with deterministic logic first.",
      "Prefer static copy, fixtures, and known examples when the page or workflow is only explaining behavior.",
      "Do not call paid AI for weak raw signals that have not passed deterministic quality gates.",
    ],
  },
  {
    title: "Mock/preview mode",
    intent: "Keep demos and internal previews cheap, safe, and repeatable.",
    rules: [
      "Do not call paid AI for mock previews.",
      "Use local sample data and clearly label preview output as mock, sample, or simulated.",
      "Preview responses must never be treated as publishable alerts or live investment research.",
    ],
  },
  {
    title: "When AI calls are allowed",
    intent: "Only spend on model review after cheaper evidence has already narrowed the candidate set.",
    rules: [
      "A paid model may support review when a candidate has strong receipts, enough context, and a clear user-safety purpose.",
      "The request must be scoped to summarize, classify, compare, or challenge evidence already collected by Swing Up.",
      "AI review is support, not a guarantee, and must remain subordinate to deterministic gates and final human-safe rules.",
    ],
  },
  {
    title: "When AI calls are blocked",
    intent: "Stop model usage when the input is noisy, premature, duplicative, or unsafe.",
    rules: [
      "Do not call paid AI for weak raw signals.",
      "Block calls for duplicate stories, missing receipts, stale sources, malformed payloads, or vague user-facing impact.",
      "Never use a paid model to bypass missing backend checks, missing source evidence, or an unresolved safety concern.",
    ],
  },
  {
    title: "Cost limit rules",
    intent: "Treat AI budget as a scarce ops resource rather than a default processing step.",
    rules: [
      "Set a clear per-run budget before enabling any paid review path.",
      "Cap the number of candidates that can reach AI in a batch and reject the rest deterministically.",
      "If spend tracking is unclear, default to mock, preview, or deterministic behavior until the limit is visible again.",
    ],
  },
  {
    title: "Retry limit rules",
    intent: "Avoid expensive loops and repeated calls when a response is incomplete or uncertain.",
    rules: [
      "Use at most one controlled retry for transient formatting or timeout issues.",
      "Do not retry to force a more bullish, stronger, or publishable answer.",
      "After retry exhaustion, mark the review inconclusive and keep the candidate out of user-facing alert flow.",
    ],
  },
  {
    title: "Logging rules",
    intent: "Make every model-assisted decision auditable without exposing secrets or private operational data.",
    rules: [
      "Always keep receipts and risk notes attached.",
      "Log the candidate ID, source receipts, model purpose, decision outcome, and cost category for each allowed call.",
      "Do not log API keys, private credentials, hidden prompts, or unnecessary personal data.",
    ],
  },
  {
    title: "Final judge requirement",
    intent: "Prevent a single model response from becoming the system of record.",
    rules: [
      "Do not publish alerts directly from one AI response.",
      "Require deterministic checks, source receipts, risk notes, and final review gates before anything can be user-facing.",
      "If the model output conflicts with receipts or safety wording, the receipts and safety rules win.",
    ],
  },
  {
    title: "User-facing safety rule",
    intent: "Keep Swing Up honest about uncertainty and user responsibility.",
    rules: [
      "AI review is support, not a guarantee.",
      "User-facing language must stay educational, cautious, and free of promises about returns or outcomes.",
      "Every alert or explanation should preserve uncertainty, cite evidence, and remind users to make their own decisions.",
    ],
  },
];

const principles = [
  "Deterministic first",
  "Mock means no paid model",
  "Receipts stay attached",
  "One AI answer is never final",
];

export default function AiCostGuardrailsPage() {
  return (
    <main style={styles.page}>
      <section style={styles.hero}>
        <div style={styles.heroCopy}>
          <p style={styles.eyebrow}>Internal ops · AI cost control</p>
          <h1 style={styles.title}>AI Cost Guardrails</h1>
          <p style={styles.subtitle}>
            A static operating guide for deciding when Swing Up may spend on paid AI review and when it must stay with deterministic,
            mock, or preview logic.
          </p>
        </div>
        <aside style={styles.summaryCard} aria-label="Primary AI spending rule">
          <span style={styles.badge}>Default posture</span>
          <p style={styles.summaryText}>Do not spend on AI until cheap filters, receipts, and safety gates prove the review is necessary.</p>
        </aside>
      </section>

      <section style={styles.principlesPanel} aria-labelledby="principles-heading">
        <div>
          <p style={styles.eyebrow}>Fast rule</p>
          <h2 id="principles-heading" style={styles.heading}>Cost-safe review principles</h2>
        </div>
        <div style={styles.principlesGrid}>
          {principles.map((principle) => (
            <div key={principle} style={styles.principleItem}>
              <span style={styles.checkmark}>✓</span>
              <span>{principle}</span>
            </div>
          ))}
        </div>
      </section>

      <section style={styles.sections} aria-label="AI cost guardrail sections">
        {guardrailSections.map((section) => (
          <article key={section.title} style={styles.card}>
            <div style={styles.cardHeader}>
              <p style={styles.sectionKicker}>Guardrail</p>
              <h2 style={styles.cardTitle}>{section.title}</h2>
              <p style={styles.intent}>{section.intent}</p>
            </div>
            <ul style={styles.list}>
              {section.rules.map((rule) => (
                <li key={rule} style={styles.listItem}>
                  <span style={styles.dot} aria-hidden="true" />
                  <span>{rule}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "radial-gradient(circle at top left, rgba(45, 212, 191, 0.16), transparent 34rem), #061014",
    color: "#e5f3f1",
    padding: "32px 18px 56px",
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  hero: { display: "grid", gap: 20, maxWidth: 1120, margin: "0 auto 22px" },
  heroCopy: { maxWidth: 780 },
  eyebrow: { margin: "0 0 10px", color: "#67e8f9", fontSize: 12, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase" },
  title: { margin: 0, fontSize: "clamp(2.35rem, 10vw, 5.6rem)", lineHeight: 0.92, letterSpacing: "-0.075em" },
  subtitle: { margin: "18px 0 0", maxWidth: 720, color: "#b8c8c6", fontSize: "clamp(1rem, 3vw, 1.22rem)", lineHeight: 1.65 },
  summaryCard: { border: "1px solid rgba(103, 232, 249, 0.24)", borderRadius: 28, background: "linear-gradient(145deg, rgba(8, 145, 178, 0.18), rgba(15, 23, 42, 0.84))", boxShadow: "0 24px 70px rgba(0, 0, 0, 0.34)", padding: 24 },
  badge: { display: "inline-flex", border: "1px solid rgba(45, 212, 191, 0.36)", borderRadius: 999, color: "#99f6e4", padding: "7px 11px", fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em" },
  summaryText: { margin: "18px 0 0", fontSize: 22, lineHeight: 1.35, fontWeight: 800 },
  principlesPanel: { maxWidth: 1120, margin: "0 auto 22px", border: "1px solid rgba(148, 163, 184, 0.18)", borderRadius: 28, background: "rgba(15, 23, 42, 0.72)", padding: 22, boxShadow: "0 18px 56px rgba(0, 0, 0, 0.24)" },
  heading: { margin: 0, fontSize: "clamp(1.45rem, 5vw, 2.2rem)", letterSpacing: "-0.04em" },
  principlesGrid: { display: "grid", gap: 12, marginTop: 18, gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))" },
  principleItem: { display: "flex", alignItems: "center", gap: 10, border: "1px solid rgba(148, 163, 184, 0.16)", borderRadius: 18, background: "rgba(6, 78, 59, 0.24)", color: "#dffcf7", padding: "13px 14px", fontWeight: 800 },
  checkmark: { display: "inline-grid", placeItems: "center", width: 24, height: 24, borderRadius: 999, background: "rgba(45, 212, 191, 0.16)", color: "#5eead4", flex: "0 0 auto" },
  sections: { display: "grid", gap: 16, maxWidth: 1120, margin: "0 auto", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" },
  card: { border: "1px solid rgba(148, 163, 184, 0.18)", borderRadius: 26, background: "linear-gradient(180deg, rgba(15, 23, 42, 0.86), rgba(8, 13, 18, 0.9))", padding: 22, boxShadow: "0 18px 56px rgba(0, 0, 0, 0.22)" },
  cardHeader: { display: "grid", gap: 8 },
  sectionKicker: { margin: 0, color: "#2dd4bf", fontSize: 11, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase" },
  cardTitle: { margin: 0, fontSize: 24, letterSpacing: "-0.04em" },
  intent: { margin: 0, color: "#a8b8b6", lineHeight: 1.55 },
  list: { display: "grid", gap: 12, listStyle: "none", margin: "18px 0 0", padding: 0 },
  listItem: { display: "grid", gridTemplateColumns: "10px 1fr", gap: 10, color: "#d8e7e5", lineHeight: 1.55 },
  dot: { width: 8, height: 8, borderRadius: 999, background: "#67e8f9", marginTop: 8, boxShadow: "0 0 18px rgba(103, 232, 249, 0.6)" },
};
