const sources = [
  {
    name: "Database",
    category: "Core infrastructure",
    watches: "Stored application records, source status rows, saved signals, and review metadata created inside Swing Up.",
    matters: "It gives the product a stable place to keep receipts, review states, and outcome history instead of relying on memory or chat logs.",
    stage: "Live",
    risk: "A live database only means Swing Up can store internal records. It does not prove that outside sources are connected or that stored signals are useful.",
  },
  {
    name: "SEC EDGAR",
    category: "Company filings",
    watches: "Public filings such as annual reports, quarterly reports, current reports, registration statements, and ownership disclosures.",
    matters: "Filings can reveal material company changes, risk factors, guidance updates, dilution, insider activity, and events that may affect a setup.",
    stage: "Stubbed",
    risk: "Filings can be long, delayed, amended, or easy to misread without careful review and source receipts.",
  },
  {
    name: "FMP",
    category: "Market data",
    watches: "Planned market data such as prices, financial statements, ratios, earnings calendars, and company reference data.",
    matters: "Structured market and fundamentals data can help compare a signal with valuation, price action, and company context.",
    stage: "Not configured",
    risk: "Market data can be delayed, rate-limited, incomplete, or subject to vendor terms. It is not connected here.",
  },
  {
    name: "GDELT",
    category: "Global news and events",
    watches: "Broad media coverage, event themes, entities, geography, and news momentum across public reporting.",
    matters: "Wide event coverage can help detect macro, geopolitical, sector, and company narratives that may affect investor attention.",
    stage: "Stubbed",
    risk: "Large news datasets can be noisy, duplicated, mistranslated, or weakly related to a ticker without filtering.",
  },
  {
    name: "FRED",
    category: "Macro data",
    watches: "Economic series such as rates, inflation, employment, credit, housing, production, and other macro indicators.",
    matters: "Macro conditions can shape sector risk, liquidity, expectations, and whether a company signal has a supportive or difficult backdrop.",
    stage: "Not configured",
    risk: "Macro data is often revised, lagging, and not automatically tied to a specific trade idea. It is not connected here.",
  },
  {
    name: "openFDA",
    category: "Healthcare safety data",
    watches: "Drug, device, food, and adverse-event datasets published through FDA-backed public data services.",
    matters: "Healthcare safety and regulatory signals can affect biotech, pharma, medical device, and consumer health companies.",
    stage: "Stubbed",
    risk: "Reports can be incomplete, duplicated, unverified, or not evidence of causation without expert review.",
  },
  {
    name: "ClinicalTrials.gov",
    category: "Clinical research",
    watches: "Trial registrations, statuses, phases, enrollment details, study updates, and reported results.",
    matters: "Trial progress and results can be important catalysts for healthcare companies and related sectors.",
    stage: "Stubbed",
    risk: "Trial records may lag, omit market context, or require clinical interpretation before they are useful.",
  },
  {
    name: "Google News RSS",
    category: "News monitoring",
    watches: "Search-based news feeds for companies, tickers, sectors, themes, and market-moving topics.",
    matters: "News feeds can surface fresh reporting and provide receipts for why a topic is receiving attention.",
    stage: "Stubbed",
    risk: "RSS results can include duplicates, low-quality articles, stale posts, or stories that are already priced in.",
  },
  {
    name: "CoinGecko",
    category: "Crypto market data",
    watches: "Crypto asset prices, market capitalization, volume, token metadata, and broad digital-asset market context.",
    matters: "Crypto conditions can matter for token-related equities, miners, exchanges, fintech companies, and risk appetite.",
    stage: "Stubbed",
    risk: "Crypto markets are volatile, fragmented, and can move quickly. A crypto signal is not a recommendation.",
  },
  {
    name: "Frankfurter FX",
    category: "Foreign exchange",
    watches: "Reference foreign-exchange rates for major currencies.",
    matters: "Currency moves can affect multinational revenue, input costs, imported goods, commodities, and international comparisons.",
    stage: "Stubbed",
    risk: "Reference rates may not match executable rates and may not capture intraday currency moves.",
  },
  {
    name: "AI Committee",
    category: "Review workflow",
    watches: "Planned multi-step review of evidence quality, risks, priced-in context, and competing interpretations.",
    matters: "A separate review layer can help slow down weak ideas before they become user-facing research alerts.",
    stage: "Stubbed",
    risk: "No real AI calls are made here. Future AI output would still require guardrails, evidence checks, and human-readable reasoning.",
  },
  {
    name: "Telegram",
    category: "Notifications",
    watches: "Planned outbound alert delivery to users who choose notification workflows.",
    matters: "Notifications may eventually help users receive reviewed alerts without constantly checking the app.",
    stage: "Not configured",
    risk: "Notification logic is not connected here. Delivery channels can create urgency, so alerts must remain careful and non-hype.",
  },
  {
    name: "Stripe Managed Payments",
    category: "Payments",
    watches: "Planned subscription and payment status events for managed access control.",
    matters: "Payments may later support paid plans while keeping billing separate from research logic.",
    stage: "Later",
    risk: "No payment logic is included here. Billing systems must not imply better outcomes or guaranteed market performance.",
  },
];

const alertSteps = [
  "Source Health checks whether a source is working.",
  "Raw Signal Store saves incoming signals.",
  "Signal Filter removes weak/noisy signals.",
  "Historical Event Library compares against past examples.",
  "Scoring and AI review happen later.",
  "Public Ledger tracks outcomes.",
];

const stageClassNames: Record<string, string> = {
  Live: "status-connected",
  Stubbed: "status-stubbed",
  "Not configured": "status-not_configured",
  Later: "outcome-unknown",
};

export default function DataSourcesPage() {
  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Signal inputs</div>
          <h1>Data Sources Directory</h1>
          <p>
            Swing Up watches many types of market signals, but each source is checked, labelled, and reviewed before it can influence an alert.
          </p>
        </div>
        <div className="card risk-callout">
          <span className="badge">Safety boundary</span>
          <h2>Connected does not mean published</h2>
          <p>
            A source being connected does not mean every signal becomes an alert. Swing Up filters, scores, checks evidence, and tracks outcomes.
          </p>
        </div>
      </section>

      <section className="grid two trust-section">
        {sources.map((source) => (
          <article className="card" key={source.name}>
            <span className="badge">{source.category}</span>
            <h3>{source.name}</h3>
            <div className="metric">
              <span>Current connection stage</span>
              <strong>
                <span className={`badge ${stageClassNames[source.stage]}`}>{source.stage}</span>
              </strong>
            </div>
            <div className="metric">
              <span>What it watches</span>
              <strong>{source.watches}</strong>
            </div>
            <div className="metric">
              <span>Why it matters</span>
              <strong>{source.matters}</strong>
            </div>
            <div className="metric">
              <span>Risk / limitation</span>
              <strong>{source.risk}</strong>
            </div>
          </article>
        ))}
      </section>

      <section className="grid two trust-section">
        <div className="card methodology-flow">
          <span className="badge">Process</span>
          <h2>How sources become alerts</h2>
          {alertSteps.map((step, index) => (
            <div className="metric" key={step}>
              <span>Step {index + 1}</span>
              <strong>{step}</strong>
            </div>
          ))}
        </div>
        <div className="card risk-callout">
          <span className="badge">No investment advice</span>
          <h2>Review before action</h2>
          <p>
            Swing Up is designed for research support. It does not guarantee returns, predict outcomes, or replace a user&apos;s own judgement and risk review.
          </p>
        </div>
      </section>
    </div>
  );
}
