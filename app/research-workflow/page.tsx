const workflowSteps = [
  {
    title: "Raw Ears collect market data",
    body: "Swing Up starts by listening for filings, headlines, price context, macro changes, and other market signals that may deserve research attention.",
  },
  {
    title: "Rule Filter removes junk",
    body: "Basic checks reduce duplicate stories, stale items, thin receipts, and weak signals before they can consume deeper review time.",
  },
  {
    title: "Mini AI Scan checks review value",
    body: "A lightweight scan asks whether the remaining signal has enough evidence, relevance, and potential importance to justify deeper analysis.",
  },
  {
    title: "AI Committee reviews serious candidates",
    body: "Stronger candidates move into structured review where competing views can weigh evidence quality, upside, downside, timing, and uncertainty.",
  },
  {
    title: "Final Judge approves or blocks publication",
    body: "The final decision layer should protect users from weak, overconfident, or poorly supported ideas before anything becomes public research.",
  },
  {
    title: "Public Ledger tracks the result",
    body: "After publication, the ledger keeps the alert accountable by tracking what happened instead of relying only on the original claim.",
  },
];

const principles = [
  {
    title: "Why not every signal becomes an alert",
    body: "Markets produce constant noise. Most signals are repeated, incomplete, too weak, or missing a clear research reason. Rejection keeps attention focused on higher-quality candidates.",
  },
  {
    title: "Why receipts are required",
    body: "Receipts make the research reviewable. A signal should be tied to visible evidence so users can understand where it came from and how much confidence it deserves.",
  },
  {
    title: "Why risk is shown",
    body: "Potential upside is not useful without downside context. Swing Up highlights uncertainty, timing risk, volatility, and evidence gaps so research does not read like a promise.",
  },
  {
    title: "Why historical pattern matching matters",
    body: "Similar past events can help frame possible paths and failure modes. They add context, but they do not prove the same outcome will happen again.",
  },
  {
    title: "Why sentiment is included carefully",
    body: "Market mood can influence how a signal is received, but sentiment is not a guarantee. It is one research input alongside receipts, risk, and historical context.",
  },
];

export default function ResearchWorkflowPage() {
  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Research Workflow</div>
          <h1>How raw market signals become reviewed alert candidates.</h1>
          <p>
            Swing Up uses a calm, selective workflow to turn messy market inputs into research candidates with evidence, risk context, and outcome tracking.
          </p>
        </div>
        <div className="card risk-callout">
          <span className="badge">Important boundary</span>
          <h2>Research support, not a guarantee</h2>
          <p>
            The workflow supports market research. It does not guarantee investment outcomes.
          </p>
        </div>
      </section>

      <section className="grid two trust-section">
        {workflowSteps.map((step, index) => (
          <article className="card" key={step.title}>
            <span className="badge">Step {index + 1}</span>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </article>
        ))}
      </section>

      <section className="trust-section">
        <div className="card methodology-flow">
          {workflowSteps.map((step, index) => (
            <div className="metric" key={step.title}>
              <span>{index + 1}. Signal flow</span>
              <strong>{step.title}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="grid two trust-section">
        {principles.map((principle) => (
          <article className="card" key={principle.title}>
            <span className="badge">Review principle</span>
            <h3>{principle.title}</h3>
            <p>{principle.body}</p>
          </article>
        ))}
      </section>

      <section className="trust-section">
        <div className="card risk-callout">
          <span className="badge">Plain-English promise</span>
          <h2>Selective by design</h2>
          <p>
            Swing Up is built to slow down before publishing. A good workflow should block unsupported ideas, preserve receipts, show risk, compare history carefully, and track results after publication.
          </p>
        </div>
      </section>
    </div>
  );
}
