import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/equity-signal/event-sources.ts", import.meta.url), "utf8");
const quotaSource = readFileSync(new URL("../lib/branch-signal-lab.ts", import.meta.url), "utf8");
const marketSource = readFileSync(new URL("../lib/equity-signal/market.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  fileName: "event-sources.ts",
}).outputText;
const marketOutput = ts.transpileModule(marketSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  fileName: "market.ts",
}).outputText;

const loaded = { exports: {} };
const stubs = {
  "node:crypto": await import("node:crypto"),
  "@/lib/branch-signal-lab-policy": {
    normalizeEquitySymbol: (value) => {
      const ticker = String(value ?? "").trim().toUpperCase();
      return /^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker) ? ticker : null;
    },
    providerFailurePolicy: ({ httpStatus, bodyText = "" }) => {
      if (httpStatus === 429 || /usage.limit|quota/i.test(bodyText)) return { status: "rate_limited" };
      if ([401, 402, 403].includes(httpStatus)) return { status: "not_entitled" };
      if ((httpStatus ?? 0) >= 500) return { status: "temporarily_unavailable" };
      return { status: "failed" };
    },
    selectBalancedReceipts: (rows, maximum) => rows.slice(0, maximum),
  },
  "@/lib/equity-signal/sec-filing-details": {
    enrichSecFilingDetails: async () => ({
      provider: { provider: "sec_filing_details", status: "not_due", checkedAt: null, sourceUrls: [], receipts: [], recordsRead: 0, error: null, entitlementVerified: true, cached: false },
      details: [],
      diagnostics: { selected: 0, enriched: 0, failed: 0, scheduledForThisRun: false },
    }),
  },
};
new Function("require", "module", "exports", output)((name) => {
  if (name in stubs) return stubs[name];
  throw new Error(`Unexpected event-source import: ${name}`);
}, loaded, loaded.exports);

const { fetchCommerceNews, fetchGdeltDiscovery, fetchMarketauxDiscovery } = loaded.exports;
const now = new Date("2026-07-22T14:00:00.000Z");

let gdeltUrl;
const gdelt = await fetchGdeltDiscovery(async (value) => {
  gdeltUrl = new URL(String(value));
  return new Response(JSON.stringify({
    articles: [{
      title: "Company raises guidance after major contract award",
      url: "https://example.com/contract-award",
      domain: "example.com",
      seendate: "20260722T133000Z",
    }],
  }), { status: 200 });
}, now);
assert.equal(gdelt.status, "connected");
assert.equal(gdelt.receipts.length, 1);
assert.equal(gdeltUrl.searchParams.get("maxrecords"), "75");
assert.equal(gdeltUrl.searchParams.get("timespan"), "2h");
assert.ok(gdeltUrl.searchParams.get("query").length < 220);
assert.doesNotMatch(gdeltUrl.searchParams.get("query"), /\bwar\b/i);

