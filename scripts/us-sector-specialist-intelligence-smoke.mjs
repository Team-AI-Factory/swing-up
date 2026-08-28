import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/opportunity-engine/us-sector-specialist-intelligence.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const cjsModule = { exports: {} };
new Function("require", "module", "exports", output)(() => {
  throw new Error("Sector specialist intelligence must remain dependency-free.");
}, cjsModule, cjsModule.exports);
const { evaluateSectorSpecialistIntelligence } = cjsModule.exports;

const NOW = "2026-08-26T09:00:00.000Z";
function metric(value, previousValue = null, extra = {}) {
  return {
    value,
    previousValue,
    asOf: NOW,
    sourceType: "sec_filing",
    primarySource: true,
    estimated: false,
    conflict: false,
    ...extra,
  };
}

function company(overrides = {}) {
  return {
    ticker: "TEST",
    company: "Test Company",
    sector: "Financial",
    industry: "Regional Banks",
    currentPrice: 50,
    marketCap: 10_000_000_000,
    estimatedAverageDollarVolume10d: 50_000_000,
    ...overrides,
  };
}

function baseline(kind = "bank", overrides = {}) {
  return {
    sectorKind: kind,
    ticker: "TEST",
    company: "Test Company",
    evidenceScore: 90,
    qualityScore: 78,
    riskScore: 28,
    fairValue: {
      conservativeValue: 40,
      baseValue: 75,
      optimisticValue: 90,
      buyBelowPrice: 55,
      strongBuyBelowPrice: 48,
      trimAbovePrice: 110,
      upsideToBasePercent: 50,
      conservativeUpsidePercent: -20,
      premiumToBasePercent: -33.33,
      premiumToOptimisticPercent: -44.44,
      methodSpreadPercent: 25,
    },
    decision: { action: "watch", foundationPromotionEligible: false, reasons: [], blockers: [] },
    ...overrides,
  };
}

const healthyBank = evaluateSectorSpecialistIntelligence({
  evaluatedAt: NOW,
  company: company(),
  baseline: baseline(),
  market: { priceChange1dPercent: -12, sectorChange1dPercent: -2, marketChange1dPercent: -1, relativeVolume: 3.2 },
  evidence: {
    bank: {
      tangibleBookValuePerShare: metric(52),
      returnOnTangibleCommonEquityPercent: metric(16, 14),
      cet1RatioPercent: metric(12.5, 12.1, { sourceType: "regulatory" }),
      netInterestMarginPercent: metric(3.8, 3.6),
      netInterestMarginChangeBps: metric(20, 5),
      depositGrowthPercent: metric(4, 1),
      loanGrowthPercent: metric(5, 4),
      uninsuredDepositPercent: metric(20, 23),
      nonInterestBearingDepositPercent: metric(30, 29),
      loanToDepositPercent: metric(85, 87),
      nonperformingLoanPercent: metric(0.8, 0.9),
      netChargeOffPercent: metric(0.4, 0.5),
      allowanceCoveragePercent: metric(180, 170),
      commercialRealEstateToCapitalPercent: metric(180, 175),
      aociToTangibleEquityPercent: metric(-10, -13),
    },
  },
});
assert.equal(healthyBank.evidence.decisionGrade, true);
assert.equal(healthyBank.movement.classification, "company_specific_selloff");
assert.equal(healthyBank.decision.action, "buy");
assert.equal(healthyBank.decision.foundationPromotionEligible, true);
assert.equal(healthyBank.decision.urgentResearch, true);
assert.ok(healthyBank.scores.buyOpportunity >= 70);
assert.ok(healthyBank.adversarialReview.positiveSignals.length >= 3);

