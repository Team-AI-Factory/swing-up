import Link from "next/link";
import { getAuthReadinessSession } from "@/lib/auth-readiness";
import { listWatchlist } from "@/lib/watchlist-store";

const previewExamples = [
  { ticker: "AAPL", company: "Apple Inc.", sectorTheme: "Consumer Technology", riskPreference: "low", alertPreference: "Set later after consent" },
  { ticker: "NVDA", company: "NVIDIA Corporation", sectorTheme: "Semiconductors", riskPreference: "high", alertPreference: "Digest preference later" },
  { ticker: "MSFT", company: "Microsoft Corporation", sectorTheme: "Cloud Software", riskPreference: "low", alertPreference: "Weekly summary later" },
];

const setupSteps = [
  { title: "Create account", body: "Use the signup flow once production auth is enabled. This page currently uses a preview owner label only." },
  { title: "Choose watchlist", body: "Select the assets and themes that should shape future alert ranking and research context." },
  { title: "Set alerts later", body: "Delivery channel, digest cadence, and risk preferences stay editable after onboarding." },
  { title: "Consent required", body: "Swing Up will not send email, push, or SMS notifications unless the user gives explicit consent." },
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
      <div className="eyebrow">Watchlist · onboarding preview</div>
      <div className="hero">
        <div>
          <span className="badge status-not_configured">Preview only — auth not connected</span>
          <h1 style={{ marginTop: 16 }}>Choose your watchlist</h1>
          <p>
            Your watchlist is the bridge between signup and useful alerts. Start with the companies,
            funds, sectors, or themes you care about; alert preferences and notification consent can be
            reviewed later before anything is sent.
          </p>
          <p className="muted">{session.label}</p>
          <div className="button-row" aria-label="Watchlist onboarding actions">
            <Link className="button primary" href="/signup">Create account preview</Link>
            <Link className="button" href="/login">Return to login</Link>
          </div>
        </div>
        <div className="card">
          <h2>What happens here</h2>
          <p>
            This build may show saved preview-owner watchlist rows when available, otherwise it displays
            sample cards. It does not collect passwords, charge users, enforce paid tiers, or send notifications.
          </p>
          <div className="metric"><span>Data mode</span><strong>Preview boundary</strong></div>
          <div className="metric"><span>Alert preferences</span><strong>Set later</strong></div>
          <div className="metric"><span>Notification sending</span><strong>Consent required</strong></div>
          <code>GET/POST/DELETE /api/watchlist</code>
        </div>
      </div>

      <section className="grid four" aria-label="Watchlist onboarding steps">
        {setupSteps.map((step, index) => (
          <article className="card" key={step.title}>
            <span className="badge">Step {index + 1}</span>
            <h3 style={{ marginTop: 12 }}>{step.title}</h3>
            <p>{step.body}</p>
          </article>
        ))}
      </section>

      {!savedItems.length ? (
        <section className="card" aria-label="Empty watchlist preview note" style={{ marginTop: 16 }}>
          <h2>No saved watchlist items yet</h2>
          <p className="muted">
            The examples below are labelled as previews. They are not real user data and are only here
            to show how a future watchlist will look after onboarding.
          </p>
        </section>
      ) : null}

      <div className="grid two" style={{ marginTop: 16 }}>
        {items.map((item) => (
          <article className="card" key={item.ticker}>
            <div className="ledger-header">
              <div>
                <span className="badge">{item.ticker}</span>
                <h3 style={{ marginTop: 12 }}>{item.company}</h3>
                <p style={{ margin: 0 }}>{item.sectorTheme}</p>
              </div>
              <span className="badge status-received">{savedItems.length ? "Saved preview" : "Preview sample"}</span>
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
