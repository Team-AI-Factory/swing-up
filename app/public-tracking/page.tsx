const trackingWindows = [
  {
    label: "1D",
    copy: "The first full-day check shows how the market reacted shortly after the alert was published.",
  },
  {
    label: "3D",
    copy: "The three-day check captures early follow-through, reversals, or a neutral response after the initial move.",
  },
  {
    label: "7D",
    copy: "The one-week check gives short-term context without pretending the alert is a long-term forecast.",
  },
  {
    label: "30D",
    copy: "The thirty-day check shows whether the idea kept working, faded, or moved against the alert over a longer window.",
  },
  {
    label: "90D",
    copy: "The ninety-day check adds a durable review point for alerts that need more time to prove or disprove the thesis.",
  },
];

const definitions = [
  {
    title: "What price at alert means",
    copy: "Price at alert is the reference price captured when an alert is published. It gives every result a consistent starting point, even when users discover the alert later.",
  },
  {
    title: "What max gain means",
    copy: "Max gain is the best favorable move reached after publication during the tracking window. It helps separate alerts that briefly worked from alerts that never moved in the intended direction.",
  },
  {
    title: "What max drawdown means",
    copy: "Max drawdown is the worst adverse move reached after publication during the tracking window. It makes downside visible instead of only highlighting upside.",
  },
  {
    title: "What final outcome means",
    copy: "Final outcome is the plain-language result after review: win, neutral, or loss. It summarizes the tracked evidence without hiding the path the alert took.",
  },
];

export default function PublicTrackingPage() {
  return (
    <main className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Public tracking</div>
          <h1>How Swing Up Plans to Track Alerts After Publication</h1>
          <p>
            Swing Up is designed to show what happened after an alert went public, not just what the alert claimed at the time it was sent.
          </p>
        </div>
        <article className="card risk-callout">
          <span className="badge">Accountability note</span>
          <h2>Tracking is evidence, not a promise</h2>
          <p>
            Public tracking is for accountability. It does not prove future alerts will perform the same way.
          </p>
        </article>
      </section>

      <section className="trust-section card">
        <span className="badge">What it means</span>
        <h2>What public tracking means</h2>
        <p>
          Public tracking means each published alert can be reviewed against visible follow-up checkpoints. The goal is to make the alert history understandable, including the starting price, the later price checks, the best favorable move, the worst adverse move, and the final result.
        </p>
      </section>

      <section className="grid two trust-section">
        <article className="card">
          <span className="badge">Win, neutral, or loss</span>
          <h2>Why every alert should be tracked</h2>
          <p>
            A useful public record includes alerts that worked, alerts that were mixed, and alerts that failed. Tracking every outcome keeps the record from becoming a highlight reel and gives users a more honest view of signal quality.
          </p>
        </article>
        <article className="card">
          <span className="badge">No deletion culture</span>
          <h2>Why losing alerts should not be deleted</h2>
          <p>
            Losing alerts are part of the evidence. Keeping them visible helps users understand risk, review mistakes, compare patterns, and judge whether the overall process is improving.
          </p>
        </article>
      </section>

      <section className="trust-section card">
        <span className="badge">Result checkpoints</span>
        <h2>What 1D, 3D, 7D, 30D, and 90D results mean</h2>
        <p>
          These checkpoints are planned review windows measured after publication. They are not guarantees or trading instructions; they are consistent timestamps for comparing what happened next.
        </p>
        <div className="grid two">
          {trackingWindows.map((window) => (
            <article className="metric" key={window.label}>
              <strong>{window.label}</strong>
              <p>{window.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="grid two trust-section">
        {definitions.map((definition) => (
          <article className="card" key={definition.title}>
            <span className="badge">Definition</span>
            <h2>{definition.title}</h2>
            <p>{definition.copy}</p>
          </article>
        ))}
      </section>

      <section className="trust-section card risk-callout">
        <span className="badge">Trust through receipts</span>
        <h2>How public tracking builds trust</h2>
        <p>
          Public tracking builds trust by making outcomes easier to inspect. Users should be able to see when an alert was published, where it started, how it moved across standard checkpoints, and whether the final review counted as a win, neutral result, or loss.
        </p>
      </section>
    </main>
  );
}
