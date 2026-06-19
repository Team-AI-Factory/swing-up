const previewSections = [
  {
    title: "Profile settings preview",
    description:
      "Future controls for the display name, email visibility, preferred market focus, and basic account identity details.",
    items: ["Display name and contact email", "Market regions of interest", "Research experience level"],
  },
  {
    title: "Risk profile preview",
    description:
      "A calm setup area for describing risk comfort before personalized research filters are considered.",
    items: ["Conservative, balanced, or aggressive research style", "Volatility comfort", "Time horizon preference"],
  },
  {
    title: "Watchlist preferences preview",
    description:
      "Future defaults for how watchlist ideas are organized, grouped, and reviewed across Swing Up.",
    items: ["Default watchlist categories", "Preferred asset themes", "Review cadence reminders"],
  },
  {
    title: "Notification preferences preview",
    description:
      "A preview of alert delivery choices without enabling any real messages, emails, or push notifications.",
    items: ["Signal summary frequency", "High-priority alert preference", "Quiet hours placeholder"],
  },
  {
    title: "Subscription settings preview",
    description:
      "A future billing and plan management area that is intentionally inactive in this standalone preview.",
    items: ["Current plan placeholder", "Upgrade and downgrade controls", "Billing history access"],
  },
  {
    title: "Privacy/data controls preview",
    description:
      "Future controls for data visibility, export requests, and account-level privacy choices.",
    items: ["Data export request", "Personalization controls", "Research history visibility"],
  },
];

export default function AccountSettingsPreviewPage() {
  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Account settings preview</div>
          <h1>Future account controls, shown safely before launch.</h1>
          <p>
            A standalone, static preview of how Swing Up may organize profile, risk,
            watchlist, notification, subscription, privacy, and deletion settings in a
            secure account area.
          </p>
        </div>
        <aside className="card risk-callout" aria-label="Preview safety notice">
          <span className="badge">Preview only</span>
          <h2>No real settings are saved</h2>
          <p>Preview only — this page does not save real account settings yet.</p>
          <p>Real settings should require secure authentication before launch.</p>
        </aside>
      </section>

      <section className="grid two trust-section" aria-label="Account settings preview sections">
        {previewSections.map((section) => (
          <article className="card" key={section.title}>
            <span className="badge">Static preview</span>
            <h3>{section.title}</h3>
            <p>{section.description}</p>
            <ul className="receipts">
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      <section className="card trust-section" aria-label="Account deletion request placeholder">
        <span className="badge">Deletion request placeholder</span>
        <h2>Account deletion request</h2>
        <p>
          This future area would let an authenticated user request account deletion,
          review retention notes, and confirm the action through a secure process.
        </p>
        <ul className="receipts">
          <li>No deletion request is submitted from this preview.</li>
          <li>No account data is read, changed, stored, or removed.</li>
          <li>Final launch behavior should include authentication, confirmation, and audit-safe handling.</li>
        </ul>
      </section>
    </div>
  );
}
