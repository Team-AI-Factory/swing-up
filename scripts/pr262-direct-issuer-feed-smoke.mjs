import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";

const monitor = readFileSync(new URL("../lib/opportunity-engine/pr262-direct-announcements.ts", import.meta.url), "utf8");
const sensor = readFileSync(new URL("../lib/opportunity-engine/pr262-lightweight-sensor-v3.ts", import.meta.url), "utf8");

assert.match(monitor, /DISCOVERY_CADENCE_MS = 30 \* 60_000/, "Issuer SEC submissions discovery must run every thirty minutes so the shared 190/day SEC ledger retains hard headroom.");
assert.match(monitor, /MAX_DISCOVERIES_PER_CYCLE = 3/, "Issuer discovery may use 144 of its dedicated 190/day SEC submissions fuse without creating a burst.");
assert.match(sensor, /run\("sec_broad", HOUR_MS/, "Broad SEC discovery must run hourly.");
assert.match(sensor, /run\("sec_urgent", FIFTEEN_MINUTES_MS/, "Urgent SEC discovery must retain the fifteen-minute cadence.");
assert.match(monitor, /DISCOVERY_CONCURRENCY = 1/, "Issuer discovery must not create concurrent SEC budget reservations.");
assert.match(monitor, /CONFIRMED_NO_FEED_RETRY_DAYS = \[30, 60, 90\]/, "Confirmed missing feeds must move through the cost-neutral thirty, sixty, and ninety-day retry ladder.");
assert.match(monitor, /TRANSIENT_DISCOVERY_RETRY_MS = 60 \* 60_000/, "Transient discovery failures must become eligible again within one hour.");
assert.match(monitor, /enotfound[\s\S]*?eai_again[\s\S]*?sec_submissions_invalid_json/i, "DNS and malformed SEC response failures must remain transient discovery work.");
assert.match(monitor, /embeddedProviderRetryAt[\s\S]*?next_retry_at/, "Provider budget guards must retain their exact durable retry time.");
assert.match(monitor, /discoveryTier[\s\S]*?transient_retry[\s\S]*?unseen[\s\S]*?confirmed_no_feed_recheck/, "Useful transient and unseen discovery must outrank confirmed no-feed rechecks.");
assert.match(monitor, /failedFeedRetry[\s\S]*?MAX_FAILED_FEED_BACKOFF_MS[\s\S]*?consecutiveFailures/, "Broken issuer feeds must back off progressively while healthy feeds retain their fifteen-minute cadence.");
assert.match(monitor, /transientDiscoveryBacklog/, "Runtime telemetry must expose how many issuer discoveries are waiting only on transient recovery.");
assert.match(monitor, /officialSecIdentityMappedCompanies:[\s\S]*?directIrRssFeeds:[\s\S]*?seriousSignalCoverageDependsOnRss: false/, "Telemetry must separate exact SEC issuer coverage from optional company RSS enrichment.");
assert.match(monitor, /transientDiscoveryDueNow[\s\S]*?transientDiscoveryWaiting/, "Backlog telemetry must separate work due now from retry cooldowns.");
assert.match(monitor, /recentSecFilingEvents/, "Each already-budgeted SEC submissions response must also yield current decision-grade issuer filings.");
assert.match(monitor, /id: `sec:\$\{accession\}`/, "Direct issuer SEC events must deduplicate against the global SEC feed by accession.");
assert.match(monitor, /Promise\.all\(discoveryTargets\.slice\(start, start \+ DISCOVERY_CONCURRENCY\)/, "Issuer discovery must use its bounded parallel batch.");
assert.match(monitor, /strongBuyBelowPrice[\s\S]*?buyBelowPrice[\s\S]*?trimAbovePrice/, "Issuer discovery must prioritize the live valuation watchlist before traversing the rest of the universe.");
assert.match(monitor, /if \(url\.protocol === "http:"\)[\s\S]*?url\.protocol = "https:"/, "Legacy SEC website values must be safely upgraded to HTTPS before discovery.");
assert.match(monitor, /discoverInvestorPages\(page\.body, page\.finalUrl\)/, "Discovery must follow a bounded investor/news page when the corporate homepage has no feed link.");
assert.match(monitor, /\.slice\(0, 2\)/, "Nested issuer-page discovery must remain tightly bounded.");
assert.match(monitor, /investorWebsitesFound[\s\S]*?feedlessCompanies[\s\S]*?discoveryErrors/, "Production diagnostics must distinguish missing issuer websites from missing feed links and transport errors.");
assert.match(monitor, /const existing = registry\.entries\.find[\s\S]*?existing\.feedUrl = feedUrl/, "A configured official issuer feed must repair an existing feedless registry entry.");
assert.match(monitor, /issuer_website_missing_in_sec_submissions/, "Issuer telemetry must distinguish a missing SEC website from a website that exposes no RSS feed.");
assert.match(sensor, /recordsRead: direct\.feedsPolled \+ direct\.secSubmissionsChecked/, "Cost telemetry must report RSS polls and SEC submissions checks honestly.");
assert.match(sensor, /transientDiscoveryBacklog: direct\.transientDiscoveryBacklog/, "The production sensor must not drop issuer discovery backlog telemetry.");
assert.match(sensor, /unseenCompanies: direct\.unseenCompanies[\s\S]*?confirmedNoFeedBacklog: direct\.confirmedNoFeedBacklog[\s\S]*?discoverySelection: direct\.discoverySelection/, "Production telemetry must expose the real unseen, transient, confirmed-miss, and selected discovery work.");
assert.match(sensor, /direct\.attemptCount > 0[\s\S]*?direct\.successCount === 0[\s\S]*?temporarily_unavailable[\s\S]*?direct\.failureCount > 0[\s\S]*?partial/, "Direct-source health must distinguish total failure from mixed success.");
assert.match(sensor, /telemetryAvailable: false[\s\S]*?transientDiscoveryBacklog: null/, "Unavailable registry telemetry must remain explicitly unknown.");
assert.match(monitor, /written\.conflict \? await loadRegistry\(\) : null/, "A CAS loser must read the committed registry winner once instead of retrying provider work.");

const nodeRequire = createRequire(import.meta.url);
const output = ts.transpileModule(monitor, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
let registry = null;
let registryEtag = 0;
let registryReads = 0;
let registryWrites = 0;
let nextConflictWinner = null;
let registryTextOverride = null;
const loaded = { exports: {} };
new Function("require", "module", "exports", output)((name) => {
  if (name === "node:dns/promises") return { lookup: async () => [{ address: "93.184.216.34", family: 4 }] };
  if (name === "@/lib/r2-warehouse") return {
    readVersionedTextFromR2: async () => {
      registryReads += 1;
      return registry
        ? { found: true, text: registryTextOverride ?? JSON.stringify(registry), etag: `"registry-${registryEtag}"` }
        : { found: false, text: null, etag: null };
    },
    writeVersionedJsonToR2: async (_key, value) => {
      registryWrites += 1;
      if (nextConflictWinner) {
        registry = structuredClone(nextConflictWinner);
        nextConflictWinner = null;
        registryEtag += 1;
        return { written: false, conflict: true, etag: null };
      }
      registry = structuredClone(value);
      registryEtag += 1;
      return { written: true, conflict: false, etag: `"registry-${registryEtag}"` };
    },
  };
  if (name === "@/lib/opportunity-engine/pr262-storage") return { pr262StorageKey: (relative) => `production/pr262/${relative}` };
  return nodeRequire(name);
}, loaded, loaded.exports);

function response(body, contentType = "text/html") {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": contentType }),
    text: async () => body,
  };
}

const runtime = await loaded.exports.runPr262DirectAnnouncementMonitor({
  now: new Date("2026-08-28T09:00:00.000Z"),
  exposure: [{
    ticker: "SAFE",
    company: "Safe Corporation",
    cik: "0000000001",
    currentPrice: 10,
    strongBuyBelowPrice: 12,
    buyBelowPrice: 15,
    trimAbovePrice: 40,
    businessQuality: 80,
    marketCap: 1_000_000_000,
  }],
  fetchImpl: async (request) => {
    const url = String(request);
    if (url === "https://data.sec.gov/submissions/CIK0000000001.json") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          investorWebsite: "http://issuer.example",
          filings: {
            recent: {
              accessionNumber: ["0000000001-26-000001"],
              form: ["8-K"],
              acceptanceDateTime: ["20260828084500"],
              filingDate: ["2026-08-28"],
              items: ["2.02,9.01"],
              primaryDocDescription: ["Current report"],
            },
          },
        }),
      };
    }
    if (url === "https://issuer.example/") return response('<a href="/investors/news">Investor news</a>');
    if (url === "https://issuer.example/investors/news") return response('<link rel="alternate" type="application/rss+xml" href="/investors/rss.xml">');
    if (url === "https://issuer.example/investors/rss.xml") return response(`
      <rss><channel><item><title>Safe Corporation raises guidance</title><link>https://issuer.example/news/guidance</link><pubDate>2026-08-28T08:30:00.000Z</pubDate></item></channel></rss>
    `, "application/rss+xml");
    throw new Error(`Unexpected issuer-feed request: ${url}`);
  },
});
assert.equal(runtime.registeredFeeds, 1);
assert.equal(runtime.officialSecIdentityMappedCompanies, 1);
assert.equal(runtime.directIrRssFeeds, 1);
assert.equal(runtime.rssIsOptionalEnrichment, true);
assert.equal(runtime.seriousSignalCoverageDependsOnRss, false);
assert.equal(runtime.feedsPolled, 1);
assert.equal(runtime.feedSuccesses, 1);
assert.equal(runtime.investorWebsitesFound, 1);
assert.equal(runtime.feedlessCompanies, 0);
assert.equal(runtime.secSubmissionsChecked, 1);
assert.equal(runtime.secFilingsFound, 1);
assert.equal(runtime.attemptCount, 2);
assert.equal(runtime.successCount, 2);
assert.equal(runtime.failureCount, 0);
assert.equal(runtime.events.length, 2);
const secEvent = runtime.events.find((event) => event.source === "sec");
const rssEvent = runtime.events.find((event) => event.sourceProvider === "issuer_ir_safe");
assert.equal(secEvent?.id, "sec:0000000001-26-000001");
assert.equal(secEvent?.identityMethod, "official_sec_archive_link");
assert.equal(secEvent?.mappingStatus, "mapped");
assert.equal(rssEvent?.mappingStatus, "mapped");
assert.equal(registry.entries[0].investorWebsite, "http://issuer.example");
assert.equal(registry.entries[0].feedUrl, "https://issuer.example/investors/rss.xml");

