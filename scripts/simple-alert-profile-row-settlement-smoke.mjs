import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";

// Real builder, profile row FIFO/CAS, R2 codec, signing and error provenance.
// All transport is local and guarded; no provider/model or live storage calls.
const savedEnv = { ...process.env }, savedFetch = globalThis.fetch;
const NativeDate = Date, nativeTimeout = AbortSignal.timeout;
const savedInfo = console.info, savedWarn = console.warn;
const baseline = process.argv.includes("--baseline"), observations = [];
const start = NativeDate.parse("2026-10-07T04:22:08Z");
const prefix = "production/pr262/", profileKey = `${prefix}research-evidence/company-profiles-v1.json`;
const identity = { ticker: "TEST", company: "Test Software", cik: "0000000001" };
const other = { ticker: "OTHER", company: "Other Software", cik: "0000000002", profile: null, error: "preserve_other_row" };
Object.assign(process.env, { R2_ENDPOINT: "https://row-settlement.invalid", R2_BUCKET: "test-only", R2_ACCESS_KEY_ID: "fixture-key",
  R2_SECRET_ACCESS_KEY: "fixture-secret", R2_REGION: "auto", SWING_UP_SIMPLE_PILOT_ENABLED: "false",
  SWING_UP_SIMPLE_PILOT_ROLE: "profiles", SWING_UP_R2_WRITE_PREFIX: prefix });

