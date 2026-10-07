import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";

// Real builder, profile cache, provider reservation/snapshot wrapper and R2
// transport. Only the universe, HTTP transport and elapsed clock are fixtures.
const savedEnv = { ...process.env }, savedFetch = globalThis.fetch;
const NativeDate = Date, nativeTimeout = AbortSignal.timeout;
const savedInfo = console.info, savedWarn = console.warn;
const start = NativeDate.parse("2026-10-07T02:38:52.896Z");
const prefix = "production/pr262/", profileKey = `${prefix}research-evidence/company-profiles-v1.json`;
const budgetKey = `${prefix}sensor/provider-budgets-v1.json`;
const identity = { ticker: "TEST", company: "Test Software", cik: "0000000001" };
Object.assign(process.env, { R2_ENDPOINT: "https://profile-provider.invalid", R2_BUCKET: "test-only", R2_ACCESS_KEY_ID: "fixture-key",
  R2_SECRET_ACCESS_KEY: "fixture-secret", R2_REGION: "auto", SWING_UP_SIMPLE_PILOT_ENABLED: "false",
  SWING_UP_SIMPLE_PILOT_ROLE: "profiles", SWING_UP_R2_WRITE_PREFIX: prefix });

async function run(mode) {
  let elapsed = 0, workSignal, persistenceSignal, budgetReads = 0, targetPuts = 0, summaryWrites = 0;
  let preparationStarts = 0;
  let originalCondition;
  const timers = [], objects = new Map(), revisions = new Map(), sourceStarts = [], puts = [], logs = [], invariantFailures = [];
  const snapshot = mode.startsWith("snapshot_");
  const admissionClosed = mode === "issuer_admission_cutoff";
  const identities = mode === "reservation_queue" ? [identity, { ticker: "PEER", company: "Peer Software", cik: "0000000002" }] : [identity];
  const targetKey = snapshot ? `${prefix}sensor/submissions-cache/${identity.cik}.json` : budgetKey;
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
    // Simulate already-admitted issuer preparation reaching its next source
    // request at 139s, before that request's own 12s timer is constructed.
    if (snapshot && ms === 12_000) advance(Math.max(elapsed, 139_000));
    const controller = new AbortController(); timers.push({ controller, at: elapsed + ms, ms });
    if (ms === 140_000) workSignal = controller.signal;
    if (ms === 160_000) persistenceSignal = controller.signal;
    return controller.signal;
  };
  console.info = value => logs.push(value); console.warn = () => {};
  const pause = { setTimeout: async (ms, value, options = {}) => {
    options.signal?.throwIfAborted(); advance(elapsed + ms); options.signal?.throwIfAborted(); return value;
  } };
  const r2 = loadTsModule("@/lib/r2-warehouse", { "@/lib/db/client": { prisma: {} },
    "@/lib/redact-secrets": { redactSecrets: value => value }, "node:timers/promises": pause });
  const save = (key, bytes) => { objects.set(key, Buffer.from(bytes)); revisions.set(key, (revisions.get(key) ?? 0) + 1); };
  const fixture = companyProfileFixture(identity, new Date(start));
  save(profileKey, r2.encodeVersionedJsonForR2(profileKey, { version: 1, entries: snapshot ? [] : identities.map(row => {
    const source = companyProfileFixture(row, new Date(start));
    return { ...row, profile: null, filing: { url: source.sourceUrl, form: "10-K", filedAt: source.sourceFiledAt,
      industry: "Software", checkedAt: new Date(start).toISOString() }, updatedAt: new Date(start - 3_600_000).toISOString(), nextAttemptAt: new Date(start - 1000).toISOString() };
  }) }).body);
  const current = () => JSON.parse(r2.decodeVersionedR2Text(objects.get(profileKey))).entries.find(row => row.cik === identity.cik);
  globalThis.fetch = async (url, init) => {
    assert.equal(new URL(url).hostname, "profile-provider.invalid");
    init.signal.throwIfAborted();
    const key = decodeURIComponent(new URL(url).pathname).replace(/^\/test-only\//, "");
    if (init.method === "GET") {
      if (key === budgetKey) {
        budgetReads++;
        if (mode === "reservation_read_abort" && budgetReads === 2) { advance(140_275); init.signal.throwIfAborted(); }
      }
      if (key === targetKey && targetPuts && mode.includes("readback_unknown")) throw new Error("independent_readback_unavailable");
      if (key === targetKey && targetPuts === 1 && mode.includes("persistence_expiry")) advance(149_000);
      return objects.has(key) ? new Response(objects.get(key), { headers: { etag: `"${revisions.get(key)}"` } }) : new Response(null, { status: 404 });
    }
    assert.equal(init.method, "PUT");
    assert.ok(init.headers["if-match"] || init.headers["if-none-match"], "All PUTs retain their original conditional guard");
    puts.push({ key, at: elapsed });
    if ((init.headers["if-match"] && init.headers["if-match"] !== `"${revisions.get(key)}"`)
      || (init.headers["if-none-match"] && objects.has(key))) return new Response(null, { status: 412 });
    const value = JSON.parse(r2.decodeVersionedR2Text(Buffer.from(init.body)));
    const commit = () => { save(key, init.body); return new Response(null, { headers: { etag: `"${revisions.get(key)}"` } }); };
    if (key === targetKey) {
      targetPuts++;
      const condition = [init.headers["if-match"] ?? null, init.headers["if-none-match"] ?? null];
      originalCondition ??= condition;
      assert.deepEqual(condition, originalCondition, "Every admitted transaction retry preserves its original conditional guard");
      if (mode.includes("persistence_expiry")) {
        if (targetPuts === 1) { advance(140_275); return new Response(null, { status: 502 }); }
        assert.equal(elapsed, 149_000, "The original-condition retry starts only after verified non-application");
        if (mode.endsWith("_applied")) commit();
        advance(160_000); init.signal.throwIfAborted(); assert.fail("The persistence deadline must precede this PUT's own 20s cap");
      }
      if (mode === "reservation_queue") {
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(preparationStarts, 2, "The second source preparation is already queued behind this live reservation");
      }
      if (mode.includes("cutoff_")) {
        if (mode.endsWith("_applied")) commit();
        advance(160_000); init.signal.throwIfAborted(); assert.fail("Persistence expiry must abort the actual PUT");
      }
      if (mode.includes("readback_unknown")) {
        if (mode.endsWith("_applied")) commit();
        advance(Math.max(elapsed, 140_275)); return new Response(null, { status: 502 });
      }
      if (mode.endsWith("_502") && mode !== "reservation_committed_502") { advance(Math.max(elapsed, 140_275)); return new Response(null, { status: 502 }); }
      if (mode.endsWith("_timeout")) { advance(Math.max(elapsed, 140_275)); throw new DOMException("Independent R2 timeout", "TimeoutError"); }
      if (mode.endsWith("_403")) { advance(140_275); return new Response(null, { status: 403 }); }
      if (mode === "reservation_conflict") { advance(140_275); return new Response(null, { status: 412 }); }
      if (mode === "reservation_committed_502") { commit(); advance(140_275); return new Response(null, { status: 502 }); }
      if (mode === "reservation_retry" && targetPuts === 1) { advance(140_275); return new Response(null, { status: 502 }); }
      advance(Math.max(elapsed, 144_000));
    }
    if (key.includes("pilot/profile-builder/") && value.leaseUntil === null) summaryWrites++;
    init.signal.throwIfAborted(); return commit();
  };
  const transport = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    try { return await transport(...args); } catch (error) {
      if (error instanceof assert.AssertionError) invariantFailures.push(error.message);
      throw error;
    }
  };
  let readySourceReads = 0, releasePreparations;
  const allPrepared = new Promise(resolve => { releasePreparations = resolve; });
  const storage = { ...r2, readVersionedTextFromR2: async (key, options) => {
    if (key.includes("company-profile-sources/")) {
      readySourceReads++;
      if (readySourceReads === identities.length) releasePreparations();
      // Both queue-case issuers finish their bounded admission stores before
      // simulated preparation time advances. The real source-cache GET and
      // subsequent provider request then begin at 139s with fresh I/O timers.
      await allPrepared;
      advance(Math.max(elapsed, 139_000));
    }
    return r2.readVersionedTextFromR2(key, options);
  } };
  const overrides = { "@/lib/r2-warehouse": storage, "node:timers/promises": pause,
    "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => prefix + key },
    "@/lib/simple-alert-pilot-runtime": { isSimpleAlertPilot: () => true },
    "@/lib/simple-alert-pilot-scope": { pilotCompanies: () => [identity] },
    "@/lib/equity-signal/universe": { loadEquityUniverse: async () => { advance(admissionClosed ? 100_000 : 90_000); return { snapshot: {
      refreshedAt: new Date(start).toISOString(), entries: identities.map(row => ({ ...row, name: row.company,
        exchange: "Nasdaq", securityType: "common_stock", sourceNames: ["SEC company_tickers_exchange"] })) } }; } },
  };
  const cache = loadTsModule("@/lib/opportunity-engine/company-profile-cache", overrides);
  const provider = loadTsModule("@/lib/opportunity-engine/pr262-sensor-fetch-budget", overrides);
  const builder = loadTsModule("@/lib/simple-alert-profile-builder", { ...overrides,
    "@/lib/opportunity-engine/pr262-sensor-fetch-budget": { createPr262SensorBudgetedFetch: async input => {
      const real = await provider.createPr262SensorBudgetedFetch(input);
      return { ...real, fetchImpl: (...args) => {
        preparationStarts++;
        assert.equal(elapsed, 139_000, "Already-admitted work reaches provider preparation near the source cutoff");
        return real.fetchImpl(...args);
      } };
    } }, "@/lib/opportunity-engine/company-profile-cache": cache });
  const source = async (url, init) => {
    init.signal.throwIfAborted(); sourceStarts.push(elapsed);
    assert.ok(objects.has(budgetKey), "The budget reservation is durable before source network");
    assert.ok(snapshot && String(url).includes("submissions"), "No annual request may start after a reservation crosses cutoff");
    if (mode === "snapshot_body_abort") return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"cik":1,"tickers":["TEST"],')); },
      pull(controller) { advance(140_275); controller.error(workSignal.reason); },
    }));
    return Response.json({ cik: 1, tickers: [identity.ticker], filings: { recent: {
      form: ["10-K"], filingDate: [fixture.sourceFiledAt], accessionNumber: ["0000000001-26-000001"],
      primaryDocument: ["annual.htm"], acceptanceDateTime: ["2026-09-01T12:00:00Z"],
    } } });
  };
  const result = await builder.runSimpleAlertProfileBuilder(new Date(start), source);
  if (admissionClosed) {
    assert.equal(result.eligibleCompanies, 1, "An eligible issuer is present when admission closes");
    assert.equal(result.attempted, 0, "No new issuer starts at the 100s admission cutoff");
    assert.equal(preparationStarts, 0);
    assert.equal(sourceStarts.length, 0);
    assert.equal(targetPuts, 0);
    assert.equal(puts.filter(row => row.key === profileKey).length, 0);
    assert.equal(result.requests, 0);
    assert.equal(result.storageFailureObserved, false);
    assert.equal(result.verificationCountsStatus, "cache_reconciled");
    assert.equal(summaryWrites, 1);
    assert.equal(workSignal.aborted, false, "The admission control is distinct from the 140s source cutoff");
    assert.equal(persistenceSignal.aborted, false);
    assert.deepEqual(invariantFailures, []);
    return;
  }
  assert.equal(result.attempted, identities.length, "The deadline regression must exercise already-admitted issuer work");
  assert.ok(puts.some(row => row.key === profileKey && row.at < 100_000), "Profile admission is durable before its cutoff");
  const deferred = ["reservation_settled", "reservation_queue", "reservation_committed_502", "reservation_retry", "reservation_conflict", "reservation_read_abort", "snapshot_settled", "snapshot_body_abort"].includes(mode);
  assert.equal(result.status, deferred ? "time_budget_reached" : "failed", `${mode}: ${JSON.stringify(result)}`);
  assert.equal(result.failureCategory, deferred ? null : "storage", mode);
  assert.equal(result.storageFailureObserved, !deferred, mode);
  if (!deferred) {
    const pending = logs.map(line => { try { return JSON.parse(line); } catch { return null; } }).find(row => row?.kind === "pr262_company_profile_result");
    assert.equal(pending?.reason, "company_profile_storage_write_failed");
    assert.equal(pending?.storageContext, snapshot ? "submissions_snapshot" : "provider_budget_reservation");
  }
  assert.equal(result.requestFailures, 0, "Storage or pre-network deadline failures must never be source failures");
  assert.equal(result.requests, snapshot ? 1 : 0, mode);
  assert.equal(result.verifiedThisRun, 0);
  assert.equal(result.newlyVerifiedThisRun, 0);
  assert.equal(result.verificationCountsStatus, "cache_reconciled");
  assert.equal(result.modelCalls, 0);
  assert.equal(summaryWrites, 1);
  assert.equal(workSignal.aborted, true);
  assert.equal(persistenceSignal.aborted, mode.includes("cutoff_") || mode.includes("persistence_expiry"));
  assert.ok(sourceStarts.every(at => at < 140_000));
  if (deferred) assert.equal(current().error, "company_profile_time_budget_deferred");
  if (mode === "reservation_read_abort") assert.equal(targetPuts, 0);
  if (mode === "reservation_queue") {
    assert.equal(result.attempted, 2);
    assert.equal(targetPuts, 1);
    assert.equal(budgetReads, 2, "Queued reservation performs no storage read or write after cutoff");
  }
  if (mode === "reservation_conflict") assert.equal(targetPuts, 1, "No new reservation starts after work cutoff");
  if (mode.includes("cutoff_") || mode.includes("readback_unknown")) assert.equal(targetPuts, 1, "An ambiguous write is never blindly replayed");
  if (mode.includes("persistence_expiry")) {
    assert.equal(targetPuts, 2, "Only the verified-unapplied first PUT permits a retry; expiry stops further writes");
    assert.equal(result.failure, "Deadline 160000", "The independent persistence bound, not work/request timeout, ends the admitted retry");
  }
  if (mode.endsWith("_502") && mode !== "reservation_committed_502" || mode.endsWith("_timeout")) assert.equal(targetPuts, 3);
  if (mode === "reservation_committed_502") assert.equal(targetPuts, 1, "Exact readback acknowledges only the original applied write");
  if (mode === "reservation_retry") assert.equal(targetPuts, 2);
  if (["reservation_settled", "reservation_queue", "reservation_committed_502", "reservation_retry"].includes(mode) || snapshot) {
    const ledger = JSON.parse(r2.decodeVersionedR2Text(objects.get(budgetKey)));
    assert.equal(Object.values(ledger.hourlyCounts).flatMap(Object.values).reduce((sum, count) => sum + count, 0), 1,
      "A settled reservation stays charged even when its source request cannot start");
  }
  if (mode === "snapshot_settled") {
    assert.equal(JSON.parse(r2.decodeVersionedR2Text(objects.get(targetKey))).fetchedAt, new Date(start + 139_000).toISOString(),
      "Source observation time must not move forward to persistence completion");
  }
  if (mode === "snapshot_body_abort") assert.equal(targetPuts, 0, "An aborted incomplete body never enters persistence or becomes a complete snapshot");
  assert.ok(puts.filter(row => row.key === profileKey).length <= identities.length * 2, "Only admission and the single bounded cleanup PUT per issuer");
  assert.ok(elapsed <= 175_000);
  assert.deepEqual(invariantFailures, [], "Mock assertion failures must not be swallowed as storage faults");
}