registry.entries[0] = {
  ...registry.entries[0],
  investorWebsite: null,
  feedUrl: null,
  nextCheckAt: "2026-08-29T09:00:00.000Z",
  error: "issuer_rss_feed_not_discovered",
};
process.env.SWING_UP_PR262_DIRECT_FEEDS_JSON = JSON.stringify([{
  ticker: "SAFE",
  investorWebsite: "https://configured.example/investors",
  feedUrl: "https://configured.example/releases.xml",
}]);
let configuredRecovery;
try {
  configuredRecovery = await loaded.exports.runPr262DirectAnnouncementMonitor({
    now: new Date("2026-08-28T09:01:00.000Z"),
    exposure: [{
      ticker: "SAFE",
      company: "Safe Corporation",
      cik: "0000000001",
      currentPrice: 10,
      strongBuyBelowPrice: 12,
      buyBelowPrice: 15,
      trimAbovePrice: 40,
      businessQuality: 80,
      marketCap: 1_000_000_000,
    }],
    fetchImpl: async (request) => {
      const url = String(request);
      if (url === "https://configured.example/releases.xml") return response(`
        <rss><channel><item><title>Safe Corporation announces contract</title><link>https://configured.example/news/contract</link><pubDate>2026-08-28T09:00:00.000Z</pubDate></item></channel></rss>
      `, "application/rss+xml");
      throw new Error(`Unexpected configured issuer-feed request: ${url}`);
    },
  });
} finally {
  delete process.env.SWING_UP_PR262_DIRECT_FEEDS_JSON;
}
assert.equal(configuredRecovery.registeredFeeds, 1);
assert.equal(configuredRecovery.feedsPolled, 1);
assert.equal(configuredRecovery.feedSuccesses, 1);
assert.equal(configuredRecovery.discoveriesAttempted, 0, "A configured feed patch must not consume another SEC discovery call");
assert.equal(configuredRecovery.events.length, 1);
assert.equal(registry.entries[0].investorWebsite, "https://configured.example/investors");
assert.equal(registry.entries[0].feedUrl, "https://configured.example/releases.xml");
assert.equal(registry.entries[0].error, null);
assert.equal(registry.entries[0].consecutiveConfirmedNoFeedDiscoveries, 0);

