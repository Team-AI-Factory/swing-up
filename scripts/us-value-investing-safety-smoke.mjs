import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/opportunity-engine/us-value-investing-safety.ts", import.meta.url), "utf8");
const specialistSource = readFileSync(new URL("../lib/opportunity-engine/us-sector-specialist-valuation.ts", import.meta.url), "utf8");
const specialistOutput = ts.transpileModule(specialistSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const specialistModule = { exports: {} };
new Function("require", "module", "exports", specialistOutput)(() => {
  throw new Error("Sector specialist valuation module must remain dependency-free.");
}, specialistModule, specialistModule.exports);
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const cjsModule = { exports: {} };
let activeWrites = 0;
let maximumConcurrentWrites = 0;
let writeCount = 0;
new Function("require", "module", "exports", output)((name) => {
  if (name === "@/lib/r2-warehouse") return {
    getR2Config: () => ({ configured: true }),
    writeVersionedJsonToR2: async () => {
      writeCount += 1;
      activeWrites += 1;
      maximumConcurrentWrites = Math.max(maximumConcurrentWrites, activeWrites);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeWrites -= 1;
      return { written: true, conflict: false, etag: "test" };
    },
  };
  if (name === "@/lib/opportunity-engine/pr262-storage") return { pr262StorageKey: (relative) => `branch-labs/pr-262/${relative}` };
  if (name === "@/lib/opportunity-engine/us-sector-specialist-valuation") return specialistModule.exports;
  throw new Error(`Unexpected import in value safety smoke: ${name}`);
}, cjsModule, cjsModule.exports);
const {
  hardenAndPersistUsValueInvestingCycle,
  hardenUsValueInvestingCycleForTest,
  persistHardenedUsValueInvestingCycle,
} = cjsModule.exports;

function item(overrides = {}) {
  return {
    ticker: "SAFE",
    tradingViewSymbol: "NASDAQ:SAFE",
    company: "Safe Operating Company",
    exchange: "NASDAQ",
    sector: "Technology",
    industry: "Software - Infrastructure",
    currency: "USD",
    observedAt: "2026-07-29T09:00:00.000Z",
    currentPrice: 50,
    marketCap: 5_000_000_000,
    estimatedAverageDollarVolume10d: 25_000_000,
    fundamentals: {
      revenue: 2_000_000_000,
      netIncome: 300_000_000,
      freeCashFlow: 400_000_000,
      dilutedEpsTtm: 4,
      revenueGrowthTtmPercent: 12,
      revenueGrowthFyPercent: 10,
      netIncomeGrowthTtmPercent: 14,
      epsGrowthTtmPercent: 13,
      grossMarginPercent: 70,
      operatingMarginPercent: 22,
      netMarginPercent: 15,
      debtToEquityPercent: 40,
      currentRatio: 1.8,
      returnOnEquityPercent: 20,
      returnOnAssetsPercent: 10,
    },
    valuation: {
      priceToEarnings: 12.5,
      priceToBook: 3,
      priceToSales: 2.5,
      enterpriseValueToEbitda: 10,
      providerTargetPrice: null,
      providerAnalystCount: null,
    },
    scores: {
      businessQuality: 82,
      profitability: 80,
      balanceSheet: 75,
      growthDurability: 78,
      cashGeneration: 85,
      risk: 28,
      evidenceCompleteness: 100,
      fairValueConfidence: 88,
    },
    fairValue: {
      methods: [
        { method: "earnings_power", value: 75, assumption: "test" },
        { method: "owner_earnings_fcf", value: 85, assumption: "test" },
        { method: "graham_value", value: 70, assumption: "test" },
      ],
      conservativeValue: 70,
      baseValue: 75,
      optimisticValue: 85,
      buyBelowPrice: 56.25,
      strongBuyBelowPrice: 52.5,
      trimAbovePrice: 131.25,
      upsideToBasePercent: 50,
      discountToBasePercent: 33.33,
      marginOfSafetyPercent: 33.33,
    },
    decision: {
      action: "buy",
      tier: "serious_foundation_buy",
      seriousSignal: true,
      userAlertEligible: false,
      publicationStatus: "serious_internal_review_only",
      historicallyCertified: false,
      evidenceTriggered: true,
      noNewsRequired: true,
      reasons: [],
      blockers: [],
    },
    ...overrides,
  };
}

const finance = item({ ticker: "BANK", tradingViewSymbol: "NYSE:BANK", exchange: "NYSE", sector: "Finance", industry: "Regional Banks" });
const otc = item({ ticker: "OTCX", tradingViewSymbol: "OTC:OTCX", exchange: "OTC" });
const disagreement = item({
  ticker: "WIDE",
  tradingViewSymbol: "NASDAQ:WIDE",
  fairValue: {
    ...item().fairValue,
    methods: [
      { method: "earnings_power", value: 60, assumption: "test" },
      { method: "owner_earnings_fcf", value: 160, assumption: "test" },
    ],
    conservativeValue: 60,
    baseValue: 110,
    optimisticValue: 160,
    upsideToBasePercent: 120,
  },
});
const raw = {
  ok: true,
  checkedAt: "2026-07-29T09:00:00.000Z",
  marketScope: "US listed common stocks and ADRs only",
  methodology: {
    style: "company_first_conservative_intrinsic_value",
    analystTargetUsedAsFairValue: false,
    newsRequiredForFoundationAlert: false,
    fullFundamentalRefreshMinutes: 15,
    fullWarehousePersistenceHours: 6,
    minimumMarginOfSafetyPercent: 25,
    seriousBuyMinimumUpsidePercent: 40,
    seriousSellMinimumPremiumPercent: 50,
    noSyntheticData: true,
  },
  coverage: {
    provider: "TradingView public US stock scanner",
    totalProviderRows: 4,
    usPrimaryListings: 4,
    companiesAnalyzed: 4,
    companiesWithFairValue: 4,
    companiesWithoutFairValue: 0,
    pagesRequested: 1,
    pagesFailed: 0,
    processingCoveragePercent: 100,
    errors: [],
  },
  seriousAlerts: { buy: [], sell: [], watchOut: [] },
  watchlists: { qualityWaitingForPrice: [], researchOnly: [] },
  warehouse: {
    storage: "not_persisted",
    branchPrefix: "branch-labs/pr-262/value-investing",
    latestIndexKey: "branch-labs/pr-262/value-investing/latest/index.json",
    immutableRunKey: null,
    shardKeys: [],
    persistedThisCycle: false,
    companyRecordsStored: 0,
    errors: [],
  },
  cacheUsed: false,
  analyses: [item(), finance, otc, disagreement],
  safety: { databaseWrites: false, publishing: false, notifications: false, trades: false },
};

const hardened = hardenUsValueInvestingCycleForTest(raw);
assert.equal(hardened.coverage.companiesAnalyzed, 3);
assert.equal(hardened.coverage.processingCoveragePercent, 100);
assert.deepEqual(hardened.seriousAlerts.buy.map((entry) => entry.ticker), ["SAFE"]);
assert.equal(hardened.analyses.find((entry) => entry.ticker === "BANK").decision.seriousSignal, false);
assert.ok(hardened.analyses.find((entry) => entry.ticker === "BANK").decision.reasons.some((value) => /bank specialist model/i.test(value)));
assert.equal(hardened.analyses.find((entry) => entry.ticker === "BANK").decision.blockers.some((value) => /require a specialist sector valuation model/i.test(value)), false);
assert.equal(hardened.analyses.find((entry) => entry.ticker === "WIDE").decision.seriousSignal, false);
assert.ok(hardened.analyses.find((entry) => entry.ticker === "WIDE").decision.blockers.some((value) => /disagree too widely/i.test(value)));
assert.equal(hardened.analyses.some((entry) => entry.ticker === "OTCX"), false);
assert.equal(hardened.methodology.safetyOverlay, "us_value_alert_safety_v2");

const largeRaw = {
  ...raw,
  coverage: {
    ...raw.coverage,
    totalProviderRows: 1_200,
    usPrimaryListings: 1_200,
    companiesAnalyzed: 1_200,
    companiesWithFairValue: 1_200,
  },
  analyses: Array.from({ length: 1_200 }, (_, index) => item({
    ticker: `SAFE${String(index).padStart(4, "0")}`,
    tradingViewSymbol: `NASDAQ:SAFE${String(index).padStart(4, "0")}`,
  })),
};
const firstPersist = await hardenAndPersistUsValueInvestingCycle(largeRaw, { persist: true });
assert.equal(firstPersist.warehouse.storage, "cloudflare_r2");
assert.equal(firstPersist.warehouse.persistedThisCycle, true);
assert.equal(firstPersist.warehouse.companyRecordsStored, 1_200);
assert.equal(firstPersist.warehouse.shardKeys.length, 3);
assert.ok(maximumConcurrentWrites > 1);
assert.ok(maximumConcurrentWrites <= 4);
const writesAfterFirstPersist = writeCount;

const reusedPersist = await hardenAndPersistUsValueInvestingCycle(largeRaw, { persist: true });
assert.equal(reusedPersist.warehouse.storage, "cloudflare_r2");
assert.equal(reusedPersist.warehouse.persistedThisCycle, false);
assert.equal(reusedPersist.warehouse.companyRecordsStored, 1_200);
assert.deepEqual(reusedPersist.warehouse.shardKeys, firstPersist.warehouse.shardKeys);
assert.equal(reusedPersist.warehouse.immutableRunKey, firstPersist.warehouse.immutableRunKey);
assert.equal(writeCount, writesAfterFirstPersist);

const alreadyHardened = hardenUsValueInvestingCycleForTest(largeRaw);
const persistedSameReference = await persistHardenedUsValueInvestingCycle(alreadyHardened);
assert.equal(persistedSameReference, alreadyHardened);
assert.equal(writeCount, writesAfterFirstPersist);

console.log(JSON.stringify({
  ok: true,
  seriousBuy: hardened.seriousAlerts.buy.map((entry) => entry.ticker),
  otcExcluded: true,
  specialistSectorModelIntegrated: true,
  valuationAgreementRequired: true,
  eligibleCoveragePercent: hardened.coverage.processingCoveragePercent,
  boundedShardWriteConcurrency: maximumConcurrentWrites,
  sixHourWarehouseMetadataReused: true,
}, null, 2));
