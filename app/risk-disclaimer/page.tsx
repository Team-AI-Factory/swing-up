import Link from "next/link";

const points = [
  "Alerts are market research and decision-support information, not personal financial advice.",
  "Users are responsible for their own research, position sizing, timing, and investment decisions.",
  "Scores are research signals, not guarantees of price movement or returns.",
  "Past performance and historical pattern matches do not guarantee future results.",
  "Public tracking is for accountability and transparency, not proof of future returns.",
];

export default function RiskDisclaimerPage() {
  return <div className="page">
    <section className="hero trust-hero"><div><div className="eyebrow">Risk disclaimer</div><h1>Risk, responsibility, and decision support.</h1><p>Swing Up provides market research and decision-support information. It does not guarantee returns. Investing involves risk, including possible loss of capital. Users are responsible for their own decisions.</p><div className="button-row"><Link className="button primary" href="/methodology">Read methodology</Link><Link className="button" href="/public-ledger">View public ledger</Link></div></div><div className="card risk-callout"><div className="badge">Important</div><h2>No alert removes risk.</h2><p>A calm process can improve research discipline, but markets can move against any thesis. Treat every alert as a starting point for your own review.</p></div></section>
    <section className="card trust-section"><h2>What users should understand</h2><div className="disclaimer-list">{points.map((point) => <div className="metric" key={point}><span>{point}</span></div>)}</div></section>
  </div>;
}