registry.entries[0] = {
  ...registry.entries[0],
  investorWebsite: null,
  feedUrl: null,
  lastDiscoveryAt: "2026-08-28T09:00:00.000Z",
  nextCheckAt: "2026-08-29T09:00:00.000Z",
  error: "pr262_sensor_budget_guard:sec_edgar:rolling_24h_budget",
};
registry.lastDiscoveryCycleAt = "2026-08-28T09:00:00.000Z";
const transientRecovery = await loaded.exports.runPr262DirectAnnouncementMonitor({
  now: new Date("2026-08-28T10:01:00.000Z"),
  exposure: [{
    ticker: "SAFE",
    company: "Safe Corporation",
    cik: "0000000001",
    currentPrice: 10,
    strongBuyBelowPrice: 12,
    buyBelowPrice: 15,
    trimAbovePrice: 40,
    businessQuality: 80,
    marketCap: 1_000_000_000,
  }],
  fetchImpl: async (request) => {
    const url = String(request);
    if (url === "https://data.sec.gov/submissions/CIK0000000001.json") {
      return { ok: true, status: 200, json: async () => ({ investorWebsite: "http://issuer.example" }) };
    }
    if (url === "https://issuer.example/") return response('<a href="/investors/news">Investor news</a>');
    if (url === "https://issuer.example/investors/news") return response('<link rel="alternate" type="application/rss+xml" href="/investors/rss.xml">');
    if (url === "https://issuer.example/investors/rss.xml") return response(`
      <rss><channel><item><title>Safe Corporation raises guidance</title><link>https://issuer.example/news/guidance</link><pubDate>2026-08-28T10:00:00.000Z</pubDate></item></channel></rss>
    `, "application/rss+xml");
    throw new Error(`Unexpected transient issuer-feed request: ${url}`);
  },
});
assert.equal(transientRecovery.discoveriesAttempted, 1, "A transient discovery failure must retry after one hour even when its old nextCheckAt was daily");
assert.equal(transientRecovery.registeredFeeds, 1);
assert.equal(transientRecovery.transientDiscoveryBacklog, 0);

