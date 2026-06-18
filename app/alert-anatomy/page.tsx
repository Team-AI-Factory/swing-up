const disclaimer =
  "Swing Up provides market research and decision-support information. It does not guarantee returns. Investing involves risk, including possible loss of capital. Users are responsible for their own decisions.";

const actionLabels = [
  "Buy Candidate",
  "Speculative Buy Candidate",
  "Watch",
  "Sell Review",
  "Avoid",
  "No Action",
];

const anatomySections = [
  ["Action label", "The approved research label that summarizes the setup in plain language. It is not an instruction to trade."],
  ["Ticker and company", "The stock symbol and company name, shown together so readers know exactly which public company the alert covers."],
  ["Event", "The public signal, operating development, or market-relevant change that caused Swing Up to review the company."],
  ["Current price", "The reference price used for the alert example or publication snapshot."],
  ["Target price range", "A research range that frames possible outcomes. It is not a promised result or guaranteed forecast."],
  ["Potential upside/downside", "The estimated move from the current price to the target range, used to make the risk/reward tradeoff easier to compare."],
  ["Profit Potential Score", "A 0–100 research score that summarizes the possible opportunity size and setup quality."],
  ["Evidence Confidence Score", "A 0–100 research score that summarizes how strong, consistent, and receipt-backed the evidence appears to be."],
  ["Risk Level", "A plain-language risk marker that highlights whether the setup appears lower, medium, high, or unusually uncertain."],
  ["Priced-In Check", "A note on whether the market may already reflect the signal, which can reduce the chance of a fresh move."],
  ["Historical Pattern Match", "Context from similar past setups. It helps frame expectations, but history does not have to repeat."],
  ["Ripple Effect", "Related companies, suppliers, customers, or market areas that may be affected by the same signal."],
  ["Risks", "Key reasons the alert could be wrong, delayed, incomplete, or less useful than expected."],
  ["Receipts", "The public or mock evidence items behind the alert, listed so the reasoning can be checked instead of taken on trust."],
  ["Public Ledger tracking result", "The follow-up status used to track what happened after publication, including open, win, loss, or neutral outcomes."],
];

export default function AlertAnatomyPage() {
  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Alert anatomy</div>
          <h1>How to Read a Swing Up Alert</h1>
          <p>
            Swing Up alerts are designed to show the signal, the evidence, the risk, and the public tracking result — not just a hype headline.
          </p>
        </div>
        <article className="card">
          <div className="eyebrow">Mock example alert card</div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "start", marginTop: 10 }}>
            <div>
              <h2>MCK</h2>
              <p style={{ marginTop: 0 }}>Mock Components Co.</p>
            </div>
            <span className="badge">Risk: Medium</span>
          </div>
          <p><strong>Action:</strong> Watch</p>
          <p><strong>Event:</strong> Mock supplier receipts suggest a possible inventory rebuild after two quiet quarters.</p>
          <div className="grid two">
            <div className="metric"><span>Current price</span><strong>$42.00</strong></div>
            <div className="metric"><span>Target price range</span><strong>$46–$49</strong></div>
            <div className="metric"><span>Potential upside/downside</span><strong>+9.5% to +16.7%</strong></div>
            <div className="metric"><span>Historical Pattern Match</span><strong>71%</strong></div>
          </div>
          <div className="grid two" style={{ marginTop: 16 }}>
            <div className="metric"><span>Profit Potential Score</span><strong>74 / 100</strong></div>
            <div className="metric"><span>Evidence Confidence Score</span><strong>68 / 100</strong></div>
          </div>
          <p><strong>Priced-In Check:</strong> Not clearly priced in; the mock signal has not yet appeared in broad market commentary.</p>
          <p><strong>Historical Pattern Match:</strong> Similar to prior inventory-rebuild setups, but confirmation is still limited.</p>
          <h3>Ripple Effect</h3>
          <p>Related mock distributors and component suppliers may be worth watching for matching evidence.</p>
          <h3>Risks</h3>
          <ul className="receipts">
            <li>Demand may fade before orders are confirmed.</li>
            <li>Supplier data may be noisy or delayed.</li>
            <li>The stock may already reflect part of the expected recovery.</li>
          </ul>
          <h3>Receipts</h3>
          <ul className="receipts">
            <li>Mock purchase-order trend note</li>
            <li>Mock distributor inventory comment</li>
            <li>Mock shipping-volume snapshot</li>
          </ul>
          <h3>Public Ledger tracking result</h3>
          <p>Open: tracking from $42.00 with a 30-day review window.</p>
        </article>
      </section>

      <section className="trust-section card risk-callout">
        <span className="badge">Important</span>
        <h2>Research support, not personal advice</h2>
        <p>{disclaimer}</p>
      </section>

      <section className="trust-section">
        <div className="card">
          <span className="badge">Approved labels only</span>
          <h2>Action labels used by Swing Up</h2>
          <p>Every alert uses one of these approved public research labels.</p>
          <div className="grid three">
            {actionLabels.map((label) => (
              <div className="metric" key={label}>
                <span>Label</span>
                <strong>{label}</strong>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid three trust-section">
        {anatomySections.map(([title, body]) => (
          <article className="card" key={title}>
            <h3>{title}</h3>
            <p>{body}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
