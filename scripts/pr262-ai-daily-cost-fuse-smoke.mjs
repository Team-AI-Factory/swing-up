import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/opportunity-engine/pr262-ai-daily-cost.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

let state = null;
let etagCounter = 0;
let forcedConflicts = 0;
const loaded = { exports: {} };
new Function("require", "module", "exports", output)((specifier) => {
  if (specifier === "@/lib/opportunity-engine/pr262-storage") {
    return { pr262StorageKey: (relative) => `production/pr262/${relative}` };
  }
  if (specifier === "@/lib/r2-warehouse") {
    return {
      readVersionedTextFromR2: async () => state
        ? { found: true, text: JSON.stringify(state.payload), etag: state.etag }
        : { found: false, text: null, etag: null },
      writeVersionedJsonToR2: async (_key, payload, options = {}) => {
        if (forcedConflicts > 0) {
          forcedConflicts -= 1;
          return { written: false, conflict: true, etag: null };
        }
        if (options.createOnly && state) return { written: false, conflict: true, etag: null };
        if (options.expectedEtag && options.expectedEtag !== state?.etag) return { written: false, conflict: true, etag: null };
        const etag = `"etag-${++etagCounter}"`;
        state = { payload: structuredClone(payload), etag };
        return { written: true, conflict: false, etag };
      },
    };
  }
  throw new Error(`Unexpected AI fuse import: ${specifier}`);
}, loaded, loaded.exports);

