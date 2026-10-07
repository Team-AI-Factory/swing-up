import assert from "node:assert/strict";
import crypto from "node:crypto";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";

// Every valuation is recalculated by the production pure scanner and safety
// functions. A penny change is not simulated by editing an unrelated quote.
const now = new Date("2026-10-06T14:00:00Z");
const trap = () => { throw new Error("External I/O is forbidden in materiality smoke"); };
const originalFetch = globalThis.fetch;
globalThis.fetch = trap;
const pureOverrides = { "@/lib/r2-warehouse": { getR2Config: trap, writeVersionedJsonToR2: trap },
  "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: p => `test/${p}` } };
const engine = loadTsModule("@/lib/opportunity-engine/us-value-investing-engine", pureOverrides);
const safety = loadTsModule("@/lib/opportunity-engine/us-value-investing-safety", pureOverrides);
const { valuationReviewBaseline, materiallyChangedValuation, valuationReviewCooldown, validValuationReviewBaseline } = loadTsModule("@/lib/equity-signal/valuation-review-materiality");
const { reviewEvidenceRevision } = loadTsModule("@/lib/equity-signal/review-evidence-revision");
const { buildValuationCandidate, reassessValuationCandidate } = loadTsModule("@/lib/equity-signal/valuation-candidate");
const row = { ticker: "TEST", tradingViewSymbol: "NASDAQ:TEST", company: "Test Software", exchange: "NASDAQ",
  currentPrice: 50, marketCap: 5e9, sector: "Technology", industry: "Software", priceToEarnings: 12.5,
  priceToBook: 2, priceToSales: 2.5, enterpriseValueToEbitda: 10, totalRevenue: 2e9, netIncome: 300e6,
  freeCashFlow: 400e6, dilutedEpsTtm: 4, revenueGrowthTtmPercent: 12, revenueGrowthFyPercent: 10,
  netIncomeGrowthTtmPercent: 14, epsGrowthTtmPercent: 13, grossMarginPercent: 70, operatingMarginPercent: 22,
  netMarginPercent: 15, debtToEquity: 0.4, currentRatio: 1.8, returnOnEquityPercent: 20, returnOnAssetsPercent: 10 };
const analyze = (changes = {}, at = now) => safety.hardenUsValueCompanyAnalysis(engine.analyzeValueCompanyForTest({ ...row, ...changes }, at.toISOString()));
const receipt = { id: "valuation:TEST:scan-one", title: "Test valuation", summary: "Generated scan", url: "https://example.com/TEST",
  publisher: "Fixture", publishedAt: now.toISOString(), channel: "market_price_sensor", official: false, primarySource: false,
  scheduled: false, symbolHints: ["TEST"], companyHints: ["Test Software"], rawEventType: "valuation_review" };
const financialItems = [{ metric: "revenue", value: 2e9, unit: "USD", periodStart: "2025-01-01", periodEnd: "2025-12-31",
  filedAt: "2026-02-20", form: "10-K", concept: "Revenues", accession: "0000000001-26-000001", sourceUrl: "https://www.sec.gov/fixture" }];
const documents = [{ url: "https://www.sec.gov/annual", filedAt: "2026-02-20", digest: "annual-v1", readComplete: true },
  { url: "https://www.sec.gov/quarter", filedAt: "2026-08-01", digest: "quarter-v1", readComplete: true }];
function scenario(analysis, overrides = {}) {
  const candidate = buildValuationCandidate(analysis, "0000000001", receipt, now);
  candidate.fundamentals = { available: true, fiscalPeriodEnd: "2025-12-31", items: financialItems };
  candidate.quote = { price: analysis.currentPrice, actionableForSeriousSignal: true };
  reassessValuationCandidate(candidate, now, analysis);
  const fair = analysis.fairValue;
  const evidence = { source: [receipt], companyProfile: { business: "Software", customers: "Retailers" }, industry: analysis.industry,
    outlookRange: { currency: analysis.currency, low: fair.conservativeValue, base: fair.baseValue, high: fair.optimisticValue,
      forecastStatus: candidate.priceForecast.status, forecastSample: candidate.priceForecast.sampleSize },
    reviewPolicy: { model: "fixed-policy" }, financialDocuments: documents, modelAssumptions: fair.methods,
    facts: financialItems, sourceComplete: true, priceReady: true, haltKnown: true, halted: false,
    valuation: { base: fair.baseValue, low: fair.conservativeValue, high: fair.optimisticValue,
      currentPriceSupportsValuation: candidate.gateChecks.currentPriceSupportsValuation }, ...overrides };
  return { analysis, evidence, candidate, fingerprint: `valuation:0000000001:${candidate.direction}:${reviewEvidenceRevision(evidence)}`,
    baseline: valuationReviewBaseline({ cik: "0000000001", analysis, evidence, gateChecks: candidate.gateChecks,
      direction: candidate.direction, price: candidate.quote.price }) };
}
function cooldown(prior, next, at = new Date(now.getTime() + 60000)) {
  return valuationReviewCooldown({ fingerprint: next.fingerprint, valuationBaseline: next.baseline,
    previous: { fingerprint: prior.fingerprint, reviewedAt: now.toISOString(), valuationBaseline: prior.baseline }, now: at });
}
try {
  for (const specialist of [false, true]) {
    const sector = specialist ? { sector: "Financial Services", industry: "Banks", priceToBook: 1.1 } : {};
    const before = scenario(analyze(sector));
    const penny = scenario(analyze({ ...sector, currentPrice: 50.01 }));
    assert.notDeepEqual(penny.analysis.fairValue, before.analysis.fairValue, "The production model really recalculates on a penny tick");
    assert.notEqual(penny.fingerprint, before.fingerprint, "Old exact fingerprints still capture the numerical change");
    assert.deepEqual(penny.candidate.gateChecks, before.candidate.gateChecks);
    assert.equal(penny.baseline.evidenceKey, before.baseline.evidenceKey);
    assert.equal(penny.baseline.thresholdKey, before.baseline.thresholdKey);
    assert.equal(materiallyChangedValuation(before.baseline, penny.baseline), false);
    assert.equal(cooldown(before, penny).reason, "valuation_immaterial_change");
    assert.equal(cooldown(before, penny, new Date(now.getTime() + 12 * 3600000)), null, "The additive guard is exactly 12h");
    const later = scenario(analyze(sector, new Date(now.getTime() + 60000)), { source: [{ ...receipt, id: "next-scan", summary: "New retrieval/quote text" }] });
    assert.equal(later.fingerprint, before.fingerprint);
    assert.equal(cooldown(before, later).reason, "valuation_immaterial_change");
    const factor = 50.01 / 50;
    const coherent = scenario(analyze({ ...sector, currentPrice: 50.01, marketCap: row.marketCap * factor,
      priceToBook: (sector.priceToBook ?? row.priceToBook) * factor, priceToEarnings: row.priceToEarnings * factor,
      priceToSales: row.priceToSales * factor, enterpriseValueToEbitda: row.enterpriseValueToEbitda * factor }));
    assert.equal(coherent.baseline.evidenceKey, before.baseline.evidenceKey, "Coherent price-linked ratios are not fresh financial facts");
    assert.equal(cooldown(before, coherent).reason, "valuation_immaterial_change");
    if (specialist) assert.notEqual(coherent.fingerprint, before.fingerprint, "Rounded specialist ratios reproduce coherent-input penny noise");
    for (const increment of [0.5, 1, 1.5, 2]) assert.equal(cooldown(before, scenario(analyze({ ...sector, currentPrice: 50 + increment }))).allowed, false,
      "Small scans are compared with the retained baseline, not one another");
    assert.equal(cooldown(before, scenario(analyze({ ...sector, currentPrice: 52.5 }))), null, "Accumulated 5% movement qualifies");
    assert.equal(cooldown(before, scenario(analyze({ ...sector, currentPrice: 47.5 }))), null, "A 5% downward move also qualifies");
    assert.equal(cooldown(before, scenario(analyze({ ...sector, dilutedEpsTtm: 4.01 }))), null, "A real financial input change is evidence even below numeric tolerance");
    assert.equal(cooldown(before, scenario(analyze({ ...sector, freeCashFlow: row.freeCashFlow + 1 }))), null);
    console.log(`${specialist ? "Specialist" : "Generic"} pure-engine penny and coherent-ratio suppression passed`, {
      before: [before.baseline.low, before.baseline.base, before.baseline.high], penny: [penny.baseline.low, penny.baseline.base, penny.baseline.high] });
  }
  const before = scenario(analyze());
  const changedEvidence = changes => scenario(analyze(), changes);
  for (const changes of [
    { facts: [{ ...financialItems[0], value: 2e9 + 1 }] },
    { financialDocuments: [{ ...documents[0], digest: "amended" }, documents[1]] },
    { financialDocuments: [{ ...documents[0], readComplete: false }, documents[1]] },
    { modelAssumptions: before.evidence.modelAssumptions.map((method, i) => i ? method : { ...method, assumption: `${method.assumption} New sustainable margin assumption.` }) },
    { modelAssumptions: before.evidence.modelAssumptions.slice(1) },
    { reviewPolicy: { model: "new-policy" } },
    { source: [receipt, { id: "8k-new", summary: "New cash-flow guidance", rawEventType: "8-K" }] },
    { sourceComplete: false }, { halted: true }, { haltKnown: false },
  ]) assert.equal(cooldown(before, changedEvidence(changes)), null, JSON.stringify(changes));
  assert.equal(cooldown(before, changedEvidence({ financialDocuments: [...documents].reverse(), modelAssumptions: [...before.evidence.modelAssumptions].reverse() })).allowed, false,
    "Document and method ordering do not manufacture evidence");
  const stale = changedEvidence({ priceReady: false });
  assert.equal(cooldown(before, stale).allowed, false, "Fresh to stale alone cannot buy an incomplete review");
  assert.equal(cooldown(before, { ...stale, baseline: { ...stale.baseline, price: null } }).allowed, false,
    "A missing quote alone is deterioration, not a material price move");
  const missingQuoteBaseline = valuationReviewBaseline({ cik: "0000000001", analysis: before.analysis,
    evidence: { ...stale.evidence, valuation: { ...stale.evidence.valuation, currentPriceSupportsValuation: false } },
    gateChecks: { ...before.candidate.gateChecks, currentPriceSupportsValuation: false }, direction: before.candidate.direction, price: null });
  assert.equal(missingQuoteBaseline.priceSupportsValuation, null);
  assert.equal(cooldown(before, { ...stale, baseline: missingQuoteBaseline }).allowed, false,
    "No quote cannot masquerade as a true eligibility-threshold crossing");
  assert.equal(cooldown(stale, before), null, "Stale to fresh may unlock actual readiness");
  const lowerMethods = before.analysis.fairValue.methods.map(method => ({ ...method, value: method.value * 1.05 }));
  const significantEstimate = scenario({ ...before.analysis, fairValue: { ...before.analysis.fairValue, methods: lowerMethods } });
  assert.equal(cooldown(before, significantEstimate), null);
  const smallPriceLargeGap = { ...before, baseline: { ...before.baseline, base: 300, low: 290, high: 310 } };
  const gapChange = { ...smallPriceLargeGap, fingerprint: "valuation:0000000001:upside:gap", baseline: { ...smallPriceLargeGap.baseline, price: 50.5 } };
  assert.equal(cooldown(smallPriceLargeGap, gapChange), null, "5pp gap movement can qualify before 5% quote movement");
  const nearThreshold = scenario({ ...before.analysis, currentPrice: before.analysis.fairValue.baseValue / 1.2 + 0.01 });
  const crossedThreshold = scenario({ ...before.analysis, currentPrice: before.analysis.fairValue.baseValue / 1.2 - 0.01 });
  assert.equal(nearThreshold.candidate.gateChecks.currentPriceSupportsValuation, false);
  assert.equal(crossedThreshold.candidate.gateChecks.currentPriceSupportsValuation, true);
  assert.equal(cooldown(nearThreshold, crossedThreshold), null, "The real 20% eligibility threshold takes precedence over tolerance");
  assert.equal(valuationReviewCooldown({ fingerprint: "event:real-new-catalyst", previous: { fingerprint: before.fingerprint }, now }), null);
  assert.equal(validValuationReviewBaseline(before.baseline), true);
  assert.equal(validValuationReviewBaseline({ ...before.baseline, version: 2 }), false);
  assert.equal(validValuationReviewBaseline({ ...before.baseline, price: NaN }), false);

  // Preserve the established exact hash, including exact method values. This
  // is an independent copy of the pre-repair normalization, not the new helper.
  const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value;
  const oldEvidence = { ...before.evidence,
    source: before.evidence.source.map(r => r.rawEventType === "valuation_review" ? ["valuation_review"] : [r.id, r.summary]).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    facts: before.evidence.facts.map(f => [f.metric, f.value, f.unit, f.periodStart, f.periodEnd, f.filedAt, f.form, f.concept, f.accession, f.sourceUrl]).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) };
  assert.equal(reviewEvidenceRevision(before.evidence), crypto.createHash("sha256").update(JSON.stringify(stable(oldEvidence))).digest("hex").slice(0,16));

  // Run the actual equity runner twice with recomputed storedCompanyAnalysis;
  // explicit provider substitutes expose admission without any paid model call.
  let quotePrice = 50;
  const provider = name => ({ provider: name, status: "connected", checkedAt: now.toISOString(), nextRetryAt: null,
    sourceUrls: [], receipts: [], recordsRead: 1, error: null, entitlementVerified: true, cached: false });
  const facts = { cik: 1, facts: { "us-gaap": Object.fromEntries([
    ["Revenues", "USD", 2e9], ["NetIncomeLoss", "USD", 300e6], ["Assets", "USD", 5e9],
    ["CashAndCashEquivalentsAtCarryingValue", "USD", 1e9], ["StockholdersEquity", "USD", 2e9],
    ["CommonStockSharesOutstanding", "shares", 1e8], ["EarningsPerShareDiluted", "USD/shares", 4],
    ["NetCashProvidedByUsedInOperatingActivities", "USD", 450e6], ["PaymentsToAcquirePropertyPlantAndEquipment", "USD", 50e6],
  ].map(([concept, unit, val]) => [concept, { units: { [unit]: [{ val, start: "2025-01-01", end: "2025-12-31", filed: "2026-02-20", form: "10-K" }] } }])) } };
  const runner = loadTsModule("@/lib/equity-signal/runner", {
    "@/lib/ai-committee/provider": { getAiCommitteeProviderStatus: () => ({ configured: true, enabled: true }), runOpenAiCommitteeProvider: trap },
    "@/lib/ai-committee/orchestrator": { runAiCommittee: trap },
    "@/lib/equity-signal/event-sources": { collectEventSources: trap },
    "@/lib/equity-signal/universe": { loadEquityUniverse: trap },
    "@/lib/equity-signal/macro": { fetchMacroContext: trap },
    "@/lib/equity-signal/historical-bootstrap": { mergeHistoricalSignals: (...args) => args.flat(), bootstrapPublicHistoricalSignals: trap },
    "@/lib/equity-signal/market": { enrichCandidateQuotes: async candidates => {
      for (const candidate of candidates) candidate.quote = { ticker: "TEST", price: quotePrice, previousClose: 50, changePercent: 0,
        volume: 1e7, averageVolume: 1e7, marketCap: 5e9, observedAt: now.toISOString(), source: "synthetic quote", delayedMinutes: 0,
        actionableForSeriousSignal: true, marketSession: "regular" };
      return { candidates, provider: provider("market_quote"), marketSnapshot: [], benchmarkQuote: null, benchmarkTicker: "SPY" };
    } },
  });
  let captured;
  const run = async price => {
    quotePrice = price; captured = null;
    const analysis = analyze({ currentPrice: price });
    const result = await runner.runEquitySignalLab({ now, allowOpenAi: true, allowIncompleteCommitteeReview: true,
      resolveCompanyProfile: async identity => companyProfileFixture(identity, now), fetchImpl: async () => Response.json(facts),
      collectFinancialDocuments: async () => ({ version: 1, cik: "0000000001", checkedAt: now.toISOString(), nextCheckAt: now.toISOString(), cached: false, failures: [],
        documents: documents.map(doc => ({ ...doc, form: "10-K", excerpts: [{ topic: "segments", text: "Software facts" }] })) }),
      beforeOpenAiCall: async reservation => { captured = reservation; return false; },
      targetedContext: { analysisKind: "valuation", universe: { entries: [{ ticker: "TEST", name: "Test Software", cik: "0000000001", aliases: [], exchange: "NASDAQ", securityType: "common_stock" }], coverage: {}, sources: [] },
        receipts: [{ ...receipt, summary: JSON.stringify(analysis) }], providers: [provider("nasdaq_trade_halts")], historicalSignalsComplete: true,
        storedCompanyAnalysis: analysis, sourceEvidenceIncomplete: false } });
    assert.equal(result.status, "qualified_signal_openai_reservation_denied", JSON.stringify(result));
    assert.equal(result.openAiCalled, false);
    assert.ok(captured?.valuationBaseline);
    return { ...captured, result };
  };
  const actual = await run(50);
  const actualPenny = await run(50.01);
  assert.notEqual(actual.candidateFingerprint, actualPenny.candidateFingerprint);
  assert.equal(valuationReviewCooldown({ fingerprint: actualPenny.candidateFingerprint, valuationBaseline: actualPenny.valuationBaseline,
    previous: { fingerprint: actual.candidateFingerprint, valuationBaseline: actual.valuationBaseline, reviewedAt: now.toISOString() }, now }).allowed, false);
  assert.equal(actualPenny.result.selectedCandidate.valuationAdmittedAt, null, "A denied refresh cannot pretend to be a paid admission");
  console.log("Actual runner passes the recomputed baseline; source/financial/policy changes, directional readiness, thresholds, cumulative moves and exact hashes passed.");
} finally { globalThis.fetch = originalFetch; }
