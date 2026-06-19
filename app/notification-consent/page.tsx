const consentPrinciples = [
  {
    title: "Explicit choice before delivery",
    copy:
      "Notification consent means a user has clearly chosen how Swing Up may contact them before any off-dashboard alert is delivered.",
  },
  {
    title: "Research context, not instructions",
    copy:
      "Notifications are research alerts, not trade instructions. Every alert should point users back to evidence, receipts, and risk notes.",
  },
  {
    title: "Control stays with the user",
    copy:
      "Users should be able to change or stop notifications without losing access to calm product education or account settings.",
  },
];

const consentSections = [
  {
    title: "Email alerts",
    badge: "Email",
    copy:
      "Email consent should cover lower-urgency research summaries, missed-alert backups, and optional digests. Users should know what address receives alerts and how often messages may arrive.",
  },
  {
    title: "Telegram alerts",
    badge: "Telegram",
    copy:
      "Telegram consent should require a connected chat and a deliberate opt-in before private alert delivery. A chat connection alone should not imply consent for every alert type.",
  },
  {
    title: "Browser/PWA alerts",
    badge: "Browser",
    copy:
      "Browser or PWA alerts should only appear after the user grants browser permission and enables this channel inside Swing Up preferences.",
  },
  {
    title: "Watchlist-only alerts",
    badge: "Watchlist",
    copy:
      "Users should be able to limit notifications to assets, sectors, or themes they intentionally add to a watchlist, reducing noise and surprise interruptions.",
  },
  {
    title: "Risk-level preferences",
    badge: "Risk fit",
    copy:
      "Risk preferences should let users choose whether they want only conservative alerts, broader research signals, or higher-risk watchlist updates clearly labeled with context.",
  },
  {
    title: "Quiet hours",
    badge: "Calm mode",
    copy:
      "Quiet hours protect focus and rest. Alerts should wait, summarize, or stay inside the dashboard when a user has paused interruptions.",
  },
  {
    title: "Unsubscribe/preference control",
    badge: "User control",
    copy:
      "Users should be able to change or stop notifications. Preference controls should make pausing, unsubscribing, or changing channels easy to find.",
  },
  {
    title: "Why users should control alerts",
    badge: "Trust",
    copy:
      "Financial research alerts can feel urgent. User control keeps Swing Up aligned with consent, reduces alert fatigue, and reinforces that every notification is optional research context.",
  },
];

export default function NotificationConsentPage() {
  return (
    <main className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Notification consent</div>
          <h1>Clear permission before any alert leaves Swing Up.</h1>
          <p>
            This standalone explainer describes how notification consent should work for email, Telegram, and browser alerts.
            It uses local static content only, does not require login, and does not send notifications.
          </p>
        </div>
        <aside className="card risk-callout" aria-label="Notification consent boundary">
          <span className="badge status-connected">Consent first</span>
          <h2>No surprise alerts</h2>
          <p>No real notification should be sent without user consent.</p>
        </aside>
      </section>

      <section className="grid three trust-section" aria-label="What notification consent means">
        {consentPrinciples.map((principle) => (
          <article className="card" key={principle.title}>
            <span className="badge">Consent principle</span>
            <h2>{principle.title}</h2>
            <p>{principle.copy}</p>
          </article>
        ))}
      </section>

      <section className="grid two trust-section" aria-label="Notification preference sections">
        {consentSections.map((section) => (
          <article className="card" key={section.title}>
            <span className="badge status-stubbed">{section.badge}</span>
            <h2>{section.title}</h2>
            <p>{section.copy}</p>
          </article>
        ))}
      </section>

      <section className="card trust-section" aria-label="Research alert reminder">
        <span className="badge outcome-unknown">Important wording</span>
        <h2>Consent protects attention and expectations.</h2>
        <p>
          Notifications are research alerts, not trade instructions. Users should be able to change or stop notifications.
        </p>
      </section>
    </main>
  );
}
