import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/opportunity-engine/pr262-cron-orchestrator.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

let sensorCalls = 0;
let mappingCalls = 0;
let eventCalls = 0;
let deliveryRecoveryCalls = 0;
let queueBatchCalls = 0;
let mappingHealthy = true;
let deliveryHealthy = true;
let eventMode = "idle";
let allowSensorRun = false;
const state = {
  pending: [{
    id: "railway:queued-1",
    priority: 95,
    ticker: "SAFE",
    source: "company_news",
    queueNextAttemptAt: null,
  }],
};
const stubs = {
  "@/lib/notifications/serious-signal-delivery": {
    deliverSeriousSignalOutbox: async () => ({ ok: true }),
    processPendingSeriousSignalDeliveries: async () => {
      deliveryRecoveryCalls += 1;
      return { ok: deliveryHealthy, jobsAttempted: 0, ...(deliveryHealthy ? {} : { error: "delivery_queue_unhealthy" }) };
    },
  },
  "@/lib/opportunity-engine/pr262-ai-daily-cost": {
    getPr262AiDailyBudgetStatus: async () => ({ allowed: true, spentUsd: 0, reservedUsd: 0, exposureUsd: 0, remainingUsd: 10, limitUsd: 10, warningUsd: 6, warning: false, hardFuseTripped: false, nextReviewReservationUsd: 0.75, reservationCheckedBeforePaidCommittee: true, activeReservations: 0, reviewsRecorded: 0, unknownUsageReviews: 0 }),
    reservePr262AiCommitteeBudget: async () => ({ allowed: true, reason: "reserved" }),
    releasePr262AiCommitteeBudgetReservation: async () => ({ released: true }),
    recordPr262AiCommitteeCostFromResultKey: async () => ({ recorded: true }),
  },
  "@/lib/opportunity-engine/pr262-company-directory": {
    enrichPr262SensorCompanyMappings: async () => {
      mappingCalls += 1;
      return mappingHealthy
        ? { mapped: 1, directoryCompanies: 1, directoryUpdatedAt: new Date().toISOString() }
        : { mapped: 0, directoryCompanies: 0, directoryUpdatedAt: null, error: "directory_unavailable" };
    },
  },
  "@/lib/opportunity-engine/pr262-change-sensor": {
    readPr262ChangeSensorState: async () => structuredClone(state),
    applyPr262PendingSensorEventMutations: async (mutations) => {
      queueBatchCalls += 1;
      const acknowledged = new Set(mutations.filter((item) => item.action === "acknowledge").map((item) => item.eventId));
      state.pending = state.pending.filter((event) => !acknowledged.has(event.id));
      return { written: true, writes: 1, acknowledged: acknowledged.size, retried: 0, pendingCount: state.pending.length };
    },
  },
  "@/lib/opportunity-engine/pr262-event-job": {
    runPr262EventJob: async (input) => {
      eventCalls += 1;
      assert.ok(input.signal instanceof AbortSignal);
      assert.ok(input.deadlineAtMs > Date.now());
      assert.equal(typeof input.beforeOpenAiCall, "function", "Railway must pass the durable dollar reservation hook before paid analysis.");
      if (eventMode === "evidence_deferred") {
        eventMode = "idle";
        throw new Error("pr262_event_full_source_incomplete:provider_budget_not_due; event_id=sec:0001213900-26-094677; ticker=MBAI; cik=0001610590; next_retry_at=2026-08-27T07:53:02.028Z");
      }
      if (eventMode === "rolling_quota_deferred") {
        eventMode = "idle";
        throw new Error("pr262_full_source_rolling_quota_guard; next_retry_at=2026-08-28T02:22:47.870Z");
      }
      if (eventMode === "targeted_quota_deferred") {
        eventMode = "idle";
        throw new Error("tradingview_targeted_value_rolling_quota_guard; next_retry_at=2026-08-28T02:23:01.827Z");
      }
      if (eventMode === "network_timeout_deferred") {
        eventMode = "idle";
        throw new Error("The operation was aborted due to timeout; next_retry_at=2026-08-27T10:42:26.025Z");
      }
      if (eventMode === "universe_stale_deferred") {
        eventMode = "idle";
        throw new Error("pr262_authoritative_equity_universe_stale; next_retry_at=2026-08-28T07:30:40.815Z");
      }
      if (eventMode === "broken") {
        eventMode = "idle";
        throw new Error("unexpected_event_processing_failure");
      }
      if (eventMode === "processed") {
        eventMode = "idle";
        input.queueMutationSink({ action: "acknowledge", eventId: state.pending[0].id });
        return { ok: true, status: "completed", eventsProcessed: 1 };
      }
      return { ok: true, status: "idle", eventsProcessed: 0 };
    },
  },
  "@/lib/opportunity-engine/pr262-lightweight-sensor-v3": {
    runPr262LightweightSensorV3: async () => {
      sensorCalls += 1;
      if (!allowSensorRun) throw new Error("analysis_only_must_not_scan_sources");
      return { ok: true, newEvents: 0, sectorFanoutEvents: 0, exposureCompanies: 1, sourceSummary: [], costPolicy: {}, r2Persistence: { queueWritten: false } };
    },
  },
  "@/lib/opportunity-engine/pr262-sensor-fetch-budget": {
    createPr262SensorBudgetedFetch: async () => ({ fetchImpl: async () => { throw new Error("unexpected_fetch"); }, flush: async () => ({ persisted: true }), summary: () => ({ calls: 0 }) }),
  },
  "@/lib/opportunity-engine/pr262-serious-watch-out-authority": { promotePr262SeriousWatchOut: async () => ({ promoted: false, outboxKey: null }) },
  "@/lib/opportunity-engine/pr262-cost-effectiveness": { recordPr262CostEffectiveness: async () => ({ persisted: true }) },
  "@/lib/opportunity-engine/pr262-runtime": { isPr262ApprovedPremergeProductionRollout: () => false },
};
const loaded = { exports: {} };
new Function("require", "module", "exports", output)((name) => {
  if (name in stubs) return stubs[name];
  throw new Error(`Unexpected analysis-only orchestrator import: ${name}`);
}, loaded, loaded.exports);

