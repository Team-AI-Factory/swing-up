const journeySteps = [
  {
    title: "Public ears collect signals",
    body: "Public sources can surface filings, headlines, and market context that may deserve a closer look.",
  },
  {
    title: "Raw Signal Store saves the original evidence",
    body: "The first record keeps the original receipt intact before Swing Up tries to judge whether it matters.",
  },
  {
    title: "Duplicate checks remove repeated noise",
    body: "Repeated versions of the same item are reduced so one noisy story does not look like many independent signals.",
  },
  {
    title: "Signal Filter checks obvious importance",
    body: "Basic filtering looks for early signs that a signal is material enough to keep researching.",
  },
  {
    title: "Historical Pattern Match compares similar past events",
    body: "Past examples help frame what happened in similar situations, without assuming the same outcome will repeat.",
  },
  {
    title: "Market Sentiment checks the wider market mood",
    body: "Broad market tone can change whether a company-specific signal has support, pressure, or extra risk.",
  },
  {
    title: "Evidence Confidence checks receipt quality",
    body: "Strong candidates need clearer receipts, better source quality, and enough context to support research.",
  },
  {
    title: "Profit Potential checks upside versus risk",
    body: "Potential reward is weighed against downside, uncertainty, liquidity, and timing before anything moves forward.",
  },
  {
    title: "AI Review later checks only strongest candidates",
    body: "Future AI review is reserved for stronger candidates after earlier checks reduce weak or noisy inputs.",
  },
  {
    title: "Public Ledger tracks outcomes",
    body: "Published research can be tracked after the fact so users can review outcomes instead of relying on claims.",
  },
];

const notBuiltYet = [
  "final AI committee",
  "real paid market data",
  "payment system",
  "final live alerts",
];

const disclaimer =
  "Swing Up provides market research and decision-support information. It does not guarantee returns. Investing involves risk, including possible loss of capital. Users are responsible for their own decisions.";

export default function SignalJourneyPage() {
  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Signal Journey</div>
          <h1>From Raw Signal to Alert Candidate</h1>
          <p>
            Swing Up does not turn every headline into an alert. Each signal moves through checks before it can become useful research.
          </p>
        </div>
        <div className="card risk-callout">
          <span className="badge">Research workflow</span>
          <h2>Receipts first, candidates later</h2>
          <p>
            The journey is intentionally selective: evidence is saved, noise is reduced, and only stronger setups should continue toward alert review.
          </p>
        </div>
      </section>

      <section className="grid two trust-section">
        {journeySteps.map((step, index) => (
          <article className="card" key={step.title}>
            <span className="badge">Step {index + 1}</span>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </article>
        ))}
      </section>

      <section className="grid two trust-section">
        <article className="card">
          <span className="badge">Quality control</span>
          <h2>Why most signals should be rejected</h2>
          <p>
            Rejecting weak signals is a feature, not a failure. Market feeds are full of repeated headlines, stale context, low-quality receipts, and stories that sound important but do not create a useful research setup.
          </p>
          <p>
            A selective process protects attention by letting weak evidence stop early, while stronger candidates continue toward deeper checks.
          </p>
        </article>

        <article className="card">
          <span className="badge">Roadmap boundary</span>
          <h2>What is not built yet</h2>
          <ul className="receipts">
            {notBuiltYet.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </section>

      <section className="trust-section">
        <div className="card risk-callout">
          <span className="badge">Important disclaimer</span>
          <h2>Research support, not a guarantee</h2>
          <p>{disclaimer}</p>
        </div>
      </section>
    </div>
  );
}
