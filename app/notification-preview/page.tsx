const channels = [
  {
    name: "Web dashboard",
    status: "main",
    usedFor: "In-product alert review, receipt context, watchlist scanning, and calm follow-up after an alert is created.",
    permission: "Signed-in Swing Up account with access to the dashboard and an eligible subscription plan.",
    limitation: "Users must open the dashboard to see updates, so it is not the fastest interruption channel.",
    example: "New research alert is ready in your dashboard: Margin Reset Watch — review receipts before acting.",
  },
  {
    name: "Email",
    status: "backup",
    usedFor: "Lower-urgency summaries, missed-alert backup, weekly digests, and account-safe delivery when push channels are unavailable.",
    permission: "Verified email address, active subscription, and email alerts enabled by the user.",
    limitation: "Inbox filtering, delays, and unsubscribed status can prevent delivery or reduce visibility.",
    example: "Swing Up research alert: Cloud Margin Reset moved to review. Open the dashboard for receipts and risk context.",
  },
  {
    name: "Telegram",
    status: "planned",
    usedFor: "Fast private alert delivery for users who choose a chat-based channel after connecting their account.",
    permission: "Connected Telegram account, saved Telegram chat ID, active subscription, enabled channel, and user must press Start in Telegram first.",
    limitation: "Private alerts cannot be sent until the user connects Telegram and presses Start, and delivery still depends on Telegram availability.",
    example: "Swing Up research alert: Watchlist signal detected for NVDA. Receipts and limits checked — open dashboard for full review.",
  },
  {
    name: "PWA push",
    status: "planned",
    usedFor: "Browser-based push alerts for installed web app users who want near-real-time notifications without native apps.",
    permission: "Browser push permission, installed or supported PWA context, active subscription, and enabled push channel.",
    limitation: "Support varies by browser, device, operating system, and user notification settings.",
    example: "Research alert available: Retail Margin Reset — tap to review receipts, confidence, and risk notes.",
  },
  {
    name: "Native app push later",
    status: "later",
    usedFor: "Future iOS and Android app notifications if Swing Up ships native mobile apps later.",
    permission: "Native app installation, OS notification permission, signed-in account, active subscription, and enabled push channel.",
    limitation: "Requires native app infrastructure, app-store release workflows, device tokens, and ongoing mobile maintenance.",
    example: "Swing Up research alert: New category signal in your watchlist. Open the app for evidence and disclaimers.",
  },
];

const checks = [
  "active subscription",
  "plan tier",
  "channel connected",
  "channel enabled",
  "daily alert limit",
  "user watchlist/category preference",
  "user paused/unsubscribed status",
];

const statusClassNames: Record<string, string> = {
  main: "status-connected",
  backup: "outcome-unknown",
  planned: "status-stubbed",
  later: "status-stubbed",
};

export default function NotificationPreviewPage() {
  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Notification channels preview</div>
          <h1>Calm alert delivery, with permissions checked first.</h1>
          <p>
            This standalone preview shows how Swing Up may deliver research alerts through the web dashboard, email, Telegram,
            PWA push, and future native app push. It uses local static content only and does not send messages or connect services.
          </p>
        </div>
        <div className="card risk-callout">
          <span className="badge">Important boundary</span>
          <h2>Research alerts only</h2>
          <p>Notifications deliver research alerts. They are not trade instructions.</p>
        </div>
      </section>

      <section className="grid two trust-section">
        {channels.map((channel) => (
          <article className="card" key={channel.name}>
            <span className={`badge ${statusClassNames[channel.status]}`}>{channel.status}</span>
            <h2>{channel.name}</h2>
            <div className="metric">
              <span>Used for</span>
              <strong>{channel.usedFor}</strong>
            </div>
            <div className="metric">
              <span>User permission needed</span>
              <strong>{channel.permission}</strong>
            </div>
            <div className="metric">
              <span>Risk or limitation</span>
              <strong>{channel.limitation}</strong>
            </div>
            <div className="metric">
              <span>Example alert delivery text</span>
              <strong>{channel.example}</strong>
            </div>
          </article>
        ))}
      </section>

      <section className="grid two trust-section">
        <article className="card">
          <span className="badge status-stubbed">Telegram permission</span>
          <h2>Telegram needs an explicit start</h2>
          <p>
            A user must connect Telegram and press Start before private alerts can be sent. The permission model is intentionally
            narrow: user account + subscription plan + Telegram chat ID = alert permission.
          </p>
        </article>
        <article className="card">
          <span className="badge">Pre-send checks</span>
          <h2>What Swing Up should verify before sending</h2>
          <ol className="receipts">
            {checks.map((check) => (
              <li key={check}>{check}</li>
            ))}
          </ol>
        </article>
      </section>
    </div>
  );
}
