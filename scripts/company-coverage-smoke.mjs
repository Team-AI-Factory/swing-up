import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";

const coverage = loadTsModule("@/lib/opportunity-engine/valuation-coverage");
const { analyzeValueCompanyForTest: analyze } = loadTsModule("@/lib/opportunity-engine/us-value-investing-engine");
const { hardenUsValueCompanyAnalysis: harden } = loadTsModule("@/lib/opportunity-engine/us-value-investing-safety");
const now = new Date("2026-09-22T04:00:00Z");
const base = { ticker: "T", company: "Target Software", tradingViewSymbol: "NASDAQ:T", exchange: "NASDAQ",
  sector: "Technology", industry: "Application Software", currency: "USD", currentPrice: 20, marketCap: 1e9,
  totalRevenue: 5e8, netIncome: 1e8, freeCashFlow: 1e8, dilutedEpsTtm: 2, priceToSales: 2,
  priceToBook: 4, grossMarginPercent: 60, operatingMarginPercent: 20, netMarginPercent: 20,
  returnOnEquityPercent: 20, returnOnAssetsPercent: 10, debtToEquity: .5, currentRatio: 2,
  revenueGrowthTtmPercent: 10, revenueGrowthFyPercent: 10, netIncomeGrowthTtmPercent: 10, epsGrowthTtmPercent: 10 };
const make = overrides => analyze({ ...base, ...overrides }, now.toISOString());
const extreme = make({ currentPrice: 500, marketCap: 25e9, dilutedEpsTtm: .1, freeCashFlow: 1e6, netIncome: 1e6, priceToBook: 100 });
assert.ok(extreme.fairValue.baseValue > 0, "A large market-price gap must not erase a supported calculation");
assert.equal(coverage.assessValuationCoverage(extreme).status, "needs_validation");
assert.equal(harden(extreme).decision.seriousSignal, false, "Retaining a calculation cannot automatically promote an extreme gap");
assert.ok(harden(extreme).scores.fairValueConfidence < 70);
const tiny = make({ dilutedEpsTtm: 0.000001, freeCashFlow: -1, netIncome: -1, priceToBook: null });
assert.equal(tiny.fairValue.baseValue, null, "An estimate rounded to zero must not count as a usable positive value");

const lossMaking = make({ dilutedEpsTtm: -1, netIncome: -50e6, freeCashFlow: -20e6, priceToSales: 1.5 });
const target = make({ dilutedEpsTtm: 0, netIncome: 0, freeCashFlow: -20e6, priceToSales: 1.5 });
const peers = Array.from({ length: 10 }, (_, i) => make({ ticker: `P${i}`, company: `Peer Company ${i}`, tradingViewSymbol: `NASDAQ:P${i}`, priceToSales: 2 + i / 10 }));
const deferred = coverage.completeValuationCoverage([lossMaking, ...peers])[0];
assert.equal(deferred.valuationCoverage.status, "negative_earnings_deferred");
assert.equal(deferred.fairValue.baseValue, null, "Do not fill loss-making issuers with peer guesses merely to raise coverage");
const mixedLoss = make({ dilutedEpsTtm: 0.25, netIncome: -50e6, freeCashFlow: -20e6, priceToSales: 1.5 });
const mixedDeferred = coverage.completeValuationCoverage([mixedLoss, ...peers])[0];
assert.equal(mixedDeferred.valuationCoverage.status, "negative_earnings_deferred", "Negative net income must not be hidden by non-negative EPS");
assert.equal(mixedDeferred.fairValue.baseValue, null, "Mixed earnings metrics must not generate a peer-comparison fair value");
assert.notEqual(coverage.assessValuationCoverage(make({ dilutedEpsTtm: 2, netIncome: 50e6 })).status, "negative_earnings_deferred", "Normal daily refresh resumes supported valuation when earnings recover");
const comparison = coverage.completeValuationCoverage([target, ...peers])[0];
assert.equal(comparison.valuationCoverage.status, "peer_comparison");
assert.equal(comparison.valuationCoverage.peerCount, 10);
assert.ok(comparison.fairValue.conservativeValue <= comparison.fairValue.baseValue && comparison.fairValue.baseValue <= comparison.fairValue.optimisticValue);
assert.equal(comparison.fairValue.methods.length, 1, "Three peer quartiles are one method, not three independent confirmations");
assert.equal(comparison.decision.userAlertEligible, false);
assert.equal(comparison.decision.seriousSignal, false);
assert.ok(comparison.scores.fairValueConfidence <= 55);
for (const insufficient of [peers.slice(0, 7), peers.map(p => ({ ...p, company: "Same Company" })), peers.map(p => ({ ...p, currency: "CAD" })), peers.map(p => ({ ...p, industry: "Different Industry" })), peers.map(p => ({ ...p, observedAt: "2026-09-21T00:00:00Z" }))]) {
  assert.equal(coverage.completeValuationCoverage([target, ...insufficient])[0].fairValue.baseValue, null);
}
assert.equal(coverage.completeValuationCoverage([{ ...target, sector: "Financial", industry: "Regional Banks" }, ...peers])[0].fairValue.baseValue, null);
const summary = coverage.valuationCoverageSummary([comparison, { ...extreme, valuationCoverage: coverage.assessValuationCoverage(extreme) }]);
assert.equal(summary.counts.peer_comparison, 1);
assert.equal(summary.counts.needs_validation, 1);

