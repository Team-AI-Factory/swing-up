const previewAreas = [
  "Example alert cards used to test wording, hierarchy, and mobile readability.",
  "Preview rule filters that demonstrate how noisy inputs may be reduced.",
  "Sample source-health states used to explain connected, stubbed, degraded, or unavailable feeds.",
  "Illustrative ledgers or tracking views that show the intended accountability workflow.",
];

const liveChanges = [
  "Records come from production storage or real source outputs instead of hand-written examples.",
  "Timestamps, source names, and evidence links must point back to actual receipts.",
  "Labels can move from preview status to live status only when the connected source path is active.",
  "Users can review what triggered the research view and what evidence was available at that time.",
];

export default function PreviewVsLivePage() {
  return <div className="page">
    <section className="hero trust-hero">
      <div>
        <div className="eyebrow">Preview vs live data</div>
        <h1>Clear labels for example data and production evidence.</h1>
        <p>Some Swing Up surfaces use preview routes while the product is being built. This page explains what that means, what live data means, and why users should treat examples as product demonstrations rather than real market alerts.</p>
      </div>
      <div className="card risk-callout">
        <span className="badge">Current principle</span>
        <h2>No serious alert without receipts.</h2>
        <p>Before a serious alert is treated as live, it should be backed by traceable source output, production records, or evidence that users can review.</p>
      </div>
    </section>

    <section className="grid two trust-section">
      <article className="card">
        <span className="badge">Preview / mock</span>
        <h2>What preview/mock data means</h2>
        <p>Preview data is used to test the product experience. It is not a real market alert.</p>
        <p>Mock examples help validate layouts, labels, scoring explanations, receipts, and user flows before every data source is connected end-to-end.</p>
      </article>

      <article className="card">
        <span className="badge">Live production</span>
        <h2>What live data means</h2>
        <p>Live data means Swing Up is reading from production records or real source outputs.</p>
        <p>Live views should be connected to real inputs, durable records, source status, and reviewable evidence rather than static examples.</p>
      </article>
    </section>

    <section className="card trust-section">
      <span className="badge">Build process</span>
      <h2>Why Swing Up uses preview routes during building</h2>
      <p>Preview routes make it possible to test the research experience safely while backend contracts, source integrations, evidence storage, and alert review workflows are still being connected. They also let the team verify that language stays calm, mobile-first, and evidence-first before live records are shown.</p>
    </section>

    <section className="grid two trust-section">
      <article className="card">
        <span className="badge">May be preview</span>
        <h2>Which areas may still show preview data</h2>
        <div className="disclaimer-list">
          {previewAreas.map((area) => <div className="metric" key={area}><span>{area}</span></div>)}
        </div>
      </article>

      <article className="card">
        <span className="badge">Labeling</span>
        <h2>Why preview data must be clearly labelled</h2>
        <p>Clear labels prevent users from confusing product demos with production research. If a surface is using static examples, stubbed source states, or mock records, it should say so near the content and avoid presenting examples as current market information.</p>
      </article>
    </section>

    <section className="grid two trust-section">
      <article className="card">
        <span className="badge">When live</span>
        <h2>What changes when data becomes live</h2>
        <div className="disclaimer-list">
          {liveChanges.map((change) => <div className="metric" key={change}><span>{change}</span></div>)}
        </div>
      </article>

      <article className="card risk-callout">
        <span className="badge">User caution</span>
        <h2>Do not treat mock examples as real alerts.</h2>
        <p>Mock examples are for product review, education, and quality checks. They should not be used as trade timing, portfolio direction, or evidence that a live event has occurred.</p>
        <p>Swing Up provides market research and decision-support information. It does not guarantee returns.</p>
      </article>
    </section>
  </div>;
}
