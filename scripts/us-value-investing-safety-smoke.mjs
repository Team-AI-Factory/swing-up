import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/opportunity-engine/us-value-investing-safety.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const cjsModule = { exports: {} };
new Function("require", "module", "exports", output)((name) => {
  if (name === "@/lib/r2-warehouse") return {
    getR2Config: () => ({ configured: false }),
    writeVersionedJsonToR2: async () => ({ written: true, conflict: false, etag: "test" }),
  };
  throw new Error(`Unexpected import in value safety smoke: ${name}`);
}, cjsModule, cjsModule.exports);
const { hardenUsValueInvestingCycleForTest } = cjsModule.exports;

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
assert.ok(hardened.analyses.find((entry) => entry.ticker === "BANK").decision.blockers.some((value) => /specialist sector/i.test(value)));
assert.equal(hardened.analyses.find((entry) => entry.ticker === "WIDE").decision.seriousSignal, false);
assert.ok(hardened.analyses.find((entry) => entry.ticker === "WIDE").decision.blockers.some((value) => /disagree too widely/i.test(value)));
assert.equal(hardened.analyses.some((entry) => entry.ticker === "OTCX"), false);
assert.equal(hardened.methodology.safetyOverlay, "us_value_alert_safety_v2");

console.log(JSON.stringify({
  ok: true,
  seriousBuy: hardened.seriousAlerts.buy.map((entry) => entry.ticker),
  otcExcluded: true,
  specialistSectorsBlocked: true,
  valuationAgreementRequired: true,
  eligibleCoveragePercent: hardened.coverage.processingCoveragePercent,
}, null, 2));
