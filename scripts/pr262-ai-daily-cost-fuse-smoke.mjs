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
  forcedConflicts = 2;
  const recorded = await recordPr262AiCommitteeCost(report, now);
  assert.equal(recorded.recorded, true, "Cost recording must retry optimistic-write conflicts.");
  assert.equal(state.payload.entries.length, 1);
  assert.equal(state.payload.reservations.length, 0, "Actual usage must atomically reconcile the pre-call reservation.");
  assert.equal(state.payload.entries[0].costUsd, 0.75);
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
  highVolumeCannotEvictInWindowSpend: true,
}, null, 2));
