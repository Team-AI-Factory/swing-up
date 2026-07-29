import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/equity-signal/runner.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const trusted = Symbol("trusted-evidence");

const receipt = {
  id: "official-1",
  title: "Example Corp receives material regulatory approval",
  summary: "The regulator approved the company product.",
  url: "https://regulator.example/approval",
  publisher: "Official Regulator",
  publishedAt: "2026-07-22T10:00:00.000Z",
  channel: "federal_register",
  official: true,
  primarySource: true,
  scheduled: false,
  symbolHints: ["EXM"],
  companyHints: ["Example Corp"],
  rawEventType: "approval",
};

const candidate = {
  ticker: "EXM",
  company: "Example Corp",
  cik: "0000000001",
  rootEventKey: "root-event",
  eventFamily: "regulatory_approval",
  direction: "upside",
  relationship: "direct",
  eventHeadline: receipt.title,
  whatHappened: "Official approval was published.",
  eventObservedAt: receipt.publishedAt,
  receipts: [receipt],
  primarySource: true,
  independentPublishers: 1,
  mappingConfidence: 100,
  eventTruth: 96,
  materiality: 92,
  transmissionConfidence: 94,
  historicalSupport: 30,
  evidenceIndependence: 88,
  contradictionPenalty: 0,
  pricedInPenalty: 0,
  rumour: false,
  causalChain: ["approval", "commercial access", "revenue opportunity"],
  causalExposure: { status: "direct_issuer", exposureType: "direct", confidence: 100, evidenceText: "Exact issuer event.", sourceUrl: receipt.url, eligibleForSeriousSignal: true },
  eventMagnitude: { status: "not_required", metrics: [], relativeToCompany: null, materialityBasis: "Categorical approval." },
  falsifiers: ["approval withdrawn"],
  timeHorizon: "hours_to_10_trading_days",
  score: 84,
  gateChecks: { verifiedEventTruth: true, reliableTickerMapping: true, materialEvent: true, causalTransmission: true, freshEvidence: true, primaryOrIndependentProof: true, noSevereContradiction: true, notRumour: true, knockOnCausalPathVerified: true, eventMagnitudeActionable: true, currentEvidenceScoreAtLeast72: true, historicalComparisonRequired: false },
  gatePassed: true,
  trackingDisposition: "qualified",
  failedGateChecks: [],
  quote: { ticker: "EXM", price: 100, previousClose: 100, changePercent: 0, volume: 1000, averageVolume: null, marketCap: null, observedAt: "2026-07-22T10:00:00.000Z", source: "test live market snapshot", delayedMinutes: 0 },
  fundamentals: { available: true, sourceUrl: "https://data.sec.gov/example", checkedAt: "2026-07-22T10:00:00.000Z", latestFiledAt: "2026-07-21", fiscalPeriodEnd: "2026-06-30", items: [{ metric: "assets", value: 1000, unit: "USD", filedAt: "2026-07-21", periodEnd: "2026-06-30", form: "10-Q" }], error: null },
  historicalAnalog: { available: false, strength: "missing", summary: "No verified analogue.", sampleSize: 0, source: "none", leakageSafe: true, selectedHorizon: null, medianDirectionAdjustedReturnPercent: null, p25DirectionAdjustedReturnPercent: null, p75DirectionAdjustedReturnPercent: null, conservativeHitProbabilityPercent: 0, marketRelative: null, items: [] },
  priceForecast: { status: "insufficient_history", horizon: null, probabilityDirectionCorrectPercent: null, sampleSize: 0, medianReturnPercent: null, pessimisticReturnPercent: null, optimisticReturnPercent: null, medianPrice: null, lowPrice: null, highPrice: null, forecastExpiresAt: null, basedOnMarketRelativeOutcomes: false, warning: "Not enough real history." },
};

function provider(name) {
  return { provider: name, status: "connected", checkedAt: "2026-07-22T10:00:00.000Z", nextRetryAt: null, sourceUrls: ["https://example.com"], receipts: [receipt], recordsRead: 1, error: null, entitlementVerified: true, cached: false };
}

