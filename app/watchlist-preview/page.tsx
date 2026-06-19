const watchlistConcepts = [
  {
    title: "What a watchlist is",
    body: "A watchlist is planned as a calm research space where users may keep track of companies, sectors, themes, and preferences they want Swing Up to monitor more closely later.",
    examples: ["Tickers", "Sectors", "Themes"],
  },
  {
    title: "How users may follow tickers later",
    body: "Users may eventually choose individual tickers they care about so future research alerts can emphasize relevant receipts, catalysts, risk checks, and pattern changes.",
    examples: ["Company-specific signals", "Receipt-backed updates", "Noise-filtered research context"],
  },
  {
    title: "How users may follow sectors later",
    body: "Sector following may help users review broader movements without adding every company one by one. This could support themes such as semiconductors, healthcare, energy, or digital advertising.",
    examples: ["Sector momentum", "Peer context", "Industry-level risk"],
  },
  {
    title: "How risk preference may affect alerts later",
    body: "Risk preference may help tune how aggressively Swing Up surfaces research notifications. A lower-risk preference may emphasize stronger evidence and calmer setups, while a higher-risk preference may include more volatile ideas.",
    examples: ["Risk level preference", "Evidence threshold", "Volatility awareness"],
  },
  {
    title: "How subscription tier may affect access later",
    body: "Subscription tier may eventually affect timing, depth, and access to watchlist-related research. This page does not activate paid access or connect to billing.",
    examples: ["Delayed previews", "Expanded summaries", "Advanced filters later"],
  },
  {
    title: "How notification preferences may work later",
    body: "Notification preferences may allow users to choose how often they want research support, which delivery channels they prefer, and whether they want urgent alerts or quieter digests.",
    examples: ["Alert action preference", "Delivery channel preference", "Daily or weekly summaries"],
  },
  {
    title: "Why not every signal becomes a user alert",
    body: "Signals may be rejected when they are stale, vague, duplicated, weakly sourced, already priced in, or not relevant to a user's chosen watch areas.",
    examples: ["Source quality", "Freshness", "User relevance"],
  },
  {
    title: "Research support, not trade instructions",
    body: "Watchlist alerts are planned as research notifications, not trade instructions. Users are responsible for their own decisions.",
    examples: ["Review the evidence", "Consider personal risk", "Do independent research"],
  },
];

const watchlistCategories = [
  "Tickers",
  "Sectors",
  "Themes",
  "Risk level preference",
  "Alert action preference",
  "Asset type",
  "Delivery channel preference",
];

export default function WatchlistPreviewPage() {
  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Watchlist preview</div>
          <h1>A calm preview of future watchlist alerts.</h1>
          <p>
            This standalone page explains how Swing Up may later help users follow markets they
            care about without creating real watchlists, sending notifications, requiring login,
            or using database data.
          </p>
        </div>
        <article className="card risk-callout">
          <span className="badge">Planned feature</span>
          <h2 style={{ marginTop: 14 }}>Research notifications only</h2>
          <p>
            Watchlist alerts are planned as research notifications, not trade instructions. Users
            are responsible for their own decisions.
          </p>
        </article>
      </section>

      <section className="grid two trust-section" aria-label="Watchlist alert concepts">
        {watchlistConcepts.map((concept, index) => (
          <article className="card" key={concept.title}>
            <span className="badge">Preview {index + 1}</span>
            <h2 style={{ marginTop: 14 }}>{concept.title}</h2>
            <p>{concept.body}</p>
            <ul className="receipts">
              {concept.examples.map((example) => (
                <li key={example}>{example}</li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      <section className="grid two trust-section" aria-label="Watchlist preview categories and disclaimer">
        <article className="card">
          <span className="badge">Example categories</span>
          <h2 style={{ marginTop: 14 }}>What users may organize later</h2>
          <p>
            These are static examples only. They do not save preferences, trigger alerts, or change
            any account settings.
          </p>
          <ul className="receipts">
            {watchlistCategories.map((category) => (
              <li key={category}>{category}</li>
            ))}
          </ul>
        </article>

        <article className="card risk-callout">
          <span className="badge">Important</span>
          <h2 style={{ marginTop: 14 }}>Decision support has limits</h2>
          <p>
            A future watchlist may help prioritize research, but it will not know a user&apos;s full
            financial situation, timing needs, tax concerns, or personal risk tolerance.
          </p>
          <p>
            Watchlist alerts are planned as research notifications, not trade instructions. Users
            are responsible for their own decisions.
          </p>
        </article>
      </section>
    </div>
  );
}