async function run(stage, mode) {
  let elapsed = 0, workSignal, persistenceSignal, countSignal, summarySignal, phase;
  let initialReads = 0, faulted = false, faultAt = 0, faultReads = 0, targetPuts = 0, summaryWrites = 0;
  const timers = [], objects = new Map(), revisions = new Map(), puts = [], logs = [], invariantFailures = [];
  const advance = target => {
    assert.ok(target >= elapsed, `${stage}/${mode}: clock cannot move backward`);
    elapsed = target;
    for (const timer of [...timers].sort((a, b) => a.at - b.at)) if (timer.at <= elapsed && !timer.controller.signal.aborted) {
      timer.controller.abort(new DOMException(`Deadline ${timer.ms}`, "TimeoutError"));
    }
  };
  globalThis.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [start + elapsed])); }
    static now() { return start + elapsed; }
  };
  AbortSignal.timeout = ms => {
    const controller = new AbortController(); timers.push({ controller, at: elapsed + ms, ms });
    if (ms === 140_000) workSignal = controller.signal;
    if (ms === 160_000) persistenceSignal = controller.signal;
    if (ms === 175_000) countSignal = controller.signal;
    if (ms === 235_000) summarySignal = controller.signal;
    return controller.signal;
  };
  console.info = value => logs.push(value); console.warn = value => logs.push(value);
  const pause = { setTimeout: async (ms, value, options = {}) => {
    options.signal?.throwIfAborted(); advance(elapsed + ms); options.signal?.throwIfAborted(); return value;
  } };
  const r2 = loadTsModule("@/lib/r2-warehouse", { "@/lib/db/client": { prisma: {} },
    "@/lib/redact-secrets": { redactSecrets: value => value }, "node:timers/promises": pause });
  const save = (key, bytes) => { objects.set(key, Buffer.from(bytes)); revisions.set(key, (revisions.get(key) ?? 0) + 1); };
  const saveProfile = value => save(profileKey, r2.encodeVersionedJsonForR2(profileKey, value).body);
  const current = () => JSON.parse(r2.decodeVersionedR2Text(objects.get(profileKey)));
  saveProfile({ version: 1, entries: [] });
  const fetchFailure = (init, target) => { advance(target); init.signal.throwIfAborted(); assert.fail("Actual fetch must receive its deadline"); };
  const response = key => objects.has(key) ? new Response(objects.get(key), { headers: { etag: `"${revisions.get(key)}"` } }) : new Response(null, { status: 404 });
  const transport = async (url, init) => {
    assert.equal(new URL(url).hostname, "row-settlement.invalid");
    init.signal.throwIfAborted();
    const key = decodeURIComponent(new URL(url).pathname).replace(/^\/test-only\//, "");
    if (init.method === "GET") {
      if (mode === "source_fault_pending_settlement" && key.includes("company-profile-sources/")) return new Response(null, { status: 502 });
      if (key === profileKey && !phase) {
        initialReads++;
        if (mode === "initial_read_timeout" && initialReads === 2) return fetchFailure(init, elapsed + 20_000);
        if (mode === "admission_read_timeout" && initialReads === 3) return fetchFailure(init, elapsed + 15_000);
        if (faulted) {
          faultReads++;
          if (mode === "conflict_then_timeout") return fetchFailure(init, faultAt + 15_000);
          if (mode.includes("unknown")) return new Response(null, { status: 502 });
          if (mode === "settlement_timeout") return fetchFailure(init, elapsed + 5_000);
          if (mode === "settlement_persistence_cutoff") return fetchFailure(init, 160_000);
          if (mode.startsWith("readback_") && (faultReads === 1 || mode.includes("malformed"))) {
            if (mode.includes("timeout")) return fetchFailure(init, faultAt + 15_000);
            if (mode.includes("502")) return new Response(null, { status: 502 });
            if (mode.includes("403")) return new Response(null, { status: 403 });
            if (mode.includes("malformed")) return new Response("{", { headers: { etag: '"bad"' } });
          }
          if (mode === "settlement_missing_etag") return new Response(objects.get(key));
          if (mode === "settlement_duplicate") {
            const value = current(); return Response.json({ ...value, entries: [...value.entries, value.entries[0]] }, { headers: { etag: '"bad"' } });
          }
        }
      }
      return response(key);
    }
    assert.equal(init.method, "PUT");
    assert.ok(init.headers["if-match"] || init.headers["if-none-match"], "Every actual PUT remains conditional");
    puts.push({ key, at: elapsed });
    if ((init.headers["if-match"] && init.headers["if-match"] !== `"${revisions.get(key)}"`)
      || (init.headers["if-none-match"] && objects.has(key))) return new Response(null, { status: 412 });
    const value = JSON.parse(r2.decodeVersionedR2Text(Buffer.from(init.body)));
    const commit = () => { save(key, init.body); return new Response(null, { headers: { etag: `"${revisions.get(key)}"` } }); };
    if (key === profileKey) {
      const row = value.entries.find(item => item.cik === identity.cik);
      const isTarget = stage === "admission" ? !row.profile && !row.error : stage === "pending" ? Boolean(row.error) : Boolean(row.profile);
      if (isTarget) {
        targetPuts++;
        if (!faulted && !mode.endsWith("read_timeout")) {
          faulted = true; faultAt = elapsed;
          const applied = !["put_timeout_unapplied", "put_timeout_unknown_unapplied", "same_row_winner", "put_403", "persistence_unapplied", "role_unapplied"].includes(mode);
          if (applied) commit();
          if (mode === "other_row_winner") saveProfile({ ...current(), entries: [...current().entries, other] });
          if (mode === "same_row_winner") saveProfile({ version: 1, entries: [{ ...row, verificationHistoryKnown: true, error: "preserve_same_row_winner" }] });
          if (mode === "conflict_then_timeout") return new Response(null, { status: 412 });
          if (mode.startsWith("readback_")) return new Response(null, { status: 502 });
          if (mode === "put_403") return new Response(null, { status: 403 });
          if (mode.startsWith("persistence_")) return fetchFailure(init, 160_000);
          if (mode.startsWith("role_")) { advance(140_000); throw new DOMException("Independent PUT timeout", "TimeoutError"); }
          if (mode === "settlement_persistence_cutoff") return fetchFailure(init, 159_000);
          return fetchFailure(init, elapsed + 15_000);
        }
      }
    }
    if (key.includes("pilot/profile-builder/") && value.leaseUntil === null) summaryWrites++;
    return commit();
  };
  globalThis.fetch = async (...args) => {
    try { return await transport(...args); } catch (error) {
      if (error instanceof assert.AssertionError) invariantFailures.push(error.message);
      throw error;
    }
  };
  const storage = { ...r2, readVersionedTextFromR2: async (key, options = {}) => {
    phase = options.signal === countSignal ? "count" : options.signal === summarySignal ? "summary" : undefined;
    try { return await r2.readVersionedTextFromR2(key, options); } finally { phase = undefined; }
  } };
  const overrides = { "@/lib/r2-warehouse": storage, "node:timers/promises": pause,
    "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => prefix + key },
    "@/lib/simple-alert-pilot-runtime": { isSimpleAlertPilot: () => true },
    "@/lib/simple-alert-pilot-scope": { pilotCompanies: () => [] },
    "@/lib/opportunity-engine/pr262-sensor-fetch-budget": { createPr262SensorBudgetedFetch: async input => ({ fetchImpl: input.fetchImpl, flush: async () => {} }) },
    "@/lib/equity-signal/universe": { loadEquityUniverse: async () => { advance(35_000); return { snapshot: { refreshedAt: new Date(start).toISOString(), entries: [{ ...identity,
      name: identity.company, exchange: "Nasdaq", securityType: "common_stock", sourceNames: ["SEC company_tickers_exchange"] }] } }; } },
  };
  const cache = loadTsModule("@/lib/opportunity-engine/company-profile-cache", overrides);
  const builder = loadTsModule("@/lib/simple-alert-profile-builder", { ...overrides, "@/lib/opportunity-engine/company-profile-cache": cache });
  const fixture = companyProfileFixture(identity, new Date(start));
  const sourceStarts = [];
  const result = await builder.runSimpleAlertProfileBuilder(new Date(start), async (url, init) => {
    init.signal.throwIfAborted(); sourceStarts.push(elapsed);
    if (String(url).includes("submissions")) return Response.json({ cik: 1, tickers: [identity.ticker], filings: { recent: {
      form: ["10-K"], filingDate: [fixture.sourceFiledAt], accessionNumber: ["0000000001-26-000001"], primaryDocument: ["annual.htm"],
    } } });
    return new Response(`<h2>Item 1. Business</h2><p>${fixture.business}</p><p>${"The company maintains regional facilities and provides ongoing implementation support for its software. ".repeat(8)}</p><h3>Customers</h3><p>${fixture.customers}</p><h2>Item 1A. Risk Factors</h2>`);
  });
  const recoverable = ["put_timeout_applied", "other_row_winner", "readback_timeout_applied", "readback_502_applied", "role_applied"].includes(mode);
  const recovered = !baseline && recoverable;
  assert.equal(result.status, recovered ? workSignal.aborted ? "time_budget_reached" : "completed" : "failed", `${stage}/${mode}: ${JSON.stringify(result)}`);
  assert.equal(result.failureCategory, recovered ? null : "storage");
  assert.equal(result.requestFailures, 0); assert.equal(result.modelCalls, 0);
  assert.equal(result.verificationCountsStatus, "cache_reconciled", "Counts alone never acknowledge the ambiguous intent");
  assert.equal(summaryWrites, 1);
  assert.equal(targetPuts, mode.endsWith("read_timeout") ? 0 : 1, "Read-only settlement must never send another target PUT");
  assert.ok(sourceStarts.every(at => at < 140_000), "No source starts after the original work cutoff");
  assert.equal(result.verifiedThisRun, recovered && !(stage === "admission" && workSignal.aborted) ? 1 : 0);
  if (mode === "other_row_winner") assert.deepEqual(current().entries.find(row => row.ticker === other.ticker), other);
  if (mode === "same_row_winner") assert.equal(current().entries[0].error, "preserve_same_row_winner");
  if (stage === "admission" && !recovered) assert.equal(sourceStarts.length, 0);
  if (mode.startsWith("persistence_")) {
    assert.equal(persistenceSignal.aborted, true);
    assert.equal(faultReads, 0, "An expired caller reserve cannot be escaped for settlement");
  }
  if (["put_403", "readback_403_applied", "readback_malformed_applied"].includes(mode)) assert.ok(faultReads <= (mode.includes("malformed") ? 2 : 1), "Permanent/schema failures do not acquire settlement reads");
  const noRead = mode.endsWith("read_timeout") || mode === "put_403" || mode.startsWith("persistence_");
  const ordinaryReads = mode.startsWith("readback_") ? mode.includes("malformed") ? 2 : 1 : mode === "conflict_then_timeout" ? 1 : 0;
  const settlementEligible = !noRead && !["readback_403_applied", "readback_malformed_applied", "conflict_then_timeout"].includes(mode);
  assert.equal(faultReads, ordinaryReads + Number(!baseline && settlementEligible) + Number(recovered && stage === "admission"),
    "An eligible failed row gets exactly one settlement GET, plus only existing normal reads");
  if (!baseline) {
    assert.equal(result.failureOperationFamily, recovered ? null : "profile_workers");
    const diagnostic = logs.filter(value => value.startsWith("[company-profile-storage]")).map(value => JSON.parse(value.slice("[company-profile-storage] ".length)))[0];
    assert.ok(diagnostic);
    assert.equal(diagnostic.stage, mode === "initial_read_timeout" ? "initial" : stage === "final" ? "verified" : stage);
    assert.equal(diagnostic.writes, mode.endsWith("read_timeout") ? 0 : 1);
    assert.equal(diagnostic.ticker, identity.ticker);
    assert.equal(diagnostic.settlement, recovered || mode === "source_fault_pending_settlement" ? "exact_intent"
      : !settlementEligible ? "not_attempted" : ["put_timeout_unapplied", "same_row_winner", "role_unapplied"].includes(mode) ? "different_intent" : "unavailable");
    assert.ok(Object.keys(diagnostic).every(key => ["stage", "phase", "ticker", "writes", "queueMs", "durationMs", "cause", "transactionDeadline", "workDeadline", "persistenceDeadline", "settlement"].includes(key)), "Diagnostics expose controlled fields only");
  }
  if (mode === "source_fault_pending_settlement") {
    assert.equal(result.failure, baseline ? "Deadline 15000" : "r2_state_read_http_502", "Settling the pending row cannot clear its independent source-cache fault");
    assert.equal(sourceStarts.length, 1);
    assert.equal(faultReads, baseline ? 0 : 1);
  }
  assert.deepEqual(invariantFailures, [], "Fault injection assertions must never be swallowed by production error handling");
  observations.push({ stage, mode, status: result.status, failure: result.failure, durationMs: result.durationMs,
    targetPuts, faultReads, sourceRequests: sourceStarts.length, companyResultLogs: logs.filter(value => value.includes('"kind":"pr262_company_profile_result"')).length,
    verifiedThisRun: result.verifiedThisRun, newlyVerifiedThisRun: result.newlyVerifiedThisRun,
    diagnostics: logs.filter(value => value.startsWith("[company-profile-storage]")) });
}

