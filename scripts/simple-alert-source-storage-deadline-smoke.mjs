import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
const { decodePr262SourcePreparationProvenance } = loadTsModule("@/lib/opportunity-engine/pr262-source-failure-provenance");
const cohort = JSON.parse(readFileSync(new URL("../config/simple-alert-pilot.json", import.meta.url))).companies;
const company = cohort[0];
const prefix = "branch-labs/simple-alerts/cohorts/test/";
const root = `https://data.sec.gov/submissions/CIK${company.cik}.json`;
const body = { cik: Number(company.cik), tickers: [company.ticker], filings: { recent: { accessionNumber: [], form: [], filingDate: [], primaryDocument: [] }, files: [] } };
const absent = { found: false, text: null, etag: null };
const hang = signal => new Promise((resolve, reject) => {
  assert.ok(signal, "Storage must receive the request cancellation signal");
  signal.throwIfAborted();
  const timer = setTimeout(() => reject(new Error("Unbounded storage operation")), 1000);
  signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
});
const common = {
  "@/lib/simple-alert-pilot-runtime": { isSimpleAlertPilot: () => true },
  "@/lib/simple-alert-pilot-scope": { pilotCompanies: () => cohort },
  "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: relative => prefix + relative },
};
for (const stage of ["snapshot_read", "reservation_read", "reservation_write", "snapshot_write"]) {
  let loading = true, network = 0, writes = 0;
  const storage = {
    readVersionedTextFromR2: async (key, options = {}) => {
      if (!loading && ((stage === "snapshot_read" && key.includes("submissions-cache")) || (stage === "reservation_read" && key.includes("provider-budgets")))) return hang(options.signal);
      return absent;
    },
    writeVersionedJsonToR2: async (key, _value, options = {}) => {
      writes++;
      if ((stage === "reservation_write" && key.includes("provider-budgets")) || (stage === "snapshot_write" && key.includes("submissions-cache"))) return hang(options.signal);
      return { written: true, conflict: false, etag: "1" };
    },
  };
  const budget = loadTsModule("@/lib/opportunity-engine/pr262-sensor-fetch-budget", { ...common, "@/lib/r2-warehouse": storage });
  const fetcher = await budget.createPr262SensorBudgetedFetch({ fetchImpl: async () => { network++; return Response.json(body); } });
  loading = false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("source_deadline")), 20);
  const began = Date.now();
  if (stage === "snapshot_write") {
    const response = await fetcher.fetchImpl(root, { signal: controller.signal });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-swingup-submissions-cache-write-failed"), "true");
    const detail = decodePr262SourcePreparationProvenance(response.headers.get("x-swingup-submissions-cache-failure-detail"));
    assert.match(detail, /stage=submissions_snapshot_persistence;storage_boundary=unknown/);
    assert.match(detail, /message=source_deadline/);
  } else await assert.rejects(() => fetcher.fetchImpl(root, { signal: controller.signal }), error => {
    assert.match(error.message, /source_deadline/);
    assert.equal(error.sourcePreparationStage, stage === "snapshot_read" ? "submissions_snapshot_read" : "provider_budget_reservation");
    return true;
  });
  clearTimeout(timer);
  assert.ok(Date.now() - began < 500);
  assert.equal(network, stage === "snapshot_write" ? 1 : 0, "No source request may start after cache/reservation cancellation");
  assert.ok(writes <= (stage === "snapshot_write" ? 2 : stage === "reservation_write" ? 1 : 0));
}
for (const stage of ["registry_read", "registry_write"]) for (const expiry of ["in_flight", "before_start"]) {
  let network = 0, reads = 0, writes = 0, observedSignal;
  const originalNow = Date.now;
  const startedAtMs = originalNow();
  let clockMs = startedAtMs;
  const direct = loadTsModule("@/lib/opportunity-engine/pr262-direct-announcements", { ...common,
    "@/lib/r2-warehouse": {
      readVersionedTextFromR2: async (_key, options) => {
        reads++;
        if (stage === "registry_read") { observedSignal = options.signal; return hang(options.signal); }
        // Expire only after a successful read to exercise pre-start write
        // cancellation separately from the pre-start read case.
        if (expiry === "before_start") clockMs = startedAtMs + 25;
        return absent;
      },
      writeVersionedJsonToR2: async (_key, _value, options) => {
        writes++; observedSignal = options.signal; return hang(options.signal);
      },
    },
  });
  // Keep wall-clock scheduling from selecting the other valid cancellation
  // path. Native AbortSignal.timeout still enforces the original 25ms window;
  // the real monotonic elapsed-time assertion remains independent of this clock.
  Date.now = () => clockMs;
  const began = performance.now();
  let result;
  try {
    result = await direct.runPr262DirectAnnouncementMonitor({ exposure: [company], now: new Date(startedAtMs),
      deadlineAtMs: startedAtMs + (expiry === "before_start" && stage === "registry_read" ? -1 : 25),
      fetchImpl: async () => { network++; throw new Error("No source expected"); } });
  } finally { Date.now = originalNow; }
  assert.equal(Date.now, originalNow);
  assert.equal(result.attemptCount, 0);
  assert.equal(result.failureCount, 0);
  assert.equal(result.sourcePreparationFailures, 1);
  assert.equal(result.registryPersistence.written, false);
  assert.equal(result.registryPersistence.failureStage, stage === "registry_read" ? "load" : "write");
  if (expiry === "in_flight") {
    assert.equal(observedSignal.aborted, true);
    assert.equal(observedSignal.reason.name, "TimeoutError");
    assert.match(result.registryPersistence.error, /timeout/i);
  } else {
    assert.equal(observedSignal, undefined, "Pre-start cancellation must not enter the private storage operation");
    assert.equal(result.registryPersistence.error, `direct_registry_${stage === "registry_read" ? "load" : "write"}:direct_registry_deadline`);
  }
  if (stage === "registry_read") {
    assert.equal(result.registeredFeeds, null);
    assert.equal(result.currentEligibleCompaniesKnown, null);
    assert.equal(result.transientDiscoveryBacklog, null);
    assert.equal(result.registryPersistence.telemetryBasis, "unavailable");
    assert.equal(result.issuerSourceCoverage[0].sec.status, "registry_unavailable");
  }
  assert.ok(performance.now() - began < 500, "Registry read/save cannot add the global 45s retry deadline");
  assert.equal(reads, expiry === "before_start" && stage === "registry_read" ? 0 : 1);
  assert.equal(writes, expiry === "in_flight" && stage === "registry_write" ? 1 : 0);
  assert.equal(network, 0);
}
console.log("Source storage deadlines: snapshot read/write, durable reservation read/write and registry load/save abort within the caller window; no source network begins after cancellation.");
// Exercise the complete monitor -> budget -> private-storage path, keeping
// pre-network operational faults outside the real source failure denominator.
for (const stage of ["snapshot_read", "reservation_read", "reservation_write", "snapshot_write", "network_failure", "preparation_delay"]) {
  const now = new Date();
  let loading = true, network = 0, timer;
  const controller = new AbortController();
  const hangAtStage = signal => {
    timer = setTimeout(() => controller.abort(new Error("source_deadline")), 20);
    return hang(signal);
  };
  const registry = { version: 1, updatedAt: now.toISOString(), lastDiscoveryCycleAt: now.toISOString(), entries: [{
    ...company, investorWebsite: "https://ir.powerfleet.com/", feedUrl: "https://ir.powerfleet.com/press-releases/rss",
    discoveredAt: now.toISOString(), lastDiscoveryAt: now.toISOString(), lastCheckedAt: null, lastSuccessAt: null,
    nextCheckAt: new Date(now.getTime() + 3600_000).toISOString(), error: null,
  }] };
  const storage = {
    readVersionedTextFromR2: async (key, options = {}) => {
      if (key.endsWith("direct-company-feeds-v1.json")) {
        if (stage === "preparation_delay") await new Promise(resolve => setTimeout(resolve, 30));
        return { found: true, text: JSON.stringify(registry), etag: "registry" };
      }
      if (!loading && ((stage === "snapshot_read" && key.includes("submissions-cache")) || (stage === "reservation_read" && key.includes("provider-budgets")))) return hangAtStage(options.signal);
      return absent;
    },
    writeVersionedJsonToR2: async (key, _value, options = {}) => {
      if ((stage === "reservation_write" && key.includes("provider-budgets")) || (stage === "snapshot_write" && key.includes("submissions-cache"))) return hangAtStage(options.signal);
      return { written: true, conflict: false, etag: "written" };
    },
  };
  const overrides = { ...common, "@/lib/r2-warehouse": storage };
  const budget = loadTsModule("@/lib/opportunity-engine/pr262-sensor-fetch-budget", overrides);
  const fetcher = await budget.createPr262SensorBudgetedFetch({ signal: controller.signal, fetchImpl: async () => { network++; if (stage === "snapshot_write") return Response.json(body); throw new TypeError("fetch failed"); } });
  loading = false;
  const direct = loadTsModule("@/lib/opportunity-engine/pr262-direct-announcements", overrides);
  // Arm the stage fault on entry, so unrelated registry latency cannot make
  // an intended snapshot/reservation test expire before that operation starts.
  // The separate delay case explicitly verifies truthful unknown attribution.
  if (stage === "preparation_delay") timer = setTimeout(() => controller.abort(new Error("source_deadline")), 20);
  // Admit this operation under the new source-plus-save floor. The original
  // 20ms stage fault and every provenance/accounting assertion remain intact;
  // inadequate admission windows are tested separately as local deferrals.
  const result = await direct.runPr262DirectAnnouncementMonitor({ exposure: [company], now, deadlineAtMs: Date.now() + 15_000, fetchImpl: fetcher.fetchImpl });
  clearTimeout(timer);
  const expectedNetwork = ["network_failure", "snapshot_write"].includes(stage) ? 1 : 0;
  const expectedFailure = stage === "network_failure" ? 1 : 0;
  assert.equal(network, expectedNetwork);
  assert.equal(result.secCheckAttempts, expectedNetwork);
  assert.equal(result.secCheckFailures, expectedFailure);
  assert.equal(result.secCheckSuccesses, stage === "snapshot_write" ? 1 : 0);
  assert.equal(result.sourcePreparationFailures, expectedFailure ? 0 : 1);
  assert.equal(result.failureCount, expectedFailure);
  if (!expectedFailure) {
    const expectedStage = stage === "preparation_delay" ? "unknown" : stage === "snapshot_read" ? "submissions_snapshot_read"
      : stage === "snapshot_write" ? "submissions_snapshot_persistence" : "provider_budget_reservation";
    assert.ok(result.preparationErrors[0].includes(`stage=${expectedStage};storage_boundary=unknown`), JSON.stringify({ stage, actual: result.preparationErrors[0] }));
    assert.match(result.preparationErrors[0], /message=source_deadline/);
  }
}
console.log("Direct source accounting: cancelled private storage remains an observable preparation fault with zero invented SEC attempts; actual network failures still count.");
let initialBudgetLoad = true;
const readFaultBudget = loadTsModule("@/lib/opportunity-engine/pr262-sensor-fetch-budget", { ...common,
  "@/lib/r2-warehouse": {
    readVersionedTextFromR2: async key => {
      if (!initialBudgetLoad && key.includes("provider-budgets")) throw Object.assign(new Error("r2_state_read_http_502"), { storageDomain: "r2_state", storageOperation: "read" });
      return absent;
    },
    writeVersionedJsonToR2: async () => { throw new Error("Failed reservation read must not write"); },
  },
});
const guardedRead = await readFaultBudget.createPr262SensorBudgetedFetch({ fetchImpl: async () => { throw new Error("Failed reservation read must not fetch a source"); } });
initialBudgetLoad = false;
await assert.rejects(() => guardedRead.fetchImpl(root), error => error.storageDomain === "r2_state" && error.storageOperation === "read" && error.sourceNetworkAttempted === false);
console.log("Provider reservation read provenance survives the source-budget boundary for profile failure reporting.");

