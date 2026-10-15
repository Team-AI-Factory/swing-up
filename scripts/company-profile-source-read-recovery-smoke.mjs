import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";

// Real builder, profile cache and R2 GET transport. All data/storage/clock/
// signals are synthetic; no real network, providers, credentials or sleeps.
const original = { fetch: globalThis.fetch, performance: globalThis.performance,
  timeout: AbortSignal.timeout, warn: console.warn, info: console.info, env: { ...process.env } };
Object.assign(process.env, { R2_ENDPOINT: "https://storage.invalid", R2_BUCKET: "synthetic-bucket",
  R2_ACCESS_KEY_ID: "synthetic-key", R2_SECRET_ACCESS_KEY: "synthetic-secret", SWING_UP_SIMPLE_PILOT_ROLE: "profiles" });
const profile = loadTsModule("@/lib/company-profile");
const r2 = loadTsModule("@/lib/r2-warehouse", { "@/lib/db/client": { prisma: {} } });
const profileKey = "research-evidence/company-profiles-v1.json";
let clock = 1000, timeouts = [], warnings = [];

async function scenario(mode, { count = 1, direct = false, directRetry = false, directRetrySignals = "both" } = {}) {
  clock = 1000; timeouts = []; warnings = [];
  const now = new Date(), sources = new Map(), failures = [], calls = new Map(), writes = [], callerSignals = [];
  let sourceRequests = 0, revision = 1, firstReads = 0, unblock;
  const barrier = new Promise(resolve => { unblock = resolve; });
  const entries = Array.from({ length: count }, (_, index) => {
    const identity = { ticker: index ? "OTHER" : "CTKB", company: `Synthetic Software ${index + 1}`, cik: String(index + 1).padStart(10, "0") };
    const fixture = companyProfileFixture(identity, now);
    const filing = { url: fixture.sourceUrl, form: "10-K", filedAt: fixture.sourceFiledAt,
      checkedAt: new Date(now.getTime() - 3600000).toISOString(), industry: "Software" };
    const path = `research-evidence/company-profile-sources/${identity.cik}/${fixture.sourceUrl.split("/").slice(-2).join("-")}.json`;
    sources.set(path, { version: 1, layoutRevision: 1, parserRevision: profile.COMPANY_PROFILE_PARSER_REVISION,
      url: filing.url, filedAt: filing.filedAt, businessText: `${fixture.business}\n${fixture.customers}\n${"We operate offices and support our software products. ".repeat(12)}` });
    return { ...identity, filing, profile: null, parserRevision: profile.COMPANY_PROFILE_PARSER_REVISION,
      error: "source_request_failed", updatedAt: new Date(now.getTime() - 86400000).toISOString(), nextAttemptAt: new Date(now.getTime() - 1000).toISOString() };
  });
  const objects = new Map([[profileKey, { version: 1, entries }]]);
  const storage = {
    readVersionedTextFromR2: async (key, options = {}) => {
      options.signal?.throwIfAborted();
      if (sources.has(key)) { callerSignals.push(options.signal); return r2.readVersionedTextFromR2(key, options); }
      return objects.has(key) ? { found: true, text: JSON.stringify(objects.get(key)), etag: String(revision) }
        : { found: false, text: null, etag: null };
    },
    writeVersionedJsonToR2: async (key, value, options = {}) => {
      options.signal?.throwIfAborted();
      assert.ok(!sources.has(key), "No source PUT is needed for saved-source recovery");
      if (options.expectedEtag && options.expectedEtag !== String(revision)) return { written: false, conflict: true };
      if (options.createOnly && objects.has(key)) return { written: false, conflict: true };
      writes.push(key); objects.set(key, structuredClone(value)); revision++;
      return { written: true, conflict: false, etag: String(revision) };
    },
  };
  const overrides = {
    "@/lib/company-profile": profile,
    "@/lib/r2-warehouse": storage,
    "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => key },
    "@/lib/simple-alert-pilot-runtime": { isSimpleAlertPilot: () => true },
    "@/lib/simple-alert-pilot-scope": { pilotCompanies: () => [] },
    "@/lib/equity-signal/universe": { loadEquityUniverse: async () => ({ snapshot: { refreshedAt: now.toISOString(), entries: entries.map(row => ({
      ...row, name: row.company, exchange: "Nasdaq", securityType: "common_stock", sourceNames: ["SEC company_tickers_exchange"],
    })) } }) },
    "@/lib/opportunity-engine/pr262-sensor-fetch-budget": { createPr262SensorBudgetedFetch: async input => ({ fetchImpl: input.fetchImpl, flush: async () => {} }) },
  };
  const cache = loadTsModule("@/lib/opportunity-engine/company-profile-cache", overrides);
  const builder = loadTsModule("@/lib/simple-alert-profile-builder", { ...overrides, "@/lib/opportunity-engine/company-profile-cache": cache });
  globalThis.fetch = async (url, init) => {
    assert.equal(new URL(url).hostname, "storage.invalid"); assert.equal(init.method, "GET");
    const key = decodeURIComponent(new URL(url).pathname).split("/synthetic-bucket/")[1];
    assert.ok(sources.has(key), "Only the exact annual source is read through transport");
    const call = (calls.get(key) ?? 0) + 1; calls.set(key, call);
    const requestTimeout = timeouts.at(-1);
    assert.equal(requestTimeout.milliseconds, 20_000, "Keep each original request cap");
    init.signal.addEventListener("abort", () => {}, { once: true });
    if (count === 2 && call === 1) {
      if (++firstReads === 2) unblock();
      await barrier;
    }
    if (call === 2 && mode === "retry_work_abort") {
      clock += 20_000;
      timeouts.find(item => item.milliseconds === 140_000).controller.abort(new DOMException("work ended during retry", "TimeoutError"));
      throw init.signal.reason;
    }
    if (call === 2 && mode === "retry_persistence_expired") timeouts.find(item => item.milliseconds === 160_000).controller.abort(new DOMException("persistence ended during retry", "TimeoutError"));
    if (call === 2 && mode === "retry_http_403") return new Response("private denied", { status: 403 });
    if (call === 2 && mode !== "persistent") return Response.json(sources.get(key), { headers: { etag: '"source-v1"' } });
    if (mode === "healthy") return Response.json(sources.get(key), { headers: { etag: '"source-v1"' } });
    if (mode === "http_403" || mode === "http_500") return new Response("private response", { status: Number(mode.slice(5)) });
    if (mode === "transport") throw new TypeError("private transport error");
    if (mode === "malformed") return new Response("not JSON", { headers: { etag: '"source-v1"' } });
    const fail = () => {
      clock += 20_000;
      const reason = new DOMException("The operation was aborted due to timeout", "TimeoutError");
      if (mode === "work_abort") {
        timeouts.find(item => item.milliseconds === 140_000).controller.abort(reason);
        requestTimeout.controller.abort(new DOMException("later timeout", "TimeoutError"));
      } else {
        requestTimeout.controller.abort(reason);
        if (mode === "admission_expired") timeouts.find(item => item.milliseconds === 100_000).controller.abort(new DOMException("admission ended", "TimeoutError"));
        if (mode === "persistence_expired") timeouts.find(item => item.milliseconds === 160_000).controller.abort(new DOMException("persistence ended", "TimeoutError"));
        if (mode === "insufficient_time") clock = 122_000; // <20s remains, even if timer delivery is late.
        if (mode === "late_admission_timer") clock = 106_000; // 105s elapsed; the 100s signal has not fired yet.
        if (mode === "invalid_clock") clock = 0;
      }
      const error = mode === "native_body_abort" ? new DOMException("The operation was aborted", "AbortError") : init.signal.reason;
      failures.push(error); throw error;
    };
    if (mode === "body" || mode === "native_body_abort") return { status: 200, ok: true, headers: new Headers(), arrayBuffer: fail };
    return fail();
  };
  const noSource = async () => { sourceRequests++; throw new Error("No source request permitted"); };
  const directOptions = directRetry ? { reserveSourceReadRetry: () => true,
    ...(directRetrySignals === "both" || directRetrySignals === "work" ? { signal: new AbortController().signal } : {}),
    ...(directRetrySignals === "both" || directRetrySignals === "persistence" ? { persistenceSignal: new AbortController().signal } : {}),
  } : {};
  let result, thrown;
  try { result = direct ? await cache.ensureCompanyProfile(entries[0], noSource, now, directOptions) : await builder.runSimpleAlertProfileBuilder(now, noSource); }
  catch (error) { thrown = error; }
  const diagnostics = warnings.filter(row => row.startsWith("[company-profile-storage] ")).map(row => JSON.parse(row.split("] ")[1]));
  assert.equal(sourceRequests, 0, "R2 recovery never spends source requests or bypasses provider guards");
  assert.ok(warnings.every(row => !/private|storage\.invalid|synthetic-key|secret|authorization|source-v1/.test(row)), "Controlled diagnostics contain no raw transport data");
  assert.ok(callerSignals.every(signal => signal === callerSignals[0]), "Retry retains the exact original work signal");
  return { result, thrown, entries: objects.get(profileKey).entries, calls: [...calls.values()], diagnostics, writes, failures };
}