const conflictedBank = evaluateSectorSpecialistIntelligence({
  evaluatedAt: NOW,
  company: company(),
  baseline: baseline(),
  market: { priceChange1dPercent: -20, sectorChange1dPercent: -1, relativeVolume: 5 },
  evidence: {
    bank: {
      tangibleBookValuePerShare: metric(52),
      returnOnTangibleCommonEquityPercent: metric(16),
      cet1RatioPercent: metric(12, 12, { conflict: true }),
      netInterestMarginPercent: metric(3.8),
      depositGrowthPercent: metric(4),
      nonperformingLoanPercent: metric(0.8),
      netChargeOffPercent: metric(0.4),
    },
  },
});
assert.equal(conflictedBank.evidence.decisionGrade, false);
assert.equal(conflictedBank.decision.foundationPromotionEligible, false);
assert.ok(conflictedBank.evidence.conflictedMetrics.includes("cet1_ratio"));
assert.ok(conflictedBank.decision.blockers.some((item) => /decision-grade/i.test(item)));

const stressedBank = evaluateSectorSpecialistIntelligence({
  evaluatedAt: NOW,
  company: company({ currentPrice: 35 }),
  baseline: baseline("bank", {
    ticker: "TEST",
    riskScore: 55,
    qualityScore: 55,
    fairValue: { ...baseline().fairValue, conservativeValue: 20, baseValue: 35, optimisticValue: 45, upsideToBasePercent: 0, premiumToBasePercent: 0 },
  }),
  evidence: {
    bank: {
      tangibleBookValuePerShare: metric(30),
      returnOnTangibleCommonEquityPercent: metric(4),
      cet1RatioPercent: metric(6.5, 8.5, { sourceType: "regulatory" }),
      netInterestMarginPercent: metric(2.2),
      netInterestMarginChangeBps: metric(-45),
      depositGrowthPercent: metric(-20),
      uninsuredDepositPercent: metric(60),
      nonperformingLoanPercent: metric(5),
      netChargeOffPercent: metric(3),
      loanToDepositPercent: metric(120),
    },
  },
});
assert.equal(stressedBank.evidence.decisionGrade, true);
assert.equal(stressedBank.decision.action, "watch_out");
assert.equal(stressedBank.decision.foundationPromotionEligible, true);
assert.ok(stressedBank.adversarialReview.hardRiskFlags.length >= 2);
assert.ok(stressedBank.scores.watchOutRisk >= 78);

const insurer = evaluateSectorSpecialistIntelligence({
  evaluatedAt: NOW,
  company: company({ ticker: "INS", company: "Insurer", industry: "Property & Casualty Insurance", currentPrice: 40 }),
  baseline: { ...baseline("insurer"), ticker: "INS", company: "Insurer" },
  evidence: {
    insurer: {
      riskBasedCapitalPercent: metric(175, 240, { sourceType: "regulatory" }),
      combinedRatioPercent: metric(108, 101),
      premiumGrowthPercent: metric(12, 8),
      adverseReserveDevelopmentPercent: metric(9, 3),
      unrealizedLossesToEquityPercent: metric(28, 18),
      catastropheLossRatioPercent: metric(12, 5),
    },
  },
});
assert.equal(insurer.evidence.decisionGrade, true);
assert.equal(insurer.decision.action, "watch_out");
assert.equal(insurer.decision.foundationPromotionEligible, true);
assert.ok(insurer.adversarialReview.hardRiskFlags.some((item) => /capital/i.test(item)));
assert.ok(insurer.adversarialReview.contradictions.some((item) => /premium growth/i.test(item)));

