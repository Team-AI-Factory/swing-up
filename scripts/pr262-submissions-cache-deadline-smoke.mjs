import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";

// Entirely synthetic: production storage is replaced before module evaluation,
// global fetch and DNS are blocked, and no real provider request is permitted.
const deadline = loadTsModule("@/lib/opportunity-engine/pr262-submissions-deadline");
const { decodePr262SourcePreparationProvenance } = loadTsModule("@/lib/opportunity-engine/pr262-source-failure-provenance");
const cohort = JSON.parse(readFileSync(new URL("../config/simple-alert-pilot.json", import.meta.url))).companies;
const company = cohort[0];
const lateRemainingMs = 740;
const stageMinimum = phase => ["before_reservation", "reservation_read"].includes(phase)
  ? deadline.PR262_SEC_RESERVATION_MIN_MS : deadline.PR262_SEC_SOURCE_MIN_MS;
const base = Date.parse("2026-10-15T07:00:00.000Z");
const prefix = "branch-labs/simple-alerts/cohorts/synthetic-deadline-test/";
const budgetKey = `${prefix}sensor/provider-budgets-v1.json`;
const registryKey = `${prefix}sensor/direct-company-feeds-v1.json`;
const cacheKey = issuer => `${prefix}sensor/submissions-cache/${issuer.cik}.json`;
const root = issuer => `https://data.sec.gov/submissions/CIK${issuer.cik}.json`;
const bodyFor = issuer => ({ cik: Number(issuer.cik), tickers: [issuer.ticker], filings: {
  recent: { accessionNumber: [], form: [], filingDate: [], primaryDocument: [] }, files: [],
} });
const absent = { found: false, text: null, etag: null };
const acknowledgement = { written: true, conflict: false, etag: '"acknowledged"' };
const original = { Date: globalThis.Date, fetch: globalThis.fetch, warn: console.warn,
  performanceNow: Object.getOwnPropertyDescriptor(performance, "now"),
  directFeeds: process.env.SWING_UP_PR262_DIRECT_FEEDS_JSON };
let wall = base, monotonic = 0, networkEscapes = 0;
const diagnostics = [];
const advance = milliseconds => { wall += milliseconds; monotonic += milliseconds; };
class FakeDate extends original.Date {
  constructor(...args) { super(...(args.length ? args : [wall])); }
  static now() { return Math.trunc(wall); }
}
const common = {
  "@/lib/simple-alert-pilot-runtime": { isSimpleAlertPilot: () => true },
  "@/lib/simple-alert-pilot-scope": { pilotCompanies: () => cohort },
  "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: relative => prefix + relative },
  "@/config/simple-alert-issuer-sources.json": { companies: [] },
  "node:dns/promises": { lookup: async () => { networkEscapes++; throw new Error("Synthetic suite forbids DNS"); } },
  "node:timers/promises": { setTimeout: async milliseconds => { advance(milliseconds); } },
};

function completeResponse(issuer = company, { text = JSON.stringify(bodyFor(issuer)), onDone = () => {}, headers = {}, status = 200 } = {}) {
  const response = new Response(text, { status, headers });
  // Model the exact EOF boundary deterministically, including an abort that
  // arrives with the final read. The returned source response is still real.
  response.clone = () => {
    let reads = 0;
    return { body: { getReader: () => ({ read: async () => {
      if (reads++ === 0) return { done: false, value: new TextEncoder().encode(text) };
      onDone(); return { done: true, value: undefined };
    }, cancel: async () => {} }) } };
  };
  return response;
}

