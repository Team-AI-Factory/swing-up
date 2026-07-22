import assert from "node:assert/strict";
import { normalizeGlobalQuotes, normalizeGlobalStockUniverse } from "../lib/opportunity-engine/global-market-scanner";

const universe = normalizeGlobalStockUniverse([
  { symbol: "AAPL", name: "Apple Inc.", exchange: "NASDAQ", exchangeShortName: "NASDAQ", country: "US", currency: "USD", type: "stock", isActivelyTrading: true },
  { symbol: "7203.T", name: "Toyota Motor", exchange: "Tokyo", exchangeShortName: "JPX", country: "JP", currency: "JPY", type: "stock", isActivelyTrading: true },
  { symbol: "VOD.L", name: "Vodafone", exchange: "London", exchangeShortName: "LSE", country: "GB", currency: "GBP", type: "stock", isActivelyTrading: true },
  { symbol: "SPY", name: "SPDR S&P 500 ETF", exchange: "NYSE Arca", exchangeShortName: "AMEX", country: "US", currency: "USD", type: "etf", isActivelyTrading: true },
  { symbol: "OLD", name: "Old Company", exchange: "NYSE", exchangeShortName: "NYSE", country: "US", currency: "USD", type: "stock", isActivelyTrading: false },
]);

assert.equal(universe.length, 3);
assert.deepEqual(universe.map((row) => row.symbol), ["AAPL", "7203.T", "VOD.L"]);
assert.equal(new Set(universe.map((row) => row.exchangeShortName)).size, 3);
assert.equal(new Set(universe.map((row) => row.country)).size, 3);

const quotes = normalizeGlobalQuotes([
  { symbol: "AAPL", price: 210.5, changePercentage: 2.1, volume: 1000000, avgVolume: 800000, marketCap: 3200000000000, yearHigh: 220, yearLow: 150, exchange: "NASDAQ", timestamp: 1 },
  { symbol: "7203.T", price: "2800", changesPercentage: "-1.5", volume: "500000", averageVolume: "400000", marketCap: "300000000000", yearHigh: "3500", yearLow: "2200", exchangeShortName: "JPX", timestamp: "2" },
]);

assert.equal(quotes.length, 2);
assert.equal(quotes[0].changePercent, 2.1);
assert.equal(quotes[1].price, 2800);
assert.equal(quotes[1].exchange, "JPX");

console.log(JSON.stringify({ ok: true, stocks: universe.length, countries: 3, exchanges: 3, quotes: quotes.length, noEtfs: true, noInactiveStocks: true }, null, 2));
