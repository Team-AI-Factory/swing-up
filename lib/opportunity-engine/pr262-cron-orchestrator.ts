import {
  deliverSeriousSignalOutbox,
  processPendingSeriousSignalDeliveries,
} from "@/lib/notifications/serious-signal-delivery";
import {
  getPr262AiDailyBudgetStatus,
  recordPr262AiCommitteeCostFromResultKey,
  releasePr262AiCommitteeBudgetReservation,
  reservePr262AiCommitteeBudget,
} from "@/lib/opportunity-engine/pr262-ai-daily-cost";
import { enrichPr262SensorCompanyMappings } from "@/lib/opportunity-engine/pr262-company-directory";
import {
  applyPr262PendingSensorEventMutations,
  readPr262ChangeSensorState,
  type Pr262PendingSensorEventMutation,
} from "@/lib/opportunity-engine/pr262-change-sensor";
import { runPr262EventJob } from "@/lib/opportunity-engine/pr262-event-job";
import { runPr262LightweightSensorV3 } from "@/lib/opportunity-engine/pr262-lightweight-sensor-v3";
import { createPr262SensorBudgetedFetch } from "@/lib/opportunity-engine/pr262-sensor-fetch-budget";
import { promotePr262SeriousWatchOut } from "@/lib/opportunity-engine/pr262-serious-watch-out-authority";
import { recordPr262CostEffectiveness } from "@/lib/opportunity-engine/pr262-cost-effectiveness";
import { isPr262ApprovedPremergeProductionRollout } from "@/lib/opportunity-engine/pr262-runtime";

const MAX_CYCLE_MS = 210_000;
const REPORTING_RESERVE_MS = 15_000;
const MIN_EVENT_START_BUDGET_MS = 45_000;

type Json = Record<string, unknown>;
type Pr262CycleInput = {
  maxCycleMs?: number;
  signal?: AbortSignal;
};
type Pr262CycleMode = "sensor_and_analysis" | "analysis_only";

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
      && event.mappingStatus === "mapped"
      && (event.source !== "sec" || (
        event.identityMethod === "official_sec_archive_link"
        && Boolean(event.cik)
        && Boolean(event.accession)
        && Boolean(event.canonicalSecIndexUrl)
      ))
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

class Pr262CycleDeadlineError extends Error {
  constructor() {
    super("pr262_cycle_deadline_exceeded");
    this.name = "Pr262CycleDeadlineError";
  }
}

function composedSignal(signals: Array<AbortSignal | null | undefined>) {
  const active = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (!active.length) return undefined;
  if (active.length === 1) return active[0];
  return AbortSignal.any(active);
}

async function safeAiBudgetStatus(): Promise<AiBudgetStatus> {
  try {
    return { ...(await getPr262AiDailyBudgetStatus()), accountingHealthy: true, accountingError: null };
  } catch (error) {
    return {
      allowed: false,
      spentUsd: 0,
      reservedUsd: 0,
      exposureUsd: 0,
      remainingUsd: 0,
      limitUsd: Number(process.env.SWING_UP_PR262_AI_DAILY_LIMIT_USD) || 10,
      warningUsd: Number(process.env.SWING_UP_PR262_AI_DAILY_WARNING_USD) || 6,
      warning: true,
      hardFuseTripped: true,
      nextReviewReservationUsd: Number(process.env.SWING_UP_PR262_AI_REVIEW_RESERVATION_USD) || 0.75,
      reservationCheckedBeforePaidCommittee: true,
      activeReservations: 0,
      reviewsRecorded: 0,
      unknownUsageReviews: 0,
      accountingHealthy: false,
      accountingError: error instanceof Error ? error.message.slice(0, 180) : "ai_budget_read_failed",
    };
  }
}

