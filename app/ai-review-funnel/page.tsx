const funnelSteps = [
  "Raw public ears collect signals",
  "Duplicate filter removes repeated items",
  "Rule filter scores obvious importance",
  "Historical Pattern Match checks similar past events",
  "Cheap AI reviews the strongest candidates",
  "Final AI review checks only finalists",
  "Public Ledger tracks the result",
];

const reasons = [
  "too expensive",
  "too noisy",
  "slower",
  "easier to hallucinate",
  "harder to audit",
];

const disclaimer = "Swing Up provides market research and decision-support information. It does not guarantee returns. Investing involves risk, including possible loss of capital. Users are responsible for their own decisions.";

export default function AiReviewFunnelPage() {
  return <div className="page">
    <section className="hero trust-hero"><div><div className="eyebrow">AI review funnel</div><h1>How Swing Up Uses AI Without Reading Everything</h1><p>Swing Up does not send every raw signal to AI. It filters first, then asks AI to review only the strongest candidates.</p></div><div className="card methodology-flow">{funnelSteps.map((step, index) => <div className="metric" key={step}><span>Stage {index + 1}</span><strong>{step}</strong></div>)}</div></section>
    <section className="grid two trust-section"><article className="card"><span className="badge">Example</span><h2>Most signals never reach AI</h2><p>If 1,000 articles arrive, rules may reject 950. AI may review 50. Only a few may become alert candidates.</p></article><article className="card"><span className="badge">Receipts</span><h2>Receipts stay attached</h2><p>AI review must cite the source evidence used, so users can inspect the receipts behind any research output instead of relying on unsupported claims.</p></article></section>
    <section className="grid two trust-section"><article className="card"><h2>Why not ask AI to read everything?</h2><ul className="receipts">{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></article><article className="card risk-callout"><span className="badge">Important</span><h2>Research support, not guarantees</h2><p>{disclaimer}</p></article></section>
  </div>;
}
