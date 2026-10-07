import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Run from the repository root, either here or after copying into scripts/.
// All source/provider and storage I/O below is local and synthetic. The real
// cache, extraction, history/count logic, and builder are loaded unchanged.
const { loadTsModule } = await import(pathToFileURL(resolve("scripts/helpers/load-typescript-module.mjs")));
const { companyProfileFixture } = await import(pathToFileURL(resolve("scripts/helpers/company-profile-fixture.mjs")));
const stamp = "2026-10-06T12:00:00.000Z";
const NativeDate = globalThis.Date;
const info = console.info;
const savedRole = process.env.SWING_UP_SIMPLE_PILOT_ROLE;
const key = "research-evidence/company-profiles-v1.json";
const identity = { ticker: "TEST", company: "Test Software", cik: "0000000001" };
const listing = { ...identity, name: identity.company, exchange: "Nasdaq", securityType: "common_stock", sourceNames: ["SEC company_tickers_exchange"] };
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const jsonBytes = value => Buffer.byteLength(JSON.stringify(value));
const isSource = path => path.startsWith("research-evidence/company-profile-sources/");
const own = value => value?.entries?.find(row => row.ticker === identity.ticker && row.cik === identity.cik);
const stageOf = row => row.profile ? "verified" : row.error ? "failed" : row.filing ? "admitted_with_prior_filing" : "admitted";
const checks = [];
globalThis.Date = class extends NativeDate {
  constructor(...args) { super(...(args.length ? args : [stamp])); }
  static now() { return NativeDate.parse(stamp); }
};
const now = new Date(stamp);
const fixture = companyProfileFixture(identity, now);
const filing = { url: fixture.sourceUrl, form: "10-K", filedAt: fixture.sourceFiledAt, industry: "Software", checkedAt: stamp };
const submissions = { cik: 1, tickers: [identity.ticker], sicDescription: filing.industry, filings: { recent: {
  form: [filing.form], filingDate: [filing.filedAt], accessionNumber: ["0000000001-26-000001"], primaryDocument: ["annual.htm"],
} } };
const html = `<h2>Item 1. Business</h2><p>${fixture.business}</p><p>${"The company maintains regional facilities and provides ongoing implementation support for its software. ".repeat(8)}</p><h3>Customers</h3><p>${fixture.customers}</p><h2>Item 1A. Risk Factors</h2>`;

function storageError(operation, kind = "http") {
  const cause = kind === "transport" ? new TypeError("fetch failed") : new Error(`r2_state_${operation}_http_502`);
  return Object.assign(new Error(cause.message, { cause }), { name: cause.name, storageDomain: "r2_state", storageOperation: operation });
}

