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
let detailProviderStatus = "not_due";
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
    SEC_FILING_ANALYSIS_TEXT_MAX_CHARS: 12_000,
    enrichSecFilingDetails: async () => ({
      provider: { provider: "sec_filing_details", status: detailProviderStatus, checkedAt: null, sourceUrls: [], receipts: [], recordsRead: 0, error: detailProviderStatus === "partial" ? "some_selected_filings_incomplete" : null, entitlementVerified: true, cached: false },
      details: [],
      diagnostics: { selected: 0, enriched: 0, failed: 0, scheduledForThisRun: false },
    }),
  },
};
new Function("require", "module", "exports", output)((name) => {
  if (name in stubs) return stubs[name];
  throw new Error(`Unexpected event-source import: ${name}`);
}, loaded, loaded.exports);

const { collectEventSources, fetchCommerceNews, fetchGdeltDiscovery, fetchGoogleDiscovery, fetchMarketauxDiscovery, fetchNasdaqTradeHalts, fetchSecCurrentFilings, mergeSecFilingDetails } = loaded.exports;
const now = new Date("2026-07-22T14:00:00.000Z");

const secEntry = ({ form, title, cik, company, accession }) => `<entry>
  <title>${title}</title>
  <link href="https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replaceAll("-", "")}/${accession}-index.html" />
  <updated>2026-07-22T13:59:00-04:00</updated>
  <category term="${form}" />
  <cik-number>${cik}</cik-number>
  <company-name>${company}</company-name>
</entry>`;
const secFeedUrls = [];
const broadSecFeed = `<feed>
  ${secEntry({ form: "8-K", title: "8-K - TWIST BIOSCIENCE CORP (0001581280) (Filer)", cik: "0001581280", company: "TWIST BIOSCIENCE CORP", accession: "0001581280-26-000101" })}
  ${secEntry({ form: "424B5", title: "424B5 - EXAMPLE ISSUER (0001000001) (Filer)", cik: "0001000001", company: "EXAMPLE ISSUER", accession: "0001000001-26-000102" })}
  ${secEntry({ form: "N-CEN", title: "N-CEN - ROUTINE FUND (0001000002) (Filer)", cik: "0001000002", company: "ROUTINE FUND", accession: "0001000002-26-000103" })}
</feed>`;
const secCurrent = await fetchSecCurrentFilings(async (value) => {
  const url = new URL(String(value));
  secFeedUrls.push(url);
  return new Response(url.searchParams.has("type") ? "<feed></feed>" : broadSecFeed, { status: 200, headers: { "content-type": "application/atom+xml" } });
}, now);
assert.equal(secFeedUrls.length, 2);
assert.equal(secFeedUrls.filter((url) => !url.searchParams.has("type")).length, 1);
assert.equal(secFeedUrls.find((url) => url.searchParams.has("type"))?.searchParams.get("type"), "8-K");
assert.equal(secCurrent.status, "connected");
assert.equal(secCurrent.recordsRead, 2);
assert.deepEqual(secCurrent.receipts.map((item) => item.rawEventType), ["8-K", "424B5"]);
assert.deepEqual(secCurrent.receipts[0].companyHints, ["TWIST BIOSCIENCE CORP", "CIK0001581280"]);

const coRegistrantReceipt = (id, cik) => ({
  id,
  title: "Co-registrant offering filing",
  summary: "Official SEC 424B5 filing.",
  url: `https://www.sec.gov/Archives/edgar/data/${cik}/000100000526000001/offering-index.html`,
  publisher: "U.S. Securities and Exchange Commission",
  publishedAt: "2026-07-22T13:50:00.000Z",
  channel: "sec_current_filings",
  official: true,
  primarySource: true,
  scheduled: false,
  symbolHints: [],
  companyHints: [`CIK${cik}`],
  rawEventType: "424B5",
});
const coRegistrantA = coRegistrantReceipt("co-registrant-a", "1000005");
const coRegistrantB = coRegistrantReceipt("co-registrant-b", "9999999");
const mergedCachedReplay = mergeSecFilingDetails(
  [coRegistrantA, coRegistrantB],
  [
    { receipt: coRegistrantA, text: "Offering priced at $10 per share." },
    { receipt: coRegistrantA, text: "Offering priced at $10 per share." },
  ],
);
assert.equal(mergedCachedReplay.length, 1);
assert.equal(mergedCachedReplay[0].publisher, "U.S. Securities and Exchange Commission");
assert.equal((mergedCachedReplay[0].summary.match(/Official filing content:/g) ?? []).length, 1);

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

