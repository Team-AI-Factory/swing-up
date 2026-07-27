import type { HistoricalSignalRecord } from "@/lib/equity-signal/historical-analogs";
import {
  bootstrapPilotHistoricalSignals,
  mergePilotHistoricalSignals,
} from "@/lib/equity-signal/pilot-historical-bootstrap";
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
  const historicalLearning = object(base.historicalLearning);
  const liveSourcePolicy = object(base.liveSourcePolicy);
  const libraryAdditions = mergePilotHistoricalSignals(
    historicalRecords(base._historicalSignalLibraryAdditions),
    pilotBootstrap.records,
  );
  return {
    ...baseResult,
    marketScope: "active_us_exchange_listed_common_equities_and_adrs",
    pilotHistoricalBootstrap: {
      requestedSeeds: pilotBootstrap.requestedSeeds,
      builtSeeds: pilotBootstrap.builtSeeds,
      errors: pilotBootstrap.errors,
      priceSource: pilotBootstrap.priceSource,
      noSyntheticData: pilotBootstrap.noSyntheticData,
    },
    historicalLearning: {
      ...historicalLearning,
      historicalComparisonRequiredForSeriousSignal: false,
      actionableBuySellRequiresCalibratedHistory: false,
      historicalEvidenceRole: "optional_context_and_r2_learning_only",
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
}
