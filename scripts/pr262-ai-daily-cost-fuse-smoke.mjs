import { loadTsModule } from "./helpers/load-typescript-module.mjs";
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
  if (specifier === "@/lib/ai-committee/billing-audit") return loadTsModule(specifier, { "@/lib/r2-warehouse": {} });
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
const bound = loaded.exports.PR262_REVIEW_MAX_COST_USD;
const now = new Date("2026-09-21T10:00:00Z");
const reset = (entries = []) => { state = { etag: `etag-${++etagCounter}`, payload: { version: 1, updatedAt: now.toISOString(), entries, reservations: [] } }; };
const charge = (id, costUsd, recordedAt = now.toISOString()) => ({ id, costUsd, recordedAt, source: "actual_tokens", ticker: "TEST", alertType: "buy" });
const report = (id, roles = [], responses = 0) => ({
  openAiCalled: true, checkedAt: now.toISOString(), candidateFingerprint: id, selectedCandidate: { ticker: "TEST" },
  committee: { output: { modelUsageSummary: { roleDiagnostics: roles, actualOpenAiUsage: {
    responsesWithUsage: responses, tokens: { promptTokens: 1000, completionTokens: 500, cachedPromptTokens: 500 }, byModel: { "gpt-4.1-mini": {} },
  } } } },
});
const reserve = (id, at = now) => reservePr262AiCommitteeBudget({ candidateFingerprint: id, ticker: "TEST", direction: "upside" }, at);
try {
  process.env.SWING_UP_PR262_AI_DAILY_LIMIT_USD = "10";
  process.env.SWING_UP_PR262_AI_REVIEW_RESERVATION_USD = "0.75";
  assert.ok(bound < 0.20 && bound > 0, "Exposure must derive from enforceable model/input/output limits.");
  reset([charge("prior", 9.9)]);
  assert.equal((await getPr262AiDailyBudgetStatus(now)).allowed, false);
  assert.equal((await getPr262AiDailyBudgetStatus(now)).nextReviewReservationUsd, bound, "Obsolete 75-cent environment overrides cannot return.");
  process.env.SWING_UP_PR262_AI_DAILY_LIMIT_USD = "1000";
  assert.equal((await getPr262AiDailyBudgetStatus(now)).limitUsd, 10);
  process.env.SWING_UP_PR262_AI_DAILY_LIMIT_USD = "0.1";
  reset();
  assert.equal((await getPr262AiDailyBudgetStatus(now)).allowed, false);
  assert.equal((await getPr262AiDailyBudgetStatus(now)).nextBudgetAdmissionAt, null);
  process.env.SWING_UP_PR262_AI_DAILY_LIMIT_USD = "10";

  reset([charge("prior", 9.8)]);
  const concurrent = await Promise.all([reserve("a"), reserve("b")]);
  assert.equal(concurrent.filter(row => row.allowed).length, 1, "Concurrent reservations must not exceed the hard cap.");
  assert.equal((await getPr262AiDailyBudgetStatus(now)).spentUsd, 9.8, "A hold is not a charge.");
  await releasePr262AiCommitteeBudgetReservation(state.payload.reservations[0].id, now);

  reset([charge("current", 9.84), charge("first-release", 0.05, "2026-09-20T11:00:00Z")]);
  state.payload.reservations = [{ id: "hold", amountUsd: 0.05, reservedAt: "2026-09-21T09:00:00Z", expiresAt: "2026-09-21T12:00:00Z", ticker: "TEST", direction: "upside" }];
  assert.equal((await getPr262AiDailyBudgetStatus(now)).nextBudgetAdmissionAt, "2026-09-21T12:00:00.000Z");

  reset(Array.from({ length: 13 }, (_, i) => ({ ...charge(`legacy-${i}`, 0.75), source: "fallback_missing_usage" })));
  const migrated = await getPr262AiDailyBudgetStatus(now, true);
  assert.equal(migrated.spentUsd, 0, "Invented legacy charges must not block opportunities.");
  assert.equal(migrated.allowed, true);
  assert.equal(migrated.costAudit.last48Hours.removedLegacyEstimateUsd, 9.75);
  assert.equal(migrated.costAudit.last48Hours.unknownUsageReviews, 13, "Removing estimates must not claim that historical usage was verified.");
  assert.equal(migrated.costAudit.providerInvoiceVerified, false);

  reset();
  forcedConflicts = 2;
  assert.equal((await reserve("429")).allowed, true);
  const rejection = report("429", [{ agentId: "analyst_agent", status: "failed", usageReported: false, providerFailure: { httpStatus: 429, category: "quota", code: "credit_balance_exhausted" } }, { agentId: "final_judge", status: "blocked" }]);
  const rejected = await recordPr262AiCommitteeCost(rejection, now);
  assert.equal(rejected.entry.costUsd, 0);
  assert.equal(rejected.entry.source, "rejected_request");
  assert.equal(rejected.reservedUsd, 0);
  assert.equal(rejected.pendingUsageUpperBoundUsd, 0);
  assert.equal(rejected.allowed, false, "Quota errors pause all reviewers during recovery.");
  assert.equal((await reserve("another")).reason, "provider_cooldown");
  const later = new Date(now.getTime() + 31 * 60000);
  assert.equal((await reserve("429", later)).allowed, true, "A topped-up account can retry the same evidence after its cooldown.");
  const recovered = await recordPr262AiCommitteeCost(report("429", [{ status: "completed", usageReported: true }], 1), later);
  assert.equal(recovered.entry.costUsd, 0.00105, "Use actual cached/uncached input and output token counts, including partial reviews.");
  assert.equal(recovered.entry.source, "actual_tokens");
  assert.equal((await recordPr262AiCommitteeCost(report("429"), later)).reason, "already_recorded");

  reset();
  await reserve("timeout");
  const uncertain = await recordPr262AiCommitteeCost(report("timeout", [{ status: "failed", usageReported: false, providerFailure: { category: "timeout" } }]), now);
  assert.equal(uncertain.spentUsd, 0, "An ambiguous transport failure cannot be booked as a bill.");
  assert.equal(uncertain.pendingUsageUpperBoundUsd, bound, "A genuinely uncertain in-flight request retains bounded exposure separately.");
  assert.equal(uncertain.entry.source, "usage_pending");
  assert.equal(uncertain.unknownUsageAllocationUsd, 0);

  reset();
  const partial = report("partial", [{ status: "completed", usageReported: true }, { status: "failed", usageReported: false, providerFailure: { httpStatus: 429, category: "rate_limit" } }], 1);
  const metered = await recordPr262AiCommitteeCost(partial, now);
  assert.equal(metered.entry.costUsd, 0.00105, "One completed response counts even when the next reviewer is rejected.");
  assert.equal(metered.entry.pendingUpperBoundUsd, undefined);
  const nextDay = new Date(now.getTime() + 25 * 3600000);
  await reserve("tomorrow", nextDay);
  const audit = await getPr262AiDailyBudgetStatus(nextDay, true);
  assert.equal(audit.spentUsd, 0);
  assert.equal(audit.costAudit.last48Hours.completeTokenUsageEstimateUsd, 0.00105);
  assert.equal(audit.costAudit.last30Days.recordedReviewHistoryComplete, false);
  await recordPr262AiCommitteeCost(partial, nextDay);
  assert.equal((await getPr262AiCostAudit(nextDay)).last48Hours.recordedReviews, 2);
  const day35 = new Date(now.getTime() + 35 * 86400000);
  await reserve("retained", day35);
  assert.equal(state.payload.auditEntries.length, 2);
  assert.equal((await getPr262AiCostAudit(day35)).last30Days.recordedReviewHistoryComplete, true);
  await reserve("bounded", new Date(now.getTime() + 46 * 86400000));
  assert.equal(state.payload.auditEntries.length, 1);

  reset(Array.from({ length: 205 }, (_, i) => charge(`tiny-${i}`, 0.01)));
  await recordPr262AiCommitteeCost(report("latest", [{ status: "completed", usageReported: true }], 1), now);
  assert.equal(state.payload.entries.length, 206, "Every in-window charge remains counted.");
  state.payload.entries = "damaged";
  await assert.rejects(() => getPr262AiDailyBudgetStatus(now), /state_unreadable/);
} finally {
  for (const key of Object.keys(process.env)) if (!(key in originalEnvironment)) delete process.env[key];
  Object.assign(process.env, originalEnvironment);
}
console.log("Cost accounting: actual token receipts, zero rejected-request charges, recoverable quota cooldown, legacy estimate removal, separate uncertainty holds, concurrent $10 cap and 45-day audit passed.");