function harness({ seed = [], savedObjects, onProfileWrite, onSourceRead, onSourceWrite, onFetch } = {}) {
  const objects = new Map(savedObjects ? clone(savedObjects) : []), revisions = new Map();
  for (const path of objects.keys()) revisions.set(path, 1);
  const writes = [], reads = [], requests = [], waits = [], logs = [];
  let forwardedError;
  const put = (path, value) => { objects.set(path, clone(value)); revisions.set(path, (revisions.get(path) ?? 0) + 1); };
  if (!savedObjects && seed.length) put(key, { version: 1, entries: seed });
  const before = clone(objects.get(key)?.entries ?? []);
  const current = () => own(objects.get(key));
  const replaceOwn = row => put(key, { ...objects.get(key), entries: [
    ...(row ? [row] : []), ...(objects.get(key)?.entries ?? []).filter(item => item.ticker !== identity.ticker || item.cik !== identity.cik),
  ] });
  const profileWrites = () => writes.filter(op => op.path === key);
  const context = () => ({ objects, current, replaceOwn, put, requests, writes, reads });
  const storage = {
    readVersionedTextFromR2: async (path, options = {}) => {
      options.signal?.throwIfAborted();
      if (isSource(path)) await onSourceRead?.({ ...context(), path, options });
      const value = objects.get(path), text = value === undefined ? null : JSON.stringify(value);
      reads.push({ path, bytes: text ? Buffer.byteLength(text) : 0, row: path === key ? clone(current()) : undefined });
      return { found: value !== undefined, text, etag: value === undefined ? null : String(revisions.get(path)) };
    },
    writeVersionedJsonToR2: async (path, value, options = {}) => {
      options.signal?.throwIfAborted();
      const row = path === key ? own(value) : undefined;
      writes.push({ path, bytes: jsonBytes(value), value: clone(value), stage: row ? stageOf(row) : "other", options });
      if (path === key) {
        assert.ok(options.signal, "Profile persistence keeps its bounded signal");
        assert.equal(options.maxAttempts, 1, "Per-row repair must not acquire nested transport retries");
        assert.ok(options.expectedEtag || options.createOnly, "Every profile write remains conditional");
      }
      if ((options.createOnly && objects.has(path)) || (options.expectedEtag && options.expectedEtag !== String(revisions.get(path)))) {
        return { written: false, conflict: true, etag: null };
      }
      const commit = () => { put(path, value); return { written: true, conflict: false, etag: String(revisions.get(path)) }; };
      const hook = path === key ? onProfileWrite : isSource(path) ? onSourceWrite : undefined;
      const result = await hook?.({ ...context(), path, value, row, stage: row ? stageOf(row) : "source", options, commit });
      return result ?? commit();
    },
  };
  const overrides = {
    "@/lib/r2-warehouse": storage,
    "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: path => path },
    "@/lib/simple-alert-pilot-runtime": { isSimpleAlertPilot: () => true },
    "@/lib/simple-alert-pilot-scope": { pilotCompanies: () => [] },
    "@/lib/equity-signal/universe": { loadEquityUniverse: async () => ({ snapshot: { refreshedAt: stamp, entries: [listing] } }) },
    "@/lib/opportunity-engine/pr262-sensor-fetch-budget": { createPr262SensorBudgetedFetch: async input => ({ fetchImpl: input.fetchImpl, flush: async () => {} }) },
    "node:timers/promises": { setTimeout: async (ms, value, options = {}) => { waits.push(ms); options.signal?.throwIfAborted(); return value; } },
  };
  const cache = loadTsModule("@/lib/opportunity-engine/company-profile-cache", overrides);
  const builder = loadTsModule("@/lib/simple-alert-profile-builder", { ...overrides,
    "@/lib/opportunity-engine/company-profile-cache": { ...cache, ensureCompanyProfile: async (...args) => {
      try { return await cache.ensureCompanyProfile(...args); }
      catch (error) { forwardedError = error; throw error; }
    } },
  });
  const fetcher = async (url, init) => {
    const path = String(url), row = current();
    requests.push(path);
    assert.ok(row, "Admission must be durable before every SEC fetch");
    assert.equal(row.profile, null, "Unverified admission cannot leave an invalid legacy profile usable");
    assert.ok(Date.parse(row.nextAttemptAt) > Date.parse(row.updatedAt), "Admission has a durable retry date");
    assert.ok(profileWrites().length >= 1, "An acknowledged admission write precedes SEC I/O");
    const result = await onFetch?.({ ...context(), url: path, init });
    if (result !== undefined) return result;
    if (path.includes("submissions")) return Response.json(submissions);
    assert.equal(path, filing.url);
    const response = new Response(html);
    Object.defineProperty(response, "url", { value: path });
    return response;
  };
  const withLogs = async operation => {
    const previous = console.info;
    console.info = message => { if (String(message).startsWith("{")) logs.push(JSON.parse(message)); };
    try { return await operation(); } finally { console.info = previous; }
  };
  const ensure = (at = now) => withLogs(() => cache.ensureCompanyProfile(identity, fetcher, at));
  const runBuilder = (at = now) => withLogs(() => builder.runSimpleAlertProfileBuilder(at, fetcher));
  const plan = (at = now) => builder.profileBatchPlan([listing], objects.get(key)?.entries ?? [], at, 100);
  const counts = (at = now) => ({ daily: plan(at).newlyVerifiedToday,
    run: builder.firstVerifiedCompaniesThisRun(before, objects.get(key)?.entries ?? [], at) });
  const metrics = () => {
    const profileReads = reads.filter(op => op.path === key), puts = profileWrites();
    return { gets: profileReads.length, puts: puts.length, getBytes: profileReads.reduce((sum, op) => sum + op.bytes, 0),
      putBytes: puts.reduce((sum, op) => sum + op.bytes, 0) };
  };
  return { ensure, runBuilder, plan, counts, metrics, current, profileWrites, objects, writes, reads, requests, waits, logs,
    get forwardedError() { return forwardedError; } };
}

