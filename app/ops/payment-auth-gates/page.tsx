import type { CSSProperties } from "react";

type Gate = {
  title: string;
  status: string;
  intent: string;
  checks: string[];
};

const launchRules = [
  "Do not charge users until auth is stable.",
  "Do not restrict alerts until tier access is tested.",
  "Do not send notifications until unsubscribe and preference controls exist.",
  "Do not show paid performance promises.",
  "Keep the market research disclaimer visible anywhere payment, auth, alerts, or subscription access is discussed.",
];

const gates: Gate[] = [
  {
    title: "Auth launch gate",
    status: "Blocked until stable",
    intent: "Real accounts should only launch after sign-in, sign-out, session recovery, and account state are reliable.",
    checks: [
      "Auth flows are tested on fresh, returning, and expired sessions.",
      "Login failures use calm support language without exposing internals.",
      "Account identity is clearly separated from demo or preview data.",
    ],
  },
  {
    title: "User data safety gate",
    status: "Protect first",
    intent: "Personal data handling must be understandable before users are asked to create production accounts.",
    checks: [
      "Collected fields are limited to what the product needs.",
      "Data retention, deletion, and support escalation paths are documented.",
      "Private account data is never required for public educational previews.",
    ],
  },
  {
    title: "Watchlist gate",
    status: "Verify ownership",
    intent: "Watchlists must remain tied to the correct user before any paid or restricted alert experience depends on them.",
    checks: [
      "Users can add, remove, and review watched symbols without cross-account leakage.",
      "Empty watchlists explain what happens next without pressuring users to upgrade.",
      "Watchlist alerts remain educational and avoid buy, sell, or profit instructions.",
    ],
  },
  {
    title: "Subscription gate",
    status: "Preview only",
    intent: "Plan boundaries should be clear before subscriptions affect user access or billing state.",
    checks: [
      "Free, trial, and paid states are tested against the same alert access matrix.",
      "Downgrade, cancellation, grace-period, and failed-payment states have safe copy.",
      "No paid performance promises appear in plan descriptions or upgrade prompts.",
    ],
  },
  {
    title: "Payment provider gate",
    status: "Not connected here",
    intent: "Billing infrastructure should only go live after auth, support, receipts, and failure states are ready.",
    checks: [
      "Provider keys and webhooks are not required for this static ops route.",
      "Test-mode billing is verified before any live charge path exists.",
      "Receipt, invoice, tax, and failed-payment messaging have an owner.",
    ],
  },
  {
    title: "Alert access gate",
    status: "Test before restrict",
    intent: "Restricted alerts should not launch until tier checks are accurate and reversible.",
    checks: [
      "Tier access is tested for every alert surface, including direct URLs.",
      "Locked states explain limits without implying hidden investment advice.",
      "Users can recover access after account or billing corrections.",
    ],
  },
  {
    title: "Notification gate",
    status: "Preferences required",
    intent: "Outbound messages must wait until users can control what they receive.",
    checks: [
      "Email, SMS, push, and webhook preferences are explicit and auditable.",
      "Unsubscribe exists before any recurring or automated notification is sent.",
      "Notification copy links back to the research disclaimer and alert context.",
    ],
  },
  {
    title: "Refund/support gate",
    status: "Human path needed",
    intent: "Users need a clear way to resolve billing, access, and account issues before payment launch.",
    checks: [
      "Support contact, expected response time, and escalation ownership are visible.",
      "Refund eligibility language is plain and consistent with checkout copy.",
      "Account deletion, cancellation, and billing disputes have documented handling.",
    ],
  },
  {
    title: "Compliance wording gate",
    status: "Always visible",
    intent: "Payment and access language must keep Swing Up positioned as market research, not financial advice.",
    checks: [
      "Market research disclaimer remains visible near paid access decisions.",
      "Copy avoids guaranteed returns, win rates, profit claims, and personalized advice framing.",
      "Risk, uncertainty, source limitations, and false-signal possibilities remain easy to find.",
    ],
  },
];