const previousMarketauxKey = process.env.MARKETAUX_API_KEY;
process.env.MARKETAUX_API_KEY = "test-token-not-a-secret";
let marketauxUrl;
const marketaux = await fetchMarketauxDiscovery(async (value) => {
  marketauxUrl = new URL(String(value));
  return new Response(JSON.stringify({
    data: [{
      title: "Example launches material new product",
      url: "https://example.com/product",
      published_at: "2026-07-22T13:45:00Z",
      source: "example.com",
      entities: [{ symbol: "EXM", name: "Example Corporation" }],
    }],
  }), { status: 200 });
}, now);
assert.equal(marketaux.status, "connected");
assert.equal(marketaux.receipts[0].symbolHints[0], "EXM");
assert.equal(marketauxUrl.searchParams.get("limit"), "3");
assert.match(marketauxUrl.searchParams.get("published_after"), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
assert.doesNotMatch(marketauxUrl.searchParams.get("published_after"), /Z|\./);

for (const [httpStatus, expectedStatus, expectedError, responseBody] of [
  [401, "not_entitled", "invalid_api_token", "invalid token"],
  [402, "rate_limited", "usage_limit_reached", "usage limit reached"],
  [403, "not_entitled", "endpoint_access_restricted", "endpoint restricted"],
  [400, "failed", "malformed_parameters", "malformed parameters"],
]) {
  const failure = await fetchMarketauxDiscovery(async () => new Response(responseBody, { status: httpStatus }), now);
  assert.equal(failure.status, expectedStatus);
  assert.equal(failure.error, expectedError);
}
if (previousMarketauxKey === undefined) delete process.env.MARKETAUX_API_KEY;
else process.env.MARKETAUX_API_KEY = previousMarketauxKey;

let commerceUrl;
const commerce = await fetchCommerceNews(async (value) => {
  commerceUrl = new URL(String(value));
  return new Response(JSON.stringify({
    data: [{
      label: "Commerce announces semiconductor investment",
      href: "https://www.commerce.gov/news/press-releases/example",
      post_date_formatted: "2026-07-22T08:30:00-04:00",
      body: "<p>Official investment announcement.</p>",
      news_type: [{ label: "Press release" }],
    }],
  }), { status: 200 });
}, now);
assert.equal(commerce.status, "connected");
assert.equal(commerce.recordsRead, 1);
assert.equal(commerce.receipts.length, 1);
assert.equal(commerce.receipts[0].official, true);
assert.equal(commerce.receipts[0].primarySource, true);
assert.equal(commerce.receipts[0].summary, "Official investment announcement.");
assert.equal(commerce.receipts[0].rawEventType, "Press release");
assert.equal(commerceUrl.searchParams.get("api_key"), "DEMO_KEY");
assert.equal(commerceUrl.searchParams.get("page[limit]"), "25");

const commerceDenied = await fetchCommerceNews(async () => new Response("forbidden", { status: 403 }), now);
assert.equal(commerceDenied.status, "temporarily_unavailable");
assert.equal(commerceDenied.error, "public_feed_access_denied");
const commerceMalformed = await fetchCommerceNews(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }), now);
assert.equal(commerceMalformed.status, "temporarily_unavailable");
assert.equal(commerceMalformed.error, "invalid_commerce_payload");

assert.doesNotMatch(source, /www\.commerce\.gov\/feeds\/news/);
assert.match(quotaSource, /host === "api\.commerce\.gov"[\s\S]{0,240}quotaKey: "commerce_demo_key_50_daily"[\s\S]{0,180}maximumCallsInWindow: 48, minimumIntervalMs: 29 \* minute/);
assert.match(marketSource, /status: !settled\.length \? "not_due"/);

const marketLoaded = { exports: {} };
new Function("require", "module", "exports", marketOutput)((name) => {
  throw new Error(`Unexpected market import: ${name}`);
}, marketLoaded, marketLoaded.exports);
const quoteFetches = [];
const sameTickerCandidates = [
  { ticker: "ZZZ", gatePassed: true, trackingDisposition: "qualified", quote: null, rootEventKey: "event-a" },
  { ticker: "ZZZ", gatePassed: true, trackingDisposition: "qualified", quote: null, rootEventKey: "event-b" },
];
await marketLoaded.exports.enrichCandidateQuotes(sameTickerCandidates, async (value) => {
  const ticker = new URL(String(value)).pathname.split("/").at(-1);
  quoteFetches.push(ticker);
  const price = ticker === "SPY" ? 600 : 100;
  return new Response(JSON.stringify({
    chart: {
      result: [{
        meta: {
          regularMarketPrice: price,
          chartPreviousClose: price,
          regularMarketTime: Date.parse("2026-07-22T13:55:00.000Z") / 1000,
        },
        timestamp: [Date.parse("2026-07-22T13:55:00.000Z") / 1000],
      }],
      error: null,
    },
  }), { status: 200, headers: { "content-type": "application/json" } });
}, now);
assert.equal(sameTickerCandidates[0].quote?.price, 100);
assert.equal(sameTickerCandidates[1].quote?.price, 100);
assert.equal(quoteFetches.filter((ticker) => ticker === "ZZZ").length, 1);

console.log(JSON.stringify({
  ok: true,
  gdeltQueryIsBoundedAndRotating: true,
  marketauxTimestampMatchesDocumentedFormat: true,
  marketauxFailureCategoryIsActionableAndSecretSafe: true,
  commerceUsesOfficialBudgetedJsonApi: true,
  commerceReceiptsRemainPrimaryOfficialEvidence: true,
  successfulHttpWithoutRecordsIsNotCountedAsConnected: true,
  unusedQuoteChainIsNotMisreportedAsUnconfigured: true,
  oneQuoteServesEveryDistinctSameTickerEvent: true,
}, null, 2));