const reit = evaluateSectorSpecialistIntelligence({
  evaluatedAt: NOW,
  company: company({ ticker: "REIT", company: "Healthy REIT", sector: "Real Estate", industry: "REIT - Industrial", currentPrice: 50 }),
  baseline: {
    ...baseline("real_estate_reit"), ticker: "REIT", company: "Healthy REIT",
    qualityScore: 76, riskScore: 30,
    fairValue: { ...baseline().fairValue, conservativeValue: 42, baseValue: 80, optimisticValue: 92, upsideToBasePercent: 60, methodSpreadPercent: 30 },
  },
  market: { priceChange1dPercent: -11, sectorChange1dPercent: -2, relativeVolume: 3 },
  evidence: {
    reit: {
      ffoPerShare: metric(5.2, 4.8, { sourceType: "company_ir" }),
      affoPerShare: metric(4.8, 4.4, { sourceType: "company_ir" }),
      ffoGrowthPercent: metric(9),
      sameStoreNoiGrowthPercent: metric(5),
      occupancyPercent: metric(96),
      rentGrowthPercent: metric(4),
      navPerShare: metric(78, 75, { sourceType: "company_ir" }),
      impliedCapRatePercent: metric(5.8, 5.6, { sourceType: "derived", primarySource: false }),
      netDebtToEbitda: metric(4.8, 5.2),
      fixedRateDebtPercent: metric(90, 88),
      weightedAverageDebtMaturityYears: metric(6, 5.7),
      dividendPayoutToAffoPercent: metric(72, 75),
    },
  },
});
assert.equal(reit.evidence.decisionGrade, true);
assert.equal(reit.decision.action, "buy");
assert.ok(reit.adversarialReview.positiveSignals.some((item) => /NOI/i.test(item)));

const utilitySell = evaluateSectorSpecialistIntelligence({
  evaluatedAt: NOW,
  company: company({ ticker: "UTIL", company: "Overvalued Utility", sector: "Utilities", industry: "Electric Utilities", currentPrice: 90 }),
  baseline: {
    ...baseline("utility"), ticker: "UTIL", company: "Overvalued Utility", qualityScore: 58, riskScore: 45,
    fairValue: { ...baseline().fairValue, conservativeValue: 45, baseValue: 55, optimisticValue: 65, upsideToBasePercent: -38.9, premiumToBasePercent: 63.6, premiumToOptimisticPercent: 38.5, methodSpreadPercent: 35 },
  },
  market: { priceChange1dPercent: 10, sectorChange1dPercent: 1, relativeVolume: 2.8 },
  evidence: {
    utility: {
      rateBaseGrowthPercent: metric(2),
      allowedRoePercent: metric(10.2, 10.2, { sourceType: "regulatory" }),
      earnedRoePercent: metric(6.5, 7.2),
      equityCapitalRatioPercent: metric(42, 42, { sourceType: "regulatory" }),
      interestCoverage: metric(2.4, 2.5),
      debtToCapitalPercent: metric(58, 57),
      regulatoryAssetsToEquityPercent: metric(50, 48),
      pendingRateCaseRevenueImpactPercent: metric(-3, 2, { sourceType: "regulatory" }),
      contingentLiabilityToEquityPercent: metric(10, 10),
    },
  },
});
assert.equal(utilitySell.evidence.decisionGrade, true);
assert.equal(utilitySell.movement.classification, "company_specific_rally");
assert.equal(utilitySell.decision.action, "sell");
assert.equal(utilitySell.decision.foundationPromotionEligible, true);
assert.ok(utilitySell.scores.sellOpportunity >= 70);

const utilityContradiction = evaluateSectorSpecialistIntelligence({
  evaluatedAt: NOW,
  company: company({ ticker: "UTILX", company: "Contradictory Utility", sector: "Utilities", industry: "Electric Utilities", currentPrice: 70 }),
  baseline: {
    ...baseline("utility"), ticker: "UTILX", company: "Contradictory Utility", qualityScore: 58, riskScore: 50,
    fairValue: { ...baseline().fairValue, conservativeValue: 45, baseValue: 55, optimisticValue: 65, upsideToBasePercent: -21.4, premiumToBasePercent: 27.3, premiumToOptimisticPercent: 7.7, methodSpreadPercent: 35 },
  },
  evidence: {
    utility: {
      rateBaseGrowthPercent: metric(8),
      allowedRoePercent: metric(10.2, 10.2, { sourceType: "regulatory" }),
      earnedRoePercent: metric(6.5, 7.2),
      equityCapitalRatioPercent: metric(34, 36, { sourceType: "regulatory" }),
      interestCoverage: metric(1.6, 2.1),
      debtToCapitalPercent: metric(71, 67),
      regulatoryAssetsToEquityPercent: metric(110, 85),
      pendingRateCaseRevenueImpactPercent: metric(-3, 2, { sourceType: "regulatory" }),
      contingentLiabilityToEquityPercent: metric(30, 20),
    },
  },
});
assert.equal(utilityContradiction.evidence.decisionGrade, true);
assert.ok(utilityContradiction.adversarialReview.contradictions.some((item) => /Rate base/i.test(item)));
assert.notEqual(utilityContradiction.decision.action, "buy");
assert.equal(utilityContradiction.decision.urgentResearch, true);

