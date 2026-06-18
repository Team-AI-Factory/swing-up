const disclaimer =
  "Swing Up provides market research and decision-support information. It does not guarantee returns. Investing involves risk, including possible loss of capital. Users are responsible for their own decisions.";

const actionLabels = [
  {
    label: "Buy Candidate",
    meaning:
      "A research label for a setup that may deserve closer review because the evidence, opportunity, and risk context look relatively attractive.",
  },
  {
    label: "Speculative Buy Candidate",
    meaning:
      "A higher-uncertainty research label for an idea that may be interesting, but carries more risk, less proof, or more timing uncertainty.",
  },
  {
    label: "Watch",
    meaning:
      "A label for an idea worth monitoring, but not strong enough for stronger action based on the current evidence and context.",
  },
  {
    label: "Sell Review",
    meaning:
      "A label that suggests reviewing whether an existing position still fits the evidence, risk, and market context.",
  },
  {
    label: "Avoid",
    meaning:
      "A label for setups where the evidence, risk, price context, or broader conditions do not look attractive enough for action.",
  },
  {
    label: "No Action",
    meaning:
      "A label meaning Swing Up does not see enough reason to act on the signal right now.",
  },
];

const scoreRanges = [
  ["90–100", "Exceptional setup, rare"],
  ["80–89", "Strong setup worth serious attention"],
  ["65–79", "Interesting but not enough for strong action"],
  ["50–64", "Mixed signal"],
  ["Below 50", "Weak or risky setup"],
];

const glossarySections = [
  {
    title: "Profit Potential Score",
    eyebrow: "Opportunity",
    body:
      "Profit Potential Score means how attractive the setup looks after considering the signal, price context, upside, downside, sentiment, and whether the market may already be reacting. It is not a guaranteed chance of profit.",
  },
  {
    title: "Evidence Confidence Score",
    eyebrow: "Proof quality",
    body:
      "Evidence Confidence Score means how strong the proof is. It reflects how clear, relevant, timely, consistent, and source-backed the receipts appear to be. It is not a guaranteed chance of profit.",
  },
  {
    title: "Risk Level",
    eyebrow: "Downside",
    body:
      "Risk Level explains how badly the setup can go wrong. It can reflect volatility, timing risk, weak evidence, crowded positioning, liquidity concerns, company-specific problems, or broad market pressure.",
  },
  {
    title: "Historical Pattern Match",
    eyebrow: "Past context",
    body:
      "Historical Pattern Match compares a current setup with similar past events. It provides context and discipline, but similar past events can still lead to different future outcomes.",
  },
  {
    title: "Priced-In Check",
    eyebrow: "Market reaction",
    body:
      "Priced-In Check asks whether the market may have already absorbed the information. If the move looks crowded, obvious, or already reflected in price, Swing Up can treat the setup more cautiously.",
  },
  {
    title: "Market Sentiment Impact",
    eyebrow: "Environment",
    body:
      "Market sentiment describes whether the broader environment looks supportive, cautious, stressed, or crowded. Market sentiment can adjust the scores, but it does not guarantee outcomes.",
  },
  {
    title: "Source Reliability",
    eyebrow: "Source quality",
    body:
      "Source Reliability describes how dependable the underlying source appears to be. Official filings, direct company materials, and consistently available data sources usually carry more weight than vague or unverified claims.",
  },
  {
    title: "Receipts Count",
    eyebrow: "Evidence volume",
    body:
      "Receipts Count is the number of supporting items behind a signal or alert. More receipts can help, but quality matters more than raw count.",
  },
  {
    title: "Public Ledger Outcome",
    eyebrow: "Accountability",
    body:
      "Public Ledger Outcome is the after-the-fact tracking result for a published alert. It helps users review what happened later instead of relying on memory or marketing claims.",
  },
  {
    title: "Max Gain",
    eyebrow: "Best observed move",
    body:
      "Max Gain is the largest favorable move observed during the tracking window. It is a historical tracking measure, not a promise that future alerts will behave the same way.",
  },
  {
    title: "Max Drawdown",
    eyebrow: "Worst observed move",
    body:
      "Max Drawdown is the largest unfavorable move observed during the tracking window. It helps show how uncomfortable or risky the path became, even if the final outcome improved later.",
  },
];

export default function ScoreGlossaryPage() {
  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Score glossary</div>
          <h1>Plain-English guide to Swing Up scores and labels.</h1>
          <p>
            This standalone glossary explains the main research scores, labels, and
            tracking terms used across Swing Up. It is evidence-first context for
            understanding alerts, not personalized investment advice.
          </p>
        </div>
        <div className="card risk-callout">
          <span className="badge">Important</span>
          <h2>Research support only</h2>
          <p>{disclaimer}</p>
        </div>
      </section>

      <section className="trust-section">
        <div className="card methodology-flow">
          <span className="badge">Score interpretation</span>
          <h2>How to read 0–100 scores</h2>
          {scoreRanges.map(([range, meaning]) => (
            <div className="metric" key={range}>
              <span>{range}</span>
              <strong>{meaning}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="trust-section">
        <div className="eyebrow">Action labels</div>
        <div className="grid two">
          {actionLabels.map((action) => (
            <article className="card" key={action.label}>
              <span className="badge">ACTION</span>
              <h2>{action.label}</h2>
              <p>{action.meaning}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="grid two trust-section">
        {glossarySections.map((section) => (
          <article className="card" key={section.title}>
            <span className="badge">{section.eyebrow}</span>
            <h2>{section.title}</h2>
            <p>{section.body}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
