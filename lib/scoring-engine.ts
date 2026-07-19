import { prisma } from "@/lib/db/client";

export type RiskLevel = "low" | "medium" | "high" | "extreme";
export type HistoricalPatternMatch = "strong" | "moderate" | "weak" | "no_clear_match";
export type PricedInCheck = "not_fully_priced_in" | "partially_priced_in" | "mostly_priced_in" | "unclear";
export type SuggestedAction = "Buy Candidate" | "Speculative Buy Candidate" | "Watch" | "Sell Review" | "Avoid" | "No Action";
export type SentimentDataStatus = "available" | "missing" | "stale";

type SourceQuality = "confirmed" | "high" | "medium" | "low" | "rumour";

export type ScorePreviewInput = {
  ticker?: string;
  company?: string;
  expectedUpsidePercent?: number;
  expectedDownsidePercent?: number;
  historicalPatternMatch?: HistoricalPatternMatch;
  valuationSupportScore?: number;
  catalystStrengthScore?: number;
  priceMovePercent?: number;
  sectorSupportScore?: number;
  macroSupportScore?: number;
  sourceQuality?: SourceQuality;
  independentReceipts?: number;
  hasConfirmedFilingOrExchangeSource?: boolean;
  priceVolumeConfirmationScore?: number;
  financialSupportScore?: number;
  verifiedRippleLinks?: number;
  contradictionCount?: number;
  isRumour?: boolean;
  overboughtRiskScore?: number;
  balanceSheetRiskScore?: number;
  sourceRiskScore?: number;
  liquidityRiskScore?: number;
  dilutionRiskScore?: number;
  inputProvenance?: Record<string, string>;
  liveEvidenceOnly?: boolean;
  payload?: unknown;
};

export type MarketSentimentImpact = {
  overallMarketMood: string | null;
  macroRiskLevel: RiskLevel | "unknown";
  sentimentSupportScore: number;
  macroSupportScore: number;
  profitPotentialAdjustment: number;
  confidenceAdjustment: number;
  riskOffPenalty: number;
  sentimentDataStatus: SentimentDataStatus;
  observedAt: string | null;
  ageMinutes: number | null;
};

export type SwingUpScore = {
  ticker: string;
  company: string;
  profitPotentialScore: number;
  evidenceConfidenceScore: number;
  riskLevel: RiskLevel;
  historicalPatternMatch: HistoricalPatternMatch;
  pricedInCheck: PricedInCheck;
  suggestedAction: SuggestedAction;
  marketSentimentImpact: MarketSentimentImpact;
  scoreBreakdown: Record<string, number>;
  liveDataReady: boolean;
  inputCompleteness: number;
  missingInputs: string[];
  inputProvenance: Record<string, string>;
  warnings: string[];
  notes: string[];
  compatibility: {
    alertCardReady: boolean;
    aiBrainInputContractReady: boolean;
    publicLedgerReady: boolean;
    publishesRealAlert: false;
  };
};

type SnapshotLike = {
  overallMarketMood?: string | null;
  macroRiskLevel?: string | null;
  sentimentSupportScore?: number | null;
  macroSupportScore?: number | null;
  profitPotentialAdjustment?: number | null;
  confidenceAdjustment?: number | null;
  riskOffPenalty?: number | null;
  createdAt?: Date;
};

