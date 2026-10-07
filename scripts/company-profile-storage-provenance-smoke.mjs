import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";

// Use the actual cache and builder with deterministic, conditional in-memory
// storage. Source-cache faults must not become source failures or successes.
const stamp = "2026-10-04T05:27:17.443Z";
const NativeDate = globalThis.Date;
const info = console.info, savedRole = process.env.SWING_UP_SIMPLE_PILOT_ROLE;
const profileKey = "research-evidence/company-profiles-v1.json";
const identity = { ticker: "TEST", company: "Test Software", cik: "0000000001" };
const other = { ticker: "OTHER", company: "Other Software", cik: "0000000002" };
const listing = row => ({ ...row, name: row.company, exchange: "Nasdaq", securityType: "common_stock", sourceNames: ["SEC company_tickers_exchange"] });
const clone = value => JSON.parse(JSON.stringify(value));
const observations = [];
globalThis.Date = class extends NativeDate {
  constructor(...args) { super(...(args.length ? args : [stamp])); }
  static now() { return NativeDate.parse(stamp); }
};
process.env.SWING_UP_SIMPLE_PILOT_ROLE = "profiles";

function storageError(operation, kind = "http") {
  const cause = kind === "transport" ? new TypeError("fetch failed")
    : kind === "timeout" ? new DOMException("Storage read timed out", "TimeoutError")
      : new Error(`r2_state_${operation}_http_502`);
  return Object.assign(new Error(cause.message, { cause }), {
    name: cause.name, storageDomain: "r2_state", storageOperation: operation,
  });
}

