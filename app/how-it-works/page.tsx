const flowSteps = [
  ["Source Health checks the data ears.", "Swing Up first checks whether planned data sources are connected, not configured, stubbed, degraded, or unavailable."],
  ["Raw Signal Store saves market signals.", "Incoming signals are saved before judgement, so the original context can be reviewed later."],
  ["Signal Filter removes weak/noisy signals.", "The filter helps reduce duplicates, stale items, low-quality inputs, and obvious noise."],
  ["Historical Event Library stores past examples.", "Past examples provide context for how similar events behaved before, without promising that history will repeat."],
  ["Pattern Match compares new signals with old events.", "New signals can be compared with previous situations to help frame possible outcomes and risks."],
  ["Scoring estimates opportunity, evidence, and risk.", "Scores help summarize profit potential, evidence confidence, and risk level as research inputs rather than instructions."],
  ["AI Committee reviews later.", "Future review may add structured debate, but this version does not connect real AI calls."],
  ["Public Ledger tracks outcomes.", "Published alerts can be tracked over time so users can review what happened after the research was shared."],
];

const disclaimer = "Swing Up provides market research and decision-support information. It does not guarantee returns. Investing involves risk, including possible loss of capital. Users are responsible for their own decisions.";

export default function HowItWorksPage() {
  return <div className="page">
    <section className="hero trust-hero"><div><div className="eyebrow">How it works</div><h1>From signal to accountable research.</h1><p>Swing Up is designed as a receipt-first research workflow. It collects signals, filters weak inputs, adds historical context, scores the setup, and tracks published outcomes without promising results.</p></div><div className="card methodology-flow">{flowSteps.map(([title], index) => <div className="metric" key={title}><span>Step {index + 1}</span><strong>{title}</strong></div>)}</div></section>
    <section className="grid two trust-section">{flowSteps.map(([title, body], index) => <article className="card" key={title}><span className="badge">Step {index + 1}</span><h3>{title}</h3><p>{body}</p></article>)}</section>
    <section className="trust-section"><div className="card risk-callout"><span className="badge">Important</span><h2>Research support, not personal advice</h2><p>{disclaimer}</p></div></section>
  </div>;
}
