const vendors = [
  {
    name: "SEC EDGAR",
    status: "Live",
    usedFor: "Official company filings, amendments, ownership disclosures, and event reports from public issuers.",
    matters: "Filings are primary-source evidence for material business changes, risks, dilution, insider activity, and regulated disclosures.",
    notCover: "It does not provide real-time prices, complete news context, analyst interpretation, or a guarantee that a filing is market-moving.",
  },
  {
    name: "GDELT",
    status: "Live",
    usedFor: "Broad public news and event monitoring across global media themes, entities, countries, and narratives.",
    matters: "Wide coverage helps Swing Up notice macro, geopolitical, sector, and company narratives before relying on narrower paid feeds.",
    notCover: "It does not remove all duplicates, verify every article, map every story to a ticker, or replace source-quality review.",
  },
  {
    name: "CoinGecko",
    status: "Planned",
    usedFor: "Crypto prices, market capitalization, volume, token metadata, and digital-asset market context.",
    matters: "Crypto conditions can affect miners, exchanges, fintech companies, risk appetite, and token-linked equity narratives.",
    notCover: "It does not cover traditional equities, official filings, fiat macro releases, or investment suitability for crypto assets.",
  },
  {
    name: "FRED",
    status: "Planned",
    usedFor: "Economic series such as rates, inflation, employment, credit, housing, production, and liquidity indicators.",
    matters: "Macro context helps explain whether a company or sector signal is supported or pressured by the broader environment.",
    notCover: "It does not provide company-specific catalysts, tick-by-tick market data, unrevised history, or personal portfolio guidance.",
  },
  {
    name: "Frankfurter FX",
    status: "Planned",
    usedFor: "Reference foreign-exchange rates for major currencies used in currency context and international comparisons.",
    matters: "FX moves can affect multinational revenue, input costs, commodity comparisons, and cross-border investor expectations.",
    notCover: "It does not provide executable trading rates, deep intraday FX microstructure, or complete emerging-market currency coverage.",
  },
  {
    name: "Polygon/Massive",
    status: "Key needed",
    usedFor: "Professional market data such as prices, aggregates, reference data, and market-structure inputs when configured.",
    matters: "A stronger market-data layer can improve price context, liquidity checks, and post-alert outcome measurement.",
    notCover: "It does not replace official filings, qualitative news review, macro interpretation, or paid-vendor terms and limits.",
  },
  {
    name: "Benzinga",
    status: "Paid later",
    usedFor: "Professional market news, calendars, headlines, analyst items, and faster structured event context when a paid plan is justified.",
    matters: "Paid news sources can reduce latency and add structured context for events that public feeds may surface slowly or noisily.",
    notCover: "It does not guarantee that headlines are actionable, complete, or sufficient without receipts, filtering, and risk review.",
  },
  {
    name: "Finnhub",
    status: "Key needed",
    usedFor: "Market data, company metrics, financial statements, earnings data, estimates, and selected news endpoints when configured.",
    matters: "It can add structured fundamentals and event context that complements filings, public news, and price data.",
    notCover: "It does not replace original filings, cover every asset class equally, or remove the need to check vendor licensing and limits.",
  },
  {
    name: "Yahoo backup",
    status: "Backup",
    usedFor: "Fallback public market context for quote checks, basic price history, and sanity checks when primary feeds are unavailable.",
    matters: "A backup source helps avoid a single point of failure when validating broad market context or investigating source outages.",
    notCover: "It does not serve as the primary professional feed, guarantee completeness, or replace licensed data for production-grade use.",
  },
];

const statusClassNames: Record<string, string> = {
  Live: "status-connected",
  Planned: "status-stubbed",
  "Key needed": "status-not_configured",
  "Paid later": "outcome-unknown",
  Backup: "status-stubbed",
};

const disclaimer =
  "Swing Up provides market research and decision-support information. It does not guarantee returns. Investing involves risk, including possible loss of capital. Users are responsible for their own decisions.";

export default function DataStackPage() {
  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Planned vendor stack</div>
          <h1>Swing Up Data Stack</h1>
          <p>
            Swing Up combines official filings, market data, financial news, macro data, crypto data, and AI review.
          </p>
        </div>
        <div className="card risk-callout">
          <span className="badge">Design principle</span>
          <h2>Receipts before conclusions</h2>
          <p>
            The stack is designed to compare multiple evidence types before research is surfaced, so no single vendor becomes the whole story.
          </p>
        </div>
      </section>

      <section className="grid two trust-section">
        {vendors.map((vendor) => (
          <article className="card" key={vendor.name}>
            <span className="badge">Vendor</span>
            <h3>{vendor.name}</h3>
            <div className="metric">
              <span>Current status</span>
              <strong>
                <span className={`badge ${statusClassNames[vendor.status]}`}>{vendor.status}</span>
              </strong>
            </div>
            <div className="metric">
              <span>Used for</span>
              <strong>{vendor.usedFor}</strong>
            </div>
            <div className="metric">
              <span>Why it matters</span>
              <strong>{vendor.matters}</strong>
            </div>
            <div className="metric">
              <span>What it does not cover</span>
              <strong>{vendor.notCover}</strong>
            </div>
          </article>
        ))}
      </section>

      <section className="grid two trust-section">
        <article className="card">
          <span className="badge">Source mix</span>
          <h2>Free public sources vs professional paid sources</h2>
          <p>
            Free public sources are useful for transparent receipts, official records, broad discovery, and early validation. Professional paid sources may later add speed, structure, cleaner licensing, deeper market data, and stronger reliability for production workflows.
          </p>
          <p>
            Swing Up starts with public and no-paid-call sources where possible, then reserves paid vendors for areas where they clearly improve coverage, latency, or quality.
          </p>
        </article>
        <article className="card">
          <span className="badge">Reliability</span>
          <h2>Why Swing Up does not rely on one data source</h2>
          <p>
            One source can be delayed, noisy, incomplete, rate-limited, unavailable, or wrong for a specific asset class. A diversified data stack lets Swing Up compare filings, prices, news, macro context, crypto conditions, and backup feeds before treating a signal as meaningful.
          </p>
          <p>
            Multiple sources also make it easier to show receipts, identify contradictions, and explain what evidence is missing.
          </p>
        </article>
      </section>

      <section className="trust-section">
        <div className="card risk-callout">
          <span className="badge">Important disclaimer</span>
          <h2>Research support, not a promise of returns</h2>
          <p>{disclaimer}</p>
        </div>
      </section>
    </div>
  );
}
