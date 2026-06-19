type AccessTopic = {
  title: string;
  label: string;
  summary: string;
  points: string[];
};

const accessTopics: AccessTopic[] = [
  {
    title: "Free alerts",
    label: "No login required",
    summary: "Free alerts are meant to help people understand how Swing Up explains market signals before paid access is enforced.",
    points: [
      "They may include public examples, education-focused writeups, and delayed research summaries.",
      "They should be understandable without a subscription or checkout step.",
      "They are still research information, not personal financial advice.",
    ],
  },
  {
    title: "Delayed public alerts",
    label: "Public later",
    summary: "Some alerts may become public only after early review windows have passed or after the research is ready for broader reading.",
    points: [
      "A delayed alert can still show what was observed, why it mattered, and how it was tracked.",
      "Delay helps separate public education from early-access research features.",
      "Delayed does not mean useless; it means the timing and access level are different.",
    ],
  },
  {
    title: "Paid early access alerts",
    label: "Earlier research",
    summary: "Paid access may provide earlier or deeper research surfaces when paid tiers are introduced.",
    points: [
      "Paid access gives earlier or deeper research access, not guaranteed returns.",
      "Every serious alert should still show proof, risk, and tracking.",
      "Paid users should still evaluate uncertainty, timing, liquidity, and downside risk themselves.",
    ],
  },
  {
    title: "Watchlist-based alerts",
    label: "User focused",
    summary: "Watchlist-based alerts may help users follow names or themes they already care about.",
    points: [
      "A watchlist can make alerts more relevant by matching research to saved companies, sectors, or themes.",
      "Watchlist matching is a filtering and organization feature, not a promise that an alert is correct.",
      "Users should still compare any watchlist alert with proof, risks, and public tracking notes.",
    ],
  },
];

const delayReasons = [
  "The alert needs more evidence, a cleaner source receipt, or a better risk explanation before public release.",
  "The research may be reserved for an early-access window before it becomes delayed public content.",
  "The team may need time to check whether the signal is stale, duplicated, already priced in, or too weak to publish.",
];

const ledgerNotes = [
  "Public ledger visibility helps readers see how alerts are tracked after publication.",
  "Ledger entries should make it easier to review status, outcome context, and whether the original research held up.",
  "A public ledger is for accountability and learning; it does not turn alerts into guaranteed predictions.",
];

export default function AlertAccessPage() {
  return (
    <main className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Alert access</div>
          <h1>How free, delayed, and paid alerts may work.</h1>
          <p>
            Swing Up alerts are research and education surfaces. This page explains what users may see for free, what may be delayed,
            and what paid early access could mean before paid tiers are enforced.
          </p>
          <div className="button-row" aria-label="Alert access rules">
            <span className="badge">Static explainer</span>
            <span className="badge">No login required</span>
            <span className="badge">No checkout connected</span>
          </div>
        </div>

        <article className="card risk-callout" aria-label="Important access disclaimer">
          <span className="badge">Important</span>
          <h2>Access is not a performance promise.</h2>
          <p>Paid access gives earlier or deeper research access, not guaranteed returns.</p>
          <p>Every serious alert should still show proof, risk, and tracking.</p>
        </article>
      </section>

      <section className="grid two trust-section" aria-label="Alert access types">
        {accessTopics.map((topic) => (
          <article className="card" key={topic.title}>
            <span className="badge">{topic.label}</span>
            <h2 style={{ marginTop: 14 }}>{topic.title}</h2>
            <p>{topic.summary}</p>
            <ul className="receipts">
              {topic.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      <section className="grid two trust-section">
        <article className="card">
          <span className="badge">Why delays happen</span>
          <h2>Why some alerts may be delayed</h2>
          <p>
            A delay can protect clarity, research quality, and access boundaries. It should not be used to hide weak evidence or avoid
            tracking what happened after publication.
          </p>
          <ul className="receipts">
            {delayReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </article>

        <article className="card">
          <span className="badge">Public tracking</span>
          <h2>Public ledger visibility</h2>
          <p>
            Alerts should be easier to trust when readers can see the original reasoning, the risk notes, and the follow-up status in one
            public tracking trail.
          </p>
          <ul className="receipts">
            {ledgerNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </article>
      </section>

      <section className="trust-section">
        <article className="card risk-callout">
          <span className="badge">Risk reminder</span>
          <h2>Earlier access still has uncertainty</h2>
          <p>
            Markets can ignore good research, move before an alert is read, reverse quickly, or react to unrelated news. Paid access may
            organize information sooner, but it cannot remove market risk or guarantee a profitable result.
          </p>
        </article>
      </section>
    </main>
  );
}
