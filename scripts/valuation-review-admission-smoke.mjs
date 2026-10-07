import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";

// Local, deterministic admission tests. No provider, network, production storage,
// or model calls are allowed. Execute the real private event-job functions and
// the exact callback initializer extracted from its AST, with only I/O replaced.
const source = readFileSync(new URL("../lib/opportunity-engine/pr262-event-job.ts", import.meta.url), "utf8");
const sourceFile = ts.createSourceFile("pr262-event-job.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const callbackInitializers = [];
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(sourceFile) === "beforeOpenAiCall") {
    callbackInitializers.push(node.initializer.getText(sourceFile));
  }
  ts.forEachChild(node, visit);
}
visit(sourceFile);
assert.equal(callbackInitializers.length, 1, "Exercise the one actual event-job admission callback.");
const exposedNames = ["committeeCallDecision", "reserveCommitteeCall", "releaseRejectedCommitteeCall", "loadCommitteeBudgetState"];
let testableSource = source;
for (const name of exposedNames) {
  const declaration = new RegExp(`(?<!export )(async )?function ${name}\\(`);
  assert.match(testableSource, declaration, `Private admission function ${name} must exist.`);
  testableSource = testableSource.replace(declaration, "export $&");
}
testableSource += `
export function createAdmissionCallbackForSmoke(context: any) {
  const { event, ownerId, now, input, priorFollowup, valuationReview, previousValuationAdmission, assertJobActive } = context;
  const terminalGuard = false;
  const terminalAttemptId = "legacy-admission-only";
  let terminalReserved = false;
  const jobAbort = new AbortController();
  const previousValuationReview = null;
  let committeeRetryAt: string | null = null;
  let committeeBlockedReason: string | null = null;
  const beforeOpenAiCall = ${callbackInitializers[0]};
  return { beforeOpenAiCall, status: () => ({ committeeRetryAt, committeeBlockedReason }) };
}
`;

