import type { CSSProperties } from "react";

type SafetySection = {
  title: string;
  intent: string;
  rules: string[];
};

const safetySections: SafetySection[] = [
  {
    title: "Empty database safety",
    intent: "A new or reset environment must be boring, readable, and safe to inspect.",
    rules: [
      "Pages should explain an empty state without treating missing rows as an error.",
      "Health and ops checks should separate app availability from record availability.",
      "Do not backfill production-looking rows just to make an admin screen feel complete.",
    ],
  },
  {
    title: "Duplicate prevention",
    intent: "Every production write needs an intentional uniqueness story before it can run live.",
    rules: [
      "Use stable identifiers, idempotency keys, or natural unique constraints for write paths.",
      "Retries should return the existing safe result instead of creating another row.",
      "No production write route should silently create duplicate alerts, duplicate receipts, duplicate ledger rows, or expose another user’s data.",
    ],
  },
  {
    title: "Read-only admin pages",
    intent: "Admin visibility should not imply mutation privileges by default.",
    rules: [
      "Default admin pages to read-only review until a write action is explicitly scoped and reviewed.",
      "Label preview, mock, and static states clearly so operators do not mistake them for live data.",
      "Keep destructive actions out of broad list views and dashboard summaries.",
    ],
  },
  {
    title: "Safe writes",
    intent: "Safe writes are narrow, auditable, and reversible enough to operate under pressure.",
    rules: [
      "Validate ownership, required fields, and duplicate keys before writing any record.",
      "Record enough context to explain who or what caused the write later.",
      "Prefer append-only events for business-critical history unless a reviewed correction path exists.",
    ],
  },
  {
    title: "Dangerous writes",
    intent: "High-risk mutations need extra friction before they touch production data.",
    rules: [
      "Bulk updates, deletes, status resets, and cross-user changes require a separate review path.",
      "Never hide partial failures behind a successful UI message.",
      "Do not mix live production writes with demo, preview, or seed-data behavior.",
    ],
  },
  {
    title: "Receipt persistence safety",
    intent: "Receipts must stay trustworthy because they explain why a user saw a signal.",
    rules: [
      "Persist receipt inputs, source references, and generated explanations consistently.",
      "Receipt regeneration should be explicit and should not overwrite evidence silently.",
      "A missing receipt should block live confidence claims until the evidence path is understood.",
    ],
  },
  {
    title: "Ledger row safety",
    intent: "Ledger rows are a trust surface and should behave like durable public history.",
    rules: [
      "Treat ledger creation as idempotent for the alert, receipt, or event it represents.",
      "Avoid editing published ledger rows without preserving correction context.",
      "Confirm public ledger data cannot reveal private admin notes or another user’s records.",
    ],
  },
  {
    title: "User data safety",
    intent: "Every user-scoped read or write must prove the requesting user owns the data.",
    rules: [
      "Filter by authenticated user or account boundary before returning private records.",
      "Avoid broad queries that fetch data first and filter sensitive rows later in UI code.",
      "Logs, errors, and previews should not expose emails, identifiers, or private activity unnecessarily.",
    ],
  },
  {
    title: "Payment data safety",
    intent: "Billing state must be conservative, externally verifiable, and never guessed from UI intent.",
    rules: [
      "Use payment-provider identifiers and webhook events as the source of truth for paid status.",
      "Do not grant access from a client-only success screen or unfinished checkout flow.",
      "Store only the payment metadata needed for operations, support, and audit trails.",
    ],
  },
  {
    title: "Rollback warning signs",
    intent: "Stop forward motion when data safety signals become ambiguous.",
    rules: [
      "Duplicate alerts, receipts, ledger rows, or notifications appear after a retry or deploy.",
      "Users can see data that belongs to another account, organization, or admin-only workflow.",
      "Receipts, ledger rows, payment state, or notification state disagree and no audit trail explains why.",
    ],
  },
];

const guardrails = [
  "Static internal reference only",
  "No API calls",
  "No database reads",
  "No write routes",
  "No production automation",
];

