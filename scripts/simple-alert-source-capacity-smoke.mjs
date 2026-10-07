import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";

const cohort = JSON.parse(readFileSync(new URL("../config/simple-alert-pilot.json", import.meta.url))).companies;
const seeds = JSON.parse(readFileSync(new URL("../config/simple-alert-issuer-sources.json", import.meta.url))).companies;
const { pr262PilotSourceWindow } = loadTsModule("@/lib/opportunity-engine/pr262-pilot-source-window");
const RealDate = Date, realTimeout = AbortSignal.timeout, realAny = AbortSignal.any;
const cycleStart = RealDate.parse("2026-10-07T02:32:37.002Z");
const prefix = "branch-labs/simple-alerts/cohorts/test/";
let clock = cycleStart;
class TestDate extends RealDate {
  constructor(...args) { super(...(args.length ? args : [clock])); }
  static now() { return clock; }
}
const deadlines = new WeakMap();
// The clock and cancellation advance together, including aborts during R2.
// No wall-clock sleeps, DNS, provider calls, or external state are involved.
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
    assert.ok(Number.isFinite(deadline), "A hanging operation must have a finite deadline");
    clock = deadline;
    throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  }
  clock += ms;
}
const body = row => ({ cik: Number(row.cik), tickers: [row.ticker], filings: {
  recent: { accessionNumber: [], form: [], filingDate: [], primaryDocument: [] }, files: [],
} });

async function scenario({ intervalMs = 2745, storageMs = 500, recoveryMs = 3800,
  priorWorkMs = 8003, baseline = false, registryHang = null, networkHang = false, objects = new Map(), cycleAt = cycleStart } = {}) {
  const sensorStart = cycleAt + recoveryMs;
  clock = sensorStart;
  const window = pr262PilotSourceWindow({ startedAtMs: sensorStart,
    processingDeadlineAtMs: cycleAt + 540_000 - 45_000 - 15_000, paidAdmissionMinimumMs: 335_000 });
  const registryKey = prefix + "sensor/direct-company-feeds-v1.json";
  if (!objects.has(registryKey)) objects.set(registryKey, { etag: "initial", value: {
    version: 1, updatedAt: new Date().toISOString(), discoveryCursor: 0, lastDiscoveryCycleAt: new Date().toISOString(),
    entries: cohort.map(row => ({ ...row, investorWebsite: seeds.find(seed => seed.cik === row.cik).investorWebsite,
      feedUrl: seeds.find(seed => seed.cik === row.cik).feedUrl, discoveredAt: new Date().toISOString(),
      lastDiscoveryAt: new Date().toISOString(), lastCheckedAt: null, lastSuccessAt: null,
      nextCheckAt: new Date(clock + 3600_000).toISOString(), error: null })),
  } });
  let revision = 0, registryReads = 0, registryWrites = 0;
  const sourceStarts = [];
  const overrides = {
    "@/lib/simple-alert-pilot-runtime": { isSimpleAlertPilot: () => true },
    "@/lib/simple-alert-pilot-scope": { pilotCompanies: () => cohort },
    "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: relative => prefix + relative },
    "node:dns/promises": { lookup: async () => { throw new Error("No discovery or DNS expected"); } },
    "node:timers/promises": { setTimeout: async (ms, _, options) => step(ms, options?.signal) },
    "@/lib/r2-warehouse": {
      readVersionedTextFromR2: async (key, options = {}) => {
        if (key === registryKey) {
          registryReads++;
          if (registryHang === "read" || (registryHang === "winner" && registryReads > 1)) step(Infinity, options.signal);
        }
        step(storageMs, options.signal);
        const saved = objects.get(key);
        return { found: Boolean(saved), text: saved ? JSON.stringify(saved.value) : null, etag: saved?.etag ?? null };
      },
      writeVersionedJsonToR2: async (key, value, options = {}) => {
        if (key === registryKey) {
          registryWrites++;
          if (registryHang === "write") step(Infinity, options.signal);
          if (registryHang === "winner") return { written: false, conflict: true, etag: null };
        }
        step(storageMs, options.signal);
        const prior = objects.get(key);
        if ((options.createOnly && prior) || (options.expectedEtag && options.expectedEtag !== prior?.etag)) {
          return { written: false, conflict: true, etag: null };
        }
        const etag = `${sensorStart}-${++revision}`;
        objects.set(key, { value: structuredClone(value), etag });
        return { written: true, conflict: false, etag };
      },
    },
  };
  const budget = loadTsModule("@/lib/opportunity-engine/pr262-sensor-fetch-budget", overrides);
  const monitor = loadTsModule("@/lib/opportunity-engine/pr262-direct-announcements", overrides);
  const fetcher = await budget.createPr262SensorBudgetedFetch({ fetchImpl: async (request, init) => {
    const company = cohort.find(row => String(request) === `https://data.sec.gov/submissions/CIK${row.cik}.json`);
    assert.ok(company, "Only the exact registered SEC root is requested");
    const ledger = objects.get(prefix + "sensor/provider-budgets-v1.json")?.value;
    assert.ok(ledger?.lastCadenceAt[`sensor_sec_submission:/submissions/cik${company.cik}.json`], "Durable reservation precedes network");
    sourceStarts.push(clock);
    step(networkHang ? Infinity : intervalMs - 4 * storageMs, init?.signal);
    return Response.json(body(company));
  } });
  clock = sensorStart + priorWorkMs;
  const directStart = clock;
  // Reproduce the old 28s SEC bottleneck using the real monitor's absolute
  // deadline (28s work + the unchanged 5s registry reserve).
  const deadlineAtMs = baseline ? directStart + 33_000 : window.deadlineAtMs;
  const result = await monitor.runPr262DirectAnnouncementMonitor({ exposure: cohort,
    now: new Date(sensorStart), fetchImpl: fetcher.fetchImpl, deadlineAtMs });
  assert.ok(sourceStarts.length <= 13);
  for (let index = 1; index < sourceStarts.length; index++) assert.ok(sourceStarts[index] - sourceStarts[index - 1] >= 1000);
  assert.ok(clock <= Math.max(directStart, deadlineAtMs));
  return { result, window, objects, sourceStarts, registryReads, registryWrites, elapsedMs: clock - sensorStart, sensorStart, directStart };
}

