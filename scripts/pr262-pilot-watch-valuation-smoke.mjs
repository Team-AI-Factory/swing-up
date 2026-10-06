import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import ts from "typescript";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";

const config = JSON.parse(readFileSync(new URL("../config/simple-alert-pilot.json", import.meta.url), "utf8"));
let cohort = config.companies.map(row => ({ ...row, exchange: row.exchange ?? "Nasdaq", securityType: row.securityType ?? "common_stock" }));
let pilot = true;
let now = new Date("2026-10-03T13:00:00.000Z"); // Saturday: no invented session quote time.
const objects = new Map();
let revision = 0;
const namespace = "branch-labs/simple-alerts/cohorts/isolated-test/";
const cacheKey = `${namespace}value-investing/cohort-watch-snapshot-v1.json`;
const budgetKey = `${namespace}sensor/provider-budgets-v1.json`;
const r2 = {
  readVersionedTextFromR2: async key => {
    const item = objects.get(key);
    return item ? { found: true, text: JSON.stringify(item.value), etag: item.etag } : { found: false, text: null, etag: null };
  },
  writeVersionedJsonToR2: async (key, value, options = {}) => {
    const current = objects.get(key);
    if ((options.createOnly && current) || (options.expectedEtag && options.expectedEtag !== current?.etag)) return { conflict: true };
    const etag = `revision-${++revision}`;
    objects.set(key, { value: structuredClone(value), etag });
    return { written: true, conflict: false, etag };
  },
};
const overrides = {
  "node:crypto": crypto,
  "@/lib/r2-warehouse": r2,
  "@/lib/simple-alert-pilot-runtime": { isSimpleAlertPilot: () => pilot },
  "@/lib/simple-alert-pilot-scope": { pilotCompanies: () => cohort, pilotIncludes: () => true, pilotSourceEnabled: () => true,
    pilotUpsideBlocker: identity => cohort.find(row => row.ticker === identity.ticker && row.upsidePolicy === "financing_compliance_quarantine") ? "quarantined" : null },
  "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => `${namespace}${key}` },
};
const realUniverse = loadTsModule("@/lib/equity-signal/universe", overrides);
overrides["@/lib/equity-signal/universe"] = realUniverse;
const engine = loadTsModule("@/lib/opportunity-engine/us-value-investing-engine", overrides);
overrides["@/lib/opportunity-engine/us-value-investing-engine"] = engine;
const cache = loadTsModule("@/lib/opportunity-engine/pr262-pilot-watch-valuation", overrides);
overrides["@/lib/opportunity-engine/pr262-pilot-watch-valuation"] = cache;
const budget = loadTsModule("@/lib/opportunity-engine/pr262-sensor-fetch-budget", overrides);
const sensorSource = readFileSync(new URL("../lib/opportunity-engine/pr262-lightweight-sensor-v3.ts", import.meta.url), "utf8")
  .replace("async function marketWatch(", "export async function marketWatch(");