const MOCK_INPUT: ScorePreviewInput = {
  ticker: "SHOP",
  company: "Shopify Inc.",
  expectedUpsidePercent: 16,
  expectedDownsidePercent: 9,
  historicalPatternMatch: "moderate",
  valuationSupportScore: 68,
  catalystStrengthScore: 74,
  priceMovePercent: 4,
  sectorSupportScore: 63,
  macroSupportScore: 58,
  sourceQuality: "high",
  independentReceipts: 3,
  hasConfirmedFilingOrExchangeSource: true,
  priceVolumeConfirmationScore: 66,
  financialSupportScore: 71,
  verifiedRippleLinks: 2,
  contradictionCount: 0,
  isRumour: false,
  overboughtRiskScore: 28,
  balanceSheetRiskScore: 22,
  sourceRiskScore: 14,
  liquidityRiskScore: 18,
  dilutionRiskScore: 12,
};

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function num(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

const REQUIRED_LIVE_INPUTS = [
  "catalystStrengthScore",
  "priceMovePercent",
  "sourceQuality",
  "independentReceipts",
  "priceVolumeConfirmationScore",
] as const;

function hasInput(input: ScorePreviewInput, key: (typeof REQUIRED_LIVE_INPUTS)[number]) {
  if (key === "sourceQuality") return Boolean(input.sourceQuality);
  return finite(input[key]);
}

function liveProvenance(input: ScorePreviewInput, key: string) {
  const value = input.inputProvenance?.[key]?.trim().toLowerCase() ?? "";
  return Boolean(value && !/mock|preview|default|neutral|placeholder|synthetic|assumed/.test(value));
}

function sourceQualityScore(quality: SourceQuality | undefined) {
  if (quality === "confirmed") return 95;
  if (quality === "high") return 82;
  if (quality === "medium") return 62;
  if (quality === "low") return 38;
  if (quality === "rumour") return 22;
  return 50;
}

function patternScore(pattern: HistoricalPatternMatch | undefined) {
  if (pattern === "strong") return 88;
  if (pattern === "moderate") return 68;
  if (pattern === "weak") return 38;
  return 18;
}

function pricedIn(priceMovePercent: number, catalystStrength: number): PricedInCheck {
  if (!Number.isFinite(priceMovePercent)) return "unclear";
  if (priceMovePercent <= 3) return "not_fully_priced_in";
  if (priceMovePercent <= 8 || catalystStrength >= 78) return "partially_priced_in";
  if (priceMovePercent > 12) return "mostly_priced_in";
  return "unclear";
}

function pricedInPenalty(check: PricedInCheck) {
  if (check === "not_fully_priced_in") return 0;
  if (check === "partially_priced_in") return 8;
  if (check === "mostly_priced_in") return 20;
  return 10;
}

export function mockScoreInput(): ScorePreviewInput {
  return { ...MOCK_INPUT };
}

export async function loadLatestMarketSentimentSnapshot(): Promise<SnapshotLike | null> {
  if (!process.env.DATABASE_URL) return null;
  try {
    return await prisma.macroSentimentSnapshot.findFirst({
      where: { snapshotType: "market_sentiment" },
      orderBy: { createdAt: "desc" },
      select: {
        overallMarketMood: true,
        macroRiskLevel: true,
        sentimentSupportScore: true,
        macroSupportScore: true,
        profitPotentialAdjustment: true,
        confidenceAdjustment: true,
        riskOffPenalty: true,
        createdAt: true,
      },
    });
  } catch {
    return null;
  }
}

export function buildMarketSentimentImpact(snapshot: SnapshotLike | null): MarketSentimentImpact {
  const observedAt = snapshot?.createdAt instanceof Date ? snapshot.createdAt : null;
  const ageMinutes = observedAt ? Math.max(0, Math.round((Date.now() - observedAt.getTime()) / 60000)) : null;
  const stale = ageMinutes !== null && ageMinutes > 120;
  if (!snapshot || stale) {
    return {
      overallMarketMood: null,
      macroRiskLevel: "unknown",
      sentimentSupportScore: 0,
      macroSupportScore: 0,
      profitPotentialAdjustment: -10,
      confidenceAdjustment: -20,
      riskOffPenalty: 35,
      sentimentDataStatus: stale ? "stale" : "missing",
      observedAt: observedAt?.toISOString() ?? null,
      ageMinutes,
    };
  }

  return {
    overallMarketMood: snapshot.overallMarketMood ?? null,
    macroRiskLevel: ["low", "medium", "high", "extreme"].includes(snapshot.macroRiskLevel ?? "") ? (snapshot.macroRiskLevel as RiskLevel) : "unknown",
    sentimentSupportScore: clamp(num(snapshot.sentimentSupportScore, 50)),
    macroSupportScore: clamp(num(snapshot.macroSupportScore, 50)),
    profitPotentialAdjustment: Math.max(-20, Math.min(20, Math.round(num(snapshot.profitPotentialAdjustment, 0)))),
    confidenceAdjustment: Math.max(-20, Math.min(20, Math.round(num(snapshot.confidenceAdjustment, 0)))),
    riskOffPenalty: clamp(num(snapshot.riskOffPenalty, 0)),
    sentimentDataStatus: "available",
    observedAt: observedAt?.toISOString() ?? null,
    ageMinutes,
  };
}

export function scoreSwingUpAlert(input: ScorePreviewInput, sentiment: MarketSentimentImpact): SwingUpScore {
  const provenance = input.inputProvenance ?? {};
  const verifiedInputs = REQUIRED_LIVE_INPUTS.filter((key) => hasInput(input, key) && (!input.liveEvidenceOnly || liveProvenance(input, key)));
  const missingInputs = REQUIRED_LIVE_INPUTS.filter(
    (key) => !hasInput(input, key) || (input.liveEvidenceOnly !== false && !liveProvenance(input, key)),
  ).map(String);
  if (sentiment.sentimentDataStatus !== "available") missingInputs.push(`marketSentiment:${sentiment.sentimentDataStatus}`);
  if ((input.independentReceipts ?? 0) < 2) missingInputs.push("independentReceipts:min_2");
  const uniqueMissingInputs = Array.from(new Set(missingInputs));
  const inputCompleteness = clamp(((verifiedInputs.length + (sentiment.sentimentDataStatus === "available" ? 1 : 0)) / (REQUIRED_LIVE_INPUTS.length + 1)) * 100);
  const liveDataReady = uniqueMissingInputs.length === 0;
  const pattern = input.historicalPatternMatch ?? "no_clear_match";
  const patternStrength = patternScore(pattern);
  const sourceStrength = sourceQualityScore(input.sourceQuality);
  const expectedUpside = num(input.expectedUpsidePercent, 0);
  const expectedDownside = Math.abs(num(input.expectedDownsidePercent, 20));
  const catalystStrength = clamp(num(input.catalystStrengthScore, 0));
  const valuationSupport = clamp(num(input.valuationSupportScore, 0));
  const sectorSupport = clamp(num(input.sectorSupportScore, 0));
  const macroSupport = clamp(num(input.macroSupportScore, 0));
  const sentimentSupport = sentiment.sentimentSupportScore;
  const priceMove = num(input.priceMovePercent, Number.NaN);
  const pricedInCheck = pricedIn(priceMove, catalystStrength);
  const pricedPenalty = pricedInPenalty(pricedInCheck);

  const upsideSupport = clamp(expectedUpside * 4);
  const downsideRisk = clamp(expectedDownside * 5);
  const riskPenalties = {
    downsideRisk,
    overboughtRisk: clamp(num(input.overboughtRiskScore, 80)),
    balanceSheetRisk: clamp(num(input.balanceSheetRiskScore, 80)),
    sourceRisk: clamp(num(input.sourceRiskScore, 100 - sourceStrength)),
    liquidityRisk: clamp(num(input.liquidityRiskScore, 80)),
    dilutionRisk: clamp(num(input.dilutionRiskScore, 80)),
    pricedInPenalty: pricedPenalty,
    marketRiskOffPenalty: sentiment.riskOffPenalty,
  };

  const positiveProfit =
    upsideSupport * 0.18 + patternStrength * 0.11 + valuationSupport * 0.11 + catalystStrength * 0.13 +
    (100 - pricedPenalty * 4) * 0.08 + sectorSupport * 0.08 + macroSupport * 0.08 + sourceStrength * 0.08 + sentimentSupport * 0.08;
  const negativeProfit = Object.values(riskPenalties).reduce((sum, value) => sum + value, 0) * 0.09;
  const profitPotentialScore = clamp(positiveProfit - negativeProfit + sentiment.profitPotentialAdjustment + 12);

  const receiptsScore = clamp(num(input.independentReceipts, 0) * 22);
  const confirmedSource = input.hasConfirmedFilingOrExchangeSource ? 100 : input.isRumour ? 15 : input.liveEvidenceOnly ? 0 : 45;
  const contradictions = clamp(num(input.contradictionCount, 0) * 18);
  const rumourPenalty = input.isRumour || input.sourceQuality === "rumour" ? 24 : 0;
  const freshnessReliability = sentiment.sentimentDataStatus === "available" ? clamp((sentiment.sentimentSupportScore + sentiment.macroSupportScore) / 2) : 0;
  const rawEvidenceConfidenceScore = clamp(
    sourceStrength * 0.18 + receiptsScore * 0.13 + confirmedSource * 0.13 + clamp(num(input.priceVolumeConfirmationScore, 45)) * 0.11 +
      clamp(num(input.financialSupportScore, 45)) * 0.11 + patternStrength * 0.1 + clamp(num(input.verifiedRippleLinks, 0) * 28) * 0.08 +
      freshnessReliability * 0.08 + sentiment.confidenceAdjustment + 8 - contradictions - rumourPenalty,
  );
  const evidenceConfidenceScore = Math.min(rawEvidenceConfidenceScore, inputCompleteness);

  const rawRisk = clamp(expectedUpside * 1.5 + downsideRisk * 0.8 + Object.values(riskPenalties).reduce((sum, value) => sum + value, 0) * 0.16 - evidenceConfidenceScore * 0.22 - valuationSupport * 0.08);
  const riskLevel: RiskLevel = rawRisk >= 78 ? "extreme" : rawRisk >= 58 ? "high" : rawRisk >= 34 ? "medium" : "low";
  const suggestedAction = liveDataReady ? chooseAction(profitPotentialScore, evidenceConfidenceScore, riskLevel, pricedInCheck) : "No Action";
  const warnings = [
    "Profit Potential Score is an opportunity attractiveness score, not a guaranteed profit probability.",
    "Evidence Confidence Score measures proof strength, not the chance of profit.",
    ...(sentiment.sentimentDataStatus !== "available" ? [`Market sentiment is ${sentiment.sentimentDataStatus}; conservative penalties were used and publication is blocked.`] : []),
    ...(uniqueMissingInputs.length ? [`Live evidence gate is incomplete: ${uniqueMissingInputs.join(", ")}. No neutral or preview fallback was used.`] : []),
    ...(riskLevel === "high" || riskLevel === "extreme" ? ["High-upside setup carries elevated downside risk unless receipts, valuation, balance sheet, and source quality remain strong."] : []),
  ];

  return {
    ticker: input.ticker ?? "MOCK",
    company: input.company ?? "Mock Company",
    profitPotentialScore,
    evidenceConfidenceScore,
    riskLevel,
    historicalPatternMatch: pattern,
    pricedInCheck,
    suggestedAction,
    marketSentimentImpact: sentiment,
    scoreBreakdown: { upsideSupport, patternStrength, valuationSupport, catalystStrength, sectorSupport, macroSupport, sourceStrength, sentimentSupport, receiptsScore, confirmedSource, freshnessReliability, contradictions, ...riskPenalties },
    liveDataReady,
    inputCompleteness,
    missingInputs: uniqueMissingInputs,
    inputProvenance: provenance,
    warnings,
    notes: ["Missing live inputs are penalized and block action; they are never replaced with neutral preview values.", "Outputs are shaped for alert cards, AI Brain Input Contract, and Public Ledger records."],
    compatibility: { alertCardReady: true, aiBrainInputContractReady: true, publicLedgerReady: liveDataReady, publishesRealAlert: false },
  };
}

function chooseAction(score: number, confidence: number, risk: RiskLevel, priced: PricedInCheck): SuggestedAction {
  if (risk === "extreme") return score >= 70 && confidence >= 75 ? "Sell Review" : "Avoid";
  if (score >= 72 && confidence >= 70 && risk !== "high" && priced !== "mostly_priced_in") return "Buy Candidate";
  if (score >= 68 && confidence >= 58 && risk === "high") return "Speculative Buy Candidate";
  if (score >= 50 && confidence >= 45) return "Watch";
  if (score < 35 && confidence >= 60) return "Sell Review";
  if (score < 30 || risk === "high") return "Avoid";
  return "No Action";
}