async function run({ mode, operation, kind, applied = false, catchWrite = "success", sharedWriter = false, coincidentDeadline = false, exactRoleCancellation = false }) {
  const now = new Date(), fixture = companyProfileFixture(identity, now);
  const objects = new Map(), revisions = new Map(), writes = [], logs = [], waits = [];
  let sourceReads = 0, sourceWrites = 0, sourceRequests = 0, profileWrites = 0, profileFaults = 0, insertedOther = false;
  let sourceStorageError, sourceStorageCause, forwardedError;
  const controller = new AbortController(), originalTimeout = AbortSignal.timeout;
  if (coincidentDeadline || exactRoleCancellation) AbortSignal.timeout = ms => ms === 175_000 ? controller.signal : originalTimeout(ms);
  const failSourceStorage = () => {
    if (coincidentDeadline || exactRoleCancellation) controller.abort(new DOMException("Role time window ended", "TimeoutError"));
    sourceStorageError = exactRoleCancellation
      ? Object.assign(new Error(controller.signal.reason.message, { cause: controller.signal.reason }), { name: controller.signal.reason.name, storageDomain: "r2_state", storageOperation: operation })
      : storageError(operation, kind);
    sourceStorageCause = sourceStorageError.cause;
    throw sourceStorageError;
  };
  const getOwn = () => objects.get(profileKey)?.entries.find(row => row.cik === identity.cik);
  const save = (key, value) => { objects.set(key, clone(value)); revisions.set(key, (revisions.get(key) ?? 0) + 1); };
  const isSource = key => key.startsWith("research-evidence/company-profile-sources/");
  if (sharedWriter) save(profileKey, { version: 1, entries: [{ ...other, profile: null,
    updatedAt: "2026-10-03T05:27:17.443Z", nextAttemptAt: "2026-10-05T05:27:17.443Z" }] });
  const insertOther = () => {
    if (!sharedWriter || insertedOther) return;
    insertedOther = true;
    save(profileKey, { ...objects.get(profileKey), entries: [
      ...objects.get(profileKey).entries.filter(row => row.cik !== other.cik),
      { ...other, profile: companyProfileFixture(other, now), updatedAt: stamp, firstVerifiedAt: stamp,
        verificationHistoryKnown: true, nextAttemptAt: "2026-11-03T05:27:17.443Z" },
    ] });
  };
  const storage = {
    readVersionedTextFromR2: async (key, options = {}) => {
      options.signal?.throwIfAborted();
      if (isSource(key)) {
        sourceReads++;
        if (mode === "source_fault" && operation === "read") failSourceStorage();
      }
      const value = objects.get(key);
      return { found: value !== undefined, text: value === undefined ? null : JSON.stringify(value), etag: value === undefined ? null : String(revisions.get(key)) };
    },
    writeVersionedJsonToR2: async (key, value, options = {}) => {
      options.signal?.throwIfAborted();
      const currentRevision = revisions.get(key);
      if ((options.createOnly && objects.has(key)) || (options.expectedEtag && options.expectedEtag !== String(currentRevision))) return { written: false, conflict: true, etag: null };
      const commit = () => { save(key, value); return { written: true, conflict: false, etag: String(revisions.get(key)) }; };
      writes.push({ key, value: clone(value) });
      if (isSource(key)) {
        sourceWrites++;
        if (mode === "source_conflict") return { written: false, conflict: true, etag: null };
        if (mode === "source_fault" && operation === "write") {
          if (applied) commit();
          failSourceStorage();
        }
      }
      if (key === profileKey) {
        profileWrites++;
        const own = value.entries.find(row => row.cik === identity.cik);
        if (mode === "profile_fault" && own?.profile && (catchWrite === "persistent" || profileFaults === 0)) {
          profileFaults++;
          if (applied) commit();
          throw storageError("write");
        }
        if (mode === "source_fault" && own?.error && catchWrite !== "success") {
          if (catchWrite === "persistent") throw storageError("write");
          assert.equal(catchWrite, "applied_response_lost");
          commit(); throw storageError("write");
        }
        const result = commit();
        if (own?.profile || own?.error) insertOther();
        return result;
      }
      return commit();
    },
  };
  const overrides = {
    "@/lib/r2-warehouse": storage,
    "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => key },
    "@/lib/simple-alert-pilot-runtime": { isSimpleAlertPilot: () => true },
    "@/lib/simple-alert-pilot-scope": { pilotCompanies: () => [] },
    "node:timers/promises": { setTimeout: async (ms, value, options = {}) => { waits.push(ms); options.signal?.throwIfAborted(); return value; } },
    "@/lib/equity-signal/universe": { loadEquityUniverse: async () => ({ snapshot: { refreshedAt: stamp, entries: (sharedWriter ? [identity, other] : [identity]).map(listing) } }) },
    "@/lib/opportunity-engine/pr262-sensor-fetch-budget": { createPr262SensorBudgetedFetch: async input => ({ fetchImpl: mode === "budget_read_cancel" ? async () => failSourceStorage() : input.fetchImpl, flush: async () => {} }) },
  };
  const cache = loadTsModule("@/lib/opportunity-engine/company-profile-cache", overrides);
  const builder = loadTsModule("@/lib/simple-alert-profile-builder", { ...overrides, "@/lib/opportunity-engine/company-profile-cache": {
    ...cache, ensureCompanyProfile: async (...args) => {
      try { return await cache.ensureCompanyProfile(...args); }
      catch (error) { forwardedError = error; throw error; }
    },
  } });
  console.info = message => { if (message.startsWith("{")) logs.push(JSON.parse(message)); };
  let result;
  try { result = await builder.runSimpleAlertProfileBuilder(now, async url => {
    sourceRequests++;
    assert.ok(getOwn(), "The initial profile backoff precedes any source request");
    if (String(url).includes("submissions")) return Response.json({ cik: 1, tickers: ["TEST"], sicDescription: "Software", filings: { recent: {
      form: ["10-K"], filingDate: [fixture.sourceFiledAt], accessionNumber: ["0000000001-26-000001"], primaryDocument: ["annual.htm"],
    } } });
    if (mode === "source_transport") throw new TypeError("fetch failed");
    return new Response(`<h2>Item 1. Business</h2><p>${fixture.business}</p><p>${"The company maintains regional facilities and provides ongoing implementation support for its software. ".repeat(8)}</p><h3>Customers</h3><p>${fixture.customers}</p><h2>Item 1A. Risk Factors</h2>`);
  }); } finally { AbortSignal.timeout = originalTimeout; }
  assert.equal(result.attempted, 1);
  assert.equal(result.requests, sourceRequests);
  assert.equal(result.requestFailures, mode === "source_transport" ? 1 : 0);
  assert.equal(result.responseBodyFailures, 0);
  assert.equal(result.modelCalls, 0);
  if (mode === "source_fault" && catchWrite !== "persistent") {
    assert.strictEqual(forwardedError, sourceStorageError, "The builder receives the unchanged original storage Error");
    assert.equal(forwardedError.message, storageError(operation, kind).message);
    assert.equal(forwardedError.name, storageError(operation, kind).name);
    assert.strictEqual(forwardedError.cause, sourceStorageCause);
    assert.equal(forwardedError.storageDomain, "r2_state");
    assert.equal(forwardedError.storageOperation, operation);
  }
  const row = getOwn();
  const ownVerifiedWrites = writes.filter(write => write.key === profileKey && write.value.entries.some(item => item.cik === identity.cik && item.profile)).length;
  const sourceSaved = [...objects.keys()].some(isSource);
  const label = [mode, operation, kind, applied ? "applied" : "unapplied", catchWrite, sharedWriter ? "shared_writer" : "", coincidentDeadline ? "role_deadline" : "", exactRoleCancellation ? "exact_role_cancellation" : ""].filter(Boolean).join("/");
  observations.push({ label, status: result.status, failureCategory: result.failureCategory,
    storageFailureObserved: result.storageFailureObserved, verifiedThisRun: result.verifiedThisRun,
    newlyVerifiedThisRun: result.newlyVerifiedThisRun, newlyVerifiedToday: result.newlyVerifiedToday,
    requests: result.requests, requestFailures: result.requestFailures, responseBodyFailures: result.responseBodyFailures,
    sourceReads, sourceWrites, sourceSaved, profileWrites, ownVerifiedWrites,
    pendingReason: logs.find(log => log.status === "pending")?.reason ?? null, persistedError: row?.error ?? null });
  return { result, row, logs, profileWrites, ownVerifiedWrites, sourceReads, sourceWrites, sourceSaved, waits };
}

