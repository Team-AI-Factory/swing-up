import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";

// Actual cache + R2 code, controlled fetch/clock/signals only. No real network,
// timer sleeps, production credentials or changes to production timeout values.
const original = { fetch: globalThis.fetch, performance: globalThis.performance, timeout: AbortSignal.timeout,
  warn: console.warn, info: console.info, env: { ...process.env } };
Object.assign(process.env, { R2_ENDPOINT: "https://storage.invalid", R2_BUCKET: "synthetic-bucket",
  R2_ACCESS_KEY_ID: "synthetic-key", R2_SECRET_ACCESS_KEY: "synthetic-secret", SWING_UP_SIMPLE_PILOT_ROLE: "profiles" });
const r2 = loadTsModule("@/lib/r2-warehouse", { "@/lib/db/client": { prisma: {} } });
const identity = { ticker: "MIND", company: "Synthetic issuer", cik: "0000000001" };
const now = new Date("2026-10-15T00:00:00Z");
const key = "research-evidence/company-profiles-v1.json";
const overrides = { "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: path => path } };
let transportFailure;
const storage = { ...r2, readVersionedTextFromR2: async (...args) => {
  try { return await r2.readVersionedTextFromR2(...args); } catch (error) { transportFailure = error; throw error; }
} };
const cache = loadTsModule("@/lib/opportunity-engine/company-profile-cache", { ...overrides, "@/lib/r2-warehouse": storage });
const cases = [
  ["header_timeout", "response_headers", "r2_request_timeout", true],
  ["body_timeout", "response_body", "r2_request_timeout", true],
  ["body_native_abort", "response_body", "r2_request_timeout", false],
  ["timeout_then_caller", "response_headers", "r2_request_timeout", true],
  ["caller_then_timeout", "response_headers", "caller", true],
  ["wrapped_caller", "response_headers", "caller", true],
  ["http_with_caller", "response_headers", "caller", false],
  ["body_failure", "response_body", "none", false],
  ["decode_failure", "decode", "none", false],
  ["transport_failure", "response_headers", "none", false],
];
let clock = 1000, timeouts = [], warnings = [];
try {
  globalThis.performance = { now: () => clock };
  AbortSignal.timeout = milliseconds => {
    const controller = new AbortController();
    timeouts.push({ milliseconds, controller });
    return controller.signal;
  };
  console.warn = message => warnings.push(message);
  console.info = () => {};
  for (const [mode, phase, abortSource, matched] of cases) {
    clock = 1000; timeouts = []; warnings = []; transportFailure = undefined;
    const work = new AbortController(), persistence = new AbortController();
    let gets = 0, sources = 0;
    const timeoutReason = new DOMException("private timeout reason", "TimeoutError");
    const callerReason = new DOMException("private caller reason", "TimeoutError");
    globalThis.fetch = async (url, init) => {
      assert.equal(new URL(url).hostname, "storage.invalid");
      assert.equal(init.method, "GET", "No admission or other PUT may occur after an initial-read failure");
      gets++;
      // Native fetch subscribes to the composed signal. Subscribe here too so
      // first-abort ordering is exercised rather than lazy signal inspection.
      init.signal.addEventListener("abort", () => {}, { once: true });
      clock += 40;
      const expireRequest = () => timeouts.at(-1).controller.abort(timeoutReason);
      if (["header_timeout", "timeout_then_caller"].includes(mode)) {
        expireRequest();
        if (mode === "timeout_then_caller") work.abort(callerReason);
        throw init.signal.reason;
      }
      if (["caller_then_timeout", "wrapped_caller"].includes(mode)) {
        work.abort(callerReason);
        if (mode === "caller_then_timeout") expireRequest();
        throw mode === "wrapped_caller" ? new Error("wrapped cancellation", { cause: init.signal.reason }) : init.signal.reason;
      }
      if (mode === "http_with_caller") { work.abort(callerReason); return new Response("private HTTP body", { status: 502 }); }
      if (mode === "transport_failure") throw new TypeError("fetch failed");
      return { status: 200, ok: true, headers: new Headers({ etag: '"synthetic"' }), arrayBuffer: async () => {
        clock += 60;
        if (["body_timeout", "body_native_abort"].includes(mode)) {
          expireRequest();
          throw mode === "body_native_abort" ? new DOMException("The operation was aborted", "AbortError") : init.signal.reason;
        }
        if (mode === "body_failure") throw new Error("private body failure");
        return new Uint8Array([0x1f, 0x8b, 0x00]);
      } };
    };
    let failure;
    const result = await cache.ensureCompanyProfile(identity, async () => { sources++; throw new Error("source forbidden"); }, now,
      { signal: work.signal, persistenceSignal: persistence.signal }).catch(error => { failure = error; });
    assert.equal(gets, 1); assert.equal(sources, 0);
    assert.deepEqual(timeouts.map(item => item.milliseconds), [20_000], "One original 20s transport budget, no new timer or retry");
    assert.equal(persistence.signal.aborted, false);
    assert.equal(transportFailure.storageDomain, "r2_state"); assert.equal(transportFailure.storageOperation, "read");
    const duration = phase === "response_headers" ? 40 : 100;
    assert.deepEqual(transportFailure.storageReadDiagnostics, { responsePhase: phase, readDurationMs: duration,
      requestDurationMs: duration, requestTimeoutMs: 20_000, requestAbortSource: abortSource, abortReasonMatched: matched }, mode);
    if (["caller_then_timeout", "wrapped_caller"].includes(mode)) {
      assert.equal(result, null); assert.equal(failure, undefined); assert.deepEqual(warnings, [], "Exact role cancellation stays a quiet deferral");
    } else {
      assert.equal(failure, transportFailure, "Diagnostics must not alter the rethrown error");
      assert.equal(warnings.length, 1);
      const diagnostic = JSON.parse(warnings[0].split("] ")[1]);
      assert.deepEqual(diagnostic, { stage: "initial", phase: "read", ticker: "MIND", writes: 0, durationMs: duration,
        cause: mode === "http_with_caller" ? "http_502" : mode === "body_native_abort" ? "abort"
          : mode.includes("timeout") ? "timeout" : "other", ...transportFailure.storageReadDiagnostics,
        workDeadline: work.signal.aborted, persistenceDeadline: false, settlement: "not_attempted" });
      assert.ok(!/private|synthetic|storage\.invalid|authorization|secret|etag/.test(warnings[0]));
    }
  }

  // Pre-aborted work does no I/O; JSON parse failures remain errors, not empty
  // cache success. Healthy plain/gzip reads and 404 retain their exact contract.
  warnings = []; timeouts = [];
  const aborted = new AbortController(); aborted.abort(new Error("already ended"));
  globalThis.fetch = async () => { throw new Error("No request permitted"); };
  assert.equal(await cache.ensureCompanyProfile(identity, globalThis.fetch, now, { signal: aborted.signal }), null);
  assert.deepEqual(timeouts, []); assert.deepEqual(warnings, []);
  for (const body of ["not JSON", gzipSync(Buffer.from("not JSON"))]) {
    warnings = []; let gets = 0;
    globalThis.fetch = async () => { gets++; clock += 7; return new Response(body, { headers: { etag: "v1" } }); };
    await assert.rejects(() => cache.ensureCompanyProfile(identity, async () => { throw new Error("source forbidden"); }, now), SyntaxError);
    assert.equal(gets, 1);
    const diagnostic = JSON.parse(warnings[0].split("] ")[1]);
    assert.equal(diagnostic.cause, "invalid_json"); assert.equal(diagnostic.durationMs, 7);
    assert.equal(diagnostic.responsePhase, "unknown", "Application JSON failure is not assigned a fabricated transport phase");
  }
  const payload = JSON.stringify({ version: 1, entries: [{ ...identity, profile: null, nextAttemptAt: "2026-10-16T00:00:00Z" }] });
  for (const body of [payload, gzipSync(Buffer.from(payload))]) {
    warnings = []; let gets = 0;
    globalThis.fetch = async () => { gets++; return new Response(body, { headers: { etag: "v1" } }); };
    assert.equal(await cache.ensureCompanyProfile(identity, async () => { throw new Error("source forbidden"); }, now), null);
    assert.equal(gets, 1); assert.deepEqual(warnings, []);
    assert.deepEqual(await r2.readVersionedTextFromR2(key), { found: true, text: payload, etag: '"v1"' });
  }
  globalThis.fetch = async () => new Response(null, { status: 404 });
  assert.deepEqual(await r2.readVersionedTextFromR2(key), { found: false, text: null, etag: null });

  // The real builder must still fail as storage/profile_workers while its
  // existing read-only reconciliation reports authoritative zero counts.
  for (const phase of ["headers", "body"]) {
    warnings = []; timeouts = []; let reads = 0, gets = 0, profileWrites = 0, sources = 0;
    const objects = new Map([[key, { version: 1, entries: [] }]]);
    const builderStorage = {
      readVersionedTextFromR2: async (path, options = {}) => {
        if (path === key && ++reads === 2) return r2.readVersionedTextFromR2(path, options);
        return objects.has(path) ? { found: true, text: JSON.stringify(objects.get(path)), etag: '"synthetic"' }
          : { found: false, text: null, etag: null };
      },
      writeVersionedJsonToR2: async (path, value) => {
        if (path === key) profileWrites++;
        objects.set(path, structuredClone(value)); return { written: true, conflict: false, etag: '"synthetic"' };
      },
    };
    const builderOverrides = { ...overrides, "@/lib/r2-warehouse": builderStorage,
      "@/lib/simple-alert-pilot-runtime": { isSimpleAlertPilot: () => true },
      "@/lib/simple-alert-pilot-scope": { pilotCompanies: () => [] },
      "@/lib/equity-signal/universe": { loadEquityUniverse: async () => ({ snapshot: { refreshedAt: new Date().toISOString(),
        entries: [{ ...identity, name: identity.company, exchange: "Nasdaq", securityType: "common_stock", sourceNames: ["SEC company_tickers_exchange"] }] } }) },
      "@/lib/opportunity-engine/pr262-sensor-fetch-budget": { createPr262SensorBudgetedFetch: async input => ({ fetchImpl: input.fetchImpl, flush: async () => {} }) },
    };
    const builderCache = loadTsModule("@/lib/opportunity-engine/company-profile-cache", builderOverrides);
    const builder = loadTsModule("@/lib/simple-alert-profile-builder", { ...builderOverrides, "@/lib/opportunity-engine/company-profile-cache": builderCache });
    globalThis.fetch = async (_url, init) => {
      assert.equal(init.method, "GET"); gets++;
      const fail = () => { clock += 20_000; timeouts.at(-1).controller.abort(new DOMException("request timed out", "TimeoutError")); throw init.signal.reason; };
      if (phase === "headers") return fail();
      return { status: 200, ok: true, headers: new Headers(), arrayBuffer: fail };
    };
    const result = await builder.runSimpleAlertProfileBuilder(new Date(), async () => { sources++; throw new Error("source forbidden"); });
    assert.equal(result.ok, false); assert.equal(result.status, "failed");
    assert.equal(result.failureCategory, "storage"); assert.equal(result.failureOperationFamily, "profile_workers");
    assert.equal(result.storageFailureObserved, true); assert.equal(result.attempted, 1);
    assert.equal(result.requests, 0); assert.equal(result.requestFailures, 0); assert.equal(result.modelCalls, 0);
    assert.equal(result.verifiedThisRun, 0); assert.equal(result.newlyVerifiedThisRun, 0);
    assert.equal(result.verificationCountsStatus, "cache_reconciled");
    assert.equal(reads, 3, "Planning, failed initial read, and the existing count reconciliation only");
    assert.equal(gets, 1); assert.equal(profileWrites, 0); assert.equal(sources, 0);
    assert.deepEqual(timeouts.map(item => item.milliseconds), [100_000, 140_000, 160_000, 175_000, 235_000, 20_000]);
    assert.equal(warnings.length, 1);
    assert.equal(JSON.parse(warnings[0].split("] ")[1]).responsePhase, `response_${phase}`);
  }

  // Diagnostics supplied by an alternate store cannot leak raw error fields.
  const malicious = Object.assign(new Error("private"), { storageReadDiagnostics: {
    responsePhase: { toString: () => "response_headers", secret: "private" }, requestAbortSource: "private",
    readDurationMs: Infinity, requestDurationMs: -1, requestTimeoutMs: "private", abortReasonMatched: "private", secret: "private",
  } });
  const alternateCache = loadTsModule("@/lib/opportunity-engine/company-profile-cache", { ...overrides,
    "@/lib/r2-warehouse": { readVersionedTextFromR2: async () => { throw malicious; } } });
  warnings = [];
  await assert.rejects(() => alternateCache.ensureCompanyProfile(identity, globalThis.fetch, now), error => error === malicious);
  assert.ok(!warnings[0].includes("private"));
  const sanitized = JSON.parse(warnings[0].split("] ")[1]);
  assert.equal(sanitized.responsePhase, "unknown"); assert.equal(sanitized.requestAbortSource, "unknown");
  assert.equal(sanitized.readDurationMs, null); assert.equal(sanitized.requestDurationMs, null); assert.equal(sanitized.requestTimeoutMs, null);
  assert.equal(sanitized.abortReasonMatched, false);
} finally {
  globalThis.fetch = original.fetch; globalThis.performance = original.performance; AbortSignal.timeout = original.timeout;
  console.warn = original.warn; console.info = original.info;
  for (const name of Object.keys(process.env)) if (!(name in original.env)) delete process.env[name];
  Object.assign(process.env, original.env);
}
console.log("PASS: deterministic initial-read header/body timeout, exact versus coincident abort, decode/JSON failure, healthy gzip/plain/404 and safe diagnostic projection; same 20s budget, one GET, zero source requests or PUTs on failure.");