async function runQueue() {
  // Two transactions expire together while one owns the FIFO. The applied
  // holder may settle, but its cancelled waiter has no attempted PUT to settle.
  globalThis.Date = NativeDate;
  let clock = 0, transactionCount = 0, releaseQueued;
  const queued = new Promise(resolve => { releaseQueued = resolve; });
  const timers = [], objects = new Map(), revisions = new Map(), puts = [], logs = [], sources = [];
  const peer = { ticker: "PEER", company: "Peer Software", cik: "0000000002" };
  const third = { ticker: "THIRD", company: "Third Software", cik: "0000000003" };
  AbortSignal.timeout = ms => {
    const controller = new AbortController(); timers.push({ controller, at: clock + ms, ms });
    if (ms === 15_000 && ++transactionCount === 2) releaseQueued();
    return controller.signal;
  };
  const advance = ms => {
    clock += ms;
    for (const timer of timers) if (timer.at <= clock && !timer.controller.signal.aborted) timer.controller.abort(new DOMException(`Deadline ${timer.ms}`, "TimeoutError"));
  };
  const pause = { setTimeout: async (_ms, value, options = {}) => { options.signal?.throwIfAborted(); return value; } };
  const r2 = loadTsModule("@/lib/r2-warehouse", { "@/lib/db/client": { prisma: {} },
    "@/lib/redact-secrets": { redactSecrets: value => value }, "node:timers/promises": pause });
  console.info = value => logs.push(value); console.warn = value => logs.push(value);
  let failureThrown = false;
  globalThis.fetch = async (url, init) => {
    assert.equal(new URL(url).hostname, "row-settlement.invalid");
    init.signal.throwIfAborted();
    const key = decodeURIComponent(new URL(url).pathname).replace(/^\/test-only\//, "");
    if (init.method === "GET") return objects.has(key) ? new Response(objects.get(key), { headers: { etag: `"${revisions.get(key)}"` } }) : new Response(null, { status: 404 });
    assert.equal(init.method, "PUT");
    assert.equal(key, profileKey);
    const value = JSON.parse(r2.decodeVersionedR2Text(Buffer.from(init.body)));
    puts.push(value.entries[0].ticker);
    if ((init.headers["if-match"] && init.headers["if-match"] !== `"${revisions.get(key)}"`)
      || (init.headers["if-none-match"] && objects.has(key))) return new Response(null, { status: 412 });
    objects.set(key, Buffer.from(init.body)); revisions.set(key, (revisions.get(key) ?? 0) + 1);
    if (!failureThrown) {
      failureThrown = true;
      await queued;
      advance(15_000); init.signal.throwIfAborted();
    }
    return new Response(null, { headers: { etag: `"${revisions.get(key)}"` } });
  };
  const cache = loadTsModule("@/lib/opportunity-engine/company-profile-cache", { "@/lib/r2-warehouse": r2,
    "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => prefix + key }, "node:timers/promises": pause });
  const role = new AbortController(), persistence = new AbortController();
  const ensure = row => cache.ensureCompanyProfile(row, async () => {
    sources.push(row.ticker);
    return Response.json({ cik: Number(row.cik), tickers: [row.ticker], filings: { recent: { form: [], filingDate: [], accessionNumber: [], primaryDocument: [] } } });
  }, new Date(start), { signal: role.signal, persistenceSignal: persistence.signal });
  const results = await Promise.allSettled([ensure(identity), ensure(peer)]);
  assert.equal(results[0].status, baseline ? "rejected" : "fulfilled");
  assert.equal(results[1].status, "rejected");
  assert.equal(puts.includes(peer.ticker), false, "A cancelled FIFO waiter must never inherit the lock or write");
  if (!baseline) {
    const peerDiagnostic = logs.find(value => value.startsWith("[company-profile-storage]") && value.includes('"ticker":"PEER"'));
    assert.ok(peerDiagnostic?.includes('"phase":"queue"'));
    assert.ok(peerDiagnostic?.includes('"writes":0'));
    assert.ok(peerDiagnostic?.includes('"settlement":"not_attempted"'));
  }
  assert.equal(await ensure(third), null, "Cancelling a waiter leaves the FIFO usable by the next issuer");
  assert.deepEqual(sources, baseline ? [third.ticker] : [identity.ticker, third.ticker]);
  observations.push({ mode: "queue_wait_timeout", holder: results[0].status, waiter: results[1].status, puts, sourceRequests: sources.length });
}

try {
  for (const stage of ["admission", "final"]) for (const mode of ["put_timeout_applied", "put_timeout_unapplied", "put_timeout_unknown_applied", "put_timeout_unknown_unapplied",
    "other_row_winner", "same_row_winner", "conflict_then_timeout", "readback_timeout_applied", "readback_502_applied", "readback_403_applied", "readback_malformed_applied",
    "put_403", "persistence_applied", "persistence_unapplied", "role_applied", "role_unapplied", "settlement_timeout", "settlement_persistence_cutoff", "settlement_missing_etag", "settlement_duplicate"]) await run(stage, mode);
  for (const mode of ["initial_read_timeout", "admission_read_timeout"]) await run("admission", mode);
  await run("pending", "source_fault_pending_settlement");
  await runQueue();
} finally {
  globalThis.Date = NativeDate; AbortSignal.timeout = nativeTimeout; globalThis.fetch = savedFetch;
  console.info = savedInfo; console.warn = savedWarn;
  for (const name of Object.keys(process.env)) if (!(name in savedEnv)) delete process.env[name];
  Object.assign(process.env, savedEnv);
}
if (process.env.PROFILE_SETTLEMENT_REPORT) writeFileSync(process.env.PROFILE_SETTLEMENT_REPORT, `${JSON.stringify({ baseline, observations }, null, 2)}\n`);
console.log(`${baseline ? "Baseline reproduction" : "Read-only settlement"}: ${observations.length} real builder/cache/R2 cases passed.`);