try {
  // The protected profile object recovers exact applied intent and a transient
  // unapplied PUT; a persistently unapplied PUT surfaces as storage failure.
  for (const applied of [false, true]) {
    const h = await run({ mode: "profile_fault", applied });
    assert.equal(h.result.ok, true);
    assert.equal(h.result.verifiedThisRun, 1);
    assert.equal(h.result.newlyVerifiedThisRun, 1);
    assert.equal(h.profileWrites, applied ? 3 : 4);
    assert.equal(h.row.firstVerifiedAt, stamp);
    assert.equal(h.row.verificationHistoryKnown, true);
    assert.equal(h.logs.some(log => log.status === "pending"), false);
  }
  const persistent = await run({ mode: "profile_fault", catchWrite: "persistent" });
  assert.equal(persistent.result.status, "failed");
  assert.equal(persistent.result.failureCategory, "storage");
  assert.equal(persistent.result.storageFailureObserved, true);
  assert.equal(persistent.result.newlyVerifiedThisRun, 0);
  assert.equal(persistent.profileWrites, 6);
  assert.equal(persistent.logs.some(log => log.status === "pending"), false);

  // Tagged source-cache R2 errors must reach the builder after storing backoff.
  // None reaches a verified profile PUT or invents a first-verification date.
  for (const operation of ["read", "write"]) for (const kind of ["http", "transport", "timeout"]) {
    for (const applied of operation === "write" ? [false, true] : [false]) {
      const h = await run({ mode: "source_fault", operation, kind, applied });
      assert.equal(h.result.ok, false);
      assert.equal(h.result.status, "failed");
      assert.equal(h.result.storageFailureObserved, true);
      assert.equal(h.result.failureCategory, "storage");
      assert.equal(h.result.failure, storageError(operation, kind).message, "The original storage cause remains visible");
      assert.equal(h.result.verifiedThisRun, 0);
      assert.equal(h.result.newlyVerifiedThisRun, 0);
      assert.equal(h.result.requests, operation === "read" ? 1 : 2);
      assert.equal(h.logs.find(log => log.status === "pending")?.phase, "annual_filing");
      assert.equal(h.logs.find(log => log.status === "pending")?.reason, `company_profile_storage_${operation}_failed`);
      assert.equal(h.result.pendingReasons[`company_profile_storage_${operation}_failed`], 1);
      assert.equal(h.result.pendingReasons.source_request_failed, undefined);
      assert.equal(h.profileWrites, 3);
      assert.equal(h.ownVerifiedWrites, 0);
      assert.equal(h.row.profile, null);
      assert.equal(h.row.firstVerifiedAt, undefined);
      assert.equal(h.row.nextAttemptAt, "2026-10-04T06:27:17.443Z", "The existing one-hour backoff persists");
      assert.equal(h.sourceSaved, operation === "write" && applied);
      assert.equal(h.sourceWrites, operation === "write" ? 1 : 0, "Source-cache operations do not inherit profile PUT retries");
    }
  }

  // A lost catch/store acknowledgment is protected; the original storage fault
  // must still fail the run after recovery. Exhausted catch/store also fails.
  for (const catchWrite of ["applied_response_lost", "persistent"]) {
    const h = await run({ mode: "source_fault", operation: "write", kind: "http", applied: true, catchWrite });
    assert.equal(h.ownVerifiedWrites, 0);
    assert.equal(h.result.verifiedThisRun, 0);
    assert.equal(h.result.newlyVerifiedThisRun, 0);
    assert.equal(h.result.status, "failed");
    assert.equal(h.result.storageFailureObserved, true);
    assert.equal(h.profileWrites, catchWrite === "persistent" ? 6 : 3);
    assert.equal(h.sourceWrites, 1);
  }

  // Preserve the existing deadline cleanup allowance and five-minute backoff,
  // without concealing a coincident, independently tagged R2 error as success.
  for (const operation of ["read", "write"]) {
    const h = await run({ mode: "source_fault", operation, kind: "http", coincidentDeadline: true });
    assert.equal(h.result.status, "failed");
    assert.equal(h.result.failureCategory, "storage");
    assert.equal(h.result.failure, `r2_state_${operation}_http_502`);
    assert.equal(h.row.nextAttemptAt, "2026-10-04T05:32:17.443Z");
    assert.equal(h.profileWrites, 3);
    assert.equal(h.ownVerifiedWrites, 0);
  }

  const budgetReadDeferred = await run({ mode: "budget_read_cancel", operation: "read", kind: "timeout", exactRoleCancellation: true });
  assert.equal(budgetReadDeferred.result.status, "time_budget_reached", "Exact role cancellation of a read-only provider budget read remains a normal deferral");
  assert.equal(budgetReadDeferred.result.failureCategory, null);
  assert.equal(budgetReadDeferred.result.storageFailureObserved, false);
  assert.equal(budgetReadDeferred.result.requestFailures, 0);
  assert.equal(budgetReadDeferred.result.requests, 0);
  assert.equal(budgetReadDeferred.row.error, "company_profile_time_budget_deferred");
  assert.equal(budgetReadDeferred.row.nextAttemptAt, "2026-10-04T05:32:17.443Z");
  assert.equal(budgetReadDeferred.profileWrites, 2, "Initial backoff and one bounded cleanup, without a retry");
  assert.equal(budgetReadDeferred.sourceWrites, 0);

  const sourceTransport = await run({ mode: "source_transport" });
  assert.equal(sourceTransport.result.status, "completed");
  assert.equal(sourceTransport.result.failureCategory, null);
  assert.equal(sourceTransport.result.storageFailureObserved, false);
  assert.equal(sourceTransport.result.pendingReasons.source_request_failed, 1);
  assert.equal(sourceTransport.result.requestFailures, 1);

  const conflict = await run({ mode: "source_conflict" });
  assert.equal(conflict.result.verifiedThisRun, 1, "A source-cache CAS conflict result is currently ignored");
  assert.equal(conflict.sourceSaved, false);

  // Shared-cache additions are window observations, not proven worker credit.
  // The unattempted issuer was deferred in the plan and is injected by a
  // separate mock writer; it is never fetched or acknowledged by this run.
  for (const mode of ["success", "source_fault"]) {
    const h = await run({ mode, operation: "write", kind: "http", sharedWriter: true });
    assert.equal(h.result.verifiedThisRun, mode === "success" ? 1 : 0);
    assert.equal(h.result.newlyVerifiedThisRun, mode === "success" ? 2 : 1);
    assert.equal(h.result.newlyVerifiedToday, mode === "success" ? 2 : 1);
    assert.equal(h.result.newlyVerifiedThisRun, h.result.verifiedThisRun + 1);
  }

  console.log(JSON.stringify({ note: "Source-cache storage faults fail truthfully after durable backoff; source transport remains separate. Shared-cache count deltas still do not establish this worker's authorship.", observations }, null, 2));
} finally {
  globalThis.Date = NativeDate;
  console.info = info;
  if (savedRole === undefined) delete process.env.SWING_UP_SIMPLE_PILOT_ROLE; else process.env.SWING_UP_SIMPLE_PILOT_ROLE = savedRole;
}
