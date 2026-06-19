type Plan = {
  name: string;
  price: string;
  label: string;
  summary: string;
  includes: string[];
  bestFor: string;
  checkoutText: string;
};

const plans: Plan[] = [
  {
    name: "Free",
    price: "$0 / month",
    label: "Available as preview access",
    summary: "Explore public Swing Up research surfaces before any paid subscription is required.",
    includes: ["Public ledger viewing", "Delayed or sample alert examples", "Education pages and methodology notes"],
    bestFor: "People evaluating how Swing Up explains signals, receipts, and risk context.",
    checkoutText: "No checkout needed",
  },
  {
    name: "Trial",
    price: "Sandbox only",
    label: "Test payment phase",
    summary: "A future short evaluation window for testing plan access, receipts, and cancellation language.",
    includes: ["Test-mode billing labels", "Limited access to paid-tier previews", "Clear end-of-trial and cancellation copy"],
    bestFor: "Internal testers and early users validating the subscription experience before live billing.",
    checkoutText: "Checkout not connected",
  },
  {
    name: "Paid",
    price: "TBD",
    label: "Not live yet",
    summary: "Planned subscription access for fuller research workflow features after billing is approved for launch.",
    includes: ["Expanded alert context", "Watchlist-oriented research surfaces", "Billing support and receipt flows when enabled"],
    bestFor: "Users who want deeper research organization once production billing and account controls are ready.",
    checkoutText: "Coming soon — no charge",
  },
];

const readinessNotes = [
  "Payments are not live on this page.",
  "Any future sandbox checkout must be clearly labeled as test mode before users interact with it.",
  "Plan access describes research workflow features only, not investment outcomes.",
];

export default function PricingPage() {
  return (
    <main className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Pricing · sandbox readiness</div>
          <h1>Simple plans for previewing Swing Up research access.</h1>
          <p>
            Swing Up pricing is being prepared for a sandbox/test payment phase. Live billing is not active here, checkout is
            not connected, and no card is required from this page.
          </p>
          <div className="button-row" aria-label="Billing status labels">
            <span className="badge">Payments not live</span>
            <span className="badge">No checkout connection</span>
            <span className="badge">Research access only</span>
          </div>
        </div>

        <article className="card risk-callout" aria-label="Billing disclaimer">
          <span className="badge">Safe billing disclaimer</span>
          <h2>Do not enter payment details yet.</h2>
          <p>
            This page is static pricing copy for launch readiness. Swing Up will label any future test-mode payment flow before
            collecting billing information, and paid access will not guarantee market results.
          </p>
        </article>
      </section>

      <section className="grid three trust-section" aria-label="Pricing plan cards">
        {plans.map((plan) => (
          <article className="card" key={plan.name} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <span className="badge">{plan.label}</span>
              <h2 style={{ marginTop: 14 }}>{plan.name}</h2>
              <div className="kpi" aria-label={`${plan.name} price`}>{plan.price}</div>
              <p>{plan.summary}</p>
            </div>

            <div>
              <h3>In simple terms</h3>
              <ul className="receipts">
                {plan.includes.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>

            <div className="metric">
              <span>Best for</span>
              <strong>{plan.bestFor}</strong>
            </div>

            <button className="button" type="button" disabled style={{ marginTop: "auto" }}>
              {plan.checkoutText}
            </button>
          </article>
        ))}
      </section>

      <section className="grid two trust-section">
        <article className="card">
          <span className="badge">Readiness notes</span>
          <h2>What changes before paid launch</h2>
          <ul className="receipts">
            {readinessNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </article>
        <article className="card risk-callout">
          <span className="badge">Investment risk</span>
          <h2>Research support, not financial advice</h2>
          <p>
            Swing Up provides market research organization and signal context. It does not provide personalized investment
            advice, guarantee returns, or promise that any alert will be profitable. Investing involves risk, including loss of capital.
          </p>
        </article>
      </section>
    </main>
  );
}
