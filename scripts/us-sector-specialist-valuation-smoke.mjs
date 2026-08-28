import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/opportunity-engine/us-sector-specialist-valuation.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const cjsModule = { exports: {} };
new Function("require", "module", "exports", output)(() => {
  throw new Error("Sector specialist valuation module must remain dependency-free.");
}, cjsModule, cjsModule.exports);

const { classifySpecialistSector, evaluateSectorSpecialistValuation } = cjsModule.exports;

function company(overrides = {}) {
  return {
    ticker: "TEST",
    company: "Test Company",
    sector: "Technology",
    industry: "Software",
    currentPrice: 50,
    marketCap: 5_000_000_000,
    estimatedAverageDollarVolume10d: 25_000_000,
    fundamentals: {
      revenue: 2_000_000_000,
      netIncome: 300_000_000,
      freeCashFlow: 250_000_000,
      dilutedEpsTtm: 4,
      revenueGrowthTtmPercent: 10,
      revenueGrowthFyPercent: 8,
      netIncomeGrowthTtmPercent: 10,
      epsGrowthTtmPercent: 10,
      grossMarginPercent: 50,
      operatingMarginPercent: 20,
      netMarginPercent: 15,
      debtToEquityPercent: 80,
      currentRatio: 1.2,
      returnOnEquityPercent: 15,
      returnOnAssetsPercent: 5,
    },
    valuation: {
      priceToEarnings: 12,
      priceToBook: 1,
      priceToSales: 2,
      enterpriseValueToEbitda: 8,
    },
    scores: { evidenceCompleteness: 100 },
    ...overrides,
  };
}

const bank = company({
  ticker: "BANK",
  company: "Example Regional Bank",
  sector: "Financial",
  industry: "Regional Banks",
  currentPrice: 50,
  fundamentals: {
    ...company().fundamentals,
    dilutedEpsTtm: 5,
    returnOnEquityPercent: 16,
    returnOnAssetsPercent: 1.3,
    revenueGrowthTtmPercent: 10,
    epsGrowthTtmPercent: 10,
    freeCashFlow: -900_000_000,
    debtToEquityPercent: 700,
    currentRatio: 0.3,
  },
  valuation: { ...company().valuation, priceToBook: 0.8, enterpriseValueToEbitda: null },
});
const bankValue = evaluateSectorSpecialistValuation(bank, "2026-08-20T12:00:00.000Z");
assert.equal(classifySpecialistSector(bank), "bank");
assert.equal(bankValue.sectorKind, "bank");
assert.equal(bankValue.methods.length, 2);
assert.equal(bankValue.decision.action, "buy");
assert.equal(bankValue.decision.foundationPromotionEligible, true);
assert.ok(bankValue.limitations.some((value) => /free cash flow/i.test(value)));
assert.ok(bankValue.fairValue.conservativeUpsidePercent >= 20);

const financial = company({
  ticker: "ASSET",
  company: "Example Asset Manager",
  sector: "Financial",
  industry: "Asset Management",
  currentPrice: 30,
  fundamentals: {
    ...company().fundamentals,
    dilutedEpsTtm: 4,
    returnOnEquityPercent: 20,
    returnOnAssetsPercent: 7,
    netMarginPercent: 25,
    revenueGrowthTtmPercent: 10,
    epsGrowthTtmPercent: 10,
  },
  valuation: { ...company().valuation, priceToBook: 0.75, enterpriseValueToEbitda: 6 },
});
const financialValue = evaluateSectorSpecialistValuation(financial);
assert.equal(financialValue.sectorKind, "financial");
assert.ok(financialValue.methods.length >= 2);
assert.equal(financialValue.decision.action, "buy");
assert.equal(financialValue.decision.foundationPromotionEligible, true);

const insurer = company({
  ticker: "INS",
  company: "Example Insurance Group",
  sector: "Financial",
  industry: "Insurance - Diversified",
  currentPrice: 30,
  fundamentals: {
    ...company().fundamentals,
    dilutedEpsTtm: 4,
    returnOnEquityPercent: 15,
    returnOnAssetsPercent: 2,
    netMarginPercent: 12,
    revenueGrowthTtmPercent: 8,
    epsGrowthTtmPercent: 8,
    freeCashFlow: null,
  },
  valuation: { ...company().valuation, priceToBook: 0.6, enterpriseValueToEbitda: null },
});
const insurerValue = evaluateSectorSpecialistValuation(insurer);
assert.equal(insurerValue.sectorKind, "insurer");
assert.equal(insurerValue.decision.action, "buy");
assert.equal(insurerValue.decision.foundationPromotionEligible, true);
assert.ok(insurerValue.limitations.some((value) => /reserve adequacy/i.test(value)));