try {
  process.env.SWING_UP_SIMPLE_PILOT_ROLE = "profiles";
  const healthy = harness({ onFetch: ({ url, current, writes }) => {
    assert.equal(writes.filter(op => op.path === key).length, 1, "No profile checkpoint occurs between admission and SEC filing read");
    assert.equal(current().filing, undefined, "New selection is not claimed durable before the final write");
    if (!url.includes("submissions")) assert.equal(current().firstVerifiedAt, undefined);
  } });
  const profile = await healthy.ensure();
  assert.ok(profile);
  assert.equal(healthy.profileWrites().length, 2, "Ordinary successful attempt has admission plus final PUT only");
  assert.deepEqual(healthy.profileWrites().map(op => op.stage), ["admitted", "verified"]);
  assert.deepEqual(healthy.current().filing, filing, "The final row persists the full selected filing");
  assert.equal(profile.sourceUrl, filing.url);
  assert.equal(profile.sourceFiledAt, filing.filedAt);
  assert.equal(profile.sourceType, "sec_annual_filing");
  assert.equal(profile.industrySourceUrl, `https://data.sec.gov/submissions/CIK${identity.cik}.json`);
  assert.equal(healthy.current().firstVerifiedAt, stamp);
  assert.equal(healthy.current().verificationHistoryKnown, true);
  assert.deepEqual(healthy.counts(), { daily: 1, run: 1 });
  assert.equal(healthy.requests.length, 2);
  assert.equal(healthy.writes.filter(op => isSource(op.path)).length, 1);
  checks.push("healthy: two profile PUTs; durable pre-SEC admission; full filing/provenance; first verification counted once");

  // Failure occurs after discovery, before any successful profile write.
  for (const mode of ["transport", "provider_backoff", "extraction"]) {
    const retry = "2026-10-08T12:00:00.000Z";
    const h = harness({ onFetch: ({ url }) => {
      if (url.includes("submissions")) return;
      if (mode === "transport") throw new TypeError("fetch failed");
      if (mode === "provider_backoff") throw new Error(`provider_budget_deferred;next_retry_at=${retry}`);
      return new Response("<h2>Item 1. Business</h2><p>No usable customer disclosure.</p><h2>Item 1A. Risk Factors</h2>");
    } });
    assert.equal(await h.ensure(), null);
    assert.equal(h.profileWrites().length, 2);
    assert.deepEqual(h.current().filing, filing);
    assert.equal(h.current().profile, null);
    assert.equal(h.current().firstVerifiedAt, undefined);
    assert.equal(h.current().nextAttemptAt, mode === "provider_backoff" ? retry
      : new Date(now.getTime() + (mode === "extraction" ? 86400000 : 3600000)).toISOString());
    assert.deepEqual(h.counts(), { daily: 0, run: 0 });
    const before = h.requests.length;
    assert.equal(await h.ensure(new Date(now.getTime() + 60000)), null);
    assert.equal(h.requests.length, before, "Failure retry cannot bypass its persisted backoff");
  }
  checks.push("post-selection transport, provider and extraction failures preserve full filing/backoff and never count verified");

  // A source-cache PUT may have applied even though its response was lost.
  // It must remain a storage failure, with no worker credit or invented first date.
  for (const operation of ["read", "write"]) for (const applied of operation === "write" ? [false, true] : [false]) {
    const fault = storageError(operation, applied ? "transport" : "http");
    const h = harness({
      onSourceRead: operation === "read" ? () => { throw fault; } : undefined,
      onSourceWrite: operation === "write" ? ({ commit }) => { if (applied) commit(); throw fault; } : undefined,
    });
    const result = await h.runBuilder();
    assert.equal(result.status, "failed");
    assert.equal(result.failureCategory, "storage");
    assert.equal(result.storageFailureObserved, true);
    assert.equal(result.failure, fault.message);
    assert.strictEqual(h.forwardedError, fault, "The original source-storage error and its provenance reach the builder");
    assert.equal(result.requestFailures, 0, "Storage errors are not failed SEC requests");
    assert.equal(result.verifiedThisRun, 0);
    assert.equal(result.newlyVerifiedThisRun, 0);
    assert.equal(result.newlyVerifiedToday, 0);
    assert.equal(result.pendingReasons[`company_profile_storage_${operation}_failed`], 1);
    assert.equal(h.profileWrites().length, 2);
    assert.ok(h.profileWrites().every(op => !own(op.value).profile));
    assert.deepEqual(h.current().filing, filing);
    assert.equal(h.current().nextAttemptAt, "2026-10-06T13:00:00.000Z");
    assert.equal(h.current().firstVerifiedAt, undefined);
    assert.equal(h.logs.find(row => row.status === "pending")?.phase, "annual_filing");
    assert.equal(h.writes.filter(op => isSource(op.path)).length, operation === "read" ? 0 : 1,
      "The source cache does not inherit profile write retries");
    assert.equal([...h.objects.keys()].some(isSource), operation === "write" && applied);
  }
  checks.push("source-cache read/unapplied/applied-ack-lost write faults retain storage provenance and zero verified counters");

  for (const mode of ["same_time", "history_only", "older", "deleted"]) {
    let competitor;
    const h = harness({ onFetch: ({ url, current, replaceOwn }) => {
      if (url.includes("submissions")) return;
      competitor = mode === "deleted" ? undefined : { ...current(),
        ...(mode === "history_only" ? { verificationHistoryKnown: true, firstVerifiedAt: "2026-10-01T00:00:00.000Z" }
          : { error: "concurrent_owner", ...(mode === "older" ? { updatedAt: "2026-10-05T00:00:00.000Z" } : {}) }),
      };
      replaceOwn(competitor);
    } });
    await assert.rejects(h.ensure, error => error.storageDomain === "r2_state" && error.storageOperation === "write"
      && error.message === "company_profile_cache_superseded");
    assert.deepEqual(h.current(), competitor, "No final or cleanup write can overwrite a changed acknowledged row");
    assert.equal(h.profileWrites().length, 1, "The final CAS fails closed before PUT when its admitted row changed");
    assert.equal(h.logs.some(row => row.status === "verified"), false);
  }
  checks.push("same-time, history-only, older-row and deletion competitors during filing read cannot be overwritten");

  // Fault injection uses semantic stages, never the old ordinal third PUT.
  for (const applied of [false, true]) {
    let faulted = false;
    const h = harness({ onProfileWrite: ({ stage, commit, current, replaceOwn }) => {
      if (stage !== "verified" || faulted) return;
      faulted = true;
      if (applied) { commit(); replaceOwn(Object.fromEntries(Object.entries(current()).reverse())); }
      throw storageError("write");
    } });
    assert.ok(await h.ensure());
    assert.equal(h.profileWrites().length, applied ? 2 : 3);
    assert.equal(h.requests.length, 2, "Profile persistence retries do not repeat SEC work");
    assert.deepEqual(h.counts(), { daily: 1, run: 1 });
    assert.deepEqual(h.current().filing, filing);
  }
  checks.push("final PUT retry and exact applied-intent readback retain CAS/maxAttempts=1 without repeat source requests");

  // Simulate a process that stops making progress after selecting the filing.
  // A never-resolved mock request prevents catch/final persistence. Restart from
  // only the durable objects in a fresh module instance. This deliberately does
  // not fake a source exception, which would execute normal failure cleanup.
  for (const history of ["new", "known_unknown_date", "legacy_unknown_date", "known_date"]) {
    const seed = history === "new" ? [] : [{ ...identity, updatedAt: "2026-10-05T12:00:00.000Z",
      nextAttemptAt: stamp, profile: history === "legacy_unknown_date" ? { ...fixture, customers: "Unknown" } : null,
      ...(history !== "legacy_unknown_date" ? { verificationHistoryKnown: true } : {}),
      ...(history === "known_date" ? { firstVerifiedAt: "2026-10-01T12:00:00.000Z" } : {}),
    }];
    let reached;
    const selected = new Promise(resolve => { reached = resolve; });
    const stopped = harness({ seed, onFetch: ({ url }) => {
      if (url.includes("submissions")) return;
      reached();
      return new Promise(() => {});
    } });
    // Do not await this intentionally unfinished operation; it owns no timers
    // or external resources. The saved snapshot is the simulated restart input.
    void stopped.ensure();
    await selected;
    const admitted = clone(stopped.current());
    assert.equal(stopped.profileWrites().length, 1);
    assert.equal(admitted.filing, undefined, "Crash tradeoff: a newly selected filing may be lost before final persistence");
    assert.equal(admitted.profile, null);
    assert.equal(admitted.nextAttemptAt, "2026-10-06T13:00:00.000Z");
    assert.equal(admitted.firstVerifiedAt, history === "known_date" ? seed[0].firstVerifiedAt : undefined);
    assert.equal(admitted.verificationHistoryKnown, history === "new" ? undefined : true);
    assert.deepEqual(stopped.counts(), { daily: 0, run: 0 });
    const restarted = harness({ savedObjects: [...stopped.objects] });
    const firstWindow = new Date(now.getTime() + 60000);
    assert.equal(await restarted.ensure(firstWindow), null);
    assert.equal(restarted.plan(firstWindow).due.length, 0);
    // No builder lease/window state is copied, so this is a clean first window.
    const freshWindow = await restarted.runBuilder(firstWindow);
    assert.equal(freshWindow.status, "no_due_profiles");
    assert.equal(freshWindow.attempted, 0);
    assert.equal(freshWindow.newlyVerifiedThisRun, 0);
    assert.equal(restarted.requests.length, 0, "A clean builder window cannot erase per-row backoff");
    assert.equal(restarted.profileWrites().length, 0);
    assert.deepEqual(restarted.current(), admitted);
    const due = new Date(admitted.nextAttemptAt);
    assert.equal(restarted.plan(due).due.length, 1);
    assert.ok(await restarted.ensure(due), "The ordinary later retry can rediscover a filing lost on crash");
    assert.equal(restarted.requests.length, 2);
    assert.equal(restarted.profileWrites().length, 2);
    assert.deepEqual(restarted.current().filing, { ...filing, checkedAt: due.toISOString() });
    assert.equal(restarted.current().verificationHistoryKnown, true);
    assert.equal(restarted.current().firstVerifiedAt, history === "new" ? due.toISOString()
      : history === "known_date" ? seed[0].firstVerifiedAt : undefined);
    assert.deepEqual(restarted.counts(due), { daily: history === "new" ? 1 : 0, run: history === "new" ? 1 : 0 });
  }
  checks.push("noncompletion/restart keeps one-hour admission, known/unknown history and zero first verification; clean window cannot bypass it; due retry rediscovers filing");

  // Local serialized payload accounting, deliberately not a latency benchmark.
  const unrelated = Array.from({ length: 400 }, (_, index) => ({ ticker: `S${index}`, company: `Stable ${index}`,
    cik: String(index + 100).padStart(10, "0"), profile: null, payload: "x".repeat(10800) }));
  const desiredSeedBytes = 4_400_000;
  unrelated[0].payload += "x".repeat(desiredSeedBytes - jsonBytes({ version: 1, entries: unrelated }));
  const byteRun = harness({ seed: unrelated });
  assert.ok(await byteRun.ensure());
  assert.deepEqual(byteRun.objects.get(key).entries.filter(row => row.ticker !== identity.ticker), unrelated);
  const measured = byteRun.metrics();
  assert.equal(measured.gets, 3);
  assert.equal(measured.puts, 2);
  const admission = byteRun.profileWrites()[0].value;
  const selectedCheckpoint = { ...admission, entries: [{ ...own(admission), filing }, ...unrelated] };
  // Former ordering: GET seed twice; PUT admission; GET admission; PUT selected;
  // GET selected; PUT final. Current ordering omits selected's PUT and GET.
  const removedCheckpointBytes = jsonBytes(selectedCheckpoint);
  const oldThreeWriteModel = { gets: measured.gets + 1, puts: measured.puts + 1,
    getBytes: measured.getBytes + removedCheckpointBytes, putBytes: measured.putBytes + removedCheckpointBytes };
  const accounting = { kind: "synthetic_serialized_payload_accounting_not_live_performance", seedBytes: desiredSeedBytes,
    observedCurrent: measured, counterfactualFormerThreeWriteModel: oldThreeWriteModel,
    savedProfilePayloadBytes: 2 * removedCheckpointBytes,
    sourceRequests: byteRun.requests.length, sourceWrites: byteRun.writes.filter(op => isSource(op.path)).length };
  checks.push("4.4 MB stable unrelated rows survive unchanged; current profile I/O is 3 GET + 2 PUT; modeled removed checkpoint saves one whole-object GET + PUT");
  console.log(JSON.stringify({ status: "passed", checks, accounting }, null, 2));
} finally {
  globalThis.Date = NativeDate;
  console.info = info;
  if (savedRole === undefined) delete process.env.SWING_UP_SIMPLE_PILOT_ROLE; else process.env.SWING_UP_SIMPLE_PILOT_ROLE = savedRole;
}
