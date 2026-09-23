import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";
const { alertDetails, completePriceOutlook, publicAlertDetailsComplete } = loadTsModule("@/lib/alert-details");
const { selectMarketWatch, mergeWatchPrices } = loadTsModule("@/lib/opportunity-engine/market-watch-selection");
const { buildValuationCandidate } = loadTsModule("@/lib/equity-signal/valuation-candidate");
const now = new Date();
const identity = { ticker: "TEST", company: "Test Software", cik: "0000000001" };
const candidate = { ...identity, companyProfile: companyProfileFixture(identity, now), direction: "upside", currency: "USD",
  quote: { price: 100 }, valuationRange: { conservativeValue: 80, baseValue: 150, optimisticValue: 180 } };
const details = alertDetails(candidate, undefined, now);
assert.equal(details.complete, true);
assert.equal(details.industry, "Application software", "Verified SEC industry can fill absent provider industry");
assert.deepEqual([details.outlook.conservative.changePercent, details.outlook.base.changePercent, details.outlook.optimistic.changePercent], [-20, 50, 80]);
assert.equal(completePriceOutlook({ ...details.outlook, base: { price: 150, changePercent: 500 } }), false, "Stored percentage must reconcile to current price");
for (const change of [{ companyProfile: null }, { currency: null }, { quote: { price: 0 } }, { valuationRange: { baseValue: 150 } }, { valuationRange: { conservativeValue: 200, baseValue: 150, optimisticValue: 180 } }, { companyProfile: { ...candidate.companyProfile, industry: undefined }, industry: "Unknown" }]) {
  assert.equal(alertDetails({ ...candidate, ...change }, undefined, now).complete, false);
}
assert.equal(publicAlertDetailsComplete({ ...candidate, industry: details.industry, outlook: details.outlook }, now), true);
assert.equal(publicAlertDetailsComplete({ ...candidate, outlook: { ...details.outlook, base: { price: null, changePercent: null } } }, now), false);

const day = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
const lossCandidate = { ...candidate, eventFamily: "regulatory_approval", valuationRange: null,
  fundamentals: { available: true, checkedAt: now.toISOString(), sourceUrl: "https://data.sec.gov/api/xbrl/companyfacts/CIK0000000001.json",
    items: [{ metric: "net_income", value: -1000000, unit: "USD", periodEnd: day, filedAt: day }] } };
const lossDetails = alertDetails(lossCandidate, undefined, now);
assert.equal(lossDetails.complete, true);
assert.equal(lossDetails.valuationException, true);
assert.equal(completePriceOutlook(lossDetails.outlook), false, "An explicit exception never masquerades as a numeric forecast");
assert.equal(lossDetails.outlook.base.price, null);
assert.equal(lossDetails.outlook.potentialPercent, null);
const publicLoss = { ...lossCandidate, kind: "event", outlook: lossDetails.outlook };
assert.equal(publicAlertDetailsComplete(publicLoss, now), true);
for (const change of [{ eventFamily: "valuation_gap" }, { kind: "valuation" }, { eventFamily: "unknown" }, { cik: "0000000002" }, { currency: null }, { quote: { price: null } }, { companyProfile: null }]) {
  assert.equal(alertDetails({ ...lossCandidate, ...change }, undefined, now).complete, false, "Losses cannot bypass identity, price, profile or valuation-only requirements");
}
assert.equal(publicAlertDetailsComplete({ ...publicLoss, kind: "valuation" }, now), false);
const { assemblePublicSignals } = loadTsModule("@/lib/public-signals");
assert.equal(assemblePublicSignals([], [{ ...publicLoss, id: "loss-event", action: "buy", userAlertEligible: true }]).length, 1, "The exception must survive the actual public feed filter");
const revived = { ...lossCandidate, fundamentals: { ...lossCandidate.fundamentals, items: [...lossCandidate.fundamentals.items,
  { metric: "net_income", value: 100, unit: "USD", periodEnd: now.toISOString().slice(0, 10), filedAt: now.toISOString().slice(0, 10) }] } };
assert.equal(alertDetails(revived, undefined, now).valuationException, false, "A later profit removes the earlier loss exception");

const all = Array.from({ length: 2000 }, (_, index) => ({ ticker: `T${String(index).padStart(4, "0")}`, tradingViewSymbol: `NYSE:T${index}` }));
const seen = new Set(); let offset = 0;
for (let round = 0; round < 5; round++) {
  const scan = selectMarketWatch(all, offset, all.slice(0, 100).map(row => row.ticker));
  assert.equal(scan.entries.length, 500);
  assert.equal(new Set(scan.entries.map(row => row.ticker)).size, 500);
  for (const row of scan.entries) seen.add(row.ticker);
  offset = scan.nextOffset;
}
assert.equal(seen.size, all.length, "Constant high-priority work cannot permanently exclude other companies");
const older = new Date(now.getTime() - 2 * 3600000).toISOString();
const oldSnapshot = { checkedAt: older, prices: [{ ticker: "OLD", price: 40 }, { ticker: "EXPIRED", price: 1, checkedAt: new Date(now.getTime() - 7 * 3600000).toISOString() }] };
const merged = mergeWatchPrices(oldSnapshot, [{ ticker: "NEW", price: 30, checkedAt: now.toISOString() }], now);
assert.equal(merged.find(row => row.ticker === "OLD").checkedAt, older, "Rotating batches never relabel an old price as just collected");
assert.equal(merged.some(row => row.ticker === "EXPIRED"), false);

const analysis = { ...identity, currency: "USD", observedAt: now.toISOString(), currentPrice: 50, scores: { fairValueConfidence: 90, evidenceCompleteness: 90, businessQuality: 85, balanceSheet: 75, risk: 20 }, fairValue: { baseValue: 100, methods: [{ method: "earnings_power", value: 95 }, { method: "owner_earnings_fcf", value: 105 }] } };
const receipt = { url: "https://example.test/financials" };
assert.equal(buildValuationCandidate(analysis, identity.cik, receipt, now).gateChecks.valueTrapRiskAcceptable, true);
assert.equal(buildValuationCandidate({ ...analysis, scores: { ...analysis.scores, risk: 80 } }, identity.cik, receipt, now).gateChecks.valueTrapRiskAcceptable, false, "A large discount cannot override value-trap risks");
assert.equal(buildValuationCandidate({ ...analysis, fairValue: { ...analysis.fairValue, methods: [analysis.fairValue.methods[0], analysis.fairValue.methods[0]] } }, identity.cik, receipt, now).gateChecks.independentValuationMethods, false, "Duplicate valuation methods do not establish independent support");
console.log("PASS: complete alert contract, verified industry fallback, reconciled scenarios, full rotation, truthful price ages and value-trap checks");
