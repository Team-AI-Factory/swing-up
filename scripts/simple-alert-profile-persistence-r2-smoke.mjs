import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";

// Exercise the real builder, row CAS, R2 codec, signed transport, recovery and
// provenance. Only fetch and elapsed time are synthetic; no external traffic.
const savedEnv = { ...process.env }, savedFetch = globalThis.fetch;
const NativeDate = Date, nativeTimeout = AbortSignal.timeout;
const savedInfo = console.info, savedWarn = console.warn;
const start = NativeDate.parse("2026-10-07T00:09:28.890Z");
const prefix = "production/pr262/", profileKey = `${prefix}research-evidence/company-profiles-v1.json`;
const identity = { ticker: "TEST", company: "Test Software", cik: "0000000001" };
const baseline = { ticker: "BASE", company: "Base Software", cik: "0000000002" };
Object.assign(process.env, { R2_ENDPOINT: "https://profile-storage.invalid", R2_BUCKET: "test-only", R2_ACCESS_KEY_ID: "fixture-key",
  R2_SECRET_ACCESS_KEY: "fixture-secret", R2_REGION: "auto", SWING_UP_SIMPLE_PILOT_ENABLED: "false",
  SWING_UP_SIMPLE_PILOT_ROLE: "profiles", SWING_UP_R2_WRITE_PREFIX: prefix });

