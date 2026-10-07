import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";

// Entirely local: real predicate, reservation, release, normalization and ETag
// handling. Every unused application dependency throws if called; no models,
// provider, billing API or remote storage are accessed.
const root = fileURLToPath(new URL("..", import.meta.url));
const baseCommit = "c2c23da420a4f1fb776a8d0329786084f6ae473a";
const policyPath = "lib/ai-committee/review-policy.ts";
const reproducing = process.argv.includes("--reproduce-base");
// Only the optional historical reproduction needs Git history. Normal smoke
// tests also run in shallow clones and source archives without this commit.
const baselineSource = reproducing
  ? execFileSync("git", ["show", `${baseCommit}:${policyPath}`], { cwd: root, encoding: "utf8" }) : null;
const currentSource = readFileSync(new URL(`../${policyPath}`, import.meta.url), "utf8");
const nativeRequire = createRequire(import.meta.url);
const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
function loadPolicy(source) {
  const result = { exports: {} };
  new Function("module", "exports", compile(source))(result, result.exports);
  return result.exports;
}
const policy = loadPolicy(reproducing ? baselineSource : currentSource);
const source = readFileSync(new URL("../lib/opportunity-engine/pr262-event-job.ts", import.meta.url), "utf8");
let exposed = source;
for (const name of ["reserveCommitteeCall", "releaseRejectedCommitteeCall"]) {
  const declaration = `async function ${name}(`;
  assert.ok(exposed.includes(declaration));
  exposed = exposed.replace(declaration, `export ${declaration}`);
}
const objects = new Map();
const operations = [];
let etagCounter = 0;
let forcedConflicts = 0;
let readFails = false;
let writeFails = false;
const storageKey = value => `local-only/usage-retention/${value}`;
const committeeKey = storageKey("event-job/runtime/committee-budgets-v1.json");
const storage = {
  readVersionedTextFromR2: async key => {
    operations.push({ kind: "read", key });
    if (readFails) throw new Error("test_read_failure");
    const row = objects.get(key);
    return row ? { found: true, text: JSON.stringify(row.value), etag: row.etag } : { found: false, text: null, etag: null };
  },
  writeVersionedJsonToR2: async (key, value, options = {}) => {
    operations.push({ kind: "write", key });
    if (writeFails) throw new Error("test_write_failure");
    if (forcedConflicts > 0) { forcedConflicts -= 1; return { written: false, conflict: true, etag: null }; }
    const current = objects.get(key);
    assert.ok(options.createOnly || options.expectedEtag);
    if ((options.createOnly && current) || (options.expectedEtag && options.expectedEtag !== current?.etag)) {
      return { written: false, conflict: true, etag: null };
    }
    const etag = `"etag-${++etagCounter}"`;
    objects.set(key, { value: structuredClone(value), etag });
    return { written: true, conflict: false, etag };
  },
};
const result = { exports: {} };
new Function("require", "module", "exports", "fetch", compile(exposed))(specifier => {
  if (specifier === "@/lib/r2-warehouse") return storage;
  if (specifier === "@/lib/opportunity-engine/pr262-storage") return { pr262StorageKey: storageKey };
  if (specifier === "@/lib/ai-committee/review-policy") return policy;
  if (specifier === "@/lib/equity-signal/valuation-review-materiality") return loadTsModule(specifier);
  if (specifier.startsWith("node:")) return nativeRequire(specifier);
  return new Proxy({}, { get: (_value, key) => { throw new Error(`Unexpected dependency: ${specifier}.${String(key)}`); } });
}, result, result.exports, () => { throw new Error("Network forbidden"); });
const { reserveCommitteeCall, releaseRejectedCommitteeCall, PR262_EVENT_JOB_KEYS } = result.exports;
const costPath = "lib/opportunity-engine/pr262-ai-daily-cost.ts";
const costSource = reproducing
  ? execFileSync("git", ["show", `${baseCommit}:${costPath}`], { cwd: root, encoding: "utf8" })
  : readFileSync(new URL(`../${costPath}`, import.meta.url), "utf8");