// A cache read cancelled at its boundary must retain the original R2 error,
// not replace it with the signal's generic timeout or label it a reservation.
for (const exactRoleCancellation of [false, true]) {
  const controller = new AbortController();
  const roleReason = new DOMException("The operation was aborted due to timeout", "TimeoutError");
  const independentTimeout = new DOMException(roleReason.message, roleReason.name);
  const cause = Object.assign(new Error(roleReason.message, { cause: exactRoleCancellation ? roleReason : independentTimeout }),
    { name: roleReason.name, storageDomain: "r2_state", storageOperation: "read" });
  let budgetReads = 0, writes = 0, network = 0;
  const budget = loadTsModule("@/lib/opportunity-engine/pr262-sensor-fetch-budget", { ...common, "@/lib/r2-warehouse": {
    readVersionedTextFromR2: async key => {
      if (key.includes("submissions-cache")) { controller.abort(roleReason); throw cause; }
      budgetReads++; return absent;
    },
    writeVersionedJsonToR2: async () => { writes++; throw new Error("No write expected"); },
  } });
  const guarded = await budget.createPr262SensorBudgetedFetch({ fetchImpl: async () => { network++; throw new Error("No source expected"); } });
  await assert.rejects(() => guarded.fetchImpl(root, { signal: controller.signal }), error => {
    assert.equal(error.cause, cause);
    assert.equal(error.message, roleReason.message);
    assert.equal(error.cause.cause === controller.signal.reason, exactRoleCancellation,
      "Identical timeout text must not turn a coincident independent R2 error into an exact role cancellation");
    assert.equal(error.storageDomain, "r2_state");
    assert.equal(error.storageOperation, "read");
    assert.equal(error.storageContext, "submissions_snapshot");
    assert.equal(error.sourcePreparationStage, "submissions_snapshot_read");
    assert.equal(error.sourceNetworkAttempted, false);
    return true;
  });
  assert.equal(budgetReads, 1, "Only initial loading, no reservation after the cancelled cache read");
  assert.equal(writes, 0);
  assert.equal(network, 0);
}