const agentResults = Array.from({ length: 13 }, (_, index) => ({ agentId: `agent_${index}`, status: "completed", verdict: "positive", confidence: 82, concerns: [], missingData: [], followUpChecks: [] })).concat({ agentId: "final_judge", status: "completed", verdict: "positive", confidence: 85, concerns: [], missingData: [], followUpChecks: [] });
const committeePacks = [];
const fundamentalsCandidates = [];
const failedFundamentalsTickers = new Set();
let candidateFixtures = [candidate];
const stubs = {
  "@/lib/ai-committee/orchestrator": { TRUSTED_IN_MEMORY_EVIDENCE: trusted, runAiCommittee: async (input) => {
    committeePacks.push(structuredClone(input[trusted]));
    return { ok: true, status: "completed", agentResults, plannedAgents: agentResults.map((item) => item.agentId), committeeOutput: { overallRecommendation: "approve", evidenceConfidenceScore: 85, missingEvidence: [] }, compatibility: { writesDatabase: false }, receivedEvidence: input[trusted] };
  } },
  "@/lib/ai-committee/provider": { getAiCommitteeProviderStatus: () => ({ configured: true, enabled: true }) },
  "@/lib/equity-signal/analysis": { buildImpactCandidates: (_receipts, _universe, _macro, _now, historicalSignals = []) => {
    const values = structuredClone(candidateFixtures);
    for (const value of values) {
      if (historicalSignals.length >= 20) value.historicalAnalog = { ...value.historicalAnalog, available: true, strength: "strong", sampleSize: 20, selectedHorizon: "7D", medianDirectionAdjustedReturnPercent: 2.5, p25DirectionAdjustedReturnPercent: 0.8, p75DirectionAdjustedReturnPercent: 4, conservativeHitProbabilityPercent: 70, marketRelative: { sampleSize: 20, posteriorHitProbabilityPercent: 65 }, summary: "Twenty independent point-in-time outcomes." };
    }
    return {
      candidates: values,
      findingAuditLedger: values.map((value) => ({ ticker: value.ticker, rootEventKey: value.rootEventKey, trackingDisposition: value.trackingDisposition, receiptIds: [receipt.id] })),
      findingReceiptProofDictionary: { [receipt.id]: { id: receipt.id, title: receipt.title, summary: receipt.summary, publisher: receipt.publisher, url: receipt.url, publishedAt: receipt.publishedAt, channel: receipt.channel, official: receipt.official, primarySource: receipt.primarySource } },
      diagnostics: { mappedRelationships: values.length, eventClusters: values.length, directCandidates: values.length, rippleCandidates: 0 },
    };
  }, fingerprintCandidate: (value) => `event-${value.rootEventKey}`, reassessCandidateAfterFundamentals: (value) => value },
  "@/lib/equity-signal/event-sources": { collectEventSources: async () => ({ providers: [provider("official_events")], receipts: [receipt], secFilingDetails: { selected: 0, enriched: 0, failed: 0 } }) },
  "@/lib/equity-signal/fundamentals": { enrichCandidateFundamentals: async (value) => {
    fundamentalsCandidates.push(value?.ticker ?? null);
    const result = provider("sec_company_facts");
    if (value && failedFundamentalsTickers.has(value.ticker)) {
      result.status = "temporarily_unavailable";
      result.error = `sec_timeout_${value.ticker}`;
      result.recordsRead = 0;
    }
    return { candidate: value, provider: result };
  } },
  "@/lib/equity-signal/historical-bootstrap": {
    bootstrapPublicHistoricalSignals: async () => ({ records: [], provider: provider("public_historical_price_bootstrap"), seedsAvailable: 5, seedsRemaining: 0 }),
    mergeHistoricalSignals: (...groups) => groups.flat(),
  },
  "@/lib/equity-signal/macro": { fetchMacroContext: async () => ({ context: { checkedAt: "2026-07-22T10:00:00.000Z", status: "connected", series: [], regime: ["normal"], historicalComparisonAvailable: false, errors: [] }, provider: { provider: "fred", status: "connected" } }) },
  "@/lib/equity-signal/market": { enrichCandidateQuotes: async (values, _fetchImpl, _now, maximum = 3) => {
    for (const value of values) value.quote = null;
    const shortlisted = [
      ...values.filter((value) => value.gatePassed).slice(0, maximum),
      ...values.filter((value) => value.trackingDisposition === "shadow_near_miss").slice(0, 2),
    ];
    for (const value of shortlisted) value.quote = { ...candidate.quote, ticker: value.ticker };
    return {
      candidates: values,
      provider: provider("market_quote"),
      marketSnapshot: shortlisted.map((value) => value.quote).concat({ ticker: "SPY", price: 600, observedAt: "2026-07-22T10:00:00.000Z", source: "test benchmark" }),
      benchmarkTicker: "SPY",
      benchmarkQuote: { ticker: "SPY", price: 600, previousClose: 600, changePercent: 0, volume: 1000, averageVolume: null, marketCap: null, observedAt: "2026-07-22T10:00:00.000Z", source: "test benchmark", delayedMinutes: 0 },
    };
  } },
  "@/lib/equity-signal/universe": { loadEquityUniverse: async () => ({ snapshot: { scope: "active_us_exchange_listed_common_equities_and_adrs", refreshedAt: "2026-07-22T10:00:00.000Z", entries: [{ ticker: "EXM" }], coverage: { eligibleEquities: 7000 }, sources: [] }, cache: "test", refreshed: false, r2Write: false }) },
};
const cjsModule = { exports: {} };
const localRequire = (name) => {
  if (name === "node:crypto") return awaitImportCrypto;
  if (name in stubs) return stubs[name];
  throw new Error(`Unexpected runner import: ${name}`);
};
const awaitImportCrypto = { createHash: () => ({ update() { return this; }, digest: () => "0123456789abcdef0123456789abcdef" }) };
new Function("require", "module", "exports", output)(localRequire, cjsModule, cjsModule.exports);
const { runEquitySignalLab } = cjsModule.exports;

