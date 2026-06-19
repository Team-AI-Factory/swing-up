const trustPillars = [
  {
    title: "Why Swing Up uses receipts",
    body: "Receipts make each research alert inspectable. They point users toward the filing, event, price behavior, historical context, or risk evidence behind a signal so the alert can be reviewed instead of accepted on faith.",
  },
  {
    title: "Why source health matters",
    body: "A signal is only as useful as the sources behind it. Source health helps users understand whether inputs are current, delayed, missing, degraded, or limited before they weigh the research.",
  },
  {
    title: "Why every alert should show risk",
    body: "Every setup can fail. Risk notes keep the downside visible by showing what could weaken the thesis, what data may be incomplete, and what market conditions could change the interpretation.",
  },
  {
    title: "Why losing alerts should not be deleted",
    body: "Keeping weak or losing alerts visible protects the integrity of the record. A public archive should show both useful calls and missed calls so users can judge the process over time.",
  },
  {
    title: "Why scores are not guarantees",
    body: "Scores summarize evidence quality, timing, source confidence, and risk context. They are research labels, not promises about price movement or future returns.",
  },
  {
    title: "How market sentiment is used carefully",
    body: "Sentiment can add context, but it can also be noisy, emotional, or late. Swing Up treats sentiment as one input among many and pairs it with receipts, source checks, and risk language.",
  },
  {
    title: "How public tracking builds accountability",
    body: "Public tracking makes outcomes visible after alerts are published. It helps users compare the original thesis with later price behavior, risk notes, and result windows.",
  },
  {
    title: "What Swing Up does not do",
    body: "Swing Up does not provide personalized financial advice, manage portfolios, execute trades, hide unfavorable outcomes, or claim that any model can know future market moves.",
  },
];

const evidenceChecks = [
  "Named source or clear data origin",
  "Plain-language thesis and counterpoint",
  "Visible risk context before action language",
  "Outcome tracking after publication",
];

const requiredDisclosure =
  "Swing Up provides market research and decision-support information. It does not guarantee returns. Investing involves risk, including possible loss of capital. Users are responsible for their own decisions.";

export default function TrustCenterPage() {
  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Trust Center</div>
          <h1>Evidence-first research, with risk kept in view.</h1>
          <p>
            Swing Up is designed around transparent receipts, careful wording, public tracking, and clear limits so users can inspect the research process before making their own decisions.
          </p>
        </div>
        <article className="card risk-callout">
          <span className="badge">Trust standard</span>
          <h2>Show the work. Show the risk.</h2>
          <p>
            The goal is not to make market research feel certain. The goal is to make the evidence, assumptions, source quality, and uncertainty easier to review.
          </p>
        </article>
      </section>

      <section className="grid two trust-section">
        {trustPillars.map((pillar) => (
          <article className="card" key={pillar.title}>
            <span className="badge">Trust principle</span>
            <h2>{pillar.title}</h2>
            <p>{pillar.body}</p>
          </article>
        ))}
      </section>

      <section className="grid two trust-section">
        <article className="card">
          <span className="badge">Evidence checklist</span>
          <h2>What a calmer alert should make visible</h2>
          <div className="disclaimer-list">
            {evidenceChecks.map((check) => (
              <div className="metric" key={check}>
                <span>{check}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="card risk-callout">
          <span className="badge">Required disclosure</span>
          <h2>Research support only</h2>
          <p>{requiredDisclosure}</p>
        </article>
      </section>
    </div>
  );
}
