import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";

const cohort = JSON.parse(readFileSync(new URL("../config/simple-alert-pilot.json", import.meta.url))).companies;
const fixture = JSON.parse(readFileSync(new URL("./fixtures/sec-due-rotation-synthetic.json", import.meta.url)));
const RealDate = Date, realTimeout = AbortSignal.timeout, realAny = AbortSignal.any;
const start = RealDate.parse(fixture.sensorStartedAt), cadenceMs = 29 * 60_000;
let clock = start;
class TestDate extends RealDate {
  constructor(...args) { super(...(args.length ? args : [clock])); }
  static now() { return clock; }
}
const deadlines = new WeakMap();
AbortSignal.timeout = ms => {
  const signal = new AbortController().signal;
  deadlines.set(signal, clock + ms);
  return signal;
};
AbortSignal.any = signals => {
  const signal = realAny(signals);
  deadlines.set(signal, Math.min(...signals.map(value => deadlines.get(value) ?? Infinity)));
  return signal;
};
globalThis.Date = TestDate;
function step(ms, signal) {
  signal?.throwIfAborted();
  const deadline = deadlines.get(signal) ?? Infinity;
  if (clock + ms >= deadline) {
    assert.ok(Number.isFinite(deadline));
    clock = deadline;
    throw Object.assign(new Error("mock operation timeout"), { name: "TimeoutError" });
  }
  clock += ms;
}
const iso = ms => new Date(ms).toISOString();
const prefix = "offline/sec-due/", registryKey = prefix + "sensor/direct-company-feeds-v1.json";
const stateKey = prefix + "sensor/provider-budgets-v1.json";
const sourceUrl = row => `https://data.sec.gov/submissions/CIK${row.cik}.json`;
const cadenceKey = row => `sensor_sec_submission:/submissions/cik${row.cik}.json`;
const cacheKey = row => prefix + `sensor/submissions-cache/${row.cik}.json`;
const body = row => JSON.stringify({ cik: Number(row.cik), tickers: [row.ticker], filings: {
  recent: { accessionNumber: [], form: [], filingDate: [], primaryDocument: [] }, files: [],
} });

