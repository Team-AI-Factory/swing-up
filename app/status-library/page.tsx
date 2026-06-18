const disclaimer =
  "Swing Up provides market research and decision-support information. It does not guarantee returns. Investing involves risk, including possible loss of capital. Users are responsible for their own decisions.";

const safetyNote =
  "Statuses are research workflow labels. They are not guarantees, not personal financial advice, and not instructions to buy or sell.";

const statusGroups = [
  {
    title: "Source Health statuses",
    description: "These labels explain whether an information source is ready to support the research workflow.",
    items: [
      {
        label: "connected",
        means: "The source is configured and the latest check says it is reachable.",
        doesNotMean: "It does not mean every item from the source is useful, complete, or investment-ready.",
        next: "Swing Up can continue checking the source and may use its records as research inputs.",
      },
      {
        label: "not_configured",
        means: "The source exists in the product plan, but required settings or keys are not in place.",
        doesNotMean: "It does not mean the source failed or produced a bad signal.",
        next: "The source remains inactive until configuration is added and checked.",
      },
      {
        label: "stubbed",
        means: "A placeholder is present so the workflow shape is visible before a real connection is added.",
        doesNotMean: "It does not mean live data is being collected from that source.",
        next: "The placeholder may later be replaced by a real integration after review.",
      },
      {
        label: "degraded",
        means: "The source is partially working, delayed, incomplete, or producing lower-confidence results.",
        doesNotMean: "It does not mean every record from the source is wrong.",
        next: "Swing Up treats the source carefully and may wait for recovery or more confirmation.",
      },
      {
        label: "error",
        means: "The latest check found a failure that prevents normal use of the source.",
        doesNotMean: "It does not mean the underlying company, market, or signal has a problem.",
        next: "The issue needs review before the source can be trusted in the workflow again.",
      },
    ],
  },
  {
    title: "Raw Signal statuses",
    description: "These labels show where an early signal sits before it becomes serious research material.",
    items: [
      { label: "new", means: "A signal has been received and saved for initial review.", doesNotMean: "It does not mean the signal is important or accurate.", next: "The signal can move into the queue for filtering." },
      { label: "queued", means: "The signal is waiting for the filtering step.", doesNotMean: "It does not mean the signal has passed quality checks.", next: "Swing Up reviews the signal for noise, duplication, freshness, and relevance." },
      { label: "filtered", means: "The signal has been reviewed and sorted by the filter step.", doesNotMean: "It does not mean the signal is automatically a strong opportunity.", next: "It may be promoted, rejected, or held for additional context." },
      { label: "promoted", means: "The signal looks useful enough to continue deeper research.", doesNotMean: "It does not mean Swing Up is telling anyone to buy or sell.", next: "The signal may be compared with patterns, evidence, risk, and possible outcomes." },
      { label: "rejected", means: "The signal is not useful enough for deeper review right now.", doesNotMean: "It does not mean the related company is bad or uninvestable.", next: "The signal is kept out of the active research path unless new evidence appears." },
      { label: "error", means: "Something failed while saving or processing the signal.", doesNotMean: "It does not mean the signal itself was negative.", next: "The processing issue needs review before the signal can move forward." },
    ],
  },
  {
    title: "Pattern Match confidence",
    description: "These labels describe how closely a current setup appears to match historical examples.",
    items: [
      { label: "strong", means: "The current setup has clear similarities to past events in the research set.", doesNotMean: "It does not guarantee the same outcome will happen again.", next: "Swing Up can use the match as context while still checking evidence and risk." },
      { label: "moderate", means: "The setup has some useful similarities, but the match is not complete.", doesNotMean: "It does not mean the signal is safe or certain.", next: "The match supports cautious review alongside other inputs." },
      { label: "weak", means: "Only limited similarities were found.", doesNotMean: "It does not mean the signal must be ignored.", next: "Swing Up may require stronger evidence before treating the signal seriously." },
      { label: "none", means: "No useful historical comparison was found.", doesNotMean: "It does not mean the signal is impossible or invalid.", next: "The signal must stand on current evidence, risk, and source quality." },
    ],
  },
  {
    title: "Historical Event outcomes",
    description: "These labels summarize what happened after similar past events were tracked.",
    items: [
      { label: "positive", means: "The tracked outcome moved in a favorable direction for the research thesis.", doesNotMean: "It does not guarantee future positive returns.", next: "The event may support context for similar future research." },
      { label: "negative", means: "The tracked outcome moved against the research thesis.", doesNotMean: "It does not mean every similar future setup will fail.", next: "Swing Up uses it as a caution point when reviewing similar signals." },
      { label: "neutral", means: "The tracked outcome did not clearly help or hurt the thesis.", doesNotMean: "It does not prove the signal was useless.", next: "The event can still provide timing and context lessons." },
      { label: "mixed", means: "The tracked outcome had both helpful and unhelpful evidence.", doesNotMean: "It does not provide a simple yes-or-no answer.", next: "Swing Up treats similar setups with extra care and context." },
      { label: "unknown", means: "There is not enough information to classify the outcome.", doesNotMean: "It does not mean the outcome was positive or negative.", next: "The event stays limited as evidence until more data is available." },
    ],
  },
  {
    title: "Future alert actions",
    description: "These labels describe possible research conclusions. They are not trading instructions.",
    items: [
      { label: "Buy Candidate", means: "The setup may deserve close review as a possible opportunity.", doesNotMean: "It does not tell a user to buy.", next: "Users should review the evidence, risk, timing, and their own situation." },
      { label: "Speculative Buy Candidate", means: "The setup may be interesting but has higher uncertainty or weaker confirmation.", doesNotMean: "It does not mean high returns are likely or guaranteed.", next: "Users should treat it as higher-risk research and look for confirmation." },
      { label: "Watch", means: "The idea is worth monitoring, but not strong enough for a clearer action label.", doesNotMean: "It does not mean immediate action is needed.", next: "Swing Up may wait for better evidence, price movement, or source confirmation." },
      { label: "Sell Review", means: "The evidence may justify reviewing an existing position.", doesNotMean: "It does not tell a user to sell.", next: "Users should compare the new evidence with their own plan and risk limits." },
      { label: "Avoid", means: "The setup looks unattractive because evidence, risk, or timing is weak.", doesNotMean: "It does not mean the company can never perform well.", next: "Swing Up may ignore the idea unless the facts change." },
      { label: "No Action", means: "Swing Up does not see enough reason to act on the signal.", doesNotMean: "It does not mean nothing will happen in the market.", next: "The signal may be archived or watched only if new evidence appears." },
    ],
  },
  {
    title: "Future risk labels",
    description: "These labels explain the level of uncertainty or downside risk around a research setup.",
    items: [
      { label: "Low", means: "The setup appears to have fewer obvious risk flags than other ideas.", doesNotMean: "It does not mean there is no risk.", next: "Users should still review sizing, timing, evidence, and market conditions." },
      { label: "Medium", means: "The setup has normal research uncertainty and some clear risk factors.", doesNotMean: "It does not mean the idea is balanced or safe for every user.", next: "Swing Up expects users to review the main risks before making decisions." },
      { label: "High", means: "The setup has meaningful uncertainty, volatility, weak evidence, or timing risk.", doesNotMean: "It does not guarantee a loss or a gain.", next: "Users should be especially cautious and seek stronger confirmation." },
      { label: "Extreme", means: "The setup has very high uncertainty or risk of severe downside.", doesNotMean: "It does not mean large rewards are guaranteed for taking the risk.", next: "Swing Up treats the idea as fragile and unsuitable for casual action." },
    ],
  },
];

