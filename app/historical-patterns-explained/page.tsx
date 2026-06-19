const matchLabels = [
  {
    label: "Strong",
    meaning:
      "The current setup closely resembles one or more past events across the most important evidence, timing, market context, and price-behavior clues.",
  },
  {
    label: "Moderate",
    meaning:
      "The current setup shares several useful similarities with past events, but some details are different or the evidence is less complete.",
  },
  {
    label: "Weak",
    meaning:
      "The current setup has only a few similarities with past events, so the comparison may be useful background but should carry limited weight.",
  },
  {
    label: "No clear match",
    meaning:
      "Swing Up does not see enough similarity to a known past setup to describe the signal as a meaningful historical comparison.",
  },
];

const sections = [
  {
    eyebrow: "Meaning",
    title: "What Historical Pattern Match means",
    body:
      "Historical Pattern Match asks: have we seen something similar before, and what happened next? It is a simple research lens that compares a new market signal with older market events that had related facts, timing, behavior, or context.",
  },
  {
    eyebrow: "Why compare",
    title: "Why Swing Up compares new signals to old market events",
    body:
      "Markets often rhyme without repeating exactly. Looking at older events can help users understand what kinds of outcomes, delays, reversals, or risks appeared after similar setups in the past.",
  },
  {
    eyebrow: "Limits",
    title: "Why similar past events do not decide the future",
    body:
      "Similar past setups can be useful, but they do not guarantee the same result. A company, sector, macro backdrop, liquidity condition, or news cycle can change enough to make the next outcome different.",
  },
  {
    eyebrow: "Data inputs",
    title: "What data can be used in pattern matching",
    body:
      "Pattern matching can consider signal type, source quality, evidence strength, price movement, volume behavior, market sentiment, sector context, timing, volatility, and what happened after older comparable events.",
  },
  {
    eyebrow: "Human judgment",
    title: "How pattern matching supports decision-making",
    body:
      "Swing Up provides research support, not guaranteed predictions. Pattern matching can organize historical context, but users still need to consider risk, position sizing, time horizon, and their own judgment.",
  },
];

const examples = [
  {
    eyebrow: "Example",
    title: "Example of a strong pattern match",
    body:
      "A company reports a specific operational improvement, multiple reliable sources confirm the change, price reaction is still early, and older events with similar evidence and timing often showed a follow-through period before the thesis was fully tested.",
  },
  {
    eyebrow: "Example",
    title: "Example of a weak pattern match",
    body:
      "A signal only loosely resembles an older event because the source quality, market backdrop, price reaction, or company situation is meaningfully different. In that case, history may add color but should not drive the research view by itself.",
  },
];

export default function HistoricalPatternsExplainedPage() {
  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Historical Pattern Match</div>
          <h1>A simple guide to comparing today&apos;s signals with past market events.</h1>
          <p>
            Historical Pattern Match helps explain whether a new Swing Up signal looks
            similar to older setups, what those older setups looked like, and why the
            comparison should be treated as context rather than certainty.
          </p>
        </div>
        <div className="card risk-callout">
          <span className="badge">Plain English</span>
          <h2>One question</h2>
          <p>
            Historical Pattern Match asks: have we seen something similar before, and
            what happened next?
          </p>
        </div>
      </section>

      <section className="trust-section">
        <div className="card methodology-flow">
          <span className="badge">Match labels</span>
          <h2>What Strong, Moderate, Weak, and No clear match mean</h2>
          {matchLabels.map((item) => (
            <div className="metric" key={item.label}>
              <span>{item.label}</span>
              <strong>{item.meaning}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="grid two trust-section">
        {sections.map((section) => (
          <article className="card" key={section.title}>
            <span className="badge">{section.eyebrow}</span>
            <h2>{section.title}</h2>
            <p>{section.body}</p>
          </article>
        ))}
      </section>

      <section className="grid two trust-section">
        {examples.map((example) => (
          <article className="card" key={example.title}>
            <span className="badge">{example.eyebrow}</span>
            <h2>{example.title}</h2>
            <p>{example.body}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
