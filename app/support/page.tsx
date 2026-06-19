const supportCategories = [
  {
    title: "Account help",
    body: "Use this area for sign-in questions, account access, profile settings, and future account deletion or recovery guidance. Do not share passwords or security codes with support.",
  },
  {
    title: "Billing help",
    body: "Use this area for future plan, receipt, cancellation, renewal, refund, or failed-payment questions. Swing Up is not collecting billing requests from this page yet.",
  },
  {
    title: "Alert questions",
    body: "Use this area to understand how alert previews, confidence language, research context, and safety notes should be interpreted before taking independent action.",
  },
  {
    title: "Watchlist help",
    body: "Use this area for future questions about saved symbols, watchlist settings, research views, and removing items from a personal watchlist.",
  },
  {
    title: "Notification help",
    body: "Use this area for future questions about notification preferences, quiet hours, delivery channels, and alert frequency controls.",
  },
  {
    title: "Technical issue",
    body: "Use this area to describe page loading problems, display issues, broken links, browser compatibility, or unexpected product behavior.",
  },
  {
    title: "Data/source issue",
    body: "Use this area for questions about stale data, source availability, source reliability labels, missing context, or research information that appears inconsistent.",
  },
];

const beforeContactingSupport = [
  "Include the page or feature name where the question occurred.",
  "Describe what you expected to happen and what actually happened.",
  "Avoid sending passwords, full payment details, private keys, or other sensitive credentials.",
  "For market research questions, include the symbol, date, and alert or source name if available.",
];

export default function SupportPage() {
  return (
    <main className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Support Center</div>
          <h1>Get help with Swing Up account, billing, alerts, and product questions.</h1>
          <p>
            This standalone support center explains where users can look for help before live
            accounts, paid plans, and notification workflows are connected.
          </p>
        </div>
        <article className="card risk-callout" aria-label="Support status">
          <span className="badge">Static support page</span>
          <h2>No submissions are collected here.</h2>
          <p>
            This page uses local static content only. It does not call APIs, send email, create
            tickets, or collect form submissions.
          </p>
        </article>
      </section>

      <section className="trust-section card">
        <span className="badge">Important note</span>
        <h2>Decision-support information only</h2>
        <p>
          Swing Up provides market research and decision-support information. It does not guarantee
          returns.
        </p>
      </section>

      <section className="grid two trust-section" aria-label="Support categories">
        {supportCategories.map((category) => (
          <article className="card" key={category.title}>
            <span className="badge">Support category</span>
            <h2>{category.title}</h2>
            <p>{category.body}</p>
          </article>
        ))}
      </section>

      <section className="grid two trust-section">
        <article className="card">
          <span className="badge">Before contacting support</span>
          <h2>Helpful details to prepare</h2>
          <div className="disclaimer-list">
            {beforeContactingSupport.map((item) => (
              <div className="metric" key={item}>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="card risk-callout">
          <span className="badge">Contact placeholder</span>
          <h2>Support contact details coming later</h2>
          <p>
            A dedicated Swing Up support contact will be added before real account, billing, and
            notification operations go live. Placeholder: support@swingup.example.
          </p>
        </article>
      </section>
    </main>
  );
}