export default function DatabaseSafetyPage() {
  return (
    <main style={styles.page}>
      <section style={styles.hero}>
        <div>
          <p style={styles.eyebrow}>Internal ops · database safety</p>
          <h1 style={styles.title}>Database Safety Checklist</h1>
          <p style={styles.subtitle}>
            A calm pre-flight guide for protecting alerts, receipts, ledger rows, auth, payments, and notifications before live production writes are enabled.
          </p>
        </div>
        <aside style={styles.ruleCard} aria-label="Primary database safety rule">
          <span style={styles.badge}>Non-negotiable rule</span>
          <p style={styles.ruleText}>
            No production write route should silently create duplicate alerts, duplicate receipts, duplicate ledger rows, or expose another user’s data.
          </p>
        </aside>
      </section>

      <section style={styles.guardrailPanel} aria-label="Page guardrails">
        {guardrails.map((guardrail) => (
          <div key={guardrail} style={styles.guardrailItem}>
            <span style={styles.checkmark}>✓</span>
            <span>{guardrail}</span>
          </div>
        ))}
      </section>

      <section style={styles.sections} aria-label="Database safety sections">
        {safetySections.map((section) => (
          <article key={section.title} style={styles.card}>
            <p style={styles.sectionKicker}>Safety check</p>
            <h2 style={styles.cardTitle}>{section.title}</h2>
            <p style={styles.intent}>{section.intent}</p>
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
    background: "radial-gradient(circle at top left, rgba(45, 212, 191, 0.16), transparent 32rem), radial-gradient(circle at bottom right, rgba(59, 130, 246, 0.12), transparent 30rem), #071014",
    color: "#e6f5f2",
    padding: "32px 18px 58px",
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  hero: {
    display: "grid",
    gap: 20,
    maxWidth: 1120,
    margin: "0 auto 22px",
  },
  eyebrow: {
    margin: "0 0 10px",
    color: "#7dd3fc",
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
  },
  title: {
    margin: 0,
    maxWidth: 820,
    fontSize: "clamp(2.25rem, 9vw, 5.25rem)",
    lineHeight: 0.92,
    letterSpacing: "-0.07em",
  },
  subtitle: {
    margin: "18px 0 0",
    maxWidth: 720,
    color: "#b7cbc8",
    fontSize: "clamp(1rem, 3vw, 1.22rem)",
    lineHeight: 1.62,
  },
  ruleCard: {
    border: "1px solid rgba(125, 211, 252, 0.25)",
    borderRadius: 28,
    background: "linear-gradient(145deg, rgba(14, 116, 144, 0.24), rgba(15, 23, 42, 0.86))",
    boxShadow: "0 24px 80px rgba(0, 0, 0, 0.26)",
    padding: 24,
  },
  badge: {
    display: "inline-flex",
    width: "fit-content",
    border: "1px solid rgba(125, 211, 252, 0.32)",
    borderRadius: 999,
    padding: "7px 11px",
    color: "#bae6fd",
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  ruleText: {
    margin: "16px 0 0",
    color: "#f8fafc",
    fontSize: "clamp(1.1rem, 4vw, 1.55rem)",
    fontWeight: 750,
    lineHeight: 1.35,
  },
  guardrailPanel: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: 10,
    maxWidth: 1120,
    margin: "0 auto 22px",
    border: "1px solid rgba(148, 163, 184, 0.18)",
    borderRadius: 24,
    background: "rgba(15, 23, 42, 0.58)",
    padding: 12,
  },
  guardrailItem: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    borderRadius: 18,
    background: "rgba(2, 6, 23, 0.35)",
    color: "#cbd5e1",
    padding: "12px 13px",
    fontSize: 14,
    fontWeight: 700,
  },
  checkmark: {
    display: "inline-grid",
    placeItems: "center",
    flex: "0 0 auto",
    width: 22,
    height: 22,
    borderRadius: 999,
    background: "rgba(45, 212, 191, 0.16)",
    color: "#5eead4",
    fontSize: 13,
    fontWeight: 900,
  },
  sections: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: 16,
    maxWidth: 1120,
    margin: "0 auto",
  },
  card: {
    border: "1px solid rgba(148, 163, 184, 0.18)",
    borderRadius: 26,
    background: "linear-gradient(180deg, rgba(15, 23, 42, 0.82), rgba(15, 23, 42, 0.54))",
    boxShadow: "0 18px 60px rgba(0, 0, 0, 0.18)",
    padding: 22,
  },
  sectionKicker: {
    margin: "0 0 8px",
    color: "#5eead4",
    fontSize: 11,
    fontWeight: 850,
    letterSpacing: "0.13em",
    textTransform: "uppercase",
  },
  cardTitle: {
    margin: 0,
    color: "#f8fafc",
    fontSize: "1.35rem",
    letterSpacing: "-0.035em",
  },
  intent: {
    margin: "10px 0 0",
    color: "#9fb2af",
    fontSize: 14,
    lineHeight: 1.55,
  },
  list: {
    display: "grid",
    gap: 11,
    margin: "18px 0 0",
    padding: 0,
    listStyle: "none",
  },
  listItem: {
    display: "grid",
    gridTemplateColumns: "10px 1fr",
    gap: 10,
    alignItems: "start",
    color: "#d7e5e2",
    fontSize: 14,
    lineHeight: 1.55,
  },
  dot: {
    width: 7,
    height: 7,
    marginTop: 8,
    borderRadius: 999,
    background: "#38bdf8",
    boxShadow: "0 0 18px rgba(56, 189, 248, 0.72)",
  },
};