// A model repair must not reuse immutable batches produced by the old model,
// even when the provider snapshot's timestamp and company universe are identical.
const batchObjects = new Map(); let etagSequence = 0;
const foundation = { ok: true, checkedAt: now.toISOString(), analyses: [comparison], seriousAlerts: { buy: [], sell: [], watchOut: [] } };
const resumable = loadTsModule("@/lib/opportunity-engine/us-value-investing-resumable", {
  "@/lib/opportunity-engine/us-value-investing-engine": { runUsValueInvestingCycle: async () => foundation },
  "@/lib/opportunity-engine/us-value-investing-safety": { hardenAndPersistUsValueInvestingCycle: async value => value },
  "@/lib/opportunity-engine/catalyst-company-diligence": { buildCatalystCompanyDiligence: async () => { throw new Error("Foundation must not run paid diligence"); } },
  "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: path => `production/pr262/${path}`, resolvePr262StoragePrefix: () => "production/pr262/" },
  "@/lib/r2-warehouse": {
    getR2Config: () => ({ configured: true }),
    readVersionedTextFromR2: async path => ({ found: batchObjects.has(path), text: batchObjects.has(path) ? JSON.stringify(batchObjects.get(path).value) : null, etag: batchObjects.get(path)?.etag ?? null }),
    writeVersionedJsonToR2: async (path, value, options = {}) => {
      const prior = batchObjects.get(path);
      if ((options.createOnly && prior) || (options.expectedEtag && options.expectedEtag !== prior?.etag)) return { written: false, conflict: true, etag: prior?.etag };
      const etag = String(++etagSequence); batchObjects.set(path, { value: structuredClone(value), etag }); return { written: true, conflict: false, etag };
    },
  },
});
assert.equal((await resumable.runResumableUsValueBatch({ now, foundationOnly: true })).status, "complete");
for (const [path, entry] of [...batchObjects]) {
  batchObjects.delete(path);
  const legacy = JSON.parse(JSON.stringify(entry).replaceAll(`-model-${coverage.VALUATION_MODEL_REVISION}`, ""));
  delete legacy.value.modelRevision;
  batchObjects.set(path.replaceAll(`-model-${coverage.VALUATION_MODEL_REVISION}`, ""), legacy);
}
foundation.analyses = [{ ...comparison, fairValue: { ...comparison.fairValue, baseValue: comparison.fairValue.baseValue + 1 } }];
const recalculated = await resumable.runResumableUsValueBatch({ now, foundationOnly: true });
assert.equal(recalculated.ok, true);
assert.equal(recalculated.progress.companiesStoredThisRun, 1);
assert.equal(batchObjects.get(recalculated.warehouse.completedBatchKeys[0]).value.analyses[0].fairValue.baseValue, foundation.analyses[0].fairValue.baseValue);
const resumed = await resumable.runResumableUsValueBatch({ now, foundationOnly: true });
assert.equal(resumed.progress.companiesStoredThisRun, 0, "Repeating the same model and snapshot must not redo completed work");

// Synthetic analogues of actual filing grammar; retain only source statements.
const profile = loadTsModule("@/lib/company-profile");
const identity = { ticker: "TEST", company: "Test Software, Inc.", cik: "0000000001" };
const fixture = companyProfileFixture(identity, now);
const business = "Our product portfolio of networking equipment and optical components is based on our high-speed communications technologies, including routers and switches.";
const customers = "Our products are also offered through distributors, retailers, and independent sales representatives.";
const section = `${business}\n${customers}\n${"We maintain regional sales teams that support our product distribution and customer service functions. ".repeat(6)}`;
const extracted = profile.extractCompanyProfile({ identity, html: `Item 1. Business\n${section}\nItem 1A. Risk Factors`, form: "10-K", sourceUrl: fixture.sourceUrl, filedAt: fixture.sourceFiledAt, now });
assert.equal(extracted.business, business);
assert.equal(extracted.customers, customers);
assert.ok(profile.verifiedCompanyProfile(extracted, { ...identity, company: "TEST SOFTWARE INC" }, now));
assert.equal(profile.verifiedCompanyProfile(extracted, { ...identity, company: "Different Software Inc" }, now), null);
assert.equal(profile.verifiedCompanyProfile(extracted, { ...identity, cik: "2" }, now), null);

