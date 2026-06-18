import Link from "next/link";

const disclaimer =
  "Swing Up provides market research and decision-support information. It does not guarantee returns. Investing involves risk, including possible loss of capital. Users are responsible for their own decisions.";

const methodologySections = [
  {
    title: "What Swing Up does",
    eyebrow: "Purpose",
    body:
      "Swing Up turns market signals into organized research alerts. The workflow starts with evidence, checks the quality of that evidence, considers market context, describes risks, and keeps public tracking so users can review what happened after an alert was published.",
  },
  {
    title: "What Profit Potential Score means",
    eyebrow: "Opportunity",
    body:
      "Profit Potential Score is a research estimate of how attractive a setup may look after considering the signal, price context, possible upside or downside movement, and whether the market may already be reacting. Profit Potential Score is not a guaranteed chance of profit.",
  },
  {
    title: "What Evidence Confidence Score means",
    eyebrow: "Evidence",
    body:
      "Evidence Confidence Score reflects how clear, relevant, timely, and consistent the receipts behind an alert appear to be. It is about evidence quality, not outcome certainty. Evidence Confidence Score is not a guaranteed chance of profit.",
  },
  {
    title: "Why the two scores are separate",
    eyebrow: "Separation",
    body:
      "A setup can look potentially interesting while still having weak evidence, or it can have strong evidence but limited apparent opportunity because the market has already reacted. Separating the scores keeps the opportunity view distinct from the evidence-quality view.",
  },
  {
    title: "How Market Sentiment affects scoring",
    eyebrow: "Context",
    body:
      "Market sentiment helps frame whether the broader environment is supportive, cautious, stressed, or crowded. It can influence scores by raising or lowering the quality of the setup context, but it does not guarantee outcomes.",
  },
  {
    title: "What Risk Level means",
    eyebrow: "Risk",
    body:
      "Risk Level summarizes what could go wrong. It can reflect volatility, timing risk, thin evidence, crowded positioning, sector pressure, company-specific uncertainty, liquidity concerns, and broader market conditions.",
  },
  {
    title: "What Historical Pattern Match means",
    eyebrow: "History",
    body:
      "Historical Pattern Match compares a current alert setup with similar past events. It is used for context and discipline: similar situations can help frame possibilities, but history can diverge and should not be treated as a script.",
  },
  {
    title: "What Priced-In Check means",
    eyebrow: "Price reaction",
    body:
      "Priced-In Check asks whether the market may have already absorbed the information. If a signal appears obvious, crowded, or already reflected in price movement, Swing Up can treat the setup more cautiously even when the evidence is meaningful.",
  },
  {
    title: "Why receipts matter",
    eyebrow: "Receipts",
    body:
      "Receipts are the underlying sources and observations that explain why an alert exists. They help users inspect the evidence, separate signal from narrative, and understand which facts or market observations influenced the research view.",
  },
  {
    title: "Why every alert is tracked publicly",
    eyebrow: "Accountability",
    body:
      "Public tracking makes the research process accountable. Published alerts should be reviewable after the fact, including their thesis, risks, evidence, status, and outcome context, so users can judge the process instead of relying on memory or marketing claims.",
  },
  {
    title: "What Swing Up does not do",
    eyebrow: "Boundaries",
    body:
      "Swing Up does not provide personalized investment advice, execute trades, promise returns, remove risk, or tell users what they must do. It is a decision-support tool for research, evidence review, and accountability.",
  },
];

const principles = [
  "Evidence first, then scoring.",
  "Opportunity and evidence are measured separately.",
  "Risk is shown beside the thesis, not hidden behind it.",
  "Published alerts are meant to be trackable after release.",
];

export default function MethodologyPage() {
  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Methodology</div>
          <h1>How Swing Up turns market signals into accountable research.</h1>
          <p>
            Swing Up is a receipt-first research workflow for evaluating alerts, scores,
            evidence, risks, sentiment, historical context, and public tracking without
            promising investment outcomes.
          </p>
          <div className="button-row">
            <Link className="button primary" href="/public-ledger">
              View public ledger
            </Link>
            <Link className="button" href="/risk-disclaimer">
              Read risk disclaimer
            </Link>
          </div>
        </div>
        <div className="card methodology-flow">
          {principles.map((principle, index) => (
            <div className="metric" key={principle}>
              <span>Principle {index + 1}</span>
              <strong>{principle}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="trust-section">
        <div className="card risk-callout">
          <span className="badge">Important</span>
          <h2>Research support, not a promise of performance</h2>
          <p>{disclaimer}</p>
        </div>
      </section>

      <section className="grid two trust-section">
        {methodologySections.map((section) => (
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
