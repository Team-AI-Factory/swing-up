import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

function compile(url, dependencies = {}) {
  const source = readFileSync(url, "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (name in dependencies) return dependencies[name];
    throw new Error(`Unexpected import in mandatory pilot smoke: ${name}`);
  }, cjsModule, cjsModule.exports);
  return cjsModule.exports;
}

let nextResult = null;
let pilotGate = { passed: false, blockers: ["Need five peer events"], independentRealEventCount: 4, observedDirectionalHitRatePercent: 100 };
let articleDecisionGrade = true;
let receivedHistory = null;
const policy = { marketScope: "active_us_exchange_listed_common_equities_and_adrs", confidenceTier: "pilot_five_independent_cases", minimumIndependentHistoricalEvents: 5, minimumObservedDirectionalHitRatePercent: 80, warning: "Four of five pilot warning" };
const articleReport = () => ({ policyVersion: 1, maximumFullArticlesPerScan: 12, maximumBytesPerArticle: 300000, headlineAloneCanPromoteSeriousSignal: false, candidates: { "EXM|earnings_guidance|2026-07-29T06:00:00.000Z": { key: "EXM|earnings_guidance|2026-07-29T06:00:00.000Z", ticker: "EXM", company: "Example", eventFamily: "earnings_guidance", relationship: "direct", decisionGrade: articleDecisionGrade, basis: articleDecisionGrade ? "full_article" : "headline_only_blocked", fullArticlesRead: articleDecisionGrade ? 1 : 0, supportedArticles: articleDecisionGrade ? 1 : 0, officialStructuredReceipts: 0, failedUrls: [], sourceUrls: [], excerpts: [], blockers: articleDecisionGrade ? [] : ["Full article missing"] } }, diagnostics: { candidatesConsidered: 1, urlsSelected: 1, urlsFetched: articleDecisionGrade ? 1 : 0, urlsSupported: articleDecisionGrade ? 1 : 0, urlsFailed: articleDecisionGrade ? 0 : 1, officialStructuredCandidates: 0 } });
const valueCycle = () => ({
  ok: true,
  checkedAt: "2026-07-29T06:00:00.000Z",
  marketScope: "US listed common stocks and ADRs only",
  methodology: { style: "company_first_conservative_intrinsic_value", analystTargetUsedAsFairValue: false, newsRequiredForFoundationAlert: false, fullFundamentalRefreshMinutes: 15, fullWarehousePersistenceHours: 6, minimumMarginOfSafetyPercent: 25, seriousBuyMinimumUpsidePercent: 40, seriousSellMinimumPremiumPercent: 50, noSyntheticData: true },
  coverage: { provider: "TradingView public US stock scanner", totalProviderRows: 1, usPrimaryListings: 1, companiesAnalyzed: 1, companiesWithFairValue: 1, companiesWithoutFairValue: 0, pagesRequested: 1, pagesFailed: 0, processingCoveragePercent: 100, errors: [] },
  seriousAlerts: { buy: [], sell: [], watchOut: [] },
  watchlists: { qualityWaitingForPrice: [], researchOnly: [] },
  warehouse: { storage: "not_persisted", branchPrefix: "branch-labs/pr-262/value-investing", latestIndexKey: "branch-labs/pr-262/value-investing/latest/index.json", immutableRunKey: null, shardKeys: [], persistedThisCycle: false, companyRecordsStored: 0, errors: [] },
  cacheUsed: false,
  analyses: [],
  safety: { databaseWrites: false, publishing: false, notifications: false, trades: false },
});