const DAY_MS = 24 * 60 * 60_000;
const exposureCompany = (ticker, cik, highPriority = false) => ({
  ticker,
  company: `${ticker} Corporation`,
  cik,
  currentPrice: highPriority ? 10 : 50,
  strongBuyBelowPrice: 12,
  buyBelowPrice: 15,
  trimAbovePrice: 100,
  businessQuality: 80,
  marketCap: 1_000_000_000,
});
const registryEntry = (ticker, cik, overrides = {}) => ({
  ticker,
  company: `${ticker} Corporation`,
  cik,
  investorWebsite: null,
  feedUrl: null,
  discoveredAt: "2026-08-01T00:00:00.000Z",
  lastDiscoveryAt: "2026-08-01T00:00:00.000Z",
  lastCheckedAt: null,
  lastSuccessAt: null,
  nextCheckAt: "2026-08-02T00:00:00.000Z",
  error: "issuer_website_missing_in_sec_submissions",
  consecutiveFailures: 0,
  ...overrides,
});
const noWebsiteResponse = {
  ok: true,
  status: 200,
  json: async () => ({}),
};

registry = null;
const incompleteNestedDiscovery = await loaded.exports.runPr262DirectAnnouncementMonitor({
  now: new Date("2026-07-01T00:00:00.000Z"),
  exposure: [exposureCompany("NESTFAIL", "0000000008")],
  fetchImpl: async (request) => {
    const url = String(request);
    if (url === "https://data.sec.gov/submissions/CIK0000000008.json") {
      return { ok: true, status: 200, json: async () => ({ investorWebsite: "https://nested-failure.example" }) };
    }
    if (url === "https://nested-failure.example/") return response('<a href="/investors/news">Investor news</a>');
    if (url === "https://nested-failure.example/investors/news") throw new Error("fetch failed");
    throw new Error(`Unexpected incomplete nested request: ${url}`);
  },
});
assert.equal(incompleteNestedDiscovery.transientDiscoveryBacklog, 1);
assert.equal(incompleteNestedDiscovery.confirmedNoFeedBacklog, 0, "An inaccessible nested page must not be mislabeled as a confirmed missing feed");
assert.equal(incompleteNestedDiscovery.discoverySuccesses, 0);
assert.equal(incompleteNestedDiscovery.discoveryFailures, 1, "A successful SEC response plus an inaccessible issuer page is still an incomplete discovery");
assert.equal(incompleteNestedDiscovery.successCount, 0);
assert.equal(incompleteNestedDiscovery.failureCount, 1);
assert.equal(registry.entries[0].consecutiveConfirmedNoFeedDiscoveries, 0);
assert.equal(Date.parse(registry.entries[0].nextCheckAt) - Date.parse(registry.entries[0].lastDiscoveryAt), 60 * 60_000);

for (const failureCase of [
  {
    ticker: "NXDOMAIN",
    cik: "0000000081",
    expectedError: "direct_feed_network_enotfound",
    response: () => { throw Object.assign(new Error("getaddrinfo ENOTFOUND private-host-detail.example"), { code: "ENOTFOUND" }); },
  },
  {
    ticker: "DNSAGAIN",
    cik: "0000000082",
    expectedError: "direct_feed_network_eai_again",
    response: () => { throw Object.assign(new Error("temporary resolver detail"), { code: "EAI_AGAIN" }); },
  },
  {
    ticker: "BADJSON",
    cik: "0000000083",
    expectedError: "direct_feed_sec_submissions_invalid_json",
    response: () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected end of JSON input"); } }),
  },
]) {
  registry = null;
  const failureAt = new Date("2026-07-02T00:00:00.000Z");
  const failedDiscovery = await loaded.exports.runPr262DirectAnnouncementMonitor({
    now: failureAt,
    exposure: [exposureCompany(failureCase.ticker, failureCase.cik)],
    fetchImpl: async () => failureCase.response(),
  });
  assert.equal(failedDiscovery.discoverySuccesses, 0);
  assert.equal(failedDiscovery.discoveryFailures, 1);
  assert.equal(failedDiscovery.attemptCount, 1);
  assert.equal(failedDiscovery.successCount, 0);
  assert.equal(failedDiscovery.failureCount, 1);
  assert.equal(failedDiscovery.transientDiscoveryBacklog, 1);
  assert.equal(registry.entries[0].error, failureCase.expectedError);
  assert.equal(Date.parse(registry.entries[0].nextCheckAt) - failureAt.getTime(), 60 * 60_000);
}

