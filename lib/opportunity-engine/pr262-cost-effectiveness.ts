import { readVersionedTextFromR2, writeVersionedJsonToR2 } from "@/lib/r2-warehouse";
import { pr262StorageKey } from "@/lib/opportunity-engine/pr262-storage";
import type { pr262ProcessingReliability } from "@/lib/opportunity-engine/pr262-processing-reliability";

const PREFIX = pr262StorageKey("metrics/cost-effectiveness");

type CycleMetrics = {
  checkedAt: string;
  durationMs: number;
  sourceAttempts: number;
  sourceFailures: number;
  newEvents: number;
  sectorFanoutEvents: number;
  pendingEvents: number;
  eventsProcessed: number;
  eventFailures: number;
  processingReliability?: ReturnType<typeof pr262ProcessingReliability>;
  aiCalls: number;
  seriousBuys: number;
  seriousSells: number;
  seriousWatchOuts: number;
  directIssuerFeedsPolled?: number;
};

type DailyMetrics = {
  version: 1;
  date: string;
  updatedAt: string;
  cycles: number;
  totalDurationMs: number;
  sourceAttempts: number;
  sourceFailures: number;
  sourceAccountingVersion: 2;
  sourceAccountingStartedAt: string | null;
  sourceMeasuredCycles: number;
  sourceMeasuredAttempts: number;
  sourceMeasuredFailures: number;
  newEvents: number;
  sectorFanoutEvents: number;
  maximumPendingEvents: number;
  eventsProcessed: number;
  eventFailures: number;
  processingAttempts: number;
  processingFailures: number;
  committeeReviewAttempts: number;
  committeeTechnicalFailures: number;
  committeeOutcomeUnknown: number;
  nontechnicalDeferrals: number;
  processingMeasuredCycles: number;
  processingMeasurementStartedAt: string | null;
  aiCalls: number;
  seriousBuys: number;
  seriousSells: number;
  seriousWatchOuts: number;
  directIssuerFeedsPolled: number;
  derived: {
    averageCycleDurationMs: number;
    sourceFailureRatePercent: number;
    sourceMeasuredFailureRatePercent: number | null;
    processingFailureRatePercent: number | null;
    committeeFailureRatePercent: number | null;
    eventsProcessedPerAiCall: number | null;
    seriousSignalsPerAiCall: number | null;
    quietCycleSharePercent: number;
  };
  quietCycles: number;
};

function empty(date: string): DailyMetrics {
  return {
    version: 1,
    date,
    updatedAt: new Date(0).toISOString(),
    cycles: 0,
    totalDurationMs: 0,
    sourceAttempts: 0,
    sourceFailures: 0,
    sourceAccountingVersion: 2, sourceAccountingStartedAt: null,
    sourceMeasuredCycles: 0, sourceMeasuredAttempts: 0, sourceMeasuredFailures: 0,
    newEvents: 0,
    sectorFanoutEvents: 0,
    maximumPendingEvents: 0,
    eventsProcessed: 0,
    eventFailures: 0,
    processingAttempts: 0, processingFailures: 0, committeeReviewAttempts: 0, committeeTechnicalFailures: 0,
    committeeOutcomeUnknown: 0, nontechnicalDeferrals: 0, processingMeasuredCycles: 0, processingMeasurementStartedAt: null,
    aiCalls: 0,
    seriousBuys: 0,
    seriousSells: 0,
    seriousWatchOuts: 0,
    directIssuerFeedsPolled: 0,
    derived: { averageCycleDurationMs: 0, sourceFailureRatePercent: 0, sourceMeasuredFailureRatePercent: null, processingFailureRatePercent: null, committeeFailureRatePercent: null, eventsProcessedPerAiCall: null, seriousSignalsPerAiCall: null, quietCycleSharePercent: 0 },
    quietCycles: 0,
  };
}