async function scenario({ due = [], exposure = cohort, directOffsetMs = 0, outerMs = 60_000,
  storageMs = 100, totalReadMs = 1500, cached = [], blocked = [], quota = 0,
  malformed = false, replay = false, budgetReadFailure = false, status = 200 } = {}) {
  clock = start;
  const records = new Map();
  const future = iso(start + 86400_000);
  const ledger = { version: 2, updatedAt: iso(start), hourlyCounts: {
    sensor_sec_submissions: { [iso(start).slice(0, 13)]: quota },
  }, lastCadenceAt: {} };
  const entries = cohort.map((row, index) => {
    const old = replay ? fixture.prior.find(value => value.ticker === row.ticker).sec : null;
    const sec = old ? { ...old } : { lastCheckedAt: iso(start - 2 * cadenceMs + index),
      snapshotFetchedAt: iso(start - cadenceMs - 60_000), snapshotOrigin: "network", error: null,
      nextCheckAt: Number.isFinite(due[index]) ? iso(start + due[index]) : future };
    if (malformed && index === 0) { sec.nextCheckAt = "invalid"; sec.lastCheckedAt = "invalid"; }
    if (replay || cached.includes(index)) {
      const fetchedAt = replay ? old.snapshotFetchedAt : iso(start - 60_000);
      records.set(cacheKey(row), { etag: "cache-0", value: { version: 1, cik: row.cik,
        sourceUrl: sourceUrl(row), fetchedAt, body: body(row) } });
    }
    ledger.lastCadenceAt[cadenceKey(row)] = blocked.includes(index)
      ? iso(start - 1000) : sec.snapshotFetchedAt;
    return { ...row, investorWebsite: null, feedUrl: null, discoveredAt: iso(start),
      lastDiscoveryAt: iso(start), lastCheckedAt: null, lastSuccessAt: null, nextCheckAt: future,
      error: null, sec: { ...sec, sourceUrl: sourceUrl(row), lastSuccessAt: sec.snapshotFetchedAt } };
  });
  records.set(registryKey, { etag: "registry-0", value: { version: 1, updatedAt: iso(start),
    discoveryCursor: 0, lastDiscoveryCycleAt: iso(start), entries } });
  records.set(stateKey, { etag: "budget-0", value: ledger });
  const before = structuredClone(entries);
  const calls = [], cacheReads = [], pauses = [];
  let revision = 0, started = false;
  const overrides = {
    "@/lib/simple-alert-pilot-runtime": { isSimpleAlertPilot: () => true },
    "@/lib/simple-alert-pilot-scope": { pilotCompanies: () => cohort },
    "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: path => prefix + path },
    "node:dns/promises": { lookup: async () => { throw new Error("Offline test: DNS prohibited"); } },
    "node:timers/promises": { setTimeout: async (ms, _, options) => { pauses.push(ms); step(ms, options?.signal); } },
    "@/lib/r2-warehouse": {
      readVersionedTextFromR2: async (key, options = {}) => {
        if (key.includes("/submissions-cache/")) cacheReads.push(key);
        if (started && budgetReadFailure && key === stateKey) throw new Error("provider_storage_unavailable");
        step(storageMs, options.signal);
        const saved = records.get(key);
        return { found: Boolean(saved), text: saved ? JSON.stringify(saved.value) : null, etag: saved?.etag ?? null };
      },
      writeVersionedJsonToR2: async (key, value, options = {}) => {
        step(storageMs, options.signal);
        const old = records.get(key);
        if ((options.createOnly && old) || (options.expectedEtag && old?.etag !== options.expectedEtag)) {
          return { written: false, conflict: true, etag: null };
        }
        const etag = String(++revision);
        records.set(key, { etag, value: structuredClone(value) });
        return { written: true, conflict: false, etag };
      },
    },
  };
  const budget = loadTsModule("@/lib/opportunity-engine/pr262-sensor-fetch-budget", overrides);
  const monitor = loadTsModule("@/lib/opportunity-engine/pr262-direct-announcements", overrides);
  const fetcher = await budget.createPr262SensorBudgetedFetch({ fetchImpl: async (request, init) => {
    const row = cohort.find(value => String(request) === sourceUrl(value));
    assert.ok(row, "No external I/O or optional source reads are allowed");
    const reservationAt = Date.parse(records.get(stateKey).value.lastCadenceAt[cadenceKey(row)]);
    assert.ok(reservationAt <= clock, "Durable reservation precedes source network");
    const oldReservation = Date.parse(ledger.lastCadenceAt[cadenceKey(row)]);
    assert.ok(reservationAt - oldReservation >= cadenceMs, "29-minute hard interval remains exact");
    calls.push({ ticker: row.ticker, startedAt: clock, reservationAt });
    if (replay && calls.length <= 4) {
      const reference = fixture.referenceRefreshes.find(value => value.ticker === row.ticker);
      assert.ok(reference, "The existing oldest four retain precedence");
      step(Date.parse(reference.fetchedAt) - clock, init?.signal);
    } else step(totalReadMs - 4 * storageMs, init?.signal);
    return new Response(body(row), { status });
  } });
  clock = start + directOffsetMs;
  started = true;
  const directAt = clock, outerAt = start + outerMs;
  const result = await monitor.runPr262DirectAnnouncementMonitor({ exposure, now: new Date(start),
    fetchImpl: fetcher.fetchImpl, deadlineAtMs: outerAt });
  const saved = records.get(registryKey).value.entries;
  assert.ok(calls.length <= 13);
  assert.equal(new Set(calls.map(row => row.ticker)).size, calls.length);
  assert.ok(clock <= outerAt, "No deadline extension");
  assert.ok(calls.every(row => row.startedAt < Math.min(directAt + 42_000, outerAt - 5000)));
  for (let index = 1; index < calls.length; index++) {
    assert.ok(calls[index].startedAt - calls[index - 1].startedAt >= 1000, "One request per second remains enforced");
  }
  return { result, calls, cacheReads, pauses, saved, before, elapsedMs: clock - start,
    used: Object.values(records.get(stateKey).value.hourlyCounts.sensor_sec_submissions).reduce((sum, n) => sum + n, 0) };
}

