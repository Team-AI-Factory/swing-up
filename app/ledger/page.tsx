import Link from "next/link";
import { getPublicLedgerEntries } from "@/lib/public-ledger";
import styles from "./ledger.module.css";

function statusClass(status: string) {
  if (status === "win") return styles.statusWin;
  if (status === "loss") return styles.statusLoss;
  if (status === "neutral") return styles.statusNeutral;
  return styles.statusOpen;
}

export default function LedgerPage() {
  const ledgerRows = getPublicLedgerEntries();

  return (
    <div className="page">
      <section className="hero">
        <div>
          <div className="eyebrow">Public ledger</div>
          <h1>Accountability for Swing Up research alerts.</h1>
          <p>
            A public preview of alert tracking, outcome checkpoints, and source context. Current rows use existing preview alert data and are clearly labelled until live ledger records are connected.
          </p>
          <div className="button-row">
            <Link className="button primary" href="/methodology">How scoring works</Link>
            <Link className="button" href="/risk-disclaimer">Risk disclaimer</Link>
          </div>
        </div>
        <div className={`card ${styles.heroCard}`}>
          <div className="badge">Mock preview data</div>
          <div className="metric"><span>Ledger source</span><strong>Existing preview alerts</strong></div>
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
            <p>Preview rows are marked as mock data until production ledger entries are available.</p>
          </div>
          <span className="badge">Mock preview</span>
        </div>

        {ledgerRows.length === 0 ? (
          <div className={styles.emptyState}>
            <h3>No public ledger entries yet</h3>
            <p>When Swing Up publishes tracked research alerts, they will appear here with transparent outcome checkpoints.</p>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={`table ${styles.ledgerTable}`}>
              <thead><tr><th>Alert date</th><th>Action</th><th>Ticker</th><th>Company</th><th>Price at alert</th><th>Current tracked result</th><th>1D</th><th>7D</th><th>30D</th><th>Status</th><th>Detail</th></tr></thead>
              <tbody>{ledgerRows.map((row) => <tr key={row.id}><td>{row.date}</td><td>{row.action}</td><td><strong>{row.ticker}</strong></td><td>{row.company}</td><td>{row.alertPrice}</td><td>{row.result}</td><td>{row.oneDay}</td><td>{row.sevenDay}</td><td>{row.thirtyDay}</td><td><span className={`badge ${styles.status} ${statusClass(row.status)}`}>{row.status}</span></td><td><Link className={styles.ledgerLink} href={`/ledger/${row.id}`}>View</Link></td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
