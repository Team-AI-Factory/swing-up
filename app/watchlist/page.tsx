import { getAuthReadinessSession } from "@/lib/auth-readiness";
import { listWatchlist } from "@/lib/watchlist-store";

const previewExamples = [
  { ticker: "AAPL", company: "Apple Inc.", sectorTheme: "Consumer Technology", riskPreference: "low", alertPreference: "Priority alerts later" },
  { ticker: "NVDA", company: "NVIDIA Corporation", sectorTheme: "Semiconductors", riskPreference: "high", alertPreference: "Signal digest later" },
  { ticker: "MSFT", company: "Microsoft Corporation", sectorTheme: "Cloud Software", riskPreference: "low", alertPreference: "Weekly summary later" },
];

function riskClassName(riskPreference: string) {
  const risk = riskPreference.toLowerCase();
  if (risk.includes("high") || risk.includes("aggressive")) return "importance-high";
  if (risk.includes("low") || risk.includes("conservative")) return "importance-low";
  return "importance-medium";
}

export default async function WatchlistPage() {
  const session = await getAuthReadinessSession({ setCookie: false });
  const savedItems = await listWatchlist(session.ownerId);
  const items = savedItems.length ? savedItems : previewExamples;

  return (
    <div className="page">
      <div className="eyebrow">Watchlist Preview</div>
      <div className="hero">
        <div>
          <h1>Your Watchlist</h1>
          <p>
            Track companies you care about. Swing Up will later use this to prioritise alerts,
            source checks, and pattern matches.
          </p>
          <p className="muted">{session.label}</p>
        </div>
        <div className="card">
          <h2>Auth readiness</h2>
          <p>
            This build stores watchlist preferences behind a preview owner boundary when real auth is not configured.
            It does not collect passwords, enforce paid tiers, charge users, or send notifications.
          </p>
          <code>GET/POST/DELETE /api/watchlist</code>
        </div>
      </div>

      {!savedItems.length ? (
        <section className="card" aria-label="Empty watchlist preview note">
          <h2>No saved watchlist items yet</h2>
          <p className="muted">The examples below are clearly labelled previews so an empty watchlist never crashes the page.</p>
        </section>
      ) : null}

      <div className="grid two">
        {items.map((item) => (
          <article className="card" key={item.ticker}>
            <div className="ledger-header">
              <div>
                <span className="badge">{item.ticker}</span>
                <h3 style={{ marginTop: 12 }}>{item.company}</h3>
                <p style={{ margin: 0 }}>{item.sectorTheme}</p>
              </div>
              <span className="badge status-received">{savedItems.length ? "Saved" : "Preview"}</span>
            </div>
            <div className="metric">
              <span>Asset type</span>
              <strong>{"assetType" in item ? item.assetType : "equity"}</strong>
            </div>
            <div className="metric">
              <span>Risk preference</span>
              <strong className={`badge ${riskClassName(item.riskPreference)}`}>{item.riskPreference}</strong>
            </div>
            <div className="metric">
              <span>Alert preference</span>
              <strong>{item.alertPreference}</strong>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