const {
  getPr262AiDailyBudgetStatus,
  getPr262AiCostAudit,
  recordPr262AiCommitteeCost,
  releasePr262AiCommitteeBudgetReservation,
  reservePr262AiCommitteeBudget,
} = loaded.exports;
const originalEnvironment = { ...process.env };
try {
  process.env.SWING_UP_PR262_AI_DAILY_LIMIT_USD = "10";
  process.env.SWING_UP_PR262_AI_DAILY_WARNING_USD = "6";
  process.env.SWING_UP_PR262_AI_REVIEW_RESERVATION_USD = "0.75";
  const now = new Date("2026-08-20T10:00:00.000Z");
  state = {
    etag: `"etag-${++etagCounter}"`,
    payload: {
      version: 1,
      updatedAt: now.toISOString(),
      entries: [{ id: "prior", recordedAt: now.toISOString(), ticker: "SAFE", alertType: "buy", costUsd: 9.3, source: "actual_tokens" }],
      reservations: [],
    },
  };
  const blocked = await getPr262AiDailyBudgetStatus(now);
  assert.equal(blocked.allowed, false, "A paid review must be blocked when its reservation could cross $10.");
  assert.equal(blocked.hardFuseTripped, true);
  assert.equal(blocked.nextReviewReservationUsd, 0.75);

  state.payload.entries = [
    { id: "long-lived-spend", recordedAt: now.toISOString(), ticker: "SAFE", alertType: "buy", costUsd: 9.2, source: "actual_tokens" },
    { id: "first-small-release", recordedAt: "2026-08-19T11:00:00.000Z", ticker: "SAFE", alertType: "buy", costUsd: 0.3, source: "actual_tokens" },
  ];
  state.payload.reservations = [{
    id: "second-small-release",
    reservedAt: "2026-08-20T09:00:00.000Z",
    expiresAt: "2026-08-20T12:00:00.000Z",
    ticker: "SAFE",
    direction: "upside",
    amountUsd: 0.3,
  }];
  const cumulativelyBlocked = await getPr262AiDailyBudgetStatus(now);
  assert.equal(cumulativelyBlocked.allowed, false);
  assert.equal(cumulativelyBlocked.nextBudgetAdmissionAt, "2026-08-20T12:00:00.000Z", "Capacity must wait until enough entry and reservation amounts have cumulatively expired.");
  const raceTimeFuseDenial = await reservePr262AiCommitteeBudget({ candidateFingerprint: "race-time-full-fuse", ticker: "SAFE", direction: "upside" }, now);
  assert.equal(raceTimeFuseDenial.allowed, false);
  assert.equal(raceTimeFuseDenial.reason, "daily_cost_fuse");
  assert.equal(raceTimeFuseDenial.nextRetryAt, cumulativelyBlocked.nextBudgetAdmissionAt, "A race-time full fuse must return the exact global capacity boundary.");

  state.payload.entries = [{ id: "prior", recordedAt: now.toISOString(), ticker: "SAFE", alertType: "buy", costUsd: 9.3, source: "actual_tokens" }];
  state.payload.reservations = [];

  process.env.SWING_UP_PR262_AI_DAILY_LIMIT_USD = "1000";
  process.env.SWING_UP_PR262_AI_REVIEW_RESERVATION_USD = "0.01";
  const misconfigured = await getPr262AiDailyBudgetStatus(now);
  assert.equal(misconfigured.limitUsd, 10, "Environment configuration must not raise the hard $10 ceiling.");
  assert.equal(misconfigured.nextReviewReservationUsd, 0.75, "Environment configuration must not lower the safe review reservation.");
  process.env.SWING_UP_PR262_AI_DAILY_LIMIT_USD = "0.5";
  state.payload.entries = [];
  const lowerLimit = await getPr262AiDailyBudgetStatus(now);
  assert.equal(lowerLimit.nextReviewReservationUsd, 0.75, "A lower daily limit must not shrink the per-review cost bound.");
  assert.equal(lowerLimit.allowed, false, "A daily limit below one conservative review must admit no paid review.");
  assert.equal(lowerLimit.nextBudgetAdmissionAt, null, "No retry time may be invented when the configured limit cannot admit even one review.");
  process.env.SWING_UP_PR262_AI_DAILY_LIMIT_USD = "10";
  process.env.SWING_UP_PR262_AI_REVIEW_RESERVATION_USD = "0.75";

  state.payload.entries = [{ id: "prior", recordedAt: now.toISOString(), ticker: "SAFE", alertType: "buy", costUsd: 9.2, source: "actual_tokens" }];
  const allowed = await getPr262AiDailyBudgetStatus(now);
  assert.equal(allowed.allowed, true);

  const [firstConcurrent, secondConcurrent] = await Promise.all([
    reservePr262AiCommitteeBudget({ candidateFingerprint: "concurrent-a", ticker: "SAFE", direction: "upside" }, now),
    reservePr262AiCommitteeBudget({ candidateFingerprint: "concurrent-b", ticker: "SAFE", direction: "upside" }, now),
  ]);
  assert.equal([firstConcurrent, secondConcurrent].filter((item) => item.allowed).length, 1, "Atomic reservations must prevent overlapping cycles from crossing the fuse.");
  assert.equal(state.payload.reservations.length, 1);
  const afterConcurrentReservation = await getPr262AiDailyBudgetStatus(now);
  assert.equal(afterConcurrentReservation.spentUsd, 9.2);
  assert.equal(afterConcurrentReservation.reservedUsd, 0.75);
  assert.equal(afterConcurrentReservation.allowed, false);
  const winningFingerprint = state.payload.reservations[0].id;
  assert.equal((await releasePr262AiCommitteeBudgetReservation(winningFingerprint, now)).released, true);

  state.payload.entries = [];
  state.payload.reservations = [];
  forcedConflicts = 2;
  const report = {
    openAiCalled: true,
    checkedAt: now.toISOString(),
    candidateFingerprint: "candidate-cost-1",
    alertType: "buy",
    selectedCandidate: { ticker: "SAFE" },
    committee: { output: {} },
  };
  const reservation = await reservePr262AiCommitteeBudget({ candidateFingerprint: report.candidateFingerprint, ticker: "SAFE", direction: "upside" }, now);
  assert.equal(reservation.allowed, true);
  assert.equal(state.payload.reservations.length, 1);
  const duplicateActiveReservation = await reservePr262AiCommitteeBudget({ candidateFingerprint: report.candidateFingerprint, ticker: "SAFE", direction: "upside" }, now);
  assert.equal(duplicateActiveReservation.allowed, false);
  assert.equal(duplicateActiveReservation.reason, "candidate_already_reserved");
  assert.equal(duplicateActiveReservation.nextRetryAt, reservation.reservation.expiresAt, "An active fingerprint must retry only after its exact reservation expiry.");
  forcedConflicts = 2;
  const recorded = await recordPr262AiCommitteeCost(report, now);
  assert.equal(recorded.recorded, true, "Cost recording must retry optimistic-write conflicts.");
  assert.equal(state.payload.entries.length, 1);
  assert.equal(state.payload.reservations.length, 0, "Actual usage must atomically reconcile the pre-call reservation.");
  assert.equal(state.payload.entries[0].costUsd, 0.75);
  assert.equal(recorded.nextRetryAt, "2026-08-21T10:00:00.000Z");
  const duplicateRecordedReservation = await reservePr262AiCommitteeBudget({ candidateFingerprint: report.candidateFingerprint, ticker: "SAFE", direction: "upside" }, now);
  assert.equal(duplicateRecordedReservation.allowed, false);
  assert.equal(duplicateRecordedReservation.reason, "candidate_already_recorded");
  assert.equal(duplicateRecordedReservation.nextRetryAt, recorded.nextRetryAt, "A recorded fingerprint must not be hot-retried inside its rolling cost window.");
  const duplicate = await recordPr262AiCommitteeCost(report, now);
  assert.equal(duplicate.reason, "already_recorded");
  assert.equal(state.payload.entries.length, 1);

  state.payload.entries = Array.from({ length: 205 }, (_, index) => ({
    id: `tiny-charge-${index}`,
    recordedAt: now.toISOString(),
    ticker: "SAFE",
    alertType: "buy",
    costUsd: 0.01,
    source: "actual_tokens",
  }));
  const highVolumeReport = { ...report, candidateFingerprint: "high-volume-charge" };
  const highVolumeRecorded = await recordPr262AiCommitteeCost(highVolumeReport, now);
  assert.equal(highVolumeRecorded.recorded, true);
  assert.equal(state.payload.entries.length, 206, "Every charge inside the rolling window must remain in the cost fuse.");

  state.payload.entries = [];
  state.payload.reservations = [];
  const partialUsageReport = {
    ...report,
    candidateFingerprint: "partial-usage",
    committee: {
      output: {
        modelUsageSummary: {
          actualOpenAiUsage: {
            responsesWithUsage: 13,
            tokens: { promptTokens: 1, completionTokens: 1, cachedPromptTokens: 0 },
          },
        },
      },
    },
  };
  await reservePr262AiCommitteeBudget({ candidateFingerprint: partialUsageReport.candidateFingerprint, ticker: "SAFE", direction: "upside" }, now);
  await recordPr262AiCommitteeCost(partialUsageReport, now);
  assert.equal(state.payload.entries[0].costUsd, 0.75, "Incomplete provider usage must retain the full conservative reservation.");

  // Audit history must survive normal 24-hour cleanup without contributing
  // old spend to the rolling fuse or presenting fallback allocations as bills.
  state = null;
  const meteredReport = {
    ...partialUsageReport,
    candidateFingerprint: "repeated-after-window",
    committee: { output: { modelUsageSummary: { actualOpenAiUsage: {
      responsesWithUsage: 14,
      tokens: { promptTokens: 1_000, completionTokens: 500, cachedPromptTokens: 0 },
    } } } },
  };
  await recordPr262AiCommitteeCost(meteredReport, now);
  const hourLater = new Date(now.getTime() + 60 * 60_000);
  await recordPr262AiCommitteeCost({ ...report, candidateFingerprint: "unknown-audit" }, hourLater);
  const dayLater = new Date(now.getTime() + 25 * 60 * 60_000);
  await reservePr262AiCommitteeBudget({ candidateFingerprint: "pending-audit", ticker: "SAFE" }, dayLater);
  const agedBudget = await getPr262AiDailyBudgetStatus(dayLater, true);
  assert.equal(agedBudget.spentUsd, 0, "Charges at least 24 hours old must not reduce current capacity.");
  assert.equal(agedBudget.reservedUsd, 0.75, "An active reservation remains separate from past recorded spend.");
  assert.equal(agedBudget.costAudit.last48Hours.completeTokenUsageEstimateUsd, 0.0012);
  assert.equal(agedBudget.costAudit.last48Hours.unknownUsageAllocationUsd, 0.75);
  assert.equal(agedBudget.costAudit.last48Hours.budgetAccountedUsd, 0.7512);
  assert.equal(agedBudget.costAudit.last48Hours.recordedReviews, 2);
  assert.equal(agedBudget.costAudit.providerInvoiceVerified, false);
  assert.equal(agedBudget.costAudit.last30Days.recordedReviewHistoryComplete, false, "New history must not pretend to reconstruct the past month.");
  await recordPr262AiCommitteeCost(meteredReport, dayLater);
  await recordPr262AiCommitteeCost(meteredReport, dayLater);
  const repeatAudit = await getPr262AiCostAudit(dayLater);
  assert.equal(repeatAudit.last48Hours.recordedReviews, 3, "A later real review of the same fingerprint counts once, while a repeated recording stays idempotent.");
  assert.equal(repeatAudit.last48Hours.completeTokenUsageEstimateUsd, 0.0024);
  const thirtyFiveDaysLater = new Date(now.getTime() + 35 * 24 * 60 * 60_000);
  await reservePr262AiCommitteeBudget({ candidateFingerprint: "retain-history" }, thirtyFiveDaysLater);
  assert.equal(state.payload.entries.length, 0);
  assert.equal(state.payload.auditEntries.length, 3, "All recorded review history remains durable beyond 35 days after current-window cleanup.");
  assert.equal((await getPr262AiCostAudit(thirtyFiveDaysLater)).last30Days.recordedReviewHistoryComplete, true);
  const fortySixDaysLater = new Date(now.getTime() + 46 * 24 * 60 * 60_000);
  await reservePr262AiCommitteeBudget({ candidateFingerprint: "bounded-history" }, fortySixDaysLater);
  assert.equal(state.payload.auditEntries.length, 1, "Only entries inside the 45-day retention window remain after a mutation.");

  state = { payload: { version: 1, updatedAt: now.toISOString(), entries: [
    { id: "legacy", recordedAt: hourLater.toISOString(), ticker: "SAFE", alertType: null, costUsd: 0.5, source: "actual_tokens" },
  ], reservations: [] }, etag: `"etag-${++etagCounter}"` };
  await reservePr262AiCommitteeBudget({ candidateFingerprint: "migrate-audit" }, dayLater);
  assert.equal(state.payload.auditEntries.length, 1, "Migration preserves legacy raw entries even when they expire from the fuse in this write.");
  const migratedAudit = await getPr262AiCostAudit(dayLater);
  assert.equal(migratedAudit.last48Hours.completeTokenUsageEstimateUsd, 0.5);
  assert.equal(migratedAudit.last48Hours.recordedReviewHistoryComplete, false);

  state = { payload: { version: 1, updatedAt: now.toISOString(), entries: "damaged", reservations: [] }, etag: `"etag-${++etagCounter}"` };
  await assert.rejects(() => getPr262AiDailyBudgetStatus(now), /pr262_ai_daily_cost_state_unreadable/, "Damaged accounting must fail closed instead of reopening paid capacity.");
} finally {
  for (const key of Object.keys(process.env)) if (!(key in originalEnvironment)) delete process.env[key];
  Object.assign(process.env, originalEnvironment);
}

console.log(JSON.stringify({
  ok: true,
  tenDollarFuseReservesBeforePaidReview: true,
  concurrentReservationsCannotOverspend: true,
  optimisticConflictsRetryWithoutLostCost: true,
  damagedAccountingFailsClosed: true,
  duplicateCostIsIdempotent: true,
  hardLimitCannotBeRaisedByEnvironment: true,
  safeReservationCannotBeLoweredByEnvironment: true,
  dailyLimitBelowReservationDeniesPaidReview: true,
  incompleteUsageRetainsFullReservation: true,
  activeFingerprintUsesExactReservationExpiry: true,
  recordedFingerprintUsesExactCostExpiry: true,
  globalFuseUsesExactCumulativeCapacityExpiry: true,
  raceTimeGlobalFuseUsesExactRetry: true,
  highVolumeCannotEvictInWindowSpend: true,
  auditRetains45DaysWithoutChangingRollingFuse: true,
  auditSeparatesTokenEstimatesUnknownAllocationsAndReservations: true,
  auditReportsIncompleteHistoricalCoverage: true,
  auditRepeatedFingerprintUsesReviewTimestamp: true,
  auditMigratesLegacyEntriesBeforeCleanup: true,
}, null, 2));
