import Link from "next/link";
import { getPublicLedgerRecords, mockLedgerRecords, requiredLedgerDisclaimer } from "@/lib/public-ledger";

function outcomeClass(outcome: string) {
  return `badge ledger-status ledger-status-${outcome}`;
}

export default async function LedgerPage() {
  const ledger = await getPublicLedgerRecords();
  const rows = ledger.records.length > 0 ? ledger.records : mockLedgerRecords;
  const showMockPreview = ledger.records.length === 0 && rows.length > 0;

  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Public ledger preview</div>
          <h1>Every alert should be accountable.</h1>
          <p>Public tracking is designed to show wins, neutral outcomes, losses, pending windows, and supporting receipts without deleting weak results.</p>
          <div className="button-row"><Link className="button primary" href="/methodology">How scoring works</Link><Link className="button" href="/risk-disclaimer">Risk disclaimer</Link></div>
        </div>
        <div className="card">
          <div className="metric"><span>Ledger source</span><strong>{ledger.records.length > 0 ? "Live public records" : "Preview mode"}</strong></div>
          <div className="metric"><span>Result policy</span><strong>No hidden losses</strong></div>
          <div className="metric"><span>Guarantee status</span><strong>No guaranteed returns</strong></div>
        </div>
      </section>

      {ledger.databaseUnavailable && <section className="card risk-callout"><span className="badge">Database unavailable</span><p>The ledger database could not be reached, so this page is showing a safe empty/preview state instead of publishing real alerts.</p></section>}

      {showMockPreview && <section className="card risk-callout"><span className="badge">Mock preview data</span><p>No public ledger records are available yet. The rows below are clearly labelled mock preview data to demonstrate the future accountability format.</p></section>}

      {ledger.records.length === 0 && !showMockPreview && <section className="card empty-ledger"><h2>No public ledger records yet.</h2><p>When alerts are published for public tracking, they will appear here with pending, win, neutral, and loss outcomes.</p></section>}

      <section className="card ledger-card">
        <div className="ledger-header"><div><h2>Tracked alert ledger</h2><p>Evidence-first tracking fields stay visible even when results are pending or weak.</p></div><span className="badge">{showMockPreview ? "Mock preview" : "Public records"}</span></div>
        <div className="table-wrap"><table className="table ledger-table"><thead><tr><th>Type</th><th>Action</th><th>Ticker / company</th><th>Alert date</th><th>Price at alert</th><th>Latest tracked price</th><th>Profit Potential Score</th><th>Evidence Confidence Score</th><th>Risk Level</th><th>Historical Pattern Match</th><th>1D</th><th>3D</th><th>7D</th><th>30D</th><th>90D</th><th>Max gain</th><th>Max drawdown</th><th>Outcome</th><th>Receipts</th><th>Details</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><span className="badge">{row.sourceLabel}</span></td><td>{row.action}</td><td><strong>{row.ticker}</strong><br /><span>{row.company}</span></td><td>{row.alertDate}</td><td>{row.priceAtAlert}</td><td>{row.latestTrackedPrice}</td><td>{row.profitPotentialScore}</td><td>{row.evidenceConfidenceScore}</td><td>{row.riskLevel}</td><td>{row.historicalPatternMatch}</td><td>{row.result1d}</td><td>{row.result3d}</td><td>{row.result7d}</td><td>{row.result30d}</td><td>{row.result90d}</td><td>{row.maxGain}</td><td>{row.maxDrawdown}</td><td><span className={outcomeClass(row.outcome)}>{row.outcome}</span></td><td>{row.receiptsCount}</td><td><Link className="ledger-link" href={row.href}>View</Link></td></tr>)}</tbody></table></div>
      </section>

      <section className="card risk-callout"><h2>Required disclaimer</h2><p>{requiredLedgerDisclaimer}</p></section>
    </div>
  );
}
