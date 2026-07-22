import type {
  CompanyFoundationInput,
  ConfidenceBreakdown,
  EventImpact,
  EventSignalInput,
  PriceTargetScenario,
  StoredThesisSnapshot,
} from "./types";

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function ageDays(value: string | null | undefined) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? Math.max(0, (Date.now() - time) / 86_400_000) : null;
}

function ageScore(value: number | null, thresholds: Array<[number, number]>, missingScore: number) {
  if (value === null) return missingScore;
  for (const [maximumAge, score] of thresholds) if (value <= maximumAge) return score;
  return thresholds.at(-1)?.[1] ?? missingScore;
}

function percent(from: number | null, to: number | null) {
  if (!finite(from) || from <= 0 || !finite(to)) return null;
  return ((to - from) / from) * 100;
}

export function buildPriceTargetScenario(input: CompanyFoundationInput): PriceTargetScenario {
  const currentPrice = input.market.currentPrice;
  const consensus = input.expectations.targetPriceConsensus ?? input.expectations.targetPriceMedian ?? null;
  const low = input.expectations.targetPriceLow ?? null;
  const high = input.expectations.targetPriceHigh ?? null;
  const basePrice = finite(consensus) && consensus > 0 ? consensus : null;
  const bearPrice = finite(low) && low > 0 ? low : basePrice && currentPrice ? Math.min(currentPrice * 0.88, basePrice * 0.82) : null;
  const bullPrice = finite(high) && high > 0 ? high : basePrice ? basePrice * 1.15 : null;
  const expectedPrice = bearPrice && basePrice && bullPrice ? bearPrice * 0.2 + basePrice * 0.6 + bullPrice * 0.2 : basePrice;
  const upsidePercent = percent(currentPrice, expectedPrice);
  const downsidePercent = percent(currentPrice, bearPrice);
  const rewardRiskRatio = finite(upsidePercent) && finite(downsidePercent) && upsidePercent > 0 && downsidePercent < 0
    ? upsidePercent / Math.abs(downsidePercent)
    : null;
  const providerCount = new Set(input.expectations.sources ?? []).size;
  const completeProviderRange = Boolean(basePrice && bearPrice && bullPrice && (input.expectations.analystCount ?? 0) >= 3);
  const method: PriceTargetScenario["method"] = completeProviderRange
    ? providerCount >= 2 ? "provider_and_fundamental_blend" : "provider_consensus"
    : basePrice ? "provider_consensus" : "unavailable";
  const sourcePosture: PriceTargetScenario["sourcePosture"] = completeProviderRange ? "source_derived" : basePrice ? "screen_grade" : "unavailable";
  return {
    currentPrice,
    bearPrice,
    basePrice,
    bullPrice,
    consensusPrice: basePrice,
    expectedPrice,
    upsidePercent,
    downsidePercent,
    rewardRiskRatio,
    horizonDays: 365,
    method,
    sourcePosture,
    assumptions: [
      ...(basePrice ? ["Base case uses the latest available provider consensus target."] : ["No verified provider target is available; no price target was invented."]),
      ...(basePrice && !low ? ["Bear case is a conservative screen assumption because the provider did not supply a low target."] : []),
      ...(basePrice && !high ? ["Bull case is a conservative screen assumption because the provider did not supply a high target."] : []),
      "A target price is not a guarantee and remains subject to future earnings, valuation, and market conditions.",
    ],
  };
}

function freshnessScore(input: CompanyFoundationInput) {
  const quality = input.dataQuality;
  const marketAge = quality?.marketAgeDays ?? ageDays(input.market.priceObservedAt);
  const financialAge = quality?.financialPeriodAgeDays ?? null;
  const filingAge = quality?.filingAgeDays ?? null;
  const market = ageScore(marketAge, [[2, 100], [5, 92], [10, 75], [30, 45], [Number.POSITIVE_INFINITY, 20]], 45);
  const financial = ageScore(financialAge, [[120, 100], [180, 92], [270, 78], [550, 55], [Number.POSITIVE_INFINITY, 20]], 55);
  const filing = ageScore(filingAge, [[120, 100], [180, 92], [365, 75], [550, 55], [Number.POSITIVE_INFINITY, 20]], 55);
  return clamp(market * 0.4 + financial * 0.4 + filing * 0.2);
}

