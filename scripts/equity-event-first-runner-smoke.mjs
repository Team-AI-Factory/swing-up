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
  falsifiers: ["approval withdrawn"],
  timeHorizon: "hours_to_10_trading_days",
  score: 84,
  gateChecks: { verifiedEventTruth: true, reliableTickerMapping: true, materialEvent: true, causalTransmission: true, freshEvidence: true, primaryOrIndependentProof: true, noSevereContradiction: true, notRumour: true },
  gatePassed: true,
  quote: { ticker: "EXM", price: 100, previousClose: 100, changePercent: 0, volume: 1000, averageVolume: null, marketCap: null, observedAt: "2026-07-22T10:00:00.000Z", source: "test live market snapshot", delayedMinutes: 0, providerFetchedAt: "2026-07-22T10:00:00.000Z", cacheAgeMs: 0, actionableForSeriousSignal: true },
  fundamentals: { available: true, sourceUrl: "https://data.sec.gov/example", checkedAt: "2026-07-22T10:00:00.000Z", latestFiledAt: "2026-07-21", fiscalPeriodEnd: "2026-06-30", items: [{ metric: "assets", value: 1000, unit: "USD", filedAt: "2026-07-21", periodEnd: "2026-06-30", form: "10-Q" }], error: null },
  historicalAnalog: { available: false, strength: "missing", summary: "No verified analogue.", sampleSize: 0, source: "none", leakageSafe: true, selectedHorizon: null, medianDirectionAdjustedReturnPercent: null, p25DirectionAdjustedReturnPercent: null, p75DirectionAdjustedReturnPercent: null, conservativeHitProbabilityPercent: 0, marketRelative: null, items: [] },
  priceForecast: { status: "insufficient_history", horizon: null, probabilityDirectionCorrectPercent: null, sampleSize: 0, medianReturnPercent: null, pessimisticReturnPercent: null, optimisticReturnPercent: null, medianPrice: null, lowPrice: null, highPrice: null, forecastExpiresAt: null, basedOnMarketRelativeOutcomes: false, warning: "Not enough real history." },
};

function provider(name) {
  return { provider: name, status: "connected", checkedAt: "2026-07-22T10:00:00.000Z", nextRetryAt: null, sourceUrls: ["https://example.com"], receipts: [receipt], recordsRead: 1, error: null, entitlementVerified: true, cached: false };
}
const haltProvider = { ...provider("nasdaq_trade_halts"), receipts: [], recordsRead: 0 };

