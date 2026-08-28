import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";

const monitor = readFileSync(new URL("../lib/opportunity-engine/pr262-direct-announcements.ts", import.meta.url), "utf8");
const sensor = readFileSync(new URL("../lib/opportunity-engine/pr262-lightweight-sensor-v3.ts", import.meta.url), "utf8");

assert.match(monitor, /MAX_DISCOVERIES_PER_CYCLE = 3/, "Issuer-feed discovery must remain below the shared SEC submissions budget at the fifteen-minute sensor cadence.");
assert.match(monitor, /DISCOVERY_CONCURRENCY = 1/, "Issuer discovery must not create concurrent SEC budget reservations.");
assert.match(monitor, /NO_FEED_RETRY_MS = 24 \* 60 \* 60_000/, "Confirmed missing feeds must be rechecked daily rather than hidden for a week.");
assert.match(monitor, /TRANSIENT_DISCOVERY_RETRY_MS = 60 \* 60_000/, "Transient discovery failures must become eligible again within one hour.");
assert.match(monitor, /transientDiscoveryError\(existing\.error\)[\s\S]*?TRANSIENT_DISCOVERY_RETRY_MS/, "A stale future no-feed timestamp must not hide a transient SEC budget or timeout failure.");
assert.match(monitor, /transientDiscoveryBacklog/, "Runtime telemetry must expose how many issuer discoveries are waiting only on transient recovery.");
assert.match(monitor, /Promise\.all\(discoveryTargets\.slice\(start, start \+ DISCOVERY_CONCURRENCY\)/, "Issuer discovery must use its bounded parallel batch.");
assert.match(monitor, /strongBuyBelowPrice[\s\S]*?buyBelowPrice[\s\S]*?trimAbovePrice/, "Issuer discovery must prioritize the live valuation watchlist before traversing the rest of the universe.");
assert.match(monitor, /if \(url\.protocol === "http:"\)[\s\S]*?url\.protocol = "https:"/, "Legacy SEC website values must be safely upgraded to HTTPS before discovery.");
assert.match(monitor, /discoverInvestorPages\(page\.body, page\.finalUrl\)/, "Discovery must follow a bounded investor/news page when the corporate homepage has no feed link.");
assert.match(monitor, /\.slice\(0, 2\)/, "Nested issuer-page discovery must remain tightly bounded.");
assert.match(monitor, /investorWebsitesFound[\s\S]*?feedlessCompanies[\s\S]*?discoveryErrors/, "Production diagnostics must distinguish missing issuer websites from missing feed links and transport errors.");
assert.match(sensor, /recordsRead: direct\.feedsPolled, newEvents: direct\.events\.length/, "Cost telemetry must report feeds polled rather than pretending zero-event feeds were not checked.");

const nodeRequire = createRequire(import.meta.url);
const output = ts.transpileModule(monitor, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
let registry = null;
let registryEtag = 0;
const loaded = { exports: {} };
new Function("require", "module", "exports", output)((name) => {
  if (name === "node:dns/promises") return { lookup: async () => [{ address: "93.184.216.34", family: 4 }] };
  if (name === "@/lib/r2-warehouse") return {
    readVersionedTextFromR2: async () => registry
      ? { found: true, text: JSON.stringify(registry), etag: `"registry-${registryEtag}"` }
      : { found: false, text: null, etag: null },
    writeVersionedJsonToR2: async (_key, value) => {
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
      return { ok: true, status: 200, json: async () => ({ investorWebsite: "http://issuer.example" }) };
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
assert.equal(runtime.feedsPolled, 1);
assert.equal(runtime.feedSuccesses, 1);
assert.equal(runtime.investorWebsitesFound, 1);
assert.equal(runtime.feedlessCompanies, 0);
assert.equal(runtime.events.length, 1);
assert.equal(runtime.events[0].sourceProvider, "issuer_ir_safe");
assert.equal(runtime.events[0].mappingStatus, "mapped");
assert.equal(registry.entries[0].investorWebsite, "http://issuer.example");
assert.equal(registry.entries[0].feedUrl, "https://issuer.example/investors/rss.xml");

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

console.log(JSON.stringify({
  ok: true,
  dailyRediscovery: true,
  transientDiscoveryRetry: true,
  boundedParallelDiscovery: true,
  threeIssuersPerCycle: true,
  feedPollingTelemetryHonest: true,
  legacyWebsitesSafelyUpgraded: true,
  nestedInvestorPageDiscovery: true,
  discoveryDiagnosticsHonest: true,
  runtimeNestedFeedFoundAndPolled: true,
}, null, 2));
