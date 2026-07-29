export const US_SERIOUS_SIGNAL_PILOT_POLICY = {
  version: 2,
  marketScope: "active_us_exchange_listed_common_equities_and_adrs" as const,
  confidenceTier: "pilot_five_independent_cases" as const,
  minimumIndependentHistoricalEvents: 5,
  minimumObservedDirectionalHitRatePercent: 90,
  requireLeakageSafeHistory: true,
  requireUsableHistoricalHorizon: true,
  requireNonNegativeLowerQuartileOutcome: true,
  analystExpectationsCanVetoBuy: false,
  warning: "Pilot serious signal based on at least five independent real cases. This is not statistically equivalent to a 30-plus-sample certificate.",
};

type Json = Record<string, unknown>;

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function historicalItems(value: unknown) {
  return Array.isArray(value) ? value.map(object).filter((item) => Object.keys(item).length > 0) : [];
}

export function evaluateFiveCasePilotGate(candidateValue: unknown) {
  const candidate = object(candidateValue);
  const analog = object(candidate.historicalAnalog);
  const items = historicalItems(analog.items);
  const uniqueEventKeys = new Set(items.map((item) => String(item.eventKey ?? item.recordId ?? "")).filter(Boolean));
  const provenanceBackedItems = items.filter((item) => {
    const provenance = object(item.provenance);
    return typeof provenance.origin === "string"
      && typeof provenance.eventSourceUrl === "string"
      && typeof provenance.priceSource === "string";
  });
  const sameDirectionItems = items.filter((item) => strings(item.matchedFeatures).includes("same predicted direction"));
  const reportedSampleSize = Math.max(0, Math.floor(finite(analog.sampleSize) ?? 0));
  const independentRealEventCount = items.length
    ? Math.min(uniqueEventKeys.size, provenanceBackedItems.length, sameDirectionItems.length)
    : reportedSampleSize;
  const hitRate = finite(analog.weightedHitRatePercent) ?? finite(analog.hitRatePercent) ?? 0;
  const lowerQuartile = finite(analog.p25DirectionAdjustedReturnPercent);
  const selectedHorizon = typeof analog.selectedHorizon === "string" && analog.selectedHorizon.trim() ? analog.selectedHorizon : null;
  const leakageSafe = analog.leakageSafe === true;
  const checks = {
    fiveIndependentRealEvents: independentRealEventCount >= US_SERIOUS_SIGNAL_PILOT_POLICY.minimumIndependentHistoricalEvents,
    sameDirectionHistoricalEvents: items.length ? sameDirectionItems.length >= US_SERIOUS_SIGNAL_PILOT_POLICY.minimumIndependentHistoricalEvents : reportedSampleSize >= US_SERIOUS_SIGNAL_PILOT_POLICY.minimumIndependentHistoricalEvents,
    leakageSafeHistory: leakageSafe,
    observedDirectionalHitRateAtLeast90: hitRate >= US_SERIOUS_SIGNAL_PILOT_POLICY.minimumObservedDirectionalHitRatePercent,
    usableHistoricalHorizon: selectedHorizon !== null,
    nonNegativeLowerQuartileOutcome: lowerQuartile !== null && lowerQuartile >= 0,
  };
  const blockers = [
    ...(!checks.fiveIndependentRealEvents ? [`Fewer than ${US_SERIOUS_SIGNAL_PILOT_POLICY.minimumIndependentHistoricalEvents} independent real historical events support this setup.`] : []),
    ...(!checks.sameDirectionHistoricalEvents ? ["The historical examples do not all support the same Buy or Sell direction."] : []),
    ...(!checks.leakageSafeHistory ? ["Historical evidence is not proven free of future-information leakage."] : []),
    ...(!checks.observedDirectionalHitRateAtLeast90 ? [`Observed directional success is ${hitRate.toFixed(2)}%, below the 90% pilot requirement.`] : []),
    ...(!checks.usableHistoricalHorizon ? ["No usable historical outcome horizon is available."] : []),
    ...(!checks.nonNegativeLowerQuartileOutcome ? ["The weaker quarter of historical outcomes is negative."] : []),
  ];
  return {
    policyVersion: US_SERIOUS_SIGNAL_PILOT_POLICY.version,
    passed: Object.values(checks).every(Boolean),
    confidenceTier: US_SERIOUS_SIGNAL_PILOT_POLICY.confidenceTier,
    statisticallyEquivalentToThirtySamples: false,
    reportedSampleSize,
    independentRealEventCount,
    observedDirectionalHitRatePercent: hitRate,
    lowerQuartileDirectionAdjustedReturnPercent: lowerQuartile,
    selectedHorizon,
    checks,
    blockers,
    warning: US_SERIOUS_SIGNAL_PILOT_POLICY.warning,
  };
}