const agentResults = Array.from({ length: 13 }, (_, index) => ({ agentId: `agent_${index}`, status: "completed", verdict: "positive", confidence: 82, concerns: [], missingData: [], followUpChecks: [] })).concat({ agentId: "final_judge", status: "completed", verdict: "positive", confidence: 85, concerns: [], missingData: [], followUpChecks: [] });
let committeeCalls = 0;
let quoteActionable = true;
const stubs = {
  "@/lib/ai-committee/orchestrator": { TRUSTED_IN_MEMORY_EVIDENCE: trusted, runAiCommittee: async (input) => {
    committeeCalls += 1;
    return { ok: true, status: "completed", agentResults, plannedAgents: agentResults.map((item) => item.agentId), committeeOutput: { overallRecommendation: "approve", evidenceConfidenceScore: 85, missingEvidence: [] }, compatibility: { writesDatabase: false }, receivedEvidence: input[trusted] };
  } },
  "@/lib/ai-committee/provider": { getAiCommitteeProviderStatus: () => ({ configured: true, enabled: true }) },
  "@/lib/equity-signal/analysis": { buildImpactCandidates: (_receipts, _universe, _macro, _now, historicalSignals = []) => {
    const value = structuredClone(candidate);
    if (historicalSignals.length >= 5) value.historicalAnalog = {
      ...value.historicalAnalog,
      available: true,
      strength: "strong",
      sampleSize: historicalSignals.length,
      selectedHorizon: "7D",
      medianDirectionAdjustedReturnPercent: 2.5,
      p25DirectionAdjustedReturnPercent: 0.8,
      p75DirectionAdjustedReturnPercent: 4,
      weightedHitRatePercent: 80,
      conservativeHitProbabilityPercent: 70,
      marketRelative: { sampleSize: historicalSignals.length, posteriorHitProbabilityPercent: 65 },
      summary: "Independent point-in-time outcomes.",
    };
    return { candidates: [value], diagnostics: { mappedRelationships: 1, eventClusters: 1, directCandidates: 1, rippleCandidates: 0 } };
  }, fingerprintCandidate: () => "event-fingerprint" },
  "@/lib/equity-signal/event-sources": { collectEventSources: async () => ({ providers: [provider("official_events"), haltProvider], receipts: [receipt], secFilingDetails: { selected: 0, enriched: 0, failed: 0 } }) },
  "@/lib/equity-signal/fundamentals": { enrichCandidateFundamentals: async (value) => ({ candidate: value, provider: provider("sec_company_facts") }) },
  "@/lib/equity-signal/historical-bootstrap": {
    bootstrapPublicHistoricalSignals: async () => ({ records: [], provider: provider("public_historical_price_bootstrap"), seedsAvailable: 5, seedsRemaining: 0 }),
    mergeHistoricalSignals: (...groups) => groups.flat(),
  },
  "@/lib/equity-signal/macro": { fetchMacroContext: async () => ({ context: { checkedAt: "2026-07-22T10:00:00.000Z", status: "connected", series: [], regime: ["normal"], historicalComparisonAvailable: false, errors: [] }, provider: { provider: "fred", status: "connected" } }) },
  "@/lib/equity-signal/market": { enrichCandidateQuotes: async (values) => {
    for (const value of values) value.quote = value.quote ? {
      ...value.quote,
      providerFetchedAt: "2026-07-22T10:00:00.000Z",
      cacheAgeMs: quoteActionable ? 0 : 16 * 60 * 1000,
      actionableForSeriousSignal: quoteActionable,
    } : null;
    const benchmarkQuote = { ticker: "SPY", price: 600, previousClose: 600, changePercent: 0, volume: 1000, averageVolume: null, marketCap: null, observedAt: "2026-07-22T10:00:00.000Z", source: "test benchmark", delayedMinutes: 0, providerFetchedAt: "2026-07-22T10:00:00.000Z", cacheAgeMs: 0, actionableForSeriousSignal: true };
    return { candidates: values, provider: provider("market_quote"), marketSnapshot: values.map((value) => value.quote).concat(benchmarkQuote), benchmarkTicker: "SPY", benchmarkQuote };
  } },
  "@/lib/equity-signal/pilot-serious-signal-policy": { evaluateFiveCasePilotGate: (value) => {
    const analog = value?.historicalAnalog ?? {};
    const sample = Number(analog.sampleSize || 0);
    const hitRate = Number(analog.weightedHitRatePercent || analog.hitRatePercent || 0);
    const p25 = typeof analog.p25DirectionAdjustedReturnPercent === "number" ? analog.p25DirectionAdjustedReturnPercent : null;
    const horizon = typeof analog.selectedHorizon === "string" ? analog.selectedHorizon : null;
    const passed = sample >= 5 && hitRate >= 80 && analog.leakageSafe === true && horizon && p25 !== null && p25 >= 0;
    return { passed: Boolean(passed), independentRealEventCount: sample, observedDirectionalHitRatePercent: hitRate, lowerQuartileDirectionAdjustedReturnPercent: p25, selectedHorizon: horizon, blockers: passed ? [] : ["Pilot 5 historical evidence is incomplete."], warning: "Pilot 5 is not equivalent to a 30-plus-sample certificate." };
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

const targetedUniverse = {
  version: 1,
  scope: "active_us_exchange_listed_common_equities_and_adrs",
  constructionMode: "nasdaq_plus_sec",
  refreshedAt: "2026-07-22T10:00:00.000Z",
  entries: [{ ticker: "EXM", name: "Example Corp", exchange: "NASDAQ", cik: "0000000001", aliases: ["Example Corp"], securityType: "common_stock", sourceNames: ["SEC"] }],
  coverage: { nasdaqRows: 1, otherExchangeRows: 0, eligibleEquities: 1, cikMapped: 1, cikMappedPercent: 100, adrCount: 0, excludedByReason: {} },
  sources: [{ name: "SEC exact issuer", url: "https://www.sec.gov/", status: "connected", records: 1, error: null }],
};
const targetedBlockedBeforeAi = await runEquitySignalLab({
  now: new Date("2026-07-22T10:00:00.000Z"),
  allowOpenAi: true,
  requirePilotBeforeOpenAi: true,
  targetedContext: { universe: targetedUniverse, receipts: [receipt], providers: [provider("targeted_full_source"), haltProvider], historicalSignalsComplete: true },
});
assert.equal(targetedBlockedBeforeAi.mode, "pr262_targeted_event_job");
assert.equal(targetedBlockedBeforeAi.status, "candidate_needs_same_company_or_industry_pilot_history");
assert.equal(targetedBlockedBeforeAi.openAiCalled, false);
assert.equal(committeeCalls, 0);

const blockedByPilot = await runEquitySignalLab({ now: new Date("2026-07-22T10:00:00.000Z"), allowOpenAi: true, beforeOpenAiCall: async () => true });
assert.equal(blockedByPilot.seriousSignalFound, false);
assert.equal(blockedByPilot.actionableSignalFound, false);
assert.equal(blockedByPilot.alertType, null);
assert.equal(blockedByPilot.status, "candidate_needs_more_data");
assert.equal(blockedByPilot.historicalPilot.passed, false);
assert.equal(blockedByPilot.selectedCandidate.priceForecast.status, "insufficient_history");
assert.equal(blockedByPilot.historicalLearning.findingsAndLaterOutcomesStoredInR2, true);
assert.equal(blockedByPilot.openAiCalled, true);
assert.equal(blockedByPilot.committee.finalJudge.confidence, 85);
assert.equal(blockedByPilot.databaseWrites, false);
assert.equal(blockedByPilot.publishing, false);
assert.equal(blockedByPilot.notifications, false);
assert.equal(committeeCalls, 1);

const calibratedHistory = Array.from({ length: 20 }, (_, index) => ({
  id: `history-${index}`,
  dataQuality: "real",
  checkpoints: { "1D": { observedAt: "2026-07-21T10:00:00.000Z", returnPercent: 1 } },
  provenance: { origin: index < 15 ? "swing_up_forward_outcome" : "public_historical_bootstrap" },
}));
const calibrated = await runEquitySignalLab({ now: new Date("2026-07-22T10:00:00.000Z"), allowOpenAi: true, historicalSignals: calibratedHistory, beforeOpenAiCall: async () => true });
assert.equal(calibrated.seriousSignalFound, true);
assert.equal(calibrated.actionableSignalFound, true);
assert.equal(calibrated.alertType, "buy");
assert.equal(calibrated.historicalPilot.passed, true);
assert.equal(calibrated.selectedCandidate.priceForecast.status, "calibrated");
assert.equal(calibrated.selectedCandidate.priceForecast.horizon, "7D");
assert.equal(calibrated.historicalLearning.realPointInTimeSignalsAvailable, 20);
assert.equal(calibrated.historicalLearning.swingUpForwardSignalsAvailable, 15);
assert.equal(calibrated.historicalLearning.publicBootstrapSignalsAvailable, 5);
assert.equal(committeeCalls, 2);

quoteActionable = false;
const staleQuoteWatch = await runEquitySignalLab({
  now: new Date("2026-07-22T10:16:00.000Z"),
  allowOpenAi: true,
  requirePilotBeforeOpenAi: true,
  historicalSignals: calibratedHistory,
  beforeOpenAiCall: async () => true,
  targetedContext: { universe: targetedUniverse, receipts: [receipt], providers: [provider("targeted_full_source"), haltProvider], historicalSignalsComplete: true },
});
assert.equal(staleQuoteWatch.seriousSignalFound, false);
assert.equal(staleQuoteWatch.actionableSignalFound, false);
assert.equal(staleQuoteWatch.alertType, null);
assert.equal(staleQuoteWatch.openAiCalled, false);
assert.equal(staleQuoteWatch.status, "qualified_event_watch_only");
assert.equal(staleQuoteWatch.selectedCandidate.quote.actionableForSeriousSignal, false);
assert.equal(staleQuoteWatch.selectedCandidate.quote.cacheAgeMs, 16 * 60 * 1000);
assert.equal(committeeCalls, 2);
quoteActionable = true;

const unknownHaltState = await runEquitySignalLab({
  now: new Date("2026-07-22T10:00:00.000Z"),
  allowOpenAi: true,
  requirePilotBeforeOpenAi: true,
  historicalSignals: calibratedHistory,
  beforeOpenAiCall: async () => true,
  targetedContext: { universe: targetedUniverse, receipts: [receipt], providers: [provider("targeted_full_source")], historicalSignalsComplete: true },
});
assert.equal(unknownHaltState.seriousSignalFound, false);
assert.equal(unknownHaltState.actionableSignalFound, false);
assert.equal(unknownHaltState.alertType, null);
assert.equal(unknownHaltState.openAiCalled, false);
assert.equal(unknownHaltState.status, "qualified_event_watch_only");
assert.equal(unknownHaltState.selectedCandidate.quote.marketSession, "unknown");
assert.equal(unknownHaltState.tradingHaltSafety.currentStateKnown, false);
assert.equal(committeeCalls, 2);

console.log(JSON.stringify({ ok: true, eventQualifiedAtZeroPercentMove: true, cryptoDisabled: true, priorMoveNotRequired: true, strictCommitteeStillRequired: true, pilotFiveBlocksWithoutHistory: true, targetedPilotGateRunsBeforePaidCommittee: true, staleQuoteCannotBecomeActionable: true, unknownHaltStateForcesWatch: true, historyStillStoredAndRefined: true, buyAfterPilotHistory: true, noWritesOrPublishing: true }, null, 2));
