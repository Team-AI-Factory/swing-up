import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/equity-signal/universe.ts", import.meta.url), "utf8");
const quotaSource = readFileSync(new URL("../lib/branch-signal-lab.ts", import.meta.url), "utf8");
const runnerSource = readFileSync(new URL("../lib/equity-signal/runner.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const cjsModule = { exports: {} };
const stubs = {
  "@/lib/r2-warehouse": {
    getR2Config: () => ({ configured: false }),
    readVersionedTextFromR2: async () => ({ found: false, text: null, etag: null }),
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
const { loadEquityUniverse } = cjsModule.exports;

const secPayload = JSON.stringify({
  fields: ["cik", "name", "ticker", "exchange"],
  data: [
    [320193, "Apple Inc.", "AAPL", "Nasdaq"],
    [789019, "Microsoft Corporation", "MSFT", "Nasdaq"],
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
assert.deepEqual(secOnly.snapshot.entries.map((item) => item.ticker), ["AAPL", "MSFT"]);
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

assert.match(quotaSource, /quotaKey: "nasdaq_trader_equity_universe"[\s\S]{0,180}maximumCallsInWindow: 4, minimumIntervalMs: 4\.5 \* minute/);
assert.match(quotaSource, /quotaKey: "sec_equity_universe"[\s\S]{0,180}maximumCallsInWindow: 2, minimumIntervalMs: 4\.5 \* minute/);
assert.match(runnerSource, /const universeResult = await loadEquityUniverse\(fetchImpl, now\);[\s\S]{0,180}const \[eventResult, macroResult, historicalBootstrap\] = await Promise\.all/);
assert.doesNotMatch(runnerSource, /const \[universeResult,[\s\S]{0,120}Promise\.all/);

console.log(JSON.stringify({
  ok: true,
  secOfficialFallbackPreventsZeroUniverse: true,
  partialNasdaqDataPreserved: true,
  fundAndPreferredRowsRejected: true,
  malformedSecResponseIsolated: true,
  boundedRetryCanUseRemainingDailyAllowance: true,
  downstreamCallsWaitForRequiredUniverse: true,
  sourceFailuresRemainVisible: true,
}, null, 2));