try {
  const advancing = await scenario({ due: [0, 1200, 5000], totalReadMs: 1500 });
  assert.deepEqual(advancing.calls.map(row => row.ticker), cohort.slice(0, 2).map(row => row.ticker),
    "A row becoming due during the first read is selected; the future row is left untouched");
  assert.deepEqual(advancing.saved[2].sec, advancing.before[2].sec);
  assert.equal(advancing.saved[0].sec.lastCheckedAt, iso(start + 100));
  assert.equal(advancing.saved[1].sec.lastCheckedAt, iso(start + 1600),
    "Persisted check time advances for a newly eligible issuer");
  assert.equal(Date.parse(advancing.saved[1].sec.nextCheckAt),
    Date.parse(advancing.saved[1].sec.snapshotFetchedAt) + cadenceMs,
    "Freshness is anchored to the real completed snapshot, not check selection");
  assert.ok(advancing.elapsedMs < 5000, "No future-due wait");
  const lateStart = await scenario({ directOffsetMs: 2000, due: [1000] });
  assert.equal(lateStart.result.secCheckSuccesses, 1, "Actual direct start governs eligibility, not fixed sensor now");
  assert.equal(lateStart.saved[0].sec.lastCheckedAt, iso(start + 2100));
  const future = await scenario({ due: [1000] });
  assert.equal(future.cacheReads.length, 0); assert.equal(future.calls.length, 0);
  assert.deepEqual(future.saved[0].sec, future.before[0].sec);
  const allDue = Array(cohort.length).fill(0);
  const cap = await scenario({ due: allDue, exposure: [...cohort, ...cohort] });
  assert.equal(cap.result.secCheckSuccesses, 13); assert.equal(cap.cacheReads.length, 13);
  assert.equal(cap.used, 13);
  const fast = await scenario({ due: allDue, storageMs: 0, totalReadMs: 100 });
  assert.equal(fast.result.secCheckSuccesses, 13);
  assert.ok(fast.pauses.some(ms => ms === 900), "Fast sources retain the existing one-second pacing wait");
  const cacheAndDeferral = await scenario({ due: allDue, cached: [0, 1, 2, 3, 4], blocked: [5, 6, 7, 8, 9] });
  assert.equal(cacheAndDeferral.result.secCacheHits, 5);
  assert.equal(cacheAndDeferral.result.secCheckDeferred, 5);
  assert.equal(cacheAndDeferral.result.secCheckSuccesses, 3);
  assert.equal(cacheAndDeferral.cacheReads.length, 13, "Every selection consumes a slot, including no-network outcomes");
  const allCached = await scenario({ due: allDue, cached: cohort.map((_, index) => index) });
  assert.equal(allCached.result.secCacheHits, 13); assert.equal(allCached.calls.length, 0);
  assert.equal(allCached.cacheReads.length, 13); assert.equal(allCached.used, 0);
  const allBlocked = await scenario({ due: allDue, blocked: cohort.map((_, index) => index) });
  assert.equal(allBlocked.result.secCheckDeferred, 13); assert.equal(allBlocked.calls.length, 0);
  assert.equal(allBlocked.cacheReads.length, 13); assert.equal(allBlocked.used, 0);
  assert.equal(allBlocked.saved[0].sec.lastCheckedAt, allBlocked.before[0].sec.lastCheckedAt,
    "A local quota/cadence deferral never fabricates a source-attempt timestamp");
  const exhausted = await scenario({ due: allDue, quota: 3500 });
  assert.equal(exhausted.result.secCheckDeferred, 13); assert.equal(exhausted.calls.length, 0);
  assert.equal(exhausted.used, 3500); assert.equal(exhausted.result.secCheckFailures, 0);
  const corruptDates = await scenario({ due: allDue, malformed: true, blocked: [0] });
  assert.equal(corruptDates.result.secCheckDeferred, 1);
  assert.equal(corruptDates.calls.some(row => row.ticker === cohort[0].ticker), false,
    "Invalid registry dates never bypass the real provider's exact minimum interval");
  assert.equal(corruptDates.cacheReads[0], cacheKey(cohort[0]), "Invalid prior-check time sorts as never checked");
  assert.equal(corruptDates.cacheReads.length, 13);
  const storageFault = await scenario({ due: [0], budgetReadFailure: true });
  assert.equal(storageFault.result.secCheckAttempts, 0); assert.equal(storageFault.result.secCheckFailures, 0);
  assert.equal(storageFault.result.sourcePreparationFailures, 1);
  assert.equal(storageFault.saved[0].sec.lastCheckedAt, storageFault.before[0].sec.lastCheckedAt);
  for (const status of [403, 429]) {
    const refused = await scenario({ due: allDue, status });
    assert.equal(refused.calls.length, 1); assert.equal(refused.result.secCheckFailures, 1);
  }
  const closed = await scenario({ due: allDue, directOffsetMs: 58_000 });
  assert.equal(closed.calls.length, 0); assert.equal(closed.result.registryPersistence.written, true);
  const replay = await scenario({ replay: true, storageMs: 500,
    directOffsetMs: Date.parse(fixture.directStartedAt) - start,
    outerMs: Date.parse(fixture.sourceDeadlineAt) - start,
    // Synthetic clock shifting preserves the measured inter-snapshot intervals
    // of 3922, 3964 and 3614ms.
    // Subsequent requests are modeled at their arithmetic mean; individual
    // storage durations (500ms) are modeling assumptions.
    totalReadMs: (3922 + 3964 + 3614) / 3 });
  for (const row of fixture.referenceRefreshes) {
    assert.equal(replay.saved.find(value => value.ticker === row.ticker).sec.snapshotFetchedAt, row.fetchedAt);
  }
  assert.ok(replay.result.secCheckSuccesses > 4, "Real monitor uses time remaining for newly due issuers");
  assert.equal(replay.result.secCheckSuccesses, 11);
  assert.equal(replay.result.secCheckFailures, 0);
  assert.equal(replay.result.sourcePreparationFailures, 1,
    "The final storage timeout stays visible rather than becoming an invented network failure");
  console.log(JSON.stringify({ dynamicEligibility: true, noFutureWait: true, uniqueIssuerCap: 13,
    cacheAndDeferralSlots: { cache: 5, deferred: 5, network: 3 }, unchangedDailyQuota: 3500,
    syntheticReplay: { syntheticClockOrigin: fixture.sensorStartedAt, modeledAdditionalReadMs: (3922 + 3964 + 3614) / 3, attempts: replay.result.secCheckAttempts,
      successes: replay.result.secCheckSuccesses, sourceFailures: replay.result.secCheckFailures,
      preparationFailures: replay.result.sourcePreparationFailures, elapsedMs: replay.elapsedMs,
      currentAtMonitorFinish: replay.result.issuerSourceCoverage.filter(row => row.sec.status === "current_snapshot").length,
      tickers: replay.calls.map(row => row.ticker) } }, null, 2));
} finally {
  globalThis.Date = RealDate;
  AbortSignal.timeout = realTimeout;
  AbortSignal.any = realAny;
}
