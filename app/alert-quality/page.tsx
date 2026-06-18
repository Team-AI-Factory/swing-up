const disclaimer =
  "Swing Up provides market research and decision-support information. It does not guarantee returns. Investing involves risk, including possible loss of capital. Users are responsible for their own decisions.";

const checklistItems = [
  {
    title: "Clear catalyst",
    means: "The signal points to a specific event, change, or new piece of information that could affect expectations for a company or market theme.",
    matters: "A clear catalyst keeps the review anchored to something observable instead of a broad opinion or vague momentum story.",
    weak: "It is weak when the headline is generic, the timing is unclear, or the supposed catalyst cannot be separated from normal market noise.",
  },
  {
    title: "Reliable receipt",
    means: "The signal has a source that can be checked, such as a filing, company statement, credible article, public dataset, or other traceable receipt.",
    matters: "Receipts make the research auditable and reduce the chance that an alert candidate is built on rumor, recycled commentary, or unsupported hype.",
    weak: "It is weak when there is no source URL, the source is low quality, or the claim cannot be verified from the linked material.",
  },
  {
    title: "Company/ticker match",
    means: "The reviewed signal maps cleanly to the correct public company, ticker, subsidiary, customer, supplier, or related market exposure.",
    matters: "A strong match helps prevent false attribution, especially when companies have similar names or when a theme affects multiple stocks differently.",
    weak: "It is weak when the company is only loosely related, the ticker is ambiguous, or the signal applies to an industry but not the named company.",
  },
  {
    title: "Market sentiment context",
    means: "The review considers whether the broader market is risk-on, risk-off, skeptical, euphoric, or focused on another dominant story.",
    matters: "Market mood can change how quickly investors respond to evidence and whether good news receives attention or gets ignored.",
    weak: "It is weak when the signal is reviewed in isolation while the broader market backdrop is moving sharply against the setup.",
  },
  {
    title: "Sector context",
    means: "The signal is compared with conditions in the relevant industry, peers, supply chain, regulation, demand cycle, or commodity backdrop.",
    matters: "Sector context helps separate a company-specific development from a move that simply reflects what is happening across the whole group.",
    weak: "It is weak when peers show the opposite trend, the sector is under pressure, or the signal does not stand out from normal industry behavior.",
  },
  {
    title: "Historical pattern match",
    means: "The setup is compared with similar prior events to understand what tended to happen next and what conditions made those examples useful.",
    matters: "Pattern context can help frame expectations, but it should support the evidence rather than replace it.",
    weak: "It is weak when the comparison is superficial, the old examples are stale, or important differences are ignored.",
  },
  {
    title: "Priced-in check",
    means: "The review asks whether the market may already know, expect, or reflect the signal in the current price.",
    matters: "Even strong evidence may have limited alert value if investors have already reacted to it or if it has been widely discussed.",
    weak: "It is weak when the story is already old, heavily covered, or followed by a large price move before the candidate review begins.",
  },
  {
    title: "Risk check",
    means: "The candidate includes clear reasons it could be wrong, delayed, overstated, or outweighed by other negative information.",
    matters: "Risk checks keep the research balanced and make it easier to reject setups that look attractive only because the downside is missing.",
    weak: "It is weak when the write-up only lists positives, treats uncertainty as minor, or ignores liquidity, timing, execution, and company-specific risks.",
  },
  {
    title: "Upside/downside range",
    means: "The review frames a reasonable range of possible outcomes instead of presenting a single guaranteed target.",
    matters: "Ranges help compare potential reward with potential loss and remind readers that market outcomes are uncertain.",
    weak: "It is weak when the upside is exaggerated, downside is omitted, or the range is not connected to evidence and context.",
  },
  {
    title: "Public tracking plan",
    means: "The candidate has a plan for how it would be tracked after publication, including what would count as progress, failure, or a neutral result.",
    matters: "Tracking creates accountability and helps distinguish research discipline from one-off predictions.",
    weak: "It is weak when there is no review window, no follow-up criteria, or no clear way to evaluate what happened after the alert.",
  },
];

const rejectionExamples = [
  "vague headline",
  "no source URL",
  "duplicate article",
  "no clear company or market theme",
  "old news",
  "hype without receipt",
];

export default function AlertQualityPage() {
  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Alert quality</div>
          <h1>Swing Up Alert Quality Checklist</h1>
          <p>
            A good alert candidate needs more than a headline. It needs evidence, context, risk checks, and a reason it may not already be priced in.
          </p>
        </div>
        <article className="card risk-callout">
          <span className="badge">Checklist v1</span>
          <h2 style={{ marginTop: 14 }}>Before a signal becomes a candidate</h2>
          <p>
            This checklist is a public research standard for reviewing whether a signal is specific, receipt-backed, contextualized, and balanced enough to deserve further attention.
          </p>
        </article>
      </section>

      <section className="grid two trust-section">
        {checklistItems.map((item) => (
          <article className="card" key={item.title}>
            <span className="badge">Quality check</span>
            <h2 style={{ marginTop: 14 }}>{item.title}</h2>
            <div className="metric" style={{ alignItems: "flex-start" }}>
              <span>What it means</span>
              <strong style={{ maxWidth: 520, textAlign: "right" }}>{item.means}</strong>
            </div>
            <div className="metric" style={{ alignItems: "flex-start" }}>
              <span>Why it matters</span>
              <strong style={{ maxWidth: 520, textAlign: "right" }}>{item.matters}</strong>
            </div>
            <div className="metric" style={{ alignItems: "flex-start" }}>
              <span>What makes it weak</span>
              <strong style={{ maxWidth: 520, textAlign: "right" }}>{item.weak}</strong>
            </div>
          </article>
        ))}
      </section>

      <section className="grid two trust-section">
        <article className="card">
          <span className="badge">Reject early</span>
          <h2 style={{ marginTop: 14 }}>Automatic rejection examples</h2>
          <p>Some signals should not move forward because they lack basic evidence, freshness, specificity, or accountability.</p>
          <ul className="receipts">
            {rejectionExamples.map((example) => (
              <li key={example}>{example}</li>
            ))}
          </ul>
        </article>

        <article className="card risk-callout">
          <span className="badge">Important</span>
          <h2 style={{ marginTop: 14 }}>This checklist does not guarantee profit</h2>
          <p>
            Passing this checklist only means a signal may be structured enough for further research review. It does not mean the market will move, that timing will be favorable, or that any investment outcome is assured.
          </p>
          <p>{disclaimer}</p>
        </article>
      </section>
    </div>
  );
}
