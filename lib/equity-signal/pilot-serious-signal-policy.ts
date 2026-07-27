export const US_SERIOUS_SIGNAL_PILOT_POLICY = {
  version: 1,
  marketScope: "active_us_exchange_listed_common_equities_and_adrs" as const,
  minimumIndependentHistoricalEvents: 5,
  minimumObservedDirectionalHitRatePercent: 90,
  minimumLowerQuartileDirectionAdjustedReturnPercent: 0,
  requireLeakageSafeHistory: true,
  requireSelectedHistoricalHorizon: true,
  analystExpectationsCanVetoBuy: false,
  confidenceTier: "pilot_five_case_observed_hit_rate" as const,
  statisticallyEquivalentToThirtySamples: false,
  warning: "Five independent examples are a pilot threshold. They can produce an early serious alert, but they are materially less statistically reliable than a 30-plus-sample certificate.",
};

type Json = Record<string, unknown>;

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function evaluateFiveCasePilotGate(candidateValue: unknown) {
  const candidate = object(candidateValue);
  const analog = object(candidate.historicalAnalog);
  const sampleSize = Math.max(0, Math.floor(finite(analog.sampleSize) ?? 0));
  const observedHitRatePercent = finite(analog.weightedHitRatePercent)
    ?? finite(analog.hitRatePercent)
    ?? 0;
  const lowerQuartileDirectionAdjustedReturnPercent = finite(analog.p25DirectionAdjustedReturnPercent);
  const selectedHorizon = typeof analog.selectedHorizon === "string" && analog.selectedHorizon.trim()
    ? analog.selectedHorizon.trim()
    : null;
  const checks = {
    usEquityScope: true,
    fiveIndependentRealEvents: sampleSize >= US_SERIOUS_SIGNAL_PILOT_POLICY.minimumIndependentHistoricalEvents,
    observedDirectionalHitRateAtLeast90: observedHitRatePercent >= US_SERIOUS_SIGNAL_PILOT_POLICY.minimumObservedDirectionalHitRatePercent,
    lowerQuartileNotOppositeDirection: lowerQuartileDirectionAdjustedReturnPercent !== null
      && lowerQuartileDirectionAdjustedReturnPercent >= US_SERIOUS_SIGNAL_PILOT_POLICY.minimumLowerQuartileDirectionAdjustedReturnPercent,
    leakageSafe: analog.leakageSafe === true,
    selectedHistoricalHorizon: selectedHorizon !== null,
  };
  const passed = Object.values(checks).every(Boolean);
  const blockers = [
    ...(!checks.fiveIndependentRealEvents ? [`Only ${sampleSize} independent real historical event(s) are available; five are required for the pilot.`] : []),
    ...(!checks.observedDirectionalHitRateAtLeast90 ? [`Observed directional hit rate is ${observedHitRatePercent.toFixed(1)}%; at least 90% is required.`] : []),
    ...(!checks.lowerQuartileNotOppositeDirection ? ["The lower-quartile historical result does not support the predicted direction."] : []),
    ...(!checks.leakageSafe ? ["Historical comparison is not proven free from future-data leakage."] : []),
    ...(!checks.selectedHistoricalHorizon ? ["No usable historical outcome horizon is available."] : []),
  ];
  return {
    passed,
    checks,
    sampleSize,
    observedHitRatePercent,
    lowerQuartileDirectionAdjustedReturnPercent,
    selectedHorizon,
    blockers,
    policy: US_SERIOUS_SIGNAL_PILOT_POLICY,
  };
}