const costModule = { exports: {} };
new Function("require", "module", "exports", compile(costSource))(specifier => {
  if (specifier === "@/lib/r2-warehouse") return storage;
  if (specifier === "@/lib/opportunity-engine/pr262-storage") return { pr262StorageKey: storageKey };
  if (specifier === "@/lib/ai-committee/review-policy") return policy;
  if (specifier === "@/lib/ai-committee/model-policy") return loadTsModule(specifier);
  if (specifier === "@/lib/ai-committee/billing-audit") return { readOpenAiBillingAudit: () => { throw new Error("Billing API forbidden"); } };
  throw new Error(`Unexpected cost dependency: ${specifier}`);
}, costModule, costModule.exports);
const dollars = costModule.exports;
const costKey = dollars.PR262_AI_DAILY_COST_KEY;
const originalLimit = process.env.SWING_UP_PR262_AI_DAILY_LIMIT_USD;
process.env.SWING_UP_PR262_AI_DAILY_LIMIT_USD = "10";
const now = new Date("2026-10-06T12:00:00.000Z");
const eventId = "valuation-event-under-review";
const ownerId = "test-owner";
const fingerprint = "valuation:0001234567:upside:exact-original-paid-hash";
const candidate = {
  candidateFingerprint: fingerprint, ticker: "LOCAL", direction: "upside",
  // Opaque metadata models an admitted materiality baseline. Reservation and
  // release already preserve arbitrary stored metadata, so no materiality
  // patch is required to reproduce or protect the deletion boundary.
  valuationBaseline: { version: 1, cik: "0001234567", evidenceKey: "paid-source-hash", price: 100 },
};
function put(key, value) { objects.set(key, { value: structuredClone(value), etag: `"seed-${++etagCounter}"` }); }
const rows = () => objects.get(committeeKey).value.reservations;
const stored = () => structuredClone(objects.get(committeeKey));
async function resetAndAdmit() {
  objects.clear(); operations.length = 0; forcedConflicts = 0; readFails = false; writeFails = false;
  put(PR262_EVENT_JOB_KEYS.LEASE_KEY, { version: 1, updatedAt: now.toISOString(), lease: {
    eventId, ownerId, acquiredAt: now.toISOString(), expiresAt: "2026-10-06T12:05:00.000Z",
  } });
  put(committeeKey, { version: 1, updatedAt: now.toISOString(), reservations: [] });
  assert.equal((await reserveCommitteeCall({ eventId, ownerId, now, reservation: candidate })).allowed, true);
  assert.equal(rows().length, 1);
  assert.deepEqual(rows()[0].valuationBaseline, candidate.valuationBaseline);
  operations.length = 0;
}
const rejected = { status: "failed", usageReported: false, providerFailure: { httpStatus: 429 } };
const committee = (actualOpenAiUsage, roleDiagnostics = [rejected]) => ({ output: { modelUsageSummary: { actualOpenAiUsage, roleDiagnostics } } });
const report = value => ({ openAiCalled: true, candidateFingerprint: fingerprint, committee: value });
const moneySnapshot = () => structuredClone(objects.get(costKey));
const priorCharge = { id: "old-actual-charge", recordedAt: "2026-10-06T11:00:00.000Z", ticker: "OLD", alertType: "buy", costUsd: 0.027, source: "actual_tokens" };
const priorPending = { id: "old-uncertain-charge", recordedAt: "2026-10-06T11:00:00.000Z", ticker: "OLD", alertType: "buy", costUsd: 0.02,
  source: "usage_pending", pendingUpperBoundUsd: 0.136, retryAt: "2026-10-07T11:00:00.000Z" };
const priorHold = { id: "old-small-hold", reservedAt: "2026-10-06T11:00:00.000Z", expiresAt: "2026-10-07T11:00:00.000Z",
  ticker: "OLD", direction: "upside", amountUsd: 0.156 };
