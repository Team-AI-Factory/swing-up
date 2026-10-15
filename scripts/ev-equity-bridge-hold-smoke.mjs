import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { inSimpleAlertPilot } from "./helpers/simple-alert-pilot-fixture.mjs";
import { terminalHarness } from "./terminal-review-runner-smoke.mjs";

const engine = loadTsModule("@/lib/opportunity-engine/us-value-investing-engine");
const safety = loadTsModule("@/lib/opportunity-engine/us-value-investing-safety");
const specialist = loadTsModule("@/lib/opportunity-engine/us-sector-specialist-valuation");
const candidateModule = loadTsModule("@/lib/equity-signal/valuation-candidate");
const now = new Date("2026-10-05T15:00:00Z");
const values = { ticker: "AIOT", tradingViewSymbol: "NASDAQ:AIOT", company: "Synthetic valuation fixture", exchange: "NASDAQ", currency: "USD",
  currentPrice: 30, marketCap: 5e9, sector: "Financial", industry: "Asset Management", priceToEarnings: 8,
  priceToBook: .75, priceToSales: 2.5, enterpriseValueToEbitda: 6, totalRevenue: 2e9, netIncome: 300e6,
  freeCashFlow: 400e6, dilutedEpsTtm: 4, revenueGrowthTtmPercent: 10, revenueGrowthFyPercent: 10,
  netIncomeGrowthTtmPercent: 10, epsGrowthTtmPercent: 10, grossMarginPercent: 70, operatingMarginPercent: 22,
  netMarginPercent: 25, debtToEquity: .4, currentRatio: 1.8, returnOnEquityPercent: 20, returnOnAssetsPercent: 10,
  averageVolume10d: 1e6 };
const raw = (changes = {}) => engine.analyzeValueCompanyForTest({ ...values, ...changes }, now.toISOString());
const isEv = method => specialist.isUnsupportedEvEquityMethod(method.method);
const checks = [];
// A ratio-based equity-price rescale is valid only accidentally when net debt is zero.
for (const [name, netDebt, expected] of [["leveraged", 500, 100], ["net_cash", -200, 65], ["zero_net_debt", 0, 75]]) {
  const price = 50, shares = 10, currentMultiple = 10, targetMultiple = 15;
  const ebitda = (price * shares + netDebt) / currentMultiple;
  const correct = (targetMultiple * ebitda - netDebt) / shares;
  assert.equal(correct, expected);
  assert.equal(price * targetMultiple / currentMultiple, 75);
  assert.equal(correct === 75, name === "zero_net_debt");
  for (const [sector, industry, method] of [["Financial", "Asset Management", "financial_ev_ebitda"],
    ["Real Estate", "REIT", "reit_ev_ebitda_proxy"], ["Utilities", "Electric Utilities", "utility_ev_ebitda"]]) {
    const input = raw({ sector, industry });
    // Arbitrary extra numbers/attestations are not a verified input contract.
    Object.assign(input.fundamentals, { ebitda, netDebt, dilutedShares: shares,
      sourceUrl: "https://www.sec.gov/synthetic-fixture", periodEnd: "2025-12-31", currency: "USD", verified: true });
    const result = specialist.evaluateSectorSpecialistValuation(input, now.toISOString());
    assert.equal(result.methods.some(isEv), false);
    assert.deepEqual(result.unavailableMethods.map(value => value.method), [method]);
    assert.equal(result.unavailableMethods[0].reason, "verified_ev_to_equity_bridge_unavailable");
    assert.deepEqual(result.unavailableMethods[0].requiredEvidence, ["same_period_ebitda", "cash_debt_and_other_equity_claims", "currency_and_reporting_period", "diluted_share_and_ads_basis", "issuer_bound_source_lineage"]);
    assert.match(result.unavailableMethods[0].explanation, /Zero net debt is not assumed/);
    assert.ok(result.methods.every(value => Number.isFinite(value.value)));
    checks.push(`${name}:${method}`);
  }
}
for (const enterpriseValueToEbitda of [null, 0, -1, NaN, Infinity, 6]) {
  const hardened = safety.hardenUsValueCompanyAnalysis(raw({ enterpriseValueToEbitda }));
  assert.equal(hardened.fairValue.methods.some(isEv), false);
  assert.equal(hardened.fairValue.unavailableMethods[0].reason, "verified_ev_to_equity_bridge_unavailable");
  assert.ok(hardened.fairValue.methods.some(method => method.method === "financial_earnings_power"));
}
const financial = safety.hardenUsValueCompanyAnalysis(raw());
const stale = structuredClone(financial);
stale.fairValue.methods.push({ method: "financial_ev_ebitda", value: 999, assumption: "Legacy incorrect equity-price rescale" });
Object.assign(stale.fairValue, { baseValue: 999, optimisticValue: 999, conservativeValue: 999 });
const archived = structuredClone(stale);
assert.deepEqual(safety.hardenUsValueCompanyAnalysis(stale).fairValue, financial.fairValue);
assert.deepEqual(stale, archived, "Read-time hardening does not mutate stored historical analysis");
assert.equal(candidateModule.buildValuationCandidate(stale, "0001774170", {}, now), null, "A direct stale candidate cannot bypass read-time hardening");
const candidate = candidateModule.buildValuationCandidate(financial, "0001774170", {}, now);
assert.ok(candidate);
candidateModule.reassessValuationCandidate(candidate, now, stale);
assert.equal(candidate.gatePassed, false);
assert.ok(candidate.failedGateChecks.includes("verifiedEvToEquityBridge"));
const generic = safety.hardenUsValueCompanyAnalysis(raw({ sector: "Technology", industry: "Software" }));
assert.ok(generic.fairValue.methods.some(method => method.method === "earnings_power"));
assert.ok(generic.fairValue.methods.some(method => method.method === "owner_earnings_fcf"));
assert.equal(generic.fairValue.unavailableMethods, undefined);

