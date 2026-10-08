import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";

const now = new Date("2026-10-03T12:00:00Z");
const identity = { ticker: "TEST", company: "Test Software", cik: "0000000001" };
const other = { ticker: "OTHER", company: "Other Issuer", cik: "0000000002", updatedAt: now.toISOString(), profile: null };
const key = "research-evidence/company-profiles-v1.json";
const fixture = companyProfileFixture(identity, now);
const listing = { ...identity, name: identity.company, exchange: "Nasdaq", securityType: "common_stock", sourceNames: ["SEC company_tickers_exchange"] };
const submissions = { cik: 1, tickers: ["TEST"], sicDescription: "Software", filings: { recent: {
  form: ["10-K"], filingDate: [fixture.sourceFiledAt], accessionNumber: ["0000000001-26-000001"], primaryDocument: ["annual.htm"],
} } };
const html = `<h2>Item 1. Business</h2><p>${fixture.business}</p><p>${"The company maintains regional facilities and provides ongoing implementation support for its software. ".repeat(8)}</p><h3>Customers</h3><p>${fixture.customers}</p><h2>Item 1A. Risk Factors</h2>`;
const failure = () => new Error("r2_state_write_http_502");
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const failClosed = error => error.storageDomain === "r2_state" && error.storageOperation === "write";

function harness({ seed = [], onWrite, onRead, source } = {}) {
  const objects = new Map();
  let etag = 1, reads = 0, requests = 0;
  if (seed.length) objects.set(key, { version: 1, entries: clone(seed) });
  const writes = [], waits = [], stageAttempts = new Map();
  const current = () => objects.get(key)?.entries.find(row => row.ticker === identity.ticker && row.cik === identity.cik);
  const replace = rows => { objects.set(key, { version: 1, entries: clone(rows) }); etag++; };
  const storage = {
    readVersionedTextFromR2: async (path, options = {}) => {
      options.signal?.throwIfAborted();
      if (path === key) {
        reads++;
        const alternate = await onRead?.({ reads, writes, objects, current, replace, options, requests });
        if (alternate) return alternate;
      }
      return objects.has(path) ? { found: true, text: JSON.stringify(objects.get(path)), etag: String(etag) }
        : { found: false, text: null, etag: null };
    },
    writeVersionedJsonToR2: async (path, value, options = {}) => {
      options.signal?.throwIfAborted();
      const commit = () => { objects.set(path, clone(value)); etag++; return { written: true, conflict: false, etag: String(etag) }; };
      if (path !== key) return commit();
      assert.ok(options.signal, "Every profile PUT has a bounded cancellation signal");
      assert.equal(options.maxAttempts, 1, "Profile row retries must not nest transport retries");
      assert.ok(options.expectedEtag || options.createOnly, "Every profile PUT retains its CAS condition");
      const row = value.entries[0];
      const stage = row.profile ? "verified" : row.error ? "failed" : "admission";
      const stageAttempt = (stageAttempts.get(stage) ?? 0) + 1;
      stageAttempts.set(stage, stageAttempt);
      writes.push({ value: clone(value), options, stage, stageAttempt });
      if ((options.createOnly && objects.has(path)) || (options.expectedEtag && options.expectedEtag !== String(etag))) return { written: false, conflict: true };
      const result = await onWrite?.({ stage, stageAttempt, row, value, options, commit, current, replace, writes, objects });
      return result ?? commit();
    },
  };
  const cache = loadTsModule("@/lib/opportunity-engine/company-profile-cache", {
    "@/lib/r2-warehouse": storage,
    "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: path => path },
    "node:timers/promises": { setTimeout: async (milliseconds, value, options = {}) => {
      waits.push(milliseconds); options.signal?.throwIfAborted(); return value;
    } },
  });
  const builder = loadTsModule("@/lib/simple-alert-profile-builder", { "@/lib/r2-warehouse": storage });
  const ensure = (options = {}) => cache.ensureCompanyProfile(identity, async (url, init) => {
    requests++;
    assert.ok(current(), "The attempt must be durable before source work");
    return source ? source(url, init) : String(url).includes("submissions") ? Response.json(submissions) : new Response(html);
  }, now, options);
  const counts = () => ({
    daily: builder.profileBatchPlan([listing], objects.get(key)?.entries ?? [], now, 100).newlyVerifiedToday,
    run: builder.firstVerifiedCompaniesThisRun(seed, objects.get(key)?.entries ?? [], now),
  });
  return { ensure, current, objects, storage, writes, waits, counts, get reads() { return reads; }, get requests() { return requests; } };
}