// The exact known storage boundary and error survive an optional snapshot
// publication failure, without claiming which HTTP sub-operation failed.
{
  let reads = 0, writes = 0, network = 0;
  const cause = Object.assign(new Error("opaque timeout https://private.example/?token=secret\n" + "x".repeat(500)),
    { name: "TimeoutError", storageDomain: "r2_state", storageOperation: "write" });
  const budget = loadTsModule("@/lib/opportunity-engine/pr262-sensor-fetch-budget", { ...common, "@/lib/r2-warehouse": {
    readVersionedTextFromR2: async () => { reads++; return absent; },
    writeVersionedJsonToR2: async key => {
      writes++;
      if (key.includes("submissions-cache")) throw cause;
      return { written: true, conflict: false, etag: "1" };
    },
  } });
  const guarded = await budget.createPr262SensorBudgetedFetch({ fetchImpl: async () => { network++; return Response.json(body); } });
  const response = await guarded.fetchImpl(root);
  const detail = decodePr262SourcePreparationProvenance(response.headers.get("x-swingup-submissions-cache-failure-detail"));
  assert.match(detail, /^stage=submissions_snapshot_persistence;storage_boundary=r2_write;error=TimeoutError;message=opaque timeout/);
  assert.ok(!detail.includes("token=secret") && !detail.includes("\n"));
  assert.ok(detail.length < 400);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), body);
  assert.equal(reads, 3, "Initial budget, cache, and reservation reads only");
  assert.equal(writes, 2, "One reservation and one optional snapshot PUT, no diagnostic retries");
  assert.equal(network, 1);
}
console.log("Preparation provenance retains known stages and tagged storage boundaries, with unknown sub-operation and no additional I/O.");

