const securityPractices = [
  ["Account access", "Use clear login boundaries and avoid exposing account-like features before the auth path is ready."],
  ["Watchlist privacy", "Treat watchlists as sensitive user intent data that should not be public by default."],
  ["Session awareness", "Future account surfaces should make device and session expectations understandable to users."],
  ["Support escalation", "Security concerns should route through support with identity, billing, and data exposure boundaries clearly separated."],
];

const userChecklist = ["Use a strong, unique password when real accounts are enabled", "Do not share login links or one-time codes", "Review status and support pages if access looks unusual", "Remember Swing Up will never need brokerage credentials for research pages"];

export default function SecurityPage() {
  return <div className="page">
    <section className="hero trust-hero"><div><div className="eyebrow">Build 100 · Account security</div><h1>Security expectations before real accounts grow.</h1><p>This page explains how Swing Up thinks about account access, watchlist sensitivity, support escalation, and user-facing security boundaries.</p></div><article className="card risk-callout"><span className="badge">Trust boundary</span><h2>No brokerage credentials.</h2><p>Swing Up research pages should not ask users for brokerage passwords, trading authority, or custody of funds.</p></article></section>
    <section className="grid two trust-section">{securityPractices.map(([title, body]) => <article className="card" key={title}><span className="badge">Security area</span><h2>{title}</h2><p>{body}</p></article>)}</section>
    <section className="grid two trust-section"><article className="card"><span className="badge">User checklist</span><h2>Simple safety habits</h2><div className="disclaimer-list">{userChecklist.map((item) => <div className="metric" key={item}><span>{item}</span></div>)}</div></article><article className="card"><span className="badge">Current state</span><h2>Security page first, deeper controls next.</h2><p>This build creates the public trust surface before richer account and watchlist controls are expanded.</p></article></section>
  </div>;
}
