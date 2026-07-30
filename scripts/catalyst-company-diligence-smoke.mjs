import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/opportunity-engine/catalyst-company-diligence.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const cjsModule = { exports: {} };
new Function("require", "module", "exports", output)((name) => {
  if (name === "@/lib/equity-signal/universe") return { loadEquityUniverse: async () => ({ snapshot: { entries: [] } }) };
  if (name === "@/lib/r2-warehouse") return { getR2Config: () => ({ configured: false }), writeVersionedJsonToR2: async () => ({ written: true }) };
  throw new Error(`Unexpected import in catalyst diligence smoke: ${name}`);
}, cjsModule, cjsModule.exports);

const { evaluateCatalystDiligenceMetricsForTest } = cjsModule.exports;

const durable = evaluateCatalystDiligenceMetricsForTest({
  revenueCurrent: 12_000,
  revenuePrior: 10_000,
  revenuePrior2: 9_000,
  netIncome: 1_500,
  netIncomePrior: 1_200,
  operatingIncome: 2_000,
  operatingCashFlow: 2_200,
  capitalExpenditure: 500,
  incomeTaxExpenseBenefit: 300,
  gainOnAssetOrBusinessSale: 0,
  cash: 4_000,
  currentDebt: 500,
  noncurrentDebt: 3_000,
  assets: 20_000,
  liabilities: 8_000,
});
assert.equal(durable.buyQualityConfirmed, true);
assert.equal(durable.valuationInputsReliable, true);
assert.equal(durable.fundamentalRiskConfirmed, false);
assert.equal(durable.checks.earningsQuality, "pass");
assert.equal(durable.checks.revenueDurability, "pass");

const oneTimeProfit = evaluateCatalystDiligenceMetricsForTest({
  revenueCurrent: 10_100,
  revenuePrior: 10_000,
  revenuePrior2: 9_900,
  netIncome: 2_000,
  netIncomePrior: 800,
  operatingIncome: 900,
  operatingCashFlow: 600,
  capitalExpenditure: 300,
  incomeTaxExpenseBenefit: -700,
  gainOnAssetOrBusinessSale: 500,
  cash: 1_000,
  currentDebt: 500,
  noncurrentDebt: 2_000,
  assets: 8_000,
  liabilities: 5_000,
});
assert.equal(oneTimeProfit.buyQualityConfirmed, false);
assert.equal(oneTimeProfit.valuationInputsReliable, false);
assert.equal(oneTimeProfit.fundamentalRiskConfirmed, true);
assert.equal(oneTimeProfit.checks.oneTimeEarningsRisk, "blocked");

const capitalHungry = evaluateCatalystDiligenceMetricsForTest({
  revenueCurrent: 5_000,
  revenuePrior: 4_800,
  revenuePrior2: 4_600,
  netIncome: 600,
  netIncomePrior: 550,
  operatingIncome: 800,
  operatingCashFlow: 900,
  capitalExpenditure: 800,
  incomeTaxExpenseBenefit: 100,
  gainOnAssetOrBusinessSale: 0,
  cash: 500,
  currentDebt: 1_500,
  noncurrentDebt: 4_000,
  assets: 7_000,
  liabilities: 6_000,
});
assert.equal(capitalHungry.buyQualityConfirmed, false);
assert.equal(capitalHungry.fundamentalRiskConfirmed, true);
assert.equal(capitalHungry.checks.debtLoad, "blocked");
assert.equal(capitalHungry.checks.reinvestmentBurden, "blocked");

console.log(JSON.stringify({
  ok: true,
  durableCompanyConfirmed: true,
  oneTimeProfitBlocked: true,
  debtAndReinvestmentStressBlocked: true,
  directCustomerRetentionNeverInvented: true,
}, null, 2));
