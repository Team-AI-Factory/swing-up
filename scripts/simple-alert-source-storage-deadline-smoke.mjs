import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
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
  } else await assert.rejects(() => fetcher.fetchImpl(root, { signal: controller.signal }), /source_deadline/);
  clearTimeout(timer);
  assert.ok(Date.now() - began < 500);
  assert.equal(network, stage === "snapshot_write" ? 1 : 0, "No source request may start after cache/reservation cancellation");
  assert.ok(writes <= (stage === "snapshot_write" ? 2 : stage === "reservation_write" ? 1 : 0));
}
for (const stage of ["registry_read", "registry_write"]) {
  let network = 0;
  const direct = loadTsModule("@/lib/opportunity-engine/pr262-direct-announcements", { ...common,
    "@/lib/r2-warehouse": {
      readVersionedTextFromR2: async (_key, options) => stage === "registry_read" ? hang(options.signal) : absent,
      writeVersionedJsonToR2: async (_key, _value, options) => hang(options.signal),
    },
  });
  const began = Date.now();
  await assert.rejects(() => direct.runPr262DirectAnnouncementMonitor({ exposure: [], deadlineAtMs: Date.now() + 25, fetchImpl: async () => { network++; throw new Error("No source expected"); } }), /timeout/i);
  assert.ok(Date.now() - began < 500, "Registry read/save cannot add the global 45s retry deadline");
  assert.equal(network, 0);
}
console.log("Source storage deadlines: snapshot read/write, durable reservation read/write and registry load/save abort within the caller window; no source network begins after cancellation.");
// Exercise the complete monitor -> budget -> private-storage path, keeping
// pre-network operational faults outside the real source failure denominator.
for (const stage of ["snapshot_read", "reservation_read", "reservation_write", "snapshot_write", "network_failure"]) {
  const now = new Date();
  let loading = true, network = 0;
  const registry = { version: 1, updatedAt: now.toISOString(), lastDiscoveryCycleAt: now.toISOString(), entries: [{
    ...company, investorWebsite: "https://ir.powerfleet.com/", feedUrl: "https://ir.powerfleet.com/press-releases/rss",
    discoveredAt: now.toISOString(), lastDiscoveryAt: now.toISOString(), lastCheckedAt: null, lastSuccessAt: null,
    nextCheckAt: new Date(now.getTime() + 3600_000).toISOString(), error: null,
  }] };
  const storage = {
    readVersionedTextFromR2: async (key, options = {}) => {
      if (key.endsWith("direct-company-feeds-v1.json")) return { found: true, text: JSON.stringify(registry), etag: "registry" };
      if (!loading && ((stage === "snapshot_read" && key.includes("submissions-cache")) || (stage === "reservation_read" && key.includes("provider-budgets")))) return hang(options.signal);
      return absent;
    },
    writeVersionedJsonToR2: async (key, _value, options = {}) => {
      if ((stage === "reservation_write" && key.includes("provider-budgets")) || (stage === "snapshot_write" && key.includes("submissions-cache"))) return hang(options.signal);
      return { written: true, conflict: false, etag: "written" };
    },
  };
  const overrides = { ...common, "@/lib/r2-warehouse": storage };
  const budget = loadTsModule("@/lib/opportunity-engine/pr262-sensor-fetch-budget", overrides);
  const controller = new AbortController();
  const fetcher = await budget.createPr262SensorBudgetedFetch({ signal: controller.signal, fetchImpl: async () => { network++; if (stage === "snapshot_write") return Response.json(body); throw new TypeError("fetch failed"); } });
  loading = false;
  const direct = loadTsModule("@/lib/opportunity-engine/pr262-direct-announcements", overrides);
  const timer = setTimeout(() => controller.abort(new Error("source_deadline")), 20);
  const result = await direct.runPr262DirectAnnouncementMonitor({ exposure: [company], now, deadlineAtMs: Date.now() + 500, fetchImpl: fetcher.fetchImpl });
  clearTimeout(timer);
  const expectedNetwork = ["network_failure", "snapshot_write"].includes(stage) ? 1 : 0;
  const expectedFailure = stage === "network_failure" ? 1 : 0;
  assert.equal(network, expectedNetwork);
  assert.equal(result.secCheckAttempts, expectedNetwork);
  assert.equal(result.secCheckFailures, expectedFailure);
  assert.equal(result.secCheckSuccesses, stage === "snapshot_write" ? 1 : 0);
  assert.equal(result.sourcePreparationFailures, expectedFailure ? 0 : 1);
  assert.equal(result.failureCount, expectedFailure);
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