export default function StatusLibraryPage() {
  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Status library</div>
          <h1>Swing Up Status Library</h1>
          <p>Swing Up uses clear statuses so users can see where a signal is in the research pipeline.</p>
        </div>
        <article className="card risk-callout">
          <span className="badge">Safety note</span>
          <h2>Research workflow labels only.</h2>
          <p>{safetyNote}</p>
        </article>
      </section>

      {statusGroups.map((group) => (
        <section className="trust-section card" key={group.title}>
          <div className="eyebrow">{group.title}</div>
          <h2>{group.title}</h2>
          <p>{group.description}</p>
          <div className="grid two" style={{ marginTop: 18 }}>
            {group.items.map((item) => (
              <article className="card" key={`${group.title}-${item.label}`}>
                <span className="badge">{item.label}</span>
                <h3 style={{ marginTop: 12 }}>{item.label}</h3>
                <p><strong>What it means:</strong> {item.means}</p>
                <p><strong>What it does not mean:</strong> {item.doesNotMean}</p>
                <p><strong>What happens next:</strong> {item.next}</p>
              </article>
            ))}
          </div>
        </section>
      ))}

      <section className="trust-section card risk-callout">
        <span className="badge">Disclaimer</span>
        <h2>Research support, not guarantees.</h2>
        <p>{disclaimer}</p>
      </section>
    </div>
  );
}
