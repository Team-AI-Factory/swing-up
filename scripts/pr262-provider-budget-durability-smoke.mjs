import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/opportunity-engine/pr262-sensor-fetch-budget.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

let stored = null;
let revision = 0;
let networkCalls = 0;
let activeWrites = 0;
let maximumConcurrentWrites = 0;
const stateKey = "branch-labs/pr-262/sensor/provider-budgets-v1.json";
const r2 = {
  readVersionedTextFromR2: async (key) => {
    assert.equal(key, stateKey);
    return stored
      ? { found: true, text: typeof stored.raw === "string" ? stored.raw : JSON.stringify(stored.value), etag: stored.etag }
      : { found: false, text: null, etag: null };
  },
  writeVersionedJsonToR2: async (key, value, options = {}) => {
    assert.equal(key, stateKey);
    activeWrites += 1;
    maximumConcurrentWrites = Math.max(maximumConcurrentWrites, activeWrites);
    try {
      await new Promise((resolve) => setTimeout(resolve, 2));
      if (options.createOnly && stored) return { written: false, conflict: true, etag: null };
      if (options.expectedEtag && stored?.etag !== options.expectedEtag) return { written: false, conflict: true, etag: null };
      stored = { value: structuredClone(value), etag: `etag-${++revision}` };
      return { written: true, conflict: false, etag: stored.etag };
    } finally {
      activeWrites -= 1;
    }
  },
};
const loaded = { exports: {} };
new Function("require", "module", "exports", output)((name) => {
  if (name === "@/lib/r2-warehouse") return r2;
  if (name === "@/lib/opportunity-engine/pr262-storage") return { pr262StorageKey: (relative) => `branch-labs/pr-262/${relative}` };
  throw new Error(`Unexpected provider-budget import: ${name}`);
}, loaded, loaded.exports);

const { createPr262SensorBudgetedFetch } = loaded.exports;
const requestUrl = "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K";
const first = await createPr262SensorBudgetedFetch({
  fetchImpl: async () => {
    networkCalls += 1;
    assert.ok(stored, "The provider reservation must be in R2 before the network starts");
    throw new Error("simulated_process_crash_after_network_start");
  },
});
await assert.rejects(() => first.fetchImpl(requestUrl), /simulated_process_crash/);
assert.equal(networkCalls, 1);
assert.equal(Object.values(stored.value.hourlyCounts.sensor_sec_current_filings).reduce((sum, count) => sum + count, 0), 1);

const restarted = await createPr262SensorBudgetedFetch({
  fetchImpl: async () => {
    networkCalls += 1;
    return new Response("should not be reached");
  },
});
await assert.rejects(
  () => restarted.fetchImpl(requestUrl),
  /minimum_interval;next_retry_at=\d{4}-\d{2}-\d{2}T/,
  "A cadence block must tell the sensor exactly when the provider is safe to call again",
);
assert.equal(networkCalls, 1, "A restart must honor the pre-network reservation left by the crashed process");
const flushed = await restarted.flush();
assert.equal(flushed.reservationsPersistedBeforeNetwork, true);

const currentMs = Date.now();
const currentHour = new Date(Math.floor(currentMs / 3_600_000) * 3_600_000).toISOString().slice(0, 13);
stored = {
  value: {
    version: 2,
    updatedAt: new Date(currentMs).toISOString(),
    hourlyCounts: { sensor_alpha_vantage: { [currentHour]: 20 } },
    lastCadenceAt: {},
  },
  etag: `etag-${++revision}`,
};
const quotaBlocked = await createPr262SensorBudgetedFetch({
  fetchImpl: async () => {
    networkCalls += 1;
    return new Response("must not be reached");
  },
});
let rollingRetryAt = null;
await assert.rejects(
  () => quotaBlocked.fetchImpl("https://www.alphavantage.co/query?function=NEWS_SENTIMENT"),
  (error) => {
    const match = error.message.match(/rolling_24h_budget;next_retry_at=([^;\s]+)/);
    rollingRetryAt = match?.[1] ?? null;
    return Boolean(rollingRetryAt);
  },
  "A full daily budget must report the earliest conservatively safe rolling-window retry",
);
assert.ok(Date.parse(rollingRetryAt) > currentMs + 24 * 60 * 60_000);
assert.ok(Date.parse(rollingRetryAt) <= currentMs + 25 * 60 * 60_000);
assert.equal(networkCalls, 1, "A full Alpha Vantage budget must fail closed before the network");

stored = null;
revision = 0;
maximumConcurrentWrites = 0;
const parallel = await createPr262SensorBudgetedFetch({
  fetchImpl: async () => {
    networkCalls += 1;
    return new Response("ok");
  },
});
await Promise.all([
  "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K",
  "https://news.google.com/rss/search?q=markets",
  "https://api.gdeltproject.org/api/v2/doc/doc?query=markets",
  "https://api.marketaux.com/v1/news/all?symbols=AAPL",
  "https://api.commerce.gov/api/news",
  "https://www.federalregister.gov/api/v1/documents.json",
  "https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=AAPL",
  "https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=MSFT",
].map((url) => parallel.fetchImpl(url)));
assert.equal(maximumConcurrentWrites, 1, "Parallel providers must queue the shared R2 budget reservation instead of colliding.");
assert.equal(networkCalls, 9, "Every independently budgeted provider and exact-symbol Alpha quote may start after its durable reservation.");

stored = { raw: "{invalid-provider-ledger", etag: `etag-${++revision}` };
const corrupted = await createPr262SensorBudgetedFetch({
  fetchImpl: async () => {
    networkCalls += 1;
    return new Response("must not be reached");
  },
});
await assert.rejects(() => corrupted.fetchImpl(requestUrl), /provider_budget_state_invalid/);
assert.equal(networkCalls, 9, "A corrupt quota ledger must fail closed before any provider request");

console.log(JSON.stringify({
  ok: true,
  reservationPersistedBeforeNetwork: true,
  crashCannotEraseProviderUsage: true,
  restartedProcessHonorsDurableCadence: true,
  parallelProviderReservationsSerialized: true,
  corruptLedgerFailsClosed: true,
}, null, 2));
