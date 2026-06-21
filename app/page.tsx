import Link from "next/link";
import styles from "./landing.module.css";

const sourceCards = [
  { title: "Filings", body: "8-Ks, 10-Qs, 10-Ks, Form 4 insider activity, and 13F institutional filings." },
  { title: "News catalysts", body: "Global headlines, company news, sector moves, and market-moving events." },
  { title: "Insider moves", body: "Notable buying, selling, ownership changes, and disclosed insider activity." },
  { title: "Price + volume", body: "Price moves, volume spikes, short pressure, and market reaction checks." },
  { title: "Fundamentals", body: "Revenue, margins, earnings, guidance, analyst targets, and transcripts." },
  { title: "Valuation", body: "Checks whether the opportunity is already priced in." },
  { title: "Macro + rates", body: "Rates, inflation, GDP, liquidity, and market pressure." },
  { title: "FX + currency", body: "Currency shifts and cross-market pressure." },
  { title: "Crypto", body: "Crypto moves, risk appetite, and market spillovers." },
  { title: "FDA + regulatory", body: "Biotech, approvals, recalls, safety alerts, and regulatory catalysts." },
  { title: "Source health", body: "Fresh, delayed, stale, rate-limited, broken, or missing-key status." },
  { title: "Ripple effects", body: "Suppliers, customers, competitors, ecosystem links, and knock-on winners." },
];

const howItWorks = [
  {
    title: "Detect + analyse in real time",
    body: "Swing Up watches fresh market sources, checks source health, filters weak signals, and compares events against past patterns.",
  },
  {
    title: "Alert with proof",
    body: "Only stronger signals become alert cards with proof, risk, scores, valuation checks, and ripple effects.",
  },
  {
    title: "You decide",
    body: "You get a clear research view. Swing Up does not guarantee returns or make decisions for you.",
  },
];

const trackingRows = [
  { alert: "NVDA supplier signal", price: "$___", result: "+8.4%", status: "Win" },
  { alert: "Biotech FDA watch", price: "$___", result: "-3.1%", status: "Loss" },
  { alert: "Macro pressure watch", price: "$___", result: "Still tracking", status: "Open" },
];

const audiences = [
  { title: "Serious retail investors", body: "More context before acting, less blind chasing." },
  { title: "Swing traders", body: "Higher-quality setups with proof, risk, and timing context." },
  { title: "Market researchers", body: "Structured source checks, pattern matches, and public tracking." },
  { title: "People tired of hype alerts", body: "No fluff. Just proof, risk, scores, and results you can see." },
];

function CtaButtons() {
  return (
    <div className={styles.actions}>
      <Link className={styles.primaryButton} href="/alerts">View Market Alerts</Link>
      <Link className={styles.secondaryButton} href="/ledger">See Public Tracking</Link>
      <Link className={styles.ghostButton} href="/signup">Join Waitlist</Link>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className={styles.landing}>
      <section className={styles.hero}>
        <div className={styles.copyPanel}>
          <div className={styles.eyebrow}>Market opportunity alerts with public proof</div>
          <h1 className={styles.headline}>
            Find market opportunities without guessing <span>before the crowd sees them</span> <span>in real time</span>.
          </h1>
          <p className={styles.safetyLine}>
            Fresh data helps speed up research, but every signal still needs proof, risk checks, and public tracking.
          </p>
          <p className={styles.subheadline}>
            Swing Up checks filings, news, insider moves, price action, fundamentals, macro shifts, regulatory events, crypto, FX, source health, and ripple effects — then turns the strongest signals into simple alert cards with <span>proof-backed</span> risk, scores, and public tracking.
          </p>
          <CtaButtons />
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

      <section className={`${styles.section} ${styles.radarSection}`}>
        <div className={styles.sectionHeader}>
          <div className={styles.eyebrow}>What Swing Up watches</div>
          <h2 className={styles.sectionTitle}>It watches the stuff most people skip.</h2>
          <p>Swing Up connects filings, news, prices, fundamentals, macro shifts, regulatory events, crypto, FX, source health, and ripple effects into one proof-backed alert view.</p>
        </div>

        <div className={styles.sourceRadar} aria-label="Swing Up source radar">
          <div className={styles.radarCore}>
            <span>Fresh source checks</span>
            <strong>Swing Up</strong>
            <small>As fast as reliable sources surface them</small>
          </div>
          {sourceCards.map((card, index) => (
            <article className={`${styles.sourceCard} ${styles[`source${index + 1}`]}`} key={card.title}>
              <span className={styles.sourceNumber}>{String(index + 1).padStart(2, "0")}</span>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.eyebrow}>How Swing Up Works</div>
          <h2 className={styles.sectionTitle}>From noisy sources to calm research cards.</h2>
        </div>
        <div className={styles.gridThree}>
          {howItWorks.map((card, index) => (
            <div className={styles.infographicCard} key={card.title}>
              <span className={styles.stepNumber}>{index + 1}</span>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
            </div>
          ))}
        </div>
        <p className={styles.centerNote}>Every alert is tracked publicly, win or lose.</p>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.eyebrow}>Public accountability</div>
          <h2 className={styles.sectionTitle}>No hiding after the alert.</h2>
          <p>Every alert result is tracked publicly so the research has to face the scoreboard.</p>
        </div>
        <div className={styles.trackingTable}>
          <div className={styles.tableHeader}><span>Alert</span><span>Price at alert</span><span>Result</span><span>Status</span></div>
          {trackingRows.map((row) => (
            <div className={styles.tableRow} key={row.alert}>
              <strong>{row.alert}</strong><span>{row.price}</span><span>{row.result}</span><span className={styles.statusPill}>{row.status}</span>
            </div>
          ))}
        </div>
        <p className={styles.coverageNote}>Example only until live tracking is active. Losers are not hidden.</p>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.eyebrow}>Who it helps</div>
          <h2 className={styles.sectionTitle}>Built for people who want the why, not just the ticker.</h2>
          <p>Designed for people <span className={styles.inlineHighlight}>checking the signal</span> before they chase the move.</p>
        </div>
        <div className={styles.gridFour}>
          {audiences.map((card) => (
            <div className={styles.audienceCard} key={card.title}>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.ctaCard}>
          <div className={styles.eyebrow}>Final check</div>
          <h2 className={styles.ctaTitle}>Stop chasing noise. Start <span>checking the signal</span>.</h2>
          <p>Browse the alert feed, inspect the ledger, and decide with a calmer view of evidence, risk, and follow-through.</p>
          <CtaButtons />
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
