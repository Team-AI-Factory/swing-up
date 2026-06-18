const plannedVendors = [
  {
    name: "Polygon/Massive",
    role: "Core",
    gives: "Live prices, market breadth, reference data, and stock snapshots for equity context.",
    matters: "Early alerts need current price, liquidity, and breadth checks so a signal can be compared against live market behavior.",
    doesNotSolve: "It does not explain why a move is happening, replace filings or news receipts, or guarantee that a price move is actionable.",
  },
  {
    name: "Benzinga",
    role: "Core",
    gives: "Breaking finance news, transcripts, events, analyst news, and structured market headlines.",
    matters: "Fast professional news can reduce alert latency and add event context when public feeds are too broad, delayed, or noisy.",
    doesNotSolve: "It does not prove a headline is complete, remove the need for source checks, or determine whether a user should trade.",
  },
  {
    name: "Finnhub",
    role: "Core",
    gives: "Earnings context, analyst targets, fundamentals, insider data, and company-level market intelligence.",
    matters: "Structured fundamentals and analyst data help distinguish one-off headlines from events that may affect valuation or expectations.",
    doesNotSolve: "It does not replace official filings, cover every data point equally, or remove licensing, freshness, and limits review.",
  },
  {
    name: "CoinGecko",
    role: "Support",
    gives: "Crypto prices, token context, market capitalization, and digital-asset market movement.",
    matters: "Crypto conditions can influence miners, exchanges, fintech names, risk appetite, and token-linked equity narratives.",
    doesNotSolve: "It does not cover equity fundamentals, official company disclosures, or the suitability of any crypto exposure.",
  },
  {
    name: "FRED",
    role: "Support",
    gives: "Macro data such as rates, inflation, employment, credit, housing, production, and liquidity series.",
    matters: "Macro context helps decide whether a company or sector signal is supported or pressured by the broader economy.",
    doesNotSolve: "It does not provide real-time company catalysts, tick-level prices, or unrevised forward-looking certainty.",
  },
  {
    name: "Frankfurter FX",
    role: "Support",
    gives: "Currency context and reference foreign-exchange rates for major currencies.",
    matters: "FX changes can affect multinational revenue, input costs, commodity comparisons, and international investor expectations.",
    doesNotSolve: "It does not provide executable trading rates, deep intraday FX detail, or complete emerging-market coverage.",
  },
  {
    name: "SEC EDGAR",
    role: "Core",
    gives: "Official filings, amendments, ownership disclosures, and regulated company event reports.",
    matters: "Filings are primary-source receipts for material company changes, risks, dilution, insider activity, and disclosures.",
    doesNotSolve: "It does not provide live prices, complete market reaction, analyst interpretation, or all off-filing news context.",
  },
  {
    name: "GDELT",
    role: "Support",
    gives: "Broad public news radar across global media, entities, themes, geographies, and narratives.",
    matters: "Wide public coverage helps Swing Up hear early macro, geopolitical, sector, and company stories before narrowing the evidence.",
    doesNotSolve: "It does not remove every duplicate, verify every article, map every story to a ticker, or replace professional news feeds.",
  },
  {
    name: "Yahoo",
    role: "Backup",
    gives: "Fallback quote checks, basic price history, and broad sanity checks when primary sources are unavailable.",
    matters: "A backup source helps reduce single-source dependency during outages, investigations, and quick market context checks.",
    doesNotSolve: "It does not provide the licensed, reliable, production-grade core feed needed for professional alert workflows.",
  },
];

const roleClassNames: Record<string, string> = {
  Core: "status-connected",
  Support: "status-stubbed",
  Backup: "outcome-unknown",
};

const buildOrder = [
  "Free public ears first",
  "Rule filtering",
  "Paid price/news feeds",
  "Market sentiment layer",
  "AI review",
  "Final alerts",
  "Payment system last",
];

const disclaimer =
  "Swing Up provides market research and decision-support information. It does not guarantee returns. Investing involves risk, including possible loss of capital. Users are responsible for their own decisions.";

export default function PaidDataPlanPage() {
  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Internal planning page</div>
          <h1>Swing Up Paid Data Upgrade Plan</h1>
          <p>
            Free public sources help build the radar, but professional alerts need professional market data and financial news.
          </p>
        </div>
        <div className="card risk-callout">
          <span className="badge">Upgrade path</span>
          <h2>Public ears first, paid precision later</h2>
          <p>
            This plan keeps the current product grounded in transparent sources while showing where paid vendors can improve speed,
            structure, and confidence before production-grade alerts are monetized.
          </p>
        </div>
      </section>

      <section className="grid two trust-section">
        {plannedVendors.map((vendor) => (
          <article className="card" key={vendor.name}>
            <span className="badge">Planned vendor</span>
            <h3>{vendor.name}</h3>
            <div className="metric">
              <span>Role</span>
              <strong>
                <span className={`badge ${roleClassNames[vendor.role]}`}>{vendor.role}</span>
              </strong>
            </div>
            <div className="metric">
              <span>What it gives Swing Up</span>
              <strong>{vendor.gives}</strong>
            </div>
            <div className="metric">
              <span>Why it matters</span>
              <strong>{vendor.matters}</strong>
            </div>
            <div className="metric">
              <span>What it does not solve</span>
              <strong>{vendor.doesNotSolve}</strong>
            </div>
          </article>
        ))}
      </section>

      <section className="grid two trust-section">
        <article className="card">
          <span className="badge">Backup policy</span>
          <h2>Why Yahoo is backup, not the core</h2>
          <p>
            Yahoo is useful as a broad fallback for sanity checks, quick comparisons, and outage investigations. It should not be the
            central source for professional alerting because Swing Up needs dependable licensing, predictable reliability, structured
            coverage, and clean production workflows for paid alert products.
          </p>
        </article>
        <article className="card">
          <span className="badge">Alert quality</span>
          <h2>Why paid data matters for early alerts</h2>
          <p>
            Early alerts depend on speed, clean structure, and corroboration. Paid price and news feeds can improve latency, market
            context, event classification, and confidence checks before a signal becomes a final user-facing alert.
          </p>
        </article>
      </section>

      <section className="grid two trust-section">
        <article className="card">
          <span className="badge">Sequence</span>
          <h2>Build order</h2>
          <ol className="receipts">
            {buildOrder.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </article>
        <article className="card risk-callout">
          <span className="badge">Important disclaimer</span>
          <h2>Research support, not a promise of returns</h2>
          <p>{disclaimer}</p>
        </article>
      </section>
    </div>
  );
}