registry = {
  version: 1,
  updatedAt: "2026-08-01T00:00:00.000Z",
  discoveryCursor: 4100,
  lastDiscoveryCycleAt: "2026-08-01T00:00:00.000Z",
  entries: [registryEntry("LEGACY", "0000000010")],
};
let legacyNetworkCalls = 0;
const legacyMigration = await loaded.exports.runPr262DirectAnnouncementMonitor({
  now: new Date("2026-08-02T00:01:00.000Z"),
  exposure: [exposureCompany("LEGACY", "0000000010")],
  fetchImpl: async () => {
    legacyNetworkCalls += 1;
    return noWebsiteResponse;
  },
});
assert.equal(legacyNetworkCalls, 0, "Migrating a legacy daily no-feed retry must not spend a network request");
assert.equal(legacyMigration.discoveriesAttempted, 0);
assert.equal(legacyMigration.confirmedNoFeedDueNow, 0);
assert.equal(legacyMigration.confirmedNoFeedWaiting, 1);
assert.equal(registry.entries[0].consecutiveConfirmedNoFeedDiscoveries, 1);
assert.equal(registry.entries[0].nextCheckAt, "2026-08-31T00:00:00.000Z");

registry = {
  version: 1,
  updatedAt: "2026-08-01T00:00:00.000Z",
  discoveryCursor: 4000,
  lastDiscoveryCycleAt: "2026-08-01T00:00:00.000Z",
  entries: [
    registryEntry("TRANS", "0000000020", {
      lastDiscoveryAt: "2026-09-30T20:00:00.000Z",
      nextCheckAt: "2026-10-01T20:00:00.000Z",
      error: "pr262_sensor_budget_guard:sec_edgar:rolling_24h_budget",
    }),
    registryEntry("HIGHMISS", "0000000040", { consecutiveConfirmedNoFeedDiscoveries: 1 }),
    registryEntry("MISS", "0000000050", { consecutiveConfirmedNoFeedDiscoveries: 1 }),
  ],
};
const priorityExposure = [
  exposureCompany("HIGHNEW", "0000000019", true),
  exposureCompany("TRANS", "0000000020"),
  exposureCompany("NORMALNEW", "0000000030"),
  exposureCompany("HIGHMISS", "0000000040", true),
  exposureCompany("MISS", "0000000050"),
];
const priorityRequests = [];
const prioritized = await loaded.exports.runPr262DirectAnnouncementMonitor({
  now: new Date("2026-10-01T00:00:00.000Z"),
  exposure: priorityExposure,
  fetchImpl: async (request) => {
    priorityRequests.push(String(request));
    return noWebsiteResponse;
  },
});
assert.deepEqual(priorityRequests, [
  "https://data.sec.gov/submissions/CIK0000000019.json",
  "https://data.sec.gov/submissions/CIK0000000020.json",
  "https://data.sec.gov/submissions/CIK0000000030.json",
]);
assert.equal(prioritized.discoveriesAttempted, 3);
assert.deepEqual(prioritized.discoverySelection, {
  total: 3,
  highPriority: 1,
  unseen: 2,
  transientRetry: 1,
  confirmedNoFeedRecheck: 0,
  otherRecheck: 0,
});
assert.equal(registry.entries.find((entry) => entry.ticker === "HIGHMISS").lastDiscoveryAt, "2026-08-01T00:00:00.000Z", "A due confirmed miss must not displace useful discovery");
assert.equal(registry.entries.find((entry) => entry.ticker === "MISS").lastDiscoveryAt, "2026-08-01T00:00:00.000Z", "A routine confirmed miss must remain the final tier");

const backedOffTicker = "HIGHNEW";
let backedOffEntry = registry.entries.find((entry) => entry.ticker === backedOffTicker);
assert.equal(backedOffEntry.consecutiveConfirmedNoFeedDiscoveries, 1);
assert.equal(Date.parse(backedOffEntry.nextCheckAt) - Date.parse(backedOffEntry.lastDiscoveryAt), 30 * DAY_MS);
let backoffNetworkCalls = 0;
const beforeFirstBackoff = await loaded.exports.runPr262DirectAnnouncementMonitor({
  now: new Date(Date.parse(backedOffEntry.lastDiscoveryAt) + 29 * DAY_MS),
  exposure: [exposureCompany(backedOffTicker, "0000000019", true)],
  fetchImpl: async () => {
    backoffNetworkCalls += 1;
    return noWebsiteResponse;
  },
});
assert.equal(beforeFirstBackoff.discoveriesAttempted, 0);
assert.equal(backoffNetworkCalls, 0);