const reit = company({
  ticker: "REIT",
  company: "Example Property Trust",
  sector: "Real Estate",
  industry: "REIT - Diversified",
  currentPrice: 50,
  fundamentals: {
    ...company().fundamentals,
    dilutedEpsTtm: 1,
    returnOnEquityPercent: 8,
    returnOnAssetsPercent: 4,
    operatingMarginPercent: 30,
    netMarginPercent: 25,
    revenueGrowthTtmPercent: 6,
    epsGrowthTtmPercent: -5,
    freeCashFlow: -150_000_000,
    debtToEquityPercent: 150,
  },
  valuation: { ...company().valuation, priceToBook: 0.8, enterpriseValueToEbitda: 8 },
});
const reitValue = evaluateSectorSpecialistValuation(reit);
assert.equal(reitValue.sectorKind, "real_estate_reit");
assert.equal(reitValue.methods.length, 2);
assert.equal(reitValue.decision.action, "buy");
assert.equal(reitValue.decision.foundationPromotionEligible, true);
assert.ok(reitValue.limitations.some((value) => /FFO\/AFFO/i.test(value)));

const utility = company({
  ticker: "UTIL",
  company: "Example Electric Utility",
  sector: "Utilities",
  industry: "Electric Utilities",
  currentPrice: 30,
  fundamentals: {
    ...company().fundamentals,
    dilutedEpsTtm: 3,
    returnOnEquityPercent: 10,
    returnOnAssetsPercent: 3,
    operatingMarginPercent: 20,
    revenueGrowthTtmPercent: 4,
    epsGrowthTtmPercent: 4,
    freeCashFlow: -500_000_000,
    debtToEquityPercent: 140,
    currentRatio: 0.8,
  },
  valuation: { ...company().valuation, priceToBook: 0.75, enterpriseValueToEbitda: 6 },
});
const utilityValue = evaluateSectorSpecialistValuation(utility);
assert.equal(utilityValue.sectorKind, "utility");
assert.ok(utilityValue.methods.length >= 2);
assert.equal(utilityValue.decision.action, "buy");
assert.equal(utilityValue.decision.foundationPromotionEligible, true);
assert.ok(utilityValue.limitations.some((value) => /generic free cash flow/i.test(value)));

const expensiveBank = company({
  ticker: "EXP",
  company: "Expensive Bank",
  sector: "Financial",
  industry: "Banks - Diversified",
  currentPrice: 100,
  fundamentals: {
    ...company().fundamentals,
    dilutedEpsTtm: 4,
    returnOnEquityPercent: 6,
    returnOnAssetsPercent: 0.5,
    revenueGrowthTtmPercent: -10,
    epsGrowthTtmPercent: -12,
  },
  valuation: { ...company().valuation, priceToBook: 2.5, enterpriseValueToEbitda: null },
});
const expensiveBankValue = evaluateSectorSpecialistValuation(expensiveBank);
assert.equal(expensiveBankValue.decision.action, "sell");
assert.equal(expensiveBankValue.decision.foundationPromotionEligible, true);

const stressedUtility = company({
  ticker: "RISK",
  company: "Stressed Utility",
  sector: "Utilities",
  industry: "Electric Utilities",
  currentPrice: 10,
  marketCap: 200_000_000,
  estimatedAverageDollarVolume10d: 1_000_000,
  fundamentals: {
    ...company().fundamentals,
    netIncome: -100_000_000,
    dilutedEpsTtm: -2,
    returnOnEquityPercent: 2,
    operatingMarginPercent: 5,
    revenueGrowthTtmPercent: -15,
    epsGrowthTtmPercent: -35,
    debtToEquityPercent: 500,
    currentRatio: 0.3,
  },
  valuation: { ...company().valuation, priceToBook: 1.2, enterpriseValueToEbitda: 15 },
});
const stressedUtilityValue = evaluateSectorSpecialistValuation(stressedUtility);
assert.equal(stressedUtilityValue.decision.action, "watch_out");
assert.ok(stressedUtilityValue.riskScore >= 80);

const missingReit = company({
  ticker: "MISS",
  company: "Missing Data Property Trust",
  sector: "Real Estate",
  industry: "REIT - Retail",
  valuation: { ...company().valuation, priceToBook: null, enterpriseValueToEbitda: null },
  fundamentals: {
    ...company().fundamentals,
    returnOnAssetsPercent: null,
    revenueGrowthTtmPercent: null,
    revenueGrowthFyPercent: null,
    operatingMarginPercent: null,
    netMarginPercent: null,
    debtToEquityPercent: null,
  },
});
const missingReitValue = evaluateSectorSpecialistValuation(missingReit);
assert.equal(missingReitValue.decision.action, "research_only");
assert.equal(missingReitValue.decision.foundationPromotionEligible, false);
assert.ok(missingReitValue.missingInputs.length >= 4);
assert.ok(missingReitValue.decision.blockers.length > 0);

assert.equal(evaluateSectorSpecialistValuation(company()), null);

console.log(JSON.stringify({
  ok: true,
  models: {
    bank: bankValue.decision.action,
    financial: financialValue.decision.action,
    insurer: insurerValue.decision.action,
    reit: reitValue.decision.action,
    utility: utilityValue.decision.action,
  },
  sellCase: expensiveBankValue.decision.action,
  watchOutCase: stressedUtilityValue.decision.action,
  missingDataFailsClosed: missingReitValue.decision.action,
  genericTechnologyUntouched: true,
}, null, 2));
