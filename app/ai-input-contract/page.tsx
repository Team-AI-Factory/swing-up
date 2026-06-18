const evidenceGroups = [
  "company signal",
  "market sentiment",
  "sector context",
  "official receipts",
  "price movement",
  "historical pattern",
  "risk evidence",
  "macro backdrop",
  "crypto/FX context when relevant",
];

const hiddenDetails = [
  "exact prompts",
  "scoring weights",
  "source routing",
  "vendor stack details",
  "watchlist universe",
];

const disclaimer = "Swing Up provides market research and decision-support information. It does not guarantee returns. Investing involves risk, including possible loss of capital. Users are responsible for their own decisions.";

export default function AiInputContractPage() {
  return <div className="page">
    <section className="hero trust-hero"><div><div className="eyebrow">AI input contract</div><h1>What the Swing Up Brain Looks At</h1><p>Future AI review will consider broad evidence groups together, not one headline in isolation. The goal is to compare a signal against receipts, market context, historical behavior, and risk evidence before it supports any research output.</p></div><div className="card methodology-flow">{evidenceGroups.slice(0, 5).map((group, index) => <div className="metric" key={group}><span>Input group {index + 1}</span><strong>{group}</strong></div>)}</div></section>
    <section className="grid two trust-section"><article className="card"><span className="badge">Broad evidence only</span><h2>Evidence groups the future brain may consider</h2><p>Swing Up describes the categories at a high level so users understand the research posture without exposing prompts, weights, or proprietary recipes.</p><ul className="receipts">{evidenceGroups.map((group) => <li key={group}>{group}</li>)}</ul></article><article className="card"><span className="badge">Protected details</span><h2>What we do not reveal</h2><p>Some operational details stay private so the system remains resilient and harder to manipulate.</p><ul className="receipts">{hiddenDetails.map((detail) => <li key={detail}>{detail}</li>)}</ul></article></section>
    <section className="grid two trust-section"><article className="card"><h2>Why this protects users</h2><p>Publishing broad input categories gives users transparency about what kinds of evidence matter while reducing copycat abuse. Keeping the exact recipes private makes the system harder to game, discourages shallow imitation, and helps preserve the usefulness of research checks over time.</p></article><article className="card risk-callout"><span className="badge">Important</span><h2>Research support, not guarantees</h2><p>{disclaimer}</p></article></section>
  </div>;
}
