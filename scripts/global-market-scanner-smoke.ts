import assert from "node:assert/strict";
import {
  evaluateCertifiedExtremeVolatilityHistory,
  normalizeGlobalQuotes,
  normalizeGlobalStockUniverse,
  type GlobalScanCandidate,
} from "../lib/opportunity-engine/global-market-scanner-v2";
import { CERTIFIED_EXTREME_VOLATILITY_RULE, opportunityCoverageSummary } from "../lib/opportunity-engine/serious-alert-registry";

const universe = normalizeGlobalStockUniverse([
  { symbol: "AAPL", name: "Apple Inc.", exchange: "NASDAQ", exchangeShortName: "NASDAQ", country: "US", currency: "USD", type: "stock", isActivelyTrading: true },
  { symbol: "7203.T", name: "Toyota Motor", exchange: "Tokyo", exchangeShortName: "JPX", country: "JP", currency: "JPY", type: "stock", isActivelyTrading: true },
  { symbol: "VOD.L", name: "Vodafone", exchange: "London", exchangeShortName: "LSE", country: "GB", currency: "GBP", type: "stock", isActivelyTrading: true },
  { symbol: "SPY", name: "SPDR S&P 500 ETF", exchange: "NYSE Arca", exchangeShortName: "AMEX", country: "US", currency: "USD", type: "etf", isActivelyTrading: true },
  { symbol: "OLD", name: "Old Company", exchange: "NYSE", exchangeShortName: "NYSE", country: "US", currency: "USD", type: "stock", isActivelyTrading: false },
]);

assert.equal(universe.length, 1);
assert.deepEqual(universe.map((row) => row.symbol), ["AAPL"]);
assert.equal(new Set(universe.map((row) => row.exchangeShortName)).size, 1);
assert.equal(new Set(universe.map((row) => row.country)).size, 1);

const quotes = normalizeGlobalQuotes([
  { symbol: "AAPL", name: "Apple Inc.", price: 210.5, changePercentage: 2.1, volume: 1000000, avgVolume: 800000, marketCap: 3200000000000, yearHigh: 220, yearLow: 150, exchange: "NASDAQ", country: "US", currency: "USD", timestamp: 1 },
  { symbol: "7203.T", name: "Toyota Motor", price: "2800", changesPercentage: "-1.5", volume: "500000", averageVolume: "400000", marketCap: "300000000000", yearHigh: "3500", yearLow: "2200", exchangeShortName: "JPX", country: "JP", currency: "JPY", timestamp: "2" },
]);

assert.equal(quotes.length, 2);
assert.equal(quotes[0].changePercent, 2.1);
assert.equal(quotes[1].price, 2800);
assert.equal(quotes[1].exchange, "JPX");

const candidate: GlobalScanCandidate = {
  symbol: "TEST",
  name: "Test Company",
  exchange: "NASDAQ",
  exchangeShortName: "NASDAQ",
  country: "US",
  currency: "USD",
  type: "stock",
  activelyTrading: true,
  price: 39.1,
  changePercent: -2,
  volume: 2_000_000,
  averageVolume: 1_000_000,
  marketCap: 500_000_000,
  yearHigh: 110,
  yearLow: 35,
  timestamp: 1,
  quoteExchange: "NASDAQ",
  listingKey: "NASDAQ:TEST",
  liquidityScore: 75,
  momentumScore: 40,
  volatilityScore: 85,
  opportunityPriority: 45,
  riskPriority: 90,
  buyResearchThemes: [],
  sellResearchThemes: ["sell_technical_breakdown"],
  watchOutResearchThemes: ["watch_out_extreme_volatility_candidate"],
  reasons: ["Price is deeply below its recent high"],
};

const now = new Date("2026-07-27T05:00:00.000Z");
const history = Array.from({ length: 120 }, (_, index) => {
  const date = new Date(Date.parse("2026-03-28T00:00:00.000Z") + index * 86_400_000).toISOString().slice(0, 10);
  return { date, close: index === 119 ? 39 : Math.max(39, 100 - index * 0.5), high: index === 0 ? 100 : Math.max(40, 100 - index * 0.45) };
});
const certified = evaluateCertifiedExtremeVolatilityHistory(candidate, { rows: history, sourceUrl: "https://query1.finance.yahoo.com/test" }, now);
assert.ok(certified);
assert.equal(certified.seriousSignal, true);
assert.equal(certified.action, "watch_out");
assert.equal(certified.ruleId, CERTIFIED_EXTREME_VOLATILITY_RULE.id);
assert.ok(certified.trailing120SessionDrawdownPercent <= -60);
assert.equal(certified.calibration.sampleSize, 41);
assert.equal(certified.calibration.wins, 40);
assert.ok(certified.calibration.lowerConfidenceBound90 >= 0.9);
assert.equal(certified.notificationEligible, false);

const safeHistory = history.map((row, index) => index === 119 ? { ...row, close: 45, high: Math.max(row.high, 45) } : row);
assert.equal(evaluateCertifiedExtremeVolatilityHistory(candidate, { rows: safeHistory, sourceUrl: "https://query1.finance.yahoo.com/test" }, now), null);

const coverage = opportunityCoverageSummary();
assert.ok(coverage.buy.length >= 5);
assert.ok(coverage.sell.length >= 5);
assert.ok(coverage.watchOut.some((family) => family.seriousSignalEnabled));
assert.deepEqual(coverage.certifiedRuleIds, [CERTIFIED_EXTREME_VOLATILITY_RULE.id]);

console.log(JSON.stringify({
  ok: true,
  stocks: universe.length,
  countries: 1,
  exchanges: 1,
  nonUsListingsDisabled: true,
  quotes: quotes.length,
  noEtfs: true,
  noInactiveStocks: true,
  certifiedRuleId: certified.ruleId,
  certifiedSampleSize: certified.calibration.sampleSize,
  certifiedObservedPrecision: certified.calibration.observedPrecision,
  liveNotificationStillDisabled: true,
  buyFamilies: coverage.buy.length,
  sellFamilies: coverage.sell.length,
  watchOutFamilies: coverage.watchOut.length,
}, null, 2));
