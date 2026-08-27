import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";

const nodeRequire = createRequire(import.meta.url);
const source = readFileSync(new URL("../lib/opportunity-engine/pr262-lightweight-sensor-v3.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;

let stateWritten = null;
let persistedSensorState = null;
let universeLoads = 0;
let exposureAvailable = false;
const emptyProvider = async () => ({ status: "connected", recordsRead: 0, receipts: [], error: null });
const mappingProbeProvider = async () => ({
  status: "connected",
  recordsRead: 2,
  receipts: [
    {
      id: "company-name-only",
      title: "Safe Corporation raises guidance",
      summary: "Safe Corporation issued new guidance.",
      url: "https://example.test/company-name-only",
      publisher: "Example",
      publishedAt: "2026-08-20T08:59:00.000Z",
      channel: "gdelt",
      official: false,
      primarySource: false,
      scheduled: false,
      symbolHints: [],
      companyHints: ["Safe Corporation"],
      rawEventType: "guidance",
    },
    {
      id: "structured-ticker",
      title: "NASDAQ: SAFE raises guidance",
      summary: "SAFE issued new guidance.",
      url: "https://example.test/structured-ticker",
      publisher: "Example",
      publishedAt: "2026-08-20T08:59:00.000Z",
      channel: "gdelt",
      official: false,
      primarySource: false,
      scheduled: false,
      symbolHints: ["SAFE"],
      companyHints: [],
      rawEventType: "guidance",
    },
  ],
  error: null,
});
const stubs = {
  "@/lib/equity-signal/event-sources": {
    fetchAlphaEarningsCalendar: emptyProvider,
    fetchAlphaNews: emptyProvider,
    fetchCommerceNews: emptyProvider,
    fetchFederalRegister: emptyProvider,
    fetchGdeltDiscovery: mappingProbeProvider,
    fetchMarketauxDiscovery: emptyProvider,
    fetchNasdaqTradeHalts: emptyProvider,
    fetchOfficialFeeds: async () => [{ status: "connected", recordsRead: 0, receipts: [], error: null }],
    fetchOpenFdaRecalls: emptyProvider,
  },
  "@/lib/equity-signal/macro": {
    fetchMacroContext: async () => ({ context: { status: "connected", regime: ["no_extreme_macro_change_in_latest_official_observations"], series: [], errors: [] } }),
  },
  "@/lib/equity-signal/universe": {
    validEquityUniverseSnapshot: (snapshot) => snapshot?.version === 1
      && snapshot?.scope === "active_us_exchange_listed_common_equities_and_adrs"
      && Array.isArray(snapshot?.entries)
      && snapshot.entries.length > 0
      && snapshot?.coverage?.eligibleEquities === snapshot.entries.length,
    loadEquityUniverse: async () => {
      universeLoads += 1;
      return {
        snapshot: {
          version: 1,
          scope: "active_us_exchange_listed_common_equities_and_adrs",
          constructionMode: "nasdaq_plus_sec",
          refreshedAt: "2026-08-20T08:55:00.000Z",
          entries: [{ ticker: "SAFE", name: "Safe Corporation", aliases: [], exchange: "NASDAQ", cik: "0000000001", securityType: "common_stock", sourceNames: ["Nasdaq Trader", "SEC"] }],
          coverage: { eligibleEquities: 1, cikMapped: 1 },
          sources: [],
        },
      };
    },
  },
  "@/lib/r2-warehouse": {
    readVersionedTextFromR2: async (key) => key.endsWith("sensor/state-v1.json") && persistedSensorState
      ? { found: true, text: JSON.stringify(persistedSensorState), etag: "sensor-state-etag" }
      : { found: false, text: null, etag: null },
    writeVersionedJsonToR2: async (key, value) => {
      stateWritten = { key, value };
      if (key.endsWith("sensor/state-v1.json")) persistedSensorState = structuredClone(value);
      return { written: true, conflict: false, etag: "sensor-state-etag" };
    },
  },
  "@/lib/opportunity-engine/pr262-storage": {
    pr262StorageKey: (relative) => `production/pr262/${relative}`,
  },
  "@/lib/opportunity-engine/pr262-change-sensor": {
    parseRssForPr262Sensor: () => ({ status: "connected", recordsRead: 0, events: [], error: null }),
    parseSecAtomForSensor: () => ({ status: "connected", recordsRead: 0, events: [], error: null }),
    partitionPr262PendingEvents: (events) => events,
  },
  "@/lib/opportunity-engine/pr262-direct-announcements": {
    runPr262DirectAnnouncementMonitor: async () => ({ events: [], feedsPolled: 0, discoveriesAttempted: 0, feedSuccesses: 0 }),
  },
  "@/lib/opportunity-engine/pr262-exposure-index": {
    loadPr262ExposureIndex: async () => {
      if (!exposureAvailable) throw new Error("pr262_exposure_value_cycle_missing");
      return {
        version: 2,
        valueCycleId: "cycle-1",
        builtAt: "2026-08-20T08:55:00.000Z",
        valueCoverage: { complete: true, totalCompanies: 1, companiesStored: 1, completedBatches: 1, totalBatches: 1 },
        entries: [{ ticker: "SAFE", tradingViewSymbol: "NASDAQ:SAFE", company: "Safe Corporation", cik: "0000000001", buyBelowPrice: 20, strongBuyBelowPrice: 15, trimAbovePrice: 40, businessQuality: 80, marketCap: 1_000_000_000 }],
      };
    },
  },
};

const loaded = { exports: {} };
new Function("require", "module", "exports", output)((name) => {
  if (name in stubs) return stubs[name];
  return nodeRequire(name);
}, loaded, loaded.exports);

const now = new Date("2026-08-20T09:00:00.000Z");
const completeUniverse = {
  version: 1,
  scope: "active_us_exchange_listed_common_equities_and_adrs",
  constructionMode: "nasdaq_plus_sec",
  refreshedAt: "2026-08-20T08:55:00.000Z",
  entries: [{ ticker: "SAFE" }],
  coverage: { eligibleEquities: 1 },
};
assert.equal(loaded.exports.pr262UniverseReadyForSensor(completeUniverse, now), true);
assert.equal(loaded.exports.pr262UniverseReadyForSensor({ ...completeUniverse, constructionMode: "partial_nasdaq_plus_sec" }, now), false);
assert.equal(loaded.exports.pr262UniverseReadyForSensor({ ...completeUniverse, refreshedAt: "2026-08-18T00:00:00.000Z" }, now), false);
const result = await loaded.exports.runPr262LightweightSensorV3({
  now,
  fetchImpl: async (request, init) => init?.method === "POST"
    ? { ok: true, status: 200, json: async () => ({ data: [{ s: "NASDAQ:SAFE", d: ["SAFE", "Safe Corporation", 10, -6, 1_000_000, 4] }] }) }
    : { ok: true, status: 200, text: async () => "<feed></feed>" },
});

assert.equal(result.ok, true, "Connected central sources must keep first-run sensing live.");
assert.equal(result.exposureReady, false);
assert.equal(result.exposureCompanies, 0);
assert.equal(result.exposureError, "pr262_exposure_value_cycle_missing");
assert.equal(result.sourceSummary[0].provider, "exposure_index");
assert.equal(result.sourceSummary[0].status, "not_ready");
assert.equal(result.sourceSummary.find((item) => item.provider === "market_watch").status, "connected");
assert.equal(universeLoads, 1, "The authoritative U.S. universe must still load on a clean namespace.");
assert.equal(stateWritten.key, "production/pr262/sensor/state-v1.json");
assert.equal(stateWritten.value.version, 2);
assert.equal(stateWritten.value.updatedAt, now.toISOString());
assert.equal(stateWritten.value.sensorReadiness.universeReady, true);
assert.equal(stateWritten.value.sensorReadiness.exposureReady, false);
const companyNameOnly = stateWritten.value.pending.find((event) => event.id.includes("v3:" ) && event.title === "Safe Corporation raises guidance");
const structuredTicker = stateWritten.value.pending.find((event) => event.title === "NASDAQ: SAFE raises guidance");
assert.equal(companyNameOnly.ticker, null, "Company-name prose must remain unresolved.");
assert.equal(companyNameOnly.mappingStatus, "unmapped");
assert.equal(structuredTicker.ticker, "SAFE", "An explicit structured ticker may map through the authoritative universe.");
assert.equal(structuredTicker.mappingStatus, "mapped");
exposureAvailable = true;
await loaded.exports.runPr262LightweightSensorV3({
  now: new Date("2026-08-20T09:05:00.000Z"),
  fetchImpl: async (request, init) => init?.method === "POST"
    ? { ok: true, status: 200, json: async () => ({ data: [{ s: "NASDAQ:SAFE", d: ["SAFE", "Safe Corporation", 10, -6, 1_000_000, 4] }] }) }
    : { ok: true, status: 200, text: async () => "<feed></feed>" },
});
const firstMarketEvent = stateWritten.value.pending.find((event) => event.sourceProvider === "tradingview_quality_watchlist_v3");
assert.ok(firstMarketEvent, "The first threshold observation must enter the durable queue.");

const repeatedSameDay = await loaded.exports.runPr262LightweightSensorV3({
  now: new Date("2026-08-20T09:10:00.000Z"),
  fetchImpl: async (request, init) => init?.method === "POST"
    ? { ok: true, status: 200, json: async () => ({ data: [{ s: "NASDAQ:SAFE", d: ["SAFE", "Safe Corporation", 9.5, -7, 1_200_000, 5] }] }) }
    : { ok: true, status: 200, text: async () => "<feed></feed>" },
});
const repeatedMarketEvents = stateWritten.value.pending.filter((event) => event.sourceProvider === "tradingview_quality_watchlist_v3");
assert.equal(repeatedMarketEvents.length, 1, "A lower price five minutes later must reuse the same daily threshold event instead of growing the queue.");
assert.equal(repeatedSameDay.newEvents, 0, "Repeated same-day market observations must not count as new work.");

console.log(JSON.stringify({
  ok: true,
  cleanNamespaceScansImmediately: true,
  baselineAbsenceReportedHonestly: true,
  valuationDependentLanesFailClosed: true,
  sameDayMarketThresholdsDeduplicated: true,
  companyNameMappingFailsClosed: true,
  structuredTickerMappingRetained: true,
  productionSensorStatePersisted: true,
  partialOrStaleUniverseCannotCertifyCoverage: true,
}, null, 2));
