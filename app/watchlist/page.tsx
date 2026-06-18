type WatchlistItem = {
  ticker: string;
  companyName: string;
  sector: string;
  watchReason: string;
  signalStatus: "Watching" | "New Signal" | "Quiet" | "High Noise" | "Needs Review";
  riskLabel: "Low" | "Medium" | "High" | "Extreme";
  alertPreference: string;
};

const watchlistItems: WatchlistItem[] = [
  {
    ticker: "AAPL",
    companyName: "Apple Inc.",
    sector: "Consumer Technology",
    watchReason: "Product cycles and services momentum",
    signalStatus: "Watching",
    riskLabel: "Low",
    alertPreference: "Priority alerts later",
  },
  {
    ticker: "NVDA",
    companyName: "NVIDIA Corporation",
    sector: "Semiconductors",
    watchReason: "AI infrastructure demand and supply checks",
    signalStatus: "New Signal",
    riskLabel: "High",
    alertPreference: "Signal digest later",
  },
  {
    ticker: "TSLA",
    companyName: "Tesla, Inc.",
    sector: "Electric Vehicles",
    watchReason: "Delivery trends, margins, and headline volatility",
    signalStatus: "High Noise",
    riskLabel: "Extreme",
    alertPreference: "Review-only alerts later",
  },
  {
    ticker: "MSFT",
    companyName: "Microsoft Corporation",
    sector: "Cloud Software",
    watchReason: "Cloud growth and enterprise AI adoption",
    signalStatus: "Watching",
    riskLabel: "Low",
    alertPreference: "Weekly summary later",
  },
  {
    ticker: "AMD",
    companyName: "Advanced Micro Devices, Inc.",
    sector: "Semiconductors",
    watchReason: "Data center chips and competitive positioning",
    signalStatus: "Needs Review",
    riskLabel: "Medium",
    alertPreference: "Threshold alerts later",
  },
  {
    ticker: "PLTR",
    companyName: "Palantir Technologies Inc.",
    sector: "Data Analytics",
    watchReason: "Government and commercial contract activity",
    signalStatus: "New Signal",
    riskLabel: "High",
    alertPreference: "Contract alerts later",
  },
  {
    ticker: "COIN",
    companyName: "Coinbase Global, Inc.",
    sector: "Crypto Infrastructure",
    watchReason: "Crypto market activity and regulatory signals",
    signalStatus: "High Noise",
    riskLabel: "Extreme",
    alertPreference: "Noise-filtered alerts later",
  },
  {
    ticker: "SMCI",
    companyName: "Super Micro Computer, Inc.",
    sector: "AI Servers",
    watchReason: "Server demand, margins, and supply-chain checks",
    signalStatus: "Needs Review",
    riskLabel: "High",
    alertPreference: "Source checks later",
  },
  {
    ticker: "LLY",
    companyName: "Eli Lilly and Company",
    sector: "Healthcare",
    watchReason: "Pipeline updates and demand indicators",
    signalStatus: "Quiet",
    riskLabel: "Medium",
    alertPreference: "Clinical update alerts later",
  },
  {
    ticker: "META",
    companyName: "Meta Platforms, Inc.",
    sector: "Digital Advertising",
    watchReason: "Ad demand and platform engagement patterns",
    signalStatus: "Watching",
    riskLabel: "Medium",
    alertPreference: "Pattern alerts later",
  },
];

const riskClassName: Record<WatchlistItem["riskLabel"], string> = {
  Low: "importance-low",
  Medium: "importance-medium",
  High: "importance-high",
  Extreme: "importance-critical",
};

const statusClassName: Record<WatchlistItem["signalStatus"], string> = {
  Watching: "status-received",
  "New Signal": "status-new",
  Quiet: "status-ignored",
  "High Noise": "status-failed",
  "Needs Review": "status-queued",
};

export default function WatchlistPage() {
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
        </div>
        <div className="card">
          <h2>Add tickers</h2>
          <p>
            Watchlist features are currently a preview. Real user accounts, saved preferences,
            and live alerts will be connected later.
          </p>
          <button className="button primary" type="button">Add ticker later</button>
        </div>
      </div>

      <div className="grid two">
        {watchlistItems.map((item) => (
          <article className="card" key={item.ticker}>
            <div className="ledger-header">
              <div>
                <span className="badge">{item.ticker}</span>
                <h3 style={{ marginTop: 12 }}>{item.companyName}</h3>
                <p style={{ margin: 0 }}>{item.sector}</p>
              </div>
              <span className={`badge ${statusClassName[item.signalStatus]}`}>{item.signalStatus}</span>
            </div>
            <div className="metric">
              <span>Watch reason</span>
              <strong>{item.watchReason}</strong>
            </div>
            <div className="metric">
              <span>Risk label</span>
              <strong className={`badge ${riskClassName[item.riskLabel]}`}>{item.riskLabel}</strong>
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
