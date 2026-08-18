import { readVersionedTextFromR2, writeVersionedJsonToR2 } from "@/lib/r2-warehouse";

const PREFIX = "branch-labs/pr-262/metrics/cost-effectiveness";

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
  newEvents: number;
  sectorFanoutEvents: number;
  maximumPendingEvents: number;
  eventsProcessed: number;
  eventFailures: number;
  aiCalls: number;
  seriousBuys: number;
  seriousSells: number;
  seriousWatchOuts: number;
  directIssuerFeedsPolled: number;
  derived: {
    averageCycleDurationMs: number;
    sourceFailureRatePercent: number;
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
    newEvents: 0,
    sectorFanoutEvents: 0,
    maximumPendingEvents: 0,
    eventsProcessed: 0,
    eventFailures: 0,
    aiCalls: 0,
    seriousBuys: 0,
    seriousSells: 0,
    seriousWatchOuts: 0,
    directIssuerFeedsPolled: 0,
    derived: { averageCycleDurationMs: 0, sourceFailureRatePercent: 0, eventsProcessedPerAiCall: null, seriousSignalsPerAiCall: null, quietCycleSharePercent: 0 },
    quietCycles: 0,
  };
}

function derive(value: DailyMetrics) {
  const serious = value.seriousBuys + value.seriousSells + value.seriousWatchOuts;
  value.derived = {
    averageCycleDurationMs: value.cycles ? Math.round(value.totalDurationMs / value.cycles) : 0,
    sourceFailureRatePercent: value.sourceAttempts ? Math.round((value.sourceFailures / value.sourceAttempts) * 10_000) / 100 : 0,
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
    value.newEvents += Math.max(0, input.newEvents);
    value.sectorFanoutEvents += Math.max(0, input.sectorFanoutEvents);
    value.maximumPendingEvents = Math.max(value.maximumPendingEvents, input.pendingEvents);
    value.eventsProcessed += Math.max(0, input.eventsProcessed);
    value.eventFailures += Math.max(0, input.eventFailures);
    value.aiCalls += Math.max(0, input.aiCalls);
    value.seriousBuys += Math.max(0, input.seriousBuys);
    value.seriousSells += Math.max(0, input.seriousSells);
    value.seriousWatchOuts += Math.max(0, input.seriousWatchOuts);
    value.directIssuerFeedsPolled += Math.max(0, input.directIssuerFeedsPolled ?? 0);
    if (input.newEvents === 0 && input.eventsProcessed === 0 && input.aiCalls === 0) value.quietCycles += 1;
    derive(value);
    const written = await writeVersionedJsonToR2(key, value, current.etag ? { expectedEtag: current.etag } : { createOnly: true });
    if (!written.conflict) {
      console.log(`[pr262-cost] ${JSON.stringify({ date, cycles: value.cycles, durationMs: input.durationMs, newEvents: input.newEvents, pendingEvents: input.pendingEvents, eventsProcessed: input.eventsProcessed, aiCalls: input.aiCalls, serious: input.seriousBuys + input.seriousSells + input.seriousWatchOuts, sourceFailureRatePercent: value.derived.sourceFailureRatePercent })}`);
      return { key, daily: value };
    }
  }
  throw new Error("pr262_cost_metrics_conflict");
}

export const PR262_COST_METRICS_PREFIX = PREFIX;