const result = await loaded.exports.runPr262AnalysisOnlyCycle({ maxCycleMs: 90_000 });
assert.equal(result.ok, true);
assert.equal(result.mode, "pr262_railway_analysis_recovery");
assert.equal(result.sensor.skipped, true);
assert.equal(result.sensor.owner, "railway_sensor");
assert.equal(result.processing.queueHealthAtStart.basis, "age_priority_and_retry_state");
assert.equal(result.processing.queueHealthAtStart.healthyQueueNeedNotBeEmpty, true, "Queue health must use age, priority, and retry state rather than demanding an empty queue.");
assert.equal(sensorCalls, 0);
assert.equal(mappingCalls, 1);
assert.equal(eventCalls, 1);
assert.equal(deliveryRecoveryCalls, 1);

eventMode = "evidence_deferred";
const deferredEvidence = await loaded.exports.runPr262AnalysisOnlyCycle({ maxCycleMs: 90_000 });
assert.equal(deferredEvidence.ok, true, "A durably scheduled evidence retry is healthy queue progress, not a crashed cron job.");
assert.equal(deferredEvidence.processing.eventFailures, 0);
assert.equal(deferredEvidence.processing.eventDeferrals, 1);
assert.equal(deferredEvidence.processing.eventResults[0].status, "event_job_deferred");

eventMode = "rolling_quota_deferred";
const deferredRollingQuota = await loaded.exports.runPr262AnalysisOnlyCycle({ maxCycleMs: 90_000 });
assert.equal(deferredRollingQuota.ok, true, "A durable rolling provider-quota retry is healthy queue progress, not a crashed cron job.");
assert.equal(deferredRollingQuota.processing.eventFailures, 0);
assert.equal(deferredRollingQuota.processing.eventDeferrals, 1);
assert.equal(deferredRollingQuota.processing.eventResults[0].status, "event_job_deferred");

eventMode = "targeted_quota_deferred";
const deferredTargetedQuota = await loaded.exports.runPr262AnalysisOnlyCycle({ maxCycleMs: 90_000 });
assert.equal(deferredTargetedQuota.ok, true, "A targeted provider quota guard is a scheduled retry, not a failed cycle.");
assert.equal(deferredTargetedQuota.processing.eventFailures, 0);
assert.equal(deferredTargetedQuota.processing.eventDeferrals, 1);
assert.equal(deferredTargetedQuota.processing.eventResults[0].status, "event_job_deferred");

