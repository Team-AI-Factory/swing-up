const riskLevels = [
  {
    level: "Low Risk",
    tone: "More durable setup",
    description:
      "Low Risk means the downside path looks more contained than usual for the setup. Evidence is clearer, the balance sheet is less fragile, liquidity is healthier, and the market is not obviously stretched.",
    watchFor:
      "Low Risk does not mean no risk. Prices can still move against the thesis if facts change, sentiment turns, or the broader market weakens.",
  },
  {
    level: "Medium Risk",
    tone: "Normal uncertainty",
    description:
      "Medium Risk means the setup has meaningful uncertainty, but the risks appear explainable and not unusually severe. There may be mixed evidence, normal volatility, sector pressure, or timing questions.",
    watchFor:
      "This level usually calls for careful sizing, patience, and review of the evidence quality before treating the opportunity as durable.",
  },
  {
    level: "High Risk",
    tone: "Large downside path",
    description:
      "High Risk means the setup can go wrong in a serious way. The thesis may depend on difficult execution, stretched valuation, weaker funding, thin liquidity, a crowded move, or a major event going well.",
    watchFor:
      "Big upside usually comes with big danger. A 100%+ upside case should usually show High Risk unless the balance sheet, cash flow, valuation, evidence, and source quality are unusually strong.",
  },
  {
    level: "Extreme Risk",
    tone: "Fragile or binary setup",
    description:
      "Extreme Risk means the downside can be severe, fast, or hard to estimate. The setup may depend on survival, financing, regulatory approval, litigation, a single data readout, or a highly speculative story.",
    watchFor:
      "Extreme Risk labels are meant to slow the research process down and make the danger visible before anyone focuses on upside scenarios.",
  },
];

const riskFactors = [
  {
    title: "Valuation risk",
    body: "The price may already reflect too much optimism, leaving little room for disappointment.",
  },
  {
    title: "Balance sheet risk",
    body: "Debt, weak cash levels, high burn, or refinancing needs can pressure a company even when the story sounds attractive.",
  },
  {
    title: "Dilution risk",
    body: "A company may need to issue new shares or securities, which can reduce each existing share's claim on future value.",
  },
  {
    title: "Liquidity risk",
    body: "Thin trading volume or limited market depth can make price moves sharper and exits harder during stress.",
  },
  {
    title: "Execution risk",
    body: "Management may fail to deliver the plan, miss milestones, lose customers, or spend more than expected.",
  },
  {
    title: "Regulatory risk",
    body: "Rules, approvals, investigations, policy shifts, or compliance issues can change the outlook quickly.",
  },
  {
    title: "Macro risk",
    body: "Rates, inflation, credit conditions, currencies, recession fears, or broad market stress can overpower company-specific positives.",
  },
  {
    title: "Sector risk",
    body: "An entire industry can fall out of favor because of demand, pricing, regulation, funding, or competitive pressure.",
  },
  {
    title: "Earnings risk",
    body: "Upcoming results, guidance, margins, or commentary can reset expectations in either direction.",
  },
  {
    title: "Priced-in risk",
    body: "The market may have already reacted to the good news, making the next move depend on even better evidence.",
  },
  {
    title: "Overbought risk",
    body: "A fast move can become crowded or extended, raising the chance of a sharp pullback even if the long-term story remains interesting.",
  },
  {
    title: "Binary event risk",
    body: "One event, ruling, readout, vote, filing, or financing decision may dominate the outcome.",
  },
];

const separationPoints = [
  "Profit Potential Score describes how attractive the opportunity may look.",
  "Evidence Confidence Score describes how strong and source-backed the proof appears.",
  "Risk Level explains how badly the setup can go wrong.",
];

export default function RiskLevelsPage() {
  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Risk levels</div>
          <h1>Simple labels for how much damage a setup can do.</h1>
          <p>
            Risk Level explains how badly the setup can go wrong. It is a plain-English
            research label that keeps downside, uncertainty, and evidence quality visible
            beside any upside case.
          </p>
        </div>
        <div className="card risk-callout">
          <span className="badge">Core idea</span>
          <h2>Big upside usually comes with big danger.</h2>
          <p>
            Risk Level is separate from Profit Potential Score and Evidence Confidence
            Score. A setup can have large possible upside and still carry serious danger.
          </p>
        </div>
      </section>

      <section className="trust-section">
        <div className="card methodology-flow">
          <span className="badge">Separate labels</span>
          <h2>Opportunity, proof, and downside are not the same thing.</h2>
          {separationPoints.map((point, index) => (
            <div className="metric" key={point}>
              <span>Check {index + 1}</span>
              <strong>{point}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="grid two trust-section">
        {riskLevels.map((risk) => (
          <article className="card" key={risk.level}>
            <span className="badge">{risk.tone}</span>
            <h2>{risk.level}</h2>
            <p>{risk.description}</p>
            <p>{risk.watchFor}</p>
          </article>
        ))}
      </section>

      <section className="trust-section">
        <div className="eyebrow">Risk factors</div>
        <h2>What Swing Up looks at when describing risk.</h2>
        <p>
          These factors are explained in simple English so the label can be reviewed
          without needing database access, scoring APIs, or hidden formulas.
        </p>
        <div className="grid two">
          {riskFactors.map((factor) => (
            <article className="card" key={factor.title}>
              <span className="badge">Factor</span>
              <h2>{factor.title}</h2>
              <p>{factor.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="trust-section">
        <div className="card risk-callout">
          <span className="badge">100%+ upside rule</span>
          <h2>Large upside cases should start with extra caution.</h2>
          <p>
            A 100%+ upside case should usually show High Risk unless the balance sheet,
            cash flow, valuation, evidence, and source quality are unusually strong.
          </p>
        </div>
      </section>
    </div>
  );
}
