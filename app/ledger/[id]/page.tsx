import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertCard } from "@/components/AlertCard";
import { getLedgerEntry } from "../public-ledger-data";
import styles from "../ledger.module.css";

export const dynamic = "force-dynamic";

export default async function LedgerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entry = await getLedgerEntry(id);

  if (!entry) {
    notFound();
  }

  const isLive = entry.sourceMode === "live";

  return (
    <div className={`page ${styles.detailGrid}`}>
      <div>
        <Link className={styles.ledgerLink} href="/ledger">← Back to public ledger</Link>
      </div>
      <section className="card">
        <div className="badge">{isLive ? "Live ledger detail" : "Mock preview fallback detail"}</div>
        <h1>{entry.ticker} ledger detail</h1>
        <p>{entry.event}</p>
        <div className="grid three">
          <div className="metric"><span>Alert ID</span><strong>{entry.alertId}</strong></div>
          <div className="metric"><span>Alert date</span><strong>{entry.alertDate}</strong></div>
          <div className="metric"><span>Action</span><strong>{entry.action}</strong></div>
          <div className="metric"><span>Price at alert</span><strong>{entry.priceAtAlert}</strong></div>
          <div className="metric"><span>Latest price</span><strong>{entry.latestPrice}</strong></div>
          <div className="metric"><span>Outcome</span><strong>{entry.outcome}</strong></div>
          <div className="metric"><span>Profit Potential Score</span><strong>{entry.profitPotentialScore}</strong></div>
          <div className="metric"><span>Evidence Confidence Score</span><strong>{entry.evidenceConfidenceScore}</strong></div>
          <div className="metric"><span>Risk Level</span><strong>{entry.riskLevel}</strong></div>
          <div className="metric"><span>Historical Pattern Match</span><strong>{entry.historicalPatternMatch}</strong></div>
          <div className="metric"><span>1D / 3D / 7D</span><strong>{entry.oneDayResult} / {entry.threeDayResult} / {entry.sevenDayResult}</strong></div>
          <div className="metric"><span>30D / 90D</span><strong>{entry.thirtyDayResult} / {entry.ninetyDayResult}</strong></div>
          <div className="metric"><span>Max gain</span><strong>{entry.maxGain}</strong></div>
          <div className="metric"><span>Max drawdown</span><strong>{entry.maxDrawdown}</strong></div>
          <div className="metric"><span>Receipts</span><strong>{entry.receiptsCount}</strong></div>
        </div>
      </section>
      <section className={`card ${styles.disclaimer}`}>
        <h2>Investment disclaimer</h2>
        <p>
          Swing Up provides research and educational information only. It is not financial, investment, legal, tax, or trading advice. Markets involve risk, past or preview performance does not guarantee future results, and you are responsible for your own decisions.
        </p>
      </section>
      {entry.alert ? <AlertCard alert={entry.alert} /> : null}
    </div>
  );
}
