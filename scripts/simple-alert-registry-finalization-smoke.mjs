import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";

const cohort = JSON.parse(readFileSync(new URL("../config/simple-alert-pilot.json", import.meta.url))).companies;
const seeds = JSON.parse(readFileSync(new URL("../config/simple-alert-issuer-sources.json", import.meta.url))).companies;
const company = cohort[0];
const prefix = "branch-labs/simple-alerts/cohorts/test/";
const common = {
  "@/lib/simple-alert-pilot-runtime": { isSimpleAlertPilot: () => true },
  "@/lib/simple-alert-pilot-scope": { pilotCompanies: () => cohort },
  "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: relative => prefix + relative },
};
const body = (row, now) => ({ cik: Number(row.cik), tickers: [row.ticker], filings: { recent: {
  accessionNumber: [`${row.cik}-26-000001`], form: ["8-K"], filingDate: [now.toISOString().slice(0, 10)],
  acceptanceDateTime: [new Date(now.getTime() - 60_000).toISOString()], primaryDocument: ["announcement.htm"],
}, files: [] } });
const registry = now => ({ version: 1, updatedAt: now.toISOString(), discoveryCursor: 0,
  lastDiscoveryCycleAt: now.toISOString(), entries: cohort.map(row => ({ ...row,
    investorWebsite: seeds.find(seed => seed.cik === row.cik).investorWebsite,
    feedUrl: seeds.find(seed => seed.cik === row.cik).feedUrl,
    discoveredAt: now.toISOString(), lastDiscoveryAt: now.toISOString(), lastCheckedAt: null,
    lastSuccessAt: null, nextCheckAt: new Date(now.getTime() + 3600_000).toISOString(), error: null,
  })) });

// The 5050 ms caller envelope reserves 5000 ms for the registry, leaving only
// 50 ms for source work. Host scheduling used to consume this tiny allowance.
// Advance a deterministic clock and cancel the same production-created signals
// at their scheduled deadlines; no production timeout or assertion is relaxed.
async function withControlledDeadlines(run) {
  const NativeDate = Date, nativeTimeout = AbortSignal.timeout;
  let clock = NativeDate.parse("2026-10-07T00:00:00.000Z");
  const scheduled = [], deadlines = new WeakMap();
  class ControlledDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const advance = ms => {
    assert.ok(Number.isFinite(ms) && ms >= 0);
    clock += ms;
    for (const { at, controller } of scheduled) if (at <= clock && !controller.signal.aborted)
      controller.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
  };
  globalThis.Date = ControlledDate;
  AbortSignal.timeout = ms => {
    const controller = new AbortController(), at = clock + ms;
    scheduled.push({ at, controller }); deadlines.set(controller.signal, at);
    return controller.signal;
  };
  try { await run({ advance, deadlineOf: signal => deadlines.get(signal) }); }
  finally { globalThis.Date = NativeDate; AbortSignal.timeout = nativeTimeout; }
}

// A completed exact-CIK source response is still evidence when final registry
// publication fails. No second PUT or repeat source request is allowed.
await withControlledDeadlines(async ({ advance, deadlineOf }) => {
for (const stage of ["write", "write_timeout", "write_unacknowledged", "conflict_winner_read", "conflict_winner_missing"]) {
  const now = new Date();
  const started = Date.now();
  let reads = 0, writes = 0, network = 0;
  const direct = loadTsModule("@/lib/opportunity-engine/pr262-direct-announcements", { ...common,
    "node:timers/promises": { setTimeout: async (ms, _value, { signal } = {}) => { signal?.throwIfAborted(); advance(ms); signal?.throwIfAborted(); } },
    "@/lib/r2-warehouse": {
      readVersionedTextFromR2: async () => {
        reads++;
        if (reads > 1) {
          if (stage === "conflict_winner_missing") return { found: false, text: null, etag: null };
          throw new Error("r2_state_read_http_502");
        }
        return { found: true, text: JSON.stringify(registry(now)), etag: "before" };
      },
      writeVersionedJsonToR2: async (_key, _value, options) => {
        writes++;
        assert.equal(options.expectedEtag, "before");
        if (stage === "write") throw new Error("r2_state_write_http_502");
        if (stage === "write_unacknowledged") return { written: false, conflict: false, etag: null };
        if (stage === "write_timeout") return new Promise((_, reject) => {
          assert.equal(deadlineOf(options.signal), started + 5050, "The final PUT inherits the exact caller deadline");
          options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
          advance(started + 5050 - Date.now());
          assert.equal(options.signal.aborted, true, "The hung PUT must be cancelled at its actual deadline");
        });
        return { written: false, conflict: true, etag: null };
      },
    },
  });
  const result = await direct.runPr262DirectAnnouncementMonitor({ exposure: [company], now, deadlineAtMs: started + 5050,
    fetchImpl: async request => {
      network++;
      assert.equal(String(request), `https://data.sec.gov/submissions/CIK${company.cik}.json`);
      return Response.json(body(company, now));
    },
  });
  assert.ok(Date.now() - started < 5500, "Even a hung final PUT must return inside its bounded registry window");
  assert.equal(network, 1);
  assert.equal(writes, 1);
  assert.equal(reads, stage.startsWith("write") ? 1 : 2);
  assert.equal(result.attemptCount, 1);
  assert.equal(result.successCount, 1);
  assert.equal(result.failureCount, 0);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].id, `sec:${company.cik}-26-000001`);
  assert.equal(result.events[0].observedAt, new Date(now.getTime() - 60_000).toISOString());
  assert.equal(result.sourcePreparationFailures, 1);
  assert.equal(result.registryPersistence.written, false);
  assert.equal(result.registryPersistence.winnerLoaded, false);
  assert.equal(result.registryPersistence.failureStage, stage.startsWith("write") ? "write" : "conflict_winner_read");
  assert.equal(result.registryPersistence.telemetryBasis, "unpersisted_observation");
  assert.match(result.preparationErrors[0], /^direct_registry_/);
  assert.equal(result.issuerSourceCoverage[0].sec.status, "current_snapshot");
  assert.ok(Date.parse(result.issuerSourceCoverageEvaluatedAt) >= started);
}

});

