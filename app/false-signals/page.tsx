const rejectionReasons = [
  [
    "Duplicate headlines",
    "Repeating the same story does not make the setup stronger. Swing Up should collapse repeat coverage instead of treating each copy as a fresh catalyst.",
  ],
  [
    "Old news",
    "A catalyst that the market has already had time to digest can be less useful than it looks, even when the original headline was important.",
  ],
  [
    "Vague headlines",
    "Headlines that hint at movement without explaining what changed, who is affected, or why the market should care are weak inputs.",
  ],
  [
    "No reliable receipt",
    "Signals need checkable evidence. Unsourced claims, broken links, or secondhand summaries can be rejected before they become alerts.",
  ],
  [
    "No clear ticker/company match",
    "If the company, ticker, sector, or affected asset cannot be matched clearly, the signal is too ambiguous for a research alert.",
  ],
  [
    "Already priced-in news",
    "Even real news can be downgraded when the price, volume, or market narrative suggests the opportunity is already crowded.",
  ],
  [
    "Hype without evidence",
    "Excited language, viral chatter, and bold predictions are not enough without receipts that explain the underlying change.",
  ],
  [
    "Weak source quality",
    "Low-quality sources, recycled commentary, thin aggregation, or unreliable feeds can reduce confidence before a signal reaches users.",
  ],
  [
    "Bad market weather",
    "Broad selloffs, sector stress, liquidity problems, or macro pressure can make an otherwise interesting signal too risky to promote.",
  ],
  [
    "No clear upside/risk balance",
    "Swing Up should reject setups when the possible upside is unclear, the risk is too one-sided, or the timing does not support action.",
  ],
];

const exampleCards = [
  [
    "Rejected duplicate headline",
    "Rejected",
    "Three outlets repeat the same partnership announcement within an hour, but all point back to one original press release and add no new facts.",
  ],
  [
    "Rejected vague article",
    "Rejected",
    "An article says a stock could be “ready to surge” without identifying a fresh event, named source, receipt, or measurable market context.",
  ],
  [
    "Rejected old catalyst",
    "Rejected",
    "A bullish catalyst from last quarter resurfaces after the stock has already reacted and the company has since reported updated results.",
  ],
  [
    "Rejected no-source claim",
    "Rejected",
    "A social post claims a buyout is coming, but there is no filing, company statement, credible report, or other reliable receipt.",
  ],
  [
    "Promoted strong receipt example",
    "Promoted",
    "A named company files an 8-K with a material contract update, the ticker match is clear, timing is fresh, risks are visible, and price reaction is not yet crowded.",
  ],
];

const disclaimer =
  "Swing Up provides market research and decision-support information. It does not guarantee returns. Investing involves risk, including possible loss of capital. Users are responsible for their own decisions.";

export default function FalseSignalsPage() {
  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">False signal guide</div>
          <h1>Why Swing Up Rejects False Signals</h1>
          <p>
            A good market radar should ignore most noise. Swing Up is designed to reject weak signals before they become misleading alerts.
          </p>
        </div>
        <article className="card risk-callout">
          <span className="badge">Filtering principle</span>
          <h2>Less noise, better research.</h2>
          <p>
            Rejection helps keep the research process focused on signals with clearer evidence, fresher timing, stronger source quality, and a better balance between upside and risk.
          </p>
        </article>
      </section>

      <section className="trust-section card">
        <span className="badge">Why signals fail</span>
        <h2>Common reasons Swing Up rejects items</h2>
        <div className="grid two">
          {rejectionReasons.map(([title, body]) => (
            <article className="metric" key={title}>
              <span>{body}</span>
              <strong>{title}</strong>
            </article>
          ))}
        </div>
      </section>

      <section className="trust-section">
        <div className="card">
          <span className="badge">Examples</span>
          <h2>How false-signal review can look</h2>
          <div className="grid two">
            {exampleCards.map(([title, status, body]) => (
              <article className="card" key={title}>
                <span className={`badge status-${status.toLowerCase()}`}>{status}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="grid two trust-section">
        <article className="card">
          <span className="badge">Product view</span>
          <h2>Rejection is a feature, not a bug</h2>
          <p>
            A filter that promotes everything is not a filter. Swing Up is meant to be selective so users can spend less time sorting through duplicate, stale, vague, or poorly sourced market noise.
          </p>
        </article>
        <article className="card">
          <span className="badge">Feedback loop</span>
          <h2>What happens to rejected signals</h2>
          <p>
            Rejected signals can be logged, tracked, and reviewed later. That history can help improve filtering, identify recurring weak sources, and make future research decisions more consistent.
          </p>
        </article>
      </section>

      <section className="grid two trust-section">
        <article className="card risk-callout">
          <span className="badge">Safety note</span>
          <h2>Rejection does not predict price.</h2>
          <p>
            Rejecting a signal does not mean the stock cannot move. It only means the evidence was not strong enough for Swing Up’s research process.
          </p>
        </article>
        <article className="card risk-callout">
          <span className="badge">Disclaimer</span>
          <h2>Research support, not guarantees</h2>
          <p>{disclaimer}</p>
        </article>
      </section>
    </div>
  );
}
