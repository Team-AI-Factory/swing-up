import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/opportunity-engine/us-value-investing-engine.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const cjsModule = { exports: {} };
new Function("require", "module", "exports", output)((name) => {
  if (name === "@/lib/r2-warehouse") return {
    getR2Config: () => ({ configured: false }),
    writeVersionedJsonToR2: async () => ({ written: true, conflict: false, etag: "test" }),
  };
  throw new Error(`Unexpected import in value-engine smoke: ${name}`);
}, cjsModule, cjsModule.exports);
const { analyzeValueCompanyForTest } = cjsModule.exports;

const qualityBase = {
  exchange: "NASDAQ",
  sector: "Technology",
  industry: "Software - Infrastructure",
  marketCap: 10_000_000_000,
  volume: 10_000_000,
  relativeVolume10d: 1,
  totalRevenue: 5_000_000_000,
  netIncome: 1_000_000_000,
  freeCashFlow: 1_200_000_000,
  dilutedEpsTtm: 5,
  revenueGrowthTtmPercent: 15,
  revenueGrowthFyPercent: 12,
  netIncomeGrowthTtmPercent: 18,
  epsGrowthTtmPercent: 16,
  grossMarginPercent: 65,
  operatingMarginPercent: 24,
  netMarginPercent: 20,
  debtToEquity: 0.5,
  currentRatio: 2,
  returnOnEquityPercent: 25,
  returnOnAssetsPercent: 12,
  priceToEarnings: 10,
  priceToBook: 3,
  priceToSales: 2,
  enterpriseValueToEbitda: 9,
};

const buy = analyzeValueCompanyForTest({
  ...qualityBase,
  ticker: "VALUE",
  tradingViewSymbol: "NASDAQ:VALUE",
  company: "Value Quality Corp",
  currentPrice: 50,
});
assert.equal(buy.decision.tier, "serious_foundation_buy");
assert.equal(buy.decision.seriousSignal, true);
assert.equal(buy.decision.noNewsRequired, true);
assert.ok((buy.fairValue.upsideToBasePercent ?? 0) >= 40);
assert.ok(buy.fairValue.methods.length >= 2);

const sell = analyzeValueCompanyForTest({
  ticker: "EXPENSIVE",
  tradingViewSymbol: "NYSE:EXPENSIVE",
  company: "Expensive Deteriorating Corp",
  exchange: "NYSE",
  currentPrice: 200,
  marketCap: 20_000_000_000,
  volume: 5_000_000,
  relativeVolume10d: 1,
  totalRevenue: 8_000_000_000,
  netIncome: 400_000_000,
  freeCashFlow: 200_000_000,
  dilutedEpsTtm: 2,
  revenueGrowthTtmPercent: -15,
  revenueGrowthFyPercent: -12,
  netIncomeGrowthTtmPercent: -25,
  epsGrowthTtmPercent: -30,
  grossMarginPercent: 20,
  operatingMarginPercent: 5,
  netMarginPercent: 4,
  debtToEquity: 2.5,
  currentRatio: 0.8,
  returnOnEquityPercent: 6,
  returnOnAssetsPercent: 2,
  priceToEarnings: 100,
  priceToBook: 10,
  priceToSales: 3,
  enterpriseValueToEbitda: 40,
});
assert.equal(sell.decision.tier, "serious_foundation_sell");
assert.equal(sell.decision.seriousSignal, true);

const watch = analyzeValueCompanyForTest({
  ...qualityBase,
  ticker: "WAIT",
  tradingViewSymbol: "NASDAQ:WAIT",
  company: "Wait For Price Corp",
  currentPrice: 100,
  marketCap: 20_000_000_000,
});
assert.equal(watch.decision.tier, "quality_price_watchlist");
assert.equal(watch.decision.seriousSignal, false);
assert.ok((watch.fairValue.buyBelowPrice ?? 0) > 0);

const danger = analyzeValueCompanyForTest({
  ticker: "DANGER",
  tradingViewSymbol: "NYSE:DANGER",
  company: "Fundamental Danger Corp",
  exchange: "NYSE",
  currentPrice: 10,
  marketCap: 1_000_000_000,
  volume: 2_000_000,
  relativeVolume10d: 1,
  totalRevenue: 900_000_000,
  netIncome: -200_000_000,
  freeCashFlow: -250_000_000,
  dilutedEpsTtm: -2,
  revenueGrowthTtmPercent: -20,
  revenueGrowthFyPercent: -15,
  netIncomeGrowthTtmPercent: -40,
  epsGrowthTtmPercent: -50,
  grossMarginPercent: 10,
  operatingMarginPercent: -15,
  netMarginPercent: -20,
  debtToEquity: 4,
  currentRatio: 0.5,
  returnOnEquityPercent: -30,
  returnOnAssetsPercent: -15,
  priceToEarnings: null,
  priceToBook: 0.5,
  priceToSales: 1,
  enterpriseValueToEbitda: null,
  dailyVolatilityPercent: 9,
});
assert.equal(danger.decision.tier, "serious_foundation_watch_out");
assert.equal(danger.decision.seriousSignal, true);

console.log(JSON.stringify({
  ok: true,
  buy: { tier: buy.decision.tier, fairValue: buy.fairValue.baseValue, currentPrice: buy.currentPrice },
  sell: { tier: sell.decision.tier, fairValue: sell.fairValue.baseValue, currentPrice: sell.currentPrice },
  watch: { tier: watch.decision.tier, buyBelow: watch.fairValue.buyBelowPrice },
  danger: { tier: danger.decision.tier, risk: danger.scores.risk },
  noNewsRequiredForFoundationAlert: true,
  analystTargetUsedAsFairValue: false,
}, null, 2));
