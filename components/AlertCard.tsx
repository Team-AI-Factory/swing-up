import Link from "next/link";
import type { Alert } from "@/lib/mock-alerts";
import { ReceiptList } from "./ReceiptList";
import { ScorePill } from "./ScorePill";

export function AlertCard({ alert, compact = false }: { alert: Alert; compact?: boolean }) {
  return (
    <article className="card">
      <div className="eyebrow">ACTION: {alert.action}</div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "start", marginTop: 10 }}>
        <div>
          <h2>{alert.ticker}</h2>
          <p style={{ marginTop: 0 }}>{alert.company}</p>
        </div>
        <span className="badge">Risk: {alert.riskLevel}</span>
      </div>
      <p><strong>Event:</strong> {alert.event}</p>
      <div className="grid two">
        <div className="metric"><span>Current price</span><strong>{alert.currentPrice}</strong></div>
        <div className="metric"><span>Target range</span><strong>{alert.targetRange}</strong></div>
        <div className="metric"><span>Upside/downside</span><strong>{alert.potentialMove}</strong></div>
        <div className="metric"><span>Historical Pattern Match</span><strong>{alert.patternMatch.split(" ")[0]}</strong></div>
      </div>
      <div className="grid two" style={{ marginTop: 16 }}>
        <ScorePill label="Profit Potential Score" score={alert.profitScore} tone="green" />
        <ScorePill label="Evidence Confidence Score" score={alert.confidenceScore} tone="blue" />
      </div>
      <p><strong>Priced-In Check:</strong> {alert.pricedInCheck}</p>
      <p><strong>Historical Pattern Match:</strong> {alert.patternMatch}</p>
      <p>{alert.explanation}</p>
      {!compact && (
        <>
          <h3>Verified Ripple Effect</h3>
          <p>{alert.rippleEffect}</p>
          <h3>Risks</h3>
          <ReceiptList receipts={alert.risks} />
          <h3>Receipts</h3>
          <ReceiptList receipts={alert.receipts} />
          <h3>Public Tracking Result</h3>
          <p>{alert.publicTrackingResult}</p>
        </>
      )}
      {compact && <Link className="button primary" href={`/alerts/${alert.id}`}>Open alert</Link>}
    </article>
  );
}