function dataQualityScore(input: CompanyFoundationInput) {
  const official = input.receipts.filter((receipt) => receipt.reliability === "official").length;
  const high = input.receipts.filter((receipt) => receipt.reliability === "high").length;
  const quality = input.dataQuality;
  const missingPenalty = Math.min(30, input.missingFields.length * 4);
  const contradictionPenalty = Math.min(35, (quality?.contradictionCount ?? input.contradictions?.length ?? 0) * 12);
  const stalePenalty = Math.min(25, (quality?.staleFields.length ?? 0) * 6);
  const providerPenalty = Math.min(20, (quality?.providerErrors.length ?? 0) * 4);
  return clamp(
    38
    + Math.min(28, official * 12)
    + Math.min(12, high * 6)
    + Math.min(8, (quality?.independentFundamentalSources ?? 1) * 4)
    + ((quality?.independentPriceSources ?? input.market.priceSourceCount ?? 1) >= 2 ? 8 : 0)
    + ((quality?.independentExpectationSources ?? new Set(input.expectations.sources ?? []).size) >= 1 ? 8 : 0)
    - missingPenalty
    - contradictionPenalty
    - stalePenalty
    - providerPenalty,
  );
}

function sourceAgreementScore(input: CompanyFoundationInput) {
  const quality = input.dataQuality;
  const priceSources = quality?.independentPriceSources ?? input.market.priceSourceCount ?? 1;
  const agreementPercent = quality?.sourceAgreementPercent ?? input.market.priceAgreementPercent ?? null;
  let priceAgreement = priceSources < 2 ? 55
    : agreementPercent === null ? 75
      : agreementPercent <= 0.5 ? 100
        : agreementPercent <= 1 ? 95
          : agreementPercent <= 2 ? 85
            : agreementPercent <= 5 ? 65
              : 30;
  const expectationAgreement = input.expectations.providerAgreementScore;
  if (finite(expectationAgreement)) priceAgreement = (priceAgreement + clamp(expectationAgreement)) / 2;
  return clamp(priceAgreement);
}

function completenessScore(input: CompanyFoundationInput) {
  const values = [
    input.metrics.revenueGrowthYoY,
    input.metrics.operatingMargin,
    input.metrics.netMargin,
    input.metrics.freeCashFlowMargin,
    input.metrics.debtToAssets,
    input.valuation.priceToEarnings ?? input.valuation.forwardPriceToEarnings,
    input.market.currentPrice,
    input.market.priceChange20d,
    input.market.volumeRatio,
    input.expectations.consensusRevenueGrowthPercent,
    input.expectations.targetPriceConsensus ?? input.expectations.targetPriceMedian,
    input.catalyst.description,
  ];
  return clamp((values.filter((value) => value !== null && value !== undefined && value !== "").length / values.length) * 100);
}

function calibrationScore(input: CompanyFoundationInput) {
  const calibration = input.calibration;
  if (!calibration || calibration.sampleSize <= 0) return 50;
  const precision = finite(calibration.precision) ? calibration.precision * 100 : 50;
  const lowerBound = finite(calibration.lowerConfidenceBound) ? calibration.lowerConfidenceBound * 100 : 0;
  if (calibration.sampleSize >= 30 && lowerBound > 0) return clamp(lowerBound);
  if (calibration.sampleSize >= 10) return clamp(Math.min(80, precision));
  return clamp(Math.min(65, precision));
}

function scenarioScore(input: CompanyFoundationInput, scenario: PriceTargetScenario) {
  if (scenario.sourcePosture === "unavailable") return 35;
  const analystCount = input.expectations.analystCount ?? 0;
  const providerCount = new Set(input.expectations.sources ?? []).size;
  let score = scenario.sourcePosture === "source_derived" ? 82 : 68;
  if (analystCount >= 10) score += 8;
  else if (analystCount >= 3) score += 4;
  if (providerCount >= 2) score += 7;
  if (finite(input.expectations.providerAgreementScore)) score = (score + input.expectations.providerAgreementScore) / 2;
  return clamp(score);
}

