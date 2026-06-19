import Link from "next/link";
import { getLedgerData, type LedgerOutcome, type LedgerSourceMode } from "./public-ledger-data";
import styles from "./ledger.module.css";

export const dynamic = "force-dynamic";

function statusClass(status: string) {
  if (status === "win") return styles.statusWin;
  if (status === "loss") return styles.statusLoss;
  if (status === "neutral") return styles.statusNeutral;
  return styles.statusOpen;
}

function sourceBadge(sourceMode: LedgerSourceMode) {
  if (sourceMode === "live") return "Live public tracking";
  if (sourceMode === "empty") return "No tracked alerts yet";
  return "Preview examples only";
}

function outcomeHelp(outcome: LedgerOutcome) {
  if (outcome === "win") return "Win means the tracked checkpoint moved in the alert's favor.";
  if (outcome === "loss") return "Loss means the tracked checkpoint moved against the alert; losses stay visible.";
  if (outcome === "neutral") return "Neutral means the checkpoint did not clearly resolve as a win or loss.";
  if (outcome === "needs_more_data") return "Needs more data means the checkpoint is not ready to classify.";
  return "Open means tracking is still in progress and is not counted as performance.";
}

export default async function LedgerPage() {
  const ledgerData = await getLedgerData();
  const ledgerRows = ledgerData.rows;
  const isLive = ledgerData.sourceMode === "live";
  const badgeText = sourceBadge(ledgerData.sourceMode);

  return (
    <div className="page">
      <section className="hero">
        <div>
          <div className="eyebrow">Public ledger</div>
          <h1>Transparent alert tracking, without performance theater.</h1>
          <p>
            The ledger separates live public tracking from empty states and preview examples. Wins, losses, neutral outcomes, and open checkpoints are shown plainly when they exist; losses are not hidden or removed.
          </p>
          <div className="button-row">
            <Link className="button primary" href="/methodology">How scoring works</Link>
            <Link className="button" href="/risk-disclaimer">Risk disclaimer</Link>
          </div>
        </div>
        <div className={`card ${styles.heroCard}`}>
          <div className="badge">{badgeText}</div>
          <div className="metric"><span>Ledger source</span><strong>{ledgerData.sourceLabel}</strong></div>
          <div className="metric"><span>Purpose</span><strong>Public accountability</strong></div>
          <div className="metric"><span>Performance claim</span><strong>No fake performance</strong></div>
        </div>
      </section>

      <section className={`card ${styles.explainer}`}>
        <div>
          <h2>How to read outcomes</h2>
          <p>Open means a checkpoint is still being tracked. Win means the tracked result moved in favor of the alert. Loss means it moved against the alert. Neutral means the result was mixed or flat.</p>
        </div>
        <div className={styles.lossNote}>
          <strong>Losses are part of the record.</strong>
          <span>They remain visible next to wins and open alerts so the ledger does not imply selective performance.</span>
        </div>
      </section>

      <section className={`card ${styles.disclaimer}`}>
        <h2>Investment disclaimer</h2>
        <p>
          Swing Up provides research and educational information only. It is not financial, investment, legal, tax, or trading advice. Markets involve risk, past or preview performance does not guarantee future results, and you are responsible for your own decisions.
        </p>
      </section>

      <section className={`card ${styles.tableCard}`}>
        <div className={styles.ledgerHeader}>
          <div>
            <div className="badge">{badgeText}</div>
            <h2>Tracked alerts</h2>
            <p>{ledgerData.summary}</p>
          </div>
          <span className="badge">{isLive ? "Live outcomes" : badgeText}</span>
        </div>

        {ledgerRows.length === 0 ? (
          <div className={styles.emptyState}>
            <div className="badge">No tracked alerts yet</div>
            <h3>No live public ledger records are available yet</h3>
            <p>When Swing Up publishes tracked research alerts, each alert will appear here with its open, win, loss, or neutral status and checkpoint history. This empty state does not claim performance.</p>
          </div>
        ) : (
          <>
            {!isLive ? (
              <div className={styles.previewNotice}>
                <strong>Preview examples only.</strong> These rows demonstrate the ledger format and are not live performance records.
              </div>
            ) : null}
            <div className={styles.tableWrap}>
              <table className={`table ${styles.ledgerTable}`}>
                <thead><tr><th>Alert date</th><th>Action</th><th>Ticker</th><th>Company</th><th>Price at alert</th><th>Latest price</th><th>Profit Potential Score</th><th>Evidence Confidence Score</th><th>Risk Level</th><th>Historical Pattern Match</th><th>1D</th><th>3D</th><th>7D</th><th>30D</th><th>90D</th><th>Max gain</th><th>Max drawdown</th><th>Outcome</th><th>Receipts</th><th>Source</th><th>Detail</th></tr></thead>
                <tbody>{ledgerRows.map((row) => <tr key={row.id}><td>{row.alertDate}</td><td>{row.action}</td><td><strong>{row.ticker}</strong></td><td>{row.company}</td><td>{row.priceAtAlert}</td><td>{row.latestPrice}</td><td>{row.profitPotentialScore}</td><td>{row.evidenceConfidenceScore}</td><td>{row.riskLevel}</td><td>{row.historicalPatternMatch}</td><td>{row.oneDayResult}</td><td>{row.threeDayResult}</td><td>{row.sevenDayResult}</td><td>{row.thirtyDayResult}</td><td>{row.ninetyDayResult}</td><td>{row.maxGain}</td><td>{row.maxDrawdown}</td><td><span className={`badge ${styles.status} ${statusClass(row.outcome)}`} title={outcomeHelp(row.outcome)}>{row.outcome}</span></td><td>{row.receiptsCount}</td><td>{row.sourceMode === "live" ? "Live public tracking" : "Preview examples only"}</td><td><Link className={styles.ledgerLink} href={`/ledger/${row.id}`}>View</Link></td></tr>)}</tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