const key = "research-evidence/company-profiles-v1.json";
const objects = new Map(); let requests = 0;
const identities = Array.from({ length: 22 }, (_, i) => ({ ...identity, ticker: `T${i}`, cik: String(i + 1).padStart(10, "0") }));
objects.set("equity-universe/v1.json", { version: 1, scope: "active_us_exchange_listed_common_equities_and_adrs", entries: identities.map(row => ({ ...row, sourceNames: ["SEC company_tickers_exchange"] })) });
objects.set(key, { entries: identities.map(row => {
  const f = companyProfileFixture(row, now);
  const filing = { url: f.sourceUrl, filedAt: f.sourceFiledAt, form: "10-K", industry: "Networking Equipment" };
  objects.set(`research-evidence/company-profile-sources/${row.cik}/${filing.url.split("/").slice(-2).join("-")}.json`, { url: filing.url, filedAt: filing.filedAt, businessText: section });
  return { ...row, profile: null, filing, parserRevision: 3, error: "company_profile_products_and_customers_not_extracted", updatedAt: "2026-09-21T00:00:00Z", nextAttemptAt: "2026-09-23T00:00:00Z" };
}) });
const cache = loadTsModule("@/lib/opportunity-engine/company-profile-cache", {
  "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: path => path },
  "@/lib/r2-warehouse": {
    readVersionedTextFromR2: async path => ({ found: objects.has(path), text: objects.has(path) ? JSON.stringify(objects.get(path)) : null,
      etag: objects.has(path) ? JSON.stringify(objects.get(path)) : null }),
    writeVersionedJsonToR2: async (path, value, options = {}) => {
      if ((options.createOnly && objects.has(path)) || (options.expectedEtag && options.expectedEtag !== JSON.stringify(objects.get(path)))) return { written: false, conflict: true };
      objects.set(path, structuredClone(value)); return { written: true, conflict: false };
    },
  },
});
const fetcher = async () => { requests++; throw new Error("budget_deferred"); };
const first = await cache.warmFoundationCompanyProfiles(fetcher, now);
assert.equal(first.recoveredFromSavedSources, 20, "Saved-source recovery is bounded but exceeds the two network-company slots");
assert.equal((await cache.readCompanyProfileCoverage(now)).verifiedProfiles, 22, "The ordinary two-company pass also reuses available exact sources");
const second = await cache.warmFoundationCompanyProfiles(fetcher, new Date(now.getTime() + 16 * 60000));
assert.equal(second.attempted, 0, "The next cycle does not re-download already recovered company descriptions");
assert.equal((await cache.readCompanyProfileCoverage(new Date(now.getTime() + 16 * 60000))).verifiedProfiles, 22);
assert.equal(requests, 0, "Cached-source recovery does not spend a provider request for each report");
// A damaged saved report must not stop recovery of the other issuers.
const restoreRows = identities.slice(0, 2).map(row => {
  const prior = objects.get(key).entries.find(entry => entry.ticker === row.ticker);
  return { ...prior, profile: null, parserRevision: 3, cachedParserRevision: undefined,
    error: "company_profile_products_and_customers_not_extracted", nextAttemptAt: "2026-09-23T00:00:00Z" };
});
objects.set(key, { entries: restoreRows });
const brokenKey = `research-evidence/company-profile-sources/${restoreRows[0].cik}/${restoreRows[0].filing.url.split("/").slice(-2).join("-")}.json`;
objects.set(brokenKey, { url: "wrong-source", filedAt: restoreRows[0].filing.filedAt, businessText: section });
const recovered = await cache.warmFoundationCompanyProfiles(fetcher, new Date(now.getTime() + 32 * 60000));
assert.equal(recovered.recoveredFromSavedSources, 1);
assert.equal(objects.get(key).entries[0].profile, null, "A mismatched source is never used to fill a company profile");
console.log("PASS: retained estimates, peer evidence and risk gates, complete gap accounting, source-backed profiles and bounded cache recovery");