const sensorStubs = {
  ...overrides,
  "@/lib/equity-signal/event-sources": {}, "@/lib/equity-signal/macro": {},
  "@/lib/opportunity-engine/pr262-trade-halt-snapshot": {}, "@/lib/opportunity-engine/pr262-change-sensor": {},
  "@/lib/opportunity-engine/pr262-direct-announcements": {}, "@/lib/opportunity-engine/pr262-exposure-index": {},
};
const sensor = { exports: {} };
const code = ts.transpileModule(sensorSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
new Function("require", "module", "exports", code)(name => loadTsModule(name, sensorStubs), sensor, sensor.exports);
const { marketWatch } = sensor.exports;
const universe = () => ({ version: 1, scope: "active_us_exchange_listed_common_equities_and_adrs", constructionMode: "nasdaq_plus_sec",
  refreshedAt: now.toISOString(), entries: cohort.map(company => ({ ticker: company.ticker, cik: company.cik, name: company.company,
    exchange: company.exchange, securityType: company.securityType, aliases: [], sourceNames: ["SEC company_tickers_exchange", "Nasdaq Trader nasdaqlisted"] })),
  coverage: { eligibleEquities: cohort.length, cikMapped: cohort.length, cikMappedPercent: 100 }, sources: [] });
function scannerRow(identity, changes = {}) {
  const fields = { name: identity.ticker, description: identity.company, exchange: identity.exchange,
    country: "United States", currency: "USD", type: "stock", typespecs: ["common"], is_primary: true,
    close: 10, change: 0, volume: 1_000_000, relative_volume_10d_calc: 1, market_cap_basic: 1_000_000_000,
    sector: "Technology", industry: "Software", price_earnings_ttm: 15, price_book_ratio: 2,
    price_sales_ratio: 3, enterprise_value_ebitda_ttm: 10, total_revenue: 300_000_000,
    net_income: 30_000_000, free_cash_flow: 40_000_000, earnings_per_share_diluted_ttm: 1,
    total_revenue_yoy_growth_ttm: 10, total_revenue_yoy_growth_fy: 12, net_income_yoy_growth_ttm: 10,
    earnings_per_share_diluted_yoy_growth_ttm: 10, gross_margin: 60, operating_margin: 20, net_margin: 10,
    debt_to_equity: 0.1, current_ratio: 2, return_on_equity: 20, return_on_assets: 10,
    target_price: 20, number_of_analysts: 5, beta_1_year: 1, "Volatility.D": 1, ...changes };
  return { s: identity.tradingViewSymbol, d: engine.US_VALUE_SCANNER_COLUMNS.map(column => fields[column] ?? null) };
}
let identities = cache.pilotWatchIdentities(universe(), now);
assert.equal(identities.length, 25, "Every configured cohort issuer can be watched on a fresh, exact official universe without a foundation.");
assert.equal(cache.pilotWatchExposure(universe(), now).length, 25);
assert.ok(cache.pilotWatchExposure(universe(), now).every(row => row.baseFairValue === null), "Identity bootstrapping cannot invent valuation.");
const wrongCik = universe(); wrongCik.entries[0].cik = "0000000999";
assert.equal(cache.pilotWatchIdentities(wrongCik, now).length, 24);
const wrongExchange = universe(); wrongExchange.entries[0].exchange = "OTC";
assert.equal(cache.pilotWatchIdentities(wrongExchange, now).length, 24);
const noSec = universe(); noSec.entries[0].sourceNames = ["Nasdaq Trader nasdaqlisted"];
assert.equal(cache.pilotWatchIdentities(noSec, now).length, 24);
const wrongType = universe(); wrongType.entries[0].securityType = cohort[0].securityType === "adr" ? "common_stock" : "adr";
assert.equal(cache.pilotWatchIdentities(wrongType, now).length, 24);
const duplicateIssuer = universe(); duplicateIssuer.entries.push({ ...duplicateIssuer.entries[0], ticker: "DUPL" });
duplicateIssuer.coverage.eligibleEquities += 1; duplicateIssuer.coverage.cikMapped += 1;
assert.equal(cache.pilotWatchIdentities(duplicateIssuer, now).length, 24);
assert.equal(cache.pilotWatchIdentities({ ...universe(), refreshedAt: "2026-10-02T12:59:59Z" }, now).length, 0);
assert.equal(cache.pilotWatchIdentities({ ...universe(), refreshedAt: "2026-10-03T13:00:01Z" }, now).length, 0);

const savedDateNow = Date.now;
const savedConsoleInfo = console.info;
const diagnostics = [];
console.info = (...args) => diagnostics.push(args);
let networkCalls = 0;
let requests = [];
Date.now = () => now.getTime();
try {
  const rawFetch = async (_request, init) => {
    networkCalls += 1;
    const body = JSON.parse(init.body);
    requests.push(body);
    const rows = body.symbols.tickers.map(symbol => identities.find(identity => identity.tradingViewSymbol === symbol)).filter(Boolean).map(identity => scannerRow(identity));
    return new Response(JSON.stringify({ data: rows }), { status: 200 });
  };
  // Controlled proof of the original failure: one cohort watch followed by a
  // targeted request is blocked every cycle by the real shared cadence guard.
  for (let cycle = 0; cycle < 3; cycle += 1) {
    now = new Date(Date.UTC(2026, 9, 3, 13, cycle * 5));
    const guarded = await budget.createPr262SensorBudgetedFetch({ now, fetchImpl: rawFetch });
    const market = await marketWatch(guarded.fetchImpl, cache.pilotWatchExposure(universe(), now), now, 0, []);
    assert.equal(market.prices.length, 25);
    assert.equal(market.valuationPersistence.records, 25);
    assert.equal(market.valuationPersistence.written, true);
    assert.equal(market.prices[0].quoteObservedAt, null);
    assert.equal(market.prices[0].liveQuoteVerified, false);
    await assert.rejects(engine.refreshUsValueCompany({ ...identities[0], now, fetchImpl: guarded.fetchImpl }), /pr262_sensor_budget_guard:tradingview:minimum_interval;next_retry_at=/);
    const row = await cache.readPilotWatchValuation(identities.find(identity => !cache.pilotValuationUnitsBlocker(identity)), now);
    assert.ok(row?.analysis);
    assert.equal(row.receivedAt, now.toISOString());
    assert.equal(row.quoteObservedAt, null, "A Saturday retrieval is not a live price observation.");
    assert.equal(row.fundamentalPeriodAsOf, null, "A retrieval is not a new reporting period.");
    assert.equal(row.liveQuoteVerified, false);
    assert.equal(row.analysis.sourceTiming.observedAtMeaning, "provider_snapshot_retrieval");
    assert.equal(row.analysis.sourceTiming.receivedAt, row.receivedAt);
    assert.equal(row.analysis.sourceTiming.quoteObservedAt, null);
    assert.equal(row.analysis.sourceTiming.fundamentalPeriodAsOf, null);
    assert.equal(row.analysis.sourceTiming.liveQuoteVerified, false);
    assert.equal(networkCalls, cycle + 1, "Cache reuse must cost no additional provider request.");
    assert.equal(Object.values(objects.get(budgetKey).value.hourlyCounts.sensor_tradingview).reduce((a, b) => a + b), cycle + 1);
    assert.deepEqual(Object.keys(objects.get(budgetKey).value.lastCadenceAt), ["sensor_tradingview_watch"], "No fresh cadence namespace may bypass the existing guard.");
    assert.ok(requests.at(-1).symbols.tickers.length <= 25);
    assert.deepEqual(requests.at(-1).columns, [...engine.US_VALUE_SCANNER_COLUMNS]);
  }
  const safeIdentity = identities.find(identity => !cache.pilotValuationUnitsBlocker(identity));
  assert.equal(diagnostics.length, 3, "Only accepted targeted cache reads emit diagnostics, not whole watch scans.");
  const latestDiagnostic = JSON.parse(diagnostics.at(-1)[1]);
  assert.equal(diagnostics.at(-1)[0], "[simple-alert-watch-valuation-inputs]");
  assert.equal(latestDiagnostic.numericInputs.close, 10);
  assert.equal(latestDiagnostic.numericInputs.price_book_ratio, 2);
  assert.equal(latestDiagnostic.numericInputs.enterprise_value_ebitda_ttm, 10);
  assert.equal(latestDiagnostic.numericInputs.earnings_per_share_diluted_ttm, 1);
  assert.equal(latestDiagnostic.observedAtMeaning, "provider_snapshot_retrieval");
  assert.equal(latestDiagnostic.quoteObservedAt, null);
  assert.equal(latestDiagnostic.fundamentalPeriodAsOf, null);
  assert.equal(latestDiagnostic.liveQuoteVerified, false);
  assert.deepEqual(Object.keys(latestDiagnostic.derivedRange), ["low", "base", "high"]);
  const cachedBeforeDiagnostic = structuredClone(objects);
  const baselineAnalysis = await cache.readPilotWatchValuation(safeIdentity, now);
  assert.equal(latestDiagnostic.derivedRange.low, baselineAnalysis.analysis.fairValue.conservativeValue);
  assert.equal(latestDiagnostic.derivedRange.high, baselineAnalysis.analysis.fairValue.optimisticValue);
  console.info = () => { throw new Error("isolated logging failure"); };
  try {
    assert.deepEqual(await cache.readPilotWatchValuation(safeIdentity, now), baselineAnalysis,
      "Diagnostic failure cannot change valuation/evidence or admission.");
  } finally { console.info = (...args) => diagnostics.push(args); }
  assert.deepEqual(objects, cachedBeforeDiagnostic, "Diagnostics cannot write or change cached rows or quota.");
  assert.equal(networkCalls, 3, "Diagnostics cannot add provider calls.");
  await cache.readPilotWatchValuation({ ...safeIdentity, secret: "DO_NOT_LOG_IDENTITY_EXTRA" }, now);
  assert.ok(!diagnostics.at(-1)[1].includes("DO_NOT_LOG"), "Only explicit identity keys may be logged.");
  const rawCells = objects.get(cacheKey).value.records.find(record => record.ticker === safeIdentity.ticker).row.d;
  const volumeIndex = engine.US_VALUE_SCANNER_COLUMNS.indexOf("volume");
  const priceIndex = engine.US_VALUE_SCANNER_COLUMNS.indexOf("price_book_ratio");
  rawCells[volumeIndex] = { secret: "DO_NOT_LOG_RAW_OBJECT" };
  rawCells[priceIndex] = "2,000.125";
  await cache.readPilotWatchValuation(safeIdentity, now);
  const sanitized = JSON.parse(diagnostics.at(-1)[1]);
  assert.equal(sanitized.numericInputs.volume, null);
  assert.equal(sanitized.numericInputs.price_book_ratio, 2000.125, "Keep numeric precision for ratio attribution.");
  assert.ok(!diagnostics.at(-1)[1].includes("DO_NOT_LOG"));
  assert.ok(diagnostics.at(-1)[1].length < 3000, "Fixed-field numeric diagnostic stays bounded.");
  objects.clear(); for (const [key, value] of cachedBeforeDiagnostic) objects.set(key, value);
  const acceptedDiagnosticCount = diagnostics.length;
  assert.equal(await cache.readPilotWatchValuation(safeIdentity, new Date(now.getTime() + 15 * 60_000 + 1)), null);
  assert.equal(await cache.readPilotWatchValuation({ ...safeIdentity, cik: "0000000999" }, now), null);
  pilot = false;
  assert.equal(await cache.readPilotWatchValuation(safeIdentity, now), null);
  pilot = true;
  assert.equal(diagnostics.length, acceptedDiagnosticCount, "Stale/wrong-issuer/nonpilot data never emits accepted diagnostics.");
  now = new Date(now.getTime() + 1);
  const cheapRow = scannerRow(safeIdentity, { close: 10, earnings_per_share_diluted_ttm: 2,
    net_income: 200_000_000, free_cash_flow: 150_000_000, price_earnings_ttm: 5 });
  const freshValuation = await marketWatch(async () => new Response(JSON.stringify({ data: [cheapRow] })),
    cache.pilotWatchExposure(universe(), now), now, 0, []);
  assert.ok(freshValuation.events.some(event => event.kind === "valuation_review"), "Fresh qualifying valuation data must reach review without an old foundation or a price spike");
  assert.ok(freshValuation.events.every(event => event.sourceProvider === "valuation_foundation_review"));
  assert.equal(freshValuation.prices[0].liveQuoteVerified, false, "Research admission never certifies the retrieved quote");
  const sameValuation = await marketWatch(async () => new Response(JSON.stringify({ data: [cheapRow] })),
    cache.pilotWatchExposure(universe(), now), new Date(now.getTime() + 1000), 0, []);
  assert.deepEqual(sameValuation.events.map(event => event.id), freshValuation.events.map(event => event.id), "Same-day evidence retains stable event IDs");
  now = new Date(now.getTime() + 1000);
  for (const rows of [[cheapRow, cheapRow], [scannerRow(safeIdentity, { is_primary: false })],
    [scannerRow(safeIdentity, { currency: "EUR" })], [scannerRow(safeIdentity, { name: "WRONG" })],
    [scannerRow(safeIdentity, { earnings_per_share_diluted_ttm: null, net_income: null, free_cash_flow: null, price_book_ratio: null })]]) {
    assert.equal(cache.pilotWatchValuationThresholds(rows, safeIdentity, now), null, "Ambiguous identity, incompatible units and insufficient methods cannot supply thresholds");
  }
  assert.equal(cache.pilotWatchValuationThresholds([cheapRow], { ...safeIdentity, cik: "0000000999" }, now), null);
  const held = cohort.find(row => row.upsidePolicy === "financing_compliance_quarantine");
  const heldIdentity = identities.find(row => row.ticker === held.ticker);
  const heldLevels = cache.pilotWatchValuationThresholds([scannerRow(heldIdentity, { earnings_per_share_diluted_ttm: 2, net_income: 200_000_000, free_cash_flow: 150_000_000 })], heldIdentity, now);
  assert.ok(heldLevels);
  assert.equal(heldLevels.buyBelowPrice, null); assert.equal(heldLevels.strongBuyBelowPrice, null, "Financing quarantine cannot acquire upside review authority");
  assert.equal(await cache.readPilotWatchValuation(safeIdentity, new Date(now.getTime() + 15 * 60_000 + 1)), null);
  assert.equal(await cache.readPilotWatchValuation(safeIdentity, new Date(now.getTime() - 1)), null);
  assert.equal(await cache.readPilotWatchValuation({ ...safeIdentity, cik: "0000000999" }, now), null);
  assert.equal(await cache.readPilotWatchValuation({ ...safeIdentity, tradingViewSymbol: `NYSE:${safeIdentity.ticker}` }, now), null);
  const cacheBefore = structuredClone(objects.get(cacheKey));
  await cache.persistPilotWatchValuations(identities.map(identity => scannerRow(identity)), identities, new Date(now.getTime() - 1));
  assert.deepEqual(objects.get(cacheKey), cacheBefore, "An older scan cannot overwrite a newer one.");
  const row = scannerRow(safeIdentity);
  row.d[0] = "OTHER";
  now = new Date(now.getTime() + 1);
  await cache.persistPilotWatchValuations([row], [safeIdentity], now);
  assert.equal(await cache.readPilotWatchValuation(safeIdentity, now), null, "Mismatched row identity fails closed.");
  now = new Date(now.getTime() + 1);
  await cache.persistPilotWatchValuations([scannerRow(safeIdentity), scannerRow(safeIdentity)], [safeIdentity], now);
  assert.equal(await cache.readPilotWatchValuation(safeIdentity, now), null, "Ambiguous rows fail closed.");
  now = new Date(now.getTime() + 1);
  await cache.persistPilotWatchValuations([scannerRow(safeIdentity, { is_primary: false })], [safeIdentity], now);
  assert.equal(await cache.readPilotWatchValuation(safeIdentity, now), null, "Nonprimary rows fail closed.");
  // This explicit fixture also runs before the new cohort config is integrated.
  cohort = [{ ticker: "HSAI", cik: "0001861737", company: "Hesai Group", exchange: "Nasdaq", securityType: "adr", adsOrdinarySharesRatio: 8, financialReportingCurrency: "RMB" }];
  const adsSourceUrl = "https://www.sec.gov/Archives/edgar/data/1861737/000110465926082432/tm2620203d1_6k.htm";
  Object.assign(cohort[0], { adsRatioEffectiveAt: "2026-07-10", adsRatioSourceUrl: adsSourceUrl, sourceUrls: [adsSourceUrl] });
  const secOnlyAds = universe();
  secOnlyAds.entries[0].securityType = "common_stock";
  secOnlyAds.entries[0].sourceNames = ["SEC company_tickers_exchange"];
  const reviewedAds = cache.pilotWatchIdentities(secOnlyAds, now);
  assert.equal(reviewedAds.length, 1, "Reviewed exact-issuer ADS filing can supplement SEC metadata's missing share-class field for monitoring.");
  assert.equal(reviewedAds[0].securityType, "adr");
  assert.equal(reviewedAds[0].securityIdentitySourceUrl, adsSourceUrl);
  const conflictingNasdaq = structuredClone(secOnlyAds); conflictingNasdaq.entries[0].sourceNames.push("Nasdaq Trader nasdaqlisted");
  assert.equal(cache.pilotWatchIdentities(conflictingNasdaq, now).length, 0, "Reviewed filing cannot silently override a listing-source class conflict.");
  const attestation = { ...cohort[0] };
  for (const bad of [{ adsRatioSourceUrl: adsSourceUrl.replace("1861737", "999") },
    { adsRatioSourceUrl: adsSourceUrl.replace("www.sec.gov", "example.com") },
    { adsRatioEffectiveAt: "2027-01-01" }, { sourceUrls: [] }, { adsOrdinarySharesRatio: 0 }]) {
    cohort[0] = { ...attestation, ...bad };
    assert.equal(cache.pilotWatchIdentities(secOnlyAds, now).length, 0);
  }
  cohort[0] = attestation;
  identities = cache.pilotWatchIdentities(universe(), now);
  assert.equal(identities.length, 1, "Proven ADR identity permits monitoring.");
  assert.equal(cache.pilotValuationUnitsBlocker(identities[0]), "pilot_valuation_currency_or_ads_basis_unverified");
  assert.equal(cache.pilotWatchValuationThresholds([scannerRow(identities[0])], identities[0], now), null);
  now = new Date(now.getTime() + 1);
  await cache.persistPilotWatchValuations([scannerRow(identities[0])], identities, now);
  assert.equal(await cache.readPilotWatchValuation(identities[0], now), null, "USD quote currency does not prove RMB financial or per-ADS consistency.");
  // Hard daily fuse remains unchanged even when a watch would be useful.
  const state = objects.get(budgetKey);
  state.value.hourlyCounts.sensor_tradingview = { [now.toISOString().slice(0, 13)]: 300 };
  now = new Date(now.getTime() + 5 * 60_000);
  const exhausted = await budget.createPr262SensorBudgetedFetch({ now, fetchImpl: rawFetch });
  await assert.rejects(marketWatch(exhausted.fetchImpl, cache.pilotWatchExposure(universe(), now), now, 0, []), /rolling_24h_budget;next_retry_at=/);
  assert.equal(networkCalls, 3);
  pilot = false;
  assert.equal(await cache.readPilotWatchValuation(identities[0], now), null);
  assert.equal((await cache.persistPilotWatchValuations([], [], now)).reason, "outside_pilot");
  assert.equal(cache.pilotWatchExposure(universe(), now).length, 0);
} finally { Date.now = savedDateNow; console.info = savedConsoleInfo; }
console.log(JSON.stringify({ ok: true, originalStarvationReproducedCycles: 3, freshValuationResearchWithoutFoundation: true,
  ambiguousValuationRowsRejected: true, upsideQuarantinePreserved: true, stableSameDayReviewIdentity: true,
  providerRequestsForThreeWatchesAndCacheReuses: networkCalls,
  unchangedSharedQuota: 300, unchangedCadenceMinutes: 4.5, cohortSizeWithoutFoundation: 25, maximumCacheAgeMinutes: 15,
  exactIdentityFailClosed: true, weekendQuoteNotLabeledLive: true, foreignAdsValuationWithheld: true }));