async function executePr262Cycle(mode: Pr262CycleMode, input: Pr262CycleInput, cycleSignal: AbortSignal, deadlineAtMs: number) {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();
  const processingDeadlineAtMs = deadlineAtMs - REPORTING_RESERVE_MS;
  const assertCycleActive = () => {
    if (Date.now() >= deadlineAtMs) throw new Pr262CycleDeadlineError();
    if (cycleSignal.aborted) {
      throw cycleSignal.reason instanceof Error ? cycleSignal.reason : new Error("pr262_cycle_aborted");
    }
  };

  let sourceBudget: Awaited<ReturnType<typeof createPr262SensorBudgetedFetch>> | null = null;
  let sensor: Awaited<ReturnType<typeof runPr262LightweightSensorV3>> | null = null;
  let budgetPersistence: unknown = { persisted: false, reason: "railway_analysis_recovery_skips_discovery" };
  if (mode === "sensor_and_analysis") {
    assertCycleActive();
    sourceBudget = await createPr262SensorBudgetedFetch({ signal: cycleSignal });
    try {
      sensor = await runPr262LightweightSensorV3({ fetchImpl: sourceBudget.fetchImpl });
    } finally {
      budgetPersistence = await sourceBudget.flush().catch((error) => ({
        persisted: false,
        error: error instanceof Error ? error.message : "sensor_budget_flush_failed",
      }));
    }
  }

  assertCycleActive();
  // Railway performs a final mapping pass so unresolved or ambiguous issuers
  // still fail closed before analysis.
  const mapping = await enrichPr262SensorCompanyMappings().catch((error) => ({
    mapped: 0,
    directoryCompanies: 0,
    directoryUpdatedAt: null,
    error: error instanceof Error ? error.message : "mapping_failed",
  }));

  assertCycleActive();
  let state = await readPr262ChangeSensorState();
  const readyAtStart = dueReadyCount(state);
  const capacity = capacityForQueue(readyAtStart);
  const eventResults: Json[] = [];
  const notificationResults: Json[] = [];
  const aiCostResults: Json[] = [];
  let aiBudget = await safeAiBudgetStatus();
  let eventFailures = 0;
  let eventDeferrals = 0;
  let aiCalls = 0;
  let seriousBuys = 0;
  let seriousSells = 0;
  let seriousWatchOuts = 0;
  let deadlineStoppedAdmissions = false;
  const queueMutations: Pr262PendingSensorEventMutation[] = [];
  const excludedEventIds = new Set<string>();

  for (let index = 0; index < capacity; index += 1) {
    const remainingMs = processingDeadlineAtMs - Date.now();
    if (remainingMs < MIN_EVENT_START_BUDGET_MS || cycleSignal.aborted) {
      deadlineStoppedAdmissions = true;
      break;
    }
    let aiReservationFingerprint: string | null = null;
    try {
      const raw = await runPr262EventJob({
        allowOpenAi: aiBudget.allowed && aiBudget.accountingHealthy,
        excludedEventIds: [...excludedEventIds],
        queueMutationSink: (mutation) => {
          queueMutations.push(mutation);
          excludedEventIds.add(mutation.eventId);
        },
        beforeOpenAiCall: async (reservation) => {
          try {
            const reserved = await reservePr262AiCommitteeBudget({
              candidateFingerprint: reservation.candidateFingerprint,
              ticker: reservation.ticker,
              direction: reservation.direction,
            });
            aiCostResults.push(asJson(reserved));
            if (reserved.allowed) aiReservationFingerprint = reservation.candidateFingerprint;
            return reserved.allowed;
          } catch (error) {
            aiBudget = {
              ...(await safeAiBudgetStatus()),
              allowed: false,
              accountingHealthy: false,
              accountingError: error instanceof Error ? error.message.slice(0, 180) : "ai_budget_reservation_failed",
            };
            return false;
          }
        },
        signal: cycleSignal,
        deadlineAtMs: processingDeadlineAtMs,
      });
      assertCycleActive();
      const result = asJson(raw);
      eventResults.push(result);
      const status = String(result.status ?? "");
      if (status === "idle" || status === "busy") break;
      if (result.ok === false) eventFailures += 1;
      if (result.openAiCalled === true) {
        aiCalls += 1;
        let recorded: Json;
        try {
          recorded = asJson(await recordPr262AiCommitteeCostFromResultKey(typeof result.resultKey === "string" ? result.resultKey : null));
        } catch (error) {
          recorded = { recorded: false, error: error instanceof Error ? error.message : "ai_cost_record_failed" };
        }
        aiCostResults.push(recorded);
        const recordHealthy = recorded.recorded === true || recorded.reason === "already_recorded";
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
      } else if (aiReservationFingerprint) {
        try {
          await releasePr262AiCommitteeBudgetReservation(aiReservationFingerprint);
          aiBudget = await safeAiBudgetStatus();
        } catch (error) {
          aiBudget = {
            ...(await safeAiBudgetStatus()),
            allowed: false,
            accountingHealthy: false,
            accountingError: error instanceof Error ? error.message.slice(0, 180) : "ai_budget_reservation_release_failed",
          };
        }
      }
      const watchOut = await promotePr262SeriousWatchOut(typeof result.resultKey === "string" ? result.resultKey : null)
        .catch(() => ({ promoted: false, outboxKey: null as string | null }));
      if (result.seriousSignalFound === true && result.alertType === "buy") seriousBuys += 1;
      if (watchOut.promoted) seriousWatchOuts += 1;
      else if (result.seriousSignalFound === true && result.alertType === "sell") seriousSells += 1;

      const outboxKeys = [...new Set([
        typeof result.outboxKey === "string" ? result.outboxKey : null,
        typeof watchOut.outboxKey === "string" ? watchOut.outboxKey : null,
      ].filter((value): value is string => Boolean(value)))];
      for (const outboxKey of outboxKeys) {
        if (Date.now() >= processingDeadlineAtMs || cycleSignal.aborted) {
          deadlineStoppedAdmissions = true;
          break;
        }
        const delivery = await deliverSeriousSignalOutbox(outboxKey, {
          signal: cycleSignal,
          deadlineAtMs: processingDeadlineAtMs,
        }).catch((error) => ({
          ok: false,
          outboxKey,
          seriousSignal: true,
          error: error instanceof Error ? error.message.slice(0, 200) : "serious_signal_delivery_failed",
        }));
        notificationResults.push(asJson(delivery));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 260) : "event_job_failed";
      const retryableEvidenceDeferral = /^(?:pr262_event_full_source_incomplete|pr262_event_report_retry:[^;]+|[a-z0-9_]+_(?:rolling_quota_guard|cadence_guard)); next_retry_at=/.test(message);
      if (retryableEvidenceDeferral) eventDeferrals += 1;
      else eventFailures += 1;
      eventResults.push({
        status: retryableEvidenceDeferral ? "event_job_deferred" : "event_job_error",
        error: message,
      });
      if (/deadline|aborted/i.test(message) || cycleSignal.aborted) {
        deadlineStoppedAdmissions = true;
        break;
      }
    }
  }

  let queuePersistence: Json = {
    written: false,
    writes: 0,
    acknowledged: 0,
    retried: 0,
    reason: "no_event_queue_changes",
  };
  let queuePersistenceHealthy = true;
  if (queueMutations.length > 0) {
    try {
      queuePersistence = asJson(await applyPr262PendingSensorEventMutations(queueMutations));
    } catch (error) {
      queuePersistenceHealthy = false;
      queuePersistence = {
        written: false,
        writes: 0,
        mutationCount: queueMutations.length,
        error: error instanceof Error ? error.message.slice(0, 200) : "event_queue_batch_write_failed",
      };
    }
  }

  const deliveryRecovery = processingDeadlineAtMs - Date.now() >= 30_000 && !cycleSignal.aborted
    ? await processPendingSeriousSignalDeliveries({
        maxJobs: 4,
        signal: cycleSignal,
        deadlineAtMs: processingDeadlineAtMs,
      }).catch((error) => ({
        ok: false,
        error: error instanceof Error ? error.message.slice(0, 200) : "serious_signal_delivery_recovery_failed",
      }))
    : { ok: false, skipped: true, reason: "cycle_deadline_reserve" };

  assertCycleActive();
  state = await readPr262ChangeSensorState();
  const sourceSummary = sensor?.sourceSummary ?? [];
  const sourceAttempts = sourceSummary.filter((item) => item.attempted).length;
  const sourceFailures = sourceSummary.filter((item) => item.attempted && !["connected", "partial", "not_due", "not_configured"].includes(item.status)).length;
  const eventsProcessed = eventResults.filter((item) => Number(item.eventsProcessed) > 0).length;
  const durationMs = Date.now() - startedAt;
  const directIssuer = sourceSummary.find((item) => item.provider === "direct_issuer_feeds");
  const materialCostActivity = sourceFailures > 0
    || (sensor?.newEvents ?? 0) > 0
    || eventsProcessed > 0
    || eventFailures > 0
    || aiCalls > 0
    || seriousBuys > 0
    || seriousSells > 0
    || seriousWatchOuts > 0
    || "error" in mapping;
  if (!materialCostActivity) {
    console.log(JSON.stringify({
      kind: "pr262_quiet_cycle",
      checkedAt,
      durationMs,
      pendingEvents: state.pending.length,
      eventDeferrals,
      r2MetricsWrite: false,
    }));
  }
  const cost = Date.now() >= deadlineAtMs
    ? { skipped: true, reason: "cycle_deadline" }
    : materialCostActivity
    ? await recordPr262CostEffectiveness({
        checkedAt,
        durationMs,
        sourceAttempts,
        sourceFailures,
        newEvents: sensor?.newEvents ?? 0,
        sectorFanoutEvents: sensor?.sectorFanoutEvents ?? 0,
        pendingEvents: state.pending.length,
        eventsProcessed,
        eventFailures,
        aiCalls,
        seriousBuys,
        seriousSells,
        seriousWatchOuts,
        directIssuerFeedsPolled: directIssuer?.recordsRead ?? 0,
      }).catch((error) => ({ error: error instanceof Error ? error.message : "cost_metrics_failed" }))
    : { persisted: false, reason: "quiet_cycle_logged_to_railway_only" };

  const mappingHealthy = !("error" in mapping);
  const notificationFailures = notificationResults.filter((result) => result.seriousSignal === true && result.ok !== true).length;
  const recoveryStatus = asJson(deliveryRecovery);
  const deliveryHealthy = notificationFailures === 0
    && (recoveryStatus.skipped === true || recoveryStatus.ok === true);
  const operationalOk = (sensor?.ok ?? true)
    && mappingHealthy
    && eventFailures === 0
    && queuePersistenceHealthy
    && aiBudget.accountingHealthy
    && deliveryHealthy;
  return {
    ok: operationalOk,
    mode: mode === "analysis_only" ? "pr262_railway_analysis_recovery" : "pr262_five_minute_cron_v3",
    checkedAt,
    durationMs,
    sensor: sensor ? {
      skipped: false,
      newEvents: sensor.newEvents,
      sectorFanoutEvents: sensor.sectorFanoutEvents,
      pendingEvents: state.pending.length,
      exposureCompanies: sensor.exposureCompanies,
      sources: sourceSummary,
      costPolicy: sensor.costPolicy,
      providerBudget: sourceBudget?.summary() ?? null,
      providerBudgetPersistence: budgetPersistence,
    } : {
      skipped: true,
      owner: "railway_sensor",
      reason: "railway_analysis_recovery_reads_existing_r2_queue",
      pendingEvents: state.pending.length,
    },
    mapping,
    processing: {
      readyAtStart,
      capacity,
      eventsProcessed,
      eventFailures,
      eventDeferrals,
      queuePersistence,
      aiCalls,
      seriousBuys,
      seriousSells,
      seriousWatchOuts,
      deadlineMs: deadlineAtMs - startedAt,
      deadlineStoppedAdmissions,
      eventResults: eventResults.slice(0, 12),
    },
    aiCostControl: {
      ...aiBudget,
      actualTokenUsagePreferred: true,
      unknownUsageFallbackUsd: 0.75,
      incompleteUsageRetainsFullReservation: true,
      hardDailyLimitCannotBeRaisedAboveUsd: 10,
      candidatesRemainQueuedWhenFuseBlocksAi: true,
      accountingFailureBlocksAdditionalAiOnly: true,
      results: aiCostResults.slice(-20),
    },
    notifications: {
      outboxFirst: true,
      previewDeliveryBlocked: process.env.RAILWAY_GIT_BRANCH?.trim() === "agent/combined-opportunity-engine"
        && !isPr262ApprovedPremergeProductionRollout(),
      healthy: deliveryHealthy,
      directFailures: notificationFailures,
      durableRecoveryConsumer: deliveryRecovery,
      results: notificationResults.slice(0, 24),
    },
    historicalPolicy: {
      historicalCasesRequiredForSeriousSignal: false,
      historicalCasesRemainLearningContext: true,
    },
    providerPolicy: {
      alphaVantageDiscoveryAndRailwayFallbackAreDurablyBudgeted: true,
      eventQuoteFallbackOrder: ["Yahoo Finance", "Alpha Vantage", "Financial Modeling Prep when commercially approved"],
    },
    cost,
    safety: { publishing: false, notificationsFromUnverifiedCandidates: false, trades: false, databaseWrites: false },
  };
}

