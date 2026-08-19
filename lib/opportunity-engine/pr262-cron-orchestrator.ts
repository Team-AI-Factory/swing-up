import { deliverSeriousSignalOutbox } from "@/lib/notifications/serious-signal-delivery";
import { getPr262AiDailyBudgetStatus, recordPr262AiCommitteeCostFromResultKey } from "@/lib/opportunity-engine/pr262-ai-daily-cost";
import { enrichPr262SensorCompanyMappings } from "@/lib/opportunity-engine/pr262-company-directory";
import { readPr262ChangeSensorState } from "@/lib/opportunity-engine/pr262-change-sensor";
import { runPr262EventJob } from "@/lib/opportunity-engine/pr262-event-job";
import { runPr262LightweightSensorV3 } from "@/lib/opportunity-engine/pr262-lightweight-sensor-v3";
import { createPr262SensorBudgetedFetch } from "@/lib/opportunity-engine/pr262-sensor-fetch-budget";
import { promotePr262SeriousWatchOut } from "@/lib/opportunity-engine/pr262-serious-watch-out-authority";
import { recordPr262CostEffectiveness } from "@/lib/opportunity-engine/pr262-cost-effectiveness";

const MAX_CYCLE_MS = 210_000;

type Json = Record<string, unknown>;

type AiBudgetStatus = Awaited<ReturnType<typeof getPr262AiDailyBudgetStatus>> & {
  accountingHealthy: boolean;
  accountingError?: string | null;
};

function dueReadyCount(state: Awaited<ReturnType<typeof readPr262ChangeSensorState>>) {
  const now = Date.now();
  return state.pending.filter((event) => {
    const retryAt = event.queueNextAttemptAt ? Date.parse(event.queueNextAttemptAt) : Number.NaN;
    return event.priority >= 80
      && Boolean(event.ticker)
      && (event.source !== "sec" || event.mappingStatus === "mapped")
      && (!Number.isFinite(retryAt) || retryAt <= now);
  }).length;
}

function capacityForQueue(ready: number) {
  if (ready >= 100) return 12;
  if (ready >= 30) return 8;
  return 4;
}