export default function PaymentAuthGatesPage() {
  return (
    <main style={styles.page}>
      <section style={styles.hero}>
        <div style={styles.heroCopy}>
          <p style={styles.eyebrow}>Internal ops · payment/auth launch gates</p>
          <h1 style={styles.title}>Payment & Auth Launch Gates</h1>
          <p style={styles.subtitle}>
            A static readiness page for deciding what must be true before Swing Up connects real authentication, paid plans,
            subscriptions, restricted alerts, or outbound notifications.
          </p>
        </div>
        <aside style={styles.disclaimerCard} aria-label="Market research disclaimer">
          <span style={styles.badge}>Disclaimer required</span>
          <p style={styles.disclaimerText}>
            Swing Up is a market research and alert education product. It does not provide investment advice, personalized
            recommendations, guaranteed outcomes, or paid performance promises.
          </p>
        </aside>
      </section>

      <section style={styles.rulesPanel} aria-labelledby="launch-rules-heading">
        <div>
          <p style={styles.eyebrow}>Launch rules</p>
          <h2 id="launch-rules-heading" style={styles.heading}>Non-negotiables before monetization</h2>
        </div>
        <div style={styles.rulesGrid}>
          {launchRules.map((rule) => (
            <div key={rule} style={styles.ruleItem}>
              <span style={styles.checkmark}>✓</span>
              <span>{rule}</span>
            </div>
          ))}
        </div>
      </section>

      <section style={styles.gateGrid} aria-label="Payment and auth launch gates">
        {gates.map((gate) => (
          <article key={gate.title} style={styles.card}>
            <div style={styles.cardHeader}>
              <span style={styles.statusPill}>{gate.status}</span>
              <h2 style={styles.cardTitle}>{gate.title}</h2>
              <p style={styles.intent}>{gate.intent}</p>
            </div>
            <ul style={styles.list}>
              {gate.checks.map((check) => (
                <li key={check} style={styles.listItem}>
                  <span style={styles.dot} aria-hidden="true" />
                  <span>{check}</span>
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
    background: "radial-gradient(circle at top left, rgba(45, 212, 191, 0.16), transparent 34rem), radial-gradient(circle at top right, rgba(59, 130, 246, 0.12), transparent 28rem), #061014",
    color: "#e6f7f5",
    padding: "32px 18px 56px",
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  hero: {
    display: "grid",
    gap: 20,
    maxWidth: 1120,
    margin: "0 auto 22px",
  },
  heroCopy: { maxWidth: 780 },
  eyebrow: {
    margin: "0 0 10px",
    color: "#67e8f9",
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
  },
  title: {
    margin: 0,
    color: "#f8fffe",
    fontSize: "clamp(2.35rem, 10vw, 5.25rem)",
    lineHeight: 0.92,
    letterSpacing: "-0.07em",
  },
  subtitle: {
    margin: "18px 0 0",
    color: "#b8d8d4",
    fontSize: "clamp(1rem, 3vw, 1.18rem)",
    lineHeight: 1.7,
  },
  disclaimerCard: {
    border: "1px solid rgba(125, 211, 252, 0.28)",
    background: "linear-gradient(145deg, rgba(8, 47, 73, 0.72), rgba(6, 78, 59, 0.58))",
    borderRadius: 28,
    padding: 22,
    boxShadow: "0 24px 80px rgba(0, 0, 0, 0.32)",
  },
  badge: {
    display: "inline-flex",
    border: "1px solid rgba(103, 232, 249, 0.35)",
    borderRadius: 999,
    padding: "7px 11px",
    color: "#cffafe",
    fontSize: 12,
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  disclaimerText: {
    margin: "16px 0 0",
    color: "#d6fffb",
    fontSize: 16,
    lineHeight: 1.65,
  },
  rulesPanel: {
    maxWidth: 1120,
    margin: "0 auto 22px",
    border: "1px solid rgba(148, 163, 184, 0.2)",
    borderRadius: 30,
    padding: 22,
    background: "rgba(2, 6, 23, 0.5)",
    boxShadow: "0 18px 60px rgba(0, 0, 0, 0.22)",
  },
  heading: {
    margin: 0,
    color: "#f8fffe",
    fontSize: "clamp(1.5rem, 5vw, 2.5rem)",
    letterSpacing: "-0.04em",
  },
  rulesGrid: {
    display: "grid",
    gap: 12,
    marginTop: 20,
  },
  ruleItem: {
    display: "flex",
    gap: 12,
    alignItems: "flex-start",
    border: "1px solid rgba(45, 212, 191, 0.16)",
    borderRadius: 18,
    padding: 14,
    background: "rgba(15, 23, 42, 0.7)",
    color: "#d7eeeb",
    lineHeight: 1.55,
  },
  checkmark: {
    display: "inline-grid",
    placeItems: "center",
    flex: "0 0 24px",
    width: 24,
    height: 24,
    borderRadius: "50%",
    background: "rgba(20, 184, 166, 0.18)",
    color: "#5eead4",
    fontWeight: 900,
  },
  gateGrid: {
    display: "grid",
    gap: 16,
    maxWidth: 1120,
    margin: "0 auto",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: 18,
    minHeight: 310,
    border: "1px solid rgba(148, 163, 184, 0.18)",
    borderRadius: 26,
    padding: 20,
    background: "linear-gradient(180deg, rgba(15, 23, 42, 0.82), rgba(6, 23, 31, 0.88))",
    boxShadow: "0 20px 70px rgba(0, 0, 0, 0.24)",
  },
  cardHeader: { display: "grid", gap: 10 },
  statusPill: {
    width: "fit-content",
    border: "1px solid rgba(45, 212, 191, 0.28)",
    borderRadius: 999,
    padding: "6px 10px",
    color: "#99f6e4",
    background: "rgba(20, 184, 166, 0.08)",
    fontSize: 12,
    fontWeight: 800,
  },
  cardTitle: {
    margin: 0,
    color: "#ffffff",
    fontSize: 24,
    letterSpacing: "-0.04em",
  },
  intent: {
    margin: 0,
    color: "#a9c7c4",
    lineHeight: 1.6,
  },
  list: {
    display: "grid",
    gap: 12,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  listItem: {
    display: "flex",
    gap: 10,
    color: "#d9eeee",
    lineHeight: 1.55,
  },
  dot: {
    flex: "0 0 8px",
    width: 8,
    height: 8,
    marginTop: 8,
    borderRadius: "50%",
    background: "#22d3ee",
    boxShadow: "0 0 18px rgba(34, 211, 238, 0.7)",
  },
};
