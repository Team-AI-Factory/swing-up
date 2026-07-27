import {
  analyzeHistoricalAnalogs,
  type HistoricalAnalogDirection,
  type HistoricalAnalogRelationship,
  type HistoricalSignalRecord,
} from "@/lib/equity-signal/historical-analogs";
import {
  bootstrapPilotHistoricalSignals,
  mergePilotHistoricalSignals,
} from "@/lib/equity-signal/pilot-historical-bootstrap";
import { evaluateFiveCasePilotGate, US_SERIOUS_SIGNAL_PILOT_POLICY } from "@/lib/equity-signal/pilot-serious-signal-policy";
import {
  runEquitySignalLab,
  type EquityProviderCallDecision,
  type EquityProviderCallRequest,
  type EquitySignalLabInput,
} from "@/lib/equity-signal/runner";

export type PilotEquityProviderCallDecision = EquityProviderCallDecision;
export type PilotEquityProviderCallRequest = EquityProviderCallRequest;
export type PilotEquitySignalLabInput = EquitySignalLabInput;

type Json = Record<string, unknown>;

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function historicalRecords(value: unknown): HistoricalSignalRecord[] {
  return Array.isArray(value) ? value.filter((item): item is HistoricalSignalRecord => Boolean(item) && typeof item === "object") : [];
}

function direction(value: unknown): HistoricalAnalogDirection | null {
  return value === "upside" || value === "downside" ? value : null;
}

function relationship(value: unknown): HistoricalAnalogRelationship {
  return value === "second_order" || value === "third_order" ? value : "direct";
}

function exactDirectionPilotAnalog(candidate: Json, records: HistoricalSignalRecord[], macroContext: Json, now: Date) {
  const predictedDirection = direction(candidate.direction);
  const eventFamily = typeof candidate.eventFamily === "string" ? candidate.eventFamily : null;
  if (!predictedDirection || !eventFamily) return object(candidate.historicalAnalog);
  const sameDirectionRecords = records.filter((record) => record.direction === predictedDirection);
  return analyzeHistoricalAnalogs({
    eventKey: typeof candidate.evidenceFingerprint === "string"
      ? candidate.evidenceFingerprint
      : `pilot-current-${predictedDirection}-${now.toISOString()}`,
    eventFamily,
    direction: predictedDirection,
    relationship: relationship(candidate.relationship),
    causalChain: strings(candidate.causalChain),
    macroRegime: strings(macroContext.regime),
    asOf: now.toISOString(),
    featuresAsOf: now.toISOString(),
  }, sameDirectionRecords, {
    minimumSimilarity: 0.45,
    maximumAnalogs: 50,
    maximumAnalogsPerTicker: 3,
    minimumSamplesForPreferredHorizon: 5,
    hitThresholdPercent: 0,
  });
}

export async function runPilotEquitySignalLab(input: PilotEquitySignalLabInput = {}) {
  const now = input.now ?? new Date();
  const fetchImpl = input.fetchImpl ?? fetch;
  const suppliedHistory = input.historicalSignals ?? [];
  const pilotBootstrap = await bootstrapPilotHistoricalSignals(suppliedHistory, fetchImpl, now);
  const historicalSignals = mergePilotHistoricalSignals(suppliedHistory, pilotBootstrap.records);
  const baseResult = await runEquitySignalLab({ ...input, now, fetchImpl, historicalSignals });
  const base = baseResult as unknown as Json;
  const selectedCandidate = object(base.selectedCandidate);
  const exactHistoricalAnalog = exactDirectionPilotAnalog(selectedCandidate, historicalSignals, object(base.macroContext), now);
  const pilotCandidate = { ...selectedCandidate, historicalAnalog: exactHistoricalAnalog };
  const pilotGate = evaluateFiveCasePilotGate(pilotCandidate);
  const historicalLearning = object(base.historicalLearning);
  const liveSourcePolicy = object(base.liveSourcePolicy);
  const libraryAdditions = mergePilotHistoricalSignals(
    historicalRecords(base._historicalSignalLibraryAdditions),
    pilotBootstrap.records,
  );
  const common = {
    ...baseResult,
    selectedCandidate: Object.keys(selectedCandidate).length ? pilotCandidate : base.selectedCandidate,
    marketScope: US_SERIOUS_SIGNAL_PILOT_POLICY.marketScope,
    confidenceTier: US_SERIOUS_SIGNAL_PILOT_POLICY.confidenceTier,
    pilotHistoricalGate: pilotGate,
    pilotHistoricalAnalog: exactHistoricalAnalog,
    pilotHistoricalBootstrap: {
      requestedSeeds: pilotBootstrap.requestedSeeds,
      builtSeeds: pilotBootstrap.builtSeeds,
      errors: pilotBootstrap.errors,
      priceSource: pilotBootstrap.priceSource,
      noSyntheticData: pilotBootstrap.noSyntheticData,
    },
    historicalLearning: {
      ...historicalLearning,
      minimumIndependentRealEventsForPilotSeriousBuySell: US_SERIOUS_SIGNAL_PILOT_POLICY.minimumIndependentHistoricalEvents,
      minimumObservedDirectionalHitRatePercent: US_SERIOUS_SIGNAL_PILOT_POLICY.minimumObservedDirectionalHitRatePercent,
      historicalComparisonRequiredForSeriousSignal: true,
      actionableBuySellRequiresCalibratedHistory: true,
      statisticallyEquivalentToThirtySamples: false,
      historicalEvidenceRole: "required_same_direction_five_case_pilot_gate_for_directional_serious_alerts",
      oppositeDirectionEventsExcludedFromPilotSample: true,
      pilotPublicHistoricalSignalsAddedThisRun: pilotBootstrap.records.length,
    },
    liveSourcePolicy: {
      ...liveSourcePolicy,
      marketScope: "US listed common equities and ADRs only",
      nonUsMarketsEnabled: false,
      analystExpectationsCanVetoBuy: false,
      analystExpectationsRole: "optional context only",
    },
    _historicalSignalLibraryAdditions: libraryAdditions,
  };

  const committeeApproved = base.seriousSignalFound === true;
  const directionalAction = base.alertType === "buy" || base.alertType === "sell";
  if (!committeeApproved) return common;

  if (!directionalAction) {
    return {
      ...common,
      status: "candidate_not_directional_buy_or_sell",
      seriousSignalFound: false,
      actionableSignalFound: false,
      alertType: null,
      blockers: [...new Set([...strings(base.blockers), "The event-first path may only emit pilot serious Buy or Sell alerts after the five-case historical gate passes. Watch Out alerts use their own separately approved rule catalog."])],
    };
  }

  if (!pilotGate.passed) {
    return {
      ...common,
      status: "candidate_needs_five_case_pilot_history",
      seriousSignalFound: false,
      actionableSignalFound: false,
      alertType: null,
      blockers: [...new Set([...strings(base.blockers), ...pilotGate.blockers])],
    };
  }

  return {
    ...common,
    status: `pilot_serious_${String(base.alertType)}`,
    seriousSignalFound: true,
    actionableSignalFound: true,
    alertType: base.alertType,
    pilotWarning: US_SERIOUS_SIGNAL_PILOT_POLICY.warning,
  };
}
