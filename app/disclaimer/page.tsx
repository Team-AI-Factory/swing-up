const requiredDisclaimer =
  "Swing Up provides market research and decision-support information. It does not guarantee returns. Investing involves risk, including possible loss of capital. Users are responsible for their own decisions.";

const educationSections = [
  {
    eyebrow: "Research boundary",
    title: "Swing Up is market research, not financial advice",
    body:
      "Swing Up organizes market information so users can review evidence, context, risks, and public tracking. It does not provide personalized recommendations, portfolio guidance, or instructions to trade.",
  },
  {
    eyebrow: "Signal discipline",
    title: "Scores are decision-support signals, not guarantees",
    body:
      "Scores are designed to summarize research inputs in a consistent way. They should be treated as one part of a broader review process, not as certainty about future market behavior.",
  },
  {
    eyebrow: "Opportunity score",
    title: "Profit Potential Score is not guaranteed profit probability",
    body:
      "Profit Potential Score describes how attractive a setup may appear after reviewing the signal, context, risks, and possible price reaction. It is not a promise that a trade will make money.",
  },
  {
    eyebrow: "Evidence score",
    title: "Evidence Confidence Score is not chance of profit",
    body:
      "Evidence Confidence Score reflects the clarity, relevance, freshness, and consistency of the receipts behind a research alert. Better evidence can still lead to uncertain market outcomes.",
  },
  {
    eyebrow: "Sentiment context",
    title: "Market sentiment does not guarantee outcomes",
    body:
      "Sentiment can help describe whether the broader environment appears supportive, cautious, stressed, or crowded. It is context for research, not a forecast that removes uncertainty.",
  },
  {
    eyebrow: "History context",
    title: "Historical patterns do not guarantee repeated results",
    body:
      "Historical pattern matching can make research more disciplined by comparing current setups with prior situations. Similar conditions can still produce different results.",
  },
  {
    eyebrow: "User responsibility",
    title: "Users are responsible for their own decisions",
    body:
      "Every user should decide whether an idea fits their own research, risk tolerance, time horizon, and financial circumstances. Swing Up does not know each user’s full situation.",
  },
  {
    eyebrow: "Capital risk",
    title: "Investing involves possible loss of capital",
    body:
      "Markets can move quickly and unexpectedly. Any investment decision can lose money, including when the original research thesis appears reasonable or well supported.",
  },
  {
    eyebrow: "Public accountability",
    title: "Why Swing Up tracks alerts publicly, win or lose",
    body:
      "Public tracking helps users review the full research process after an alert is published. Showing outcomes openly supports accountability, learning, and trust in the process rather than selective memory.",
  },
];

const principles = [
  "Research first",
  "Evidence over hype",
  "Risk shown clearly",
  "Public accountability",
];

export default function DisclaimerPage() {
  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Disclaimer + risk education</div>
          <h1>Market research with clear boundaries.</h1>
          <p>{requiredDisclaimer}</p>
        </div>
        <aside className="card risk-callout" aria-label="Core risk principles">
          <span className="badge">Important</span>
          <h2>No alert removes uncertainty.</h2>
          <p>
            Swing Up is built to make research easier to inspect. It cannot remove market risk,
            replace independent judgment, or make outcomes certain.
          </p>
          <div className="disclaimer-list">
            {principles.map((principle) => (
              <div className="metric" key={principle}>
                <span>{principle}</span>
              </div>
            ))}
          </div>
        </aside>
      </section>

      <section className="trust-section card">
        <span className="badge">Required disclosure</span>
        <h2>Before using Swing Up research</h2>
        <p>{requiredDisclaimer}</p>
      </section>

      <section className="grid two trust-section">
        {educationSections.map((section) => (
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
