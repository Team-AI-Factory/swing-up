const glossaryTerms = [
  ["Raw Signal", "An early piece of market information saved before Swing Up judges whether it is useful."],
  ["Source Health", "A check that asks whether each data source is connected, working, and trustworthy enough to use."],
  ["Signal Filter", "A review step that removes weak, repeated, stale, or noisy signals before they become serious research items."],
  ["Historical Pattern Match", "A comparison between a new signal and similar past events, used for context rather than prediction."],
  ["Profit Potential Score", "A research score that estimates whether a setup may have meaningful opportunity if the market has not already reacted."],
  ["Evidence Confidence Score", "A score for the quality, clarity, and consistency of the receipts behind a signal or alert."],
  ["Risk Level", "A simple view of what could go wrong, including volatility, timing, weak evidence, or broader market pressure."],
  ["Priced-In Check", "A check for whether the market may have already reacted to the information."],
  ["Public Ledger", "A public tracking area for alert outcomes, so research calls can be reviewed later."],
  ["Buy Candidate", "A research label for a setup that may deserve closer review as a possible opportunity."],
  ["Speculative Buy Candidate", "A higher-uncertainty research label for an idea that may be interesting but carries more risk or weaker evidence."],
  ["Watch", "A label for an idea worth monitoring, but not strong enough for action."],
  ["Sell Review", "A label that suggests reviewing whether an existing position still fits the evidence and risk."],
  ["Avoid", "A label for ideas where the evidence, risk, or setup does not look attractive."],
  ["No Action", "A label meaning Swing Up does not see enough reason to act on the signal."],
  ["Catalyst", "An event or change that could cause investors to re-evaluate a company, sector, or market."],
  ["Receipts", "The source material behind an alert, such as filings, links, notes, or stored signal details."],
  ["Ripple Effect", "A possible second-order impact where one event affects related companies, suppliers, competitors, or sectors."],
  ["Not Configured", "A feature or source exists in the plan, but the required settings or keys have not been added yet."],
  ["Stubbed", "A placeholder is present so the product shape is clear, but the real integration is intentionally not connected yet."],
];

const disclaimer = "Swing Up provides market research and decision-support information. It does not guarantee returns. Investing involves risk, including possible loss of capital. Users are responsible for their own decisions.";

export default function GlossaryPage() {
  return <div className="page">
    <section className="hero trust-hero"><div><div className="eyebrow">Glossary</div><h1>Plain-language Swing Up terms.</h1><p>These definitions explain common Swing Up labels in calm, simple language. They are meant to help users understand research pages, not to tell anyone what to buy or sell.</p></div><div className="card risk-callout"><span className="badge">Important</span><h2>Research support only</h2><p>{disclaimer}</p></div></section>
    <section className="grid two trust-section">{glossaryTerms.map(([term, definition]) => <article className="card" key={term}><span className="badge">Term</span><h3>{term}</h3><p>{definition}</p></article>)}</section>
  </div>;
}