// Reproduce the original 0-request outcome deliberately: 60 ms of registry
// setup exhausts the 50 ms source slice. Separately cancel during source pacing.
// Neither condition may fabricate a successful source or publish a stale event.
for (const mode of ["setup_consumes_source_slice", "cancel_before_fetch"]) {
  await withControlledDeadlines(async ({ advance }) => {
    const now = new Date(), started = Date.now(); let network = 0, writes = 0;
    const direct = loadTsModule("@/lib/opportunity-engine/pr262-direct-announcements", { ...common,
      "node:timers/promises": { setTimeout: async (ms, _value, { signal } = {}) => {
        signal?.throwIfAborted(); advance(mode === "cancel_before_fetch" ? 51 : ms); signal?.throwIfAborted();
      } },
      "@/lib/r2-warehouse": {
        readVersionedTextFromR2: async () => {
          if (mode === "setup_consumes_source_slice") advance(60);
          return { found: true, text: JSON.stringify(registry(now)), etag: "before" };
        },
        writeVersionedJsonToR2: async (_key, _value, options) => {
          options.signal.throwIfAborted(); writes++;
          return { written: true, conflict: false, etag: "after" };
        },
      },
    });
    const result = await direct.runPr262DirectAnnouncementMonitor({ exposure: [company], now,
      deadlineAtMs: started + 5050, fetchImpl: async () => { network++; return Response.json(body(company, now)); } });
    assert.equal(network, 0, `${mode}: no provider call after source expiry/cancellation`);
    assert.equal(result.successCount, 0, `${mode}: no fabricated successful source`);
    assert.equal(result.events.length, 0, `${mode}: no event without completed evidence`);
    assert.equal(writes, 1, "The reserved registry slice still permits truthful finalization");
    assert.equal(result.registryPersistence.written, true);
    assert.equal(result.directWorkBudgetMs, 50, "The original source deadline remains unchanged");
  });
}

// V3 has already spent 25 seconds of its 45-second window. Thirteen sequential
// 1-second responses plus a 2-second registry load consume the 15-second work
// slice; the 4-second PUT must still fit before the original outer cutoff.
const RealDate = Date;
let clock = RealDate.parse("2026-10-07T00:00:25.000Z");
class TestDate extends RealDate {
  constructor(...args) { super(...(args.length ? args : [clock])); }
  static now() { return clock; }
}
globalThis.Date = TestDate;
try {
  const started = clock, outerDeadline = started + 20_000;
  let network = 0, writeStarted = null;
  const now = new Date();
  const direct = loadTsModule("@/lib/opportunity-engine/pr262-direct-announcements", { ...common,
    "node:timers/promises": { setTimeout: async ms => { clock += ms; } },
    "@/lib/r2-warehouse": {
      readVersionedTextFromR2: async () => {
        clock += 2_000;
        return { found: true, text: JSON.stringify(registry(now)), etag: "before" };
      },
      writeVersionedJsonToR2: async (_key, _value, options) => {
        options.signal.throwIfAborted();
        writeStarted = clock;
        clock += 4_000;
        assert.ok(clock <= outerDeadline, "Registry completion must stay within the original source cutoff");
        return { written: true, conflict: false, etag: "after" };
      },
    },
  });
  const result = await direct.runPr262DirectAnnouncementMonitor({ exposure: cohort, now,
    deadlineAtMs: outerDeadline, fetchImpl: async request => {
      assert.ok(clock < outerDeadline - 5_000, "No provider request may consume the final registry reserve");
      const row = cohort.find(row => String(request) === `https://data.sec.gov/submissions/CIK${row.cik}.json`);
      assert.ok(row);
      network++;
      clock += 1_000;
      return Response.json(body(row, now));
    },
  });
  assert.equal(network, 13);
  assert.equal(result.directWorkBudgetMs, 15_000);
  assert.equal(writeStarted, outerDeadline - 5_000);
  assert.equal(result.registryPersistence.written, true);
  assert.equal(result.registryPersistence.telemetryBasis, "persisted_registry");
  assert.equal(result.sourcePreparationFailures, 0);
  assert.equal(result.secCheckSuccesses, 13);
  assert.equal(result.issuerSourceCoverageEvaluatedAt, new Date(clock).toISOString(), "Coverage is stamped after finalization using the clock that evaluates freshness");
} finally { globalThis.Date = RealDate; }
console.log("Registry finalization preserves completed source evidence, truthful storage failures, and the final five seconds of a late-start source window.");
