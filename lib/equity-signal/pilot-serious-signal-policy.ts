export const US_SERIOUS_SIGNAL_PILOT_POLICY = {
  version: 4,
  marketScope: "active_us_exchange_listed_common_equities_and_adrs" as const,
  confidenceTier: "current_evidence_no_historical_gate" as const,
  minimumIndependentHistoricalEvents: 0,
  minimumObservedDirectionalHitRatePercent: 0,
  requireLeakageSafeHistory: false,
  requireUsableHistoricalHorizon: false,
  requireNonNegativeLowerQuartileOutcome: false,
  analystExpectationsCanVetoBuy: false,
  forwardOutcomeRequiredBeforeAlert: false,
  historicalCasesRequiredForSeriousSignal: false,
  warning: "Historical cases are optional learning context only. A current event can become a Serious Signal from verified current evidence, exact issuer mapping, fresh market state, causal transmission, contradiction controls, and full committee approval without any historical-case prerequisite.",
};

type Json = Record<string, unknown>;

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function historicalItems(value: unknown) {
  return Array.isArray(value) ? value.filter((item) => Boolean(item && typeof item === "object" && !Array.isArray(item))) : [];
}

export function evaluateFiveCasePilotGate(candidateValue: unknown) {
  const candidate = object(candidateValue);
  const analog = object(candidate.historicalAnalog);
  const items = historicalItems(analog.items);
  const reportedSampleSize = Math.max(0, Math.floor(finite(analog.sampleSize) ?? 0));
  const hitRate = finite(analog.weightedHitRatePercent) ?? finite(analog.hitRatePercent);
  const lowerQuartile = finite(analog.p25DirectionAdjustedReturnPercent);
  const selectedHorizon = typeof analog.selectedHorizon === "string" && analog.selectedHorizon.trim() ? analog.selectedHorizon : null;
  return {
    policyVersion: US_SERIOUS_SIGNAL_PILOT_POLICY.version,
    passed: true,
    confidenceTier: US_SERIOUS_SIGNAL_PILOT_POLICY.confidenceTier,
    historicallyRequired: false,
    statisticallyEquivalentToThirtySamples: false,
    reportedSampleSize,
    independentRealEventCount: items.length,
    observedDirectionalHitRatePercent: hitRate,
    lowerQuartileDirectionAdjustedReturnPercent: lowerQuartile,
    selectedHorizon,
    checks: {
      historicalGateDisabled: true,
      currentEvidenceMayAdvanceWithoutHistory: true,
    },
    blockers: [],
    warning: US_SERIOUS_SIGNAL_PILOT_POLICY.warning,
  };
}
