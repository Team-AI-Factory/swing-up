import Link from "next/link";
import styles from "./landing.module.css";

const freshnessCards = [
  {
    title: "Source checks",
    body: "Filings, news, prices, macro, crypto, FX.",
    accent: styles.iconDot,
  },
  {
    title: "Freshness labels",
    body: "Last checked, delayed, stale, rate-limited.",
    accent: `${styles.iconDot} ${styles.greenDot}`,
  },
  {
    title: "Fast alert review",
    body: "Weak signals rejected. Serious ones reviewed.",
    accent: `${styles.iconDot} ${styles.goldDot}`,
  },
];

const watchCards = [
  ["Filings", "Finds 8-Ks, 10-Qs, 10-Ks, Form 4 insider activity."],
  ["News", "Filters real catalysts from headline noise."],
  ["Insider moves", "Spots notable buying and selling behavior."],
  ["Whale activity", "Tracks unusual large-position movement."],
  ["Price + volume", "Flags moves that confirm or reject the story."],
  ["Valuation", "Checks whether the opportunity is already priced in."],
  ["Macro + sector risk", "Rates, inflation, FX, crypto, and sector pressure."],
  ["Ripple effects", "Finds suppliers, customers, competitors, and knock-on winners."],
];

const reviewSteps = [
  {
    title: "Not every signal becomes an alert.",
    body: "Swing Up is designed to reject weak, stale, contradictory, or already-obvious setups before they reach the public feed.",
  },
  {
    title: "No hiding after the alert.",
    body: "Alerts are tracked publicly with outcomes, checkpoints, and invalidation notes so the research has to face the scoreboard.",
  },
  {
    title: "Built for people who want the why, not just the ticker.",
    body: "Each card explains the catalyst, evidence, risk, confidence, and ripple effect in plain English before you decide what to do next.",
  },
];

export default function LandingPage() {
  return (
    <div className={styles.landing}>
      <section className={styles.hero}>
        <div className={styles.copyPanel}>
          <div className={styles.eyebrow}>Market opportunity alerts with public proof</div>
          <h1 className={styles.headline}>Find market opportunities without guessing before the crowd sees them.</h1>
          <p className={styles.subheadline}>
            It reads the boring stuff — filings, news, insider moves, whale activity, valuation, and risks — checks the ripple effects — then turns it into simple alert cards you can actually understand. Every alert is tracked publicly, win or lose.
          </p>
          <div className={styles.actions}>
            <Link className={styles.primaryButton} href="/alerts">View Market Alerts</Link>
            <Link className={styles.secondaryButton} href="/ledger">See Public Tracking</Link>
          </div>
          <p className={styles.note}>Research support only. No guaranteed returns.</p>
        </div>

        <aside className={styles.alertCard} aria-label="Sample market alert card">
          <div className={styles.alertTop}>
            <span className={styles.badge}>WATCH</span>
            <span className={styles.ticker}>NVDA</span>
          </div>
          <h2>Supplier demand signal + valuation risk check</h2>
          <div className={styles.alertRows}>
            <div className={styles.row}><span>What changed</span><strong>New supply-chain activity and sector momentum detected.</strong></div>
            <div className={styles.row}><span>Why it matters</span><strong>Potential ripple effect across semiconductor names.</strong></div>
            <div className={styles.row}><span>Proof</span><strong>Filing checked • News checked • Price/volume checked</strong></div>
            <div className={`${styles.row} ${styles.risk}`}><span>Risk</span><strong>Valuation stretched • Move may be priced in</strong></div>
          </div>
          <div className={styles.scoreGrid}>
            <div className={`${styles.score} ${styles.green}`}><span>Profit Potential Score</span><strong>82/100</strong></div>
            <div className={styles.score}><span>Evidence Confidence Score</span><strong>76/100</strong></div>
            <div className={`${styles.score} ${styles.amber}`}><span>Risk Level</span><strong>Medium</strong></div>
            <div className={styles.score}><span>Historical Pattern</span><strong>Similar setup found</strong></div>
          </div>
          <p className={styles.tracking}><strong>Public Tracking</strong> — Tracked publicly, win or lose</p>
        </aside>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.eyebrow}>Speed + freshness</div>
          <h2 className={styles.sectionTitle}>Built to catch signals while they are still forming.</h2>
          <p>Swing Up checks sources continuously where possible, labels stale data clearly, and turns fresh signals into alert cards as fast as the evidence allows.</p>
        </div>
        <div className={styles.gridThree}>
          {freshnessCards.map((card) => (
            <div className={styles.featureCard} key={card.title}>
              <div className={card.accent} />
              <h3>{card.title}</h3>
              <p>{card.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.eyebrow}>What Swing Up watches</div>
          <h2 className={styles.sectionTitle}>It watches the stuff most people skip.</h2>
        </div>
        <div className={styles.gridFour}>
          {watchCards.map(([title, body], index) => (
            <div className={styles.featureCard} key={title}>
              <div className={index % 3 === 1 ? `${styles.iconDot} ${styles.greenDot}` : index % 3 === 2 ? `${styles.iconDot} ${styles.goldDot}` : styles.iconDot} />
              <h3>{title}</h3>
              <p>{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.gridThree}>
          {reviewSteps.map((step) => (
            <div className={styles.stepCard} key={step.title}>
              <span className={styles.badge}>Proof-backed</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.ctaCard}>
          <div className={styles.eyebrow}>Final check</div>
          <h2 className={styles.ctaTitle}>Stop chasing noise. Start checking the signal.</h2>
          <p>Browse the alert feed, inspect the ledger, and decide with a calmer view of evidence, risk, and follow-through.</p>
          <div className={styles.actions} style={{ justifyContent: "center" }}>
            <Link className={styles.primaryButton} href="/alerts">View Market Alerts</Link>
            <Link className={styles.secondaryButton} href="/ledger">See Public Tracking</Link>
          </div>
        </div>
      </section>

      <footer className={styles.section}>
        <div className={styles.disclaimerCard}>
          <div className={styles.eyebrow}>Disclaimer</div>
          <p>Swing Up provides market research and decision-support information. It does not guarantee returns. Investing involves risk, including possible loss of capital. Users are responsible for their own decisions.</p>
        </div>
      </footer>
    </div>
  );
}
