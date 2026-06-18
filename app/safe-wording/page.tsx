const disclaimer =
  "Swing Up provides market research and decision-support information. It does not guarantee returns. Investing involves risk, including possible loss of capital. Users are responsible for their own decisions.";

const approvedActionLabels = [
  "Buy Candidate",
  "Speculative Buy Candidate",
  "Watch",
  "Sell Review",
  "Avoid",
  "No Action",
];

const bannedPhrases = [
  "Buy now",
  "Guaranteed winner",
  "Risk-free",
  "Strong buy",
  "Price will definitely hit",
  "AI knows the next move",
  "This will make money",
  "Short now",
];

const replacementExamples = [
  {
    avoid: "Strong buy",
    use: "Buy Candidate",
    reason: "Keeps the label framed as a research candidate instead of a command or recommendation.",
  },
  {
    avoid: "This will make money",
    use: "This setup may be worth review, but risks remain",
    reason: "Acknowledges uncertainty and avoids promising an outcome.",
  },
  {
    avoid: "AI knows the next move",
    use: "Swing Up weighs evidence, risk, sentiment, and historical patterns",
    reason: "Explains the research process without implying prediction certainty.",
  },
];

const wordingSections = [
  {
    title: "Score explanation wording",
    eyebrow: "Scores",
    purpose: "Explain what a score summarizes without treating it as a guarantee.",
    approved: [
      "The score summarizes current evidence, risk, sentiment, and historical context.",
      "A higher score means the setup may deserve more review, not that a return is assured.",
      "Scores can change when evidence, market context, or risk conditions change.",
    ],
  },
  {
    title: "Risk explanation wording",
    eyebrow: "Risk",
    purpose: "Keep risk visible even when a setup looks interesting.",
    approved: [
      "Key risks include timing, volatility, weak confirmation, execution, liquidity, and broader market conditions.",
      "Risk labels describe uncertainty and possible downside; they do not predict a specific loss.",
      "Users should compare the risk summary with their own objectives, constraints, and tolerance.",
    ],
  },
  {
    title: "Market sentiment wording",
    eyebrow: "Sentiment",
    purpose: "Describe market mood as context, not as a trade instruction.",
    approved: [
      "Market sentiment appears supportive, mixed, cautious, or risk-off based on available signals.",
      "Sentiment can influence how quickly evidence is noticed, ignored, or challenged by the market.",
      "Sentiment is one input in the review and should be weighed alongside receipts and risk.",
    ],
  },
  {
    title: "Public ledger wording",
    eyebrow: "Ledger",
    purpose: "Make tracking accountable without implying that past reviews prove future outcomes.",
    approved: [
      "The public ledger records what was observed, when it was observed, and how the setup was later reviewed.",
      "Ledger entries support accountability and learning; they are not performance promises.",
      "Outcomes may be positive, negative, mixed, neutral, or unknown depending on later evidence.",
    ],
  },
  {
    title: "Disclaimer wording",
    eyebrow: "Disclaimer",
    purpose: "Place compliance language near research explanations and decision-support content.",
    approved: [disclaimer],
  },
];

export default function SafeWordingPage() {
  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Safe wording library</div>
          <h1>Calm, compliant, evidence-first language</h1>
          <p>
            Swing Up uses careful wording so alert language stays grounded in research, risk, receipts, and uncertainty instead of hype or prediction certainty.
          </p>
        </div>
        <article className="card risk-callout">
          <span className="badge">Language standard</span>
          <h2>Decision support, not commands.</h2>
          <p>
            Use labels and explanations that invite review, show uncertainty, and avoid implying guaranteed returns or personal financial advice.
          </p>
        </article>
      </section>

      <section className="grid two trust-section">
        <article className="card">
          <span className="badge">Approved</span>
          <h2 style={{ marginTop: 14 }}>Approved action labels</h2>
          <p>These labels are allowed because they describe research status without telling a user what to do.</p>
          <ul className="receipts">
            {approvedActionLabels.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </article>

        <article className="card risk-callout">
          <span className="badge">Do not use</span>
          <h2 style={{ marginTop: 14 }}>Banned unsafe phrases</h2>
          <p>Avoid language that sounds certain, urgent, promotional, or like a direct trading instruction.</p>
          <ul className="receipts">
            {bannedPhrases.map((phrase) => (
              <li key={phrase}>{phrase}</li>
            ))}
          </ul>
        </article>
      </section>

      <section className="trust-section card">
        <div className="eyebrow">Better replacement wording</div>
        <h2>Replace hype with review language</h2>
        <p>When a phrase sounds predictive or promotional, rewrite it as evidence-first decision-support language.</p>
        <div className="grid three" style={{ marginTop: 18 }}>
          {replacementExamples.map((example) => (
            <article className="card" key={example.avoid}>
              <span className="badge">Replacement</span>
              <p><strong>Instead of:</strong> “{example.avoid}”</p>
              <p><strong>Say:</strong> “{example.use}”</p>
              <p>{example.reason}</p>
            </article>
          ))}
        </div>
      </section>

      {wordingSections.map((section) => (
        <section className="trust-section card" key={section.title}>
          <div className="eyebrow">{section.eyebrow}</div>
          <h2>{section.title}</h2>
          <p>{section.purpose}</p>
          <div className="grid two" style={{ marginTop: 18 }}>
            {section.approved.map((line) => (
              <article className="card" key={line}>
                <span className="badge">Approved wording</span>
                <p style={{ marginTop: 12 }}>{line}</p>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
