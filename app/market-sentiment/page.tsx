const sentimentModes = [
  {
    title: "Bullish market",
    body: "A bullish market backdrop means broad price direction, index participation, and investor demand appear supportive. In that setting, a strong stock-specific signal may have more room to work because the broader market wind is helping it.",
  },
  {
    title: "Bearish market",
    body: "A bearish market backdrop means broad selling pressure, weak participation, or defensive positioning may be working against new ideas. Even a good company signal can be discounted when the wider market is fighting it.",
  },
  {
    title: "Mixed market",
    body: "A mixed market means the evidence is split: some indexes, sectors, or themes may be improving while others remain weak. Swing Up treats this as a reason to be more selective rather than assuming the whole market is supportive or hostile.",
  },
  {
    title: "Risk-on mood",
    body: "Risk-on conditions suggest investors are more willing to own growth, cyclicals, small caps, crypto-linked assets, or other higher-volatility areas. This can support aggressive setups, but it is still not proof that any single idea will work.",
  },
  {
    title: "Risk-off mood",
    body: "Risk-off conditions suggest investors are moving toward cash, defensive sectors, bonds, large quality companies, or other perceived safer areas. This can make speculative or fragile signals harder to trust.",
  },
  {
    title: "Sector mood",
    body: "Sector mood asks whether the company signal is aligned with its industry group. A positive stock signal is stronger when its sector is also improving and weaker when peers are under pressure.",
  },
  {
    title: "Macro pressure",
    body: "Macro pressure covers rates, inflation, employment, growth, and other economic forces that can change valuation, demand, financing costs, and investor appetite across the market.",
  },
  {
    title: "News mood",
    body: "News mood reviews whether fresh reporting and broad public narratives are supportive, hostile, noisy, or already well known. Swing Up values receipts over hype and treats news as context rather than certainty.",
  },
  {
    title: "Crypto risk appetite",
    body: "Crypto risk appetite helps judge whether digital-asset conditions are encouraging or discouraging risk-taking. This may matter for crypto-linked equities, fintech, miners, exchanges, and broader speculative sentiment.",
  },
  {
    title: "FX pressure",
    body: "FX pressure considers currency moves that can affect multinational revenue, import costs, commodity relationships, and comparisons across regions. Currency context can help explain why a signal is easier or harder to act on.",
  },
];

const futureInputs = [
  "Polygon/Massive for price direction and breadth.",
  "Benzinga for breaking financial news.",
  "GDELT for broad public news radar.",
  "FRED for rates, inflation, unemployment, and GDP.",
  "CoinGecko for crypto risk appetite.",
  "Frankfurter for FX context.",
  "SEC EDGAR for official receipts.",
];

const sentimentLimits = [
  "Not a guarantee.",
  "Not a buy/sell command.",
  "Not personal financial advice.",
  "Can change quickly.",
];

export default function MarketSentimentPage() {
  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Market sentiment methodology v1</div>
          <h1>How Swing Up Reads Market Sentiment</h1>
          <p>
            A stock signal is stronger when the market wind is helping it, and weaker when the market wind is fighting it.
          </p>
        </div>
        <div className="card risk-callout">
          <span className="badge">Decision support</span>
          <h2>Backdrop before conviction</h2>
          <p>
            Swing Up will use sentiment as market context around a signal, not as a standalone prediction or instruction to trade.
          </p>
        </div>
      </section>

      <section className="grid two trust-section">
        {sentimentModes.map((mode) => (
          <article className="card" key={mode.title}>
            <span className="badge">Sentiment input</span>
            <h3>{mode.title}</h3>
            <p>{mode.body}</p>
          </article>
        ))}
      </section>

      <section className="grid two trust-section">
        <div className="card methodology-flow">
          <span className="badge">Future source inputs</span>
          <h2>What Swing Up will listen to</h2>
          {futureInputs.map((input, index) => (
            <div className="metric" key={input}>
              <span>Input {index + 1}</span>
              <strong>{input}</strong>
            </div>
          ))}
        </div>
        <div className="card risk-callout">
          <span className="badge">Safety boundary</span>
          <h2>What sentiment does not mean</h2>
          <ul className="receipts">
            {sentimentLimits.map((limit) => (
              <li key={limit}>{limit}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="trust-section">
        <div className="card">
          <span className="badge">Disclaimer</span>
          <h2>Proof, risk, and public tracking included.</h2>
          <p>
            Swing Up provides market research and decision-support information. It does not guarantee returns. Investing involves risk, including possible loss of capital. Users are responsible for their own decisions.
          </p>
        </div>
      </section>
    </div>
  );
}