async function reserveMoney() {
  put(costKey, { version: 1, updatedAt: now.toISOString(), entries: [priorCharge, priorPending], reservations: [priorHold],
    auditEntries: [priorCharge, priorPending], auditTrackingStartedAt: "2026-10-06T11:00:00.000Z" });
  const reserved = await dollars.reservePr262AiCommitteeBudget(candidate, now);
  assert.equal(reserved.allowed, true);
  assert.equal(reserved.reservation.amountUsd, dollars.PR262_REVIEW_MAX_COST_USD);
  return dollars.getPr262AiDailyBudgetStatus(now);
}
function assertOldMoneyPreserved() {
  const ledger = objects.get(costKey).value;
  assert.deepEqual(ledger.entries.slice(0, 2), [priorCharge, priorPending]);
  assert.deepEqual(ledger.reservations.filter(row => row.id === priorHold.id), [priorHold]);
}
const originalContradictions = [
  ["role reports usage despite zero aggregate", committee({ responsesWithUsage: 0 }, [{ ...rejected, usageReported: true }])],
  ["null aggregate is unknown", committee({ responsesWithUsage: null })],
  ["positive token aggregate despite zero responses", committee({ responsesWithUsage: 0, tokens: { promptTokens: 1000, completionTokens: 100 } })],
];

if (reproducing) {
  const reproductions = [];
  for (const [name, input] of originalContradictions) {
    await resetAndAdmit();
    const beforeMoney = await reserveMoney();
    const allowed = policy.committeeRequestsRejectedWithoutUsage(input);
    await releaseRejectedCommitteeCall(eventId, report(input), now);
    const accounted = await dollars.recordPr262AiCommitteeCost(report(input), now);
    const reproduction = { name, input, releaseAllowed: allowed, baselinesBefore: 1, baselinesAfter: rows().length,
      dollars: { beforeExposureUsd: beforeMoney.exposureUsd, afterExposureUsd: accounted.exposureUsd,
        entrySource: accounted.entry.source, entryCostUsd: accounted.entry.costUsd,
        newPendingUpperBoundUsd: accounted.entry.pendingUpperBoundUsd ?? 0 } };
    assert.equal(allowed, true);
    assert.equal(rows().length, 0, "The unmodified predicate must reproduce real baseline deletion.");
    reproductions.push(reproduction);
  }
  console.log(JSON.stringify({ mode: "unmodified-base-reproduction", baseCommit,
    policySha256: createHash("sha256").update(baselineSource).digest("hex"), reproductions }, null, 2));
  if (originalLimit === undefined) delete process.env.SWING_UP_PR262_AI_DAILY_LIMIT_USD;
  else process.env.SWING_UP_PR262_AI_DAILY_LIMIT_USD = originalLimit;
  process.exit(0);
}

