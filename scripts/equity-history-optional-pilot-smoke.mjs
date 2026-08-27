import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

function compile(url, dependencies = {}) {
  const source = readFileSync(url, "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (name in dependencies) return dependencies[name];
    throw new Error(`Unexpected import in optional-history smoke: ${name}`);
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
const diligenceReport = () => ({
  version: 1,
  checkedAt: "2026-07-29T06:00:00.000Z",
  marketScope: "US listed common stocks and ADRs only",
  policy: { primarySource: "SEC Company Facts", seriousFoundationBuyRequiresBuyQualityConfirmed: true, seriousFoundationSellRequiresReliableValuationInputs: true, seriousFoundationWatchOutRequiresFundamentalRiskConfirmed: true, directCustomerRetentionDisclosureRequiredWhenAvailable: true, revenueDurabilityIsOnlyAProxy: true, maximumFreshSecCompaniesPerScan: 60, cacheHours: 12, noSyntheticData: true },
  coverage: { catalystCompaniesDiscovered: 0, foundationAlertCompaniesAdded: 0, companiesSelectedThisScan: 0, companiesCompleted: 0, companiesFromCache: 0, companiesUnavailable: 0, catalystCompaniesQueuedForLaterScan: 0 },
  companies: {},
  alertConfirmation: { buy: [], sell: [], watchOut: [], suppressedBuy: [], suppressedSell: [], suppressedWatchOut: [] },
  warehouse: { latestKey: "branch-labs/pr-262/value-investing/catalyst-diligence/latest.json", immutableRunKey: null, persisted: false, errors: [] },
  safety: { publishing: false, notifications: false, trades: false, databaseWrites: false },
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
  "@/lib/opportunity-engine/catalyst-company-diligence": { buildCatalystCompanyDiligence: async () => diligenceReport() },
  "@/lib/opportunity-engine/us-value-investing-engine": { runUsValueInvestingCycle: async () => valueCycle() },
  "@/lib/opportunity-engine/us-value-investing-safety": {
    hardenAndPersistUsValueInvestingCycle: async (raw) => raw,
    persistHardenedUsValueInvestingCycle: async (hardened) => hardened,
  },
});

const eventJobSource = readFileSync(new URL("../lib/opportunity-engine/pr262-event-job.ts", import.meta.url), "utf8");
const runnerSource = readFileSync(new URL("../lib/equity-signal/runner.ts", import.meta.url), "utf8");
const operationsSource = readFileSync(new URL("../lib/opportunity-engine/us-signal-operations.ts", import.meta.url), "utf8");
const consistencySource = readFileSync(new URL("../lib/opportunity-engine/us-serious-signal-consistency.ts", import.meta.url), "utf8");
assert.doesNotMatch(eventJobSource, /&&\s*pilot\.passed\s*===\s*true/);
assert.doesNotMatch(operationsSource, /if\s*\(!pilot\.passed\)\s*continue/);
assert.doesNotMatch(operationsSource, /&&\s*committee\.historicalPilotPassed/);
assert.doesNotMatch(consistencySource, /mandatory Pilot 5 historical gate/);
assert.doesNotMatch(runnerSource, /historical_comparison_required:true/, "Committee risk labels must not quietly reintroduce mandatory history.");
assert.match(runnerSource, /historical_comparison_role:optional_context_only/);

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
assert.equal(fourCases.seriousSignalFound, true);
assert.equal(fourCases.status, "verified_serious_buy");
assert.equal(receivedHistory.length, 2);
assert.deepEqual(fourCases.historicalLearning.publicHistoricalFamiliesBuilt, ["earnings_guidance", "regulatory_approval"]);
assert.equal(fourCases.valueInvesting.methodology.newsRequiredForFoundationAlert, false);
assert.equal(fourCases.liveSourcePolicy.foundationCatalystDiligenceRequired, true);

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

console.log(JSON.stringify({ ok: true, historicalPeerGateMandatory: false, noHistoryCanPassCurrentEvidence: true, publicFamiliesBuilt: ["earnings_guidance", "regulatory_approval"], strongHistoryStillRecordedAsContext: true, ownForwardOutcomeNotRequiredBeforeAlert: true, analystExpectationsCannotVetoBuy: true, headlineOnlyBlocked: true, foundationFairValueCanTriggerWithoutNews: true, foundationCatalystDiligenceRequired: true }, null, 2));
