import Link from "next/link";

const watchItems = [
  "Company filings, guidance changes, and earnings commentary.",
  "Price and volume behavior that may show unusual interest or stress.",
  "Sector, macro, supply-chain, and competitive context.",
  "Source-health status so weak inputs can be treated carefully.",
];

const methodologySections = [
  ["What Swing Up watches", "Swing Up is designed to collect market signals from multiple source types, then keep the original material available as receipts before any scoring or review happens."],
  ["What counts as a signal", "A signal is a piece of market-relevant information that may affect a ticker, sector, or setup. Weak, duplicate, stale, or noisy signals are filtered before serious signals move forward."],
  ["Profit Potential Score", "This research score estimates whether a setup could have meaningful upside or downside movement if the signal is not already reflected in price. It is not a return forecast."],
  ["Evidence Confidence Score", "This score reflects the quality, clarity, and consistency of the receipts behind an alert. Stronger evidence can raise confidence; thin or conflicting evidence lowers it."],
  ["Risk Level", "Risk level highlights what could go wrong, including volatility, timing risk, weak sourcing, crowded trades, company-specific risk, and broader market conditions."],
  ["Priced-In Check", "Swing Up asks whether the market may have already reacted. If the move appears crowded or obvious, an alert can be downgraded even when the original signal is interesting."],
  ["Historical Pattern Match", "Similar past events are reviewed to provide context. Pattern matching can help frame probabilities, but history never guarantees a repeat outcome."],
  ["Why receipts matter", "Receipts let users see why an alert exists. Final alerts should include evidence, risks, public tracking, and enough context for users to make their own decision."],
];

export default function MethodologyPage() {
  return <div className="page">
    <section className="hero trust-hero"><div><div className="eyebrow">Methodology</div><h1>How Swing Up turns signals into research alerts.</h1><p>Swing Up collects market signals, stores raw receipts first, filters weak or noisy inputs, scores serious signals, checks similar historical events, and prepares public tracking for accountability. AI Committee review happens later; Swing Up does not guarantee returns.</p><div className="button-row"><Link className="button primary" href="/public-ledger">View public ledger</Link><Link className="button" href="/risk-disclaimer">Read risk disclaimer</Link></div></div><div className="card methodology-flow">{["Raw signals stored", "Noise filtered", "Serious signals scored", "History checked", "Receipts and risks published"].map((step, index) => <div className="metric" key={step}><span>Step {index + 1}</span><strong>{step}</strong></div>)}</div></section>
    <section className="grid two trust-section"><div className="card"><h2>Research support, not guarantees</h2><p>Swing Up is built to support market research and decision-making. It is not personal financial advice, and every score should be treated as a research signal rather than a promise of performance.</p></div><div className="card"><h2>Signal sources</h2><ul className="receipts">{watchItems.map((item) => <li key={item}>{item}</li>)}</ul></div></section>
    <section className="grid two trust-section">{methodologySections.map(([title, body]) => <article className="card" key={title}><span className="badge">Method</span><h3>{title}</h3><p>{body}</p></article>)}</section>
  </div>;
}
