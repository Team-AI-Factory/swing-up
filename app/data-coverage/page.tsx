const coverageGroups = [
  {
    group: "Filings and disclosures",
    description: "Official company records that can provide primary-source receipts for material events, risks, ownership changes, and corporate updates.",
    sources: [
      {
        name: "SEC EDGAR",
        detects: "Annual reports, quarterly reports, current reports, registration statements, amendments, and ownership disclosures.",
        matters: "Filings are regulated, primary-source evidence that can confirm whether a company event is real instead of just repeated in headlines.",
        signal: "8-K event filing, S-3 registration, 10-Q risk-factor update, Form 4 ownership change.",
        status: "live",
      },
    ],
  },
  {
    group: "Market prices",
    description: "Price and volume context used to compare evidence with market reaction, liquidity, trend, and post-signal outcome tracking.",
    sources: [
      {
        name: "FMP",
        detects: "Equity quotes, price history, volume, company reference data, calendars, and market snapshots when configured.",
        matters: "Market data helps Swing Up separate a documented event from the way investors are actually pricing that event.",
        signal: "Unusual volume after a filing, gap move around earnings, price confirmation or contradiction.",
        status: "planned",
      },
    ],
  },
  {
    group: "Fundamentals",
    description: "Structured company context that can help explain valuation, balance-sheet pressure, profitability, growth, and operating quality.",
    sources: [
      {
        name: "FMP",
        detects: "Financial statements, ratios, company profiles, earnings context, and reference fundamentals when configured.",
        matters: "Fundamentals help keep a catalyst grounded in company quality, financial risk, and comparable historical context.",
        signal: "Revenue acceleration, margin pressure, dilution risk, debt load, earnings-date context.",
        status: "planned",
      },
    ],
  },
  {
    group: "Macro data",
    description: "Economic background that can affect sectors, rates, credit, liquidity, inflation sensitivity, and investor appetite for risk.",
    sources: [
      {
        name: "FRED",
        detects: "Rates, inflation, employment, credit, housing, industrial production, and other public economic time series.",
        matters: "Macro context can explain whether a company signal is supported or pressured by the broader environment.",
        signal: "Rate-sensitive sector pressure, inflation backdrop, credit stress, labor-market context.",
        status: "live",
      },
    ],
  },
  {
    group: "Global news",
    description: "Public reporting and event discovery used for receipts, narrative momentum, geopolitical context, and sector awareness.",
    sources: [
      {
        name: "GDELT",
        detects: "Global media coverage, event themes, entities, locations, tone, and broad narrative movement.",
        matters: "A wide public-news radar can surface emerging narratives that narrower company feeds may miss.",
        signal: "Rising geopolitical coverage, sector-specific media spike, company narrative acceleration.",
        status: "live",
      },
      {
        name: "Google News RSS",
        detects: "Search-based news feeds for companies, tickers, industries, executives, products, and market-moving topics.",
        matters: "RSS receipts can help show users where a story came from and whether multiple outlets are discussing it.",
        signal: "Fresh headline cluster, topic-specific article receipt, follow-up coverage after an official event.",
        status: "backup",
      },
    ],
  },
  {
    group: "Crypto data",
    description: "Digital-asset market context for crypto-linked equities, miners, exchanges, fintech names, and broader risk appetite.",
    sources: [
      {
        name: "CoinGecko",
        detects: "Token prices, market capitalization, volume, asset metadata, and broad crypto-market movement.",
        matters: "Crypto conditions can influence related public companies and can also reflect speculative risk appetite.",
        signal: "Bitcoin or Ethereum move affecting miners, exchange-linked sentiment, token-volume surge.",
        status: "live",
      },
    ],
  },
  {
    group: "FX data",
    description: "Reference currency context for multinational companies, commodities, imported inputs, and cross-border comparisons.",
    sources: [
      {
        name: "Frankfurter",
        detects: "Reference foreign-exchange rates for major currencies and historical exchange-rate comparisons.",
        matters: "FX moves can affect reported revenue, input costs, international demand, and translation effects.",
        signal: "Dollar strength pressure, EUR/USD context, currency translation risk for multinationals.",
        status: "live",
      },
    ],
  },
  {
    group: "Biotech and FDA data",
    description: "Healthcare-specific regulatory and clinical research context for biotech, pharma, medical device, and health-product names.",
    sources: [
      {
        name: "openFDA",
        detects: "Drug, device, food, recall, enforcement, adverse-event, and other FDA-backed public datasets.",
        matters: "Safety and regulatory records can be important evidence for healthcare catalysts and risk review.",
        signal: "Recall item, adverse-event pattern, enforcement notice, device safety context.",
        status: "live",
      },
      {
        name: "ClinicalTrials.gov",
        detects: "Trial registrations, phases, statuses, enrollment, sponsor updates, locations, and posted results.",
        matters: "Trial progress can be a major catalyst for healthcare companies, but it needs careful evidence handling.",
        signal: "Trial status change, Phase 2/3 update, enrollment completion, results posting.",
        status: "live",
      },
    ],
  },
  {
    group: "Historical pattern data",
    description: "Internal examples and public outcome records that help compare a new setup with past market behavior.",
    sources: [
      {
        name: "Swing Up historical event library",
        detects: "Prior catalyst examples, pattern notes, outcome records, and post-signal review context.",
        matters: "History can help identify whether a signal resembles a common false positive, delayed move, or stronger historical setup.",
        signal: "Similar filing pattern, comparable sector reaction, prior alert outcome, repeated failure mode.",
        status: "planned",
      },
    ],
  },
  {
    group: "Future notification channels",
    description: "Delivery channels that may eventually notify users after evidence has been collected, filtered, and reviewed.",
    sources: [
      {
        name: "Email alerts",
        detects: "Future outbound notifications for reviewed research events and watchlist updates.",
        matters: "Notifications may reduce the need to constantly check the app, but they must avoid creating false urgency.",
        signal: "Reviewed alert digest, watchlist update, source outage notice.",
        status: "future",
      },
      {
        name: "Telegram",
        detects: "Future opt-in mobile notifications for time-sensitive reviewed alerts.",
        matters: "Fast channels are useful only after evidence quality, risk labels, and user controls are in place.",
        signal: "Opt-in reviewed alert push, delivery confirmation, quiet-hours-safe update.",
        status: "future",
      },
    ],
  },
];

