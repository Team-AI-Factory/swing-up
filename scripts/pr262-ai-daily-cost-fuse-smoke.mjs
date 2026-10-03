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
  if (specifier === "@/lib/ai-committee/model-policy") return loadTsModule(specifier);
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
    responsesWithUsage: responses, tokens: { promptTokens: 1000, completionTokens: 500, cachedPromptTokens: 500 },
    byModel: { "gpt-4.1-mini": { promptTokens: 1000, completionTokens: 500, cachedPromptTokens: 500, responses } },
  } } } },
});
const reserve = (id, at = now) => reservePr262AiCommitteeBudget({ candidateFingerprint: id, ticker: "TEST", direction: "upside" }, at);
const mixedRows = {
  "gpt-6.1-sol": { promptTokens: 5000, cachedPromptTokens: 2000, cacheWritePromptTokens: 1000, completionTokens: 600, reasoningTokens: 450, totalTokens: 5600, responses: 3, pricingVerified: true },
  "gpt-6-astra": { promptTokens: 6000, cachedPromptTokens: 1000, cacheWritePromptTokens: 3000, completionTokens: 400, reasoningTokens: 300, totalTokens: 6400, responses: 1, pricingVerified: true },
  "gpt-6-luna": { promptTokens: 2000, cachedPromptTokens: 500, cacheWritePromptTokens: 500, completionTokens: 250, reasoningTokens: 0, totalTokens: 2250, responses: 1, pricingVerified: true },
  "gpt-4.1-mini-2025-04-14": { promptTokens: 1000, cachedPromptTokens: 500, completionTokens: 500, totalTokens: 1500, responses: 1 },
};
const mixedReport = (id) => {
  const byModel = structuredClone(mixedRows);
  const totals = Object.values(byModel).reduce((sum, row) => ({
    promptTokens: sum.promptTokens + row.promptTokens,
    cachedPromptTokens: sum.cachedPromptTokens + row.cachedPromptTokens,
    cacheWritePromptTokens: sum.cacheWritePromptTokens + (row.cacheWritePromptTokens ?? 0),
    completionTokens: sum.completionTokens + row.completionTokens,
  }), { promptTokens: 0, cachedPromptTokens: 0, cacheWritePromptTokens: 0, completionTokens: 0 });
  const responses = Object.values(byModel).reduce((sum, row) => sum + row.responses, 0);
  const value = report(id, Array.from({ length: responses }, () => ({ status: "completed", usageReported: true })), responses);
  Object.assign(value.committee.output.modelUsageSummary.actualOpenAiUsage, { tokens: totals, byModel });
  return value;
};
try {
  process.env.SWING_UP_PR262_AI_DAILY_LIMIT_USD = "10";
  process.env.SWING_UP_PR262_AI_REVIEW_RESERVATION_USD = "0.75";
  assert.ok(Math.abs(bound - 1.9346) < 1e-12, "Six-call exposure must cover five Sol roles, one Astra judge, 61K input and 4096 total output tokens each at cache-write rates.");
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

  const priorCharge = 10 - bound * 1.5;
  reset([charge("prior", priorCharge)]);
  const concurrent = await Promise.all([reserve("a"), reserve("b")]);
  assert.equal(concurrent.filter(row => row.allowed).length, 1, "Concurrent reservations must not exceed the hard cap.");
  assert.equal((await getPr262AiDailyBudgetStatus(now)).spentUsd, Math.round(priorCharge * 1e6) / 1e6, "A hold is not a charge.");
  await releasePr262AiCommitteeBudgetReservation(state.payload.reservations[0].id, now);

  reset([charge("current", 10 - bound - 0.01), charge("first-release", 0.05, "2026-09-20T11:00:00Z")]);
  state.payload.reservations = [{ id: "hold", amountUsd: 0.05, reservedAt: "2026-09-21T09:00:00Z", expiresAt: "2026-09-21T12:00:00Z", ticker: "TEST", direction: "upside" }];
  assert.equal((await getPr262AiDailyBudgetStatus(now)).nextBudgetAdmissionAt, "2026-09-21T12:00:00.000Z");

  reset([{ ...charge("old-uncertain", 0.02), source: "usage_pending", pendingUpperBoundUsd: 0.136, retryAt: "2026-09-22T10:00:00Z" }, charge("old-mini", 0.027)]);
  const oldHold = { id: "old-mini-hold", amountUsd: 0.156, reservedAt: now.toISOString(), expiresAt: "2026-09-22T10:00:00Z", ticker: "OLD", direction: "upside" };
  state.payload.reservations = [structuredClone(oldHold)];
  const oldFingerprint = await reserve("old-mini-hold");
  assert.equal(oldFingerprint.reason, "candidate_already_reserved", "An old smaller hold cannot authorize new model calls.");
  assert.deepEqual(state.payload.reservations[0], oldHold);
  assert.equal((await reserve("new-model-hold")).reservation.amountUsd, bound);
  assert.deepEqual(state.payload.reservations.find(row => row.id === oldHold.id), oldHold, "Migration must not rewrite or refund old reservations.");
  assert.equal(state.payload.entries.find(row => row.id === "old-mini").costUsd, 0.027, "Historical mini charges remain immutable.");
  assert.equal(state.payload.entries.find(row => row.id === "old-uncertain").pendingUpperBoundUsd, 0.136, "Prior unknown exposure is retained independently of the new price policy.");

  reset();
  await reserve("mixed-models");
  const mixed = await recordPr262AiCommitteeCost(mixedReport("mixed-models"), now);
  assert.equal(mixed.entry.costUsd, 0.092543, "Sum each model's disjoint ordinary/cache-read/cache-write tokens and completion cost; never apply one rate to mixed tokens.");
  assert.equal(mixed.entry.source, "actual_tokens");
  assert.equal(mixed.pendingUsageUpperBoundUsd, 0);
  assert.equal(mixed.reservedUsd, 0);
  const noReasoningBreakdown = mixedReport("without-reasoning-detail");
  for (const row of Object.values(noReasoningBreakdown.committee.output.modelUsageSummary.actualOpenAiUsage.byModel)) delete row.reasoningTokens;
  reset();
  await reserve("without-reasoning-detail");
  assert.equal((await recordPr262AiCommitteeCost(noReasoningBreakdown, now)).entry.costUsd, mixed.entry.costUsd, "Reasoning is already in completion tokens and cannot be billed twice.");
  reset();
  const tiny = report("tiny-cache-read", [{ status: "completed", usageReported: true }], 1);
  const tinyUsage = { promptTokens: 1, completionTokens: 0, cachedPromptTokens: 1, cacheWritePromptTokens: 0 };
  Object.assign(tiny.committee.output.modelUsageSummary.actualOpenAiUsage, {
    tokens: tinyUsage, byModel: { "gpt-6-luna": { ...tinyUsage, responses: 1, pricingVerified: true } },
  });
  await reserve("tiny-cache-read");
  assert.equal((await recordPr262AiCommitteeCost(tiny, now)).entry.costUsd, 0.000001, "Round new receipts upward at ledger precision rather than erase a small known charge.");

  const missingWriteReport = (id) => {
    const value = mixedReport(id);
    const usage = value.committee.output.modelUsageSummary.actualOpenAiUsage;
    delete usage.byModel["gpt-6.1-sol"].cacheWritePromptTokens;
    delete usage.tokens.cacheWritePromptTokens;
    return value;
  };
  reset();
  await reserve("optional-write-breakdown");
  const boundedInput = await recordPr262AiCommitteeCost(missingWriteReport("optional-write-breakdown"), now);
  assert.equal(boundedInput.entry.source, "usage_pending", "Missing optional breakdown is labelled uncertain, never silently treated as zero.");
  assert.equal(boundedInput.entry.costUsd, 0.086043, "Known output and cache reads, plus fully classified models, remain metered.");
  assert.equal(boundedInput.pendingUsageUpperBoundUsd, 0.0075, "Unclassified Sol input uses cache-write rates to bound only its actual 3000 tokens, not the whole review.");
  assert.ok(boundedInput.pendingUsageUpperBoundUsd < bound / 100);
  assert.equal(boundedInput.allowed, true, "A normal optional receipt omission must not unnecessarily freeze the whole allowance.");
  reset();
  await reserve("write-breakdown-and-timeout");
  const missingWithTimeout = missingWriteReport("write-breakdown-and-timeout");
  missingWithTimeout.committee.output.modelUsageSummary.roleDiagnostics.push({ status: "failed", usageReported: false, providerFailure: { category: "timeout" } });
  const timeoutBound = await recordPr262AiCommitteeCost(missingWithTimeout, now);
  assert.equal(timeoutBound.entry.costUsd, boundedInput.entry.costUsd);
  assert.ok(timeoutBound.pendingUsageUpperBoundUsd + timeoutBound.entry.costUsd >= bound, "An additional unobserved call prevents narrowing the full remaining reservation.");
  reset();
  await reserve("contradictory-role-receipts");
  const extraClaimedReceipt = missingWriteReport("contradictory-role-receipts");
  extraClaimedReceipt.committee.output.modelUsageSummary.roleDiagnostics.push({ status: "completed", usageReported: true });
  const contradictoryRoles = await recordPr262AiCommitteeCost(extraClaimedReceipt, now);
  assert.equal(contradictoryRoles.entry.costUsd, 0);
  assert.ok(contradictoryRoles.pendingUsageUpperBoundUsd >= bound, "Role receipt counts must match actual reported calls before narrowing uncertainty.");

  const invalidReceipts = [
    ["unknown-model", usage => { usage.byModel["unverified-model"] = usage.byModel["gpt-6-astra"]; delete usage.byModel["gpt-6-astra"]; }],
    ["unverified-tier", usage => { usage.byModel["gpt-6-astra"].pricingVerified = false; }],
    ["missing-pricing-proof", usage => { delete usage.byModel["gpt-6-astra"].pricingVerified; }],
    ["missing-cache-writes", usage => { delete usage.byModel["gpt-6.1-sol"].cacheWritePromptTokens; }],
    ["overlapping-cache-counts", usage => { usage.byModel["gpt-6-astra"].cacheWritePromptTokens = 6000; }],
    ["aggregate-mismatch", usage => { usage.tokens.promptTokens += 1; }],
    ["missing-model-receipts", usage => { usage.byModel = {}; }],
    ["response-count-mismatch", usage => { usage.byModel["gpt-6-astra"].responses = 2; }],
    ["zero-response-contradiction", usage => { usage.responsesWithUsage = 0; }],
    ["negative-response-count", usage => { usage.responsesWithUsage = -1; }],
    ["negative-output", usage => { usage.byModel["gpt-6-astra"].completionTokens = -1; }],
    ["fractional-token-count", usage => { usage.byModel["gpt-6-astra"].promptTokens = 6000.5; }],
    ["explicitly-unverified-mini", usage => { usage.byModel["gpt-4.1-mini-2025-04-14"].pricingVerified = false; }],
  ];
  for (const [id, invalidate] of invalidReceipts) {
    reset();
    await reserve(id);
    const value = mixedReport(id);
    invalidate(value.committee.output.modelUsageSummary.actualOpenAiUsage);
    const result = await recordPr262AiCommitteeCost(value, now);
    assert.equal(result.entry.source, "usage_pending", `${id}: an unpriced or invalid receipt must retain its hold.`);
    assert.equal(result.entry.costUsd, 0, `${id}: do not invent a token charge.`);
    assert.equal(result.pendingUsageUpperBoundUsd, Math.round(bound * 1e6) / 1e6, `${id}: uncertainty must not silently reopen the daily fuse.`);
  }

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

  const localRoles = [
    { status: "failed", error: "prompt_too_large", usageReported: false, providerFailure: { category: "input_limit", stopRemainingAgents: true } },
    { status: "blocked", providerFailure: { category: "input_limit", stopRemainingAgents: true } },
  ];
  reset();
  await reserve("oversized");
  const local = await recordPr262AiCommitteeCost(report("oversized", localRoles), now);
  assert.equal(local.entry.costUsd, 0);
  assert.equal(local.entry.source, "rejected_request");
  assert.equal(local.pendingUsageUpperBoundUsd, 0);
  assert.equal(local.providerCooldown, null, "A local prompt limit must not pause unrelated candidates.");
  assert.equal((await reserve("oversized")).allowed, false, "The rejected candidate retains its retry hold.");
  assert.equal((await reserve("unrelated")).allowed, true);

  reset();
  await reserve("inflight-local");
  await reserve("inflight-quota");
  await recordPr262AiCommitteeCost({ ...rejection, candidateFingerprint: "inflight-quota" }, now);
  const heldUntil = state.payload.providerCooldown.until;
  await recordPr262AiCommitteeCost(report("inflight-local", localRoles), now);
  assert.equal(state.payload.providerCooldown.until, heldUntil, "Settling a local rejection cannot erase a concurrent provider stop.");
  assert.equal((await reserve("blocked-by-real-quota")).reason, "provider_cooldown");

  reset();
  await reserve("partial-local");
  const partialLocal = await recordPr262AiCommitteeCost(report("partial-local", [{ status: "completed", usageReported: true }, ...localRoles], 1), now);
  assert.equal(partialLocal.entry.costUsd, 0.00105, "A later input limit preserves completed roles' token charges.");
  assert.equal(partialLocal.providerCooldown, null);

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
