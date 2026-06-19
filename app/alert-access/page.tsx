const accessLevels = [
  ["Free preview", "May show delayed or limited alert education so users can learn the format without paid access claims."],
  ["Paid access", "Reserved for future gated alert features after account, billing, support, and safety controls are ready."],
  ["Delayed public view", "Some alerts may appear later for transparency and ledger review, not for time-sensitive action."],
  ["Admin review", "Internal users can inspect candidate alerts before anything becomes user-facing."],
];

const delayReasons = ["Receipts need to be attached and readable", "Source health may be degraded or not configured", "Risk language needs review before publication", "Paid access must not launch before support and security are ready"];

export default function AlertAccessPage() {
  return <div className="page">
    <section className="hero trust-hero"><div><div className="eyebrow">Build 99 · Alert access</div><h1>Why alerts can be free, paid, delayed, or hidden.</h1><p>Alert access rules help users understand why some research appears immediately, some appears later, and some remains behind review or future paid gates.</p></div><article className="card risk-callout"><span className="badge">No urgency claims</span><h2>Delay can be a safety feature.</h2><p>A slower alert with receipts and risk context is more responsible than a fast alert that hides uncertainty.</p></article></section>
    <section className="grid two trust-section">{accessLevels.map(([title, body]) => <article className="card" key={title}><span className="badge">Access mode</span><h2>{title}</h2><p>{body}</p></article>)}</section>
    <section className="grid two trust-section"><article className="card"><span className="badge">Delay reasons</span><h2>Why an alert might wait</h2><div className="disclaimer-list">{delayReasons.map((reason) => <div className="metric" key={reason}><span>{reason}</span></div>)}</div></article><article className="card"><span className="badge">Disclosure</span><h2>Research support only.</h2><p>Access level does not make an alert a recommendation or a guarantee. Users remain responsible for independent review and decisions.</p></article></section>
  </div>;
}
