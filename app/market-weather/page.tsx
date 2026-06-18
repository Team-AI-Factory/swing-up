const weatherSections = [
  {
    title: "Bullish weather",
    body: "Bullish weather means the wider market is generally moving with the signal. More stocks may be rising, buyers may be more active, and positive company news may receive a warmer reaction.",
  },
  {
    title: "Bearish weather",
    body: "Bearish weather means the wider market is generally pushing against new ideas. Even good company news can struggle when indexes, sectors, or investors are defensive.",
  },
  {
    title: "Mixed weather",
    body: "Mixed weather means the market is not sending one clear message. Some areas may be strong while others are weak, so Swing Up treats the backdrop as a reason to be more selective.",
  },
  {
    title: "Risk-on mood",
    body: "Risk-on mood means investors appear more willing to own growth, cyclicals, small caps, crypto-linked names, or other higher-volatility assets.",
  },
  {
    title: "Risk-off mood",
    body: "Risk-off mood means investors appear more cautious. Money may favor cash, defensive sectors, larger quality companies, or other areas perceived as safer.",
  },
  {
    title: "Sector tailwind",
    body: "A sector tailwind means the company signal is helped by strength in its industry group. A positive signal is easier to trust when similar businesses are also improving.",
  },
  {
    title: "Sector headwind",
    body: "A sector headwind means the company signal is fighting weakness in its industry group. A strong single-company story may need extra evidence when peers are under pressure.",
  },
  {
    title: "Macro pressure",
    body: "Macro pressure includes rates, inflation, employment, growth, credit, and other economic forces that can change investor appetite or company fundamentals.",
  },
  {
    title: "News shock",
    body: "A news shock is a sudden headline, event, or public narrative that can overwhelm normal signal reading. It can make prices move before the facts are fully understood.",
  },
  {
    title: "Crypto risk appetite",
    body: "Crypto risk appetite helps read whether speculative demand is expanding or contracting. It can matter for crypto-linked equities, fintech, miners, exchanges, and broader risk mood.",
  },
  {
    title: "FX pressure",
    body: "FX pressure means currency moves may affect revenue, costs, commodity relationships, or international comparisons for companies with global exposure.",
  },
];

const examples = [
  {
    title: "Good company news during bullish market",
    body: "If a company posts strong results while the market is already supportive, the signal may have the wind behind it. Swing Up would still look for receipts and risk checks.",
  },
  {
    title: "Good company news during bearish market",
    body: "The same strong results may be ignored or faded if investors are selling broadly. The signal may be real, but the weather can make follow-through harder.",
  },
  {
    title: "Bad news during weak sector conditions",
    body: "If a company disappoints while its whole sector is already weak, the negative reaction may be larger because the company and sector are pointing the same way.",
  },
  {
    title: "Strong signal with poor market weather",
    body: "A high-quality signal can still deserve attention, but poor weather may reduce confidence, slow timing, or raise the need for additional confirmation.",
  },
];

const futureInputs = [
  "Polygon/Massive for market breadth and prices.",
  "Benzinga for financial news.",
  "GDELT for public news radar.",
  "FRED for macro context.",
  "CoinGecko for crypto mood.",
  "Frankfurter for FX context.",
];

const disclaimer =
  "Swing Up provides market research and decision-support information. It does not guarantee returns. Investing involves risk, including possible loss of capital. Users are responsible for their own decisions.";

export default function MarketWeatherPage() {
  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Market weather guide v1</div>
          <h1>Market Weather: The Wind Behind Every Signal</h1>
          <p>
            The same company signal can mean different things in a bullish market, bearish market, or mixed market.
          </p>
        </div>
        <div className="card risk-callout">
          <span className="badge">Plain-English context</span>
          <h2>Weather changes the backdrop</h2>
          <p>
            Market weather helps explain whether the broader environment is helping a signal, fighting it, or making it harder to read.
          </p>
        </div>
      </section>

      <section className="grid two trust-section">
        {weatherSections.map((section) => (
          <article className="card" key={section.title}>
            <span className="badge">Weather factor</span>
            <h3>{section.title}</h3>
            <p>{section.body}</p>
          </article>
        ))}
      </section>

      <section className="trust-section">
        <div className="card">
          <span className="badge">Simple examples</span>
          <h2>Same signal, different weather</h2>
          <div className="grid two">
            {examples.map((example) => (
              <article className="card" key={example.title}>
                <h3>{example.title}</h3>
                <p>{example.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="grid two trust-section">
        <div className="card methodology-flow">
          <span className="badge">Later use</span>
          <h2>How Swing Up will use market weather later</h2>
          {futureInputs.map((input, index) => (
            <div className="metric" key={input}>
              <span>Input {index + 1}</span>
              <strong>{input}</strong>
            </div>
          ))}
        </div>
        <div className="card risk-callout">
          <span className="badge">Safety boundary</span>
          <h2>Market weather is context, not a prediction.</h2>
          <p>
            It can help explain the environment around a signal, but it does not know the future and should not be treated as a promise, command, or guarantee.
          </p>
          <p>{disclaimer}</p>
        </div>
      </section>
    </div>
  );
}