export function buildFoundationConfidence(input: CompanyFoundationInput, scenario = buildPriceTargetScenario(input)): ConfidenceBreakdown {
  const dataQuality = dataQualityScore(input);
  const freshness = freshnessScore(input);
  const sourceAgreement = sourceAgreementScore(input);
  const completeness = completenessScore(input);
  const calibration = calibrationScore(input);
  const scenarioConfidence = scenarioScore(input, scenario);
  const calibrationEvidence = input.calibration;
  const historicallyCalibrated = Boolean(calibrationEvidence && calibrationEvidence.sampleSize >= 30 && finite(calibrationEvidence.lowerConfidenceBound));
  let overall = clamp(
    dataQuality * 0.22
    + freshness * 0.18
    + sourceAgreement * 0.15
    + completeness * 0.15
    + calibration * 0.2
    + scenarioConfidence * 0.1,
  );
  const confidenceCaps: string[] = [];
  const expectationSources = input.dataQuality?.independentExpectationSources ?? new Set(input.expectations.sources ?? []).size;
  const contradictions = input.dataQuality?.contradictionCount ?? input.contradictions?.length ?? 0;
  if (!historicallyCalibrated) {
    overall = Math.min(overall, 84);
    confidenceCaps.push("No 30-plus-sample historical calibration is available, so confidence is capped below a serious signal.");
  } else if ((calibrationEvidence?.lowerConfidenceBound ?? 0) < 0.9) {
    overall = Math.min(overall, 89);
    confidenceCaps.push("The historical lower confidence bound is below 90%.");
  }
  if (scenario.sourcePosture === "unavailable") {
    overall = Math.min(overall, 79);
    confidenceCaps.push("No verified price-target scenario is available.");
  }
  if (expectationSources < 1) {
    overall = Math.min(overall, 82);
    confidenceCaps.push("Verified market expectations are unavailable.");
  }
  if (contradictions > 0) {
    overall = Math.min(overall, 75);
    confidenceCaps.push("Contradictory evidence remains unresolved.");
  }
  if (dataQuality < 90 || freshness < 90) {
    overall = Math.min(overall, 89);
    confidenceCaps.push("Data quality or freshness is below the 90% serious-signal requirement.");
  }
  const seriousSignalEligible = overall >= 90
    && dataQuality >= 90
    && freshness >= 90
    && sourceAgreement >= 85
    && completeness >= 90
    && calibration >= 90
    && scenarioConfidence >= 85
    && (calibrationEvidence?.sampleSize ?? 0) >= 30
    && (calibrationEvidence?.lowerConfidenceBound ?? 0) >= 0.9
    && contradictions === 0;
  return {
    dataQuality,
    freshness,
    sourceAgreement,
    completeness,
    calibration,
    scenario: scenarioConfidence,
    overall,
    kind: historicallyCalibrated ? "historically_calibrated" : "evidence_only",
    seriousSignalEligible,
    calibrationSampleSize: calibrationEvidence?.sampleSize ?? 0,
    confidenceCaps: [...new Set(confidenceCaps)],
  };
}

function eventIndependentReceipts(event: EventSignalInput) {
  const payloadValue = event.payload.independentReceipts;
  return finite(payloadValue) ? Math.max(0, Math.floor(payloadValue)) : event.sourceUrl ? 1 : 0;
}

export function buildEventConfidence(event: EventSignalInput, thesis: StoredThesisSnapshot, impact: EventImpact): ConfidenceBreakdown {
  const base = thesis.confidence;
  const official = /sec|edgar|investor relations|company|exchange|government|fda|federal reserve/i.test(event.source);
  const eventAge = ageDays(event.receivedAt);
  const freshness = ageScore(eventAge, [[2, 100], [7, 92], [30, 72], [90, 45], [Number.POSITIVE_INFINITY, 20]], 40);
  const independentReceipts = eventIndependentReceipts(event);
  const sourceAgreement = independentReceipts >= 3 ? 100 : independentReceipts === 2 ? 90 : official ? 72 : 50;
  const dataQuality = clamp((base?.dataQuality ?? thesis.evidenceConfidence) * 0.55 + (official ? 95 : 55) * 0.45);
  const completeness = clamp((base?.completeness ?? 60) * 0.7 + (impact.direction !== "neutral" ? 100 : 50) * 0.3);
  const calibration = base?.calibration ?? 50;
  const scenario = base?.scenario ?? 35;
  let overall = clamp(dataQuality * 0.24 + freshness * 0.2 + sourceAgreement * 0.18 + completeness * 0.12 + calibration * 0.18 + scenario * 0.08);
  const confidenceCaps = [...(base?.confidenceCaps ?? [])];
  if (independentReceipts < 2) {
    overall = Math.min(overall, 84);
    confidenceCaps.push("The event has fewer than two independent receipts.");
  }
  if (!base?.seriousSignalEligible) {
    overall = Math.min(overall, 89);
    confidenceCaps.push("The underlying security thesis is not yet calibrated for a 90% serious signal.");
  }
  if (impact.direction === "neutral") {
    overall = Math.min(overall, 70);
    confidenceCaps.push("The event does not materially change the thesis.");
  }
  const seriousSignalEligible = Boolean(
    base?.seriousSignalEligible
    && official
    && independentReceipts >= 2
    && impact.direction !== "neutral"
    && overall >= 90
    && dataQuality >= 90
    && freshness >= 90
    && sourceAgreement >= 85,
  );
  return {
    dataQuality,
    freshness,
    sourceAgreement,
    completeness,
    calibration,
    scenario,
    overall,
    kind: base?.kind ?? "evidence_only",
    seriousSignalEligible,
    calibrationSampleSize: base?.calibrationSampleSize ?? 0,
    confidenceCaps: [...new Set(confidenceCaps)],
  };
}
