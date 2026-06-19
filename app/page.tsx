import Link from "next/link";
import { mockAlerts } from "@/lib/mock-alerts";

const exampleAlert = mockAlerts[1];

const watchItems = [
  "SEC filings and company updates",
  "Market-moving news and source reliability",
  "Insider moves and leadership changes",
  "Whale activity, unusual flows, and positioning",
  "Valuation, sentiment, and downside risks",
  "Ripple effects across suppliers, peers, and customers",
];

const noiseSteps = [
  {
    title: "Collect the boring signals",
    body: "Swing Up scans source-heavy market inputs that most people do not have time to read closely.",
  },
  {
    title: "Check the ripple effects",
    body: "It looks for second-order confirmation across related companies, sectors, macro pressure, and historical setups.",
  },
  {
    title: "Ship only clear alert cards",
    body: "The output is a plain-English alert with action, confidence, risk, proof, and tracking status in one place.",
  },
];

const audience = [
  "Self-directed investors who want a research starting point before headlines get crowded.",
  "Swing traders who need catalyst context, risk flags, and follow-through tracking.",
  "Busy market watchers who prefer simple cards over raw filings, feeds, and dashboards.",
];

export default function LandingPage() {
  return (
    <div className="page">
      <section className="hero">
        <div>
          <div className="eyebrow">Market opportunity alerts with public proof</div>
          <h1>Find market opportunities without guessing before the crowd sees them.</h1>
          <p>
            It reads the boring stuff — filings, news, insider moves, whale activity, valuation, and risks — checks the ripple effects — then turns it into simple alert cards you can actually understand. Every alert is tracked publicly, win or lose.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link className="button primary" href="/alerts">View example alerts</Link>
            <Link className="button" href="/ledger">See public tracking</Link>
          </div>
        </div>
        <div className="card">
          <div className="eyebrow">Example alert card</div>
          <h2>{exampleAlert.ticker}: {exampleAlert.company}</h2>
          <p><strong>Signal:</strong> {exampleAlert.event}</p>
          <div className="grid two" style={{ marginTop: 16 }}>
            <div className="metric"><span>Action</span><strong>{exampleAlert.action}</strong></div>
            <div className="metric"><span>Risk</span><strong>{exampleAlert.riskLevel}</strong></div>
            <div className="metric"><span>Potential move</span><strong>{exampleAlert.potentialMove}</strong></div>
            <div className="metric"><span>Confidence</span><strong>{exampleAlert.confidenceScore} / 100</strong></div>
          </div>
          <p><strong>Why it matters:</strong> {exampleAlert.explanation}</p>
          <p><strong>Ripple check:</strong> {exampleAlert.rippleEffect}</p>
          <p><strong>Public tracking:</strong> {exampleAlert.publicTrackingResult}</p>
          <Link className="button primary" href={`/alerts/${exampleAlert.id}`}>Open the full alert</Link>
        </div>
      </section>

      <section className="card">
        <div className="eyebrow">What Swing Up watches</div>
        <h2>Signals that can move prices before they become obvious.</h2>
        <div className="grid three" style={{ marginTop: 16 }}>
          {watchItems.map((item) => <div className="metric" key={item}><span>Watch input</span><strong>{item}</strong></div>)}
        </div>
      </section>

      <section>
        <div className="eyebrow">How noise becomes alerts</div>
        <h2>From scattered market data to a decision-ready card.</h2>
        <div className="grid three" style={{ marginTop: 16 }}>
          {noiseSteps.map((step, index) => (
            <div className="card" key={step.title}>
              <span className="badge">Step {index + 1}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="eyebrow">Public tracking</div>
        <h2>Every alert has to face the scoreboard.</h2>
        <p>
          Swing Up keeps alert outcomes visible after publication, including open status, checkpoints, and invalidation notes. The point is not to sound certain; it is to make the research accountable.
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link className="button primary" href="/ledger">Review the ledger</Link>
          <Link className="button" href="/public-tracking">How tracking works</Link>
        </div>
      </section>

      <section>
        <div className="eyebrow">Who it is for</div>
        <h2>Built for people who want context before conviction.</h2>
        <div className="grid three" style={{ marginTop: 16 }}>
          {audience.map((item) => <div className="card" key={item}><p>{item}</p></div>)}
        </div>
      </section>

      <section className="card" style={{ textAlign: "center" }}>
        <div className="eyebrow">Ready to scan smarter?</div>
        <h2>Start with the alerts, then verify the public track record.</h2>
        <p>Use Swing Up as a research layer that explains the setup, shows the risk, and keeps the outcome visible.</p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
          <Link className="button primary" href="/signup">Start with mock alerts</Link>
          <Link className="button" href="/alerts">Browse alerts</Link>
        </div>
      </section>

      <section className="card">
        <div className="eyebrow">Disclaimer</div>
        <p>
          Swing Up is research support, not financial advice. Alerts are not guarantees, markets can move against any setup, and you are responsible for your own decisions.
        </p>
        <Link className="button" href="/disclaimer">Read the full disclaimer</Link>
      </section>
    </div>
  );
}
