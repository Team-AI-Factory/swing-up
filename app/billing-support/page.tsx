const helpTopics = [
  {
    title: "Subscription changes",
    body: "Future plan changes should be handled clearly, with visible plan names, renewal timing, and any sandbox/test labels before live billing is enabled.",
  },
  {
    title: "Cancellation help",
    body: "Cancellation support will explain where to manage access, what happens at the end of a paid period, and how to confirm a request was received.",
  },
  {
    title: "Refund request placeholder",
    body: "Refund requests are not active yet. When paid subscriptions launch, this area can point users to the correct request form, eligibility notes, and review timeline.",
  },
  {
    title: "Failed payment placeholder",
    body: "If a payment fails in the future, users should see safe next steps such as checking card details, confirming billing address, or contacting support without exposing sensitive payment data.",
  },
  {
    title: "Invoice/receipt placeholder",
    body: "Invoice and receipt access is planned for paid accounts. This placeholder keeps the route ready without connecting a payment provider or requiring login.",
  },
  {
    title: "Support contact placeholder",
    body: "Billing support contact details will be added before live payments. For now, this page documents the support surface and expected user guidance.",
  },
];

const supportPrinciples = [
  "Billing features may start in sandbox/test mode before live payments are enabled.",
  "Paid access should not promise investment returns.",
  "Users should never send full card numbers, bank credentials, passwords, or private keys to support.",
];

export default function BillingSupportPage() {
  return (
    <main className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Billing support</div>
          <h1>Refund + Billing Support</h1>
          <p>
            A calm, plain-language support page for future subscriptions, billing questions,
            cancellation help, refunds, failed payments, and receipt requests.
          </p>
        </div>
        <article className="card risk-callout">
          <span className="badge">Future billing</span>
          <h2>Static support preview</h2>
          <p>
            This page uses local static content only. It does not call payment APIs, create
            checkout sessions, or require users to log in.
          </p>
        </article>
      </section>

      <section className="trust-section card">
        <span className="badge">Billing help</span>
        <h2>What this page will help with</h2>
        <p>
          When paid subscriptions are enabled, this page can guide users through common billing
          questions while keeping payment handling separate, secure, and clearly labeled.
        </p>
      </section>

      <section className="grid two trust-section">
        {helpTopics.map((topic) => (
          <article className="card" key={topic.title}>
            <span className="badge">Support topic</span>
            <h2>{topic.title}</h2>
            <p>{topic.body}</p>
          </article>
        ))}
      </section>

      <section className="trust-section card risk-callout">
        <span className="badge">Payment safety note</span>
        <h2>Clear limits before live payments</h2>
        <div className="disclaimer-list">
          {supportPrinciples.map((principle) => (
            <div className="metric" key={principle}>
              <span>{principle}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