try {
  for (const mode of ["reservation_settled", "reservation_queue", "reservation_read_abort", "reservation_conflict", "reservation_committed_502", "reservation_retry",
    "reservation_cutoff_applied", "reservation_cutoff_unapplied", "reservation_readback_unknown_applied", "reservation_readback_unknown_unapplied",
    "reservation_persistence_expiry_applied", "reservation_persistence_expiry_unapplied",
    "reservation_502", "reservation_timeout", "reservation_403", "snapshot_settled", "snapshot_body_abort", "snapshot_cutoff_applied", "snapshot_cutoff_unapplied",
    "snapshot_persistence_expiry_applied", "snapshot_persistence_expiry_unapplied",
    "snapshot_readback_unknown_applied", "snapshot_readback_unknown_unapplied", "snapshot_502", "snapshot_timeout", "snapshot_403",
    "issuer_admission_cutoff"]) await run(mode);
} finally {
  globalThis.Date = NativeDate; AbortSignal.timeout = nativeTimeout; globalThis.fetch = savedFetch;
  console.info = savedInfo; console.warn = savedWarn;
  for (const name of Object.keys(process.env)) if (!(name in savedEnv)) delete process.env[name];
  Object.assign(process.env, savedEnv);
}
console.log("Real profile/budget/R2: started reservations and complete snapshots settle beyond 140s within 160s; no source after cutoff; conservative quota; conflicts, ambiguity, storage faults and persistence expiry remain truthful.");
