type Plan = {
  name: string;
  price: string;
  status: string;
  simpleMeaning: string;
  features: string[];
  alertAccess: string;
  notifications: string;
  ledgerAccess: string;
  billingState: string;
  intendedUser: string;
};

const plans: Plan[] = [
  {
    name: "Free",
    price: "$0 / mo",
    status: "Preview access",
    simpleMeaning: "Use public research pages and delayed/sample context without starting a paid subscription.",
    features: ["Public ledger access", "Educational methodology pages", "Delayed or sample alert examples"],
    alertAccess: "Public summaries and examples only",
    notifications: "No production paid notifications",
    ledgerAccess: "Public ledger only",
    billingState: "No payment required",
    intendedUser: "Users learning the workflow before considering a paid plan.",
  },
  {
    name: "Trial",
    price: "Sandbox only",
    status: "Test mode planned",
    simpleMeaning: "A future test window for validating access rules and billing copy before real charges exist.",
    features: ["Test-mode plan labels", "Limited paid-tier previews", "Cancellation and trial-end copy checks"],
    alertAccess: "Restricted preview access when sandbox testing is enabled",
    notifications: "Test notifications only if explicitly labeled",
    ledgerAccess: "Public ledger plus trial-labeled preview context",
    billingState: "Checkout not connected here",
    intendedUser: "Sandbox testers confirming the subscription experience is understandable.",
  },
  {
    name: "Starter",
    price: "TBD / mo",
    status: "Not live yet",
    simpleMeaning: "Planned paid access for a smaller research workflow around watchlists and basic alert context.",
    features: ["Watchlist-oriented alert context", "Basic source receipts", "Simple monitoring labels"],
    alertAccess: "Watchlist-level research alerts after billing launch",
    notifications: "Paid notifications only after preferences and billing are ready",
    ledgerAccess: "Public ledger plus watchlist context",
    billingState: "Future paid plan; no charge today",
    intendedUser: "Users following a small set of companies or themes.",
  },
  {
    name: "Pro",
    price: "TBD / mo",
    status: "Not live yet",
    simpleMeaning: "Planned paid access for fuller research cards, richer context, and organized signal review.",
    features: ["Fuller alert cards", "Valuation and pattern notes", "Source receipt organization"],
    alertAccess: "Expanded research-style alert cards without guaranteed outcomes",
    notifications: "Expanded notifications only after launch gates pass",
    ledgerAccess: "Public ledger with richer alert-card context",
    billingState: "Future paid plan; no charge today",
    intendedUser: "Active users who want evidence, context, and historical framing in one place.",
  },
  {
    name: "Desk",
    price: "TBD / mo",
    status: "Not live yet",
    simpleMeaning: "Planned team-oriented access for shared review, exports, and administrative controls.",
    features: ["Team access planning", "Advanced exports", "Broader monitoring surfaces"],
    alertAccess: "Team research surfaces after account and billing controls are ready",
    notifications: "Team notification rules only after preference controls exist",
    ledgerAccess: "Full public ledger context with team references",
    billingState: "Future paid plan; no charge today",
    intendedUser: "Teams that need shared research review without performance promises.",
  },
];

export default function PricingMatrixPage() {
  return (
    <main className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Subscription plan matrix · sandbox readiness</div>
          <h1>Compare free, trial, and paid access without starting checkout.</h1>
          <p>
            This matrix is static launch-readiness content. It explains planned access levels in plain language while live
            billing remains disabled and payment-provider checkout is intentionally not connected.
          </p>
          <div className="button-row" aria-label="Pricing matrix status labels">
            <span className="badge">Static preview</span>
            <span className="badge">Payments not live</span>
            <span className="badge">No performance promises</span>
          </div>
        </div>

        <article className="card risk-callout">
          <span className="badge">Billing disabled</span>
          <h2 style={{ marginTop: 14 }}>Safe for sandbox review.</h2>
          <p>
            Buttons are disabled, prices are placeholders unless marked free, and this page does not create checkout sessions,
            collect card details, or change account access.
          </p>
        </article>
      </section>

      <section className="grid" aria-label="Subscription plans" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        {plans.map((plan) => (
          <article className="card" key={plan.name} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                <h2 style={{ fontSize: 32 }}>{plan.name}</h2>
                <span className="badge">{plan.status}</span>
              </div>
              <div className="kpi" aria-label={`${plan.name} monthly price placeholder`}>{plan.price}</div>
              <p>{plan.simpleMeaning}</p>
            </div>

            <div>
              <h3>Included in simple terms</h3>
              <ul className="receipts">
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            </div>

            <div aria-label={`${plan.name} access details`}>
              <div className="metric"><span>Alert access</span><strong>{plan.alertAccess}</strong></div>
              <div className="metric"><span>Notifications</span><strong>{plan.notifications}</strong></div>
              <div className="metric"><span>Ledger access</span><strong>{plan.ledgerAccess}</strong></div>
              <div className="metric"><span>Billing state</span><strong>{plan.billingState}</strong></div>
              <div className="metric"><span>Intended user</span><strong>{plan.intendedUser}</strong></div>
            </div>

            <button className="button" type="button" disabled style={{ marginTop: "auto" }}>
              Checkout disabled
            </button>
          </article>
        ))}
      </section>

      <section className="trust-section card risk-callout">
        <span className="badge">Safe billing disclaimer</span>
        <h2>Read before any future paid test.</h2>
        <p>
          Swing Up is market research software, not financial advice. Plan names describe access to research tools and content;
          they do not promise speed, returns, accuracy, or profitable outcomes. Future billing tests must be labeled as sandbox or
          live before users enter payment information.
        </p>
      </section>
    </main>
  );
}
