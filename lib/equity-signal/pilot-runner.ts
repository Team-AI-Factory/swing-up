import type { HistoricalSignalRecord } from "@/lib/equity-signal/historical-analogs";
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

export async function runPilotEquitySignalLab(input: PilotEquitySignalLabInput = {}) {
  const now = input.now ?? new Date();
  const fetchImpl = input.fetchImpl ?? fetch;
  const suppliedHistory = input.historicalSignals ?? [];
  const pilotBootstrap = await bootstrapPilotHistoricalSignals(suppliedHistory, fetchImpl, now);
  const historicalSignals = mergePilotHistoricalSignals(suppliedHistory, pilotBootstrap.records);
  const baseResult = await runEquitySignalLab({ ...input, now, fetchImpl, historicalSignals });
  const base = baseResult as unknown as Json;
  const selectedCandidate = object(base.selectedCandidate);
  const pilotGate = evaluateFiveCasePilotGate(selectedCandidate);
  const historicalLearning = object(base.historicalLearning);
  const liveSourcePolicy = object(base.liveSourcePolicy);
  const libraryAdditions = mergePilotHistoricalSignals(
    historicalRecords(base._historicalSignalLibraryAdditions),
    pilotBootstrap.records,
  );
  const common = {
    ...baseResult,
    marketScope: US_SERIOUS_SIGNAL_PILOT_POLICY.marketScope,
    confidenceTier: US_SERIOUS_SIGNAL_PILOT_POLICY.confidenceTier,
    pilotHistoricalGate: pilotGate,
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