await inSimpleAlertPilot(async () => {
  let selected = financial;
  const h = terminalHarness({ realValuationHardener: true, analysisFactory: () => selected });
  h.state.price = 30;
  const watch = loadTsModule("@/lib/opportunity-engine/pr262-pilot-watch-valuation", {
    "@/lib/r2-warehouse": h.storage, "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: h.key },
  });
  const identity = { ...h.identity, tradingViewSymbol: "NASDAQ:AIOT" };
  const fields = { name: identity.ticker, description: identity.company, exchange: "NASDAQ", country: "United States", currency: "USD",
    type: "stock", typespecs: ["common"], is_primary: true, close: 30, change: 0, volume: 1e6, relative_volume_10d_calc: 1,
    market_cap_basic: 5e9, sector: "Financial", industry: "Asset Management", price_earnings_ttm: 8, price_book_ratio: .75,
    price_sales_ratio: 2.5, enterprise_value_ebitda_ttm: 6, total_revenue: 2e9, net_income: 300e6, free_cash_flow: 400e6,
    earnings_per_share_diluted_ttm: 4, total_revenue_yoy_growth_ttm: 10, total_revenue_yoy_growth_fy: 10,
    net_income_yoy_growth_ttm: 10, earnings_per_share_diluted_yoy_growth_ttm: 10, gross_margin: 70, operating_margin: 22,
    net_margin: 25, debt_to_equity: .4, current_ratio: 1.8, return_on_equity: 20, return_on_assets: 10 };
  const row = { s: identity.tradingViewSymbol, d: engine.US_VALUE_SCANNER_COLUMNS.map(key => fields[key] ?? null) };
  assert.equal((await watch.persistPilotWatchValuations([row], [identity], now)).written, true);
  const writes = h.writes.length;
  const snapshot = structuredClone(h.objects);
  const read = await watch.readPilotWatchValuation(identity, now);
  assert.ok(read);
  assert.equal(h.writes.length, writes, "Cached valuation read is read-only");
  assert.deepEqual(h.objects, snapshot);
  selected = read.analysis;
  assert.equal(selected.sourceTiming.fundamentalPeriodAsOf, null);
  assert.equal(selected.sourceTiming.liveQuoteVerified, false);
  assert.equal(selected.fairValue.methods.some(isEv), false);
  const report = await h.runRunner();
  assert.ok(report.selectedCandidate, JSON.stringify(report));
  assert.equal(report.selectedCandidate.valuationRange.methods.some(isEv), false);
  assert.deepEqual(report.selectedCandidate.valuationRange.unavailableMethods, selected.fairValue.unavailableMethods);
  assert.ok(h.prompts.some(prompt => JSON.stringify(prompt).includes("verified_ev_to_equity_bridge_unavailable")), "The actual Committee packet carries the unavailable EV reason");
  selected = stale;
  const previousCalls = h.state.roleCalls;
  const priorJournal = structuredClone(h.journal);
  const held = await h.runRunner();
  assert.equal(held.selectedCandidate ?? null, null);
  assert.equal(h.state.roleCalls, previousCalls, "Legacy unsupported range cannot trigger another paid review");
  assert.deepEqual(h.journal, priorJournal, "Prior paid-review history is not rewritten");
  checks.push("actual_cached_pilot_watch_to_runner", "legacy_direct_runner_hold", "paid_history_unchanged");
});
console.log(JSON.stringify({ ok: true, checks, properEpsAndFcfRetained: true }));
