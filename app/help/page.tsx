const faqs = [
  ["What does Swing Up do?", "Swing Up helps organize market signals into research support. It stores receipts, filters noise, adds context, and tracks outcomes so users can review ideas more clearly."],
  ["Is this financial advice?", "No. Swing Up is not personal financial advice. It does not know a user's full financial situation, goals, time horizon, or risk tolerance."],
  ["Does Swing Up guarantee returns?", "No. Swing Up does not guarantee returns, price moves, or outcomes. Markets are uncertain, and investing can lead to losses."],
  ["Why does every alert need receipts?", "Receipts help users see where an alert came from. They make the research easier to question, verify, and review later."],
  ["What does public tracking mean?", "Public tracking means alert outcomes can be recorded in a visible ledger, so the product can be judged against what happened after publication."],
  ["Why are some features marked stubbed or not configured?", "Those labels mean the product is showing planned boundaries without pretending that live integrations are already active."],
  ["When will payments be added?", "Payments are planned for a later stage. They are not added in this version, so the educational pages can stay focused and low-risk."],
  ["Why are real AI calls and real market APIs not connected yet?", "They are intentionally not connected yet. Swing Up is separating product structure from live external systems until those integrations are ready to be reviewed safely."],
];

const disclaimer = "Swing Up provides market research and decision-support information. It does not guarantee returns. Investing involves risk, including possible loss of capital. Users are responsible for their own decisions.";

export default function HelpPage() {
  return <div className="page">
    <section className="hero trust-hero"><div><div className="eyebrow">Help Centre</div><h1>Simple answers for new users.</h1><p>Use this page to understand what Swing Up does, what it does not do, and why the product is built around receipts, public tracking, and clear risk language.</p></div><div className="card risk-callout"><span className="badge">Disclaimer</span><h2>Know the boundary</h2><p>{disclaimer}</p></div></section>
    <section className="grid two trust-section">{faqs.map(([question, answer]) => <article className="card" key={question}><span className="badge">FAQ</span><h3>{question}</h3><p>{answer}</p></article>)}</section>
  </div>;
}
