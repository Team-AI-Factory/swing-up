import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const intelligenceSource = readFileSync(new URL("../lib/opportunity-engine/us-sector-specialist-intelligence.ts", import.meta.url), "utf8");
const guardSource = readFileSync(new URL("../lib/opportunity-engine/us-sector-specialist-decision-guard.ts", import.meta.url), "utf8");
const intelligenceOutput = ts.transpileModule(intelligenceSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const guardOutput = ts.transpileModule(guardSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const intelligenceModule = { exports: {} };
new Function("require", "module", "exports", intelligenceOutput)(() => {
  throw new Error("Unexpected dependency in specialist intelligence.");
}, intelligenceModule, intelligenceModule.exports);
const guardModule = { exports: {} };
new Function("require", "module", "exports", guardOutput)((name) => {
  if (name === "@/lib/opportunity-engine/us-sector-specialist-intelligence") return intelligenceModule.exports;
  throw new Error(`Unexpected guard dependency: ${name}`);
}, guardModule, guardModule.exports);
const { evaluateFailClosedSectorSpecialist } = guardModule.exports;

const NOW = "2026-08-26T09:00:00.000Z";
const metric = (value, sourceType = "sec_filing", extra = {}) => ({
  value,
  previousValue: null,
  asOf: NOW,
  sourceType,
  primarySource: true,
  estimated: false,
  conflict: false,
  ...extra,
});
const company = {
  ticker: "BANK",
  company: "Example Bank",
  sector: "Financial",
  industry: "Regional Banks",
  currentPrice: 50,
  marketCap: 10_000_000_000,
  estimatedAverageDollarVolume10d: 50_000_000,
};
const baseline = {
  sectorKind: "bank",
  ticker: "BANK",
  company: "Example Bank",
  evidenceScore: 90,
  qualityScore: 82,
  riskScore: 25,
  fairValue: {
    conservativeValue: 42,
    baseValue: 78,
    optimisticValue: 92,
    buyBelowPrice: 55,
    strongBuyBelowPrice: 48,
    trimAbovePrice: 115,
    upsideToBasePercent: 56,
    conservativeUpsidePercent: -16,
    premiumToBasePercent: -35.9,
    premiumToOptimisticPercent: -45.7,
    methodSpreadPercent: 28,
  },
  decision: { action: "watch", foundationPromotionEligible: false, reasons: [], blockers: [] },
};
const trustedBankEvidence = {
  tangibleBookValuePerShare: metric(55),
  returnOnTangibleCommonEquityPercent: metric(17),
  cet1RatioPercent: metric(12.5, "regulatory"),
  netInterestMarginPercent: metric(3.7),
  netInterestMarginChangeBps: metric(15),
  depositGrowthPercent: metric(4),
  uninsuredDepositPercent: metric(18),
  loanToDepositPercent: metric(84),
  nonperformingLoanPercent: metric(0.7),
  netChargeOffPercent: metric(0.35),
};

const trusted = evaluateFailClosedSectorSpecialist({
  evaluatedAt: NOW,
  company,
  baseline,
  market: { priceChange1dPercent: -7, sectorChange1dPercent: -1, volatility20dPercent: 1.2, relativeVolume: 2.5 },
  evidence: { bank: trustedBankEvidence },
});
assert.equal(trusted.provenanceGuard.passed, true);
assert.equal(trusted.decision.action, "buy");
assert.equal(trusted.decision.foundationPromotionEligible, true);

const analystCapital = evaluateFailClosedSectorSpecialist({
  evaluatedAt: NOW,
  company,
  baseline,
  market: { priceChange1dPercent: -10, sectorChange1dPercent: -1, relativeVolume: 4 },
  evidence: { bank: { ...trustedBankEvidence, cet1RatioPercent: metric(12.5, "analyst_estimate") } },
});
assert.equal(analystCapital.provenanceGuard.passed, false);
assert.equal(analystCapital.decision.foundationPromotionEligible, false);
assert.notEqual(analystCapital.decision.action, "buy");
assert.ok(analystCapital.provenanceGuard.failedMetrics.some((item) => item.key === "cet1_ratio" && item.reason === "not_primary_source" && item.mandatory));

const undatedMustHave = evaluateFailClosedSectorSpecialist({
  evaluatedAt: NOW,
  company,
  baseline,
  evidence: { bank: { ...trustedBankEvidence, cet1RatioPercent: metric(12.5, "regulatory", { asOf: null }) } },
});
assert.equal(undatedMustHave.provenanceGuard.passed, false);
assert.ok(undatedMustHave.provenanceGuard.failedMetrics.some((item) => item.key === "cet1_ratio" && item.reason === "undated"));

const oldQuarter = evaluateFailClosedSectorSpecialist({
  evaluatedAt: NOW,
  company,
  baseline,
  evidence: { bank: { ...trustedBankEvidence, depositGrowthPercent: metric(4, "sec_filing", { asOf: "2025-06-01T00:00:00.000Z" }) } },
});
assert.equal(oldQuarter.provenanceGuard.passed, false);
assert.ok(oldQuarter.provenanceGuard.failedMetrics.some((item) => item.key === "deposit_growth" && item.reason === "stale"));

const missingSecondary = evaluateFailClosedSectorSpecialist({
  evaluatedAt: NOW,
  company,
  baseline,
  evidence: { bank: { ...trustedBankEvidence, tangibleBookValuePerShare: undefined } },
});
assert.equal(missingSecondary.provenanceGuard.passed, true);
assert.ok(missingSecondary.provenanceGuard.trustedCoveragePercent >= 75);
assert.ok(missingSecondary.provenanceGuard.failedMetrics.some((item) => item.key === "tangible_book_value_per_share" && item.mandatory === false));
assert.equal(missingSecondary.decision.foundationPromotionEligible, true);

const adaptiveMove = evaluateFailClosedSectorSpecialist({
  evaluatedAt: NOW,
  company,
  baseline: {
    ...baseline,
    fairValue: { ...baseline.fairValue, upsideToBasePercent: 15, conservativeValue: 45, baseValue: 57.5, optimisticValue: 65 },
  },
  market: { priceChange1dPercent: -3.2, sectorChange1dPercent: -1, volatility20dPercent: 1.0, relativeVolume: 1.5 },
  evidence: { bank: trustedBankEvidence },
});
assert.equal(adaptiveMove.adaptiveMovement.unusual, true);
assert.equal(adaptiveMove.adaptiveMovement.adaptiveThresholdPercent, 1.5);
assert.equal(adaptiveMove.decision.urgentResearch, true);

console.log(JSON.stringify({
  ok: true,
  trustedPrimaryEvidencePromotes: trusted.decision.action,
  analystEstimateCannotMasqueradeAsPrimary: analystCapital.decision.foundationPromotionEligible === false,
  undatedMustHaveFailsClosed: undatedMustHave.provenanceGuard.passed === false,
  staleMustHaveFailsClosed: oldQuarter.provenanceGuard.passed === false,
  missingSecondaryDoesNotKillOpportunity: missingSecondary.provenanceGuard.passed === true,
  lowVolatilityAdaptiveMovementDetected: adaptiveMove.adaptiveMovement.unusual,
}, null, 2));