async function run(mode) {
  let elapsed = 0, admissionSignal, workSignal, persistenceSignal, countSignal, summarySignal, phase;
  let workProfileReads = 0;
  const timers = [], objects = new Map(), revisions = new Map(), profilePuts = [], sourceStarts = [], logs = [], invariantFailures = [];
  let countReads = 0, summaryWrites = 0, initialProfileReads = 0, verifiedPuts = 0, verifiedReadbacks = 0;
  const advance = target => {
    assert.ok(target >= elapsed, `${mode}: clock cannot move backward`);
    elapsed = target;
    for (const timer of [...timers].sort((left, right) => left.at - right.at)) if (timer.at <= elapsed && !timer.controller.signal.aborted) {
      timer.controller.abort(new DOMException(`Deadline ${timer.ms}`, "TimeoutError"));
    }
  };
  globalThis.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [start + elapsed])); }
    static now() { return start + elapsed; }
  };
  AbortSignal.timeout = ms => {
    const controller = new AbortController(); timers.push({ controller, at: elapsed + ms, ms });
    if (ms === 100_000) admissionSignal = controller.signal;
    if (ms === 140_000) workSignal = controller.signal;
    if (ms === 160_000) persistenceSignal = controller.signal;
    if (ms === 175_000) countSignal = controller.signal;
    if (ms === 235_000) summarySignal = controller.signal;
    return controller.signal;
  };
  console.info = value => logs.push(value); console.warn = () => {};
  const pause = { setTimeout: async (ms, value, options = {}) => {
    options.signal?.throwIfAborted(); advance(elapsed + ms); options.signal?.throwIfAborted(); return value;
  } };
  const r2 = loadTsModule("@/lib/r2-warehouse", { "@/lib/db/client": { prisma: {} },
    "@/lib/redact-secrets": { redactSecrets: value => value }, "node:timers/promises": pause });
  const save = (key, bytes) => { objects.set(key, Buffer.from(bytes)); revisions.set(key, (revisions.get(key) ?? 0) + 1); };
  const baselineAt = new Date(start - 1000), fixture = companyProfileFixture(identity, new Date(start));
  save(profileKey, r2.encodeVersionedJsonForR2(profileKey, { version: 1, entries: [{ ...baseline,
    profile: companyProfileFixture(baseline, baselineAt), updatedAt: baselineAt.toISOString(), firstVerifiedAt: baselineAt.toISOString(),
    verificationHistoryKnown: true, nextAttemptAt: new Date(start + 86400000).toISOString() }] }).body);
  const current = () => JSON.parse(r2.decodeVersionedR2Text(objects.get(profileKey))).entries.find(row => row.cik === identity.cik);
  const fetchFailure = (init, target) => { advance(target); init.signal.throwIfAborted(); assert.fail(`${mode}: deadline must reach actual fetch`); };
  globalThis.fetch = async (url, init) => {
    assert.equal(new URL(url).hostname, "profile-storage.invalid");
    init.signal.throwIfAborted();
    const key = decodeURIComponent(new URL(url).pathname).replace(/^\/test-only\//, "");
    if (init.method === "GET") {
      if (phase === "count") {
        assert.equal(workSignal.aborted, mode !== "late_admission_stop");
        if (mode === "count_timeout") return fetchFailure(init, 175_000);
        if (mode === "count_malformed") return new Response('{"entries":"invalid"}', { headers: { etag: '"bad"' } });
      }
      if (phase === "summary" && mode === "summary_read_timeout") return fetchFailure(init, elapsed + 20_000);
      if (key === profileKey && !phase) {
        initialProfileReads++;
        if (mode === "admission_read_abort" && initialProfileReads === 3) return fetchFailure(init, 140_000);
        if (verifiedPuts) {
          verifiedReadbacks++;
          if (mode.startsWith("readback_")) return fetchFailure(init, profilePuts.at(-1).at + 15_000);
          if (mode === "healthy_readback") assert.equal(workSignal.aborted, true, "Exact-intent CAS readback can acknowledge an applied PUT after work closes");
        }
      }
      if (key.includes("company-profile-sources/") && mode.startsWith("source_read_")) {
        advance(140_000);
        if (mode === "source_read_abort") init.signal.throwIfAborted();
        if (mode === "source_read_502") return new Response(null, { status: 502 });
        throw new DOMException("Independent storage timeout", "TimeoutError");
      }
      return objects.has(key) ? new Response(objects.get(key), { headers: { etag: `"${revisions.get(key)}"` } }) : new Response(null, { status: 404 });
    }
    assert.equal(init.method, "PUT");
    assert.ok(init.headers["if-match"] || init.headers["if-none-match"], "Every actual PUT remains conditional");
    if ((init.headers["if-match"] && init.headers["if-match"] !== `"${revisions.get(key)}"`)
      || (init.headers["if-none-match"] && objects.has(key))) return new Response(null, { status: 412 });
    const value = JSON.parse(r2.decodeVersionedR2Text(Buffer.from(init.body)));
    const commit = () => { save(key, init.body); return new Response(null, { headers: { etag: `"${revisions.get(key)}"` } }); };
    if (key === profileKey) {
      const row = value.entries.find(item => item.cik === identity.cik);
      profilePuts.push({ at: elapsed, row, signal: init.signal });
      if (row.profile) {
        verifiedPuts++;
        if (mode === "healthy_profile") { advance(140_000); assert.equal(init.signal.aborted, false); advance(144_000); }
        if (mode === "healthy_source") advance(149_000);
        if (mode === "healthy_readback") { commit(); advance(140_000); return new Response(null, { status: 502 }); }
        if (mode.startsWith("cutoff_")) {
          if (mode === "cutoff_applied") commit();
          return fetchFailure(init, 160_000);
        }
        if (mode.startsWith("readback_")) {
          if (mode === "readback_applied") commit();
          advance(140_000); return new Response(null, { status: 502 });
        }
        if (mode === "persistent_502") { advance(Math.max(elapsed, 140_000)); return new Response(null, { status: 502 }); }
      } else if (!row.error && mode.startsWith("admission_")) {
        if (mode === "admission_conflict") { advance(140_000); return new Response(null, { status: 412 }); }
        if (mode === "admission_put") { advance(140_000); assert.equal(init.signal.aborted, false); advance(144_000); }
      } else if (row.error) {
        assert.equal(row.nextAttemptAt, new Date(start + 390_000).toISOString());
      }
    }
    if (key.includes("company-profile-sources/")) {
      if (mode === "healthy_source") { advance(140_000); assert.equal(init.signal.aborted, false); advance(144_000); }
      if (mode.startsWith("cutoff_")) advance(149_000);
      if (mode === "persistence_before_final") {
        // An acknowledged source result does not authorize swallowing expiry
        // before the first profile CAS, even though that PUT never started.
        advance(160_000); return commit();
      }
    }
    if (key.includes("pilot/profile-builder/") && value.leaseUntil === null) {
      summaryWrites++;
      if (mode === "summary_write_timeout") return fetchFailure(init, elapsed + 20_000);
    }
    init.signal.throwIfAborted(); return commit();
  };
  const transport = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    try { return await transport(...args); } catch (error) {
      if (error instanceof assert.AssertionError) invariantFailures.push(error.message);
      throw error;
    }
  };
  const storage = { ...r2, readVersionedTextFromR2: async (key, options = {}) => {
    // The builder admits this issuer at 90s. Advance preparation before its
    // first actual R2 read, keeping every later PUT/readback boundary intact.
    if (key === profileKey && options.signal === workSignal && ++workProfileReads === 2) advance(130_000);
    phase = options.signal === countSignal ? "count" : options.signal === summarySignal ? "summary" : undefined;
    if (phase === "count") countReads++;
    try { return await r2.readVersionedTextFromR2(key, options); } finally { phase = undefined; }
  } };
  const overrides = { "@/lib/r2-warehouse": storage, "node:timers/promises": pause,
    "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => prefix + key },
    "@/lib/simple-alert-pilot-runtime": { isSimpleAlertPilot: () => true },
    "@/lib/simple-alert-pilot-scope": { pilotCompanies: () => [] },
    "@/lib/opportunity-engine/pr262-sensor-fetch-budget": { createPr262SensorBudgetedFetch: async input => ({ fetchImpl: input.fetchImpl, flush: async () => {} }) },
    "@/lib/equity-signal/universe": { loadEquityUniverse: async () => { advance(mode === "late_admission_stop" ? 130_000 : 90_000); return { snapshot: { refreshedAt: new Date(start).toISOString(), entries: [{ ...identity,
      name: identity.company, exchange: "Nasdaq", securityType: "common_stock", sourceNames: ["SEC company_tickers_exchange"] }] } }; } },
  };
  const cache = loadTsModule("@/lib/opportunity-engine/company-profile-cache", overrides);
  const builder = loadTsModule("@/lib/simple-alert-profile-builder", { ...overrides, "@/lib/opportunity-engine/company-profile-cache": cache });
  const source = async (url, init) => {
    init.signal.throwIfAborted(); sourceStarts.push(elapsed);
    if (String(url).includes("submissions")) return Response.json({ cik: 1, tickers: [identity.ticker], filings: { recent: {
      form: ["10-K"], filingDate: [fixture.sourceFiledAt], accessionNumber: ["0000000001-26-000001"], primaryDocument: ["annual.htm"],
    } } });
    return new Response(`<h2>Item 1. Business</h2><p>${fixture.business}</p><p>${"The company maintains regional facilities and provides ongoing implementation support for its software. ".repeat(8)}</p><h3>Customers</h3><p>${fixture.customers}</p><h2>Item 1A. Risk Factors</h2>`);
  };
  // Reporting faults follow an ordinary source deadline, keeping the count
  // window available without fabricating an earlier storage failure.
  if (mode.startsWith("count_") || mode.startsWith("summary_")) {
    const read = storage.readVersionedTextFromR2;
    storage.readVersionedTextFromR2 = async (key, options) => {
      if (key.includes("company-profile-sources/")) advance(140_000);
      return read(key, options);
    };
  }
  if (mode.startsWith("summary_")) {
    await assert.rejects(() => builder.runSimpleAlertProfileBuilder(new Date(start), source), error => error.storageDomain === "r2_state" && error.cause?.message === (mode === "summary_read_timeout" ? "Deadline 20000" : "Deadline 45000"));
    assert.equal(summarySignal.aborted, false, "Existing R2 operation caps can end a summary earlier than its 235s absolute deadline");
    assert.equal(logs.some(value => value.startsWith("[simple-profile-builder]")), false);
  } else {
    const result = await builder.runSimpleAlertProfileBuilder(new Date(start), source);
    const healthy = mode.startsWith("healthy_");
    const deferred = ["admission_put", "admission_read_abort", "source_read_abort", "late_admission_stop"].includes(mode);
    const unknownCounts = mode.startsWith("count_");
    const applied = ["cutoff_applied", "readback_applied"].includes(mode) || healthy;
    assert.equal(result.status, healthy || deferred ? "time_budget_reached" : "failed", `${mode}: ${JSON.stringify(result)}`);
    assert.equal(result.attempted, mode === "late_admission_stop" ? 0 : 1, "The original fault cases must actually admit an issuer");
    assert.equal(result.verifiedThisRun, healthy ? 1 : 0, mode);
    assert.equal(result.newlyVerifiedThisRun, unknownCounts ? null : applied ? 1 : 0, mode);
    assert.equal(result.newlyVerifiedToday, unknownCounts ? null : applied ? 2 : 1, mode);
    assert.equal(result.failureCategory, healthy || deferred ? null : "storage", mode);
    if (mode.startsWith("cutoff_") || mode === "persistence_before_final") {
      assert.equal(persistenceSignal.aborted, true);
      assert.equal(result.failure, "Deadline 160000", "Persistence expiry cannot become an ordinary work deferral");
    }
    if (mode.startsWith("readback_")) assert.equal(result.failure, "r2_state_write_reconciliation_failed");
    assert.equal(result.requestFailures, 0, mode);
    assert.equal(result.modelCalls, 0);
    assert.equal(result.verificationCountsStatus, unknownCounts ? "unreconciled" : "cache_reconciled");
    assert.equal(summaryWrites, 1);
    assert.ok(countReads >= 1);
    if (healthy) assert.ok(current().profile);
    if (["admission_put", "source_read_abort"].includes(mode)) assert.equal(current().error, "company_profile_time_budget_deferred");
    if (mode.startsWith("source_read_") && !deferred) assert.match(current().error, /^company_profile_storage_read_failed:/);
  }
  assert.ok(sourceStarts.every(at => at < 140_000), "No source starts after work admission closes");
  if (mode === "late_admission_stop") {
    assert.equal(admissionSignal.aborted, true);
    assert.equal(workSignal.aborted, false);
    assert.equal(profilePuts.length, 0);
    assert.equal(sourceStarts.length, 0);
  } else if (profilePuts.length) assert.equal(profilePuts[0].row.updatedAt, new Date(start + 90_000).toISOString(),
    "Profile persistence cases preserve issuer admission before 100s");
  if (mode.startsWith("admission_")) assert.equal(sourceStarts.length, 0);
  if (mode === "admission_read_abort") assert.equal(profilePuts.length, 0);
  if (mode === "admission_conflict") assert.equal(profilePuts.length, 1, "No admission retry starts after 140s");
  if (mode.startsWith("readback_") || mode.startsWith("cutoff_")) {
    assert.equal(profilePuts.length, 2, "Uncertain final PUT gets neither a blind retry nor a cleanup overwrite");
    assert.equal(verifiedPuts, 1);
  }
  if (mode.startsWith("readback_") || mode === "healthy_readback") assert.equal(verifiedReadbacks, 1);
  if (mode === "healthy_readback") { assert.equal(profilePuts.length, 2); assert.equal(verifiedPuts, 1); }
  if (mode === "persistent_502") assert.equal(verifiedPuts, 4, "Four actual PUTs is still the row-CAS ceiling");
  assert.ok(profilePuts.every(put => put.row.profile || put.row.error || put.at < 140_000));
  assert.ok(elapsed <= 235_000);
  assert.deepEqual(invariantFailures, [], `${mode}: no mock assertion may be swallowed as a production storage error`);
}

try {
  for (const mode of ["late_admission_stop", "healthy_profile", "healthy_source", "healthy_readback", "admission_put", "admission_read_abort", "admission_conflict",
    "cutoff_applied", "cutoff_unapplied", "readback_applied", "readback_unapplied", "persistent_502", "persistence_before_final",
    "source_read_abort", "source_read_502", "source_read_timeout", "count_timeout", "count_malformed", "summary_read_timeout", "summary_write_timeout"]) await run(mode);
} finally {
  globalThis.Date = NativeDate; AbortSignal.timeout = nativeTimeout; globalThis.fetch = savedFetch;
  console.info = savedInfo; console.warn = savedWarn;
  for (const name of Object.keys(process.env)) if (!(name in savedEnv)) delete process.env[name];
  Object.assign(process.env, savedEnv);
}
console.log("Real builder/cache/R2: healthy PUTs across 140s, work-bound admission, 160s persistence cutoff, applied/unapplied ambiguity, no blind replay, four-PUT ceiling, exact source-read deferral, independent storage faults, bounded count/summary finalization passed.");
