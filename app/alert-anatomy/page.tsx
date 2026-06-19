const requiredNotices = [
  "Mock example only — not a real alert.",
  "Profit Potential Score is not a guaranteed chance of profit.",
  "Evidence Confidence Score is not a guaranteed chance of profit.",
  "Swing Up provides market research and decision-support information. It does not guarantee returns.",
];

const anatomySections = [
  {
    title: "ACTION label",
    body: "A short research status that tells you how Swing Up is classifying the setup. It is not a personal instruction to trade.",
    example: "WATCH",
  },
  {
    title: "Ticker and company",
    body: "The stock symbol and company name so the alert is easy to identify and not confused with another business.",
    example: "MCK · Mock Components Co.",
  },
  {
    title: "Event summary",
    body: "The plain-English reason the company is being reviewed, based on the receipts available in the mock example.",
    example: "Mock supplier notes point to a possible inventory rebuild.",
  },
  {
    title: "Current price",
    body: "The reference price used when the alert is created. It gives the rest of the numbers a starting point.",
    example: "$42.00",
  },
  {
    title: "Target price range",
    body: "A research range used to frame possible outcomes. It is a scenario range, not a promise.",
    example: "$46.00–$49.00",
  },
  {
    title: "Potential upside/downside",
    body: "A simple comparison between the current price and the research range, plus the main downside to watch.",
    example: "+9.5% to +16.7%; downside watch: -7.0%",
  },
  {
    title: "Profit Potential Score",
    body: "A 0–100 research score for the size and quality of the possible opportunity. Profit Potential Score is not a guaranteed chance of profit.",
    example: "74 / 100",
  },
  {
    title: "Evidence Confidence Score",
    body: "A 0–100 research score for how clear, consistent, and receipt-backed the evidence appears. Evidence Confidence Score is not a guaranteed chance of profit.",
    example: "68 / 100",
  },
  {
    title: "Risk Level",
    body: "A plain-language label for uncertainty, downside, timing risk, and how much confirmation is still missing.",
    example: "Medium",
  },
  {
    title: "Priced-In Check",
    body: "A check on whether the market may already know the story. If the story is already reflected in the price, the setup may be less useful.",
    example: "Not clearly priced in",
  },
  {
    title: "Historical Pattern Match",
    body: "A comparison with similar past setups. It adds context, but the next outcome can still be different.",
    example: "71% similarity to prior inventory-rebuild setups",
  },
  {
    title: "Market Sentiment Impact",
    body: "A read on whether the broader market mood is helping, hurting, or adding noise to the company-specific setup.",
    example: "Slight support from sector sentiment",
  },
  {
    title: "Why this matters",
    body: "The reason a busy reader might care. This connects the event to revenue, margins, timing, valuation, or attention.",
    example: "Inventory rebuilds can affect near-term orders and margin expectations.",
  },
  {
    title: "What could go wrong",
    body: "The main ways the setup could fail, arrive late, or be less meaningful than it first appears.",
    example: "Demand could fade, data could be noisy, or the market could have moved first.",
  },
  {
    title: "Source receipts",
    body: "The evidence list behind the alert. Receipts let readers inspect the reasoning instead of accepting a black-box claim.",
    example: "Mock supplier note · Mock inventory comment · Mock shipping snapshot",
  },
  {
    title: "Public tracking",
    body: "The follow-up record used to show what happened after publication, including open, win, loss, or neutral outcomes.",
    example: "Open from $42.00 with a 30-day review window",
  },
];

export default function AlertAnatomyPage() {
  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Alert anatomy</div>
          <h1>How to read a Swing Up alert card</h1>
          <p>
            A calm, evidence-first guide to each part of a public Swing Up alert card using local mock content only.
          </p>
          <div className="button-row">
            {requiredNotices.slice(0, 2).map((notice) => (
              <span className="badge" key={notice}>{notice}</span>
            ))}
          </div>
        </div>

        <article className="card alert-card">
          <div className="alert-section-header">
            <span className="alert-action alert-action-watch">WATCH</span>
            <span className="badge">Mock example</span>
          </div>
          <div className="alert-card-header">
            <div>
              <h2>MCK</h2>
              <p>Mock Components Co.</p>
            </div>
            <span className="badge">Risk: Medium</span>
          </div>
          <p><strong>Mock example only — not a real alert.</strong></p>
          <p>
            Mock supplier receipts suggest a possible inventory rebuild after two quiet quarters.
          </p>
          <div className="grid two alert-top-grid">
            <div className="metric"><span>Current price</span><strong>$42.00</strong></div>
            <div className="metric"><span>Target price range</span><strong>$46.00–$49.00</strong></div>
            <div className="metric"><span>Potential upside/downside</span><strong>+9.5% to +16.7%; downside watch: -7.0%</strong></div>
            <div className="metric"><span>Historical Pattern Match</span><strong>71%</strong></div>
          </div>
          <div className="grid two alert-score-grid">
            <div className="metric"><span>Profit Potential Score</span><strong>74 / 100</strong></div>
            <div className="metric"><span>Evidence Confidence Score</span><strong>68 / 100</strong></div>
          </div>
          <div className="alert-sentiment">
            <div className="alert-section-header">
              <h3>Market Sentiment Impact</h3>
              <span className="badge">Slight support</span>
            </div>
            <p>Mock sector tone is stable, but confirmation is still limited.</p>
          </div>
        </article>
      </section>

      <section className="trust-section card risk-callout">
        <span className="badge">Important wording</span>
        <h2>Research support, not a return promise</h2>
        <ul className="receipts">
          {requiredNotices.map((notice) => (
            <li key={notice}>{notice}</li>
          ))}
        </ul>
      </section>

      <section className="grid three trust-section">
        {anatomySections.map((section) => (
          <article className="card" key={section.title}>
            <span className="badge">{section.title}</span>
            <h3>{section.example}</h3>
            <p>{section.body}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