const zeroTokens = { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedPromptTokens: 0, cacheWritePromptTokens: 0, reasoningTokens: 0 };
const fullZero = { responsesWithUsage: 0, tokens: zeroTokens, byModel: {} };
const holdFixtures = [...originalContradictions];
for (const counter of [undefined, null, "0", false, 1, -1, 0.5]) {
  holdFixtures.push([`unknown or nonzero response counter: ${String(counter)}`, committee({ responsesWithUsage: counter })]);
}
for (const key of Object.keys(zeroTokens)) {
  holdFixtures.push([`contradictory positive ${key}`, committee({ ...fullZero, tokens: { ...zeroTokens, [key]: 1 } })]);
}
for (const malformed of [null, "0", [], { promptTokens: null }, { promptTokens: "0" }, { promptTokens: -1 }]) {
  holdFixtures.push([`invalid aggregate tokens: ${JSON.stringify(malformed)}`, committee({ ...fullZero, tokens: malformed })]);
}
for (const byModel of [null, [], "unknown", { "gpt-4.1-mini": { responses: 1, promptTokens: 1, completionTokens: 0 } }, { "gpt-4.1-mini": { responses: 0, promptTokens: 0, completionTokens: 0 } }, { "gpt-4.1-mini": 0 }]) {
  holdFixtures.push([`unknown or contradictory model receipts: ${JSON.stringify(byModel)}`, committee({ ...fullZero, byModel })]);
}
const malformedProofRoles = [];
for (const httpStatus of [[429], { value: 429 }, "429", null, undefined]) {
  malformedProofRoles.push([`malformed HTTP status: ${JSON.stringify(httpStatus)}`, { status: "failed", usageReported: false, providerFailure: { httpStatus } }]);
}
for (const error of [["prompt_too_large"], ["disabled"], { value: "prompt_too_large" }, "429", 429, null]) {
  malformedProofRoles.push([`malformed local error: ${JSON.stringify(error)}`, { status: "failed", usageReported: false, error }]);
}
for (const status of [["blocked"], ["planned"], ["failed"], { value: "blocked" }, "completed", "429", 429, null, undefined]) {
  malformedProofRoles.push([`malformed role status: ${JSON.stringify(status)}`, { status, usageReported: false, providerFailure: { httpStatus: 429 } }]);
}
for (const error of [["prompt_too_large"], ["disabled"], { value: "model_not_allowed" }, 429]) {
  malformedProofRoles.push([`malformed local error alongside numeric 429: ${JSON.stringify(error)}`, { ...rejected, error }]);
}
for (const httpStatus of [200, 500, [429], { value: 429 }, "429"]) {
  malformedProofRoles.push([`local error cannot override HTTP: ${JSON.stringify(httpStatus)}`, {
    status: "failed", usageReported: false, error: "model_not_allowed", providerFailure: { httpStatus },
  }]);
}
for (const providerFailure of [[], [{ httpStatus: 429 }], "429", 429, false]) {
  malformedProofRoles.push([`malformed failure alongside local label: ${JSON.stringify(providerFailure)}`, {
    status: "failed", usageReported: false, error: "model_not_allowed", providerFailure,
  }]);
}
for (const usageReported of [null, 0, "false", {}, []]) {
  malformedProofRoles.push([`unknown role usage flag alongside numeric 429: ${JSON.stringify(usageReported)}`, { ...rejected, usageReported }]);
  for (const status of ["blocked", "planned"]) malformedProofRoles.push([`unknown usage flag on ${status}: ${JSON.stringify(usageReported)}`, { status, usageReported }]);
}
for (const status of ["blocked", "planned"]) {
  for (const error of [["disabled"], { value: "disabled" }, 429]) malformedProofRoles.push([
    `malformed error on ${status}: ${JSON.stringify(error)}`, { status, usageReported: false, error, providerFailure: { httpStatus: 429 } },
  ]);
  for (const providerFailure of [[], [{ httpStatus: 500 }], "500", 500]) malformedProofRoles.push([
    `malformed failure on ${status}: ${JSON.stringify(providerFailure)}`, { status, usageReported: false, providerFailure },
  ]);
  for (const httpStatus of [[429], { value: 429 }, "429", 0, 600, 429.5]) malformedProofRoles.push([
    `malformed inherited HTTP on ${status}: ${JSON.stringify(httpStatus)}`, { status, usageReported: false, providerFailure: { httpStatus } },
  ]);
}
for (const [name, role] of malformedProofRoles) holdFixtures.push([name, committee(fullZero, [rejected, role])]);
holdFixtures.push(
  ["partial paid review followed by 429", committee({ responsesWithUsage: 1, tokens: { promptTokens: 100, completionTokens: 10 } }, [{ status: "completed", usageReported: true }, rejected])],
  ["partial role followed by 429 with stale zero aggregate", committee(fullZero, [{ status: "completed", usageReported: true }, rejected])],
  ["blocked role claims usage", committee(fullZero, [rejected, { status: "blocked", usageReported: true }])],
  ["missing actual usage", { output: { modelUsageSummary: { roleDiagnostics: [rejected] } } }],
  ["missing role diagnostics", committee(fullZero, undefined)],
  ["empty role diagnostics", committee(fullZero, [])],
  ["blocked-only plan", committee(fullZero, [{ status: "blocked", usageReported: false }])],
  ["timeout despite zero observed receipts", committee(fullZero, [{ status: "failed", usageReported: false, providerFailure: { category: "timeout" } }])],
  ["mixed rejected and unknown failure", committee(fullZero, [rejected, { status: "failed", usageReported: false }])],
  ["untrusted unknown usage flag", committee(fullZero, [{ ...rejected, usageReported: null }])],
  ["completed status cannot claim definite failed rejection", committee(fullZero, [rejected, { ...rejected, status: "completed" }])],
  ["crash without report", null],
);
// The factory defaults to a known rejection, so explicitly remove this field.
delete holdFixtures.find(([name]) => name === "missing role diagnostics")[1].output.modelUsageSummary.roleDiagnostics;
for (const [name, input] of holdFixtures) {
  await resetAndAdmit();
  const before = stored();
  assert.equal(policy.committeeRequestsRejectedWithoutUsage(input), false, name);
  await releaseRejectedCommitteeCall(eventId, report(input), now);
  await releaseRejectedCommitteeCall(eventId, report(input), now);
  assert.deepEqual(stored(), before, `${name}: unknown/positive usage must preserve exact hash and admitted metadata.`);
  assert.equal(operations.length, 0, `${name}: denied release must not read or write admission storage.`);
}