const wrapper = compile(new URL("../lib/equity-signal/pilot-runner.ts", import.meta.url), {
  "@/lib/equity-signal/article-evidence": {
    buildArticleEvidenceReport: async () => articleReport(),
    articleEvidenceForCandidate: (report) => Object.values(report.candidates)[0],
  },
  "@/lib/equity-signal/industry-peer-pilot": { evaluateIndustryPeerPilotGate: async () => structuredClone(pilotGate) },
  "@/lib/equity-signal/pilot-historical-bootstrap": {
    bootstrapPilotHistoricalSignals: async () => ({ records: [{ id: "earnings-peer" }], requestedSeeds: 1, builtSeeds: 1, errors: [], priceSource: "public adjusted prices", noSyntheticData: true }),
    mergePilotHistoricalSignals: (...groups) => groups.flat(),
  },
  "@/lib/equity-signal/pilot-regulatory-approval-bootstrap": {
    bootstrapRegulatoryApprovalPeerHistory: async () => ({ records: [{ id: "fda-peer" }], requestedSeeds: 1, builtSeeds: 1, errors: [], eventFamily: "regulatory_approval", priceSource: "public adjusted prices", officialEventSource: "FDA", noSyntheticData: true }),
  },
  "@/lib/equity-signal/pilot-serious-signal-policy": { US_SERIOUS_SIGNAL_PILOT_POLICY: policy },
  "@/lib/equity-signal/runner": {
    runEquitySignalLab: async (input) => { receivedHistory = input.historicalSignals; return structuredClone(nextResult); },
  },
  "@/lib/equity-signal/us-watch-out-engine": { buildApprovedUsWatchOutReview: async () => ({ findings: [], seriousSignals: [] }) },
  "@/lib/equity-signal/us-watch-out-serious-promotion": { promoteApprovedWatchOutRules: ({ watchOutReview }) => ({ ...watchOutReview, seriousSignals: [] }) },
  "@/lib/opportunity-engine/us-value-investing-engine": { runUsValueInvestingCycle: async () => valueCycle() },
  "@/lib/opportunity-engine/us-value-investing-safety": { hardenAndPersistUsValueInvestingCycle: async (raw) => raw },
});

function approved(action = "buy") {
  return {
    ok: true,
    status: `serious_${action}`,
    seriousSignalFound: true,
    actionableSignalFound: true,
    alertType: action,
    blockers: [],
    selectedCandidate: { ticker: "EXM", company: "Example", eventFamily: "earnings_guidance", eventObservedAt: "2026-07-29T06:00:00.000Z", relationship: "direct" },
    rankedCandidates: [],
    historicalLearning: {},
    liveSourcePolicy: {},
    _historicalSignalLibraryAdditions: [{ id: "forward-ledger" }],
  };
}

nextResult = approved("buy");
const fourCases = await wrapper.runPilotEquitySignalLab({ historicalSignals: [] });
assert.equal(fourCases.seriousSignalFound, false);
assert.equal(fourCases.status, "candidate_needs_same_company_or_industry_pilot_history");
assert.equal(receivedHistory.length, 2);
assert.deepEqual(fourCases.historicalLearning.publicHistoricalFamiliesBuilt, ["earnings_guidance", "regulatory_approval"]);
assert.equal(fourCases.valueInvesting.methodology.newsRequiredForFoundationAlert, false);

pilotGate = { passed: true, blockers: [], independentRealEventCount: 5, observedDirectionalHitRatePercent: 80, statisticallyEquivalentToThirtySamples: false };
const fourOfFive = await wrapper.runPilotEquitySignalLab({ historicalSignals: [] });
assert.equal(fourOfFive.seriousSignalFound, true);
assert.equal(fourOfFive.alertType, "buy");
assert.equal(fourOfFive.historicalLearning.minimumObservedDirectionalHitRatePercent, 80);
assert.equal(fourOfFive.historicalLearning.forwardOutcomeRequiredBeforeAlert, false);
assert.equal(fourOfFive.liveSourcePolicy.analystExpectationsCanVetoBuy, false);
assert.equal(fourOfFive.liveSourcePolicy.foundationFairValueCanTriggerImmediately, true);

articleDecisionGrade = false;
const headlineOnly = await wrapper.runPilotEquitySignalLab({ historicalSignals: [] });
assert.equal(headlineOnly.seriousSignalFound, false);
assert.equal(headlineOnly.status, "candidate_needs_full_article_confirmation");

console.log(JSON.stringify({ ok: true, historicalPeerGateMandatory: true, publicFamiliesBuilt: ["earnings_guidance", "regulatory_approval"], fourOfFivePasses: true, ownForwardOutcomeNotRequiredBeforeAlert: true, analystExpectationsCannotVetoBuy: true, headlineOnlyBlocked: true, foundationFairValueCanTriggerWithoutNews: true }, null, 2));
