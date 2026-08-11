import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const previousRailwayBranch = process.env.RAILWAY_GIT_BRANCH;
process.env.RAILWAY_GIT_BRANCH = "agent/combined-opportunity-engine";

const source = readFileSync(new URL("../lib/equity-signal/universe.ts", import.meta.url), "utf8");
const quotaSource = readFileSync(new URL("../lib/branch-signal-lab.ts", import.meta.url), "utf8");
const runnerSource = readFileSync(new URL("../lib/equity-signal/runner.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const cjsModule = { exports: {} };
let r2Configured = false;
let cachedUniverseObject = null;
const stubs = {
  "@/lib/r2-warehouse": {
    getR2Config: () => ({ configured: r2Configured }),
    readVersionedTextFromR2: async () => cachedUniverseObject
      ? { found: true, text: JSON.stringify(cachedUniverseObject), etag: "cached-etag" }
      : { found: false, text: null, etag: null },
    writeVersionedJsonToR2: async () => ({ written: false, conflict: false, etag: null }),
  },
  "@/lib/branch-signal-lab-policy": {
    normalizeEquitySymbol: (value) => {
      const ticker = String(value ?? "").trim().toUpperCase().replace(/\//g, ".");
      return /^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker) ? ticker : null;
    },
  },
};
new Function("require", "module", "exports", output)((name) => {
  if (name in stubs) return stubs[name];
  throw new Error(`Unexpected universe import: ${name}`);
}, cjsModule, cjsModule.exports);
const { loadEquityUniverse, resolveEquityUniverseCacheKey } = cjsModule.exports;
assert.equal(resolveEquityUniverseCacheKey("agent/combined-opportunity-engine"), "branch-labs/pr-262/equity-universe/v1.json");
assert.equal(resolveEquityUniverseCacheKey("agent/live-signal-evaluation-automation"), "branch-labs/pr-261/equity-universe/v1.json");
assert.equal(resolveEquityUniverseCacheKey("main"), null);

const secPayload = JSON.stringify({
  fields: ["cik", "name", "ticker", "exchange"],
  data: [
    [320193, "Apple Inc.", "AAPL", "Nasdaq"],
    [789019, "Microsoft Corporation", "MSFT", "Nasdaq"],
    [1875091, "NeuroSense Therapeutics Ltd.", "NRSN", "Nasdaq"],
    [1875091, "NeuroSense Therapeutics Ltd.", "NRSNW", "Nasdaq"],
    [123456, "Example Preferred Stock", "PREF", "NYSE"],
    [987654, "Example S&P 500 ETF Fund", "FUND", "NYSE Arca"],
  ],
});

const secOnlyFetch = async (input) => {
  const url = String(input);
  if (url.includes("sec.gov/files/company_tickers_exchange.json")) return new Response(secPayload, { status: 200 });
  return new Response("temporary upstream block", { status: 503 });
};
const secOnly = await loadEquityUniverse(secOnlyFetch, new Date("2026-07-22T13:10:00.000Z"));
assert.equal(secOnly.snapshot.constructionMode, "sec_official_fallback");
assert.deepEqual(secOnly.snapshot.entries.map((item) => item.ticker), ["AAPL", "MSFT", "NRSN"]);
assert.ok(secOnly.snapshot.entries.every((item) => item.cik));
assert.equal(secOnly.snapshot.sources.filter((item) => item.status === "temporarily_unavailable").length, 2);

const nasdaqText = [
  "Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares",
  "NVDA|NVIDIA Corporation - Common Stock|Q|N|N|40|N|N",
  "File Creation Time: 0722202618:00|||||||",
].join("\n");
const partialFetch = async (input) => {
  const url = String(input);
  if (url.includes("nasdaqlisted.txt")) return new Response(nasdaqText, { status: 200 });
  if (url.includes("company_tickers_exchange.json")) return new Response(secPayload, { status: 200 });
  return new Response("temporary upstream block", { status: 503 });
};
const partial = await loadEquityUniverse(partialFetch, new Date("2026-07-22T13:15:00.000Z"));
assert.equal(partial.snapshot.constructionMode, "partial_nasdaq_plus_sec");
assert.ok(partial.snapshot.entries.some((item) => item.ticker === "NVDA"));
assert.ok(partial.snapshot.entries.some((item) => item.ticker === "AAPL"));

const malformedSecFetch = async (input) => {
  const url = String(input);
  if (url.includes("nasdaqlisted.txt")) return new Response(nasdaqText, { status: 200 });
  if (url.includes("company_tickers_exchange.json")) return new Response("<html>upstream challenge</html>", { status: 200 });
  return new Response("temporary upstream block", { status: 503 });
};
const malformedSec = await loadEquityUniverse(malformedSecFetch, new Date("2026-07-22T13:20:00.000Z"));
assert.equal(malformedSec.snapshot.constructionMode, "partial_nasdaq_plus_sec");
assert.deepEqual(malformedSec.snapshot.entries.map((item) => item.ticker), ["NVDA"]);
assert.equal(malformedSec.snapshot.sources.find((item) => item.name === "SEC company_tickers_exchange")?.error, "invalid_json_payload");

const cachedEntry = (ticker) => ({
  ticker,
  name: `${ticker} Corporation`,
  exchange: "NASDAQ",
  cik: String(ticker.charCodeAt(0)).padStart(10, "0"),
  aliases: [`${ticker} Corporation`],
  securityType: "common_stock",
  sourceNames: ["Nasdaq Trader nasdaqlisted", "SEC company_tickers_exchange"],
});
cachedUniverseObject = {
  version: 1,
  scope: "active_us_exchange_listed_common_equities_and_adrs",
  constructionMode: "nasdaq_plus_sec",
  refreshedAt: "2026-07-20T13:00:00.000Z",
  entries: ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF", "GGG", "HHH", "III", "JJJ"].map(cachedEntry),
  coverage: {
    nasdaqRows: 6,
    otherExchangeRows: 4,
    eligibleEquities: 10,
    cikMapped: 10,
    cikMappedPercent: 100,
    adrCount: 0,
    excludedByReason: {},
  },
  sources: [],
};
r2Configured = true;

cachedUniverseObject = {
  ...cachedUniverseObject,
  refreshedAt: "2026-07-30T12:30:00.000Z",
  entries: [
    { ...cachedEntry("NRSN"), cik: "0001875091", sourceNames: ["SEC company_tickers_exchange"] },
    { ...cachedEntry("NRSNW"), cik: "0001875091", sourceNames: ["SEC company_tickers_exchange"] },
  ],
  coverage: {
    ...cachedUniverseObject.coverage,
    nasdaqRows: 0,
    otherExchangeRows: 0,
    eligibleEquities: 2,
    cikMapped: 2,
  },
};
const sanitizedCache = await loadEquityUniverse(async () => new Response("should not fetch a fresh cache", { status: 500 }), new Date("2026-07-30T13:00:00.000Z"));
assert.equal(sanitizedCache.cache, "cloudflare_r2");
assert.deepEqual(sanitizedCache.snapshot.entries.map((item) => item.ticker), ["NRSN"]);
assert.equal(sanitizedCache.snapshot.coverage.excludedByReason.ambiguous_sec_derivative_sibling, 1);

cachedUniverseObject = {
  version: 1,
  scope: "active_us_exchange_listed_common_equities_and_adrs",
  constructionMode: "nasdaq_plus_sec",
  refreshedAt: "2026-07-20T13:00:00.000Z",
  entries: ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF", "GGG", "HHH", "III", "JJJ"].map(cachedEntry),
  coverage: {
    nasdaqRows: 6,
    otherExchangeRows: 4,
    eligibleEquities: 10,
    cikMapped: 10,
    cikMappedPercent: 100,
    adrCount: 0,
    excludedByReason: {},
  },
  sources: [],
};

const truncatedOtherText = [
  "ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol",
  "ZZZ|ZZZ Corporation|N|ZZZ|N|100|N|ZZZ",
  "File Creation Time: 0730202606:00|||||||",
].join("\n");
const truncatedWithSecFailureFetch = async (input) => {
  const url = String(input);
  if (url.includes("nasdaqlisted.txt")) return new Response(nasdaqText, { status: 200 });
  if (url.includes("otherlisted.txt")) return new Response(truncatedOtherText, { status: 200 });
  return new Response("temporary SEC failure", { status: 503 });
};
const truncatedWithSecFailure = await loadEquityUniverse(truncatedWithSecFailureFetch, new Date("2026-07-30T13:00:00.000Z"));
assert.equal(truncatedWithSecFailure.cache, "cloudflare_r2_larger_fallback");
assert.equal(truncatedWithSecFailure.snapshot.entries.length, 10);
assert.equal(truncatedWithSecFailure.refreshed, false);
assert.equal(truncatedWithSecFailure.r2Write, false);

const nonCommonSecPayload = JSON.stringify({
  fields: ["cik", "name", "ticker", "exchange"],
  data: [
    [123456, "Example Preferred Stock", "PREF", "NYSE"],
    [987654, "Example S&P 500 ETF Fund", "FUND", "NYSE Arca"],
  ],
});
const truncatedWithNonCommonSecFetch = async (input) => {
  const url = String(input);
  if (url.includes("nasdaqlisted.txt")) return new Response(nasdaqText, { status: 200 });
  if (url.includes("otherlisted.txt")) return new Response(truncatedOtherText, { status: 200 });
  return new Response(nonCommonSecPayload, { status: 200 });
};
const truncatedWithNonCommonSec = await loadEquityUniverse(truncatedWithNonCommonSecFetch, new Date("2026-07-30T13:05:00.000Z"));
assert.equal(truncatedWithNonCommonSec.cache, "cloudflare_r2_larger_fallback");
assert.equal(truncatedWithNonCommonSec.snapshot.entries.length, 10);

assert.match(quotaSource, /quotaKey: "nasdaq_trader_equity_universe"[\s\S]{0,180}maximumCallsInWindow: 4, minimumIntervalMs: 4\.5 \* minute/);
assert.match(quotaSource, /quotaKey: "sec_equity_universe"[\s\S]{0,180}maximumCallsInWindow: 2, minimumIntervalMs: 4\.5 \* minute/);
assert.match(runnerSource, /const universeResult = targeted[\s\S]{0,260}: await loadEquityUniverse\(fetchImpl, now\);[\s\S]{0,1400}const \[eventResult, macroResult, historicalBootstrap\] = await Promise\.all/);
assert.doesNotMatch(runnerSource, /const \[universeResult,[\s\S]{0,120}Promise\.all/);
assert.match(source, /cached\.snapshot\.constructionMode === "nasdaq_plus_sec"/);
assert.match(source, /cached\.snapshot\.entries\.length > entries\.length/);
assert.match(source, /entries\.length < cached\.snapshot\.entries\.length \* MATERIAL_UNIVERSE_SHRINK_RATIO/);
assert.match(source, /cache: "cloudflare_r2_larger_fallback"/);

if (previousRailwayBranch === undefined) delete process.env.RAILWAY_GIT_BRANCH;
else process.env.RAILWAY_GIT_BRANCH = previousRailwayBranch;

console.log(JSON.stringify({
  ok: true,
  secOfficialFallbackPreventsZeroUniverse: true,
  partialNasdaqDataPreserved: true,
  partialRefreshCannotReplaceLargerCache: true,
  truncatedNonemptyDirectoriesCannotReplaceMateriallyLargerCache: true,
  secFailureAndNonCommonRowsCannotMaskTruncation: true,
  fundAndPreferredRowsRejected: true,
  malformedSecResponseIsolated: true,
  boundedRetryCanUseRemainingDailyAllowance: true,
  downstreamCallsWaitForRequiredUniverse: true,
  sourceFailuresRemainVisible: true,
  secOnlyDerivativeSiblingRejected: true,
  cachedDerivativeSiblingSanitized: true,
  branchSpecificCacheIsolationPreserved: true,
}, null, 2));