const releaseFixtures = [
  ["known zero 429 with blocked roles", committee(fullZero, [rejected, { status: "blocked", usageReported: false }])],
  ["known local input rejection", committee(fullZero, [{ status: "failed", error: "prompt_too_large", usageReported: false }, { status: "planned", usageReported: false }])],
  ["legacy explicit zero with omitted optional breakdown", committee({ responsesWithUsage: 0 })],
  ["legacy missing usage flag on definite rejection", committee({ responsesWithUsage: 0 }, [{ status: "failed", providerFailure: { httpStatus: 429 } }])],
];
for (const status of [400, 401, 403, 404, 422, 429]) releaseFixtures.push([`known HTTP ${status} rejection`, committee(fullZero, [{ ...rejected, providerFailure: { httpStatus: status } }])]);
const localErrors = ["not_configured", "disabled", "confirmation_required", "model_not_configured", "model_not_allowed", "prompt_too_large"];
for (const error of localErrors) releaseFixtures.push([`known local ${error} rejection`, committee(fullZero, [{ status: "failed", usageReported: false, error }])]);
const optionalLegacyRoles = [
  ["null error with numeric HTTP 429", { ...rejected, error: null }],
  ["null HTTP with known local error", { status: "failed", usageReported: false, error: "model_not_allowed", providerFailure: { httpStatus: null } }],
  ["null failure with known local error", { status: "failed", usageReported: false, error: "model_not_allowed", providerFailure: null }],
];
for (const [name, role] of optionalLegacyRoles) releaseFixtures.push([name, committee(fullZero, [role])]);
const unattemptedRoles = ["blocked", "planned"].flatMap(status => [
  { name: `${status} with inherited numeric HTTP500`, role: { status, usageReported: false, providerFailure: { httpStatus: 500 } } },
  { name: `${status} with null optional metadata`, role: { status, usageReported: false, error: null, providerFailure: null } },
]);
for (const { name, role } of unattemptedRoles) releaseFixtures.push([name, committee(fullZero, [rejected, role])]);
for (const [name, input] of releaseFixtures) {
  await resetAndAdmit();
  const otherEvent = { ...structuredClone(rows()[0]), eventId: "different-event" };
  const otherHash = { ...structuredClone(rows()[0]), candidateFingerprint: "different-exact-hash" };
  rows().push(otherEvent, otherHash);
  assert.equal(policy.committeeRequestsRejectedWithoutUsage(input), true, name);
  await releaseRejectedCommitteeCall(eventId, report(input), now);
  assert.deepEqual(rows(), [otherEvent, otherHash], `${name}: release must match both event and exact fingerprint.`);
  const after = stored();
  const writes = operations.filter(operation => operation.kind === "write").length;
  await releaseRejectedCommitteeCall(eventId, report(input), now);
  assert.deepEqual(stored(), after, `${name}: repeated reconciliation is idempotent.`);
  assert.equal(operations.filter(operation => operation.kind === "write").length, writes);
}