let googleUrl;
await fetchGoogleDiscovery(async (value) => {
  googleUrl = new URL(String(value));
  return new Response(`<?xml version="1.0"?><rss><channel></channel></rss>`, { status: 200 });
}, now);
assert.match(googleUrl.searchParams.get("q"), /FDA panel vote/);
assert.match(googleUrl.searchParams.get("q"), /public offering pricing/);
assert.match(googleUrl.searchParams.get("q"), /trading halt/);

const activeHaltFeed = `<?xml version="1.0"?>
  <rss xmlns:ndaq="http://www.nasdaqtrader.com/"><channel><item>
    <title>CAPR</title>
    <pubDate>Wed, 22 Jul 2026 13:55:00 GMT</pubDate>
    <ndaq:IssueSymbol>CAPR</ndaq:IssueSymbol>
    <ndaq:IssueName>Capricor Therapeutics Inc.</ndaq:IssueName>
    <ndaq:ReasonCode>T1</ndaq:ReasonCode>
    <ndaq:ResumptionDate></ndaq:ResumptionDate>
  </item><item>
    <title>OLD</title>
    <pubDate>Wed, 01 Jul 2026 13:55:00 GMT</pubDate>
    <ndaq:IssueSymbol>OLD</ndaq:IssueSymbol>
    <ndaq:IssueName>Older Active Halt Corporation</ndaq:IssueName>
    <ndaq:ReasonCode>H4</ndaq:ReasonCode>
    <ndaq:ResumptionDate></ndaq:ResumptionDate>
  </item><item>
    <title>RES</title>
    <pubDate>Wed, 22 Jul 2026 13:50:00 GMT</pubDate>
    <ndaq:IssueSymbol>RES</ndaq:IssueSymbol>
    <ndaq:IssueName>Resumption Test Corporation</ndaq:IssueName>
    <ndaq:ReasonCode>T1</ndaq:ReasonCode>
    <ndaq:ResumptionDate></ndaq:ResumptionDate>
  </item><item>
    <title>RES</title>
    <pubDate>Wed, 22 Jul 2026 13:50:00 GMT</pubDate>
    <ndaq:IssueSymbol>RES</ndaq:IssueSymbol>
    <ndaq:IssueName>Resumption Test Corporation</ndaq:IssueName>
    <ndaq:ReasonCode>T3</ndaq:ReasonCode>
    <ndaq:ResumptionDate>07/22/2026</ndaq:ResumptionDate>
    <ndaq:ResumptionTradeTime>10:05:00</ndaq:ResumptionTradeTime>
  </item></channel></rss>`;
let directHaltCalls = 0;
let directHaltUrl;
const tradeHalts = await fetchNasdaqTradeHalts(async (value) => {
  directHaltCalls += 1;
  directHaltUrl = new URL(String(value));
  return new Response(activeHaltFeed, { status: 200, headers: { "content-type": "text/xml" } });
}, now);
assert.equal(tradeHalts.status, "connected");
assert.equal(directHaltCalls, 1);
assert.equal(directHaltUrl.hostname, "m.nasdaqtrader.com");
assert.equal(tradeHalts.receipts.length, 3);
assert.equal(tradeHalts.receipts[0].symbolHints[0], "CAPR");
assert.equal(tradeHalts.receipts[0].channel, "nasdaq_trade_halts");
assert.equal(tradeHalts.receipts[0].rawEventType, "halt:T1:active");
assert.equal(new URL(tradeHalts.receipts[0].url).hostname, "www.nasdaqtrader.com");
const oldActiveHalt = tradeHalts.receipts.find((receipt) => receipt.symbolHints.includes("OLD"));
assert.equal(oldActiveHalt?.publishedAt, "2026-07-01T13:55:00.000Z");
assert.equal(oldActiveHalt?.rawEventType, "halt:H4:active");
assert.ok(now.getTime() - Date.parse(oldActiveHalt.publishedAt) > 24 * 60 * 60 * 1000);
const resumedHalt = tradeHalts.receipts.find((receipt) => receipt.symbolHints.includes("RES"));
assert.equal(resumedHalt?.rawEventType, "halt:T3:resumed");
assert.equal(tradeHalts.receipts.filter((receipt) => receipt.symbolHints.includes("RES")).length, 1);

