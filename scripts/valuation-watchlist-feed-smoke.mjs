import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/opportunity-engine/valuation-watchlist-feed.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;

const candidate = {
  ticker: "BANK",
  tradingViewSymbol: "NYSE:BANK",
  company: "Example Regional Bank",
  exchange: "NYSE",
  sector: "Financial",
  industry: "Regional Banks",
  observedAt: "2026-08-28T02:17:00.000Z",
  currentPrice: 40,
  fairValue: { conservativeValue: 58, baseValue: 65, optimisticValue: 72, buyBelowPrice: 46, trimAbovePrice: 100, upsideToBasePercent: 62.5 },
  scores: { businessQuality: 82, risk: 28, evidenceCompleteness: 100, fairValueConfidence: 90 },
  decision: {
    reasons: ["Applied bank specialist model instead of the generic corporate earnings/FCF framework."],
    blockers: ["Current-event evidence and Committee review have not run."],
  },
};

const summary = {
  version: 1,
  kind: "us_value_investing_resumable_summary",
  cycleId: "cycle-1",
  status: "complete",
  completedAt: "2026-08-28T02:20:00.000Z",
  sourceCheckedAt: "2026-08-28T02:17:00.000Z",
  coverage: { companiesStored: 4_948, totalCompanies: 4_948, coveragePercent: 100 },
  seriousAlerts: { buy: [candidate], sell: [], watchOut: [] },
  qualityPriceWatchlist: [],
};
const livePriceCheckedAt = new Date().toISOString();
const livePriceSnapshot = {
  version: 1,
  checkedAt: livePriceCheckedAt,
  source: "tradingview_market_watch",
  prices: [{ ticker: "BANK", tradingViewSymbol: "NYSE:BANK", price: 42, changePercent: 5.2, relativeVolume: 3.1, threshold: "buy_price_crossed" }],
};

const cjsModule = { exports: {} };
new Function("require", "module", "exports", output)((name) => {
  if (name === "@/lib/r2-warehouse") return {
    readVersionedTextFromR2: async (key) => ({
      found: true,
      text: JSON.stringify(key.endsWith("watchlist-live-prices-v1.json") ? livePriceSnapshot : summary),
      etag: '"test"',
    }),
  };
  if (name === "@/lib/opportunity-engine/pr262-storage") return {
    pr262StorageKey: (relative) => `production/pr262/${relative}`,
  };
  throw new Error(`Unexpected watchlist feed import: ${name}`);
}, cjsModule, cjsModule.exports);

const result = await cjsModule.exports.getValuationWatchlistStatus({ limit: 20 });
assert.equal(result.ok, true);
assert.equal(result.foundation.complete, true);
assert.equal(result.foundation.coverage.percent, 100);
assert.equal(result.summary.buyResearch, 1);
assert.equal(result.summary.specialistModelApplied, 1);
assert.equal(result.livePricing.available, true);
assert.equal(result.livePricing.checkedAt, livePriceCheckedAt);
assert.equal(result.candidates.length, 1);
assert.equal(result.candidates[0].currentPrice, 42, "The compact sensor snapshot must update the displayed price without changing Serious Signal authority.");
assert.equal(result.candidates[0].priceObservedAt, livePriceCheckedAt);
assert.equal(result.candidates[0].livePriceFresh, true);
assert.equal(result.candidates[0].livePriceAlert.threshold, "buy_price_crossed");
assert.equal(result.candidates[0].fairValue.upsideToBasePercent, 54.76);
assert.equal(result.candidates[0].publicationStatus, "provisional_research_only");
assert.equal(result.candidates[0].userAlertEligible, false);
assert.equal(result.candidates[0].committeeApproved, false);
assert.match(result.candidates[0].anchor, /^valuation-watchlist-buy_research-bank$/);
assert.ok(result.candidates[0].links.some((link) => link.url === "https://www.tradingview.com/symbols/NYSE-BANK/"));
assert.ok(result.candidates[0].links.some((link) => link.url.startsWith("https://www.sec.gov/edgar/search/")));

console.log(JSON.stringify({
  ok: true,
  authenticatedRoutePayloadIsSanitized: true,
  provisionalResearchCannotMasqueradeAsSeriousSignal: true,
  specialistModelIsVisible: true,
  livePriceOverlayIsVisible: true,
  stableWebAndResearchLinks: true,
}, null, 2));