const statusClassNames: Record<string, string> = {
  live: "status-connected",
  planned: "status-stubbed",
  backup: "outcome-unknown",
  future: "status-not_configured",
};

const summaryStats = [
  { label: "Coverage groups", value: coverageGroups.length.toString() },
  { label: "Named sources", value: coverageGroups.reduce((count, group) => count + group.sources.length, 0).toString() },
  { label: "Live calls on this page", value: "0" },
];

export default function DataCoveragePage() {
  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Public data coverage</div>
          <h1>What Swing Up watches, and why</h1>
          <p>
            This standalone map explains the evidence sources Swing Up watches now, the areas planned for later, and what each source contributes to research review.
          </p>
        </div>
        <aside className="card risk-callout">
          <span className="badge">Evidence-first boundary</span>
          <h2>Sources collect evidence, not certainty</h2>
          <p>
            Data sources help Swing Up collect evidence. They do not guarantee investment outcomes, predict returns, or replace personal risk review.
          </p>
        </aside>
      </section>

      <section className="grid three trust-section">
        {summaryStats.map((stat) => (
          <article className="card" key={stat.label}>
            <span className="eyebrow">{stat.label}</span>
            <h2>{stat.value}</h2>
          </article>
        ))}
      </section>

      <section className="trust-section">
        {coverageGroups.map((group) => (
          <article className="card" key={group.group}>
            <span className="badge">Coverage area</span>
            <h2>{group.group}</h2>
            <p>{group.description}</p>
            <div className="grid two">
              {group.sources.map((source) => (
                <section className="metric" key={`${group.group}-${source.name}`}>
                  <div className="metric">
                    <span>Source</span>
                    <strong>{source.name}</strong>
                  </div>
                  <div className="metric">
                    <span>Status</span>
                    <strong>
                      <span className={`badge ${statusClassNames[source.status]}`}>{source.status}</span>
                    </strong>
                  </div>
                  <div className="metric">
                    <span>What it helps detect</span>
                    <strong>{source.detects}</strong>
                  </div>
                  <div className="metric">
                    <span>Why it matters</span>
                    <strong>{source.matters}</strong>
                  </div>
                  <div className="metric">
                    <span>Example signal type</span>
                    <strong>{source.signal}</strong>
                  </div>
                </section>
              ))}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