const assetManager = evaluateSectorSpecialistIntelligence({
  evaluatedAt: NOW,
  company: company({ ticker: "AM", company: "Asset Manager", industry: "Asset Management", currentPrice: 45 }),
  baseline: { ...baseline("financial"), ticker: "AM", company: "Asset Manager", qualityScore: 75, riskScore: 30 },
  market: { priceChange1dPercent: -8, sectorChange1dPercent: -1 },
  evidence: {
    financial: {
      assetsUnderManagementGrowthPercent: metric(18),
      netFlowsPercentOfAum: metric(-6),
      effectiveFeeRateBps: metric(18, 25),
      recurringRevenuePercent: metric(75),
      operatingMarginPercent: metric(28),
    },
  },
});
assert.equal(assetManager.evidence.decisionGrade, true);
assert.ok(assetManager.adversarialReview.contradictions.length >= 1);
assert.notEqual(assetManager.decision.action, "buy");

const noEvidenceMove = evaluateSectorSpecialistIntelligence({
  evaluatedAt: NOW,
  company: company({ currentPrice: 40 }),
  baseline: baseline(),
  market: { priceChange1dPercent: -18, sectorChange1dPercent: -2, relativeVolume: 5 },
});
assert.equal(noEvidenceMove.evidence.decisionGrade, false);
assert.equal(noEvidenceMove.decision.foundationPromotionEligible, false);
assert.equal(noEvidenceMove.decision.urgentResearch, true);
assert.ok(noEvidenceMove.decision.reasons.some((item) => /priority signal/i.test(item)));

const staleBank = evaluateSectorSpecialistIntelligence({
  evaluatedAt: NOW,
  company: company(),
  baseline: baseline(),
  evidence: {
    bank: {
      tangibleBookValuePerShare: metric(52, null, { asOf: "2024-01-01T00:00:00.000Z" }),
      returnOnTangibleCommonEquityPercent: metric(16),
      cet1RatioPercent: metric(12),
      netInterestMarginPercent: metric(3.8),
      depositGrowthPercent: metric(4),
      nonperformingLoanPercent: metric(0.8),
      netChargeOffPercent: metric(0.4),
    },
  },
});
assert.equal(staleBank.evidence.decisionGrade, false);
assert.ok(staleBank.evidence.staleCriticalMetrics.includes("tangible_book_value_per_share"));

console.log(JSON.stringify({
  ok: true,
  healthyBank: { action: healthyBank.decision.action, opportunity: healthyBank.decision.opportunityScore },
  stressedBank: stressedBank.decision.action,
  insurer: insurer.decision.action,
  reit: reit.decision.action,
  utilitySell: utilitySell.decision.action,
  utilityContradiction: utilityContradiction.decision.action,
  assetManager: assetManager.decision.action,
  priceMoveCannotSelfPromote: noEvidenceMove.decision.foundationPromotionEligible === false,
  conflictFailsClosed: conflictedBank.evidence.decisionGrade === false,
  staleEvidenceFailsClosed: staleBank.evidence.decisionGrade === false,
}, null, 2));
