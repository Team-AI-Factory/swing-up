const sourceCategories = [
  "Official company filings",
  "Licensed market data",
  "Professional financial news",
  "Public news radar",
  "Macro and economic data",
  "Crypto market data",
  "FX reference data",
  "Historical pattern records",
];

const reliabilityTiers = [
  "Strong evidence",
  "Supporting evidence",
  "Context evidence",
  "Weak/noisy evidence",
  "Rejected evidence",
];

const disclaimer =
  "Swing Up provides market research and decision-support information. It does not guarantee returns. Investing involves risk, including possible loss of capital. Users are responsible for their own decisions.";

export default function SourceReliabilityPage() {
  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Source reliability</div>
          <h1>How Swing Up Judges Source Reliability</h1>
          <p>
            Swing Up gives more weight to strong evidence, official records, and verified market data than vague headlines or repeated noise.
          </p>
        </div>
        <article className="card risk-callout">
          <span className="badge">Public trust page</span>
          <h2>Evidence quality without the private recipe</h2>
          <p>
            This page summarizes the broad kinds of information Swing Up considers when evaluating research evidence, without exposing exact source routing or internal review mechanics.
          </p>
        </article>
      </section>

      <section className="trust-section card">
        <span className="badge">Broad source categories</span>
        <h2>Inputs Swing Up may consider</h2>
        <p>
          Swing Up organizes research evidence into broad categories so users can understand the quality standard without seeing exact vendors, endpoints, polling schedules, scoring weights, prompts, or watchlists.
        </p>
        <div className="grid two">
          {sourceCategories.map((category) => (
            <article className="metric" key={category}>
              <strong>{category}</strong>
            </article>
          ))}
        </div>
      </section>

      <section className="trust-section card">
        <span className="badge">Reliability tiers</span>
        <h2>How evidence is described</h2>
        <p>
          Evidence is grouped by reliability so users can separate stronger research support from context, noise, or material that should not support an alert.
        </p>
        <div className="grid two">
          {reliabilityTiers.map((tier) => (
            <article className="metric" key={tier}>
              <strong>{tier}</strong>
            </article>
          ))}
        </div>
      </section>

      <section className="grid two trust-section">
        <article className="card">
          <span className="badge">Receipts, not secrets</span>
          <h2>Receipts, not secrets</h2>
          <p>
            Swing Up shows evidence behind alerts, but does not publish the full scoring recipe, vendor routing, polling schedule, or AI review process.
          </p>
        </article>
        <article className="card">
          <span className="badge">Safety note</span>
          <h2>Research quality is not certainty</h2>
          <p>
            Source reliability improves research quality, but it does not guarantee a correct investment outcome.
          </p>
        </article>
      </section>

      <section className="trust-section card risk-callout">
        <span className="badge">Disclaimer</span>
        <h2>Market research, not guaranteed results</h2>
        <p>{disclaimer}</p>
      </section>
    </div>
  );
}