const dollarCases = [];
for (const [name, input] of holdFixtures) {
  await resetAndAdmit();
  const beforeMoney = await reserveMoney();
  const beforeBaseline = stored();
  await releaseRejectedCommitteeCall(eventId, report(input), now);
  const accounted = await dollars.recordPr262AiCommitteeCost(report(input), now);
  assert.equal(accounted.entry.source, "usage_pending", `${name}: uncertainty cannot become a zero-dollar rejection.`);
  assert.equal(accounted.entry.costUsd, 0, `${name}: contradictory receipts must not invent a token charge.`);
  assert.equal(accounted.entry.pendingUpperBoundUsd, dollars.PR262_REVIEW_MAX_COST_USD, name);
  assert.equal(accounted.exposureUsd, beforeMoney.exposureUsd, `${name}: the original dollar exposure must remain allocated.`);
  assert.equal(accounted.spentUsd, 0.047, `${name}: old known charges remain charged.`);
  assert.deepEqual(stored(), beforeBaseline);
  assertOldMoneyPreserved();
  const recorded = moneySnapshot();
  assert.equal((await dollars.recordPr262AiCommitteeCost(report(input), now)).reason, "already_recorded");
  assert.deepEqual(moneySnapshot(), recorded, `${name}: repeated accounting must not reduce or duplicate exposure.`);
  dollarCases.push({ name, beforeExposureUsd: beforeMoney.exposureUsd, afterExposureUsd: accounted.exposureUsd,
    recordedCostUsd: accounted.entry.costUsd, retainedPendingUsd: accounted.entry.pendingUpperBoundUsd });
}
for (const [name, input] of releaseFixtures) {
  await resetAndAdmit();
  await reserveMoney();
  await releaseRejectedCommitteeCall(eventId, report(input), now);
  const accounted = await dollars.recordPr262AiCommitteeCost(report(input), now);
  assert.equal(rows().length, 0, name);
  assert.equal(accounted.entry.source, "rejected_request", name);
  assert.equal(accounted.entry.costUsd, 0, name);
  assert.equal(accounted.entry.retryAt, "2026-10-06T12:05:00.000Z", "Keep the existing definite-rejection retry duration.");
  assert.equal(accounted.exposureUsd, 0.339, `${name}: only the new proven-zero review can release its exposure.`);
  assert.equal(accounted.pendingUsageUpperBoundUsd, 0.136);
  assert.equal(accounted.reservedUsd, 0.156);
  assertOldMoneyPreserved();
  const recorded = moneySnapshot();
  assert.equal((await dollars.recordPr262AiCommitteeCost(report(input), now)).reason, "already_recorded");
  assert.deepEqual(moneySnapshot(), recorded);
}

await resetAndAdmit();
const crashBefore = await reserveMoney();
const crashMoney = moneySnapshot();
const crashBaseline = stored();
assert.equal((await dollars.recordPr262AiCommitteeCost(null, now)).reason, "openai_not_called");
assert.deepEqual(moneySnapshot(), crashMoney, "A crash without a report cannot prove no call or refund its reservation.");
assert.deepEqual(stored(), crashBaseline);
assert.equal((await dollars.getPr262AiDailyBudgetStatus(now)).exposureUsd, crashBefore.exposureUsd);

