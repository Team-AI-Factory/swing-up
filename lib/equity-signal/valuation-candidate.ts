import crypto from "node:crypto";
import { analyzeHistoricalAnalogs } from "@/lib/equity-signal/historical-analogs";
import type { EventReceipt, ImpactCandidate } from "@/lib/equity-signal/types";
import type { UsValueCompanyAnalysis } from "@/lib/opportunity-engine/us-value-investing-engine";

export function buildValuationCandidate(analysis: UsValueCompanyAnalysis, cik: string, receipt: EventReceipt, now: Date): ImpactCandidate | null {
  const base = analysis.fairValue?.baseValue;
  const age = now.getTime() - Date.parse(analysis.observedAt);
  if (!base || base <= 0 || !Number.isFinite(base) || !Number.isFinite(analysis.currentPrice) || analysis.currentPrice <= 0
    || !Number.isFinite(age) || age < -300000 || age > 30 * 3600000 || !/^\d{10}$/.test(cik)) return null;
  const gap = (base / analysis.currentPrice - 1) * 100;
  const direction = gap >= 0 ? "upside" : "downside";
  const confidence = Math.max(0, Math.min(100, analysis.scores.fairValueConfidence));
  const completeness = Math.max(0, Math.min(100, analysis.scores.evidenceCompleteness));
  const materiality = Math.min(100, Math.abs(gap) * 2.5);
  const score = Math.round((confidence + completeness + materiality) / 3);
  const rootEventKey = crypto.createHash("sha256").update(`${analysis.ticker}|valuation|${analysis.observedAt.slice(0, 10)}|${direction}`).digest("hex").slice(0, 20);
  const causalChain = ["Financial results support an estimated business value", "The share price differs from that estimate", "The gap may close if the estimate proves sound"];
  const checks = { directionResolved: true, exactIssuer: true, valuationCurrencyConfirmed: analysis.currency === "USD", currentFoundation: age <= 30 * 3600000,
    valuationConfidence: confidence >= 75, financialEvidence: completeness >= 75,
    independentValuationMethods: analysis.fairValue.methods.length >= 2, materialGap: Math.abs(gap) >= 20,
    currentEvidenceScoreAtLeast72: score >= 72, verifiedFinancialFacts: false };
  const historical = analyzeHistoricalAnalogs({ eventKey: rootEventKey, eventFamily: "valuation_gap", direction, relationship: "direct", causalChain, macroRegime: [], asOf: now.toISOString(), featuresAsOf: analysis.observedAt }, []);
  return { ticker: analysis.ticker, company: analysis.company, cik, rootEventKey, eventFamily: "valuation_gap", direction,
    relationship: "direct", eventHeadline: `${analysis.ticker}: price compared with estimated business value`,
    whatHappened: `The share price is ${analysis.currentPrice} ${analysis.currency ?? ""}; estimated base value is ${base}. The estimated gap is ${gap.toFixed(1)}%. This is a valuation assessment, not a newly announced company event.`,
    eventObservedAt: analysis.observedAt, receipts: [receipt], primarySource: false, independentPublishers: 1,
    mappingConfidence: 100, eventTruth: completeness, materiality, transmissionConfidence: confidence,
    historicalSupport: historical.historicalSupport, evidenceIndependence: completeness, contradictionPenalty: 0, pricedInPenalty: 0,
    rumour: false, causalChain, causalExposure: { status: "direct_issuer", exposureType: "direct", confidence: 100, evidenceText: "Exact ticker and SEC identity from the stored company directory.", sourceUrl: receipt.url, eligibleForSeriousSignal: true },
    eventMagnitude: { status: "not_required", metrics: [], relativeToCompany: null, materialityBasis: "Measured price-versus-model-value gap; model value remains an estimate." },
    falsifiers: ["Financial results deteriorate.", "The valuation assumptions overestimate sustainable earnings or cash flow.", "The market price already reflects the apparent opportunity."],
    timeHorizon: "6_to_24_months", score, gateChecks: checks, gatePassed: false, trackingDisposition: "shadow_near_miss",
    failedGateChecks: Object.entries(checks).filter(([, v]) => !v).map(([k]) => k), quote: null, fundamentals: null,
    historicalAnalog: { ...historical, source: "No calibrated valuation outcome history available" },
    priceForecast: { status: "insufficient_history", horizon: null, probabilityDirectionCorrectPercent: null, sampleSize: 0,
      medianReturnPercent: null, pessimisticReturnPercent: null, optimisticReturnPercent: null, medianPrice: null, lowPrice: null,
      highPrice: null, forecastExpiresAt: null, basedOnMarketRelativeOutcomes: false, warning: "Fair value is a model estimate, not a promised price or return." } };
}

export function reassessValuationCandidate(candidate: ImpactCandidate, now: Date, analysis?: UsValueCompanyAnalysis) {
  if (candidate.eventFamily !== "valuation_gap") return candidate;
  const value = analysis?.fairValue.baseValue;
  const price = candidate.quote?.price;
  const currentGap = value && price && price > 0 ? (value / price - 1) * 100 : null;
  candidate.gateChecks.currentPriceSupportsValuation = currentGap !== null && Number.isFinite(currentGap)
    && (candidate.direction === "upside" ? currentGap >= 20 : currentGap <= -20);
  if (currentGap !== null && Number.isFinite(currentGap)) {
    candidate.whatHappened = `The latest recorded share price is ${price} ${analysis?.currency ?? ""}; the model's base value is ${value}. The current price-to-value gap is ${currentGap.toFixed(1)}%. The value is an estimate, and no new company announcement is required for this review.`;
  }
  const period = Date.parse(candidate.fundamentals?.fiscalPeriodEnd ?? "");
  candidate.gateChecks.verifiedFinancialFacts = candidate.fundamentals?.available === true
    && Number.isFinite(period) && period <= now.getTime() && now.getTime() - period <= 550 * 86400000;
  candidate.failedGateChecks = Object.entries(candidate.gateChecks).filter(([, v]) => !v).map(([k]) => k);
  candidate.gatePassed = candidate.failedGateChecks.length === 0;
  candidate.trackingDisposition = candidate.gatePassed ? "qualified" : "shadow_near_miss";
  return candidate;
}
