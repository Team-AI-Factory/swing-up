import assert from "node:assert/strict";

const { evaluateEvent, evaluateFoundation } = require("../lib/opportunity-engine/engine") as typeof import("../lib/opportunity-engine/engine");

const foundation = {
  ticker: "NVDA",
  company: "NVIDIA Corporation",
  sector: "Technology",
  industry: "Semiconductors",
  observedAt: new Date().toISOString(),
  fiscalPeriod: "test",
  metrics: {
    revenueGrowthYoY: 0.34,
    priorRevenueGrowthYoY: 0.18,
    operatingMargin: 0.55,
    priorOperatingMargin: 0.48,
    netMargin: 0.5,
    freeCashFlowMargin: 0.42,
    cashToLiabilities: 0.8,
    debtToAssets: 0.16,
    sharesGrowthYoY: 0.01,
    returnOnAssets: 0.48,
  },
  valuation: {
    marketCap: 1,
    priceToSales: 12,
    priceToEarnings: 35,
    freeCashFlowYield: 0.04,
    forwardPriceToEarnings: 28,
  },
  market: {
    currentPrice: 100,
    priceChange1d: 1,
    priceChange20d: -4,
    priceChange90d: 8,
    volumeRatio: 1.2,
    priceObservedAt: new Date().toISOString(),
  },
  expectations: {
    analystRevisionScore: 75,
    earningsSurprisePercent: 12,
    consensusRevenueGrowthPercent: 20,
  },
  catalyst: {
    description: "Dated product and earnings proof points",
    expectedAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    confidence: 75,
  },
  receipts: [
    { source: "SEC", url: "https://www.sec.gov/", observedAt: new Date().toISOString(), reliability: "official" as const },
    { source: "Company IR", url: "https://investor.nvidia.com/", observedAt: new Date().toISOString(), reliability: "official" as const },
  ],
  missingFields: [],
  warnings: [],
};

const decision = evaluateFoundation(foundation);
assert.equal(decision.path, "foundation");
assert.ok(decision.scores.opportunityScore >= 0 && decision.scores.opportunityScore <= 100);
assert.equal(decision.pillars.length, 7);
assert.ok(decision.killCriteria.length >= 3);
assert.equal(decision.seriousSignal, false);
assert.equal(decision.userAlertEligible, false);
assert.equal(decision.confidence.seriousSignalEligible, false);
assert.ok(decision.blockedReasons.includes("research_only_requires_current_event_verification_price_anchor_and_full_committee"));
assert.match(decision.actionability, /Historical results are optional context/i);

const historicallyCalibratedResearch = evaluateFoundation({
  ...foundation,
  calibration: {
    horizonDays: 30,
    sampleSize: 100,
    wins: 100,
    losses: 0,
    precision: 1,
    lowerConfidenceBound: 0.99,
    asOf: new Date().toISOString(),
    source: "real historical research outcomes",
    successDefinition: "direction-adjusted research outcome",
  },
});
assert.equal(historicallyCalibratedResearch.seriousSignal, false);
assert.equal(historicallyCalibratedResearch.userAlertEligible, false);
assert.equal(historicallyCalibratedResearch.confidence.seriousSignalEligible, false);

const thesis = {
  id: null,
  ticker: decision.ticker,
  company: decision.company,
  companyStatus: decision.thesisStatus,
  securityReadiness: decision.securityReadiness,
  candidateBucket: decision.candidateBucket,
  opportunityScore: decision.scores.opportunityScore,
  evidenceConfidence: decision.scores.evidenceConfidence,
  riskScore: decision.scores.riskScore,
  originalUnderwriting: decision,
  currentAssessment: decision,
  updatedAt: decision.evaluatedAt,
};

const positiveEvent = {
  rawSignalId: "test-positive",
  ticker: "NVDA",
  signalType: "earnings",
  title: "Company beats and raises guidance",
  summary: "Official company release shows record revenue and margin expansion.",
  source: "Company Investor Relations",
  sourceUrl: "https://investor.nvidia.com/",
  receivedAt: new Date().toISOString(),
  importanceHint: "high",
  payload: {},
};
const positive = evaluateEvent(positiveEvent, thesis);
assert.equal(positive.impact.direction, "confirming");
assert.ok(["thesis_strengthening", "catalyst_alert"].includes(positive.alertType));
assert.equal(positive.seriousSignal, false);
assert.equal(positive.userAlertEligible, false);
assert.ok(positive.blockedReasons.includes("research_only_requires_exact_issuer_causal_mapping_price_anchor_contradiction_checks_and_full_committee"));

const negative = evaluateEvent({
  ...positiveEvent,
  rawSignalId: "test-negative",
  title: "Company cuts guidance after customer loss",
  summary: "Official filing reports margin pressure and an investigation.",
}, thesis);
assert.equal(negative.impact.direction, "disconfirming");
assert.ok(["risk_warning", "thesis_broken"].includes(negative.alertType));
assert.equal(negative.evidence[0]?.path, "event");
assert.equal(negative.seriousSignal, false);
assert.equal(negative.userAlertEligible, false);

console.log(JSON.stringify({
  ok: true,
  foundationBucket: decision.candidateBucket,
  foundationAlert: decision.alertType,
  positiveEventAlert: positive.alertType,
  negativeEventAlert: negative.alertType,
  historyCannotUnlockLegacyResearchPromotion: true,
  currentEventCommitteePathRemainsRequired: true,
  safety: { databaseWrites: false, publishing: false, notifications: false, openAiCalls: false },
}, null, 2));