const pricedPartialCases = [];
const partialFailures = [
  { name: "known numeric 429", role: rejected, unobserved: false },
  { name: "unknown timeout", role: { status: "failed", usageReported: false, providerFailure: { category: "timeout" } }, unobserved: true },
  ...malformedProofRoles.map(([name, role]) => ({ name, role, unobserved: true })),
  ...localErrors.map(error => ({ name: `known local ${error}`, role: { status: "failed", usageReported: false, error }, unobserved: false })),
  ...optionalLegacyRoles.map(([name, role]) => ({ name, role, unobserved: false })),
  ...unattemptedRoles.map(({ name, role }) => ({ name, role, unobserved: false })),
  ...["blocked", "planned"].flatMap(status => [false, undefined].map(usageReported => ({
    name: `known no-call ${status} with ${String(usageReported)} usage`, role: { status, usageReported }, unobserved: false,
  }))),
];
for (const { name, role, unobserved } of partialFailures) {
  await resetAndAdmit();
  const beforeMoney = await reserveMoney();
  const receipt = { promptTokens: 1000, completionTokens: 500, cachedPromptTokens: 500 };
  const actual = { responsesWithUsage: 1, tokens: receipt, byModel: { "gpt-4.1-mini": { ...receipt, responses: 1 } } };
  const roles = [{ status: "completed", usageReported: true }, role];
  const partial = report(committee(actual, roles));
  const beforeBaseline = stored();
  await releaseRejectedCommitteeCall(eventId, partial, now);
  assert.deepEqual(stored(), beforeBaseline, "A priced partial review must retain its admission.");
  const accounted = await dollars.recordPr262AiCommitteeCost(partial, now);
  assert.equal(accounted.entry.costUsd, 0.00105, "Valid known receipts retain their original per-model price calculation.");
  assert.equal(accounted.spentUsd, 0.04805, "Known partial spend is added to, not substituted for, historical charges.");
  assert.equal(accounted.entry.source, unobserved ? "usage_pending" : "actual_tokens", name);
  if (unobserved) {
    assert.equal(accounted.entry.pendingUpperBoundUsd, 2.75275);
    assert.equal(accounted.exposureUsd, beforeMoney.exposureUsd);
  } else {
    assert.equal(accounted.entry.pendingUpperBoundUsd, undefined);
    assert.equal(accounted.exposureUsd, 0.34005);
  }
  assertOldMoneyPreserved();
  const recorded = moneySnapshot();
  assert.equal((await dollars.recordPr262AiCommitteeCost(report(originalContradictions[2][1]), now)).reason, "already_recorded");
  assert.deepEqual(moneySnapshot(), recorded, "Later inconsistent accounting cannot erase an already recorded real charge.");
  pricedPartialCases.push({ name, unobserved, costUsd: accounted.entry.costUsd, pendingUpperBoundUsd: accounted.entry.pendingUpperBoundUsd ?? 0,
    beforeExposureUsd: beforeMoney.exposureUsd, afterExposureUsd: accounted.exposureUsd });
}

const zeroReport = report(committee(fullZero));
for (const failure of ["read", "write", "cas"]) {
  await resetAndAdmit();
  const before = stored();
  if (failure === "read") readFails = true;
  if (failure === "write") writeFails = true;
  if (failure === "cas") forcedConflicts = 3;
  await assert.rejects(releaseRejectedCommitteeCall(eventId, zeroReport, now), /test_read_failure|test_write_failure|pr262_rejected_committee_release_failed/);
  assert.deepEqual(stored(), before, `${failure}: failed release must retain the admission.`);
}
await resetAndAdmit(); forcedConflicts = 2;
await releaseRejectedCommitteeCall(eventId, zeroReport, now);
assert.equal(rows().length, 0, "Transient CAS conflicts can recover a proven-zero release.");

const core = ["analyst_agent", "skeptic_agent", "final_judge"];
const focused = { ok: true, agentsFailed: 0, agentsCompleted: 3, output: { modelUsageSummary: {
  reviewPlan: { policy: "focused_v1", agentIds: core }, roleDiagnostics: core.map(agentId => ({ agentId, status: "completed" })),
} } };
const incomplete = structuredClone(focused);
incomplete.output.modelUsageSummary.roleDiagnostics.pop();
for (const [value, expected] of [[null, false], [{}, false],
  [{ ok: true, agentsFailed: 0, agentsCompleted: 14 }, true],
  [{ ok: true, agentsFailed: 1, agentsCompleted: 14 }, false],
  [{ ok: true, agentsFailed: 0, agentsCompleted: 13 }, false],
  [focused, true], [incomplete, false]]) {
  assert.equal(policy.completeCommitteeReview(value), expected, "Usage retention must preserve completeCommitteeReview publication authority.");
}
console.log(JSON.stringify({ mode: "hardened-regression", baseCommit, holdFixtures: holdFixtures.length,
  releaseFixtures: releaseFixtures.length, durableFailureScenarios: 4, completeCommitteeReviewUnchanged: true,
  dollarCases, pricedPartialCases, crashKeepsReservation: true,
  sourceSha256: createHash("sha256").update(currentSource).digest("hex"), result: "PASS", networkCalls: 0, modelCalls: 0 }, null, 2));
if (originalLimit === undefined) delete process.env.SWING_UP_PR262_AI_DAILY_LIMIT_USD;
else process.env.SWING_UP_PR262_AI_DAILY_LIMIT_USD = originalLimit;
