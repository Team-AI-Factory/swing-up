const onboardingSteps = [
  {
    title: "What Swing Up watches",
    explanation:
      "Swing Up watches public market signals, source health, historical context, and alert outcomes so users can review research in one calm workflow.",
    example: ["Public market events", "Signal quality and source status", "Past examples with similar patterns"],
  },
  {
    title: "What an alert means",
    explanation:
      "An alert means Swing Up found a research setup that may deserve attention. It is not an instruction to buy, sell, or hold anything.",
    example: ["Why the signal appeared", "What evidence supports it", "What risks may weaken the idea"],
  },
  {
    title: "What receipts are",
    explanation:
      "Receipts are the supporting details behind a research view. They help users inspect why Swing Up surfaced something before relying on it.",
    example: ["Source notes", "Relevant observations", "Outcome tracking when available"],
  },
  {
    title: "What Profit Potential Score means",
    explanation:
      "Profit Potential Score is a research estimate of possible upside conditions. Scores are not guarantees and should never be treated as predictions.",
    example: ["Higher score: stronger setup signals", "Lower score: weaker opportunity context", "Always review the evidence and risk"],
  },
  {
    title: "What Evidence Confidence Score means",
    explanation:
      "Evidence Confidence Score summarizes how much support the research has. It can improve or weaken as sources, receipts, and context change.",
    example: ["Source reliability", "Receipt quality", "Agreement across signals"],
  },
  {
    title: "What Risk Level means",
    explanation:
      "Risk Level highlights uncertainty, volatility, downside exposure, or weak context. A promising idea can still carry meaningful risk.",
    example: ["Low: fewer obvious concerns", "Medium: mixed setup", "High: major uncertainty or downside risk"],
  },
  {
    title: "What Market Sentiment Impact means",
    explanation:
      "Market Sentiment Impact explains whether broader market mood may help, hurt, or complicate the research setup.",
    example: ["Supportive sentiment", "Neutral or unclear sentiment", "Negative pressure or volatility"],
  },
  {
    title: "Why public tracking matters",
    explanation:
      "Public tracking keeps research accountable by showing what was shared and what happened afterward, without rewriting the original context.",
    example: ["Open alerts remain visible", "Outcomes can be reviewed", "Receipts help users audit the process"],
  },
  {
    title: "What users should not assume",
    explanation:
      "Users should not assume Swing Up knows their goals, finances, timing, risk tolerance, or tax situation. The app is not personal financial advice.",
    example: ["Do not assume a score is a guarantee", "Do not assume an alert fits your portfolio", "Do not skip your own research"],
  },
  {
    title: "Final disclaimer",
    explanation:
      "Swing Up is market research and decision-support, not financial advice. Scores are not guarantees. Users are responsible for their own decisions.",
    example: ["Investing involves risk", "Markets can move against any setup", "Use Swing Up as one research input only"],
  },
];

export default function OnboardingPreviewPage() {
  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Onboarding preview</div>
          <h1>Learn the system before using the signal.</h1>
          <p>
            A standalone preview of how a new Swing Up user can understand alerts, receipts,
            scores, risk, and accountability before making their own decisions.
          </p>
        </div>
        <div className="card risk-callout">
          <span className="badge">Start here</span>
          <h2>Proof, risk, and public tracking included.</h2>
          <p>
            Swing Up is market research and decision-support, not financial advice. Scores are
            not guarantees, and users are responsible for their own decisions.
          </p>
        </div>
      </section>

      <section className="grid two trust-section" aria-label="Onboarding steps">
        {onboardingSteps.map((step, index) => (
          <article className="card" key={step.title}>
            <span className="badge">Step {index + 1}</span>
            <h3>{step.title}</h3>
            <p>{step.explanation}</p>
            <ul className="receipts">
              {step.example.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        ))}
      </section>
    </div>
  );
}