try {
  const normal = pr262PilotSourceWindow({ startedAtMs: cycleStart + 3800,
    processingDeadlineAtMs: cycleStart + 480_000, paidAdmissionMinimumMs: 335_000 });
  assert.equal(normal.allocatedMs, 60_000);
  assert.equal(normal.preparationReserveMs, 10_000);
  assert.ok(normal.latestPaidAdmissionAtMs - normal.deadlineAtMs >= normal.preparationReserveMs);
  const fullRecovery = pr262PilotSourceWindow({ startedAtMs: cycleStart + 30_000,
    processingDeadlineAtMs: cycleStart + 480_000, paidAdmissionMinimumMs: 335_000 });
  assert.equal(fullRecovery.allocatedMs, 60_000);
  assert.equal(cycleStart + 480_000 - fullRecovery.latestPaidAdmissionAtMs, 335_000);
  assert.equal(fullRecovery.latestPaidAdmissionAtMs - fullRecovery.deadlineAtMs, 55_000);

  const results = [];
  for (const [intervalMs, baselineCount] of [[2745, 10], [3104.375, 9]]) {
    const baseline = await scenario({ intervalMs, baseline: true });
    assert.equal(baseline.result.secCheckSuccesses, baselineCount);
    assert.equal(baseline.result.sourcePreparationFailures, 1);
    for (const storageMs of [200, 350, 500, 600, 650]) {
      const repaired = await scenario({ intervalMs, storageMs });
      assert.equal(repaired.result.secCheckAttempts, 13);
      assert.equal(repaired.result.secCheckSuccesses, 13);
      assert.equal(repaired.result.secCheckFailures, 0);
      assert.equal(repaired.result.sourcePreparationFailures, 0);
      assert.equal(repaired.result.registryPersistence.written, true);
      assert.ok(repaired.elapsedMs < 60_000);
      results.push({ intervalMs, storageMs, baselineCount, repaired: 13, elapsedMs: repaired.elapsedMs });
    }
    const constrained = await scenario({ intervalMs, recoveryMs: 30_000 });
    assert.equal(constrained.window.allocatedMs, 60_000);
    assert.equal(constrained.result.secCheckSuccesses, 13, "The additional cycle headroom preserves the same source cap after full recovery");
    assert.ok(constrained.elapsedMs <= 60_000);
  }
  for (const recoveryMs of [135_000, 140_000]) {
    const expired = await scenario({ recoveryMs, priorWorkMs: 0 });
    assert.equal(expired.window.allocatedMs, 0);
    assert.equal(expired.result.attemptCount, 0);
    assert.equal(expired.registryWrites, 0);
    assert.equal(expired.result.registryPersistence.telemetryBasis, "unavailable");
  }
  const late = await scenario({ priorWorkMs: 58_000 });
  assert.equal(late.result.directWorkBudgetMs, 0);
  assert.equal(late.result.attemptCount, 0);
  assert.equal(late.result.registryPersistence.written, true);

  for (const registryHang of ["read", "write", "winner"]) {
    const hung = await scenario({ registryHang });
    assert.equal(hung.result.registryPersistence.written, false);
    assert.equal(hung.result.sourcePreparationFailures, 1);
    assert.equal(hung.result.registryPersistence.telemetryBasis, registryHang === "read" ? "unavailable" : "unpersisted_observation");
    assert.equal(hung.result.secCheckSuccesses, registryHang === "read" ? 0 : 13);
    assert.equal(hung.registryWrites, registryHang === "read" ? 0 : 1);
    assert.ok(hung.elapsedMs <= 60_000, "Hung registry work retains the original outer cutoff");
  }
  const hungSource = await scenario({ networkHang: true });
  assert.ok(hungSource.sourceStarts.length > 0);
  assert.equal(hungSource.result.secCheckAttempts, hungSource.sourceStarts.length);
  assert.equal(hungSource.result.secCheckFailures, hungSource.sourceStarts.length, "An admitted source timeout remains an actual network failure");
  assert.equal(hungSource.result.secCheckSuccesses, 0);
  assert.ok(hungSource.sourceStarts.every(start => start < hungSource.directStart + 42_000), "No network work starts after the SEC slice");
  assert.equal(hungSource.result.registryPersistence.written, true);
  assert.ok(hungSource.elapsedMs < 60_000);
  const first = await scenario();
  const second = await scenario({ objects: first.objects, cycleAt: cycleStart + 15 * 60_000 });
  assert.equal(second.result.secCheckSuccesses, 12);
  assert.equal(second.result.issuerSourceCoverage.filter(row => row.sec.status === "current_snapshot").length, 25);
  const betweenCyclesAt = first.sensorStart + 29 * 60_000 + 55_000;
  assert.equal(second.result.issuerSourceCoverage.filter(row => betweenCyclesAt - Date.parse(row.sec.snapshotFetchedAt) < 29 * 60_000).length, 12,
    "Completed-cycle coverage must not be relabeled continuously fresh between the 29min expiry and 30min rotation");
  console.log(JSON.stringify({ sourceCapacity: results, boundedEarlyRecovery: true, zeroHeadroom: true,
    hangingRegistryBounded: true, twoCycleCoverage: 25, continuousFreshnessClaim: false }, null, 2));
} finally {
  globalThis.Date = RealDate;
  AbortSignal.timeout = realTimeout;
  AbortSignal.any = realAny;
}