let haltMode = "active";
const haltUrls = [];
const collectionFetch = async (value) => {
  const url = new URL(String(value));
  if (["m.nasdaqtrader.com", "www.nasdaqtrader.com", "nasdaqtrader.com"].includes(url.hostname) && url.pathname.toLowerCase() === "/rss.aspx") {
    haltUrls.push(url.toString());
    if (haltMode === "failure") throw new Error("The operation was aborted due to timeout");
    if (haltMode === "not_due") throw new Error("nasdaq_trader_cadence_guard");
    const body = haltMode === "empty"
      ? `<?xml version="1.0"?><rss xmlns:ndaq="http://www.nasdaqtrader.com/"><channel></channel></rss>`
      : activeHaltFeed;
    return new Response(body, { status: 200, headers: { "content-type": "text/xml" } });
  }
  if (url.hostname === "api.gdeltproject.org") return new Response(JSON.stringify({ articles: [] }), { status: 200 });
  if (url.hostname === "api.commerce.gov") return new Response(JSON.stringify({ data: [] }), { status: 200 });
  if (url.hostname === "www.federalregister.gov") return new Response(JSON.stringify({ results: [] }), { status: 200 });
  if (url.hostname === "api.fda.gov") return new Response(JSON.stringify({ results: [] }), { status: 200 });
  if (url.hostname === "www.alphavantage.co") return new Response(JSON.stringify({ Information: "test" }), { status: 200 });
  return new Response(`<?xml version="1.0"?><rss><channel></channel></rss>`, { status: 200, headers: { "content-type": "text/xml" } });
};

const firstSnapshotAt = new Date("2026-07-22T14:05:00.000Z");
const firstSnapshot = await collectEventSources(collectionFetch, firstSnapshotAt);
const firstHaltProvider = firstSnapshot.providers.find((provider) => provider.provider === "nasdaq_trade_halts");
assert.equal(firstHaltProvider?.status, "connected");
assert.equal(firstHaltProvider?.cached, false);
assert.equal(firstHaltProvider?.receipts.some((receipt) => receipt.symbolHints.includes("OLD")), true);
assert.equal(haltUrls.length, 1);
assert.equal(new URL(haltUrls[0]).hostname, "m.nasdaqtrader.com");

haltMode = "failure";
const cachedSnapshot = await collectEventSources(collectionFetch, new Date("2026-07-22T14:10:00.000Z"));
const cachedHaltProvider = cachedSnapshot.providers.find((provider) => provider.provider === "nasdaq_trade_halts");
assert.equal(haltUrls.length, 2);
assert.equal(new URL(haltUrls[1]).hostname, "m.nasdaqtrader.com");
assert.equal(cachedHaltProvider?.status, "temporarily_unavailable");
assert.equal(cachedHaltProvider?.cached, true);
assert.equal(cachedHaltProvider?.cacheAgeMs, 5 * 60 * 1000);
assert.equal(cachedHaltProvider?.checkedAt, firstSnapshotAt.toISOString());
assert.equal(cachedHaltProvider?.receipts.some((receipt) => receipt.symbolHints.includes("OLD")), true);

haltMode = "empty";
const emptySnapshotAt = new Date("2026-07-22T14:15:00.000Z");
const emptySnapshot = await collectEventSources(collectionFetch, emptySnapshotAt);
const emptyHaltProvider = emptySnapshot.providers.find((provider) => provider.provider === "nasdaq_trade_halts");
assert.equal(haltUrls.length, 3);
assert.equal(new URL(haltUrls[2]).hostname, "www.nasdaqtrader.com");
assert.equal(emptyHaltProvider?.status, "connected");
assert.equal(emptyHaltProvider?.receipts.length, 0);