// The real consumer must not turn arbitrary or malformed response metadata
// into an asserted operation, even when a legacy failure flag is present.
for (const detail of [null, "%", encodeURIComponent("stage=made_up;storage_boundary=r2_delete"),
  encodeURIComponent(JSON.stringify({ version: 1, stage: "made_up", storageBoundary: "r2_write", errorName: "TimeoutError", message: "timeout" })),
  encodeURIComponent(JSON.stringify({ version: 1, stage: "submissions_snapshot_persistence", storageBoundary: "r2_delete", errorName: "Error", message: "timeout" })),
  encodeURIComponent(JSON.stringify({ version: 2, stage: "submissions_snapshot_persistence", storageBoundary: "r2_write", errorName: "Error", message: "timeout" })), "x".repeat(2001)]) {
  const now = new Date();
  const registry = { version: 1, updatedAt: now.toISOString(), lastDiscoveryCycleAt: now.toISOString(), entries: [{
    ...company, investorWebsite: "https://ir.powerfleet.com/", feedUrl: "https://ir.powerfleet.com/press-releases/rss",
    discoveredAt: now.toISOString(), lastDiscoveryAt: now.toISOString(), lastCheckedAt: null, lastSuccessAt: null,
    nextCheckAt: new Date(now.getTime() + 3600_000).toISOString(), error: null,
  }] };
  const direct = loadTsModule("@/lib/opportunity-engine/pr262-direct-announcements", { ...common, "@/lib/r2-warehouse": {
    readVersionedTextFromR2: async () => ({ found: true, text: JSON.stringify(registry), etag: "registry" }),
    writeVersionedJsonToR2: async () => ({ written: true, conflict: false, etag: "written" }),
  } });
  let network = 0;
  const result = await direct.runPr262DirectAnnouncementMonitor({ exposure: [company], now, deadlineAtMs: Date.now() + 15_000,
    fetchImpl: async () => {
      network++;
      return Response.json(body, { headers: { "x-swingup-submissions-cache-write-failed": "true",
        ...(detail === null ? {} : { "x-swingup-submissions-cache-failure-detail": detail }) } });
    } });
  assert.equal(network, 1);
  assert.equal(result.attemptCount, 1);
  assert.equal(result.successCount, 1);
  assert.equal(result.failureCount, 0);
  assert.equal(result.sourcePreparationFailures, 1);
  assert.equal(result.preparationErrors[0], "sec_snapshot_cache_write_failed;stage=unknown;storage_boundary=unknown;error=unknown;message=unknown");
}
console.log("Malformed, unsupported and legacy source-failure headers retain unknown provenance through the real monitor.");