const held = await runEquitySignalLab({ now: new Date("2026-07-22T10:00:00.000Z"), allowOpenAi: false });
assert.equal(held.assetClass, "public_equity");
assert.equal(held.liveSourcePolicy.cryptoScanningEnabled, false);
assert.equal(held.liveSourcePolicy.priorTwoPercentMoveRequired, false);
assert.equal(held.liveSourcePolicy.postEventOnePercentMoveRequired, false);
assert.equal(held.selectedCandidate.quote.changePercent, 0);
assert.equal(held.status, "qualified_signal_openai_not_requested");
assert.equal(held.mappedFindingReceiptProofDictionary[receipt.id].title, receipt.title);

const approved = await runEquitySignalLab({ now: new Date("2026-07-22T10:00:00.000Z"), allowOpenAi: true, beforeOpenAiCall: async () => true });
assert.equal(approved.seriousSignalFound, true);
assert.equal(approved.alertType, "buy");
assert.equal(approved.actionableSignalFound, true);
assert.equal(approved.selectedCandidate.priceForecast.status, "insufficient_history");
assert.equal(approved.historicalLearning.historicalComparisonRequiredForSeriousSignal, false);
assert.equal(approved.historicalLearning.findingsAndLaterOutcomesStoredInR2, true);
assert.equal(approved.openAiCalled, true);
assert.equal(approved.committee.finalJudge.confidence, 85);
assert.equal(approved.databaseWrites, false);
assert.equal(approved.publishing, false);
assert.equal(approved.notifications, false);

const calibratedHistory = Array.from({ length: 20 }, (_, index) => ({
  id: `history-${index}`,
  dataQuality: "real",
  provenance: { origin: index < 15 ? "swing_up_forward_outcome" : "public_historical_bootstrap" },
}));
const calibrated = await runEquitySignalLab({ now: new Date("2026-07-22T10:00:00.000Z"), allowOpenAi: true, historicalSignals: calibratedHistory, beforeOpenAiCall: async () => true });
assert.equal(calibrated.seriousSignalFound, true);
assert.equal(calibrated.actionableSignalFound, true);
assert.equal(calibrated.alertType, "buy");
assert.equal(calibrated.selectedCandidate.priceForecast.status, "calibrated");
assert.equal(calibrated.selectedCandidate.priceForecast.horizon, "7D");
assert.equal(calibrated.historicalLearning.realPointInTimeSignalsAvailable, 20);
assert.equal(calibrated.historicalLearning.swingUpForwardSignalsAvailable, 15);
assert.equal(calibrated.historicalLearning.publicBootstrapSignalsAvailable, 5);
assert.deepEqual(committeePacks[0], committeePacks[1]);
assert.equal(committeePacks[0].historicalPatternMatch.available, false);
assert.equal(committeePacks[0].previousSimilarOutcomes.items.length, 0);
assert.equal(committeePacks[0].score.historicalSupport, 0);