eventMode = "network_timeout_deferred";
const deferredNetworkTimeout = await loaded.exports.runPr262AnalysisOnlyCycle({ maxCycleMs: 90_000 });
assert.equal(deferredNetworkTimeout.ok, true, "A network timeout already placed back on the durable queue must not fail the whole cycle.");
assert.equal(deferredNetworkTimeout.processing.eventFailures, 0);
assert.equal(deferredNetworkTimeout.processing.eventDeferrals, 1);
assert.equal(deferredNetworkTimeout.processing.eventResults[0].status, "event_job_deferred");

eventMode = "universe_stale_deferred";
const deferredStaleUniverse = await loaded.exports.runPr262AnalysisOnlyCycle({ maxCycleMs: 90_000 });
assert.equal(deferredStaleUniverse.ok, true, "A stale-universe retry with a durable retry time must wait for foundation data without crashing recovery.");
assert.equal(deferredStaleUniverse.processing.eventFailures, 0);
assert.equal(deferredStaleUniverse.processing.eventDeferrals, 1);
assert.equal(deferredStaleUniverse.processing.eventResults[0].status, "event_job_deferred");

eventMode = "broken";
const brokenEvent = await loaded.exports.runPr262AnalysisOnlyCycle({ maxCycleMs: 90_000 });
assert.equal(brokenEvent.ok, false, "An unexpected event-processing failure must still fail the cron job.");
assert.equal(brokenEvent.processing.eventFailures, 1);
assert.equal(brokenEvent.processing.eventDeferrals, 0);
eventMode = "idle";

mappingHealthy = false;
const degraded = await loaded.exports.runPr262AnalysisOnlyCycle({ maxCycleMs: 90_000 });
assert.equal(degraded.ok, false, "A failed final issuer-mapping pass must not be acknowledged as a successful analysis cycle.");
mappingHealthy = true;

deliveryHealthy = false;
const degradedDelivery = await loaded.exports.runPr262AnalysisOnlyCycle({ maxCycleMs: 90_000 });
assert.equal(degradedDelivery.ok, false, "A failed durable delivery recovery must make the analysis cycle visibly unhealthy.");
assert.equal(degradedDelivery.notifications.healthy, false);
deliveryHealthy = true;

const priorOwner = process.env.SWING_UP_PR262_SENSOR_OWNER;
process.env.SWING_UP_PR262_SENSOR_OWNER = "cloudflare_worker";
allowSensorRun = true;
const sensorCallsBeforeDefault = sensorCalls;
const guardedDefault = await loaded.exports.runPr262CronCycle({ maxCycleMs: 90_000 });
if (priorOwner === undefined) delete process.env.SWING_UP_PR262_SENSOR_OWNER;
else process.env.SWING_UP_PR262_SENSOR_OWNER = priorOwner;
assert.equal(guardedDefault.mode, "pr262_five_minute_cron_v3");
assert.equal(sensorCalls, sensorCallsBeforeDefault + 1, "A stale Cloudflare owner variable must not disable the approved Railway sensor.");

eventMode = "processed";
const batchCallsBefore = queueBatchCalls;
const batchedQueueProgress = await loaded.exports.runPr262AnalysisOnlyCycle({ maxCycleMs: 90_000 });
assert.equal(batchedQueueProgress.ok, true);
assert.equal(queueBatchCalls, batchCallsBefore + 1, "One cycle must flush its event outcomes through one queue batch.");
assert.equal(batchedQueueProgress.processing.queuePersistence.writes, 1);
assert.equal(state.pending.length, 0);

console.log(JSON.stringify({
  ok: true,
  railwayQueueAnalyzedByRailway: true,
  localSourceSensingSkipped: true,
  finalIssuerMappingStillRuns: true,
  durableDeliveryRecoveryRunsOnIdleCycle: true,
  staleCloudflareOwnerCannotDisableRailway: true,
  degradedAnalysisCannotReportSuccess: true,
  degradedDeliveryCannotReportSuccess: true,
  scheduledEvidenceDeferralRemainsHealthy: true,
  scheduledEvidenceDeferralWithEventMetadataRemainsHealthy: true,
  scheduledRollingQuotaDeferralRemainsHealthy: true,
  scheduledTargetedQuotaDeferralRemainsHealthy: true,
  scheduledNetworkTimeoutDeferralRemainsHealthy: true,
  scheduledStaleUniverseDeferralRemainsHealthy: true,
  unexpectedEventFailureRemainsUnhealthy: true,
  queueOutcomesPersistOncePerCycle: true,
}, null, 2));