function asJson(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

async function safeAiBudgetStatus(): Promise<AiBudgetStatus> {
  try {
    return { ...(await getPr262AiDailyBudgetStatus()), accountingHealthy: true, accountingError: null };
  } catch (error) {
    return {
      allowed: false,
      spentUsd: 0,
      remainingUsd: 0,
      limitUsd: Number(process.env.SWING_UP_PR262_AI_DAILY_LIMIT_USD) || 10,
      warningUsd: Number(process.env.SWING_UP_PR262_AI_DAILY_WARNING_USD) || 6,
      warning: true,
      hardFuseTripped: false,
      reviewsRecorded: 0,
      unknownUsageReviews: 0,
      accountingHealthy: false,
      accountingError: error instanceof Error ? error.message.slice(0, 180) : "ai_budget_read_failed",
    };
  }
}

export async function runPr262CronCycle() {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();
  const sourceBudget = await createPr262SensorBudgetedFetch();
  let sensor: Awaited<ReturnType<typeof runPr262LightweightSensorV3>>;
  let budgetPersistence: unknown = null;
  try {
    sensor = await runPr262LightweightSensorV3({ fetchImpl: sourceBudget.fetchImpl });
  } finally {
    budgetPersistence = await sourceBudget.flush().catch((error) => ({
      persisted: false,
      error: error instanceof Error ? error.message : "sensor_budget_flush_failed",
    }));
  }

  const mapping = await enrichPr262SensorCompanyMappings().catch((error) => ({
    mapped: 0,
    directoryCompanies: 0,
    directoryUpdatedAt: null,
    error: error instanceof Error ? error.message : "mapping_failed",
  }));

  let state = await readPr262ChangeSensorState();
  const readyAtStart = dueReadyCount(state);
  const capacity = capacityForQueue(readyAtStart);
  const eventResults: Json[] = [];
  const notificationResults: Json[] = [];
  const aiCostResults: Json[] = [];
  let aiBudget = await safeAiBudgetStatus();
  let eventFailures = 0;
  let aiCalls = 0;
  let seriousBuys = 0;
  let seriousSells = 0;
  let seriousWatchOuts = 0;

  // Alpha Vantage's free allowance is shared by the whole app. The sensor owns
  // a small, hard-budgeted share for news/earnings discovery. During the
  // specialist phase we remove the key from this short-lived process so quote
  // fallback uses Yahoo first and FMP second rather than spending a second,
  // independently-accounted Alpha allowance.
  const alphaVantageKey = process.env.ALPHA_VANTAGE_API_KEY;
  delete process.env.ALPHA_VANTAGE_API_KEY;
  try {
    for (let index = 0; index < capacity && Date.now() - startedAt < MAX_CYCLE_MS; index += 1) {
      try {
        const raw = await runPr262EventJob({ allowOpenAi: aiBudget.allowed && aiBudget.accountingHealthy });
        const result = asJson(raw);
        eventResults.push(result);
        const status = String(result.status ?? "");
        if (status === "idle" || status === "busy") break;
        if (result.openAiCalled === true) {
          aiCalls += 1;
          let recorded: Json;
          try {
            recorded = asJson(await recordPr262AiCommitteeCostFromResultKey(typeof result.resultKey === "string" ? result.resultKey : null));
          } catch (error) {
            recorded = { recorded: false, error: error instanceof Error ? error.message : "ai_cost_record_failed" };
          }
          aiCostResults.push(recorded);
          const safeReasons = new Set(["already_recorded"]);
          const recordHealthy = recorded.recorded === true || (typeof recorded.reason === "string" && safeReasons.has(recorded.reason));
          if (!recordHealthy) {
            const latest = await safeAiBudgetStatus();
            aiBudget = {
              ...latest,
              allowed: false,
              accountingHealthy: false,
              accountingError: typeof recorded.error === "string"
                ? recorded.error.slice(0, 180)
                : `ai_cost_record_${String(recorded.reason ?? "unconfirmed")}`,
            };
          } else {
            aiBudget = await safeAiBudgetStatus();
          }
        }
        if (result.seriousSignalFound === true && result.alertType === "buy") seriousBuys += 1;
        if (result.seriousSignalFound === true && result.alertType === "sell") seriousSells += 1;

        const watchOut = await promotePr262SeriousWatchOut(typeof result.resultKey === "string" ? result.resultKey : null)
          .catch(() => ({ promoted: false, outboxKey: null as string | null }));
        if (watchOut.promoted) seriousWatchOuts += 1;

        const outboxKeys = [...new Set([
          typeof result.outboxKey === "string" ? result.outboxKey : null,
          typeof watchOut.outboxKey === "string" ? watchOut.outboxKey : null,
        ].filter((value): value is string => Boolean(value)))];
        for (const outboxKey of outboxKeys) {
          const delivery = await deliverSeriousSignalOutbox(outboxKey).catch((error) => ({
            ok: false,
            outboxKey,
            seriousSignal: true,
            error: error instanceof Error ? error.message.slice(0, 200) : "serious_signal_delivery_failed",
          }));
          notificationResults.push(asJson(delivery));
        }
      } catch (error) {
        eventFailures += 1;
        eventResults.push({ status: "event_job_error", error: error instanceof Error ? error.message.slice(0, 260) : "event_job_failed" });
      }
    }
  } finally {
    if (alphaVantageKey) process.env.ALPHA_VANTAGE_API_KEY = alphaVantageKey;
  }

  state = await readPr262ChangeSensorState();
  const sourceAttempts = sensor.sourceSummary.filter((item) => item.attempted).length;
  const sourceFailures = sensor.sourceSummary.filter((item) => item.attempted && !["connected", "partial", "not_due", "not_configured"].includes(item.status)).length;
  const eventsProcessed = eventResults.filter((item) => Number(item.eventsProcessed) > 0).length;
  const durationMs = Date.now() - startedAt;
  const directIssuer = sensor.sourceSummary.find((item) => item.provider === "direct_issuer_feeds");

  const cost = await recordPr262CostEffectiveness({
    checkedAt,
    durationMs,
    sourceAttempts,
    sourceFailures,
    newEvents: sensor.newEvents,
    sectorFanoutEvents: sensor.sectorFanoutEvents,
    pendingEvents: state.pending.length,
    eventsProcessed,
    eventFailures,
    aiCalls,
    seriousBuys,
    seriousSells,
    seriousWatchOuts,
    directIssuerFeedsPolled: directIssuer?.recordsRead ?? 0,
  }).catch((error) => ({ error: error instanceof Error ? error.message : "cost_metrics_failed" }));

  return {
    ok: sensor.ok,
    mode: "pr262_five_minute_cron_v3",
    checkedAt,
    durationMs,
    sensor: {
      newEvents: sensor.newEvents,
      sectorFanoutEvents: sensor.sectorFanoutEvents,
      pendingEvents: state.pending.length,
      exposureCompanies: sensor.exposureCompanies,
      sources: sensor.sourceSummary,
      costPolicy: sensor.costPolicy,
      providerBudget: sourceBudget.summary(),
      providerBudgetPersistence: budgetPersistence,
    },
    mapping,
    processing: {
      readyAtStart,
      capacity,
      eventsProcessed,
      eventFailures,
      aiCalls,
      seriousBuys,
      seriousSells,
      seriousWatchOuts,
      deadlineMs: MAX_CYCLE_MS,
      eventResults: eventResults.slice(0, 12),
    },
    aiCostControl: {
      ...aiBudget,
      actualTokenUsagePreferred: true,
      unknownUsageFallbackUsd: 0.5,
      candidatesRemainQueuedWhenFuseBlocksAi: true,
      accountingFailureBlocksAdditionalAiOnly: true,
      results: aiCostResults.slice(-20),
    },
    notifications: {
      outboxFirst: true,
      previewDeliveryBlocked: process.env.RAILWAY_GIT_BRANCH?.trim() === "agent/combined-opportunity-engine",
      results: notificationResults.slice(0, 24),
    },
    historicalPolicy: {
      historicalCasesRequiredForSeriousSignal: false,
      historicalCasesRemainLearningContext: true,
    },
    providerPolicy: {
      alphaVantageReservedForSensorOnly: true,
      eventQuoteFallbackOrder: ["Yahoo Finance", "Financial Modeling Prep"],
    },
    cost,
    safety: { publishing: false, notificationsFromUnverifiedCandidates: false, trades: false, databaseWrites: false },
  };
}
