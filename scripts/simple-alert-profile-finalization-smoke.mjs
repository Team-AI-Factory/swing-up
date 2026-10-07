import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";

// Real builder/cache with in-memory CAS and a deterministic clock. No source,
// R2 or model traffic. Timers retain distinct reason identities and deadlines.
const NativeDate = globalThis.Date, nativeTimeout = AbortSignal.timeout;
const savedRole = process.env.SWING_UP_SIMPLE_PILOT_ROLE, info = console.info;
const start = NativeDate.parse("2026-10-07T00:09:28.890Z");
const profileKey = "research-evidence/company-profiles-v1.json";
const identity = { ticker: "TEST", company: "Test Software", cik: "0000000001" };
const baseline = { ticker: "BASE", company: "Base Software", cik: "0000000002" };
const listing = row => ({ ...row, name: row.company, exchange: "Nasdaq", securityType: "common_stock", sourceNames: ["SEC company_tickers_exchange"] });
const clone = value => JSON.parse(JSON.stringify(value));
process.env.SWING_UP_SIMPLE_PILOT_ROLE = "profiles";

async function run(mode) {
  let elapsed = 0, admissionSignal, workSignal, persistenceSignal, countSignal, summarySignal;
  const timers = [], objects = new Map(), revisions = new Map(), writes = [], sourceStarts = [], printed = [];
  let countReads = 0, summaryReads = 0, summaryWrites = 0, cleanupWrites = 0;
  const advance = value => {
    assert.ok(value >= elapsed, "Clock never moves backward"); elapsed = value;
    for (const timer of timers) if (timer.at <= elapsed && !timer.controller.signal.aborted) timer.controller.abort(new DOMException(`Timer ${timer.duration} elapsed`, "TimeoutError"));
  };
  globalThis.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [start + elapsed])); }
    static now() { return start + elapsed; }
  };
  AbortSignal.timeout = duration => {
    const controller = new AbortController();
    timers.push({ controller, duration, at: elapsed + duration });
    if (duration === 100_000) admissionSignal = controller.signal;
    if (duration === 140_000) workSignal = controller.signal;
    if (duration === 160_000) persistenceSignal = controller.signal;
    if (duration === 175_000) countSignal = controller.signal;
    if (duration === 235_000) summarySignal = controller.signal;
    return controller.signal;
  };
  console.info = message => printed.push(message);
  const healthy = mode.startsWith("healthy_");
  const fullSource = mode.startsWith("uncertain_") || mode === "past_count_deadline" || (healthy && mode !== "healthy_admission_put");
  const now = new Date(), fixture = companyProfileFixture(identity, now);
  const baselineAt = new Date(now.getTime() - 1000);
  const save = (key, value) => { objects.set(key, clone(value)); revisions.set(key, (revisions.get(key) ?? 0) + 1); };
  save(profileKey, { version: 1, entries: [{ ...baseline, updatedAt: baselineAt.toISOString(), firstVerifiedAt: baselineAt.toISOString(),
    verificationHistoryKnown: true, profile: companyProfileFixture(baseline, baselineAt), nextAttemptAt: new Date(start + 86400000).toISOString() }] });
  const wrap = (operation, reason) => Object.assign(new Error(reason.message, { cause: reason }), { name: reason.name, storageDomain: "r2_state", storageOperation: operation });
  const storage = {
    readVersionedTextFromR2: async (key, options = {}) => {
      options.signal?.throwIfAborted();
      if (key === profileKey && options.signal === countSignal) {
        countReads++;
        if (mode === "late_admission_stop") {
          assert.equal(admissionSignal.aborted, true, "Late admission is stopped by its own reserve");
          assert.equal(workSignal.aborted, false, "Already-started work retains the original source cutoff");
        } else {
          assert.equal(workSignal.aborted, true, "Count read is available after work cancellation");
        }
        assert.equal(options.signal.aborted, false, "Count read has its own unexpired deadline");
        if (mode === "count_timeout") { advance(175_000); throw wrap("read", options.signal.reason); }
        if (mode === "count_missing") return { found: false, text: null, etag: null };
        if (mode === "count_malformed") return { found: true, text: '{"entries":"invalid"}', etag: "bad" };
        if (mode === "slow_summary") advance(174_999);
      }
      if (key.startsWith("pilot/profile-builder/") && options.signal === summarySignal) {
        summaryReads++;
        if (mode === "summary_read_timeout") { advance(235_000); throw wrap("read", options.signal.reason); }
        if (mode === "slow_summary") advance(194_999);
      }
      if (key.startsWith("research-evidence/company-profile-sources/") && !fullSource) {
        advance(140_000);
        throw wrap("read", workSignal.reason);
      }
      const value = objects.get(key);
      return { found: value !== undefined, text: value === undefined ? null : JSON.stringify(value), etag: value === undefined ? null : String(revisions.get(key)) };
    },
    writeVersionedJsonToR2: async (key, value, options = {}) => {
      options.signal?.throwIfAborted();
      assert.ok(options.createOnly || options.expectedEtag, "All writes remain conditional");
      const revision = revisions.get(key);
      if ((options.createOnly && objects.has(key)) || (options.expectedEtag && options.expectedEtag !== String(revision))) return { written: false, conflict: true, etag: null };
      const commit = () => { save(key, value); return { written: true, conflict: false, etag: String(revisions.get(key)) }; };
      writes.push({ key, value: clone(value), options });
      if (key === profileKey) {
        assert.equal(options.maxAttempts, 1, "Per-row CAS owns its existing bounded retries");
        const own = value.entries.find(row => row.cik === identity.cik);
        if (mode === "healthy_admission_put" && !own?.profile && !own?.error) {
          advance(140_000); assert.equal(options.signal.aborted, false);
          advance(144_999); return commit();
        }
        if (own?.profile) {
          if (healthy) {
            if (mode === "healthy_profile_put") {
              advance(140_000); assert.equal(workSignal.aborted, true); assert.equal(options.signal.aborted, false);
              advance(144_999);
            }
            return commit();
          }
          if (mode === "uncertain_applied") commit();
          advance(mode === "past_count_deadline" ? 175_001 : 160_000);
          throw wrap("write", persistenceSignal.reason);
        }
        if (own?.error) {
          cleanupWrites++;
          assert.equal(workSignal.aborted, true);
          assert.equal(own.error, "company_profile_time_budget_deferred");
          assert.equal(own.nextAttemptAt, new Date(start + 130_000 + 300_000).toISOString());
          advance(mode === "healthy_admission_put" ? 149_998 : 144_999);
          options.signal.throwIfAborted();
        }
      }
      if (key.startsWith("research-evidence/company-profile-sources/") && mode === "healthy_source_put") {
        advance(140_000); assert.equal(workSignal.aborted, true); assert.equal(options.signal.aborted, false);
        advance(144_999);
      }
      if (key.startsWith("pilot/profile-builder/") && value.leaseUntil === null) {
        summaryWrites++;
        assert.equal(options.signal, summarySignal);
        if (mode === "summary_write_timeout") { advance(235_000); throw wrap("write", options.signal.reason); }
        if (mode === "slow_summary") advance(234_999);
        options.signal.throwIfAborted();
      }
      return commit();
    },
  };
  const overrides = {
    "@/lib/r2-warehouse": storage,
    "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => key },
    "@/lib/simple-alert-pilot-runtime": { isSimpleAlertPilot: () => true },
    "@/lib/simple-alert-pilot-scope": { pilotCompanies: () => [] },
    "node:timers/promises": { setTimeout: async (_ms, value, options = {}) => { options.signal?.throwIfAborted(); return value; } },
    "@/lib/equity-signal/universe": { loadEquityUniverse: async () => { advance(mode === "late_admission_stop" ? 130_000 : 100_000); return { snapshot: { refreshedAt: now.toISOString(), entries: [identity].map(listing) } }; } },
    "@/lib/opportunity-engine/pr262-sensor-fetch-budget": { createPr262SensorBudgetedFetch: async input => ({ fetchImpl: input.fetchImpl, flush: async () => {} }) },
  };
  const cache = loadTsModule("@/lib/opportunity-engine/company-profile-cache", overrides);
  const builder = loadTsModule("@/lib/simple-alert-profile-builder", { ...overrides, "@/lib/opportunity-engine/company-profile-cache": cache });
  const fetcher = async (url, init) => {
    init.signal.throwIfAborted(); sourceStarts.push(elapsed);
    if (String(url).includes("submissions")) return Response.json({ cik: 1, tickers: [identity.ticker], filings: { recent: {
      form: ["10-K"], filingDate: [fixture.sourceFiledAt], accessionNumber: ["0000000001-26-000001"], primaryDocument: ["annual.htm"],
    } } });
    return new Response(`<h2>Item 1. Business</h2><p>${fixture.business}</p><p>${"The company maintains regional facilities and provides ongoing implementation support for its software. ".repeat(8)}</p><h3>Customers</h3><p>${fixture.customers}</p><h2>Item 1A. Risk Factors</h2>`);
  };
  if (mode.startsWith("summary_")) {
    await assert.rejects(() => builder.runSimpleAlertProfileBuilder(now, fetcher), error => error.storageDomain === "r2_state" && error.cause === summarySignal.reason);
    assert.equal(printed.some(line => line.startsWith("[simple-profile-builder]")), false, "Unacknowledged summary is never reported saved");
    assert.notEqual([...objects.entries()].find(([key]) => key.startsWith("pilot/profile-builder/"))[1].leaseUntil, null, "Failed summary leaves the lease and reservation fail-closed");
    assert.equal(summaryWrites, mode === "summary_read_timeout" ? 0 : 1);
  } else {
    const result = await builder.runSimpleAlertProfileBuilder(now, fetcher);
    const uncertain = mode.startsWith("uncertain_") || mode === "past_count_deadline";
    const unavailable = ["count_timeout", "count_missing", "count_malformed", "past_count_deadline"].includes(mode);
    const lateStop = mode === "late_admission_stop";
    assert.equal(result.attempted, lateStop ? 0 : 1);
    assert.equal(result.verifiedThisRun, !lateStop && healthy && mode !== "healthy_admission_put" ? 1 : 0, `${mode}: Healthy persisted work gets an ACK; uncertain final PUTs do not; ${JSON.stringify(result)}; logs=${JSON.stringify(printed)}`);
    assert.equal(result.requestFailures, 0, "Read-only finalization does not fabricate SEC failures");
    assert.equal(result.modelCalls, 0);
    assert.equal(result.status, uncertain || unavailable ? "failed" : "time_budget_reached", `${mode}: ${JSON.stringify(result)}`);
    assert.equal(result.failureCategory, uncertain || unavailable ? "storage" : null);
    assert.equal(result.newlyVerifiedThisRun, unavailable ? null : mode === "uncertain_applied" || (!lateStop && healthy && mode !== "healthy_admission_put") ? 1 : 0);
    assert.equal(result.newlyVerifiedToday, unavailable ? null : mode === "uncertain_applied" || (!lateStop && healthy && mode !== "healthy_admission_put") ? 2 : 1);
    assert.equal(result.verificationCountsStatus, unavailable ? "unreconciled" : "cache_reconciled");
    assert.equal(countReads, mode === "past_count_deadline" ? 0 : ["count_missing", "count_malformed"].includes(mode) ? 2 : 1);
    if (unavailable) { assert.ok(result.countReconciliationFailure); assert.equal(result.lastReconciledNewlyVerifiedToday, 1); }
    assert.equal(summaryWrites, 1);
    const saved = [...objects.entries()].find(([key]) => key.startsWith("pilot/profile-builder/"))[1];
    assert.equal(saved.attemptsReserved, lateStop ? 0 : 1); assert.equal(saved.leaseUntil, null);
    assert.equal(saved.totalVerified, unavailable ? 1 : mode === "uncertain_applied" || (!lateStop && healthy && mode !== "healthy_admission_put") ? 2 : 1);
  }
  assert.equal(summaryReads, 1);
  assert.ok(sourceStarts.every(at => at < 140_000));
  assert.ok(timers.some(timer => timer.duration === 100_000), "Separate admission reserve is active");
  const lateStop = mode === "late_admission_stop";
  assert.equal(sourceStarts.length, lateStop ? 0 : fullSource ? 2 : mode === "healthy_admission_put" ? 0 : 1);
  assert.equal(cleanupWrites, lateStop || fullSource ? 0 : 1, "Uncertain writes never get a cleanup overwrite");
  assert.equal(writes.filter(row => row.key === profileKey).length, lateStop ? 0 : 2, "Late admission starts no profile transaction; ordinary work keeps one admission and one result/cleanup");
  if (!lateStop) assert.ok(timers.some(timer => timer.duration === 15_000), "Per-store 15s cap retained");
  if (cleanupWrites) assert.ok(timers.some(timer => timer.duration === 5_000), "Cleanup 5s cap retained");
  if (mode === "slow_summary") assert.equal(elapsed, 234_999, "Even slow summary completes before235s, retaining HTTP headroom");
}

try {
  for (const mode of ["late_admission_stop", "healthy_profile_put", "healthy_source_put", "healthy_admission_put", "source_deadline", "uncertain_unapplied", "uncertain_applied", "count_timeout", "count_missing", "count_malformed", "past_count_deadline", "slow_summary", "summary_read_timeout", "summary_write_timeout"]) await run(mode);
} finally {
  globalThis.Date = NativeDate; AbortSignal.timeout = nativeTimeout; console.info = info;
  if (savedRole === undefined) delete process.env.SWING_UP_SIMPLE_PILOT_ROLE; else process.env.SWING_UP_SIMPLE_PILOT_ROLE = savedRole;
}
console.log("Profile finalization:140s work, independent160s healthy-write completion,175s count read,235s summary bound, preserved uncertain-PUT failure, truthful durable counts, source/storage separation, unchanged CAS and cleanup caps passed.");