const nativeRequire = createRequire(import.meta.url);
const storageKey = relative => `local-only/valuation-admission/${relative}`;
const objects = new Map();
const operations = [];
let etagCounter = 0;
let readFailure = null;
let writeFailure = null;
let silentFailure = null;
let forcedConflicts = 0;
let readBarrier = null;
let inputLimitHeld = false;
let inputLimitReadFailure = false;
const storage = {
  readVersionedTextFromR2: async key => {
    operations.push({ kind: "read", key });
    if (key === readFailure) throw new Error("test_storage_read_failure");
    const stored = objects.get(key);
    const result = stored
      ? { found: true, text: stored.rawText ?? JSON.stringify(stored.value), etag: stored.etag }
      : { found: false, text: null, etag: null };
    if (readBarrier?.key === key && readBarrier.remaining > 0) {
      const barrier = readBarrier;
      barrier.remaining -= 1;
      if (barrier.remaining === 0) barrier.resolve();
      await barrier.promise;
    }
    return result;
  },
  writeVersionedJsonToR2: async (key, value, options = {}) => {
    operations.push({ kind: "write", key, options: structuredClone(options) });
    if (key === writeFailure) throw new Error("test_storage_write_failure");
    if (key === silentFailure) return { written: false, conflict: false, etag: null };
    if (key === committeeKey && forcedConflicts > 0) {
      forcedConflicts -= 1;
      operations.push({ kind: "conflict", key });
      return { written: false, conflict: true, etag: null };
    }
    const current = objects.get(key);
    if ((options.createOnly && current) || (options.expectedEtag && options.expectedEtag !== current?.etag)) {
      operations.push({ kind: "conflict", key });
      return { written: false, conflict: true, etag: null };
    }
    assert.ok(options.createOnly || options.expectedEtag, "Every durable write must use create-only or an observed ETag.");
    const etag = `"local-etag-${++etagCounter}"`;
    objects.set(key, { value: structuredClone(value), etag });
    return { written: true, conflict: false, etag };
  },
};
const materiality = loadTsModule("@/lib/equity-signal/valuation-review-materiality");
const reviewPolicy = loadTsModule("@/lib/ai-committee/review-policy");
const imports = {
  "@/lib/opportunity-engine/pr262-research-evidence": { unchangedCommitteeInputLimitHeld: async () => {
    if (inputLimitReadFailure) throw new Error("test_input_hold_read_failure");
    return inputLimitHeld;
  } },
  "@/lib/r2-warehouse": storage,
  "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: storageKey },
  "@/lib/equity-signal/valuation-review-materiality": materiality,
  "@/lib/ai-committee/review-policy": reviewPolicy,
};
const output = ts.transpileModule(testableSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const loaded = { exports: {} };
new Function("require", "module", "exports", "fetch", output)(specifier => {
  if (specifier in imports) return imports[specifier];
  if (specifier.startsWith("node:")) return nativeRequire(specifier);
  return new Proxy({}, { get: (_target, property) => { throw new Error(`Unexpected I/O dependency: ${specifier}.${String(property)}`); } });
}, loaded, loaded.exports, () => { throw new Error("Network is forbidden in the admission smoke."); });
const { committeeCallDecision, reserveCommitteeCall, releaseRejectedCommitteeCall, loadCommitteeBudgetState,
  createAdmissionCallbackForSmoke, PR262_EVENT_JOB_KEYS } = loaded.exports;
const { COMMITTEE_BUDGET_KEY: committeeKey, LEASE_KEY: leaseKey, STATE_KEY: stateKey } = PR262_EVENT_JOB_KEYS;
const dollars = loadTsModule("@/lib/opportunity-engine/pr262-ai-daily-cost", {
  "@/lib/r2-warehouse": storage,
  "@/lib/opportunity-engine/pr262-storage": imports["@/lib/opportunity-engine/pr262-storage"],
  "@/lib/ai-committee/billing-audit": { readOpenAiBillingAudit: () => { throw new Error("Billing API is forbidden."); } },
});
const costKey = dollars.PR262_AI_DAILY_COST_KEY;
const now = new Date("2026-10-06T12:00:00.000Z");
const at = hoursAgo => new Date(now.getTime() - hoursAgo * 60 * 60_000).toISOString();
const eventId = "valuation-event-local";
const ownerId = "local-owner";
const cik = "0001234567";
const otherCik = "0007654321";
const hash = value => createHash("sha256").update(value).digest("hex");
const persisted = value => JSON.parse(JSON.stringify(value));
const fingerprint = (label, issuer = cik, direction = "upside") => `valuation:${issuer}:${direction}:${hash(label).slice(0, 16)}`;
const baseline = (price = 100, overrides = {}) => ({
  version: 1, cik, evidenceKey: hash("unchanged-filing"), thresholdKey: hash("unchanged-thresholds"),
  priceReady: true, priceSupportsValuation: true, price, low: 90, base: 100, high: 110,
  methods: [{ identity: hash("owner-earnings"), value: 100 }], ...overrides,
});
const candidate = (label, price = 100, overrides = {}) => ({
  candidateFingerprint: fingerprint(label), ticker: "LOCAL", direction: "upside", valuationBaseline: baseline(price), ...overrides,
});
const admitted = (label, price = 100, hoursAgo = 1, overrides = {}) => ({
  eventId: `admitted-${label}`, reservedAt: at(hoursAgo), ...candidate(label, price), ...overrides,
});
function put(key, value) { objects.set(key, { value: structuredClone(value), etag: `"seed-${++etagCounter}"` }); }
function reset(rows = []) {
  objects.clear(); operations.length = 0;
  inputLimitHeld = false; inputLimitReadFailure = false;
  readFailure = null; writeFailure = null; silentFailure = null; forcedConflicts = 0; readBarrier = null;
  put(leaseKey, { version: 1, updatedAt: now.toISOString(), lease: {
    eventId, ownerId, acquiredAt: now.toISOString(), expiresAt: new Date(now.getTime() + 300_000).toISOString(),
  } });
  put(committeeKey, { version: 1, updatedAt: now.toISOString(), reservations: rows });
}
const reserve = (reservation, extra = {}) => reserveCommitteeCall({ eventId, ownerId, now, reservation, ...extra });
const rows = () => objects.get(committeeKey).value.reservations;
const snapshot = key => structuredClone(objects.get(key));
const decision = (reservation, reservations, extra = {}) => committeeCallDecision({ now, reservation, reservations, ...extra });
function callback(extra = {}) {
  return createAdmissionCallbackForSmoke({ event: { id: eventId }, ownerId, now,
    priorFollowup: {}, valuationReview: true, previousValuationAdmission: null, assertJobActive: () => {}, input: {}, ...extra });
}
function synchronizeNextReads(key, count) {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  readBarrier = { key, remaining: count, promise, resolve };
}
const tests = [];
const test = (name, run) => tests.push({ name, run });

test("penny jitter keeps original hashes and admitted snapshot unchanged", async () => {
  reset();
  const original = candidate("paid-original");
  const originalInput = structuredClone(original);
  assert.equal((await reserve(original)).allowed, true);
  const before = snapshot(committeeKey);
  const jitter = candidate("different-exact-revision", 100.01);
  const jitterInput = structuredClone(jitter);
  const outcome = await reserve(jitter);
  assert.equal(outcome.allowed, false);
  assert.equal(outcome.reason, "valuation_immaterial_change");
  assert.equal(outcome.nextRetryAt, "2026-10-07T00:00:00.000Z");
  assert.deepEqual(snapshot(committeeKey), before, "An unpaid scan cannot update the paid baseline or its original exact hash.");
  assert.deepEqual(original, originalInput);
  assert.deepEqual(jitter, jitterInput);
});

test("cumulative movement compares with last admission and significant evidence changes pass", async () => {
  reset();
  assert.equal((await reserve(candidate("start"))).allowed, true);
  for (const price of [101, 102, 104]) assert.equal((await reserve(candidate(`unpaid-${price}`, price))).allowed, false);
  assert.equal(rows().length, 1);
  assert.equal((await reserve(candidate("cumulative-five-percent", 105))).allowed, true);
  assert.equal(rows()[1].valuationBaseline.price, 105);
  assert.equal((await reserve(candidate("after-admission-penny", 105.01))).allowed, false);
  const last = rows()[1];
  for (const [name, changed] of [
    ["new-filing", { evidenceKey: hash("new-filing") }],
    ["threshold-crossing", { thresholdKey: hash("crossed-threshold") }],
    ["model-value", { methods: [{ identity: hash("owner-earnings"), value: 105 }] }],
    ["base-value", { base: 105 }],
  ]) assert.equal(decision(candidate(name, 105, { valuationBaseline: baseline(105, changed) }), [last]).allowed, true, name);
});

test("newest admitted attempt beats older completed markers, including failures and incomplete reviews", async () => {
  const completed = { fingerprint: fingerprint("older-completed"), reviewedAt: at(3), valuationBaseline: baseline(100) };
  for (const outcome of ["failed", "incomplete"]) {
    const latest = admitted(`latest-${outcome}`, 110, 1, { outcome });
    reset([admitted("older-completed", 100, 3), latest]);
    assert.equal((await reserve(candidate(`jitter-${outcome}`, 110.01), { previousValuationReview: completed })).reason, "valuation_immaterial_change");
    assert.equal((await reserve(candidate(`return-${outcome}`, 100), { previousValuationReview: completed })).allowed, true,
      "An old completed baseline must not veto a material move from the latest admitted attempt.");
  }
  reset([admitted("older-admitted", 110, 3)]);
  const newerCompleted = { fingerprint: fingerprint("newer-completed"), reviewedAt: at(1), valuationBaseline: baseline(100) };
  assert.equal((await reserve(candidate("newest-marker-jitter", 100.01), { previousValuationReview: newerCompleted })).allowed, false);
  reset([admitted("same-time-newer-admission", 110, 1)]);
  assert.equal((await reserve(candidate("same-time-marker-jitter", 110.01), { previousValuationReview: newerCompleted })).allowed, false,
    "An equal-timestamp completed marker cannot supersede the latest durable admission.");
});

test("original exact hash lock precedes numerically material change", async () => {
  const prior = admitted("same-exact-hash");
  reset([prior]);
  const changed = candidate("same-exact-hash", 120);
  assert.equal(materiality.materiallyChangedValuation(prior.valuationBaseline, changed.valuationBaseline), true);
  assert.equal((await reserve(changed)).reason, "same_evidence");
  assert.deepEqual(rows(), [prior]);
  reset([admitted("same-exact-hash", 100, 12)]);
  assert.equal((await reserve(changed)).allowed, true, "The original exact-hash cooldown still expires at twelve hours.");
});

test("legacy missing, unsupported, and mismatched snapshots hold until their known expiry", async () => {
  for (const value of [undefined, { ...baseline(), version: 2 }, { ...baseline(), cik: otherCik }, { ...baseline(), price: "100" }]) {
    const prior = admitted("legacy", 100, 1, { valuationBaseline: value });
    reset([prior]);
    const rejected = await reserve(candidate("new-legacy-revision", 200));
    assert.equal(rejected.reason, "valuation_baseline_unknown");
    assert.equal(rejected.nextRetryAt, "2026-10-06T23:00:00.000Z");
    assert.deepEqual(rows(), [prior]);
    reset([{ ...prior, reservedAt: at(12) }]);
    assert.equal((await reserve(candidate("after-known-legacy-expiry", 200))).allowed, true);
  }
  reset([admitted("valid-prior")]);
  assert.equal((await reserve(candidate("unsupported-current", 200, { valuationBaseline: { ...baseline(200), version: 2 } }))).reason, "valuation_baseline_unknown");
});

test("unknown legacy times survive normalization and hold only their issuer", async () => {
  for (const reservedAt of [undefined, null, "not-a-timestamp"]) {
    const prior = admitted("unknown-time", 100, 1, { reservedAt, valuationBaseline: undefined });
    reset([prior]);
    assert.equal((await loadCommitteeBudgetState(now)).state.reservations.length, 1);
    const rejected = await reserve(candidate("same-issuer-material-looking", 200));
    assert.equal(rejected.reason, "valuation_baseline_unknown");
    assert.equal(rejected.nextRetryAt, null);
    const unrelated = candidate("other-issuer", 100, { candidateFingerprint: fingerprint("other-issuer", otherCik), valuationBaseline: baseline(100, { cik: otherCik }) });
    assert.equal((await reserve(unrelated)).allowed, true);
    assert.deepEqual(rows()[0], persisted(prior), "Unrelated admissions must retain old unknown-time evidence exactly.");
  }
  const old = admitted("legacy-state-only", 100, 1, { reservedAt: undefined, valuationBaseline: undefined });
  reset(); objects.delete(committeeKey);
  put(stateKey, { version: 1, updatedAt: at(1), committeeReservations: [old], runs: [], providerReservations: [], lease: null });
  assert.equal((await reserve(candidate("legacy-fallback", 200))).reason, "valuation_baseline_unknown");
  assert.equal(objects.has(committeeKey), false, "Denied legacy fallback must not fabricate migrated evidence.");
});

test("legacy direction changes pass once without an opposite hold hiding recent same-direction admissions", async () => {
  const opposite = admitted("old-downside", 100, 1, {
    reservedAt: undefined, candidateFingerprint: fingerprint("old-downside", cik, "downside"), direction: "downside", valuationBaseline: undefined,
  });
  reset([opposite]);
  assert.equal((await reserve(candidate("new-upside"))).allowed, true);
  assert.equal((await reserve(candidate("new-upside-penny", 100.01))).reason, "valuation_immaterial_change");
  assert.deepEqual(rows()[0], persisted(opposite));
  reset([opposite, admitted("newest-upside", 100, 1)]);
  assert.equal((await reserve(candidate("upside-jitter", 100.01))).allowed, false);
  assert.equal((await reserve(candidate("old-downside", 200, {
    candidateFingerprint: opposite.candidateFingerprint, direction: "downside",
  }))).reason, "same_evidence", "Direction transitions never override an existing exact hash.");
  reset([{ ...opposite, candidateFingerprint: `valuation:${cik}:legacy-unparsed-revision` }, admitted("known-upside", 100, 1)]);
  assert.equal((await reserve(candidate("unparsed-legacy-hold", 200))).reason, "valuation_baseline_unknown",
    "Unparsed legacy direction is not proof of a genuine direction change.");
});

test("ETag collision rechecks latest baseline and admits at most one tiny different fingerprint", async () => {
  for (const initiallyAbsent of [false, true]) {
    reset();
    if (initiallyAbsent) objects.delete(committeeKey);
    synchronizeNextReads(committeeKey, 2);
    const results = await Promise.all([reserve(candidate("race-a", 100)), reserve(candidate("race-b", 100.01))]);
    assert.equal(results.filter(result => result.allowed).length, 1);
    assert.equal(results.find(result => !result.allowed).reason, "valuation_immaterial_change");
    assert.equal(rows().length, 1);
    assert.ok(operations.some(operation => operation.kind === "conflict" && operation.key === committeeKey), "The test must exercise a real create-only/ETag conflict.");
  }
});

test("twenty dated reviews remain a rolling daily limit for source and valuation paths", async () => {
  const prior = Array.from({ length: 20 }, (_, index) => admitted(`source-${index}`, 100, 23 - index,
    { candidateFingerprint: `source-evidence-${index}`, valuationBaseline: undefined }));
  reset(prior);
  const sourceCandidate = candidate("source", 100, { candidateFingerprint: "sec:new-filing", valuationBaseline: undefined });
  for (const next of [sourceCandidate, candidate("different-issuer", 100, {
    candidateFingerprint: fingerprint("different-issuer", otherCik), valuationBaseline: baseline(100, { cik: otherCik }),
  })]) {
    const denied = await reserve(next);
    assert.equal(denied.reason, "daily_review_limit");
    assert.equal(denied.nextRetryAt, "2026-10-06T13:00:00.000Z");
  }
  reset(prior.slice(1));
  assert.equal((await reserve(sourceCandidate)).allowed, true);
  assert.equal((await reserve({ ...sourceCandidate, candidateFingerprint: "sec:twenty-first" })).reason, "daily_review_limit");
  reset([{ ...prior[0], reservedAt: at(24) }, ...prior.slice(1)]);
  assert.equal((await reserve(sourceCandidate)).allowed, true, "A count reservation expires exactly at 24 hours.");
});

test("unknown valuation timestamps do not globally suppress genuine source events", async () => {
  const unknown = Array.from({ length: 25 }, (_, index) => admitted(`unknown-${index}`, 100, 1, { reservedAt: undefined, valuationBaseline: undefined }));
  reset(unknown);
  const sourceCandidate = candidate("genuine", 100, { candidateFingerprint: "sec:exact-issuer-new-filing", valuationBaseline: undefined });
  assert.equal((await reserve(sourceCandidate)).allowed, true);
  assert.deepEqual(rows().slice(0, unknown.length), persisted(unknown));
  assert.equal((await reserve(sourceCandidate)).reason, "same_evidence", "The genuine-source exact-evidence lock remains intact.");
  const otherSource = { ...sourceCandidate, candidateFingerprint: "sec:another-filing" };
  assert.equal((await reserve(otherSource, { previousValuationReview: { fingerprint: fingerprint("unknown"), reviewedAt: null } })).allowed, true);
});

test("storage failures and exhausted CAS retries fail closed", async () => {
  reset(); readFailure = committeeKey;
  await assert.rejects(reserve(candidate("read-failure")), /test_storage_read_failure/);
  assert.equal(rows().length, 0);
  reset(); writeFailure = committeeKey;
  await assert.rejects(reserve(candidate("write-failure")), /test_storage_write_failure/);
  assert.equal(rows().length, 0);
  reset(); silentFailure = committeeKey;
  await assert.rejects(reserve(candidate("silent-write-failure")), /pr262_committee_reservation_write_failed/);
  assert.equal(rows().length, 0);
  reset(); objects.get(committeeKey).rawText = "{malformed";
  await assert.rejects(reserve(candidate("invalid-json")), SyntaxError);
  assert.equal(rows().length, 0);
  reset(); forcedConflicts = 3;
  assert.equal((await reserve(candidate("cas-failure"))).reason, "reservation_conflict");
  assert.equal(rows().length, 0);
  assert.equal(operations.filter(operation => operation.kind === "write" && operation.key === committeeKey).length, 3);
  reset(); forcedConflicts = 2;
  assert.equal((await reserve(candidate("cas-recovered"))).allowed, true);
  assert.equal(rows().length, 1);
});

test("lost, expired, and unreadable leases fail closed without count writes", async () => {
  for (const fault of ["wrong-owner", "wrong-event", "expired", "unreadable"]) {
    reset();
    const lease = objects.get(leaseKey).value.lease;
    if (fault === "wrong-owner") lease.ownerId = "new-owner";
    if (fault === "wrong-event") lease.eventId = "new-event";
    if (fault === "expired") lease.expiresAt = now.toISOString();
    if (fault === "unreadable") readFailure = leaseKey;
    assert.equal((await reserve(candidate(fault))).reason, "lease_unavailable", fault);
    assert.equal(rows().length, 0);
    assert.equal(operations.filter(operation => operation.kind === "write" && operation.key === committeeKey).length, 0);
  }
});

const rejectionReport = (reservation, roleDiagnostics, responsesWithUsage = 0) => ({
  candidateFingerprint: reservation.candidateFingerprint, openAiCalled: true,
  committee: { output: { modelUsageSummary: { roleDiagnostics, actualOpenAiUsage: { responsesWithUsage } } } },
});
const rejectedRole = { agentId: "analyst_agent", status: "failed", usageReported: false, providerFailure: { httpStatus: 429, category: "quota" } };
test("only proven all-rejected-without-usage requests release their own baseline", async () => {
  const current = { eventId, reservedAt: now.toISOString(), ...candidate("release-current") };
  const otherEvent = { ...current, eventId: "different-event" };
  const otherFingerprint = { ...current, candidateFingerprint: fingerprint("different-fingerprint") };
  const untouched = [otherEvent, otherFingerprint];
  reset([current, ...untouched]);
  await releaseRejectedCommitteeCall(eventId, rejectionReport(current, [rejectedRole, { status: "blocked" }]), now);
  assert.deepEqual(rows(), untouched, "Release matches both event ID and exact fingerprint.");
  reset([current]);
  await releaseRejectedCommitteeCall(eventId, rejectionReport(current, [{ status: "failed", usageReported: false, error: "prompt_too_large" }, { status: "planned" }]), now);
  assert.equal(rows().length, 0);
  for (const [name, roles, responses] of [
    ["some-usage", [rejectedRole], 1],
    ["timeout", [{ status: "failed", usageReported: false, providerFailure: { category: "timeout" } }], 0],
    ["mixed-rejected-unknown", [rejectedRole, { status: "failed", usageReported: false }], 0],
    ["no-role-proof", [], 0],
    ["blocked-only", [{ status: "blocked" }], 0],
    ["missing-aggregate", [rejectedRole], undefined],
  ]) {
    reset([current]);
    const report = rejectionReport(current, roles, responses);
    if (name === "missing-aggregate") delete report.committee.output.modelUsageSummary.actualOpenAiUsage.responsesWithUsage;
    await releaseRejectedCommitteeCall(eventId, report, now);
    assert.deepEqual(rows(), [current], `${name}: usage or unknown exposure must keep its admitted baseline.`);
  }
  reset([current]); forcedConflicts = 3;
  await assert.rejects(releaseRejectedCommitteeCall(eventId, rejectionReport(current, [rejectedRole]), now), /pr262_rejected_committee_release_failed/);
  assert.deepEqual(rows(), [current], "Failed release cannot erase the baseline.");
});

function seedCostLedger() {
  const charge = { id: "old-real-charge", recordedAt: at(1), ticker: "OLD", alertType: "buy", costUsd: 0.027, source: "actual_tokens" };
  const pending = { id: "old-unknown-usage", recordedAt: at(1), ticker: "OLD", alertType: "buy", costUsd: 0.02,
    source: "usage_pending", pendingUpperBoundUsd: 0.136, retryAt: at(-23) };
  const hold = { id: "old-small-hold", reservedAt: at(1), expiresAt: at(-23), ticker: "OLD", direction: "upside", amountUsd: 0.156 };
  put(costKey, { version: 1, updatedAt: now.toISOString(), entries: [charge, pending], reservations: [hold],
    auditEntries: [charge, pending], auditTrackingStartedAt: at(1) });
  return { charge, pending, hold };
}

test("input-limit hold and unreadable hold stop the actual callback before money or count changes", async () => {
  reset([admitted("existing-paid")]); seedCostLedger();
  const beforeCount = snapshot(committeeKey), beforeCost = snapshot(costKey);
  let moneyCalls = 0;
  const wrapped = callback({ input: { beforeOpenAiCall: async () => { moneyCalls++; return true; } } });
  inputLimitHeld = true;
  assert.equal(await wrapped.beforeOpenAiCall(candidate("oversized")), false);
  assert.equal(wrapped.status().committeeBlockedReason, "unchanged_prompt_input_limit");
  assert.equal(moneyCalls, 0);
  assert.deepEqual(snapshot(committeeKey), beforeCount);
  assert.deepEqual(snapshot(costKey), beforeCost);
  inputLimitHeld = false; inputLimitReadFailure = true;
  await assert.rejects(wrapped.beforeOpenAiCall(candidate("unreadable")), /test_input_hold_read_failure/);
  assert.equal(moneyCalls, 0);
  assert.deepEqual(snapshot(committeeKey), beforeCount);
  assert.deepEqual(snapshot(costKey), beforeCost);
});

test("real callback preflight denies duplicates before money and preserves old charges/holds", async () => {
  reset([admitted("already-paid")]);
  seedCostLedger();
  const beforeCost = snapshot(costKey);
  let moneyCalls = 0;
  const wrapped = callback({ input: { beforeOpenAiCall: async reservation => {
    moneyCalls += 1;
    return (await dollars.reservePr262AiCommitteeBudget(reservation, now)).allowed;
  } } });
  assert.equal(await wrapped.beforeOpenAiCall(candidate("ordinary-penny", 100.01)), false);
  assert.equal(wrapped.status().committeeBlockedReason, "valuation_immaterial_change");
  assert.equal(moneyCalls, 0);
  assert.deepEqual(snapshot(costKey), beforeCost);
  assert.equal(operations.filter(operation => operation.key === costKey).length, 0);
  reset(); seedCostLedger(); readFailure = committeeKey;
  await assert.rejects(wrapped.beforeOpenAiCall(candidate("preflight-storage-failure")), /test_storage_read_failure/);
  assert.equal(moneyCalls, 0, "Unreadable preflight cannot touch money or call a model.");
});

test("real callback reserves money before count, rechecks races, and releases only proven no-call dollars", async () => {
  reset();
  const old = seedCostLedger();
  const loser = candidate("paid-race-loser", 100.01);
  let winner;
  let moneyCalls = 0;
  const wrapped = callback({ input: { beforeOpenAiCall: async reservation => {
    moneyCalls += 1;
    const money = await dollars.reservePr262AiCommitteeBudget(reservation, now);
    assert.equal(money.allowed, true);
    assert.equal(rows().length, 0, "Count reservation must still follow the real dollar fuse.");
    winner = await reserve(candidate("paid-race-winner", 100));
    return true;
  } } });
  const allowed = await wrapped.beforeOpenAiCall(loser);
  assert.equal(winner.allowed, true);
  assert.equal(allowed, false, "Actual count reservation must recheck a baseline admitted after preflight.");
  assert.equal(wrapped.status().committeeBlockedReason, "valuation_immaterial_change");
  assert.equal(moneyCalls, 1);
  assert.equal(rows().length, 1);
  assert.ok(objects.get(costKey).value.reservations.some(row => row.id === loser.candidateFingerprint));
  const writes = operations.filter(operation => operation.kind === "write").map(operation => operation.key);
  assert.ok(writes.indexOf(costKey) < writes.indexOf(committeeKey));
  // This is the same proven-no-call condition used by the orchestrator. Do not
  // release a hold merely because an error or an incomplete report occurred.
  const report = { openAiCalled: false, candidateFingerprint: loser.candidateFingerprint };
  assert.equal((await dollars.recordPr262AiCommitteeCost(report, now)).reason, "openai_not_called");
  assert.equal((await dollars.releasePr262AiCommitteeBudgetReservation(report.candidateFingerprint, now)).released, true);
  const ledger = objects.get(costKey).value;
  assert.deepEqual(ledger.entries, [old.charge, old.pending]);
  assert.deepEqual(ledger.reservations, [old.hold]);
  assert.equal(ledger.entries.some(row => row.id === loser.candidateFingerprint), false, "A denied duplicate must not manufacture a charge.");
  const status = await dollars.getPr262AiDailyBudgetStatus(now);
  assert.equal(status.spentUsd, 0.047);
  assert.equal(status.pendingUsageUpperBoundUsd, 0.136);
  assert.equal(status.reservedUsd, 0.156);
});

test("real dollar fuse denies before count and lease loss after money cannot authorize a call", async () => {
  reset();
  const old = seedCostLedger();
  objects.get(costKey).value.entries[0].costUsd = 10;
  let moneyDecision;
  const full = callback({ input: { beforeOpenAiCall: async reservation => {
    moneyDecision = await dollars.reservePr262AiCommitteeBudget(reservation, now);
    return moneyDecision.allowed;
  }, aiReservationBlockedReason: () => moneyDecision.reason } });
  assert.equal(await full.beforeOpenAiCall(candidate("actual-full-fuse")), false);
  assert.equal(full.status().committeeBlockedReason, "daily_cost_fuse");
  assert.equal(rows().length, 0);
  assert.deepEqual(objects.get(costKey).value.reservations, [old.hold]);

  reset(); seedCostLedger();
  const afterLeaseLoss = candidate("lease-lost-after-money");
  const lost = callback({ input: { beforeOpenAiCall: async reservation => {
    const money = await dollars.reservePr262AiCommitteeBudget(reservation, now);
    assert.equal(money.allowed, true);
    objects.get(leaseKey).value.lease.ownerId = "replacement-owner";
    return true;
  } } });
  assert.equal(await lost.beforeOpenAiCall(afterLeaseLoss), false);
  assert.equal(lost.status().committeeBlockedReason, "lease_unavailable");
  assert.equal(rows().length, 0);
  assert.ok(objects.get(costKey).value.reservations.some(row => row.id === afterLeaseLoss.candidateFingerprint),
    "The admission function cannot silently erase a dollar hold; proven-no-call reconciliation owns release.");
});

test("unknown provider usage preserves the admitted baseline and full remaining dollar exposure", async () => {
  reset();
  const old = seedCostLedger();
  const next = candidate("unknown-provider-outcome");
  const wrapped = callback({ input: { beforeOpenAiCall: async reservation =>
    (await dollars.reservePr262AiCommitteeBudget(reservation, now)).allowed } });
  assert.equal(await wrapped.beforeOpenAiCall(next), true);
  const report = rejectionReport(next, [{ status: "failed", usageReported: false, providerFailure: { category: "timeout" } }]);
  report.checkedAt = now.toISOString();
  report.selectedCandidate = { ticker: "LOCAL" };
  const countBefore = snapshot(committeeKey);
  await releaseRejectedCommitteeCall(eventId, report, now);
  assert.deepEqual(snapshot(committeeKey), countBefore);
  const recorded = await dollars.recordPr262AiCommitteeCost(report, now);
  assert.equal(recorded.entry.source, "usage_pending");
  assert.equal(recorded.entry.costUsd, 0);
  assert.equal(recorded.entry.pendingUpperBoundUsd, dollars.PR262_REVIEW_MAX_COST_USD);
  const ledger = objects.get(costKey).value;
  assert.deepEqual(ledger.entries.slice(0, 2), [old.charge, old.pending]);
  assert.deepEqual(ledger.reservations, [old.hold]);
  assert.equal(rows()[0].candidateFingerprint, next.candidateFingerprint);
  assert.equal((await reserve(candidate("unknown-outcome-penny", 100.01))).reason, "valuation_immaterial_change");
});

test("money denial and source events retain original wrapper ordering", async () => {
  reset();
  const wrapped = callback({ input: { beforeOpenAiCall: async () => false,
    aiReservationRetryAt: () => at(-2), aiReservationBlockedReason: () => "daily_cost_fuse" } });
  assert.equal(await wrapped.beforeOpenAiCall(candidate("dollar-denied")), false);
  assert.equal(wrapped.status().committeeBlockedReason, "daily_cost_fuse");
  assert.equal(rows().length, 0);
  assert.equal(operations.filter(operation => operation.kind === "write").length, 0);
  reset();
  let moneyCalls = 0;
  const sourceCallback = callback({ valuationReview: false, input: { beforeOpenAiCall: async () => { moneyCalls += 1; return true; } } });
  assert.equal(await sourceCallback.beforeOpenAiCall(candidate("source-path", 100, { candidateFingerprint: "sec:genuine-source", valuationBaseline: undefined })), true);
  assert.equal(moneyCalls, 1);
  assert.equal(operations.filter(operation => operation.kind === "read" && operation.key === committeeKey).length, 1,
    "The genuine-source path retains its original post-money count reservation, with no valuation preflight.");
});

const originalLimit = process.env.SWING_UP_PR262_AI_DAILY_LIMIT_USD;
let failures = 0;
try {
  process.env.SWING_UP_PR262_AI_DAILY_LIMIT_USD = "10";
  for (const { name, run } of tests) {
    try { await run(); console.log(`PASS ${name}`); }
    catch (error) { failures += 1; console.error(`FAIL ${name}\n${error.stack ?? error}`); }
  }
} finally {
  if (originalLimit === undefined) delete process.env.SWING_UP_PR262_AI_DAILY_LIMIT_USD;
  else process.env.SWING_UP_PR262_AI_DAILY_LIMIT_USD = originalLimit;
}
assert.equal(failures, 0, `${failures} durable valuation admission scenario(s) failed.`);
console.log(`Valuation review admission smoke passed (${tests.length} deterministic scenarios; no network/model calls).`);
