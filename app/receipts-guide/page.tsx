const receiptTypes = [
  ["SEC filing", "A public filing such as a 10-K, 10-Q, 8-K, proxy statement, or registration document that can support or challenge the signal."],
  ["News/event source", "A credible report or event notice that explains what changed, when it changed, and why the market may care."],
  ["Company statement", "A press release, earnings call comment, investor presentation, or official update from the company."],
  ["Historical pattern", "A past setup with similar facts that helps frame context, while never proving the same result will happen again."],
  ["Price movement", "A move in price, volume, volatility, or relative strength that shows how the market is reacting."],
  ["Macro context", "Interest rates, inflation, currencies, commodities, sector conditions, or broader market forces that may affect the setup."],
  ["Regulatory source", "A regulator, court, agency, exchange, or policy source that can confirm a rule change, approval, warning, or enforcement action."],
  ["Risk evidence", "Information that could weaken the thesis, contradict the signal, or show why the timing or setup may be dangerous."],
];

const goodReceipts = [
  "Trace back to a named, checkable source.",
  "Explain why the signal matters for the company, sector, or setup.",
  "Show timing, context, and possible market impact.",
  "Include evidence that could disprove or weaken the thesis.",
];

const weakReceipts = [
  "Rely on vague claims, hype, or unsourced social chatter.",
  "Do not show why the information is market-relevant.",
  "Ignore timing, price reaction, or obvious risks.",
  "Only support the bullish case and skip what could go wrong.",
];

const notMeanings = [
  "Not a guarantee.",
  "Not personal financial advice.",
  "Not proof the stock will go up.",
  "Not a reason to blindly buy.",
];

const disclaimer =
  "Swing Up provides market research and decision-support information. It does not guarantee returns. Investing involves risk, including possible loss of capital. Users are responsible for their own decisions.";

export default function ReceiptsGuidePage() {
  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Receipts guide</div>
          <h1>What Swing Up Means by Receipts</h1>
          <p>
            Receipts are the evidence behind a signal. Swing Up should show where a signal came from, why it matters, and what could prove it wrong.
          </p>
        </div>
        <article className="card risk-callout">
          <span className="badge">Trust principle</span>
          <h2>Evidence before conviction.</h2>
          <p>
            A receipt should make the research easier to inspect. Strong receipts help users understand the source, the thesis, and the risk instead of asking them to trust a headline.
          </p>
        </article>
      </section>

      <section className="trust-section">
        <div className="card">
          <span className="badge">Receipt types</span>
          <h2>Common evidence behind a signal</h2>
          <div className="grid two">
            {receiptTypes.map(([title, body]) => (
              <article className="metric" key={title}>
                <span>{body}</span>
                <strong>{title}</strong>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="grid two trust-section">
        <article className="card">
          <span className="badge">Quality check</span>
          <h2>Good receipts vs weak receipts</h2>
          <div className="grid two">
            <div>
              <h3>Good receipts</h3>
              <ul className="receipts">
                {goodReceipts.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
            <div>
              <h3>Weak receipts</h3>
              <ul className="receipts">
                {weakReceipts.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          </div>
        </article>

        <article className="card">
          <span className="badge">Limits</span>
          <h2>What receipts do not mean</h2>
          <div className="disclaimer-list">
            {notMeanings.map((item) => (
              <div className="metric" key={item}><span>{item}</span></div>
            ))}
          </div>
        </article>
      </section>

      <section className="grid two trust-section">
        <article className="card">
          <span className="badge">Mock strong receipt</span>
          <h2>Strong receipt example</h2>
          <p>
            A company files an 8-K announcing a signed customer contract, the stock has not yet moved meaningfully, and prior similar contract announcements in the same sector are reviewed alongside risks such as margin pressure and implementation delays.
          </p>
        </article>
        <article className="card">
          <span className="badge">Mock weak receipt</span>
          <h2>Weak receipt example</h2>
          <p>
            An unsourced post says a ticker is “about to run” without a filing, company statement, price/volume context, named event, historical comparison, or explanation of what would make the claim wrong.
          </p>
        </article>
      </section>

      <section className="trust-section card risk-callout">
        <span className="badge">Important</span>
        <h2>Research support, not personal advice</h2>
        <p>{disclaimer}</p>
      </section>
    </div>
  );
}