async function runPr262Cycle(mode: Pr262CycleMode, input: Pr262CycleInput = {}) {
  const maxCycleMs = Number.isFinite(input.maxCycleMs)
    ? Math.max(1_000, Math.min(MAX_CYCLE_MS, Math.round(Number(input.maxCycleMs))))
    : MAX_CYCLE_MS;
  const deadlineAtMs = Date.now() + maxCycleMs;
  const deadlineAbort = new AbortController();
  const deadlineTimer = setTimeout(() => deadlineAbort.abort(new Pr262CycleDeadlineError()), maxCycleMs);
  deadlineTimer.unref?.();
  const cycleSignal = composedSignal([input.signal, deadlineAbort.signal]) ?? deadlineAbort.signal;
  let rejectDeadline: (reason?: unknown) => void = () => undefined;
  const deadlinePromise = new Promise<never>((_, reject) => {
    rejectDeadline = reject;
  });
  const rejectOnAbort = () => rejectDeadline(cycleSignal.reason instanceof Error ? cycleSignal.reason : new Pr262CycleDeadlineError());
  if (cycleSignal.aborted) rejectOnAbort();
  else cycleSignal.addEventListener("abort", rejectOnAbort, { once: true });
  try {
    return await Promise.race([
      executePr262Cycle(mode, input, cycleSignal, deadlineAtMs),
      deadlinePromise,
    ]);
  } finally {
    clearTimeout(deadlineTimer);
    cycleSignal.removeEventListener("abort", rejectOnAbort);
  }
}

export async function runPr262CronCycle(input: Pr262CycleInput = {}) {
  return runPr262Cycle("sensor_and_analysis", input);
}

export async function runPr262AnalysisOnlyCycle(input: Pr262CycleInput = {}) {
  return runPr262Cycle("analysis_only", input);
}
