const statusRows = [
  {
    name: "Web app",
    status: "Operational",
    summary: "The public Swing Up website is expected to load normally.",
    detail: "This static page does not check live uptime. Use it as a plain-language placeholder until automated monitoring is connected.",
  },
  {
    name: "Healthcheck",
    status: "Preview",
    summary: "A basic healthcheck endpoint exists for simple service checks.",
    detail: "This status page does not call the healthcheck endpoint or display live results.",
  },
  {
    name: "Market alerts",
    status: "Preview",
    summary: "Alert previews and research workflows are visible while the product is still being shaped.",
    detail: "Alert availability may vary because this is not a live incident dashboard yet.",
  },
  {
    name: "Public ledger",
    status: "Preview",
    summary: "Public tracking pages are available for explaining how Swing Up records outcomes.",
    detail: "Ledger health is represented manually here and is not pulled from a live service.",
  },
  {
    name: "Source ears",
    status: "Degraded",
    summary: "Some source connections may be mocked, stubbed, delayed, or manually reviewed.",
    detail: "Treat source-ear status as a cautious placeholder until live source monitoring is wired into this page.",
  },
  {
    name: "Watchlists",
    status: "Preview",
    summary: "Watchlist-related screens and preview flows are available for product exploration.",
    detail: "This page does not inspect individual user watchlists or private settings.",
  },
  {
    name: "Notifications",
    status: "Not live yet",
    summary: "Notification delivery is not presented here as a live production service.",
    detail: "Future versions can show delivery status for email, push, or other alert channels.",
  },
  {
    name: "Payments",
    status: "Planned",
    summary: "Payment status is included so users know where billing reliability will appear later.",
    detail: "No live payment processor checks are called from this static public page.",
  },
];

const statusStyles: Record<string, { background: string; color: string; border: string }> = {
  Operational: { background: "#dcfce7", color: "#166534", border: "#86efac" },
  Preview: { background: "#e0f2fe", color: "#075985", border: "#7dd3fc" },
  Degraded: { background: "#fef3c7", color: "#92400e", border: "#fbbf24" },
  "Not live yet": { background: "#f1f5f9", color: "#475569", border: "#cbd5e1" },
  Planned: { background: "#f3e8ff", color: "#6b21a8", border: "#d8b4fe" },
};

export const metadata = {
  title: "System Status | Swing Up",
  description: "A simple public status placeholder for Swing Up system health.",
};

export default function StatusPage() {
  return (
    <main className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">System status</div>
          <h1>Swing Up system status</h1>
          <p>
            A plain-language view of the services users care about: alerts, source ears, public tracking,
            watchlists, notifications, payments, and the web app itself.
          </p>
        </div>
        <article className="card risk-callout">
          <span className="badge">Manual/static status placeholder</span>
          <h2>Not a live incident dashboard yet.</h2>
          <p>
            These statuses are local static content only. This page does not call APIs, run live checks,
            inspect private accounts, or contact payment, notification, market-data, or source-health services.
          </p>
        </article>
      </section>

      <section className="card" aria-labelledby="status-overview-heading">
        <div className="eyebrow">Current public summary</div>
        <h2 id="status-overview-heading">Service health at a glance</h2>
        <p>
          Until automated monitoring is connected, use these labels as a conservative product-readiness summary,
          not as proof of live uptime.
        </p>

        <div style={{ display: "grid", gap: 14, marginTop: 22 }}>
          {statusRows.map((row) => {
            const style = statusStyles[row.status];

            return (
              <article
                className="card"
                key={row.name}
                style={{
                  alignItems: "start",
                  display: "grid",
                  gap: 12,
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                }}
              >
                <div>
                  <div className="eyebrow">Component</div>
                  <h3 style={{ marginTop: 6 }}>{row.name}</h3>
                </div>
                <div>
                  <div className="eyebrow">Status</div>
                  <span
                    style={{
                      background: style.background,
                      border: `1px solid ${style.border}`,
                      borderRadius: 999,
                      color: style.color,
                      display: "inline-flex",
                      fontSize: 13,
                      fontWeight: 700,
                      marginTop: 8,
                      padding: "7px 11px",
                    }}
                  >
                    {row.status}
                  </span>
                </div>
                <div>
                  <div className="eyebrow">What this means</div>
                  <p style={{ marginTop: 8 }}>
                    <strong>{row.summary}</strong>
                  </p>
                  <p>{row.detail}</p>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="grid two" style={{ marginTop: 22 }}>
        <article className="card">
          <div className="eyebrow">Status labels</div>
          <h2>How to read this page</h2>
          <p><strong>Operational</strong> means the component is expected to work for normal public use.</p>
          <p><strong>Preview</strong> means the component is visible or usable, but still part of a preview workflow.</p>
          <p><strong>Degraded</strong> means the component may be partial, delayed, manually reviewed, or lower confidence.</p>
          <p><strong>Not live yet</strong> means the public production service is not active here.</p>
          <p><strong>Planned</strong> means the component is on the roadmap for future status tracking.</p>
        </article>
        <article className="card">
          <div className="eyebrow">Future live version</div>
          <h2>What can be automated later</h2>
          <p>
            A later version can connect to monitored uptime, source reliability, notification delivery,
            ledger freshness, and payment-provider status once those checks are safe to expose publicly.
          </p>
          <p>
            For now, the page is intentionally standalone so it cannot leak private data or create extra
            operational load.
          </p>
        </article>
      </section>
    </main>
  );
}