try {
  globalThis.performance = { now: () => clock };
  AbortSignal.timeout = milliseconds => { const controller = new AbortController(); timeouts.push({ milliseconds, controller }); return controller.signal; };
  console.warn = message => warnings.push(message); console.info = () => {};
  for (const mode of ["header", "body"]) {
    const s = await scenario(mode);
    assert.equal(s.thrown, undefined); assert.equal(s.result.ok, true); assert.deepEqual(s.calls, [2]);
    assert.equal(s.result.verifiedThisRun, 1); assert.equal(s.result.newlyVerifiedThisRun, 1); assert.equal(s.result.newlyVerifiedToday, 1);
    assert.equal(s.result.sourceReadRetryAdmissions, 1); assert.equal(s.result.sourceReadRetryRecoveries, 1);
    assert.equal(s.result.requests, 0); assert.equal(s.result.requestFailures, 0); assert.equal(s.result.modelCalls, 0);
    assert.equal(s.writes.filter(key => key === profileKey).length, 2, "Ordinary admission plus verified CAS only");
    assert.equal(s.diagnostics.length, 1); assert.equal(s.diagnostics[0].stage, "annual_source");
    assert.equal(s.diagnostics[0].responsePhase, mode === "header" ? "response_headers" : "response_body");
    assert.equal(s.diagnostics[0].retryAdmitted, true); assert.equal(s.diagnostics[0].requestDurationMs, 20_000);
    assert.equal(s.diagnostics[0].requestAbortSource, "r2_request_timeout");
    assert.deepEqual(timeouts.slice(0, 5).map(row => row.milliseconds), [100_000, 140_000, 160_000, 175_000, 235_000]);
  }
  const failed = await scenario("persistent");
  assert.deepEqual(failed.calls, [2]); assert.equal(failed.result.ok, false);
  assert.equal(failed.result.failureCategory, "storage"); assert.equal(failed.result.failureOperationFamily, "profile_workers");
  assert.equal(failed.result.sourceReadRetryAdmissions, 1); assert.equal(failed.result.sourceReadRetryRecoveries, 0);
  assert.equal(failed.result.newlyVerifiedToday, 0); assert.equal(failed.result.verificationCountsStatus, "cache_reconciled");
  assert.match(failed.entries[0].error, /^company_profile_storage_read_failed:/);
  assert.equal(failed.writes.filter(key => key === profileKey).length, 2, "Failed read retains ordinary durable pending backoff");
  assert.deepEqual(failed.diagnostics.map(row => [row.readAttempt, row.retryAdmitted]), [[1, true], [2, false]]);
  assert.ok(Date.parse(failed.entries[0].nextAttemptAt) - Date.parse(failed.entries[0].updatedAt) === 3600000);
  const changedFailure = await scenario("retry_http_403");
  assert.deepEqual(changedFailure.calls, [2]); assert.equal(changedFailure.result.ok, false);
  assert.equal(changedFailure.result.failure, "r2_state_read_http_403", "The second failure is preserved, not replaced by the first timeout");
  assert.equal(changedFailure.diagnostics[1].cause, "http_403");
  const exactFailure = await scenario("persistent", { direct: true, directRetry: true });
  assert.equal(exactFailure.thrown.cause, exactFailure.failures[1], "Original second transport error identity remains available");

  const parallel = await scenario("header", { count: 2 });
  assert.deepEqual(parallel.calls.sort(), [1, 2], "Two simultaneous failures share one spare GET for the entire batch");
  assert.equal(parallel.result.sourceReadRetryAdmissions, 1); assert.equal(parallel.result.sourceReadRetryRecoveries, 1);
  assert.equal(parallel.result.ok, false); assert.equal(parallel.result.storageFailureObserved, true);
  assert.equal(parallel.result.newlyVerifiedThisRun, 1); assert.equal(parallel.result.newlyVerifiedToday, 1);

  for (const mode of ["http_403", "http_500", "transport", "native_body_abort", "admission_expired", "insufficient_time", "late_admission_timer", "invalid_clock"]) {
    const s = await scenario(mode);
    assert.deepEqual(s.calls, [1], mode); assert.equal(s.result.ok, false, mode);
    assert.equal(s.result.sourceReadRetryAdmissions, 0, mode); assert.equal(s.result.sourceReadRetryRecoveries, 0, mode);
    assert.ok(s.diagnostics.every(row => row.retryAdmitted === false), mode);
  }
  const persistenceEnded = await scenario("persistence_expired");
  assert.deepEqual(persistenceEnded.calls, [1]); assert.equal(persistenceEnded.result.sourceReadRetryAdmissions, 0);
  assert.equal(persistenceEnded.result.ok, false, "A failed pending CAS remains fatal");
  const workEnded = await scenario("work_abort");
  assert.deepEqual(workEnded.calls, [1]); assert.equal(workEnded.result.sourceReadRetryAdmissions, 0);
  assert.equal(workEnded.result.status, "time_budget_reached"); assert.equal(workEnded.result.newlyVerifiedToday, 0);
  const retryWorkEnded = await scenario("retry_work_abort");
  assert.deepEqual(retryWorkEnded.calls, [2]); assert.equal(retryWorkEnded.result.sourceReadRetryAdmissions, 1);
  assert.equal(retryWorkEnded.result.sourceReadRetryRecoveries, 0); assert.equal(retryWorkEnded.result.status, "time_budget_reached");
  assert.equal(retryWorkEnded.result.newlyVerifiedToday, 0);
  const retryPersistenceEnded = await scenario("retry_persistence_expired");
  assert.deepEqual(retryPersistenceEnded.calls, [2]); assert.equal(retryPersistenceEnded.result.sourceReadRetryRecoveries, 1);
  assert.equal(retryPersistenceEnded.result.ok, false); assert.equal(retryPersistenceEnded.result.failureCategory, "storage");
  assert.equal(retryPersistenceEnded.result.newlyVerifiedToday, 0, "A recovered source GET cannot acknowledge a failed profile PUT");
  const noOwner = await scenario("header", { direct: true });
  assert.deepEqual(noOwner.calls, [1]); assert.equal(noOwner.thrown.storageDomain, "r2_state", "Other entrypoints gain no unbudgeted retries");
  for (const directRetrySignals of ["none", "work", "persistence"]) {
    const missingSignal = await scenario("header", { direct: true, directRetry: true, directRetrySignals });
    assert.deepEqual(missingSignal.calls, [1]); assert.equal(missingSignal.thrown.storageDomain, "r2_state", "A callback without both original role signals cannot admit a retry");
  }
  const healthy = await scenario("healthy");
  assert.deepEqual(healthy.calls, [1]); assert.equal(healthy.result.sourceReadRetryAdmissions, 0); assert.equal(healthy.result.newlyVerifiedThisRun, 1);
  const malformed = await scenario("malformed");
  assert.deepEqual(malformed.calls, [1]); assert.equal(malformed.result.sourceReadRetryAdmissions, 0); assert.equal(malformed.result.newlyVerifiedThisRun, 0);
} finally {
  globalThis.fetch = original.fetch; globalThis.performance = original.performance; AbortSignal.timeout = original.timeout;
  console.warn = original.warn; console.info = original.info;
  for (const key of Object.keys(process.env)) if (!(key in original.env)) delete process.env[key];
  Object.assign(process.env, original.env);
}
console.log("Annual-source GET recovery: real transport headers/body rescue, one global retry, unchanged caps/CAS/provider counts, truthful failures, backoff and deadline guards passed.");
