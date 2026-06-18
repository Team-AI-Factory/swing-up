const sourceGroups = [
  {
    name: "SEC EDGAR",
    category: "Official company filings",
    usedFor: "Filings, 8-K, 10-Q, 10-K, Form 4 activity, insider and institutional ownership filings, amendments, and issuer disclosures.",
    whyItMatters: "Company filings are primary records. They help Swing Up connect an alert to disclosed events, risks, leadership actions, capital structure changes, and reported business performance.",
    receiptUse: "Receipts should point users back to the filing or filing metadata so they can check what changed before trusting the alert context.",
  },
  {
    name: "FMP",
    category: "Market and fundamentals data",
    usedFor: "Prices, fundamentals, analyst targets, earnings calendars, earnings history, company reference data, and transcripts.",
    whyItMatters: "Structured market data helps compare a catalyst with valuation, price movement, analyst context, earnings timing, and company fundamentals.",
    receiptUse: "Receipts should show which market or fundamentals field supported the alert and whether the data looked current when reviewed.",
  },
  {
    name: "GDELT",
    category: "Global news and events",
    usedFor: "Global news, politics, war, civil events, country-level events, local developments, themes, entities, and geographic event context.",
    whyItMatters: "Broad event coverage helps Swing Up notice macro, geopolitical, regional, and sector narratives that may affect companies or investor attention.",
    receiptUse: "Receipts should help users distinguish a real event cluster from duplicated, noisy, translated, or weakly related coverage.",
  },
  {
    name: "FRED",
    category: "Macroeconomic background",
    usedFor: "Rates, inflation, unemployment, GDP, credit, liquidity, housing, production, and broader economic backdrop data.",
    whyItMatters: "Macro context can change how a signal is interpreted by showing whether the environment supports or pressures a sector, factor, or company setup.",
    receiptUse: "Receipts should identify the macro series used as context and make clear when the series is lagging or revised.",
  },
  {
    name: "CoinGecko",
    category: "Crypto market data",
    usedFor: "Crypto prices, market capitalization, volume, token metadata, and digital-asset market context.",
    whyItMatters: "Crypto conditions can matter for token-related equities, miners, exchanges, fintech companies, and wider risk appetite.",
    receiptUse: "Receipts should show the crypto market data behind the context without turning volatility into a trading instruction.",
  },
  {
    name: "Frankfurter",
    category: "Foreign exchange rates",
    usedFor: "FX reference rates for major currencies and currency comparison context.",
    whyItMatters: "Currency moves can affect multinational revenue, input costs, imported goods, commodities, international comparisons, and foreign-market exposure.",
    receiptUse: "Receipts should state the reference rate context and avoid implying it is an executable trading price.",
  },
  {
    name: "Google News RSS",
    category: "Backup news source",
    usedFor: "Search-based news feeds for companies, tickers, sectors, themes, and market-moving topics when backup coverage is needed.",
    whyItMatters: "A backup news source can surface fresh reporting or cross-check that a topic is visible outside a single data provider.",
    receiptUse: "Receipts should help users inspect the article trail and spot stale posts, duplicates, or low-quality matches.",
  },
  {
    name: "openFDA",
    category: "FDA and biotech events",
    usedFor: "FDA-related drug, device, food, safety, recall, enforcement, and adverse-event data relevant to healthcare companies.",
    whyItMatters: "Regulatory and safety events can be important context for biotech, pharma, medical device, and consumer health alerts.",
    receiptUse: "Receipts should preserve the regulatory event trail while noting that reports may require expert review.",
  },
  {
    name: "ClinicalTrials.gov",
    category: "Clinical-trial updates",
    usedFor: "Trial statuses, phases, enrollment details, study changes, completion timing, sponsor details, and reported results.",
    whyItMatters: "Trial updates can be major healthcare catalysts and can change how investors understand a company pipeline.",
    receiptUse: "Receipts should connect an alert to the trial record and make clear that clinical interpretation may still be needed.",
  },
  {
    name: "Telegram bot",
    category: "Future alert delivery",
    usedFor: "Future outbound alert delivery for users who choose chat-based notifications.",
    whyItMatters: "Delivery channels can help users receive reviewed alerts, but they must not create hype or replace source checking.",
    receiptUse: "Receipts should travel with alerts so users can inspect why the alert exists before acting on it.",
  },
  {
    name: "Payment webhooks",
    category: "Subscription status",
    usedFor: "Subscription state changes, payment access events, account entitlement updates, and billing status sync.",
    whyItMatters: "Payment events help keep access control separate from research logic and signal quality decisions.",
    receiptUse: "Payment receipts explain account access, not market evidence or alert quality.",
  },
];

const sourceHealthStatuses = [
  {
    name: "Working",
    meaning: "The source responded recently and can be considered available for evidence collection.",
  },
  {
    name: "Broken",
    meaning: "The source failed or returned unusable data, so Swing Up should clearly show the issue before relying on it.",
  },
  {
    name: "Missing key",
    meaning: "The source needs a credential or configuration value that is not present in the environment.",
  },
  {
    name: "Rate-limited",
    meaning: "The source is temporarily limiting requests, so Swing Up should slow down and avoid treating missing data as proof nothing happened.",
  },
  {
    name: "Slow",
    meaning: "The source is responding, but latency is high enough that users should know the evidence may arrive late.",
  },
  {
    name: "Disabled",
    meaning: "The source is intentionally turned off and should not be used until it is enabled again.",
  },
];

export default function SourcesPage() {
  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Source dictionary</div>
          <h1>What Swing Up listens to, and why source health matters</h1>
          <p>
            Swing Up uses source checks and receipts to explain the evidence behind alerts. Sources help Swing Up collect evidence, but no source guarantees an investment result.
          </p>
        </div>
        <article className="card risk-callout">
          <span className="badge">Evidence-first</span>
          <h2>Show source condition before trust</h2>
          <p>
            If a source is broken or rate-limited, Swing Up should show that clearly before relying on it. Receipts are used to help users check why an alert exists.
          </p>
        </article>
      </section>

      <section className="trust-section card">
        <span className="badge">Dictionary</span>
        <h2>Public data sources</h2>
        <p>
          This page is a standalone public reference. It does not call backend services, require database data, or change Source Health behavior.
        </p>
        <div className="grid two">
          {sourceGroups.map((source) => (
            <article className="metric" key={source.name}>
              <span>{source.category}</span>
              <strong>{source.name}</strong>
              <p>{source.usedFor}</p>
              <p>{source.whyItMatters}</p>
              <p>{source.receiptUse}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="grid two trust-section">
        <article className="card">
          <span className="badge">Health states</span>
          <h2>What Source Health statuses mean</h2>
          <p>
            Status labels help users see when evidence collection is available, degraded, or intentionally unavailable before an alert depends on that source.
          </p>
          {sourceHealthStatuses.map((status) => (
            <div className="metric" key={status.name}>
              <span>{status.name}</span>
              <strong>{status.meaning}</strong>
            </div>
          ))}
        </article>

        <article className="card risk-callout">
          <span className="badge">Calm usage</span>
          <h2>Receipts support review</h2>
          <p>
            A receipt is not a prediction. It is a trail that helps a user inspect the source, timing, and reason an alert exists.
          </p>
          <p>
            Source diversity can improve context, but market outcomes can still move against the evidence, arrive late, or depend on facts outside the data feed.
          </p>
        </article>
      </section>
    </div>
  );
}
