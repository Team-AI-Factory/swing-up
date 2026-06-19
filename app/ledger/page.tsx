import Link from "next/link";
import { getLedgerData } from "./public-ledger-data";
import styles from "./ledger.module.css";

export const dynamic = "force-dynamic";

function statusClass(status: string) {
  if (status === "win") return styles.statusWin;
  if (status === "loss") return styles.statusLoss;
  if (status === "neutral") return styles.statusNeutral;
  return styles.statusOpen;
}

export default async function LedgerPage() {
  const ledgerData = await getLedgerData();
  const ledgerRows = ledgerData.rows;
  const isLive = ledgerData.sourceMode === "live";

  return (
    <div className="page">
      <section className="hero">
        <div>
          <div className="eyebrow">Public ledger</div>
          <h1>Accountability for Swing Up research alerts.</h1>
          <p>
            A public record of alert tracking, outcome checkpoints, and source context. Live ledger records are shown when available; mock preview rows are clearly labelled only when no live records exist.
          </p>
          <div className="button-row">
            <Link className="button primary" href="/methodology">How scoring works</Link>
            <Link className="button" href="/risk-disclaimer">Risk disclaimer</Link>
          </div>
        </div>
        <div className={`card ${styles.heroCard}`}>
          <div className="badge">{isLive ? "Live ledger data" : "Mock preview fallback"}</div>
          <div className="metric"><span>Ledger source</span><strong>{ledgerData.sourceLabel}</strong></div>
          <div className="metric"><span>Purpose</span><strong>Public accountability</strong></div>
          <div className="metric"><span>Advice status</span><strong>Not financial advice</strong></div>
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
            <h2>Tracked alerts</h2>
            <p>{ledgerData.summary}</p>
          </div>
          <span className="badge">{isLive ? "Live outcomes" : "Mock preview fallback"}</span>
        </div>

        {ledgerRows.length === 0 ? (
          <div className={styles.emptyState}>
            <h3>No public ledger entries yet</h3>
            <p>When Swing Up publishes tracked research alerts, they will appear here with transparent outcome checkpoints.</p>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={`table ${styles.ledgerTable}`}>
              <thead><tr><th>Alert date</th><th>Action</th><th>Ticker</th><th>Company</th><th>Price at alert</th><th>Latest price</th><th>Profit Potential Score</th><th>Evidence Confidence Score</th><th>Risk Level</th><th>Historical Pattern Match</th><th>1D</th><th>3D</th><th>7D</th><th>30D</th><th>90D</th><th>Max gain</th><th>Max drawdown</th><th>Outcome</th><th>Receipts</th><th>Source</th><th>Detail</th></tr></thead>
              <tbody>{ledgerRows.map((row) => <tr key={row.id}><td>{row.alertDate}</td><td>{row.action}</td><td><strong>{row.ticker}</strong></td><td>{row.company}</td><td>{row.priceAtAlert}</td><td>{row.latestPrice}</td><td>{row.profitPotentialScore}</td><td>{row.evidenceConfidenceScore}</td><td>{row.riskLevel}</td><td>{row.historicalPatternMatch}</td><td>{row.oneDayResult}</td><td>{row.threeDayResult}</td><td>{row.sevenDayResult}</td><td>{row.thirtyDayResult}</td><td>{row.ninetyDayResult}</td><td>{row.maxGain}</td><td>{row.maxDrawdown}</td><td><span className={`badge ${styles.status} ${statusClass(row.outcome)}`}>{row.outcome}</span></td><td>{row.receiptsCount}</td><td>{row.sourceMode === "live" ? "Live" : "Mock fallback"}</td><td><Link className={styles.ledgerLink} href={`/ledger/${row.id}`}>View</Link></td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
