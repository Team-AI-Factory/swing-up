import Link from "next/link";
import type { Alert, MarketSentimentImpact } from "@/lib/mock-alerts";
import { ReceiptList } from "./ReceiptList";
import { ScorePill } from "./ScorePill";

function firstPatternValue(patternMatch: string) {
  return patternMatch.split(" ")[0] || "Review";
}

function formatAdjustment(value: number) {
  return value > 0 ? `+${value}` : `${value}`;
}

function hasCompleteSentimentImpact(sentiment?: Partial<MarketSentimentImpact>): sentiment is MarketSentimentImpact {
  return Boolean(
    sentiment &&
      sentiment.overallMarketMood &&
      sentiment.macroRiskLevel &&
      typeof sentiment.sentimentSupportScore === "number" &&
      typeof sentiment.macroSupportScore === "number" &&
      typeof sentiment.profitPotentialAdjustment === "number" &&
      typeof sentiment.confidenceAdjustment === "number" &&
      sentiment.explanation
  );
}

function MarketSentimentSection({ sentiment }: { sentiment?: Partial<MarketSentimentImpact> }) {
  if (!hasCompleteSentimentImpact(sentiment)) {
    return (
      <section className="alert-sentiment alert-sentiment-empty" aria-label="Market Sentiment Impact">
        <div className="alert-section-header">
          <span className="badge">Market Sentiment Impact</span>
        </div>
        <p>Sentiment data not available yet</p>
      </section>
    );
  }

  return (
    <section className="alert-sentiment" aria-label="Market Sentiment Impact">
      <div className="alert-section-header">
        <span className="badge">Market Sentiment Impact</span>
      </div>
      <div className="grid two alert-sentiment-grid">
        <div className="metric"><span>Overall market mood</span><strong>{sentiment.overallMarketMood}</strong></div>
        <div className="metric"><span>Macro risk level</span><strong>{sentiment.macroRiskLevel}</strong></div>
        <div className="metric"><span>Sentiment support score</span><strong>{sentiment.sentimentSupportScore} / 100</strong></div>
        <div className="metric"><span>Macro support score</span><strong>{sentiment.macroSupportScore} / 100</strong></div>
        <div className="metric"><span>Profit potential adjustment</span><strong>{formatAdjustment(sentiment.profitPotentialAdjustment)}</strong></div>
        <div className="metric"><span>Confidence adjustment</span><strong>{formatAdjustment(sentiment.confidenceAdjustment)}</strong></div>
      </div>
      <p>{sentiment.explanation}</p>
    </section>
  );
}

export function AlertCard({ alert, compact = false }: { alert: Alert; compact?: boolean }) {
  return (
    <article className="card alert-card">
      <div className={`alert-action alert-action-${alert.action.toLowerCase()}`}>ACTION: {alert.action}</div>
      <div className="alert-card-header">
        <div>
          <h2>{alert.ticker}</h2>
          <p>{alert.company}</p>
        </div>
        <span className="badge">Risk: {alert.riskLevel}</span>
      </div>
      <p><strong>Event:</strong> {alert.event}</p>
      <p><strong>Date:</strong> {alert.eventDate ?? "Date not available yet"}</p>
      <div className="grid two alert-top-grid">
        <div className="metric"><span>Current price</span><strong>{alert.currentPrice}</strong></div>
        <div className="metric"><span>Target price range</span><strong>{alert.targetRange}</strong></div>
        <div className="metric"><span>Potential upside/downside</span><strong>{alert.potentialMove}</strong></div>
        <div className="metric"><span>Risk Level</span><strong>{alert.riskLevel}</strong></div>
        <div className="metric"><span>Priced-In Check</span><strong>{alert.pricedInCheck}</strong></div>
        <div className="metric"><span>Historical Pattern Match</span><strong>{firstPatternValue(alert.patternMatch)}</strong></div>
      </div>
      <div className="grid two alert-score-grid">
        <ScorePill label="Profit Potential Score" score={alert.profitScore} tone="green" />
        <ScorePill label="Evidence Confidence Score" score={alert.confidenceScore} tone="blue" />
      </div>
      <MarketSentimentSection sentiment={alert.marketSentimentImpact} />
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