fundamentalsCandidates.length = 0;
failedFundamentalsTickers.add("SHD");
candidateFixtures = [
  {
    ...candidate,
    ticker: "SHD",
    company: "Shadow Corp",
    rootEventKey: "root-shadow",
    score: 95,
    gatePassed: false,
    trackingDisposition: "shadow_near_miss",
    failedGateChecks: ["eventMagnitudeActionable"],
    gateChecks: { ...candidate.gateChecks, eventMagnitudeActionable: false },
    eventMagnitude: { status: "absolute_only", metrics: [{ kind: "contract_value", value: 1_000_000, unit: "USD", sourceReceiptId: receipt.id, sourceUrl: receipt.url, evidenceText: "contract valued at $1 million", eventStatus: "committed" }], relativeToCompany: null, materialityBasis: "Awaiting company scale." },
    quote: { ...candidate.quote, ticker: "SHD" },
  },
  { ...candidate, score: 84 },
];
const skipImmaterial = await runEquitySignalLab({ now: new Date("2026-07-22T10:00:00.000Z"), allowOpenAi: true, beforeOpenAiCall: async () => true });
assert.equal(skipImmaterial.selectedCandidate.ticker, "EXM");
assert.equal(skipImmaterial.shadowOutcomeTrackingCandidates.length, 1);
assert.deepEqual(fundamentalsCandidates.sort(), ["EXM", "SHD"]);
assert.equal(skipImmaterial.fundamentalsCandidateChecks.find((item) => item.ticker === "SHD")?.status, "temporarily_unavailable");
assert.equal(committeePacks.at(-1).sourceHealth.find((item) => item.source === "sec_company_facts")?.status, "connected");
assert.equal(committeePacks.at(-1).sourceHealth.some((item) => item.problem === "sec_timeout_SHD"), false);

candidateFixtures = [
  { ...candidate, rootEventKey: "same-ticker-event-a", eventHeadline: "Older reviewed event", score: 90 },
  { ...candidate, rootEventKey: "same-ticker-event-b", eventHeadline: "Distinct fresh event", score: 85 },
];
const distinctSameTicker = await runEquitySignalLab({
  now: new Date("2026-07-22T10:00:00.000Z"),
  allowOpenAi: true,
  skipOpenAiCandidateFingerprints: ["event-same-ticker-event-a"],
  beforeOpenAiCall: async () => true,
});
assert.equal(distinctSameTicker.selectedCandidate.rootEventKey, "same-ticker-event-b");
assert.equal(distinctSameTicker.openAiCalled, true);

candidateFixtures = [
  { ...candidate, ticker: "AAA", rootEventKey: "cooldown-a", score: 100, quote: { ...candidate.quote, ticker: "AAA" } },
  { ...candidate, ticker: "BBB", rootEventKey: "cooldown-b", score: 99, quote: { ...candidate.quote, ticker: "BBB" } },
  { ...candidate, ticker: "CCC", rootEventKey: "cooldown-c", score: 98, quote: { ...candidate.quote, ticker: "CCC" } },
  { ...candidate, ticker: "DDD", rootEventKey: "fresh-d", score: 97, quote: { ...candidate.quote, ticker: "DDD" } },
];
const cooldownDoesNotStarveFreshEvent = await runEquitySignalLab({
  now: new Date("2026-07-22T10:00:00.000Z"),
  allowOpenAi: true,
  skipOpenAiCandidateFingerprints: ["event-cooldown-a", "event-cooldown-b", "event-cooldown-c"],
  beforeOpenAiCall: async () => true,
});
assert.equal(cooldownDoesNotStarveFreshEvent.selectedCandidate.rootEventKey, "fresh-d");
assert.equal(cooldownDoesNotStarveFreshEvent.selectedCandidate.quote.ticker, "DDD");
assert.equal(cooldownDoesNotStarveFreshEvent.openAiCalled, true);

console.log(JSON.stringify({ ok: true, eventQualifiedAtZeroPercentMove: true, cryptoDisabled: true, priorMoveNotRequired: true, strictCommitteeStillRequired: true, buyWithoutHistoricalComparison: true, committeeDecisionInvariantToHistory: true, historyStillStoredAndRefined: true, buyAfterCalibration: true, higherRankedImmaterialCandidateSkipped: true, shadowNearMissTrackedSeparately: true, noWritesOrPublishing: true }, null, 2));