haltMode = "not_due";
const notDueSnapshot = await collectEventSources(collectionFetch, new Date("2026-07-22T14:17:00.000Z"));
const notDueHaltProvider = notDueSnapshot.providers.find((provider) => provider.provider === "nasdaq_trade_halts");
assert.equal(haltUrls.length, 4);
assert.equal(new URL(haltUrls[3]).hostname, "www.nasdaqtrader.com");
assert.equal(notDueHaltProvider?.status, "not_due");
assert.equal(notDueHaltProvider?.cached, true);
assert.equal(notDueHaltProvider?.cacheAgeMs, 2 * 60 * 1000);
assert.equal(notDueHaltProvider?.receipts.length, 0);

haltMode = "failure";
const cachedEmptySnapshot = await collectEventSources(collectionFetch, new Date("2026-07-22T14:20:00.000Z"));
const cachedEmptyHaltProvider = cachedEmptySnapshot.providers.find((provider) => provider.provider === "nasdaq_trade_halts");
assert.equal(haltUrls.length, 5);
assert.equal(new URL(haltUrls[4]).hostname, "www.nasdaqtrader.com");
assert.equal(cachedEmptyHaltProvider?.status, "temporarily_unavailable");
assert.equal(cachedEmptyHaltProvider?.cached, true);
assert.equal(cachedEmptyHaltProvider?.receipts.length, 0);

const expiredSnapshot = await collectEventSources(collectionFetch, new Date("2026-07-22T14:31:00.001Z"));
const expiredHaltProvider = expiredSnapshot.providers.find((provider) => provider.provider === "nasdaq_trade_halts");
assert.equal(haltUrls.length, 6);
assert.equal(new URL(haltUrls[5]).hostname, "nasdaqtrader.com");
assert.equal(expiredHaltProvider?.status, "temporarily_unavailable");
assert.equal(expiredHaltProvider?.cached, false);
assert.equal(expiredHaltProvider?.receipts.length, 0);

let invalidFeedCalls = 0;
const invalidFeed = await fetchNasdaqTradeHalts(async () => {
  invalidFeedCalls += 1;
  return new Response("<html><body>Current Trading Halts</body></html>", { status: 200, headers: { "content-type": "text/html" } });
}, new Date("2026-07-22T14:35:00.000Z"));
assert.equal(invalidFeedCalls, 1);
assert.equal(invalidFeed.status, "temporarily_unavailable");
assert.equal(invalidFeed.receipts.length, 0);
assert.equal(invalidFeed.error, "invalid_trade_halt_feed");

