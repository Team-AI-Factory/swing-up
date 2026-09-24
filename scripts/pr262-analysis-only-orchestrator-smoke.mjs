import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";

const source = readFileSync(new URL("../lib/opportunity-engine/pr262-cron-orchestrator.ts", import.meta.url), "utf8");
assert.match(source, /result\.openAiCalled === false && aiReservationFingerprint/, "Only explicit proof that OpenAI was not called may release a paid reservation.");
assert.match(source, /result\.nonterminalAuditKey/, "Paid nonterminal Committee work must reconcile cost from its immutable audit.");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

let sensorCalls = 0;
let mappingCalls = 0;
let eventCalls = 0;
let directDeliveryCalls = 0;
let deliveryRecoveryCalls = 0;
let queueBatchCalls = 0;
let promotionCalls = 0;
let profileMaintenanceCalls = 0;
const processingOrder = [];
let advanceCycleClock = () => {};
const recordedCostKeys = [];
const releasedFingerprints = [];
let mappingHealthy = true;
let readinessUnavailable = false;
let deliveryHealthy = true;
let eventMode = "idle";
let aiBudgetMode = "available";
let allowSensorRun = false;
let accessDiagnosticCalls = 0;
let unknownUsageReviews = 0;
let accessDiagnostic = { status: "completed", readOnly: true, callsPaidModel: false, billingQuotaVerified: false, modelAvailable: { fast: true, deep: true, final: true } };
let expectedProviderBlocker = null;
let paidReservationCalls = 0;
let restrictedKeyCompletion = null;
const accountingRetryAt = "2026-08-28T12:00:00.000Z";
const cycleStartBudgetRetryAt = "2026-08-28T15:00:00.000Z";
const raceTimeBudgetRetryAt = "2026-08-28T16:00:00.000Z";
const state = {
  pending: [{
    id: "railway:queued-1",
    priority: 95,
    ticker: "SAFE",
    source: "company_news",
    sourceProvider: "alpha_news",
    observedAt: new Date().toISOString(),
    mappingStatus: "mapped",
    queueNextAttemptAt: null,
  }, {
    id: "issuer-sec:queued-2",
    priority: 95,
    ticker: "SAFE",
    source: "company_news",
    sourceProvider: "issuer_sec_safe",
    observedAt: new Date().toISOString(),
    mappingStatus: "mapped",
    queueNextAttemptAt: null,
  }],
};
const queueHygiene = {
  inputEventCount: 1,
  retainedEventCount: 1,
  retainedAuthoritativeEventCount: 0,
  retainedDirectIssuerEventCount: 0,
  droppedEventCount: 0,
  duplicateLowValueCompanyNewsDropped: 0,
  staleSecondaryCompanyNewsDropped: 3,
  retryProtectedSecondaryCompanyNewsCount: 2,
  staleLowValueCompanyNewsDropped: 1,
  permanentlyIneligibleDropped: 0,
  capacityDropped: 0,
};
const stubs = {
  "@/lib/opportunity-engine/pr262-review-blockers": loadTsModule("@/lib/opportunity-engine/pr262-review-blockers"),
  "@/lib/opportunity-engine/pr262-queue-readiness": {
    unavailablePr262QueueAdmissionPlan: loadTsModule("@/lib/opportunity-engine/pr262-queue-readiness", {
      "@/lib/opportunity-engine/company-profile-cache": {},
    }).unavailablePr262QueueAdmissionPlan,
    readPr262QueueAdmissionPlan: async () => {
      if (readinessUnavailable) throw new Error("synthetic_readiness_storage_failure");
      return { status: "checked", profileReadyCount: state.pending.length,
        profileBlockedCount: 0, discoveryAllowance: 0, preferredEventIds: undefined, readyProfileEventIds: [], excludedEventIds: [], eventsDeleted: 0 };
    },
  },
  "@/lib/ai-committee/provider": {
    probeOpenAiCommitteeProviderAccess: async () => {
      accessDiagnosticCalls++;
      return structuredClone(accessDiagnostic);
    },
  },
  "@/lib/notifications/serious-signal-delivery": {
    deliverSeriousSignalOutbox: async () => {
      directDeliveryCalls += 1;
      return { ok: true };
    },
    processPendingSeriousSignalDeliveries: async () => {
      deliveryRecoveryCalls += 1;
      return { ok: deliveryHealthy, jobsAttempted: 0, ...(deliveryHealthy ? {} : { error: "delivery_queue_unhealthy" }) };
    },
  },
  "@/lib/opportunity-engine/pr262-ai-daily-cost": {
    getPr262AiDailyBudgetStatus: async () => aiBudgetMode === "cycle_start_full"
      ? { allowed: false, spentUsd: 9.5, reservedUsd: 0.5, exposureUsd: 10, remainingUsd: 0, limitUsd: 10, warningUsd: 6, warning: true, hardFuseTripped: true, nextReviewReservationUsd: 0.75, nextBudgetAdmissionAt: cycleStartBudgetRetryAt, reservationCheckedBeforePaidCommittee: true, activeReservations: 1, reviewsRecorded: 13, unknownUsageReviews }
      : { allowed: true, spentUsd: 0, reservedUsd: 0, exposureUsd: 0, remainingUsd: 10, limitUsd: 10, warningUsd: 6, warning: false, hardFuseTripped: false, nextReviewReservationUsd: 0.75, nextBudgetAdmissionAt: null, reservationCheckedBeforePaidCommittee: true, activeReservations: 0, reviewsRecorded: 0, unknownUsageReviews },
    reservePr262AiCommitteeBudget: async (reservation) => { paidReservationCalls++; return aiBudgetMode === "race_time_full"
      ? { allowed: false, reason: "daily_cost_fuse", nextRetryAt: raceTimeBudgetRetryAt, nextBudgetAdmissionAt: raceTimeBudgetRetryAt }
      : {
          allowed: true,
          reason: "reserved",
          nextRetryAt: null,
          reservation: { ...reservation, expiresAt: accountingRetryAt },
        }; },
    releasePr262AiCommitteeBudgetReservation: async (fingerprint) => {
      releasedFingerprints.push(fingerprint);
      return { released: true };
    },
    recordPr262AiCommitteeCostFromResultKey: async (key) => {
      recordedCostKeys.push(key);
      return { recorded: true, nextRetryAt: accountingRetryAt };
    },
  },
  "@/lib/opportunity-engine/pr262-company-directory": {
    enrichPr262SensorCompanyMappings: async () => {
      mappingCalls += 1;
      if (mappingHealthy === "stale") {
        return { mapped: 0, directoryCompanies: 0, directoryUpdatedAt: null, error: "pr262_authoritative_equity_universe_stale; next_retry_at=2026-08-28T07:30:40.815Z" };
      }
      return mappingHealthy
        ? { mapped: 1, directoryCompanies: 1, directoryUpdatedAt: new Date().toISOString() }
        : { mapped: 0, directoryCompanies: 0, directoryUpdatedAt: null, error: "directory_unavailable" };
    },
  },
  "@/lib/opportunity-engine/pr262-change-sensor": {
    PR262_SECONDARY_COMPANY_NEWS_MAX_TTL_MS: 48 * 60 * 60_000,
    PR262_SECONDARY_COMPANY_NEWS_RETRY_GRACE_MS: 15 * 60_000,
    PR262_SECONDARY_COMPANY_NEWS_TTL_MS: 6 * 60 * 60_000,
    isPr262SecondaryCompanyNewsEvent: (event) => event.source === "company_news" && !/^(?:issuer_ir_|issuer_sec_)/.test(event.sourceProvider ?? ""),
    isPr262SecondaryCompanyNewsExpired: (event, nowMs) => {
      const observedAt = Date.parse(event.observedAt);
      const retryAt = event.queueAttempts > 0 ? Date.parse(event.queueNextAttemptAt ?? "") : Number.NaN;
      const expiryAt = Math.min(
        observedAt + 48 * 60 * 60_000,
        Number.isFinite(retryAt) ? Math.max(observedAt + 6 * 60 * 60_000, retryAt + 15 * 60_000) : observedAt + 6 * 60 * 60_000,
      );
      return !Number.isFinite(observedAt) || nowMs > expiryAt;
    },
    readPr262ChangeSensorState: async () => structuredClone(state),
    applyPr262PendingSensorEventMutations: async (mutations) => {
      queueBatchCalls += 1;
      const normalized = new Map(mutations.map((item) => [item.eventId, item]));
      const acknowledged = new Set([...normalized.values()].filter((item) => item.action === "acknowledge").map((item) => item.eventId));
      let retried = 0;
      state.pending = state.pending.filter((event) => !acknowledged.has(event.id));
      state.pending = state.pending.map((event) => {
        const mutation = normalized.get(event.id);
        if (!mutation || mutation.action !== "retry") return event;
        retried += 1;
        return {
          ...event,
          queueAttempts: (event.queueAttempts ?? 0) + 1,
          queueNextAttemptAt: mutation.nextRetryAt,
          queueLastError: mutation.error,
        };
      });
      return { written: true, writes: 1, acknowledged: acknowledged.size, retried, pendingCount: state.pending.length };
    },
  },
  "@/lib/opportunity-engine/pr262-event-job": {
    warmPr262CompanyProfiles: async (now, fetchImpl) => {
      assert.ok(now instanceof Date);
      assert.equal(typeof fetchImpl, "function", "Profile maintenance needs the deadline-bound provider fetch");
      profileMaintenanceCalls++;
      processingOrder.push("profiles");
      return { attempted: eventMode === "consume_processing_window" ? 1 : 0, verified: 0, status: "checked" };
    },
    runPr262EventJob: async (input) => {
      eventCalls += 1;
      processingOrder.push("event");
      assert.ok(input.signal instanceof AbortSignal);
      assert.ok(input.deadlineAtMs > Date.now());
      assert.equal(typeof input.beforeOpenAiCall, "function", "Railway must pass the durable dollar reservation hook before paid analysis.");
      assert.equal(typeof input.aiReservationRetryAt, "function", "The event job must be able to inherit the exact daily-cost retry boundary.");
      if (eventMode === "consume_processing_window") {
        eventMode = "idle";
        advanceCycleClock(170_000);
        return { ok: true, status: "completed", eventsProcessed: 1, openAiCalled: false };
      }
      if (eventMode === "restricted_models_scope") {
        eventMode = "idle";
        assert.equal(input.allowOpenAi, true, "Models Read denial cannot disable an otherwise eligible completion");
        assert.equal(input.aiProviderBlockedReason, undefined);
        assert.equal(await input.beforeOpenAiCall({ candidateFingerprint: "restricted-key-review", ticker: "SAFE", direction: "upside" }), true);
        const completion = await restrictedKeyCompletion();
        assert.equal(completion.ok, true);
        assert.equal(completion.status, "completed");
        return { ok: true, status: "completed", openAiCalled: true, eventsProcessed: 1, seriousSignalFound: false, resultKey: "test/restricted-key-review.json" };
      }
      if (eventMode === "provider_access_blocked") {
        eventMode = "idle";
        assert.equal(input.allowOpenAi, false, "Definitively unavailable access must block paid reviews before reservation");
        assert.equal(input.aiProviderBlockedReason, expectedProviderBlocker);
        assert.equal(input.aiReservationBlockedReason(), "provider_access");
        assert.equal(await input.beforeOpenAiCall({ candidateFingerprint: "provider-blocked", ticker: "SAFE", direction: "upside" }), false);
        return { ok: true, status: "event_job_deferred", nonterminal: true, openAiCalled: false, eventsProcessed: 0, analysisDiagnostics: { status: "committee_provider_access_blocked" } };
      }
      if (eventMode === "evidence_deferred") {
        eventMode = "idle";
        throw new Error("pr262_event_full_source_incomplete:provider_budget_not_due; event_id=sec:0001213900-26-094677; ticker=MBAI; cik=0001610590; next_retry_at=2026-08-27T07:53:02.028Z");
      }
      if (eventMode === "long_evidence_deferred") {
        eventMode = "idle";
        throw new Error(`pr262_event_full_source_incomplete:${"transport_detail_".repeat(30)}; event_id=long-event; ticker=LONG; cik=unknown; next_retry_at=2026-08-27T08:53:02.028Z`);
      }
      if (eventMode === "rolling_quota_deferred") {
        eventMode = "idle";
        throw new Error("pr262_full_source_rolling_quota_guard; next_retry_at=2026-08-28T02:22:47.870Z");
      }
      if (eventMode === "targeted_quota_deferred") {
        eventMode = "idle";
        throw new Error("tradingview_targeted_value_rolling_quota_guard; next_retry_at=2026-08-28T02:23:01.827Z");
      }
      if (eventMode === "sensor_budget_deferred") {
        eventMode = "idle";
        throw new Error("pr262_sensor_budget_guard:tradingview:minimum_interval;next_retry_at=2026-09-03T09:50:25.860Z; event_id=v3:2f8a5d8d5fc2a230cfccb110; ticker=PEP; cik=unknown; next_retry_at=2026-09-03T09:56:19.011Z");
      }
      if (eventMode === "network_timeout_deferred") {
        eventMode = "idle";
        throw new Error("The operation was aborted due to timeout; next_retry_at=2026-08-27T10:42:26.025Z");
      }
      if (eventMode === "universe_stale_deferred") {
        eventMode = "idle";
        throw new Error("pr262_authoritative_equity_universe_stale; next_retry_at=2026-08-28T07:30:40.815Z");
      }
      if (eventMode === "trade_halt_state_deferred") {
        eventMode = "idle";
        throw new Error("pr262_trade_halt_state_unavailable:provider_budget_not_due; next_retry_at=2026-08-28T07:31:40.815Z");
      }
      if (eventMode === "broken") {
        eventMode = "idle";
        throw new Error("unexpected_event_processing_failure");
      }
      if (eventMode === "cycle_start_budget_full") {
        eventMode = "idle";
        assert.equal(input.allowOpenAi, false, "A full cycle-start fuse must disable paid analysis.");
        assert.equal(input.aiReservationRetryAt(), cycleStartBudgetRetryAt);
        assert.equal(input.aiReservationBlockedReason(), "daily_cost_fuse");
        input.queueMutationSink({
          action: "retry",
          eventId: state.pending[0].id,
          error: "pr262_event_report_retry:qualified_signal_openai_not_requested",
          nextRetryAt: input.aiReservationRetryAt(),
        });
        return {
          ok: true,
          status: "event_job_deferred",
          nonterminal: true,
          eventsProcessed: 0,
          eventId: state.pending[0].id,
          openAiCalled: false,
          resultKey: null,
          seriousSignalFound: false,
        };
      }
      if (eventMode === "race_time_budget_full") {
        eventMode = "idle";
        assert.equal(input.allowOpenAi, true, "The cycle must begin open before a concurrent reservation fills the fuse.");
        const admitted = await input.beforeOpenAiCall({ candidateFingerprint: "race-time-full", ticker: "SAFE", direction: "upside" });
        assert.equal(admitted, false);
        assert.equal(input.aiReservationRetryAt(), raceTimeBudgetRetryAt);
        assert.equal(input.aiReservationBlockedReason(), "daily_cost_fuse");
        input.queueMutationSink({
          action: "retry",
          eventId: state.pending[0].id,
          error: "pr262_event_report_retry:qualified_signal_openai_reservation_denied",
          nextRetryAt: input.aiReservationRetryAt(),
        });
        return {
          ok: true,
          status: "event_job_deferred",
          nonterminal: true,
          eventsProcessed: 0,
          eventId: state.pending[0].id,
          openAiCalled: false,
          resultKey: null,
          seriousSignalFound: false,
        };
      }
      if (eventMode === "paid_nonterminal") {
        eventMode = "idle";
        const admitted = await input.beforeOpenAiCall({ candidateFingerprint: "paid-incomplete", ticker: "SAFE", direction: "upside" });
        assert.equal(admitted, true);
        input.queueMutationSink({
          action: "retry",
          eventId: state.pending[0].id,
          error: "pr262_event_report_retry:candidate_needs_more_data",
          nextRetryAt: "2026-08-27T13:00:00.000Z",
        });
        return {
          ok: true,
          status: "event_job_deferred",
          nonterminal: true,
          eventsProcessed: 0,
          eventId: state.pending[0].id,
          openAiCalled: true,
          candidateFingerprint: "paid-incomplete",
          resultKey: null,
          nonterminalAuditKey: "production/pr262/event-job/nonterminal-audits/paid-incomplete.json",
          outboxKey: "production/pr262/serious-signal/outbox/must-not-deliver.json",
          error: "pr262_event_report_retry:candidate_needs_more_data",
          seriousSignalFound: true,
          alertType: "buy",
        };
      }
      if (eventMode === "proven_no_call") {
        eventMode = "idle";
        const admitted = await input.beforeOpenAiCall({ candidateFingerprint: "reserved-no-call", ticker: "SAFE", direction: "upside" });
        assert.equal(admitted, true);
        input.queueMutationSink({
          action: "retry",
          eventId: state.pending[0].id,
          error: "pr262_event_report_retry:qualified_signal_openai_reservation_denied",
          nextRetryAt: "2026-08-27T13:00:00.000Z",
        });
        return {
          ok: true,
          status: "event_job_deferred",
          nonterminal: true,
          eventsProcessed: 0,
          eventId: state.pending[0].id,
          openAiCalled: false,
          candidateFingerprint: "reserved-no-call",
          resultKey: null,
          nonterminalAuditKey: null,
          seriousSignalFound: false,
        };
      }
      if (eventMode === "ambiguous_call_state") {
        eventMode = "idle";
        const admitted = await input.beforeOpenAiCall({ candidateFingerprint: "ambiguous-call", ticker: "SAFE", direction: "upside" });
        assert.equal(admitted, true);
        return { ok: false, status: "event_job_error", eventsProcessed: 0, resultKey: null };
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
      return { ok: true, newEvents: 0, sectorFanoutEvents: 0, exposureCompanies: 1, sourceSummary: [], costPolicy: {}, queueHygiene, r2Persistence: { queueWritten: false } };
    },
  },
  "@/lib/opportunity-engine/pr262-sensor-fetch-budget": {
    createPr262SensorBudgetedFetch: async () => ({ fetchImpl: async () => { throw new Error("unexpected_fetch"); }, flush: async () => ({ persisted: true }), summary: () => ({ calls: 0 }) }),
  },
  "@/lib/opportunity-engine/pr262-serious-watch-out-authority": {
    promotePr262SeriousWatchOut: async () => {
      promotionCalls += 1;
      return { promoted: false, outboxKey: null };
    },
  },
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
assert.equal(result.processing.queueHealthAtStart.secondaryCompanyNewsCount, 1);
assert.equal(result.processing.queueHealthAtStart.staleSecondaryCompanyNewsCount, 0);
assert.equal(result.processing.queueHealthAtStart.retryProtectedSecondaryCompanyNewsCount, 0);
assert.equal(result.processing.queueHealthAtStart.secondaryCompanyNewsBaseAgeMinutes, 360);
assert.equal(result.processing.queueHealthAtStart.secondaryCompanyNewsMaximumAgeMinutes, 2_880);
assert.equal(result.processing.queueHealthAtStart.secondaryCompanyNewsRetryGraceMinutes, 15);
assert.equal(result.processing.queueHealthAtStart.dueAuthoritativeCount, 1, "Legacy issuer_sec evidence must count as authoritative queue work.");
assert.equal(result.processing.funnel.directIssuerAtStart, 1, "issuer_sec and issuer_ir must use the same direct-issuer telemetry lane.");
assert.equal(result.processing.funnel.readyDirectIssuerAtStart, 1);
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

eventMode = "sensor_budget_deferred";
const deferredSensorBudget = await loaded.exports.runPr262AnalysisOnlyCycle({ maxCycleMs: 90_000 });
assert.equal(deferredSensorBudget.ok, true, "A durable sensor-provider budget wait must not crash the cron service.");
assert.equal(deferredSensorBudget.processing.eventFailures, 0);
assert.equal(deferredSensorBudget.processing.eventDeferrals, 1);
assert.equal(deferredSensorBudget.processing.eventResults[0].status, "event_job_deferred");

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

eventMode = "long_evidence_deferred";
const deferredLongEvidence = await loaded.exports.runPr262AnalysisOnlyCycle({ maxCycleMs: 90_000 });
assert.equal(deferredLongEvidence.ok, true, "A long transport detail must be classified before its display text is truncated.");
assert.equal(deferredLongEvidence.processing.eventFailures, 0);
assert.match(deferredLongEvidence.processing.eventResults[0].error, /; next_retry_at=2026-08-27T08:53:02\.028Z$/);

eventMode = "trade_halt_state_deferred";
const deferredTradeHaltState = await loaded.exports.runPr262AnalysisOnlyCycle({ maxCycleMs: 90_000 });
assert.equal(deferredTradeHaltState.ok, true, "A trade-halt status waiting on its scheduled provider retry must not crash recovery.");
assert.equal(deferredTradeHaltState.processing.eventFailures, 0);
assert.equal(deferredTradeHaltState.processing.eventDeferrals, 1);
assert.equal(deferredTradeHaltState.processing.eventResults[0].status, "event_job_deferred");

eventMode = "broken";
const brokenEvent = await loaded.exports.runPr262AnalysisOnlyCycle({ maxCycleMs: 90_000 });
assert.equal(brokenEvent.ok, false, "An unexpected event-processing failure must still fail the cron job.");
assert.equal(brokenEvent.processing.eventFailures, 1);
assert.equal(brokenEvent.processing.eventDeferrals, 0);
eventMode = "idle";

mappingHealthy = false;
const degraded = await loaded.exports.runPr262AnalysisOnlyCycle({ maxCycleMs: 90_000 });
assert.equal(degraded.ok, false, "A failed final issuer-mapping pass must not be acknowledged as a successful analysis cycle.");
mappingHealthy = "stale";
const staleMapping = await loaded.exports.runPr262AnalysisOnlyCycle({ maxCycleMs: 90_000 });
assert.equal(staleMapping.ok, true, "A mapping pass waiting on its durable stale-universe retry must be a healthy scheduled deferral.");
assert.equal(staleMapping.mapping.scheduledDeferral, true);
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
assert.deepEqual(guardedDefault.sensor.queueHygiene, queueHygiene, "The top-level cycle receipt must expose the sensor's queue-trimming evidence.");
assert.equal(guardedDefault.sensor.queueHygiene.staleSecondaryCompanyNewsDropped, 3, "The cycle receipt must retain a nonzero trim count after the post-trim queue is clean.");

state.pending[0].queueNextAttemptAt = null;
aiBudgetMode = "cycle_start_full";
unknownUsageReviews = 13;
eventMode = "cycle_start_budget_full";
const cycleStartFull = await loaded.exports.runPr262AnalysisOnlyCycle({ maxCycleMs: 90_000 });
assert.equal(accessDiagnosticCalls, 1, "Blocked paid capacity with unknown usage gets one read-only provider check");
assert.equal(cycleStartFull.aiCostControl.providerAccessDiagnostic.callsPaidModel, false);
assert.equal(cycleStartFull.aiCostControl.providerAccessDiagnostic.billingQuotaVerified, false);
unknownUsageReviews = 0;
assert.equal(cycleStartFull.ok, true);
assert.equal(cycleStartFull.processing.eventDeferrals, 1);
assert.equal(state.pending[0].queueNextAttemptAt, cycleStartBudgetRetryAt, "A cycle-start full fuse must carry its exact global capacity boundary into the queue.");

state.pending[0].queueNextAttemptAt = null;
aiBudgetMode = "race_time_full";
eventMode = "race_time_budget_full";
const raceTimeFull = await loaded.exports.runPr262AnalysisOnlyCycle({ maxCycleMs: 90_000 });
assert.equal(raceTimeFull.ok, true);
assert.equal(raceTimeFull.processing.eventDeferrals, 1);
assert.equal(state.pending[0].queueNextAttemptAt, raceTimeBudgetRetryAt, "A concurrent full-fuse denial must carry its exact capacity boundary into the queue.");
aiBudgetMode = "available";

const successfulDiagnostic = structuredClone(accessDiagnostic);
for (const reason of ["authentication", "configured_model_unavailable"]) {
  expectedProviderBlocker = reason;
  accessDiagnostic = reason === "configured_model_unavailable"
    ? { ...successfulDiagnostic, modelAvailable: { fast: true, deep: true, final: false } }
    : { status: "failed", readOnly: true, callsPaidModel: false, billingQuotaVerified: false, failure: { category: reason } };
  unknownUsageReviews = 13;
  eventMode = "provider_access_blocked";
  const priorReservations = paidReservationCalls;
  const priorEvidenceCalls = eventCalls;
  const unavailableAccess = await loaded.exports.runPr262AnalysisOnlyCycle({ maxCycleMs: 90_000 });
  assert.equal(unavailableAccess.aiCostControl.allowed, true, "Provider access must be reported separately from remaining dollar capacity");
  assert.equal(unavailableAccess.aiCostControl.providerBlockedReason, reason);
  assert.equal(unavailableAccess.processing.aiCalls, 0);
  assert.equal(paidReservationCalls, priorReservations, "No reservation may be consumed when access is already known to fail");
  assert.ok(eventCalls > priorEvidenceCalls, "Unpaid evidence collection must continue while provider access is blocked");
}
// Exercise the real provider across both endpoints: one restricted key denies
// GET /models yet successfully returns a budget-reserved chat completion.
const provider = loadTsModule("@/lib/ai-committee/provider");
const providerEnvKeys = ["OPENAI_API_KEY", "OPENAI_MODEL", "AI_COMMITTEE_ENABLED", "AI_COMMITTEE_DRY_RUN_DEFAULT", "AI_COMMITTEE_FAST_MODEL", "AI_COMMITTEE_DEEP_MODEL", "AI_COMMITTEE_FINAL_MODEL", "AI_COMMITTEE_MODEL_ALLOWLIST"];
const savedProviderEnv = Object.fromEntries(providerEnvKeys.map(key => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
let restrictedCompletionRequests = 0;
try {
  for (const key of providerEnvKeys) delete process.env[key];
  process.env.OPENAI_API_KEY = "restricted-key-fixture";
  process.env.OPENAI_MODEL = "gpt-4.1-mini";
  process.env.AI_COMMITTEE_ENABLED = "true";
  globalThis.fetch = async (url, options) => {
    if (url === "https://api.openai.com/v1/models") {
      assert.equal(options.method, "GET");
      return Response.json({ error: { code: "permission_denied" } }, { status: 403 });
    }
    assert.equal(url, "https://api.openai.com/v1/chat/completions");
    assert.equal(options.method, "POST");
    restrictedCompletionRequests++;
    return Response.json({ choices: [{ message: { content: '{"verdict":"needs_more_data"}' }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 } });
  };
  accessDiagnostic = await provider.probeOpenAiCommitteeProviderAccess();
  assert.equal(accessDiagnostic.failure.httpStatus, 403);
  assert.equal(accessDiagnostic.failure.category, "permission");
  restrictedKeyCompletion = () => provider.runOpenAiCommitteeProvider({ tier: "fast", confirmRun: true, dryRun: false, maxTokens: 50, messages: [{ role: "user", content: "Return a JSON verdict from the supplied evidence." }] });
  unknownUsageReviews = 13;
  eventMode = "restricted_models_scope";
  const reservationsBeforeRestricted = paidReservationCalls;
  const restricted = await loaded.exports.runPr262AnalysisOnlyCycle({ maxCycleMs: 90_000 });
  assert.equal(restricted.ok, true);
  assert.equal(restricted.aiCostControl.providerBlockedReason, null);
  assert.equal(restricted.aiCostControl.providerAccessDiagnostic.failure.httpStatus, 403, "The denied listing remains visible in diagnostics");
  assert.equal(paidReservationCalls, reservationsBeforeRestricted + 1, "The unchanged budget gate must admit the review before completion");
  assert.equal(restrictedCompletionRequests, 1);
  assert.equal(restricted.processing.aiCalls, 1);
} finally {
  globalThis.fetch = originalFetch;
  for (const key of providerEnvKeys) {
    if (savedProviderEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedProviderEnv[key];
  }
}
unknownUsageReviews = 0;
accessDiagnostic = successfulDiagnostic;
expectedProviderBlocker = null;

eventMode = "paid_nonterminal";
const recordedBeforePaidRetry = recordedCostKeys.length;
const releasedBeforePaidRetry = releasedFingerprints.length;
const promotionsBeforePaidRetry = promotionCalls;
const deliveriesBeforePaidRetry = directDeliveryCalls;
const paidRetry = await loaded.exports.runPr262AnalysisOnlyCycle({ maxCycleMs: 90_000 });
assert.equal(paidRetry.ok, true, "A durably audited incomplete Committee result must be a healthy scheduled deferral.");
assert.equal(paidRetry.processing.eventFailures, 0);
assert.equal(paidRetry.processing.eventDeferrals, 1);
assert.equal(paidRetry.processing.aiCalls, 1, "A real incomplete Committee attempt must remain visible in accounting metrics.");
assert.equal(recordedCostKeys.length, recordedBeforePaidRetry + 1);
assert.equal(recordedCostKeys.at(-1), "production/pr262/event-job/nonterminal-audits/paid-incomplete.json", "Cost must reconcile from the immutable nonterminal audit, not a missing terminal result.");
assert.equal(releasedFingerprints.length, releasedBeforePaidRetry, "A reservation must never be released after a reported OpenAI call.");
assert.equal(promotionCalls, promotionsBeforePaidRetry, "A nonterminal Committee audit must never enter Watch Out promotion.");
assert.equal(directDeliveryCalls, deliveriesBeforePaidRetry, "A nonterminal result must never deliver an outbox key even if a malformed dependency supplies one.");
assert.equal(paidRetry.processing.seriousBuys, 0, "A nonterminal result must never increment Serious Signal counters.");
assert.equal(paidRetry.processing.queuePersistence.retried, 1);
assert.equal(state.pending[0].queueNextAttemptAt, accountingRetryAt, "The exact recorded-cost expiry must replace the preliminary retry bound in the single queue write.");

state.pending[0].queueNextAttemptAt = null;
eventMode = "proven_no_call";
const recordedBeforeNoCall = recordedCostKeys.length;
const releasedBeforeNoCall = releasedFingerprints.length;
const provenNoCall = await loaded.exports.runPr262AnalysisOnlyCycle({ maxCycleMs: 90_000 });
assert.equal(provenNoCall.ok, true);
assert.equal(provenNoCall.processing.eventDeferrals, 1);
assert.equal(provenNoCall.processing.aiCalls, 0);
assert.equal(recordedCostKeys.length, recordedBeforeNoCall, "A proven no-call deferral must not be charged.");
assert.equal(releasedFingerprints.length, releasedBeforeNoCall + 1, "Only an explicit openAiCalled=false result may release its outer reservation.");
assert.equal(releasedFingerprints.at(-1), "reserved-no-call");

state.pending[0].queueNextAttemptAt = null;
eventMode = "ambiguous_call_state";
const releasedBeforeAmbiguous = releasedFingerprints.length;
const ambiguousCallState = await loaded.exports.runPr262AnalysisOnlyCycle({ maxCycleMs: 90_000 });
assert.equal(ambiguousCallState.ok, false);
assert.equal(ambiguousCallState.processing.eventFailures, 1);
assert.equal(releasedFingerprints.length, releasedBeforeAmbiguous, "Missing call evidence must preserve the reservation conservatively.");

eventMode = "processed";
const batchCallsBefore = queueBatchCalls;
const batchedQueueProgress = await loaded.exports.runPr262AnalysisOnlyCycle({ maxCycleMs: 90_000 });
assert.equal(batchedQueueProgress.ok, true);
assert.equal(queueBatchCalls, batchCallsBefore + 1, "One cycle must flush its event outcomes through one queue batch.");
assert.equal(batchedQueueProgress.processing.queuePersistence.writes, 1);
assert.equal(state.pending.length, 1);
assert.equal(state.pending[0].id, "issuer-sec:queued-2");

const realDateNow = Date.now;
const pendingBeforeBacklog = state.pending;
const maintenanceBeforeBacklog = profileMaintenanceCalls;
const paidReservationsBeforeBacklog = paidReservationCalls;
let simulatedNow = realDateNow();
processingOrder.length = 0;
state.pending = Array.from({ length: 380 }, (_, index) => ({
  ...pendingBeforeBacklog[0], id: `backlog:${index}`, queueNextAttemptAt: null,
}));
eventMode = "consume_processing_window";
advanceCycleClock = milliseconds => { simulatedNow += milliseconds; };
Date.now = () => simulatedNow;
try {
  const backloggedCycle = await loaded.exports.runPr262AnalysisOnlyCycle({ maxCycleMs: 210_000 });
  assert.equal(backloggedCycle.processing.queueHealthAtStart.dueReadyCount, 380);
  assert.equal(profileMaintenanceCalls, maintenanceBeforeBacklog + 1, "A full due queue must still give the existing bounded profile pass one turn");
  assert.deepEqual(processingOrder, ["profiles", "event"], "Profile maintenance must run before backlog analysis consumes the processing window");
  assert.equal(backloggedCycle.companyProfiles.status, "checked");
  assert.equal(backloggedCycle.companyProfiles.attempted, 1);
  assert.equal(backloggedCycle.processing.deadlineStoppedAdmissions, true, "Maintenance does not extend the existing event-processing deadline");
  assert.equal(paidReservationCalls, paidReservationsBeforeBacklog, "Profile maintenance cannot reserve paid Committee work");
} finally {
  Date.now = realDateNow;
  state.pending = pendingBeforeBacklog;
  advanceCycleClock = () => {};
  eventMode = "idle";
}

readinessUnavailable = true;
const eventsBeforeReadFailure = eventCalls;
const reservationsBeforeReadFailure = paidReservationCalls;
const queueBeforeReadFailure = JSON.stringify(state.pending);
const unavailableCycle = await loaded.exports.runPr262AnalysisOnlyCycle({ maxCycleMs: 90_000 });
assert.equal(unavailableCycle.ok, false, "Readiness storage failures must be visible to monitoring");
assert.equal(unavailableCycle.processing.readiness.status, "temporarily_unavailable");
assert.equal(eventCalls, eventsBeforeReadFailure, "Failed readiness must not trigger event jobs or provider calls");
assert.equal(paidReservationCalls, reservationsBeforeReadFailure);
assert.equal(JSON.stringify(state.pending), queueBeforeReadFailure, "The blocked cycle preserves all work");
readinessUnavailable = false;

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
  incompleteCommitteeCostReconciledFromImmutableAudit: true,
  nonterminalCommitteeCannotPromoteOrPublish: true,
  cycleStartGlobalFuseUsesExactRetry: true,
  raceTimeGlobalFuseUsesExactRetry: true,
  exactAccountingExpiryReplacesPreliminaryRetry: true,
  reservationReleasedOnlyForExplicitNoCall: true,
  ambiguousCallStatePreservesReservation: true,
  queueOutcomesPersistOncePerCycle: true,
}, null, 2));
