import type {
  HistoricalPatternMatch,
  MarketSentimentImpact,
  ScorePreviewInput,
} from "@/lib/scoring-engine";

type BuildLiveScoreInput = {
  ticker: string;
  company: string;
  source: string;
  payload: unknown;
  receivedAt?: Date | string | null;
  sourceQuality?: ScorePreviewInput["sourceQuality"];
  qualityScore: number;
  receiptsCount: number;
  proofTypes?: string[];
  historicalPatternMatch?: HistoricalPatternMatch;
  sentiment: MarketSentimentImpact;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function number(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function firstNumber(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = number(payload[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function mockLike(value: unknown) {
  return /mock|preview|placeholder|synthetic/i.test(JSON.stringify(value ?? ""));
}

function fresh(receivedAt?: Date | string | null) {
  if (!receivedAt) return false;
  const date = receivedAt instanceof Date ? receivedAt : new Date(receivedAt);
  return !Number.isNaN(date.getTime()) && Date.now() - date.getTime() <= 6 * 60 * 60 * 1000;
}

export function buildLiveScoreInput(input: BuildLiveScoreInput): ScorePreviewInput {
  const payload = record(input.payload);
  const proofTypes = new Set((input.proofTypes ?? []).map((value) => value.toLowerCase()));
  const sourceLabel = input.source.trim() || "unknown_source";
  const sourceIsLive = !mockLike(sourceLabel) && !mockLike(payload) && fresh(input.receivedAt);
  const provenance: Record<string, string> = {};

  const expectedUpsidePercent = firstNumber(payload, ["expectedUpsidePercent", "expected_upside_percent"]);
  const expectedDownsidePercent = firstNumber(payload, ["expectedDownsidePercent", "expected_downside_percent"]);
  const priceMovePercent = firstNumber(payload, ["priceMovePercent", "price_move_percent", "change24h", "change_24h", "usd_24h_change", "percentChange"]);
  const valuationSupportScore = firstNumber(payload, ["valuationSupportScore", "valuation_support_score"]);
  const sectorSupportScore = firstNumber(payload, ["sectorSupportScore", "sector_support_score"]);
  const overboughtRiskScore = firstNumber(payload, ["overboughtRiskScore", "overbought_risk_score"]);
  const balanceSheetRiskScore = firstNumber(payload, ["balanceSheetRiskScore", "balance_sheet_risk_score"]);
  const liquidityRiskScore = firstNumber(payload, ["liquidityRiskScore", "liquidity_risk_score"]);
  const dilutionRiskScore = firstNumber(payload, ["dilutionRiskScore", "dilution_risk_score"]);
  const contradictionCount = firstNumber(payload, ["contradictionCount", "contradiction_count"]);
  const catalystStrengthScore = firstNumber(payload, ["catalystStrengthScore", "catalyst_strength_score"]) ?? input.qualityScore;
  const hasPriceVolume = proofTypes.has("price_volume") || (priceMovePercent !== undefined && firstNumber(payload, ["volume24h", "volume", "usd_24h_vol"]) !== undefined);
  const hasFundamentals = proofTypes.has("fundamentals") || firstNumber(payload, ["financialSupportScore", "financial_support_score"]) !== undefined;
  const priceVolumeConfirmationScore = hasPriceVolume ? firstNumber(payload, ["priceVolumeConfirmationScore", "price_volume_confirmation_score"]) ?? 75 : undefined;
  const financialSupportScore = hasFundamentals ? firstNumber(payload, ["financialSupportScore", "financial_support_score"]) ?? 75 : undefined;

  if (sourceIsLive) {
    if (expectedUpsidePercent !== undefined) provenance.expectedUpsidePercent = `live_payload:${sourceLabel}`;
    if (expectedDownsidePercent !== undefined) provenance.expectedDownsidePercent = `live_payload:${sourceLabel}`;
    if (priceMovePercent !== undefined) provenance.priceMovePercent = `live_market_payload:${sourceLabel}`;
    provenance.catalystStrengthScore = `live_quality_gate:${sourceLabel}`;
    provenance.sourceQuality = `live_source:${sourceLabel}`;
    provenance.independentReceipts = `live_receipts:${sourceLabel}`;
    if (priceVolumeConfirmationScore !== undefined) provenance.priceVolumeConfirmationScore = `live_proof_bundle:${sourceLabel}`;
    if (financialSupportScore !== undefined) provenance.financialSupportScore = `live_proof_bundle:${sourceLabel}`;
    for (const [key, value] of Object.entries({
      valuationSupportScore,
      sectorSupportScore,
      overboughtRiskScore,
      balanceSheetRiskScore,
      liquidityRiskScore,
      dilutionRiskScore,
      contradictionCount,
    })) {
      if (value !== undefined) provenance[key] = `live_payload:${sourceLabel}`;
    }
  }
  if (input.sentiment.sentimentDataStatus === "available") provenance.macroSupportScore = "live_market_sentiment_snapshot";

  return {
    ticker: input.ticker,
    company: input.company,
    expectedUpsidePercent,
    expectedDownsidePercent,
    historicalPatternMatch: input.historicalPatternMatch,
    valuationSupportScore,
    catalystStrengthScore,
    priceMovePercent,
    sectorSupportScore,
    macroSupportScore: input.sentiment.sentimentDataStatus === "available" ? input.sentiment.macroSupportScore : undefined,
    sourceQuality: input.sourceQuality,
    independentReceipts: input.receiptsCount,
    hasConfirmedFilingOrExchangeSource: input.sourceQuality === "confirmed" || input.sourceQuality === "high",
    priceVolumeConfirmationScore,
    financialSupportScore,
    verifiedRippleLinks: firstNumber(payload, ["verifiedRippleLinks", "verified_ripple_links"]),
    contradictionCount,
    isRumour: input.sourceQuality === "rumour" || input.sourceQuality === "low",
    overboughtRiskScore,
    balanceSheetRiskScore,
    sourceRiskScore: firstNumber(payload, ["sourceRiskScore", "source_risk_score"]),
    liquidityRiskScore,
    dilutionRiskScore,
    inputProvenance: provenance,
    liveEvidenceOnly: true,
    payload: input.payload,
  };
}
