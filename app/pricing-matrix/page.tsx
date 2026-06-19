type Plan = {
  name: string;
  price: string;
  status?: string;
  features: string[];
  alertAccess: string;
  notifications: string;
  ledgerAccess: string;
  intendedUser: string;
};

const plans: Plan[] = [
  {
    name: "Free",
    price: "$0 / mo",
    features: ["Delayed alerts", "Public ledger access", "Limited watchlist"],
    alertAccess: "Delayed public alert summaries",
    notifications: "Limited email-style notification previews",
    ledgerAccess: "Public ledger only",
    intendedUser: "Curious investors who want to understand the workflow before subscribing.",
  },
  {
    name: "Starter",
    price: "TBD / mo",
    status: "Coming soon",
    features: ["Watchlist alerts", "Basic alert context", "Simple monitoring labels"],
    alertAccess: "Watchlist-level alerts for followed names",
    notifications: "Watchlist notification access when available",
    ledgerAccess: "Public ledger plus watchlist context",
    intendedUser: "Users who want calm monitoring around a small list of companies.",
  },
  {
    name: "Pro",
    price: "TBD / mo",
    status: "Coming soon",
    features: ["Full alert cards", "DCF context", "Pattern match notes", "Profit Potential Score"],
    alertAccess: "Full research-style alert cards without guaranteed outcomes",
    notifications: "Expanded alert notifications when available",
    ledgerAccess: "Public ledger with richer alert-card context",
    intendedUser: "Active users who want evidence, valuation context, and historical pattern framing.",
  },
  {
    name: "Elite",
    price: "TBD / mo",
    status: "Coming soon",
    features: ["Priority alerts", "Full radar", "Broader signal context", "Advanced opportunity monitoring"],
    alertAccess: "Priority access to higher-context alerts and radar views",
    notifications: "Priority notification access when available",
    ledgerAccess: "Full public ledger context with radar references",
    intendedUser: "Power users who want the broadest Swing Up monitoring experience.",
  },
  {
    name: "Community/API",
    price: "TBD / mo",
    status: "Coming soon",
    features: ["Community feed", "API-use placeholder", "Shared signal context", "Integration planning"],
    alertAccess: "Community and API-oriented alert surfaces",
    notifications: "Community/API notification options to be defined",
    ledgerAccess: "Public ledger access for shared references",
    intendedUser: "Builders, communities, and teams exploring non-payment API use cases.",
  },
];

export default function PricingMatrixPage() {
  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Subscription plan matrix</div>
          <h1>Choose the level of Swing Up signal access you want to preview.</h1>
          <p>
            This standalone matrix uses local static content only. Prices are placeholders, billing is not connected,
            and every plan should be evaluated as research workflow access—not a promise of guaranteed returns.
          </p>
          <div className="button-row" aria-label="Pricing matrix status labels">
            <span className="badge">Static preview</span>
            <span className="badge">No payment connection</span>
            <span className="badge">No guaranteed returns</span>
          </div>
        </div>

        <article className="card risk-callout">
          <span className="badge">Coming soon</span>
          <h2 style={{ marginTop: 14 }}>Billing is intentionally disabled.</h2>
          <p>
            These plan cards do not connect to Paddle, Lemon Squeezy, webhooks, or account billing. Disabled buttons are
            placeholders for future subscription flows.
          </p>
        </article>
      </section>

      <section className="grid" aria-label="Subscription plans" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        {plans.map((plan) => (
          <article className="card" key={plan.name} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                <h2 style={{ fontSize: 32 }}>{plan.name}</h2>
                {plan.status ? <span className="badge">{plan.status}</span> : null}
              </div>
              <div className="kpi" aria-label={`${plan.name} monthly price placeholder`}>{plan.price}</div>
            </div>

            <div>
              <h3>Included features</h3>
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
              <div className="metric"><span>Intended user</span><strong>{plan.intendedUser}</strong></div>
            </div>

            <button className="button" type="button" disabled style={{ marginTop: "auto" }}>
              Coming soon — no checkout
            </button>
          </article>
        ))}
      </section>
    </div>
  );
}