async function fixture(options = {}) {
  const documents = new Map(options.documents ?? []);
  const calls = { reads: [], writes: [], network: [] };
  const storage = {
    readVersionedTextFromR2: async (key, request = {}) => {
      assert.ok(key.startsWith(prefix), `Unexpected storage namespace: ${key}`);
      calls.reads.push({ key, request });
      const overridden = await options.read?.(key, request, calls);
      if (overridden !== undefined) return overridden;
      const saved = documents.get(key);
      return saved ? { found: true, text: JSON.stringify(saved.value), etag: saved.etag } : { ...absent };
    },
    writeVersionedJsonToR2: async (key, value, request = {}) => {
      assert.ok(key.startsWith(prefix), `Unexpected storage namespace: ${key}`);
      const cloned = structuredClone(value);
      calls.writes.push({ key, value: cloned, request });
      const result = await options.write?.(key, cloned, request, calls) ?? { ...acknowledgement };
      if (result.written && !result.conflict) documents.set(key, { value: cloned, etag: result.etag });
      return result;
    },
  };
  const overrides = { ...common, "@/lib/r2-warehouse": storage };
  const budgetModule = loadTsModule("@/lib/opportunity-engine/pr262-sensor-fetch-budget", overrides);
  const guarded = await budgetModule.createPr262SensorBudgetedFetch({ now: new Date(), signal: options.signal,
    persistenceSignal: options.persistenceSignal, fetchImpl: async (request, init) => {
      calls.network.push({ request: String(request), init });
      assert.equal(deadline.pr262SubmissionsRemainingMs(init), null, "Private deadline metadata must be stripped before provider fetch");
      assert.ok(!Object.getOwnPropertySymbols(init).includes(Symbol.for("swingup.pr262.submissions-request-budget.v1")));
      return options.fetch ? options.fetch(request, init, calls) : completeResponse();
    } });
  return { guarded, calls, documents, overrides,
    request: (init = {}, remainingMs = 10_000, issuer = company) => guarded.fetchImpl(root(issuer),
      deadline.withPr262SubmissionsDeadline(init, wall + remainingMs)) };
}
const writesOf = (fixture, key) => fixture.calls.writes.filter(row => row.key === key);
const readsOf = (fixture, key) => fixture.calls.reads.filter(row => row.key === key);
const snapshotCounts = (outcome, count = 1) => ({ saved: 0, deferred: 0, conflict: 0, failed: 0, [outcome]: count });
let passed = 0;
async function test(name, run) {
  wall = base; monotonic = 0; diagnostics.length = 0;
  try { await run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { error.message = `${name}: ${error.message}`; throw error; }
}
async function expectDeferred(f, phase, request = () => f.request()) {
  await assert.rejects(request, error => {
    assert.equal(error.message, "direct_source_collection_deadline");
    assert.equal(error.sourceNetworkAttempted, false);
    return true;
  });
  assert.equal(f.calls.network.length, 0);
  const row = f.guarded.summary().preparationDiagnostics.at(-1);
  assert.equal(row.phase, phase);
  assert.equal(row.outcome, "deferred_before_network");
  assert.ok(row.remainingAtAdmissionMs < stageMinimum(phase));
}
function registryEntry(issuer, checkedAgoMs) {
  const earlier = new Date(base - checkedAgoMs).toISOString();
  return { ticker: issuer.ticker, company: issuer.company, cik: issuer.cik, investorWebsite: null, feedUrl: null,
    discoveredAt: earlier, lastDiscoveryAt: earlier, lastCheckedAt: null, lastSuccessAt: null,
    nextCheckAt: null, error: null, consecutiveFailures: 0,
    sec: { sourceUrl: root(issuer), lastCheckedAt: earlier, lastSuccessAt: earlier,
      snapshotFetchedAt: earlier, snapshotOrigin: "network", snapshotPersistence: "saved",
      nextCheckAt: new Date(base - 1000).toISOString(), error: null } };
}
function registryWith(entries) {
  return { version: 1, updatedAt: new Date().toISOString(), discoveryCursor: 0,
    lastDiscoveryCycleAt: new Date().toISOString(), entries };
}

try {
  globalThis.Date = FakeDate;
  Object.defineProperty(performance, "now", { configurable: true, value: () => monotonic });
  globalThis.fetch = async () => { networkEscapes++; throw new Error("Synthetic suite forbids real network"); };
  console.warn = (...args) => diagnostics.push(args.join(" "));
  delete process.env.SWING_UP_PR262_DIRECT_FEEDS_JSON;

  await test("private metadata survives spread and is stripped without changing caller init", async () => {
    assert.equal(deadline.PR262_SEC_REQUEST_MAX_MS, 10_000);
    assert.equal(deadline.PR262_SEC_ADMISSION_MIN_MS, 4_000);
    assert.equal(deadline.PR262_SEC_RESERVATION_MIN_MS, 3_000);
    assert.equal(deadline.PR262_SEC_SOURCE_MIN_MS, 2_000);
    assert.equal(deadline.PR262_SEC_CACHE_WRITE_MIN_MS, 1_000);
    const controller = new AbortController(), other = Symbol("caller metadata");
    const init = deadline.withPr262SubmissionsDeadline({ headers: { accept: "application/json" }, signal: controller.signal, [other]: 7 }, wall + 50_000);
    assert.equal(deadline.pr262SubmissionsRemainingMs(init), 10_000, "Caller cannot extend the 10-second request maximum");
    advance(123);
    const spread = { ...init, cache: "no-store" };
    assert.equal(deadline.pr262SubmissionsRemainingMs(spread), 9877);
    const clean = deadline.withoutPr262SubmissionsDeadline(spread);
    assert.equal(deadline.pr262SubmissionsRemainingMs(clean), null);
    assert.equal(clean[other], 7); assert.equal(clean.signal, controller.signal);
    assert.equal(clean.headers, init.headers); assert.equal(clean.cache, "no-store");
    assert.equal(deadline.pr262SubmissionsRemainingMs(init), 9877);
    assert.equal(deadline.withoutPr262SubmissionsDeadline(undefined), undefined);
    const f = await fixture();
    await f.guarded.fetchImpl(root(company), spread);
    assert.equal(f.calls.network.length, 1);
    assert.equal(f.calls.network[0].init[other], 7);
  });

  await test("wall and monotonic clock drift fail closed", async () => {
    const init = deadline.withPr262SubmissionsDeadline({}, wall + 10_000);
    wall -= 60_000; monotonic += 9000;
    assert.equal(deadline.pr262SubmissionsRemainingMs(init), 1000, "Backward wall drift must not extend monotonic duration");
    monotonic += 1000;
    assert.equal(deadline.pr262SubmissionsRemainingMs(init), 0);
    wall = base + 10_001; monotonic = 0;
    assert.equal(deadline.pr262SubmissionsRemainingMs(init), 0, "Forward wall drift closes admission");
    wall = base; monotonic = -1;
    assert.equal(deadline.pr262SubmissionsRemainingMs(init), 0, "Backward monotonic movement fails closed");
    monotonic = NaN; assert.equal(deadline.pr262SubmissionsRemainingMs(init), 0);
    monotonic = 0; wall = NaN; assert.equal(deadline.pr262SubmissionsRemainingMs(init), 0);
    wall = base;
    for (const end of [wall, wall - 1, NaN]) assert.equal(deadline.pr262SubmissionsRemainingMs(deadline.withPr262SubmissionsDeadline({}, end)), 0);
  });

  for (const phase of ["before_reservation", "reservation_write", "before_network"]) {
    await test(`deadline rechecked at ${phase}; late reservation stays charged`, async () => {
      const f = await fixture({
        read: (key, _request, calls) => {
          if ((phase === "before_reservation" && key === cacheKey(company))
            || (phase === "reservation_write" && key === budgetKey && calls.reads.filter(row => row.key === budgetKey).length === 2)) advance(deadline.PR262_SEC_REQUEST_MAX_MS - stageMinimum(phase) + 1);
        },
        write: key => { if (phase === "before_network" && key === budgetKey) advance(deadline.PR262_SEC_REQUEST_MAX_MS - stageMinimum(phase) + 1); },
      });
      await expectDeferred(f, phase);
      assert.equal(writesOf(f, cacheKey(company)).length, 0);
      assert.equal(writesOf(f, budgetKey).length, phase === "before_network" ? 1 : 0);
      assert.equal(readsOf(f, budgetKey).length, phase === "before_reservation" ? 1 : 2);
      if (phase === "before_network") {
        const ledger = f.documents.get(budgetKey).value;
        assert.equal(Object.values(ledger.hourlyCounts.sensor_sec_submissions).reduce((a, b) => a + b, 0), 1);
        assert.equal(ledger.lastCadenceAt[`sensor_sec_submission:/submissions/cik${company.cik}.json`], new Date(base).toISOString());
        await f.guarded.flush();
        assert.equal(writesOf(f, budgetKey).length, 1, "No refund or blind ledger rewrite after late reservation settlement");
      }
    });
  }

  await test("already-short budget and clock drift cannot start a reservation", async () => {
    for (const drift of ["short", "wall", "monotonic"]) {
      wall = base; monotonic = 0;
      const f = await fixture();
      const init = deadline.withPr262SubmissionsDeadline({}, wall + (drift === "short" ? deadline.PR262_SEC_RESERVATION_MIN_MS - 1 : 10_000));
      if (drift === "wall") wall += 10_001 - deadline.PR262_SEC_RESERVATION_MIN_MS;
      if (drift === "monotonic") { wall -= 60_000; monotonic += 10_001 - deadline.PR262_SEC_RESERVATION_MIN_MS; }
      await expectDeferred(f, "before_reservation", () => f.guarded.fetchImpl(root(company), init));
      assert.equal(f.calls.writes.length, 0);
    }
  });

  await test("time queued behind a reservation is rechecked before the next ledger read", async () => {
    let releaseFirst, firstStarted;
    const entered = new Promise(resolve => { firstStarted = resolve; });
    const held = new Promise(resolve => { releaseFirst = resolve; });
    const f = await fixture({ write: async key => { if (key === budgetKey) { firstStarted(); await held; } } });
    const first = f.request().then(() => assert.fail("Late first reservation must not fetch"), error => error);
    await entered;
    const second = f.request({}, 10_000, cohort[1]).then(() => assert.fail("Queued request must not fetch"), error => error);
    // Drain the finite cache-read microtasks so the second request has joined
    // reservationTail, without real sleeps or a second storage operation.
    for (let index = 0; index < 12; index++) await Promise.resolve();
    assert.equal(readsOf(f, cacheKey(cohort[1])).length, 1);
    advance(10_001 - deadline.PR262_SEC_SOURCE_MIN_MS); releaseFirst();
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a.message, "direct_source_collection_deadline");
    assert.equal(b.message, "direct_source_collection_deadline");
    assert.equal(a.sourceNetworkAttempted, false); assert.equal(b.sourceNetworkAttempted, false);
    assert.equal(f.calls.network.length, 0);
    assert.equal(readsOf(f, budgetKey).length, 2, "Only initial load and the first reservation read");
    assert.equal(writesOf(f, budgetKey).length, 1);
    assert.deepEqual(f.guarded.summary().preparationDiagnostics.map(row => row.phase), ["before_network", "reservation_read"]);
  });

  for (const aborted of [false, true]) await test(`complete late body is deferred with its original fetchedAt (aborted=${aborted})`, async () => {
    const controller = new AbortController();
    const f = await fixture({ fetch: () => completeResponse(company, { onDone: () => {
      advance(10_000 - lateRemainingMs); if (aborted) controller.abort(new Error("source window expired at EOF"));
    } }) });
    const response = await f.request({ signal: controller.signal });
    const fetchedAt = new Date(base + 10_000 - lateRemainingMs).toISOString();
    advance(123);
    assert.deepEqual(await response.json(), bodyFor(company));
    assert.equal(response.headers.get("x-swingup-submissions-fetched-at"), fetchedAt);
    assert.equal(response.headers.get("x-swingup-submissions-cache-persistence"), "deferred");
    assert.equal(response.headers.get("x-swingup-submissions-cache-write-failed"), null);
    assert.equal(f.calls.network.length, 1); assert.equal(f.calls.writes.length, 1);
    assert.equal(writesOf(f, cacheKey(company)).length, 0);
    assert.deepEqual(f.guarded.summary().snapshotPersistence, snapshotCounts("deferred"));
    const row = f.guarded.summary().preparationDiagnostics.at(-1);
    assert.equal(row.remainingAtAdmissionMs, lateRemainingMs); assert.equal(row.remainingAtOutcomeMs, lateRemainingMs);
    assert.equal(row.totalElapsedMs, 10_000 - lateRemainingMs); assert.equal(row.persistenceElapsedMs, 0);
    assert.equal(row.requestSignalAborted, aborted);
    assert.equal(row.abortSource, aborted ? "request_signal" : "none");
    assert.equal(row.abortReasonMatched, false, "Intentional deferral must not invent a caught exception");
  });

  for (const outcome of ["saved", "conflict", "missing_ack", "blank_ack", "unacknowledged", "write_failure"]) {
    await test(`snapshot outcome ${outcome} is truthful, with one conditional PUT only`, async () => {
      let capturedTimestamp;
      const f = await fixture({ documents: [[cacheKey(company), { etag: '"old"', value: {
        version: 1, cik: company.cik, sourceUrl: root(company), fetchedAt: new Date(base - 2 * 3600_000).toISOString(), body: JSON.stringify(bodyFor(company)),
      } }]], write: (key, value) => {
        if (key !== cacheKey(company)) return;
        capturedTimestamp = value.fetchedAt; advance(321);
        if (outcome === "conflict") return { written: false, conflict: true, etag: '"winner"' };
        if (outcome === "missing_ack") return { written: true, conflict: false, etag: null };
        if (outcome === "blank_ack") return { written: true, conflict: false, etag: "  " };
        if (outcome === "unacknowledged") return { written: false, conflict: false, etag: null };
        if (outcome === "write_failure") throw Object.assign(new Error("synthetic storage write failed"), { storageDomain: "r2_state", storageOperation: "write" });
      } });
      const response = await f.request();
      const expected = ["saved", "conflict"].includes(outcome) ? outcome : "failed";
      assert.equal(response.status, 200); assert.deepEqual(await response.json(), bodyFor(company));
      assert.equal(response.headers.get("x-swingup-submissions-cache-persistence"), expected);
      assert.equal(response.headers.get("x-swingup-submissions-fetched-at"), capturedTimestamp);
      assert.equal(capturedTimestamp, new Date(base).toISOString(), "Saving cannot refresh source observation time");
      assert.deepEqual(f.guarded.summary().snapshotPersistence, snapshotCounts(expected));
      assert.equal(f.calls.network.length, 1); assert.equal(f.calls.reads.length, 3);
      assert.equal(f.calls.writes.length, 2, "Exactly one reservation and one snapshot PUT, no retry or diagnostic I/O");
      const put = writesOf(f, cacheKey(company))[0];
      assert.equal(put.request.expectedEtag, '"old"'); assert.equal(put.request.createOnly, undefined);
      if (expected === "failed") {
        assert.equal(response.headers.get("x-swingup-submissions-cache-write-failed"), "true");
        const detail = decodePr262SourcePreparationProvenance(response.headers.get("x-swingup-submissions-cache-failure-detail"));
        assert.match(detail, /stage=submissions_snapshot_persistence/);
        assert.match(detail, outcome === "write_failure" ? /storage_boundary=r2_write;error=Error;message=synthetic storage write failed/ : /message=submissions_snapshot_persistence_unconfirmed/);
      } else assert.equal(response.headers.get("x-swingup-submissions-cache-write-failed"), null);
    });
  }

  for (const remaining of [deadline.PR262_SEC_CACHE_WRITE_MIN_MS - 1, deadline.PR262_SEC_CACHE_WRITE_MIN_MS]) await test(`optional PUT admission floor is exact (${remaining}ms)`, async () => {
    const f = await fixture({ fetch: () => completeResponse(company, { onDone: () => advance(10_000 - remaining) }) });
    const response = await f.request();
    assert.equal(response.headers.get("x-swingup-submissions-cache-persistence"), remaining < deadline.PR262_SEC_CACHE_WRITE_MIN_MS ? "deferred" : "saved");
    assert.equal(writesOf(f, cacheKey(company)).length, remaining < deadline.PR262_SEC_CACHE_WRITE_MIN_MS ? 0 : 1);
    if (remaining === deadline.PR262_SEC_CACHE_WRITE_MIN_MS) assert.equal(writesOf(f, cacheKey(company))[0].request.createOnly, true);
  });

  for (const source of ["request_signal", "cycle_signal"]) for (const exactCause of [false, true]) {
    await test(`diagnostic abort attribution uses identity through causes (${source}, exact=${exactCause})`, async () => {
      const controller = new AbortController();
      const reason = new DOMException("same timeout text", "TimeoutError");
      const independent = new DOMException(reason.message, reason.name);
      const thrown = Object.assign(new Error(reason.message, { cause: new Error("nested storage error", { cause: exactCause ? reason : independent }) }),
        { name: reason.name, storageDomain: "r2_state", storageOperation: "write" });
      const f = await fixture({ signal: source === "cycle_signal" ? controller.signal : undefined,
        write: key => { if (key === cacheKey(company)) { advance(400); controller.abort(reason); throw thrown; } } });
      const response = await f.request(source === "request_signal" ? { signal: controller.signal } : {});
      assert.equal(response.status, 200);
      const row = f.guarded.summary().preparationDiagnostics.at(-1);
      assert.equal(row.phase, "submissions_snapshot_persistence"); assert.equal(row.outcome, "failed");
      assert.equal(row.abortSource, source); assert.equal(row.abortReasonMatched, exactCause);
      assert.equal(row.requestSignalAborted, source === "request_signal");
      assert.equal(row.cycleSignalAborted, source === "cycle_signal");
      assert.equal(row.persistenceSignalAborted, false); assert.equal(row.totalElapsedMs, 400);
      assert.equal(row.persistenceElapsedMs, 400); assert.equal(row.remainingAtAdmissionMs, 10_000); assert.equal(row.remainingAtOutcomeMs, 9600);
      assert.equal(f.calls.reads.length, 3); assert.equal(f.calls.writes.length, 2); assert.equal(f.calls.network.length, 1);
    });
  }

  for (const source of ["request_signal", "cycle_signal"]) for (const exactCause of [false, true]) {
    await test(`failed snapshot read retains original error and exact abort provenance (${source}, exact=${exactCause})`, async () => {
      const controller = new AbortController();
      const reason = new DOMException("same read timeout text", "TimeoutError");
      const independent = new DOMException(reason.message, reason.name);
      const thrown = Object.assign(new Error("private read failure https://private.invalid/?token=not-for-diagnostics", {
        cause: new Error("nested read failure", { cause: exactCause ? reason : independent }),
      }), { name: "TimeoutError", storageDomain: "r2_state", storageOperation: "read" });
      const f = await fixture({ signal: source === "cycle_signal" ? controller.signal : undefined,
        read: key => { if (key === cacheKey(company)) { advance(142); controller.abort(reason); throw thrown; } } });
      await assert.rejects(() => f.request(source === "request_signal" ? { signal: controller.signal } : {}), error => {
        assert.equal(error.cause, thrown); assert.equal(error.message, thrown.message); assert.equal(error.name, thrown.name);
        assert.equal(error.sourcePreparationStage, "submissions_snapshot_read");
        assert.equal(error.storageDomain, "r2_state"); assert.equal(error.storageOperation, "read");
        assert.equal(error.storageContext, "submissions_snapshot"); assert.equal(error.sourceNetworkAttempted, false);
        return true;
      });
      assert.equal(f.calls.network.length, 0); assert.equal(f.calls.writes.length, 0);
      assert.equal(f.calls.reads.length, 2, "Only initial budget load and one cache read; no retry or diagnostic I/O");
      assert.equal(readsOf(f, budgetKey).length, 1); assert.equal(readsOf(f, cacheKey(company)).length, 1);
      const rows = f.guarded.summary().preparationDiagnostics;
      assert.equal(rows.length, 1);
      const row = rows[0];
      assert.equal(row.ticker, company.ticker); assert.equal(row.phase, "submissions_snapshot_read");
      assert.equal(row.outcome, "failed_before_network"); assert.equal(row.phaseElapsedMs, 142);
      assert.equal(row.remainingAtAdmissionMs, null); assert.equal(row.totalElapsedMs, 142); assert.equal(row.persistenceElapsedMs, null);
      assert.equal(row.remainingAtPhaseStartMs, 10_000); assert.equal(row.remainingAtOutcomeMs, 9858);
      assert.equal(row.abortSource, source); assert.equal(row.abortReasonMatched, exactCause);
      assert.equal(row.requestSignalAborted, source === "request_signal");
      assert.equal(row.cycleSignalAborted, source === "cycle_signal"); assert.equal(row.persistenceSignalAborted, false);
      assert.equal(diagnostics.length, 1);
      assert.ok(!JSON.stringify(row).includes("private.invalid") && !diagnostics[0].includes("not-for-diagnostics"),
        "Controlled phase diagnostics must not log raw error text or private URLs");
    });
  }

  await test("snapshot-read R2 diagnostics expose only validated, bounded fields", async () => {
    const valid = { responsePhase: "response_body", readDurationMs: 142, requestDurationMs: 141,
      requestTimeoutMs: 45_000, requestAbortSource: "caller", abortReasonMatched: true,
      privateUrl: "https://private.invalid/?token=not-for-diagnostics", extra: "not-for-diagnostics" };
    const malformed = { responsePhase: valid.privateUrl, readDurationMs: -1, requestDurationMs: "142",
      requestTimeoutMs: Infinity, requestAbortSource: "not-for-diagnostics", abortReasonMatched: "true", extra: valid.extra };
    for (const supplied of [valid, undefined, null, "not-for-diagnostics", [], malformed,
      { ...malformed, readDurationMs: 1.5, requestDurationMs: NaN, requestTimeoutMs: Number.MAX_SAFE_INTEGER + 1 }]) {
      const controller = new AbortController(), reason = new Error("cache read cancelled");
      const thrown = Object.assign(new Error(valid.privateUrl, { cause: reason }), {
        storageDomain: "r2_state", storageOperation: "read", storageReadDiagnostics: supplied,
      });
      const f = await fixture({ read: key => {
        if (key === cacheKey(company)) { advance(142); controller.abort(reason); throw thrown; }
      } });
      const warningsBefore = diagnostics.length;
      await assert.rejects(() => f.request({ signal: controller.signal }), error => error.cause === thrown);
      const row = f.guarded.summary().preparationDiagnostics[0];
      const projected = Object.fromEntries(Object.entries(row).filter(([key]) => key.startsWith("r2")));
      assert.deepEqual(projected, supplied === valid ? {
        r2ResponsePhase: "response_body", r2ReadDurationMs: 142, r2RequestDurationMs: 141,
        r2RequestTimeoutMs: 45_000, r2RequestAbortSource: "caller", r2AbortReasonMatched: true,
      } : { r2ResponsePhase: "unknown", r2ReadDurationMs: null, r2RequestDurationMs: null,
        r2RequestTimeoutMs: null, r2RequestAbortSource: "unknown", r2AbortReasonMatched: false });
      assert.ok(!JSON.stringify(row).includes("not-for-diagnostics") && !diagnostics.at(-1).includes("private.invalid"));
      assert.equal(diagnostics.length, warningsBefore + 1); assert.equal(f.calls.reads.length, 2);
      assert.equal(f.calls.writes.length, 0); assert.equal(f.calls.network.length, 0);
    }
  });

  await test("profile independent persistence keeps cache-read error and skips sensor-only diagnostics", async () => {
    const work = new AbortController(), persistence = new AbortController(), reason = new Error("profile cache read cancelled");
    const thrown = Object.assign(new Error("profile read failure", { cause: reason }), { storageDomain: "r2_state", storageOperation: "read" });
    const f = await fixture({ signal: work.signal, persistenceSignal: persistence.signal,
      read: key => { if (key === cacheKey(company)) { advance(142); work.abort(reason); throw thrown; } } });
    await assert.rejects(() => f.request(), error => error.cause === thrown && error.sourceNetworkAttempted === false);
    assert.deepEqual(f.guarded.summary().preparationDiagnostics, []); assert.equal(diagnostics.length, 0);
    assert.equal(f.calls.reads.length, 2); assert.equal(f.calls.writes.length, 0); assert.equal(f.calls.network.length, 0);
    assert.equal(persistence.signal.aborted, false);
  });

  await test("snapshot-read failure diagnostics stay bounded without retries or provider work", async () => {
    let activeController, activeCause;
    const f = await fixture({ read: key => {
      if (key !== cacheKey(company)) return;
      advance(1); activeController.abort(activeCause); throw activeCause;
    } });
    for (let index = 0; index < 27; index++) {
      activeController = new AbortController(); activeCause = new Error(`synthetic cache read ${index}`);
      await assert.rejects(() => f.request({ signal: activeController.signal }), error => error.cause === activeCause);
    }
    const rows = f.guarded.summary().preparationDiagnostics;
    assert.equal(rows.length, 25); assert.equal(diagnostics.length, 27, "One diagnostic per failed read, never a retry");
    assert.ok(rows.every(row => row.phase === "submissions_snapshot_read" && row.outcome === "failed_before_network"
      && row.phaseElapsedMs === 1 && row.abortSource === "request_signal" && row.abortReasonMatched));
    assert.equal(readsOf(f, budgetKey).length, 1); assert.equal(readsOf(f, cacheKey(company)).length, 27);
    assert.equal(f.calls.writes.length, 0); assert.equal(f.calls.network.length, 0);
  });

  for (const variant of ["non_200", "malformed_json", "wrong_issuer", "partial_body"]) {
    await test(`spoofed persistence/failure headers cannot exempt ${variant} from abort`, async () => {
      const controller = new AbortController(), reason = new Error("actual request abort");
      const text = variant === "malformed_json" ? "{" : variant === "wrong_issuer" ? JSON.stringify(bodyFor(cohort[1]))
        : variant === "partial_body" ? JSON.stringify({ cik: Number(company.cik), tickers: [company.ticker] }) : JSON.stringify(bodyFor(company));
      const f = await fixture({ fetch: () => {
        const response = completeResponse(company, { text, status: variant === "non_200" ? 503 : 200,
          headers: { "x-swingup-submissions-cache-write-failed": "true", "x-swingup-submissions-cache-persistence": "deferred" },
          onDone: () => controller.abort(reason) });
        if (variant === "non_200") controller.abort(reason);
        return response;
      } });
      await assert.rejects(() => f.request({ signal: controller.signal }), error => {
        assert.equal(error.cause, reason); assert.equal(error.sourceNetworkAttempted, true); return true;
      });
      assert.equal(writesOf(f, cacheKey(company)).length, 0);
      assert.deepEqual(f.guarded.summary().snapshotPersistence, { saved: 0, deferred: 0, conflict: 0, failed: 0 });
    });
  }

  await test("valid cache hit bypasses reservation and retains its observation timestamp", async () => {
    const fetchedAt = new Date(base - 60_000).toISOString();
    const f = await fixture({ documents: [[cacheKey(company), { etag: '"cached"', value: {
      version: 1, cik: company.cik, sourceUrl: root(company), fetchedAt, body: JSON.stringify(bodyFor(company)),
    } }]] });
    const response = await f.request({}, 1);
    assert.equal(response.headers.get("x-swingup-submissions-cache"), "hit");
    assert.equal(response.headers.get("x-swingup-submissions-fetched-at"), fetchedAt);
    assert.deepEqual(await response.json(), bodyFor(company));
    assert.equal(f.calls.network.length, 0); assert.equal(f.calls.writes.length, 0);
    assert.equal(readsOf(f, budgetKey).length, 1);
    assert.deepEqual(f.guarded.summary().snapshotPersistence, { saved: 0, deferred: 0, conflict: 0, failed: 0 });
  });

  await test("legacy callers without metadata retain snapshot publication", async () => {
    const f = await fixture({ fetch: () => completeResponse(company, { onDone: () => advance(30_000) }) });
    const response = await f.guarded.fetchImpl(root(company), { headers: { accept: "application/json" } });
    assert.equal(response.headers.get("x-swingup-submissions-cache-persistence"), "saved");
    assert.equal(f.calls.network.length, 1); assert.equal(f.calls.writes.length, 2);
  });

  for (const metadata of [false, true]) for (const writeFails of [false, true]) {
    await test(`complete body after save-time abort preserves compatibility (metadata=${metadata}, failure=${writeFails})`, async () => {
      const controller = new AbortController(), reason = new Error("aborted while saving snapshot");
      const f = await fixture({ write: key => {
        if (key === cacheKey(company)) { controller.abort(reason); if (writeFails) throw reason; }
      } });
      const run = () => metadata ? f.request({ signal: controller.signal })
        : f.guarded.fetchImpl(root(company), { signal: controller.signal });
      if (!metadata && !writeFails) await assert.rejects(run, error => {
        assert.equal(error.cause, reason); assert.equal(error.sourceNetworkAttempted, true); return true;
      });
      else {
        const response = await run();
        assert.deepEqual(await response.json(), bodyFor(company));
        assert.equal(response.headers.get("x-swingup-submissions-cache-persistence"), writeFails ? "failed" : "saved");
      }
      assert.equal(f.calls.network.length, 1); assert.equal(f.calls.writes.length, 2);
    });
  }

  await test("uncacheable provider metadata cannot certify a private snapshot outcome", async () => {
    const f = await fixture({ fetch: () => completeResponse(company, { text: "{}", headers: {
      "x-swingup-submissions-cache-persistence": "saved",
    } }) });
    const response = await f.request();
    assert.equal(response.headers.get("x-swingup-submissions-cache-persistence"), null);
    assert.equal(writesOf(f, cacheKey(company)).length, 0);
    assert.deepEqual(f.guarded.summary().snapshotPersistence, { saved: 0, deferred: 0, conflict: 0, failed: 0 });
  });

  for (const failure of [false, true]) await test(`profile independent persistence signal bypasses new policy (failure=${failure})`, async () => {
    const work = new AbortController(), persistence = new AbortController();
    const cause = Object.assign(new Error("profile persistence fault"), { storageDomain: "r2_state", storageOperation: "write" });
    const f = await fixture({ signal: work.signal, persistenceSignal: persistence.signal,
      fetch: () => completeResponse(company, { onDone: () => advance(20_000) }),
      write: (key, _value, options) => {
        assert.equal(options.signal, persistence.signal);
        if (key === cacheKey(company) && failure) throw cause;
      } });
    if (failure) await assert.rejects(() => f.request({}, 1), error => {
      assert.equal(error.cause, cause); assert.equal(error.sourcePreparationStage, "submissions_snapshot_persistence"); return true;
    });
    else assert.equal((await f.request({}, 1)).headers.get("x-swingup-submissions-cache-persistence"), "saved");
    assert.equal(f.calls.network.length, 1); assert.equal(f.calls.writes.length, 2);
    assert.deepEqual(f.guarded.summary().snapshotPersistence, { saved: 0, deferred: 0, conflict: 0, failed: 0 });
  });

  await test("profile complete body still rejects its original work-signal cancellation", async () => {
    const work = new AbortController(), persistence = new AbortController(), reason = new Error("profile work expired");
    const f = await fixture({ signal: work.signal, persistenceSignal: persistence.signal,
      fetch: () => completeResponse(company, { onDone: () => work.abort(reason) }) });
    await assert.rejects(() => f.request(), error => { assert.equal(error.cause, reason); return true; });
    assert.equal(f.calls.network.length, 1); assert.equal(writesOf(f, cacheKey(company)).length, 0);
    assert.equal(persistence.signal.aborted, false);
  });

  await test("full direct chain keeps deferred-cache SEC success and persists truth without touching the pending queue", async () => {
    const issuers = cohort.slice(0, 3), entries = issuers.map((issuer, index) => registryEntry(issuer, (index + 1) * 3600_000));
    const f = await fixture({ documents: [[registryKey, { etag: '"registry"', value: registryWith(entries) }]],
      fetch: request => {
        assert.equal(String(request), root(issuers[2]), "Oldest due issuer must be selected first");
        return completeResponse(issuers[2], { onDone: () => advance(9000 - lateRemainingMs) });
      }, write: key => { if (key === registryKey) advance(500); } });
    const direct = loadTsModule("@/lib/opportunity-engine/pr262-direct-announcements", f.overrides);
    const result = await direct.runPr262DirectAnnouncementMonitor({ exposure: issuers, now: new Date(), deadlineAtMs: wall + 14_000, fetchImpl: f.guarded.fetchImpl });
    assert.equal(f.calls.network.length, 1); assert.equal(writesOf(f, budgetKey).length, 1);
    assert.equal(f.calls.network[0].init.headers.Accept, "application/json");
    assert.equal(writesOf(f, cacheKey(issuers[2])).length, 0);
    assert.equal(result.attemptCount, 1); assert.equal(result.successCount, 1); assert.equal(result.failureCount, 0);
    assert.equal(result.secCheckAttempts, 1); assert.equal(result.secCheckSuccesses, 1); assert.equal(result.secCheckFailures, 0);
    assert.equal(result.secCheckDeferred, 2); assert.equal(result.secSubmissionsChecked, 1);
    assert.equal(result.sourcePreparationFailures, 0); assert.deepEqual(result.preparationErrors, []);
    assert.deepEqual(result.attemptErrors, []); assert.deepEqual(result.secSnapshotPersistence, snapshotCounts("deferred"));
    assert.equal(result.registryPersistence.written, true); assert.equal(result.registryPersistence.telemetryBasis, "persisted_registry");
    assert.equal(writesOf(f, registryKey).length, 1); assert.equal(writesOf(f, registryKey)[0].request.expectedEtag, '"registry"');
    assert.equal(writesOf(f, registryKey)[0].request.signal.aborted, false);
    assert.equal(result.directWorkBudgetMs, 9000, "The caller's 5-second registry reserve is unchanged");
    const saved = f.documents.get(registryKey).value;
    for (const untouched of entries.slice(0, 2)) assert.deepEqual(saved.entries.find(row => row.ticker === untouched.ticker), untouched,
      "Unstarted SEC rows must not acquire synthetic checks, errors, cooldowns, or a new queue position");
    const updated = saved.entries.find(row => row.ticker === issuers[2].ticker).sec;
    assert.equal(updated.snapshotPersistence, "deferred"); assert.equal(updated.snapshotOrigin, "network"); assert.equal(updated.error, null);
    assert.equal(updated.lastCheckedAt, new Date(base).toISOString());
    assert.equal(updated.snapshotFetchedAt, new Date(base + 9000 - lateRemainingMs).toISOString());
    assert.equal(updated.lastSuccessAt, updated.snapshotFetchedAt);
    assert.equal(updated.nextCheckAt, new Date(base + 9000 - lateRemainingMs + 29 * 60_000).toISOString());
    const coverage = result.issuerSourceCoverage.find(row => row.ticker === issuers[2].ticker).sec;
    assert.equal(coverage.status, "current_snapshot"); assert.equal(coverage.snapshotPersistence, "deferred");
    assert.equal(coverage.snapshotFetchedAt, updated.snapshotFetchedAt);
    assert.deepEqual(saved.entries.filter(row => row.sec.nextCheckAt <= new Date().toISOString()).sort((a, b) => Date.parse(a.sec.lastCheckedAt) - Date.parse(b.sec.lastCheckedAt)).map(row => row.ticker), [issuers[1].ticker, issuers[0].ticker]);
  });

  for (const sourceWindow of [142, deadline.PR262_SEC_ADMISSION_MIN_MS - 1, deadline.PR262_SEC_ADMISSION_MIN_MS]) await test(`direct SEC admission includes pacing and preserves 5-second registry reserve (${sourceWindow})`, async () => {
    const issuers = cohort.slice(0, 2), entries = issuers.map((issuer, index) => registryEntry(issuer, (2 - index) * 3600_000));
    const f = await fixture({ documents: [[registryKey, { etag: '"registry"', value: registryWith(entries) }]] });
    const direct = loadTsModule("@/lib/opportunity-engine/pr262-direct-announcements", f.overrides);
    const result = await direct.runPr262DirectAnnouncementMonitor({ exposure: issuers, now: new Date(), deadlineAtMs: wall + sourceWindow + 5000, fetchImpl: f.guarded.fetchImpl });
    assert.equal(result.secCheckAttempts, sourceWindow < deadline.PR262_SEC_ADMISSION_MIN_MS ? 0 : 1);
    assert.equal(result.secCheckDeferred, sourceWindow < deadline.PR262_SEC_ADMISSION_MIN_MS ? 2 : 1,
      "After a quick first request, a second complete admission slice also requires the 1-second pacing gap");
    assert.equal(f.calls.network.length, sourceWindow < deadline.PR262_SEC_ADMISSION_MIN_MS ? 0 : 1);
    assert.equal(result.directWorkBudgetMs, sourceWindow);
    assert.equal(result.registryPersistence.written, true);
    if (sourceWindow === 142) {
      assert.equal(result.failureCount, 0); assert.equal(result.sourcePreparationFailures, 0);
      assert.equal(f.calls.reads.filter(row => row.key.includes("submissions-cache")).length, 0,
        "142ms cannot admit even the optional cache-read stage");
      assert.equal(readsOf(f, budgetKey).length, 1, "Only fixture initialization, no reservation read");
      assert.equal(writesOf(f, budgetKey).length, 0);
      assert.deepEqual(f.documents.get(registryKey).value.entries, entries,
        "Near-expired loop leaves every unstarted issuer untouched");
    }
  });

  await test("full direct chain retains the 10-second request and 42-second SEC maximums", async () => {
    const issuers = cohort.slice(0, 10), entries = issuers.map((issuer, index) => registryEntry(issuer, (20 - index) * 3600_000));
    const f = await fixture({ documents: [[registryKey, { etag: '\"registry\"', value: registryWith(entries) }]],
      fetch: (request, _init, calls) => {
        const issuer = issuers.find(row => root(row) === String(request));
        assert.ok(issuer);
        return completeResponse(issuer, { onDone: () => advance(calls.network.length < 5 ? 10_000 - lateRemainingMs : 42_000 - 4 * (10_000 - lateRemainingMs) - lateRemainingMs) });
      } });
    const observedBudgets = [];
    const direct = loadTsModule("@/lib/opportunity-engine/pr262-direct-announcements", f.overrides);
    const result = await direct.runPr262DirectAnnouncementMonitor({ exposure: issuers, now: new Date(), deadlineAtMs: wall + 80_000,
      fetchImpl: (request, init) => {
        observedBudgets.push(deadline.pr262SubmissionsRemainingMs(init));
        return f.guarded.fetchImpl(request, init);
      } });
    assert.deepEqual(observedBudgets, [10_000, 10_000, 10_000, 10_000, 42_000 - 4 * (10_000 - lateRemainingMs)],
      "SEC retains its 42-second envelope even when the caller supplies a longer source window");
    assert.equal(result.directWorkBudgetMs, 55_000, "Caller source envelope is still capped at 60 seconds minus 5-second reserve");
    assert.equal(result.secCheckAttempts, 5); assert.equal(result.secCheckSuccesses, 5);
    assert.equal(result.secCheckDeferred, 5); assert.equal(result.failureCount, 0);
    assert.equal(result.sourcePreparationFailures, 0); assert.equal(result.registryPersistence.written, true);
    assert.equal(f.calls.network.length, 5); assert.equal(writesOf(f, budgetKey).length, 5);
    assert.equal(f.calls.writes.filter(row => row.key.includes("submissions-cache")).length, 0);
  });

  await test("staged admission preserves all 13 SEC slots in the slow 3104.375ms fixture", async () => {
    const issuers = cohort.slice(0, 25), entries = issuers.map((issuer, index) => registryEntry(issuer, (30 - index) * 3600_000));
    const f = await fixture({ documents: [[registryKey, { etag: '\"registry\"', value: registryWith(entries) }]],
      fetch: request => {
        const issuer = issuers.find(row => root(row) === String(request));
        assert.ok(issuer);
        return completeResponse(issuer, { onDone: () => advance(3104.375) });
      } });
    const direct = loadTsModule("@/lib/opportunity-engine/pr262-direct-announcements", f.overrides);
    const result = await direct.runPr262DirectAnnouncementMonitor({ exposure: issuers, now: new Date(), deadlineAtMs: wall + 60_000, fetchImpl: f.guarded.fetchImpl });
    assert.equal(f.calls.network.length, 13); assert.equal(result.secCheckAttempts, 13); assert.equal(result.secCheckSuccesses, 13);
    assert.equal(result.failureCount, 0); assert.equal(result.sourcePreparationFailures, 0);
    assert.deepEqual(result.secSnapshotPersistence, snapshotCounts("saved", 13));
    assert.equal(writesOf(f, budgetKey).length, 13); assert.equal(result.registryPersistence.written, true);
    assert.equal(monotonic, 13 * 3104.375);
  });

  assert.equal(networkEscapes, 0, "No real network/DNS request may escape the synthetic boundaries");
} finally {
  globalThis.Date = original.Date; globalThis.fetch = original.fetch; console.warn = original.warn;
  if (original.performanceNow) Object.defineProperty(performance, "now", original.performanceNow);
  else delete performance.now;
  if (original.directFeeds === undefined) delete process.env.SWING_UP_PR262_DIRECT_FEEDS_JSON;
  else process.env.SWING_UP_PR262_DIRECT_FEEDS_JSON = original.directFeeds;
}
assert.equal(globalThis.Date, original.Date); assert.equal(globalThis.fetch, original.fetch); assert.equal(console.warn, original.warn);
assert.equal(process.env.SWING_UP_PR262_DIRECT_FEEDS_JSON, original.directFeeds);
assert.deepEqual(Object.getOwnPropertyDescriptor(performance, "now"), original.performanceNow);
console.log(`Sensor submissions cache deadline: ${passed} focused synthetic cases passed; clocks, network guards, logging and environment restored.`);
