const freshnessPrinciples = [
  {
    title: "What data freshness means",
    body: "Freshness describes how recently Swing Up checked a source and whether the newest usable data arrived successfully. It helps users understand whether research context is current, delayed, or incomplete.",
  },
  {
    title: "Why stale data can be dangerous",
    body: "Markets, filings, news, macro releases, and risk signals can change quickly. Stale data may make an old condition look active, hide a new warning, or make a signal appear cleaner than it really is.",
  },
  {
    title: "Why source health matters",
    body: "Source health explains whether the data pipeline behind a research input is reachable, configured, delayed, or failing. If a source is stale, broken, or rate-limited, Swing Up should show that clearly.",
  },
  {
    title: "What “last checked” means",
    body: "Last checked is the most recent time Swing Up attempted to inspect a source. A recent check can show that the source was reviewed, even if the source did not return new usable data.",
  },
  {
    title: "What “last successful pull” means",
    body: "Last successful pull is the most recent time Swing Up received usable data from a source. This can be older than last checked when the latest attempts failed, returned empty results, or were blocked.",
  },
  {
    title: "What “rate-limited” means",
    body: "Rate-limited means a provider temporarily restricted requests because a usage limit was reached or the source asked clients to slow down. The data may recover later without changing the underlying market facts.",
  },
  {
    title: "What “missing key” means",
    body: "Missing key means Swing Up does not have the required configuration or provider credential for that source. The source should be treated as unavailable until the missing setup is fixed.",
  },
  {
    title: "Why Swing Up should show partial data warnings",
    body: "Partial data warnings help users see that a page or signal may be based on only some expected inputs. Clear warnings reduce false confidence when one source works but another source is delayed, disabled, or broken.",
  },
  {
    title: "Why fresh data still does not guarantee outcomes",
    body: "Fresh data helps improve context, but it does not guarantee market outcomes. Even accurate, timely information can be interpreted differently by the market or overwhelmed by new facts, liquidity, sentiment, and risk.",
  },
];

const statusExamples = [
  {
    label: "Fresh",
    tone: "status-connected",
    description: "The source was checked recently and returned usable data within the expected window.",
  },
  {
    label: "Delayed",
    tone: "status-degraded",
    description: "The source is still usable, but updates are arriving slower than expected.",
  },
  {
    label: "Stale",
    tone: "status-degraded",
    description: "The latest usable data is old enough that users should treat the context cautiously.",
  },
  {
    label: "Rate-limited",
    tone: "status-stubbed",
    description: "The provider is temporarily limiting requests, so the newest data may not be available yet.",
  },
  {
    label: "Missing key",
    tone: "status-not_configured",
    description: "A required credential or setting is not configured, so the source cannot be pulled.",
  },
  {
    label: "Broken",
    tone: "status-error",
    description: "The latest checks are failing in a way that prevents normal use of the source.",
  },
  {
    label: "Disabled",
    tone: "status-not_configured",
    description: "The source is intentionally turned off and should not be treated as active evidence.",
  },
];

const summaryStats = [
  { label: "Live API calls", value: "0" },
  { label: "Database required", value: "No" },
  { label: "Status examples", value: statusExamples.length.toString() },
];

export default function DataFreshnessPage() {
  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Data freshness</div>
          <h1>Why fresh context matters in Swing Up</h1>
          <p>
            Swing Up depends on evidence from filings, market data, macro sources, news, and other inputs. This page explains the freshness labels that help users understand when that evidence is current, delayed, or unavailable.
          </p>
        </div>
        <aside className="card risk-callout">
          <span className="badge">Important boundary</span>
          <h2>Fresh data is not certainty.</h2>
          <p>Fresh data helps improve context, but it does not guarantee market outcomes.</p>
        </aside>
      </section>

      <section className="grid three trust-section">
        {summaryStats.map((stat) => (
          <article className="card" key={stat.label}>
            <span className="eyebrow">{stat.label}</span>
            <h2>{stat.value}</h2>
          </article>
        ))}
      </section>

      <section className="trust-section card">
        <div className="eyebrow">Core ideas</div>
        <h2>Freshness protects research quality</h2>
        <p>
          A signal is easier to review when Swing Up can show which sources are current, which sources need caution, and which sources are not contributing usable data.
        </p>
        <div className="grid two" style={{ marginTop: 18 }}>
          {freshnessPrinciples.map((principle) => (
            <article className="card" key={principle.title}>
              <span className="badge">Freshness explainer</span>
              <h3>{principle.title}</h3>
              <p>{principle.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="trust-section card">
        <div className="eyebrow">Status examples</div>
        <h2>Common source freshness states</h2>
        <p>
          These examples are static educational labels. They do not call live APIs, require database data, or describe the current condition of any specific provider.
        </p>
        <div className="grid two" style={{ marginTop: 18 }}>
          {statusExamples.map((status) => (
            <article className="metric" key={status.label}>
              <div className="metric">
                <span>Status</span>
                <strong>
                  <span className={`badge ${status.tone}`}>{status.label}</span>
                </strong>
              </div>
              <div className="metric">
                <span>Meaning</span>
                <strong>{status.description}</strong>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="trust-section card risk-callout">
        <span className="badge">User trust rule</span>
        <h2>Show the warning before showing confidence.</h2>
        <p>
          If a source is stale, broken, or rate-limited, Swing Up should show that clearly. Freshness labels help users separate research context from certainty.
        </p>
      </section>
    </div>
  );
}
