const privacyPrinciples = [
  {
    eyebrow: "Data scope",
    title: "What data Swing Up may collect",
    body:
      "Swing Up may later collect limited information needed to operate accounts, save user preferences, deliver research features, process paid access, and keep the product reliable. Collection should stay purposeful, explainable, and tied to user benefit.",
  },
  {
    eyebrow: "Account data",
    title: "Account data",
    body:
      "If accounts are added, Swing Up may collect details such as name, email address, sign-in method, plan status, and support history. Account data should be used to identify the user, secure access, provide support, and manage product settings.",
  },
  {
    eyebrow: "Watchlist data",
    title: "Watchlist data",
    body:
      "If watchlists are saved, Swing Up may store symbols, sectors, alert settings, and research views selected by the user. Watchlist data should help personalize the research workspace without being treated as advertising inventory.",
  },
  {
    eyebrow: "Preferences",
    title: "Notification preferences",
    body:
      "Swing Up may later store notification channels, frequency choices, quiet hours, and alert categories. These preferences should be used only to respect how and when users want to receive product communications.",
  },
  {
    eyebrow: "Payments",
    title: "Payment-related data",
    body:
      "If paid plans are introduced, Swing Up may keep plan, receipt, billing status, and entitlement records. Sensitive payment details should be handled by trusted payment providers rather than stored directly by Swing Up whenever possible.",
  },
  {
    eyebrow: "Research usage",
    title: "Research usage data",
    body:
      "Swing Up may later use aggregated or product-level research activity to understand which pages, receipts, alerts, and education flows are useful. Usage review should improve clarity, reliability, and safety rather than exploit private behavior.",
  },
];

const securityPrinciples = [
  "Collect only what is needed for clear product purposes",
  "Limit access to user data by role and operational need",
  "Prefer aggregated learning over unnecessary individual profiling",
  "Keep retention periods reasonable and deletion paths understandable",
];

export default function PrivacyPage() {
  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Privacy + Data Use</div>
          <h1>User trust should come before data expansion.</h1>
          <p>
            This page explains the kinds of user data Swing Up may collect later and the principles
            that should guide how that data is handled. Swing Up should protect user trust before
            monetisation.
          </p>
        </div>
        <aside className="card risk-callout" aria-label="Privacy commitment">
          <span className="badge">Core commitment</span>
          <h2>No selling sensitive user intent.</h2>
          <p>
            Swing Up should not sell personal conversation, watchlist, or payment data to advertisers.
          </p>
        </aside>
      </section>

      <section className="grid two trust-section">
        {privacyPrinciples.map((section) => (
          <article className="card" key={section.title}>
            <span className="badge">{section.eyebrow}</span>
            <h2>{section.title}</h2>
            <p>{section.body}</p>
          </article>
        ))}
      </section>

      <section className="grid two trust-section">
        <article className="card risk-callout">
          <span className="badge">Not for sale</span>
          <h2>What Swing Up should not sell</h2>
          <p>
            Swing Up should not sell personal conversation, watchlist, or payment data to advertisers.
            It should also avoid selling sensitive user intent, saved research interests, billing
            signals, or private support requests as ad-targeting data.
          </p>
        </article>

        <article className="card">
          <span className="badge">Deletion requests</span>
          <h2>How users can request deletion later</h2>
          <p>
            When account features are available, Swing Up should provide a clear support path for
            users to request account deletion, watchlist removal, notification preference removal,
            and deletion of data that is no longer needed for legal, security, or operational reasons.
          </p>
        </article>
      </section>

      <section className="grid two trust-section">
        <article className="card">
          <span className="badge">Security principles</span>
          <h2>Data security principles</h2>
          <div className="disclaimer-list">
            {securityPrinciples.map((principle) => (
              <div className="metric" key={principle}>
                <span>{principle}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="card">
          <span className="badge">Support placeholder</span>
          <h2>Contact/support placeholder</h2>
          <p>
            For future privacy questions or deletion requests, Swing Up should offer a dedicated
            support contact. Placeholder: privacy@swingup.example.
          </p>
        </article>
      </section>
    </div>
  );
}
