import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicLedgerRecord, requiredLedgerDisclaimer } from "@/lib/public-ledger";

export default async function LedgerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = await getPublicLedgerRecord(id);

  if (!record) notFound();

  return (
    <div className="page">
      <Link className="ledger-link" href="/ledger">← Back to ledger</Link>
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Ledger detail</div>
          <h1>{record.ticker}</h1>
          <p>{record.company}</p>
          <span className="badge">{record.sourceLabel}</span>
        </div>
        <div className="card">
          <div className="metric"><span>Outcome</span><strong>{record.outcome}</strong></div>
          <div className="metric"><span>Alert date</span><strong>{record.alertDate}</strong></div>
          <div className="metric"><span>Receipts</span><strong>{record.receiptsCount}</strong></div>
        </div>
      </section>
      <section className="grid two">
        <article className="card"><h2>Scores</h2><div className="metric"><span>Profit Potential Score</span><strong>{record.profitPotentialScore}</strong></div><div className="metric"><span>Evidence Confidence Score</span><strong>{record.evidenceConfidenceScore}</strong></div><div className="metric"><span>Risk Level</span><strong>{record.riskLevel}</strong></div><div className="metric"><span>Historical Pattern Match</span><strong>{record.historicalPatternMatch}</strong></div></article>
        <article className="card"><h2>Tracking</h2><div className="metric"><span>Price at alert</span><strong>{record.priceAtAlert}</strong></div><div className="metric"><span>Latest tracked price</span><strong>{record.latestTrackedPrice}</strong></div><div className="metric"><span>Max gain</span><strong>{record.maxGain}</strong></div><div className="metric"><span>Max drawdown</span><strong>{record.maxDrawdown}</strong></div></article>
      </section>
      <section className="card trust-section"><h2>Review windows</h2><div className="grid three"><div className="metric"><span>1D</span><strong>{record.result1d}</strong></div><div className="metric"><span>3D</span><strong>{record.result3d}</strong></div><div className="metric"><span>7D</span><strong>{record.result7d}</strong></div><div className="metric"><span>30D</span><strong>{record.result30d}</strong></div><div className="metric"><span>90D</span><strong>{record.result90d}</strong></div></div><p>{record.notes}</p></section>
      <section className="card risk-callout"><h2>Required disclaimer</h2><p>{requiredLedgerDisclaimer}</p></section>
    </div>
  );
}