detailProviderStatus = "partial";
haltMode = "empty";
const partialDetailSnapshot = await collectEventSources(collectionFetch, new Date("2026-07-22T14:40:00.000Z"));
const partialDetailProvider = partialDetailSnapshot.providers.find((provider) => provider.provider === "sec_filing_details");
assert.equal(partialDetailProvider?.status, "partial");
assert.equal(partialDetailProvider?.error, "some_selected_filings_incomplete");
detailProviderStatus = "not_due";

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
assert.match(source, /const NASDAQ_TRADE_HALTS_TIMEOUT_MS = 12_000/);
assert.match(source, /https:\/\/m\.nasdaqtrader\.com\/rss\.aspx\?feed=tradehalts/);
assert.match(source, /https:\/\/www\.nasdaqtrader\.com\/rss\.aspx\?feed=tradehalts/);
assert.match(source, /https:\/\/nasdaqtrader\.com\/rss\.aspx\?feed=tradehalts/);
assert.doesNotMatch(source, /Trader\.aspx\?id=TradeHalts/);
assert.match(
  quotaSource,
  /\["m\.nasdaqtrader\.com", "www\.nasdaqtrader\.com", "nasdaqtrader\.com"\]\.includes\(host\)[\s\S]{0,300}quotaKey: "nasdaq_trader_trade_halts"[\s\S]{0,120}cadenceKey: "nasdaq_trader_trade_halts"/,
);
assert.match(source, /const SEC_PRIORITY_FORM_ROTATION = \["8-K", "6-K", "424B5", "8-K", "6-K", "424B3"\]/);
assert.match(quotaSource, /\["ALL", "8-K", "6-K", "424B5", "424B3"\]\.includes\(form\)[\s\S]{0,220}maximumCallsInWindow: 900/);
assert.match(quotaSource, /secArchiveHost && path\.startsWith\("\/archives\/edgar\/data\/"\)[\s\S]{0,620}cadenceKey: `sec_filing_detail:\$\{path\}`[\s\S]{0,180}maximumCallsInWindow: 1_800, minimumIntervalMs: 59 \* minute/);
assert.match(
  source,
  /const detailResult = await enrichSecFilingDetails\([\s\S]{0,180}baseReceipts,[\s\S]{0,80}fetchImpl,[\s\S]{0,80}now,[\s\S]{0,120}reserveSecFilingDetailAccessions/,
);
assert.doesNotMatch(source, /detailRunDue/);
assert.doesNotMatch(source, /detailResult\.provider\.status === "partial" \? "connected"/);
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

const extendedCandidate = [{ ticker: "EXT", direction: "downside", pricedInPenalty: 0, gatePassed: true, trackingDisposition: "qualified", quote: null, rootEventKey: "extended-event" }];
let extendedUrl;
await marketLoaded.exports.enrichCandidateQuotes(extendedCandidate, async (value) => {
  extendedUrl = new URL(String(value));
  const ticker = extendedUrl.pathname.split("/").at(-1);
  const regularAt = Date.parse("2026-07-22T20:00:00.000Z") / 1000;
  const postAt = Date.parse("2026-07-22T20:30:00.000Z") / 1000;
  const price = ticker === "SPY" ? 600 : 82;
  return new Response(JSON.stringify({
    chart: {
      result: [{
        meta: {
          regularMarketPrice: ticker === "SPY" ? 600 : 100,
          chartPreviousClose: ticker === "SPY" ? 600 : 104,
          regularMarketTime: regularAt,
          currentTradingPeriod: { post: { start: regularAt, end: Date.parse("2026-07-23T00:00:00.000Z") / 1000 } },
        },
        timestamp: [regularAt, postAt],
        indicators: { quote: [{ close: [ticker === "SPY" ? 600 : 100, price] }] },
      }],
      error: null,
    },
  }), { status: 200, headers: { "content-type": "application/json" } });
}, new Date("2026-07-22T21:00:00.000Z"));
assert.equal(extendedUrl.searchParams.get("includePrePost"), "true");
assert.equal(extendedCandidate[0].quote?.price, 82);
assert.equal(extendedCandidate[0].quote?.marketSession, "post_market");
assert.match(extendedCandidate[0].quote?.source, /extended-hours/);
assert.equal(extendedCandidate[0].pricedInPenalty, 70);

console.log(JSON.stringify({
  ok: true,
  broadSecFeedPlusRotatingUrgentFeed: true,
  secFeedFormReadFromOfficialEntry: true,
  gdeltQueryIsBoundedAndRotating: true,
  marketauxTimestampMatchesDocumentedFormat: true,
  marketauxFailureCategoryIsActionableAndSecretSafe: true,
  commerceUsesOfficialBudgetedJsonApi: true,
  commerceReceiptsRemainPrimaryOfficialEvidence: true,
  nasdaqHaltRequestIsSingleBoundedAndReserved: true,
  nasdaqHaltHostFailoverOccursNextInvocation: true,
  nasdaqHaltSnapshotCacheUsesCheckTime: true,
  nasdaqEmptySnapshotClearsActiveCache: true,
  olderActiveHaltsRemainSafetyState: true,
  resumedHaltsReplaceActiveState: true,
  nasdaqHtmlPageIsNotAFeedFallback: true,
  secDetailsRunEveryCycleWithDurableQuotaPolicy: true,
  cachedSecDetailReplayDoesNotDuplicateEvidence: true,
  successfulHttpWithoutRecordsIsNotCountedAsConnected: true,
  unusedQuoteChainIsNotMisreportedAsUnconfigured: true,
  oneQuoteServesEveryDistinctSameTickerEvent: true,
  extendedHoursQuoteAnchorsAreUsed: true,
}, null, 2));
