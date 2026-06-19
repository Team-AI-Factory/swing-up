const currentSecuritySections = [
  {
    eyebrow: "Current · Account protection",
    title: "Preview account boundaries",
    body:
      "Swing Up currently treats account security as a trust requirement to define before live account features expand. Preview pages should not require users to share brokerage credentials, trading passwords, or custody access.",
  },
  {
    eyebrow: "Current · Watchlist privacy",
    title: "Watchlists are sensitive intent data",
    body:
      "Saved tickers, sectors, alerts, and research interests can reveal what a user is considering. Swing Up should treat watchlist data as private by default and avoid exposing it publicly without clear user intent.",
  },
  {
    eyebrow: "Current · Notification preferences",
    title: "Preferences should control communication",
    body:
      "Notification settings should exist to respect user choices about channels, frequency, quiet hours, and alert categories. They should not be treated as a reason to send unrelated or confusing messages.",
  },
  {
    eyebrow: "Current · Payment data handling",
    title: "Keep payment details separated",
    body:
      "Before paid users are live, Swing Up should plan to store only the payment-related records needed for plan status, receipts, support, and entitlement checks. Sensitive card or bank details should be handled by trusted payment providers rather than stored directly by Swing Up whenever possible.",
  },
  {
    eyebrow: "Current · Secret/API key safety",
    title: "Secrets should never appear in user-facing pages",
    body:
      "API keys, service credentials, signing secrets, and internal tokens should stay out of browser code, public repositories, support screenshots, logs intended for users, and marketing or trust pages.",
  },
  {
    eyebrow: "Current · Admin access safety",
    title: "Admin power should be limited and accountable",
    body:
      "Administrative tools should be separated from public product surfaces and reserved for people with an operational need. Admin access should be reviewed carefully before it can affect users, billing, notifications, or research records.",
  },
];

const neverShareItems = [
  "Brokerage usernames, passwords, recovery phrases, or trading authorization",
  "One-time sign-in codes, magic links, password reset links, or session tokens",
  "Full payment card numbers, bank credentials, or payment provider passwords",
  "Private API keys, service tokens, webhook secrets, or environment variables",
  "Government IDs or tax documents unless a future verified process clearly requires them",
];

const plannedImprovements = [
  "Clear account recovery and session management once real login is enabled",
  "User-visible watchlist privacy controls and deletion paths",
  "Notification consent history, unsubscribe controls, and quiet-hour settings",
  "Role-based admin permissions, access reviews, and audit trails",
  "Documented incident communication steps for account, payment, or data exposure events",
];

export default function SecurityPage() {
  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Account Security</div>
          <h1>Protecting account trust before live accounts and payments.</h1>
          <p>
            Security information is provided for transparency and may change as Swing Up moves from preview to live accounts.
            Swing Up should protect user trust before monetisation.
          </p>
        </div>
        <aside className="card risk-callout" aria-label="Security transparency note">
          <span className="badge">Current status</span>
          <h2>Preview trust page, not a login requirement.</h2>
          <p>
            This standalone page uses local static content only. It explains expected safeguards without claiming that future account, payment, or admin controls are already live.
          </p>
        </aside>
      </section>

      <section className="grid two trust-section">
        {currentSecuritySections.map((section) => (
          <article className="card" key={section.title}>
            <span className="badge">{section.eyebrow}</span>
            <h2>{section.title}</h2>
            <p>{section.body}</p>
          </article>
        ))}
      </section>

      <section className="grid two trust-section">
        <article className="card risk-callout">
          <span className="badge">Current · Never share</span>
          <h2>What users should never share</h2>
          <div className="disclaimer-list">
            {neverShareItems.map((item) => (
              <div className="metric" key={item}>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="card">
          <span className="badge">Planned · Future improvements</span>
          <h2>Security controls to add before live scale</h2>
          <div className="disclaimer-list">
            {plannedImprovements.map((item) => (
              <div className="metric" key={item}>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}
