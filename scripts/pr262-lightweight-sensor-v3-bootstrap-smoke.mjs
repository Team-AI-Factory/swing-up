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
let persistedSensorCadence = null;
let sensorStateWrites = 0;
let sensorCadenceWrites = 0;
let livePriceWrites = 0;
let persistedLivePrices = null;
let universeLoads = 0;
let exposureAvailable = false;
const emptyProvider = async () => ({ status: "connected", recordsRead: 0, receipts: [], error: null });
const mappingProbeProvider = async () => ({
  status: "connected",
  recordsRead: 3,
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
      id: "routine-low-priority-item",
      title: "Safe Corporation posts a routine community update",
      summary: "No material company or market change was announced.",
      url: "https://example.test/routine-low-priority-item",
      publisher: "Example",
      publishedAt: "2026-08-20T08:59:00.000Z",
      channel: "gdelt",
      official: false,
      primarySource: false,
      scheduled: false,
      symbolHints: ["SAFE"],
      companyHints: [],
      rawEventType: "community_update",
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
    readVersionedTextFromR2: async (key) => {
      if (key.endsWith("sensor/state-v1.json") && persistedSensorState) return { found: true, text: JSON.stringify(persistedSensorState), etag: "sensor-state-etag" };
      if (key.endsWith("sensor/cadence-v1.json") && persistedSensorCadence) return { found: true, text: JSON.stringify(persistedSensorCadence), etag: "sensor-cadence-etag" };
      if (key.endsWith("value-investing/watchlist-live-prices-v1.json") && persistedLivePrices) return { found: true, text: JSON.stringify(persistedLivePrices), etag: "live-prices-etag" };
      return { found: false, text: null, etag: null };
    },
    writeVersionedJsonToR2: async (key, value) => {
      if (key.endsWith("sensor/state-v1.json")) {
        stateWritten = { key, value };
        persistedSensorState = structuredClone(value);
        sensorStateWrites += 1;
      }
      if (key.endsWith("sensor/cadence-v1.json")) {
        persistedSensorCadence = structuredClone(value);
        sensorCadenceWrites += 1;
      }
      if (key.endsWith("value-investing/watchlist-live-prices-v1.json")) {
        persistedLivePrices = structuredClone(value);
        livePriceWrites += 1;
      }
      return { written: true, conflict: false, etag: key.endsWith("cadence-v1.json") ? "sensor-cadence-etag" : "sensor-state-etag" };
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
    runPr262DirectAnnouncementMonitor: async () => ({ events: [], registeredFeeds: 0, feedsPolled: 0, discoveriesAttempted: 0, feedSuccesses: 0, companiesKnown: 0, investorWebsitesFound: 0, feedlessCompanies: 0, discoveryErrors: [] }),
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
assert.equal(companyNameOnly, undefined, "Company-name-only prose can never satisfy exact issuer identity and must not become durable queue backlog.");
assert.equal(result.nonActionableEventsDropped > 0, true, "The sensor must report permanently unmappable records removed from queue consideration.");
assert.equal(structuredTicker.ticker, "SAFE", "An explicit structured ticker may map through the authoritative universe.");
assert.equal(structuredTicker.mappingStatus, "mapped");
assert.equal(stateWritten.value.pending.some((event) => event.title.includes("routine community update")), false, "Routine low-priority discoveries must not be written to the durable R2 queue.");
assert.equal(sensorStateWrites, 1);
assert.equal(sensorCadenceWrites, 1);
exposureAvailable = true;
await loaded.exports.runPr262LightweightSensorV3({
  now: new Date("2026-08-20T09:05:00.000Z"),
  fetchImpl: async (request, init) => init?.method === "POST"
    ? { ok: true, status: 200, json: async () => ({ data: [{ s: "NASDAQ:SAFE", d: ["SAFE", "Safe Corporation", 10, -6, 1_000_000, 4] }] }) }
    : { ok: true, status: 200, text: async () => "<feed></feed>" },
});
const firstMarketEvent = stateWritten.value.pending.find((event) => event.sourceProvider === "tradingview_quality_watchlist_v3");
assert.equal(firstMarketEvent, undefined, "Price-only research must not enter the Serious Signal evidence queue.");
assert.equal(persistedLivePrices.prices[0].ticker, "SAFE");
assert.equal(persistedLivePrices.prices[0].price, 10);
assert.equal(livePriceWrites, 1);

const repeatedSameDay = await loaded.exports.runPr262LightweightSensorV3({
  now: new Date("2026-08-20T09:10:00.000Z"),
  fetchImpl: async (request, init) => init?.method === "POST"
    ? { ok: true, status: 200, json: async () => ({ data: [{ s: "NASDAQ:SAFE", d: ["SAFE", "Safe Corporation", 9.5, -7, 1_200_000, 5] }] }) }
    : { ok: true, status: 200, text: async () => "<feed></feed>" },
});
const repeatedMarketEvents = stateWritten.value.pending.filter((event) => event.sourceProvider === "tradingview_quality_watchlist_v3");
assert.equal(repeatedMarketEvents.length, 0, "Price-only research must remain outside the Serious Signal queue.");
assert.equal(repeatedSameDay.newEvents, 0, "Repeated same-day market observations must not count as new Serious Signal work.");
assert.equal(repeatedSameDay.priceResearchEvents, 0, "Repeated price observations update the live snapshot without recreating queue work.");
assert.equal(persistedLivePrices.prices[0].price, 9.5);
assert.equal(livePriceWrites, 2);
assert.equal(repeatedSameDay.r2Persistence.queueWritten, false, "A quiet scan must not rewrite the full R2 queue.");
assert.equal(repeatedSameDay.r2Persistence.cadenceWritten, true, "A quiet scan must retain only its compact cadence and health checkpoint.");
assert.equal(repeatedSameDay.r2Persistence.unimportantEventsPersisted, 0);
assert.equal(sensorStateWrites, 2, "Only the initial important findings and first price-research identity checkpoint may rewrite the full queue.");
assert.equal(sensorCadenceWrites, 3, "Each scan retains a small scheduling checkpoint so provider cadences remain safe after restart.");

// Existing broad-SEC backlog must retire forms that cannot ever enter the
// decision-grade Serious Signal lane, while retaining supported current filings.
function queuedSecEvent(id, form, accession) {
  const accessionDigits = accession.replace(/-/g, "");
  const url = `https://www.sec.gov/Archives/edgar/data/1/${accessionDigits}/${accession}-index.html`;
  return {
    id,
    source: "sec",
    sourceProvider: "v3_sec_broad",
    sourceHealthStatus: "connected",
    observedAt: "2026-08-20T09:14:00.000Z",
    title: `${form} - Safe Corporation`,
    url,
    sourceUrl: url,
    ticker: "SAFE",
    company: "Safe Corporation",
    kind: form,
    priority: 100,
    reason: "Official SEC filing.",
    cik: "0000000001",
    form,
    accession,
    canonicalSecIndexUrl: url,
    identityMethod: "official_sec_archive_link",
    mappingStatus: "mapped",
    mappingMethod: "official_sec_cik_exact",
    mappingReason: "Exact official CIK.",
    tradingViewSymbol: "NASDAQ:SAFE",
    queueAttempts: 0,
    queueNextAttemptAt: null,
    queueLastAttemptAt: null,
    queueLastError: null,
  };
}
const unsupportedOwnershipEvent = queuedSecEvent("sec:unsupported-form-4", "4", "0000000000-26-000004");
const supportedEightKEvent = queuedSecEvent("sec:supported-8k", "8-K", "0000000000-26-000008");
persistedSensorState = {
  version: 2,
  updatedAt: "2026-08-20T09:14:00.000Z",
  seen: [],
  pending: [unsupportedOwnershipEvent, supportedEightKEvent],
  lastMarketWatchAt: null,
  cursors: { secUrgentFormIndex: 0, newsQueryIndex: 0, officialFeedIndex: 0, directIssuerFeedIndex: 0 },
  sourceHealth: {},
  sensorReadiness: { version: 1, checkedAt: "2026-08-20T09:14:00.000Z", universeReady: true, universeEntries: 1, exposureReady: true, exposureEntries: 1 },
  cloudflareSensor: null,
};
persistedSensorCadence = null;
stateWritten = null;
const unsupportedRetirement = await loaded.exports.runPr262LightweightSensorV3({
  now: new Date("2026-08-20T09:15:00.000Z"),
  fetchImpl: async (request, init) => init?.method === "POST"
    ? { ok: true, status: 200, json: async () => ({ data: [{ s: "NASDAQ:SAFE", d: ["SAFE", "Safe Corporation", 9.5, -7, 1_200_000, 5] }] }) }
    : { ok: true, status: 200, text: async () => "<feed></feed>" },
});
assert.equal(stateWritten.value.pending.some((item) => item.id === unsupportedOwnershipEvent.id), false, "Unsupported SEC forms must not survive in the Serious Signal queue.");
assert.equal(stateWritten.value.pending.some((item) => item.id === supportedEightKEvent.id), true, "Supported exact SEC filings must remain queued for evidence analysis.");
assert.equal(unsupportedRetirement.nonActionableEventsDropped >= 1, true);

console.log(JSON.stringify({
  ok: true,
  cleanNamespaceScansImmediately: true,
  baselineAbsenceReportedHonestly: true,
  valuationDependentLanesFailClosed: true,
  priceResearchSeparatedFromSeriousQueue: true,
  liveWatchlistPriceSnapshotUpdated: true,
  companyNameMappingFailsClosed: true,
  structuredTickerMappingRetained: true,
  importantProductionSensorStatePersisted: true,
  quietScanDoesNotRewriteFullQueue: true,
  unimportantDiscoveriesNotPersisted: true,
  partialOrStaleUniverseCannotCertifyCoverage: true,
  unsupportedSecFormsRetiredFromSeriousQueue: true,
}, null, 2));