const secondMissAt = new Date(Date.parse(backedOffEntry.nextCheckAt) + 60_000);
await loaded.exports.runPr262DirectAnnouncementMonitor({
  now: secondMissAt,
  exposure: [exposureCompany(backedOffTicker, "0000000019", true)],
  fetchImpl: async () => {
    backoffNetworkCalls += 1;
    return noWebsiteResponse;
  },
});
backedOffEntry = registry.entries.find((entry) => entry.ticker === backedOffTicker);
assert.equal(backedOffEntry.consecutiveConfirmedNoFeedDiscoveries, 2);
assert.equal(Date.parse(backedOffEntry.nextCheckAt) - Date.parse(backedOffEntry.lastDiscoveryAt), 60 * DAY_MS);

const thirdMissAt = new Date(Date.parse(backedOffEntry.nextCheckAt) + 60_000);
await loaded.exports.runPr262DirectAnnouncementMonitor({
  now: thirdMissAt,
  exposure: [exposureCompany(backedOffTicker, "0000000019", true)],
  fetchImpl: async () => {
    backoffNetworkCalls += 1;
    return noWebsiteResponse;
  },
});
backedOffEntry = registry.entries.find((entry) => entry.ticker === backedOffTicker);
assert.equal(backedOffEntry.consecutiveConfirmedNoFeedDiscoveries, 3);
assert.equal(Date.parse(backedOffEntry.nextCheckAt) - Date.parse(backedOffEntry.lastDiscoveryAt), 90 * DAY_MS);

const fourthMissAt = new Date(Date.parse(backedOffEntry.nextCheckAt) + 60_000);
await loaded.exports.runPr262DirectAnnouncementMonitor({
  now: fourthMissAt,
  exposure: [exposureCompany(backedOffTicker, "0000000019", true)],
  fetchImpl: async () => {
    backoffNetworkCalls += 1;
    return noWebsiteResponse;
  },
});
backedOffEntry = registry.entries.find((entry) => entry.ticker === backedOffTicker);
assert.equal(backedOffEntry.consecutiveConfirmedNoFeedDiscoveries, 4);
assert.equal(Date.parse(backedOffEntry.nextCheckAt) - Date.parse(backedOffEntry.lastDiscoveryAt), 90 * DAY_MS, "Confirmed misses must remain capped at ninety days");
assert.equal(backoffNetworkCalls, 3);

registry = {
  version: 1,
  updatedAt: "2027-08-01T00:00:00.000Z",
  discoveryCursor: 0,
  lastDiscoveryCycleAt: "2027-07-31T00:00:00.000Z",
  entries: [registryEntry("WAIT", "0000000060", {
    lastDiscoveryAt: "2027-07-31T00:00:00.000Z",
    nextCheckAt: "2027-08-01T01:00:00.000Z",
    error: "pr262_sensor_budget_guard:sec_edgar:rolling_24h_budget;next_retry_at=2027-08-02T00:00:00.000Z",
  })],
};
let providerRetryCalls = 0;
const providerWaiting = await loaded.exports.runPr262DirectAnnouncementMonitor({
  now: new Date("2027-08-01T12:00:00.000Z"),
  exposure: [exposureCompany("WAIT", "0000000060")],
  fetchImpl: async () => {
    providerRetryCalls += 1;
    return noWebsiteResponse;
  },
});
assert.equal(providerWaiting.discoveriesAttempted, 0);
assert.equal(providerWaiting.transientDiscoveryDueNow, 0);
assert.equal(providerWaiting.transientDiscoveryWaiting, 1);
assert.equal(providerRetryCalls, 0, "An exact provider retry time must override the generic one-hour transient retry");
const providerReady = await loaded.exports.runPr262DirectAnnouncementMonitor({
  now: new Date("2027-08-02T00:01:00.000Z"),
  exposure: [exposureCompany("WAIT", "0000000060")],
  fetchImpl: async () => {
    providerRetryCalls += 1;
    return noWebsiteResponse;
  },
});
assert.equal(providerReady.discoveriesAttempted, 1);
assert.equal(providerReady.discoverySelection.transientRetry, 1);
assert.equal(providerRetryCalls, 1);

