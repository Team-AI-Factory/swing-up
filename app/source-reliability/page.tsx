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
  ["Strong evidence", "Primary, timely, and directly connected evidence that can stand on its own as a serious research input."],
  ["Supporting evidence", "Credible confirmation that strengthens a setup when paired with stronger source material or market data."],
  ["Context evidence", "Useful background that helps explain timing, sector conditions, macro pressure, or historical behavior."],
  ["Weak/noisy evidence", "Thin, vague, duplicated, stale, or hype-driven material that needs careful discounting."],
  ["Rejected evidence", "Material that is too unclear, irrelevant, stale, duplicated, or unsupported to help users evaluate an alert."],
];

const strongerEvidence = [
  "official source",
  "clear timestamp",
  "direct company connection",
  "source URL or receipt",
  "market-moving event",
  "cross-source confirmation",
  "historical similarity",
];

const weakEvidence = [
  "vague headline",
  "no source URL",
  "repeated article",
  "old news",
  "no clear company connection",
  "hype without receipt",
  "no measurable market relevance",
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
          <span className="badge">Trust standard</span>
          <h2>Evidence quality comes first.</h2>
          <p>
            Source reliability helps users understand why an alert deserves attention, where its evidence came from, and which inputs should be treated cautiously.
          </p>
        </article>
      </section>

      <section className="trust-section card">
        <span className="badge">Broad source categories</span>
        <h2>What Swing Up reviews</h2>
        <p>
          Swing Up groups evidence into broad categories so users can understand the research approach without exposing private routing, vendor selection, or collection mechanics.
        </p>
        <div className="grid two">
          {sourceCategories.map((category) => (
            <article className="metric" key={category}>
              <span>{category}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="trust-section card">
        <span className="badge">Reliability tiers</span>
        <h2>How evidence is grouped</h2>
        <div className="grid two">
          {reliabilityTiers.map(([tier, body]) => (
            <article className="metric" key={tier}>
              <span>{body}</span>
              <strong>{tier}</strong>
            </article>
          ))}
        </div>
      </section>

      <section className="grid two trust-section">
        <article className="card">
          <span className="badge">Stronger evidence</span>
          <h2>What increases confidence</h2>
          <ul className="receipts">
            {strongerEvidence.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
        <article className="card">
          <span className="badge">Weak evidence</span>
          <h2>What reduces confidence</h2>
          <ul className="receipts">
            {weakEvidence.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </section>

      <section className="grid two trust-section">
        <article className="card">
          <span className="badge">Receipts, not secrets</span>
          <h2>Receipts, not secrets</h2>
          <p>
            Swing Up shows users the evidence behind each alert, but does not publish the full scoring recipe, vendor routing, polling schedule, or AI review process.
          </p>
        </article>
        <article className="card">
          <span className="badge">User protection</span>
          <h2>Why this protects users</h2>
          <p>
            Keeping the exact recipe private helps protect alert quality, reduce copycat abuse, and prevent attempts to game the system with low-quality or manipulative inputs.
          </p>
        </article>
      </section>

      <section className="trust-section card risk-callout">
        <span className="badge">Important safety note</span>
        <h2>Research quality is not certainty</h2>
        <p>
          Source reliability improves research quality, but it does not guarantee a correct investment outcome.
        </p>
        <p>{disclaimer}</p>
      </section>
    </div>
  );
}
