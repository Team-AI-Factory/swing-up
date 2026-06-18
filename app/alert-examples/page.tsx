type ExampleAction = "Buy Candidate" | "Watch" | "Avoid";

type AlertExample = {
  action: ExampleAction;
  ticker: string;
  company: string;
  event: string;
  date: string;
  currentPrice: string;
  targetPriceRange: string;
  potentialMove: string;
  profitPotentialScore: string;
  evidenceConfidenceScore: string;
  riskLevel: string;
  pricedInCheck: string;
  historicalPatternMatch: string;
  marketSentimentImpact: string;
  whyThisMatters: string;
  whatCouldGoWrong: string[];
  sourceReceiptsPreview: string[];
  publicTrackingPreview: string;
};

const mockLabel = "Mock example only — not a real alert.";

const examples: AlertExample[] = [
  {
    action: "Buy Candidate",
    ticker: "MCKB",
    company: "Mock Cloud Kitchen Brands",
    event: "Mock same-store ordering data and delivery app rankings improved after a menu refresh.",
    date: "Preview date: July 8, 2026",
    currentPrice: "$42.10",
    targetPriceRange: "$46.00–$49.50",
    potentialMove: "+9.3% to +17.6% preview range",
    profitPotentialScore: "78 / 100",
    evidenceConfidenceScore: "72 / 100",
    riskLevel: "Medium",
    pricedInCheck: "Partially reflected in recent price strength; the mock evidence suggests revisions may still be incomplete.",
    historicalPatternMatch: "74% preview match to prior restaurant margin-recovery setups after traffic and app-rank evidence aligned.",
    marketSentimentImpact: "Constructive consumer discretionary tape, with moderate macro sensitivity from labor and food costs.",
    whyThisMatters: "The preview setup shows how Swing Up would connect operating evidence, revision risk, and price context before a public research label appears.",
    whatCouldGoWrong: [
      "Traffic gains could fade after initial promotion activity.",
      "Input costs could pressure margins before pricing actions work.",
      "The market may already reflect more of the recovery than the mock receipts imply.",
    ],
    sourceReceiptsPreview: [
      "Mock delivery app category-rank snapshot",
      "Mock menu pricing and basket-size comparison",
      "Mock regional hiring and store-hours trend note",
    ],
    publicTrackingPreview: "Preview status: open from $42.10 with a 30-day review window and invalidation note below $39.80.",
  },
  {
    action: "Watch",
    ticker: "TWRX",
    company: "TowerWorks Data Systems",
    event: "Mock permit filings point to faster data-center power expansion in two priority regions.",
    date: "Preview date: July 9, 2026",
    currentPrice: "$88.40",
    targetPriceRange: "$92.00–$101.00",
    potentialMove: "+4.1% to +14.3% preview range",
    profitPotentialScore: "69 / 100",
    evidenceConfidenceScore: "63 / 100",
    riskLevel: "Medium",
    pricedInCheck: "Some optimism appears reflected in sector multiples, but this specific regional mock signal is not broadly visible.",
    historicalPatternMatch: "68% preview match to infrastructure-capacity announcements that needed a second receipt before confidence improved.",
    marketSentimentImpact: "Neutral market mood; higher-rate sensitivity keeps the setup on watch until confirmation improves.",
    whyThisMatters: "The preview card demonstrates a cautious label when the possible opportunity exists but evidence has not crossed a higher-confidence threshold.",
    whatCouldGoWrong: [
      "Permits may not become active construction starts.",
      "Customer demand could shift to a competing region.",
      "Financing costs could reduce project economics.",
    ],
    sourceReceiptsPreview: [
      "Mock county permit activity summary",
      "Mock utility interconnect queue comparison",
      "Mock supplier lead-time comment digest",
    ],
    publicTrackingPreview: "Preview status: watchlist monitoring from $88.40; revisit when a second independent construction receipt appears.",
  },
  {
    action: "Avoid",
    ticker: "RCLM",
    company: "ReClaim Mobility Group",
    event: "Mock inventory days and incentive activity worsened while peer sell-through held steadier.",
    date: "Preview date: July 10, 2026",
    currentPrice: "$23.75",
    targetPriceRange: "$19.50–$21.25",
    potentialMove: "-10.5% to -17.9% preview range",
    profitPotentialScore: "58 / 100",
    evidenceConfidenceScore: "76 / 100",
    riskLevel: "High",
    pricedInCheck: "Downside does not appear fully reflected in the mock valuation snapshot, though short interest may create volatility.",
    historicalPatternMatch: "81% preview match to prior inventory-clearance cycles that preceded margin pressure.",
    marketSentimentImpact: "Defensive market mood and tighter credit conditions increase caution around levered durable-goods names.",
    whyThisMatters: "The preview example shows how an avoid label can be evidence-first when the main purpose is to flag asymmetric downside risk.",
    whatCouldGoWrong: [
      "Management could announce a credible cost reset sooner than expected.",
      "Promotions may clear inventory without lasting margin damage.",
      "A favorable financing backdrop could improve sentiment quickly.",
    ],
    sourceReceiptsPreview: [
      "Mock dealer inventory scrape",
      "Mock incentive index change log",
      "Mock regional credit spread snapshot",
    ],
    publicTrackingPreview: "Preview status: downside thesis tracked from $23.75; review if mock inventory days normalize for two updates.",
  },
];