const info = console.info;
console.info = () => {};
try {
  // Both retained per-entry phases recover an unapplied PUT or a lost
  // acknowledgment. The selected-filing checkpoint no longer exists.
  for (const faultStage of ["admission", "verified"]) for (const applied of [false, true]) {
    const h = harness({ onWrite: ({ stage, stageAttempt, commit, objects }) => {
      if (stage !== faultStage || stageAttempt !== 1) return;
      if (applied) {
        commit();
        // A different property's order is still exactly the same JSON intent.
        objects.get(key).entries[0] = Object.fromEntries(Object.entries(objects.get(key).entries[0]).reverse());
      }
      throw failure();
    } });
    assert.ok(await h.ensure());
    assert.equal(h.requests, 2, "A storage retry never repeats source work");
    assert.equal(h.writes.length, applied ? 2 : 3, "Applied intents are acknowledged without another PUT");
    assert.deepEqual(h.counts(), { daily: 1, run: 1 });
    assert.equal(h.current().firstVerifiedAt, now.toISOString());
    assert.equal(h.current().verificationHistoryKnown, true);
  }

  // An applied target remains acknowledged after an unrelated issuer writes.
  const appliedWithOther = harness({ onWrite: ({ stage, commit, replace, value }) => {
    if (stage === "verified") { commit(); replace([...value.entries, other]); throw failure(); }
  } });
  assert.ok(await appliedWithOther.ensure());
  assert.equal(appliedWithOther.writes.length, 2);
  assert.deepEqual(appliedWithOther.objects.get(key).entries.find(row => row.ticker === "OTHER"), other);

  // Unapplied writes and CAS conflicts rebase only when their own baseline survives.
  for (const mode of ["transient", "conflict"]) {
    const h = harness({ onWrite: ({ stage, stageAttempt, replace, objects }) => {
      if (stage !== "verified" || stageAttempt !== 1) return;
      replace([...objects.get(key).entries, other]);
      if (mode === "transient") throw failure();
      return { written: false, conflict: true };
    } });
    assert.ok(await h.ensure());
    assert.equal(h.writes.length, 3);
    assert.notEqual(h.writes[1].options.expectedEtag, h.writes[2].options.expectedEtag, "Retry uses the newly read ETag");
    assert.deepEqual(h.objects.get(key).entries.find(row => row.ticker === "OTHER"), other);
    assert.equal(h.requests, 2);
  }

  // A same-time change, a newer row, deletion, and even older replacement are
  // all conflicts, never permission to overwrite another writer's target row.
  for (const mode of ["same_time", "newer", "older", "deleted", "history_only"]) {
    for (const response of ["transient", "conflict"]) {
      let concurrent;
      const h = harness({ onWrite: ({ stage, current, replace }) => {
        if (stage !== "verified") return;
        concurrent = mode === "deleted" ? undefined : {
          ...current(),
          ...(mode === "history_only" ? { firstVerifiedAt: "2026-10-01T00:00:00Z", verificationHistoryKnown: true }
            : { error: "another_writer", updatedAt: mode === "newer" ? "2026-10-03T12:01:00Z"
              : mode === "older" ? "2026-10-03T11:59:00Z" : now.toISOString() }),
        };
        replace(concurrent ? [concurrent] : []);
        if (response === "transient") throw failure();
        return { written: false, conflict: true };
      } });
      await assert.rejects(h.ensure, error => failClosed(error) && error.message === "company_profile_cache_superseded");
      assert.equal(h.writes.length, 2, "No cleanup handler may overwrite a superseded target");
      assert.deepEqual(h.current(), concurrent);
      assert.equal(h.requests, 2);
    }
  }

  // Preserve known first dates and unknown legacy history across all retries.
  for (const knownDate of [false, true]) {
    const old = { ...identity, updatedAt: "2026-10-02T12:00:00Z", nextAttemptAt: now.toISOString(),
      profile: { ...fixture, customers: "Unknown", description: "Invalid old profile" },
      verificationHistoryKnown: true, ...(knownDate ? { firstVerifiedAt: "2026-10-01T00:00:00Z" } : {}) };
    const h = harness({ seed: [old], onWrite: ({ stage, commit }) => { if (stage === "verified") { commit(); throw failure(); } } });
    assert.ok(await h.ensure());
    assert.equal(h.current().firstVerifiedAt, old.firstVerifiedAt);
    assert.equal(h.current().verificationHistoryKnown, true);
    assert.deepEqual(h.counts(), { daily: 0, run: 0 });
  }

  // A provider-budget rejection is never retried or shortened by storage repair.
  const providerRetry = "2026-10-04T12:00:00Z";
  let backoffFailed = false;
  const quota = harness({ source: async () => { throw new Error(`provider_budget_deferred;next_retry_at=${providerRetry}`); },
    onWrite: ({ row }) => { if (row.error && !backoffFailed) { backoffFailed = true; throw failure(); } } });
  assert.equal(await quota.ensure(), null);
  assert.equal(quota.requests, 1);
  assert.equal(quota.current().nextAttemptAt, providerRetry);
  assert.deepEqual(quota.counts(), { daily: 0, run: 0 });

  // Exact intent means the redacted JSON sent to R2, not the unencoded object.
  const redacted = harness({ source: async () => { throw new Error("failed https://provider.invalid/?api_key=synthetic-example"); },
    onWrite: ({ stage, commit }) => { if (stage === "failed") { commit(); throw failure(); } } });
  assert.equal(await redacted.ensure(), null);
  assert.equal(redacted.writes.length, 2);
  assert.match(redacted.current().error, /api_key=\[REDACTED_SECRET\]/);

  for (const error of [new TypeError("fetch failed"), new Error("r2_state_write_missing_etag"), new Error("r2_state_read_http_502")]) {
    const h = harness({ onWrite: ({ stage, commit }) => { if (stage === "verified") { commit(); throw error; } } });
    assert.ok(await h.ensure());
    assert.equal(h.writes.length, 2, "Transport/acknowledgment errors also reconcile before any repeat");
  }

  // Permanent failure is not retried. Persistent transient failures are bounded
  // to four PUTs; the final one still gets a readback to avoid false failure.
  for (const appliedOnLast of [false, true]) {
    const h = harness({ onWrite: ({ stage, stageAttempt, commit }) => {
      if (stage !== "verified") return;
      if (appliedOnLast && stageAttempt === 4) commit();
      throw failure();
    } });
    if (appliedOnLast) assert.ok(await h.ensure());
    else await assert.rejects(h.ensure, error => failClosed(error) && error.message === "r2_state_write_http_502");
    assert.equal(h.writes.length, 5);
    assert.deepEqual(h.waits, [100, 200, 400]);
    assert.equal(h.requests, 2);
    assert.deepEqual(h.counts(), appliedOnLast ? { daily: 1, run: 1 } : { daily: 0, run: 0 });
  }
  const conflict = harness({ onWrite: ({ stage }) => stage === "verified" ? { written: false, conflict: true } : undefined });
  await assert.rejects(conflict.ensure, error => failClosed(error) && error.message === "company_profile_cache_conflict");
  assert.equal(conflict.writes.length, 5);
  for (const message of ["r2_state_write_http_403", "r2_state_write_http_429", "r2_mutation_outside_write_prefix", "r2_state_invalid_write_condition"]) {
    const h = harness({ onWrite: () => { throw new Error(message); } });
    await assert.rejects(h.ensure, error => failClosed(error) && error.message === message);
    assert.equal(h.writes.length, 1); assert.equal(h.requests, 0);
  }

  // An uncertain/read-corrupt result cannot enable another PUT or source call.
  for (const mode of ["read_failure", "malformed", "missing_etag", "duplicates", "unknown_version", "missing_entries"]) {
    const h = harness({ onWrite: () => { throw failure(); }, onRead: ({ writes }) => {
      if (!writes.length) return;
      if (mode === "read_failure") throw new Error("r2_state_read_http_502");
      return { found: true, etag: mode === "missing_etag" ? null : "7", text: mode === "malformed" ? "{"
        : JSON.stringify(mode === "duplicates" ? { version: 1, entries: [writes[0].value.entries[0], writes[0].value.entries[0]] }
          : mode === "unknown_version" ? { version: 2, entries: [] }
            : mode === "missing_entries" ? { version: 1 } : { version: 1, entries: [] }) };
    } });
    await assert.rejects(h.ensure, failClosed);
    assert.equal(h.writes.length, 1); assert.equal(h.requests, 0);
  }

  // Abort before a PUT or after an ambiguous result permits no new PUT/source.
  for (const moment of ["pre_read", "pre_write", "ambiguous_write", "retry_backoff"]) {
    const controller = new AbortController();
    if (moment === "pre_read") controller.abort(new Error("role_budget_exhausted"));
    const h = harness({ onRead: ({ reads }) => { if (moment === "pre_write" && reads === 2) controller.abort(new Error("role_budget_exhausted")); },
      onWrite: () => { if (moment === "ambiguous_write") controller.abort(new Error("role_budget_exhausted")); throw failure(); } });
    if (moment === "retry_backoff") {
      // Abort after readback but before the delayed retry begins.
      const originalPush = h.waits.push.bind(h.waits);
      h.waits.push = (...args) => { controller.abort(new Error("role_budget_exhausted")); return originalPush(...args); };
    }
    if (["pre_read", "pre_write"].includes(moment)) assert.equal(await h.ensure({ signal: controller.signal }), null);
    else await assert.rejects(() => h.ensure({ signal: controller.signal }), /role_budget_exhausted|AbortError|aborted/i);
    assert.equal(h.writes.length, ["pre_read", "pre_write"].includes(moment) ? 0 : 1);
    assert.equal(h.requests, 0);
  }
  const beforeFinalPut = new AbortController();
  const deferredFinal = harness({ onRead: ({ writes, requests }) => { if (requests === 2 && writes.length === 1) beforeFinalPut.abort(); } });
  assert.equal(await deferredFinal.ensure({ signal: beforeFinalPut.signal }), null);
  assert.equal(deferredFinal.writes.length, 1, "The acknowledged admission does not make an unstarted final PUT ambiguous");
  assert.equal(deferredFinal.requests, 2);
  assert.deepEqual(deferredFinal.counts(), { daily: 0, run: 0 });

  // The real source deadline still saves its normal five-minute backoff once,
  // with a separate short cleanup signal, and never retries after that abort.
  for (const outcome of ["success", "applied_ack_lost", "unapplied", "conflict"]) {
    const controller = new AbortController();
    const h = harness({ source: async (_url, init) => {
      controller.abort(new DOMException("source_deadline", "TimeoutError"));
      init.signal.throwIfAborted();
    }, onWrite: ({ stage, row, options, commit }) => {
      if (stage !== "failed") return;
      assert.equal(controller.signal.aborted, true);
      assert.equal(options.signal.aborted, false, "The one cleanup write has its own bounded signal");
      assert.equal(row.error, "company_profile_time_budget_deferred");
      assert.equal(row.nextAttemptAt, new Date(now.getTime() + 5 * 60000).toISOString());
      if (outcome === "success") return;
      if (outcome === "conflict") return { written: false, conflict: true };
      if (outcome === "applied_ack_lost") commit();
      throw failure();
    } });
    if (["success", "applied_ack_lost"].includes(outcome)) assert.equal(await h.ensure({ signal: controller.signal }), null);
    else await assert.rejects(() => h.ensure({ signal: controller.signal }), failClosed);
    assert.equal(h.writes.length, 2, "Cleanup has a single PUT allowance even on CAS conflicts");
    assert.equal(h.requests, 1);
  }

  // Accelerate only the store's own total timeout to exercise a stuck PUT.
  const originalTimeout = AbortSignal.timeout;
  const timeoutDurations = [];
  AbortSignal.timeout = milliseconds => { timeoutDurations.push(milliseconds); return originalTimeout(milliseconds === 15_000 ? 10 : milliseconds); };
  try {
    const h = harness({ onWrite: async ({ options }) => {
      // A ref'ed timer keeps this standalone smoke alive until the signal fires.
      await new Promise((resolve, reject) => {
        const keepAlive = setTimeout(resolve, 1000);
        options.signal.addEventListener("abort", () => { clearTimeout(keepAlive); reject(options.signal.reason); }, { once: true });
      });
    } });
    await assert.rejects(h.ensure, error => failClosed(error) && error.cause?.name === "TimeoutError");
    assert.equal(h.writes.length, 1); assert.equal(h.requests, 0);
    assert.ok(timeoutDurations.includes(15_000));
  } finally { AbortSignal.timeout = originalTimeout; }

  AbortSignal.timeout = milliseconds => originalTimeout(milliseconds === 5_000 ? 10 : milliseconds);
  try {
    const controller = new AbortController();
    const h = harness({ source: async (_url, init) => { controller.abort(); init.signal.throwIfAborted(); },
      onWrite: async ({ stage, options }) => {
        if (stage !== "failed") return;
        await new Promise((resolve, reject) => {
          const keepAlive = setTimeout(resolve, 1000);
          options.signal.addEventListener("abort", () => { clearTimeout(keepAlive); reject(options.signal.reason); }, { once: true });
        });
      } });
    await assert.rejects(() => h.ensure({ signal: controller.signal }), error => failClosed(error) && error.cause?.name === "TimeoutError");
    assert.equal(h.writes.length, 2); assert.equal(h.requests, 1);
  } finally { AbortSignal.timeout = originalTimeout; }

  // Exercise the real builder plus real cache so a normal role deadline stays
  // time_budget_reached, whereas an attempted uncertain PUT remains failed.
  const savedEnv = { ...process.env };
  Object.assign(process.env, { SWING_UP_SIMPLE_PILOT_ENABLED: "true", RAILWAY_GIT_BRANCH: "pilot-simple-alerts",
    RAILWAY_PROJECT_ID: "83d99341-d622-475f-8035-00ef3d0916d1", RAILWAY_ENVIRONMENT_ID: "87afb8d7-c4fc-4f84-92b6-5d2820a689b6",
    SWING_UP_PR262_STORAGE_PREFIX: "branch-labs/simple-alerts/", SWING_UP_R2_WRITE_PREFIX: "branch-labs/simple-alerts/", SWING_UP_SIMPLE_PILOT_ROLE: "profiles" });
  try {
    for (const mode of ["pre_read", "pre_put", "source_deadline", "uncertain_unapplied", "uncertain_applied",
      "wrapped_role_initial", "wrapped_role_store", "http_initial", "http_store", "malformed_initial", "malformed_store", "superseded_store", "local_timeout_store"]) {
      const controller = new AbortController();
      const storeDeadline = new AbortController();
      const abort = () => controller.abort(new DOMException("Role time window ended", "TimeoutError"));
      const wrap = cause => Object.assign(new Error(cause.message, { cause }), { name: cause.name, storageDomain: "r2_state", storageOperation: "read" });
      AbortSignal.timeout = milliseconds => milliseconds === 140_000 || (milliseconds === 160_000 && mode.startsWith("uncertain_")) ? controller.signal
        : milliseconds === 15_000 && mode === "local_timeout_store" ? storeDeadline.signal : originalTimeout(milliseconds);
      const h = harness({ onRead: ({ reads, options, replace }) => {
        // The builder reads the profile plan before ensureCompanyProfile does.
        if ((mode === "pre_read" && reads === 2) || (mode === "pre_put" && reads === 3)) abort();
        if ((mode.endsWith("_initial") && reads === 2) || (mode.endsWith("_store") && reads === 3)) {
          if (mode === "local_timeout_store") storeDeadline.abort(new DOMException("Store write deadline", "TimeoutError"));
          abort();
          if (mode.startsWith("http_")) throw wrap(new Error("r2_state_read_http_502"));
          if (mode.startsWith("malformed_")) return { found: true, etag: "broken", text: "{broken" };
          if (mode === "superseded_store") replace([{ ...identity, profile: null, verificationHistoryKnown: true }]);
          if (mode === "local_timeout_store") throw wrap(wrap(storeDeadline.signal.reason));
          if (mode.startsWith("wrapped_role_")) throw wrap(wrap(options.signal.reason));
        }
      }, onWrite: ({ commit }) => {
        if (!mode.startsWith("uncertain_")) return;
        if (mode === "uncertain_applied") commit();
        abort(); throw failure();
      } });
      const builder = loadTsModule("@/lib/simple-alert-profile-builder", {
        "@/lib/r2-warehouse": h.storage,
        "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: path => path },
        "@/lib/equity-signal/universe": { loadEquityUniverse: async () => ({ snapshot: { refreshedAt: now.toISOString(), entries: [listing] } }) },
        "@/lib/opportunity-engine/pr262-sensor-fetch-budget": { createPr262SensorBudgetedFetch: async input => ({ fetchImpl: input.fetchImpl, flush: async () => {} }) },
        "node:timers/promises": { setTimeout: async (_ms, value, options = {}) => { options.signal?.throwIfAborted(); return value; } },
      });
      let sources = 0;
      const result = await builder.runSimpleAlertProfileBuilder(now, async (_url, init) => {
        sources++; assert.equal(mode, "source_deadline"); abort(); init.signal.throwIfAborted();
      });
      const deferred = ["pre_read", "pre_put", "source_deadline", "wrapped_role_initial", "wrapped_role_store", "superseded_store"].includes(mode);
      assert.equal(result.status, deferred ? "time_budget_reached" : "failed", mode);
      assert.equal(result.ok, deferred);
      if (mode.startsWith("http_")) assert.equal(result.failure, "r2_state_read_http_502");
      if (mode === "superseded_store") {
        assert.equal(result.failure, null, "A superseded admission with zero writes is a safe deferral");
        assert.equal(result.storageFailureObserved, false);
        assert.deepEqual(h.current(), { ...identity, profile: null, verificationHistoryKnown: true },
          "Preserve the concurrent same-issuer winner without a cleanup overwrite");
      }
      if (mode === "local_timeout_store") assert.equal(result.failure, "Store write deadline");
      assert.equal(result.modelCalls, 0);
      assert.equal(result.newlyVerifiedThisRun, result.status === "failed" && !h.current() ? null : 0,
        "Reporting cannot certify zero after a failed operation without authoritative cache evidence");
      assert.equal(sources, mode === "source_deadline" ? 1 : 0);
      assert.equal(h.writes.length, mode === "source_deadline" ? 2 : mode.startsWith("uncertain_") ? 1 : 0);
      if (mode === "source_deadline") assert.equal(h.current().error, "company_profile_time_budget_deferred");
    }
  } finally {
    AbortSignal.timeout = originalTimeout;
    for (const name of Object.keys(process.env)) if (!(name in savedEnv)) delete process.env[name];
    Object.assign(process.env, savedEnv);
  }

  console.log("PASS: profile-only bounded CAS retries, lost acknowledgments, exact-intent readback, concurrent same-time/newer rows, preserved history/counts, provider backoff, fail-closed reads, role/store deadlines and one-shot source-deadline cleanup.");
} finally { console.info = info; }