registry = {
  version: 1,
  updatedAt: "2027-09-01T00:00:00.000Z",
  discoveryCursor: 0,
  lastDiscoveryCycleAt: "2027-08-01T00:00:00.000Z",
  entries: [
    registryEntry("OLD1", "0000000071", { lastDiscoveryAt: "2027-08-01T00:00:00.000Z", error: "fetch failed" }),
    registryEntry("OLD2", "0000000072", { lastDiscoveryAt: "2027-08-01T01:00:00.000Z", error: "fetch failed" }),
    registryEntry("OLD3", "0000000073", { lastDiscoveryAt: "2027-08-01T02:00:00.000Z", error: "fetch failed" }),
    registryEntry("NEWER", "0000000074", { lastDiscoveryAt: "2027-08-01T03:00:00.000Z", error: "fetch failed" }),
  ],
};
const fairnessRequests = [];
let activeDiscoveries = 0;
let maximumActiveDiscoveries = 0;
const fairness = await loaded.exports.runPr262DirectAnnouncementMonitor({
  now: new Date("2027-09-01T00:00:00.000Z"),
  exposure: [
    exposureCompany("OLD1", "0000000071"),
    exposureCompany("OLD2", "0000000072"),
    exposureCompany("OLD3", "0000000073"),
    exposureCompany("NEWER", "0000000074"),
  ],
  fetchImpl: async (request) => {
    activeDiscoveries += 1;
    maximumActiveDiscoveries = Math.max(maximumActiveDiscoveries, activeDiscoveries);
    fairnessRequests.push(String(request));
    await Promise.resolve();
    activeDiscoveries -= 1;
    return noWebsiteResponse;
  },
});
assert.deepEqual(fairnessRequests, [
  "https://data.sec.gov/submissions/CIK0000000071.json",
  "https://data.sec.gov/submissions/CIK0000000072.json",
  "https://data.sec.gov/submissions/CIK0000000073.json",
]);
assert.equal(fairness.discoveriesAttempted, 3);
assert.equal(fairness.discoverySelection.transientRetry, 3);
assert.equal(fairness.transientDiscoveryBacklog, 1);
assert.equal(fairness.transientDiscoveryDueNow, 1);
assert.equal(maximumActiveDiscoveries, 1, "Discovery must retain serial provider-budget reservations");

registry = {
  version: 1,
  updatedAt: "2027-10-01T00:00:00.000Z",
  discoveryCursor: 0,
  lastDiscoveryCycleAt: "2027-09-01T00:00:00.000Z",
  entries: [
    registryEntry("OTHER1", "0000000091", { error: "direct_feed_url_not_https" }),
    registryEntry("OTHER2", "0000000092", { error: "direct_feed_address_blocked" }),
    registryEntry("OTHER3", "0000000093", { error: "direct_feed_http_404" }),
    registryEntry("HIGHMISS2", "0000000094", { consecutiveConfirmedNoFeedDiscoveries: 1 }),
  ],
};
const otherBeforeConfirmedRequests = [];
const otherBeforeConfirmed = await loaded.exports.runPr262DirectAnnouncementMonitor({
  now: new Date("2027-10-01T00:00:00.000Z"),
  exposure: [
    exposureCompany("OTHER1", "0000000091"),
    exposureCompany("OTHER2", "0000000092"),
    exposureCompany("OTHER3", "0000000093"),
    exposureCompany("HIGHMISS2", "0000000094", true),
  ],
  fetchImpl: async (request) => {
    otherBeforeConfirmedRequests.push(String(request));
    return noWebsiteResponse;
  },
});
assert.deepEqual(otherBeforeConfirmedRequests, [
  "https://data.sec.gov/submissions/CIK0000000091.json",
  "https://data.sec.gov/submissions/CIK0000000092.json",
  "https://data.sec.gov/submissions/CIK0000000093.json",
]);
assert.equal(otherBeforeConfirmed.discoverySelection.otherRecheck, 3);
assert.equal(otherBeforeConfirmed.discoverySelection.confirmedNoFeedRecheck, 0);
assert.equal(registry.entries.find((entry) => entry.ticker === "HIGHMISS2").lastDiscoveryAt, "2026-08-01T00:00:00.000Z", "A high-priority confirmed miss must remain behind every unresolved other row");

registry = {
  version: 1,
  updatedAt: "2027-11-01T00:00:00.000Z",
  discoveryCursor: 0,
  lastDiscoveryCycleAt: "2027-11-01T00:00:00.000Z",
  entries: [
    registryEntry("CURRENT", "0000000101", { error: "fetch failed", lastDiscoveryAt: "2027-10-01T00:00:00.000Z" }),
    registryEntry("HISTORICAL", "0000000102", { error: "fetch failed", lastDiscoveryAt: "2027-10-01T00:00:00.000Z" }),
  ],
};
let scopedTelemetryCalls = 0;
const scopedTelemetry = await loaded.exports.runPr262DirectAnnouncementMonitor({
  now: new Date("2027-11-01T00:00:00.000Z"),
  exposure: [exposureCompany("CURRENT", "0000000101")],
  fetchImpl: async () => {
    scopedTelemetryCalls += 1;
    return noWebsiteResponse;
  },
});
assert.equal(scopedTelemetryCalls, 0);
assert.equal(scopedTelemetry.companiesKnown, 2, "Retained registry history remains preserved");
assert.equal(scopedTelemetry.currentEligibleCompaniesKnown, 1);
assert.equal(scopedTelemetry.retainedHistoricalCompanies, 1);
assert.equal(scopedTelemetry.retainedHistoricalFeedlessCompanies, 1);
assert.equal(scopedTelemetry.transientDiscoveryBacklog, 1, "Actionable backlog must count only current eligible tickers");
assert.deepEqual(scopedTelemetry.discoveryErrors, ["fetch failed"], "Actionable errors must be scoped to current eligible tickers");