function actionColor(action: ExampleAction) {
  if (action === "Buy Candidate") return "var(--green)";
  if (action === "Avoid") return "var(--red)";
  return "var(--gold)";
}

export default function AlertExamplesPage() {
  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Alert examples library</div>
          <h1>Preview Swing Up alert cards without real alert data.</h1>
          <p>
            These standalone examples use clearly labelled mock data to demonstrate the structure, evidence fields, risk notes, and tracking language of Swing Up alerts.
          </p>
        </div>
        <article className="card risk-callout">
          <span className="badge">Preview library</span>
          <h2 style={{ marginTop: 14 }}>All cards are mock examples</h2>
          <p>
            {mockLabel} This page does not connect to live alerts, publish alerts, or create tracking records.
          </p>
        </article>
      </section>

      <section className="grid" aria-label="Mock alert examples">
        {examples.map((example) => (
          <article className="card alert-card" key={example.ticker}>
            <div className="badge" style={{ marginBottom: 14 }}>{mockLabel}</div>
            <div
              className="alert-action"
              style={{ background: actionColor(example.action), color: "#07111F" }}
            >
              ACTION: {example.action}
            </div>

            <div className="alert-card-header">
              <div>
                <h2>{example.ticker}</h2>
                <p style={{ marginTop: 0 }}>{example.company}</p>
              </div>
              <span className="badge">Risk: {example.riskLevel}</span>
            </div>

            <p><strong>Event:</strong> {example.event}</p>
            <p><strong>Date:</strong> {example.date}</p>

            <div className="grid two alert-top-grid">
              <div className="metric"><span>Current Price</span><strong>{example.currentPrice}</strong></div>
              <div className="metric"><span>Target Price Range</span><strong>{example.targetPriceRange}</strong></div>
              <div className="metric"><span>Potential Upside/Downside</span><strong>{example.potentialMove}</strong></div>
              <div className="metric"><span>Profit Potential Score</span><strong>{example.profitPotentialScore}</strong></div>
              <div className="metric"><span>Evidence Confidence Score</span><strong>{example.evidenceConfidenceScore}</strong></div>
              <div className="metric"><span>Risk Level</span><strong>{example.riskLevel}</strong></div>
            </div>

            <section className="alert-sentiment" aria-label={`${example.ticker} evidence preview`}>
              <div className="alert-section-header"><span className="badge">Evidence-first preview</span></div>
              <p><strong>Priced-In Check:</strong> {example.pricedInCheck}</p>
              <p><strong>Historical Pattern Match:</strong> {example.historicalPatternMatch}</p>
              <p><strong>Market Sentiment Impact:</strong> {example.marketSentimentImpact}</p>
            </section>

            <div className="grid two">
              <section>
                <h3>Why this matters</h3>
                <p>{example.whyThisMatters}</p>
              </section>
              <section>
                <h3>What could go wrong</h3>
                <ul className="receipts">
                  {example.whatCouldGoWrong.map((risk) => <li key={risk}>{risk}</li>)}
                </ul>
              </section>
            </div>

            <div className="grid two" style={{ marginTop: 16 }}>
              <section>
                <h3>Source receipts preview</h3>
                <ul className="receipts">
                  {example.sourceReceiptsPreview.map((receipt) => <li key={receipt}>{receipt}</li>)}
                </ul>
              </section>
              <section>
                <h3>Public tracking preview</h3>
                <p>{example.publicTrackingPreview}</p>
              </section>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