function derive(value: DailyMetrics) {
  const serious = value.seriousBuys + value.seriousSells + value.seriousWatchOuts;
  value.derived = {
    averageCycleDurationMs: value.cycles ? Math.round(value.totalDurationMs / value.cycles) : 0,
    sourceFailureRatePercent: value.sourceAttempts ? Math.round((value.sourceFailures / value.sourceAttempts) * 10_000) / 100 : 0,
    sourceMeasuredFailureRatePercent: value.sourceMeasuredAttempts ? value.sourceMeasuredFailures / value.sourceMeasuredAttempts * 100 : null,
    processingFailureRatePercent: value.processingAttempts ? value.processingFailures / value.processingAttempts * 100 : null,
    committeeFailureRatePercent: value.committeeReviewAttempts ? value.committeeTechnicalFailures / value.committeeReviewAttempts * 100 : null,
    eventsProcessedPerAiCall: value.aiCalls ? Math.round((value.eventsProcessed / value.aiCalls) * 100) / 100 : null,
    seriousSignalsPerAiCall: value.aiCalls ? Math.round((serious / value.aiCalls) * 100) / 100 : null,
    quietCycleSharePercent: value.cycles ? Math.round((value.quietCycles / value.cycles) * 10_000) / 100 : 0,
  };
}

export async function recordPr262CostEffectiveness(input: CycleMetrics) {
  const date = input.checkedAt.slice(0, 10);
  const key = `${PREFIX}/${date}.json`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await readVersionedTextFromR2(key);
    let value = empty(date);
    if (current.found && current.text) {
      try { value = { ...value, ...(JSON.parse(current.text) as DailyMetrics) }; } catch {}
    }
    value.updatedAt = input.checkedAt;
    value.cycles += 1;
    value.totalDurationMs += Math.max(0, input.durationMs);
    value.sourceAttempts += Math.max(0, input.sourceAttempts);
    value.sourceFailures += Math.max(0, input.sourceFailures);
    // Preserve cumulative historical counters exactly. Version-two windows
    // start only here; old scheduled waits are not silently reclassified.
    value.sourceAccountingStartedAt ??= input.checkedAt;
    value.sourceMeasuredCycles += 1;
    value.sourceMeasuredAttempts += Math.max(0, input.sourceAttempts);
    value.sourceMeasuredFailures += Math.max(0, input.sourceFailures);
    value.newEvents += Math.max(0, input.newEvents);
    value.sectorFanoutEvents += Math.max(0, input.sectorFanoutEvents);
    value.maximumPendingEvents = Math.max(value.maximumPendingEvents, input.pendingEvents);
    value.eventsProcessed += Math.max(0, input.eventsProcessed);
    value.eventFailures += Math.max(0, input.eventFailures);
    if (input.processingReliability) {
      for (const name of ["processingAttempts", "processingFailures", "committeeReviewAttempts", "committeeTechnicalFailures", "committeeOutcomeUnknown", "nontechnicalDeferrals"] as const) {
        value[name] += input.processingReliability[name];
      }
      value.processingMeasuredCycles += 1;
      value.processingMeasurementStartedAt ??= input.checkedAt;
    }
    value.aiCalls += Math.max(0, input.aiCalls);
    value.seriousBuys += Math.max(0, input.seriousBuys);
    value.seriousSells += Math.max(0, input.seriousSells);
    value.seriousWatchOuts += Math.max(0, input.seriousWatchOuts);
    value.directIssuerFeedsPolled += Math.max(0, input.directIssuerFeedsPolled ?? 0);
    if (input.newEvents === 0 && input.eventsProcessed === 0 && input.aiCalls === 0) value.quietCycles += 1;
    derive(value);
    const written = await writeVersionedJsonToR2(key, value, current.etag ? { expectedEtag: current.etag } : { createOnly: true });
    if (!written.conflict && !written.written) throw new Error("pr262_cost_metrics_write_failed");
    if (!written.conflict) {
      console.log(`[pr262-cost] ${JSON.stringify({ date, cycles: value.cycles, durationMs: input.durationMs, newEvents: input.newEvents, pendingEvents: input.pendingEvents, eventsProcessed: input.eventsProcessed, aiCalls: input.aiCalls, serious: input.seriousBuys + input.seriousSells + input.seriousWatchOuts, sourceFailureRatePercent: value.derived.sourceFailureRatePercent })}`);
      return { key, daily: value };
    }
  }
  throw new Error("pr262_cost_metrics_conflict");
}

export const PR262_COST_METRICS_PREFIX = PREFIX;