const casNow = new Date("2027-12-01T00:00:00.000Z");
registry = {
  version: 1,
  updatedAt: "2027-11-01T00:00:00.000Z",
  discoveryCursor: 0,
  lastDiscoveryCycleAt: "2027-11-01T00:00:00.000Z",
  entries: [],
};
nextConflictWinner = {
  version: 1,
  updatedAt: casNow.toISOString(),
  discoveryCursor: 0,
  lastDiscoveryCycleAt: casNow.toISOString(),
  entries: [registryEntry("CASCO", "0000000111", {
    lastDiscoveryAt: casNow.toISOString(),
    nextCheckAt: new Date(casNow.getTime() + 60 * 60_000).toISOString(),
    error: "fetch failed",
  })],
};
const readsBeforeConflict = registryReads;
const writesBeforeConflict = registryWrites;
let casProviderCalls = 0;
const reconciledConflict = await loaded.exports.runPr262DirectAnnouncementMonitor({
  now: casNow,
  exposure: [exposureCompany("CASCO", "0000000111")],
  fetchImpl: async () => {
    casProviderCalls += 1;
    return noWebsiteResponse;
  },
});
assert.equal(casProviderCalls, 1, "CAS reconciliation must never repeat provider work");
assert.equal(registryReads - readsBeforeConflict, 2, "A CAS loser may perform only its initial read and one winner reload");
assert.equal(registryWrites - writesBeforeConflict, 1, "A CAS loser must not issue a second write");
assert.equal(registry.entries[0].error, "fetch failed", "The stale loser must not overwrite the committed winner");
assert.equal(reconciledConflict.transientDiscoveryBacklog, 1, "Backlog telemetry must come from the committed winner");
assert.equal(reconciledConflict.confirmedNoFeedBacklog, 0);
assert.equal(reconciledConflict.attemptCount, 1, "This invocation's already-spent attempt remains visible");
assert.equal(reconciledConflict.successCount, 1);
assert.deepEqual(reconciledConflict.registryPersistence, { written: false, conflict: true, winnerLoaded: true });

registryTextOverride = "{not-json";
let invalidRegistryProviderCalls = 0;
await assert.rejects(
  () => loaded.exports.runPr262DirectAnnouncementMonitor({
    now: new Date("2027-12-01T01:00:00.000Z"),
    exposure: [exposureCompany("CASCO", "0000000111")],
    fetchImpl: async () => {
      invalidRegistryProviderCalls += 1;
      return noWebsiteResponse;
    },
  }),
  /pr262_direct_feed_registry_invalid_json/,
);
registryTextOverride = null;
assert.equal(invalidRegistryProviderCalls, 0, "An unreadable registry must fail before any provider request");

console.log(JSON.stringify({
  ok: true,
  confirmedNoFeedThirtySixtyNinetyDayBackoff: true,
  transientDiscoveryRetry: true,
  incompleteNestedDiscoveryRemainsTransient: true,
  dnsAndInvalidJsonRemainTransient: true,
  exactProviderRetryTime: true,
  usefulDiscoveryPriority: true,
  allUnresolvedWorkPrecedesConfirmedMisses: true,
  actionableTelemetryExcludesRetainedHistory: true,
  casConflictReloadsWinnerWithoutProviderRetry: true,
  invalidRegistryFailsClosedBeforeProviderWork: true,
  oldestTransientFairness: true,
  backwardCompatibleRegistryMigration: true,
  boundedParallelDiscovery: true,
  oneHundredFortyFourSubmissionsPerDayMaximum: true,
  currentIssuerSecEvidence: true,
  feedPollingTelemetryHonest: true,
  legacyWebsitesSafelyUpgraded: true,
  nestedInvestorPageDiscovery: true,
  discoveryDiagnosticsHonest: true,
  runtimeNestedFeedFoundAndPolled: true,
  configuredFeedRepairsExistingRegistry: true,
  failedFeedBackoffWithoutSlowingHealthyFeeds: true,
}, null, 2));
