import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
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
let committeeThrows = false;
let committeeFails = false;
let quoteActionable = true;
let candidateGatePassed = true;
const stubs = {
  "@/lib/ai-committee/orchestrator": { TRUSTED_IN_MEMORY_EVIDENCE: trusted, runAiCommittee: async (input) => {
    committeeCalls += 1;
    if (committeeThrows) throw new Error("provider_response_parse_failed");
    if (committeeFails) return { ok: false, status: "agent_failures", agentResults: agentResults.map((result, index) => ({ ...result, status: index === 0 ? "failed" : "blocked", verdict: "mixed", confidence: 0, error: index === 0 ? "provider_error" : "provider_review_stopped", providerFailure: { category: "quota", httpStatus: 429, code: "insufficient_quota", stopRemainingAgents: true } })), plannedAgents: agentResults.map(result => result.agentId), committeeOutput: { overallRecommendation: "needs_more_data", missingEvidence: [] }, compatibility: { writesDatabase: false } };
    return { ok: true, status: "completed", agentResults, plannedAgents: agentResults.map((item) => item.agentId), committeeOutput: { overallRecommendation: "approve", evidenceConfidenceScore: 85, missingEvidence: [] }, compatibility: { writesDatabase: false }, receivedEvidence: input[trusted] };
  } },
  "@/lib/ai-committee/provider": { getAiCommitteeProviderStatus: () => ({ configured: true, enabled: true }) },
  "@/lib/equity-signal/analysis": { buildImpactCandidates: (_receipts, _universe, _macro, _now, historicalSignals = []) => {
    const value = structuredClone(candidate);
    value.gatePassed = candidateGatePassed;
    value.trackingDisposition = candidateGatePassed ? "qualified" : "rejected";
    value.failedGateChecks = candidateGatePassed ? [] : ["eventMagnitudeActionable"];
    value.gateChecks.eventMagnitudeActionable = candidateGatePassed;
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
    return { candidates: [value], diagnostics: { receiptsConsidered: 1, noiseRejected: 0, directionUnknown: 0, unmapped: 0, mappedRelationships: 1, eventClusters: 1, directCandidates: 1, rippleCandidates: 0 } };
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
      cacheAgeMs: 0,
      quoteAgeMs: quoteActionable ? 0 : 16 * 60 * 1000,
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
  if (["@/lib/company-profile", "@/lib/signal-explanation", "@/lib/equity-signal/valuation-candidate"].includes(name)) return loadTsModule(name);
  throw new Error(`Unexpected runner import: ${name}`);
};
const awaitImportCrypto = { createHash: () => ({ update() { return this; }, digest: () => "0123456789abcdef0123456789abcdef" }) };
new Function("require", "module", "exports", output)(localRequire, cjsModule, cjsModule.exports);
const runEquitySignalLab = input => cjsModule.exports.runEquitySignalLab({
  resolveCompanyProfile: async identity => companyProfileFixture(identity, input.now),
  ...input,
});

const held = await runEquitySignalLab({ now: new Date("2026-07-22T10:00:00.000Z"), allowOpenAi: false });
assert.equal(held.assetClass, "public_equity");
assert.equal(held.liveSourcePolicy.cryptoScanningEnabled, false);
assert.equal(held.liveSourcePolicy.priorTwoPercentMoveRequired, false);
assert.equal(held.liveSourcePolicy.postEventOnePercentMoveRequired, false);
assert.equal(held.selectedCandidate.quote.changePercent, 0);
assert.equal(held.status, "qualified_signal_openai_not_requested");

candidateGatePassed = false;
const rejected = await runEquitySignalLab({ now: new Date("2026-07-22T10:00:00.000Z"), allowOpenAi: true });
assert.equal(rejected.status, "no_qualified_signal");
assert.equal(rejected.noSignalReason, "permission_gate_failed:eventMagnitudeActionable");
assert.equal(rejected.candidateFunnel.receiptsConsidered, 1);
assert.equal(rejected.candidateFunnel.rejectedCandidates, 1);
assert.equal(rejected.candidateFunnel.failedGateCounts.eventMagnitudeActionable, 1);
candidateGatePassed = true;

const targetedUniverse = {
  version: 1,
  scope: "active_us_exchange_listed_common_equities_and_adrs",
  constructionMode: "nasdaq_plus_sec",
  refreshedAt: "2026-07-22T10:00:00.000Z",
  entries: [{ ticker: "EXM", name: "Example Corp", exchange: "NASDAQ", cik: "0000000001", aliases: ["Example Corp"], securityType: "common_stock", sourceNames: ["SEC"] }],
  coverage: { nasdaqRows: 1, otherExchangeRows: 0, eligibleEquities: 1, cikMapped: 1, cikMappedPercent: 100, adrCount: 0, excludedByReason: {} },
  sources: [{ name: "SEC exact issuer", url: "https://www.sec.gov/", status: "connected", records: 1, error: null }],
};
const targetedWithoutHistory = await runEquitySignalLab({
  now: new Date("2026-07-22T10:00:00.000Z"),
  allowOpenAi: true,
  requirePilotBeforeOpenAi: true,
  targetedContext: { universe: targetedUniverse, receipts: [receipt], providers: [provider("targeted_full_source"), haltProvider], historicalSignalsComplete: true },
});
assert.equal(targetedWithoutHistory.mode, "pr262_targeted_event_job");
assert.equal(targetedWithoutHistory.status, "serious_buy");
assert.equal(targetedWithoutHistory.openAiCalled, true);
assert.equal(targetedWithoutHistory.seriousSignalFound, true);
assert.equal(targetedWithoutHistory.historicalLearning.historicalComparisonRequiredForSeriousSignal, false);
assert.equal(committeeCalls, 1);

const optionalHistory = await runEquitySignalLab({ now: new Date("2026-07-22T10:00:00.000Z"), allowOpenAi: true, beforeOpenAiCall: async () => true });
assert.equal(optionalHistory.seriousSignalFound, true);
assert.equal(optionalHistory.actionableSignalFound, true);
assert.equal(optionalHistory.alertType, "buy");
assert.equal(optionalHistory.status, "serious_buy");
assert.equal(optionalHistory.historicalPilot.passed, false);
assert.equal(optionalHistory.selectedCandidate.priceForecast.status, "insufficient_history");
assert.equal(optionalHistory.historicalLearning.findingsAndLaterOutcomesStoredInR2, true);
assert.equal(optionalHistory.historicalLearning.actionableBuySellRequiresCalibratedHistory, false);
assert.equal(optionalHistory.openAiCalled, true);
assert.equal(optionalHistory.committee.finalJudge.confidence, 85);
assert.equal(optionalHistory.databaseWrites, false);
assert.equal(optionalHistory.publishing, false);
assert.equal(optionalHistory.notifications, false);
assert.equal(committeeCalls, 2);

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
assert.equal(committeeCalls, 3);

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
assert.equal(staleQuoteWatch.selectedCandidate.quote.cacheAgeMs, 0);
assert.equal(staleQuoteWatch.selectedCandidate.quote.quoteAgeMs, 16 * 60 * 1000);
assert.match(staleQuoteWatch.blockers[0], /market observation is 16 minutes old and the provider response is 0 minutes old/);
assert.equal(committeeCalls, 3);
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
assert.equal(committeeCalls, 3);

committeeThrows = true;
const paidCommitteeFailure = await runEquitySignalLab({
  now: new Date("2026-07-22T10:00:00.000Z"),
  allowOpenAi: true,
  beforeOpenAiCall: async () => true,
  targetedContext: { universe: targetedUniverse, receipts: [receipt], providers: [provider("targeted_full_source"), haltProvider], historicalSignalsComplete: true },
});
assert.equal(paidCommitteeFailure.ok, false);
assert.equal(paidCommitteeFailure.openAiCalled, true, "A failure after paid-committee admission must retain the cost reservation.");
assert.equal(paidCommitteeFailure.candidateFingerprint, "event-fingerprint");
committeeThrows = false;


const researchInput = {
  now: new Date("2026-07-22T10:00:00.000Z"), allowOpenAi: true, allowIncompleteCommitteeReview: true,
  beforeOpenAiCall: async () => true,
  targetedContext: { universe: targetedUniverse, receipts: [receipt], providers: [provider("targeted_full_source"), haltProvider], historicalSignalsComplete: true },
};
const originalCandidate = structuredClone(candidate);
const restore = () => { Object.assign(candidate, structuredClone(originalCandidate)); candidateGatePassed = true; quoteActionable = true; };
const heldResearch = async (label, change, overrides = {}) => {
  restore(); change();
  const result = await runEquitySignalLab({ ...researchInput, ...overrides });
  assert.equal(result.openAiCalled, true, `${label} must reach Committee`);
  assert.equal(result.seriousSignalFound, false, `${label} must not become an alert even if mocked Committee approves`);
  assert.equal(result.alertType, null);
  assert.equal(result.researchReview.publicationHeld, true);
  assert.ok(result.researchReview.gaps.length > 0);
  return result;
};
await heldResearch("stale price", () => { quoteActionable = false; });
await heldResearch("missing price", () => { candidate.quote = null; });
await heldResearch("unknown halt state", () => {}, { targetedContext: { ...researchInput.targetedContext, providers: [provider("targeted_full_source")] } });
await heldResearch("partial source", () => {}, { targetedContext: { ...researchInput.targetedContext, sourceEvidenceIncomplete: true } });
await heldResearch("materiality near miss", () => {
  candidateGatePassed = false; candidate.score = 60; candidate.materiality = 55;
  candidate.receipts[0].summary = "A documented issuer event has an uncertain financial effect. ".repeat(6);
});
const unresolved = await heldResearch("unknown direction", () => {
  candidateGatePassed = false; candidate.direction = "unknown";
  candidate.receipts[0].summary = "The company published an earnings range without a prior comparison. ".repeat(5);
});
assert.equal(unresolved.selectedCandidate.direction, "unknown", "Unresolved must never be silently relabelled upside");
await heldResearch("generic issuer event at the research boundary", () => {
  candidateGatePassed = false; candidate.direction = "unknown";
  candidate.eventFamily = "other_material"; candidate.materiality = 45; candidate.score = 55;
  candidate.receipts[0].summary = "The issuer reports operating changes with uncertain financial effects. ".repeat(5);
});
restore();
candidateGatePassed = false; candidate.mappingConfidence = 70;
candidate.receipts[0].summary = "Substantive source text with an ambiguous issuer. ".repeat(6);
const ambiguous = await runEquitySignalLab(researchInput);
assert.equal(ambiguous.openAiCalled, false, "Wrong-company risk must still block admission");
restore(); candidateGatePassed = false;
const headlineOnly = await runEquitySignalLab(researchInput);
assert.equal(headlineOnly.openAiCalled, false, "A headline alone must not consume a full Committee");
restore();
const reservationDenied = await runEquitySignalLab({ ...researchInput, beforeOpenAiCall: async () => false });
assert.equal(reservationDenied.openAiCalled, false, "Research cannot bypass the shared spending reservation");
const duplicate = await runEquitySignalLab({ ...researchInput, skipOpenAiCandidateFingerprints: ["event-fingerprint"] });
assert.equal(duplicate.openAiCalled, false);
const ready = await runEquitySignalLab(researchInput);
assert.equal(ready.status, "serious_buy", "Complete current evidence retains its approved publication route");
committeeFails = true;
const providerFailure = await runEquitySignalLab(researchInput);
assert.equal(providerFailure.status, "committee_failed", "A zero-role provider failure must not masquerade as missing investment evidence");
assert.equal(providerFailure.seriousSignalFound, false);
assert.equal(providerFailure.openAiCalled, true, "Provider failure keeps conservative accounting until reconciled");
assert.equal(providerFailure.committee.agentsCompleted, 0);
assert.equal(providerFailure.committee.agentsFailed, 14);
assert.equal(providerFailure.committee.roleDiagnostics[0].providerFailure.httpStatus, 429);
assert.equal(providerFailure.failureScope, "external_provider");
assert.equal(providerFailure.technicalFailureFingerprint, "committee_agent_failures");
assert.match(providerFailure.blockers[0], /quota \(HTTP 429\) \/ insufficient_quota/);
committeeFails = false;
restore();
const recentHaltSnapshot = { ...haltProvider, status: "not_due", cached: true, cacheAgeMs: 5 * 60_000 };
const cachedHaltInput = { ...researchInput, targetedContext: { ...researchInput.targetedContext,
  providers: [provider("targeted_full_source"), recentHaltSnapshot] } };
const cachedHaltReady = await runEquitySignalLab(cachedHaltInput);
assert.equal(cachedHaltReady.status, "serious_buy", "A recent authoritative empty snapshot survives a cadence deferral");
restore();
const expiredHalt = await runEquitySignalLab({ ...cachedHaltInput, targetedContext: { ...cachedHaltInput.targetedContext,
  providers: [provider("targeted_full_source"), { ...recentHaltSnapshot, cacheAgeMs: 15 * 60_000 + 1 }] } });
assert.equal(expiredHalt.seriousSignalFound, false, "An expired halt snapshot cannot authorize publication");
restore();
const activeHalt = await runEquitySignalLab({ ...cachedHaltInput, targetedContext: { ...cachedHaltInput.targetedContext,
  receipts: [...cachedHaltInput.targetedContext.receipts, { ...receipt, id: "retained-active-halt", channel: "nasdaq_trade_halts",
    symbolHints: [candidate.ticker], rawEventType: "halt:REGULATORY:active" }] } });
assert.equal(activeHalt.seriousSignalFound, false, "A retained active halt always blocks publication");
assert.equal(activeHalt.selectedCandidate.quote.marketSession, "halted");
restore();
let blockedReservations = 0;
const callsBeforeAccessBlock = committeeCalls;
const accessBlocked = await runEquitySignalLab({ ...researchInput, allowOpenAi: false, aiProviderBlockedReason: "authentication", beforeOpenAiCall: async () => { blockedReservations++; return true; } });
assert.equal(accessBlocked.status, "committee_provider_access_blocked");
assert.equal(accessBlocked.openAiCalled, false);
assert.equal(accessBlocked.seriousSignalFound, false);
assert.equal(committeeCalls, callsBeforeAccessBlock, "Known inaccessible provider must receive zero paid requests");
assert.equal(blockedReservations, 0);
assert.equal(accessBlocked.selectedCandidate.ticker, "EXM", "Unpaid evidence processing must still produce a candidate");
assert.equal(accessBlocked.committee.providerBlockedReason, "authentication");
const missingProfile = await runEquitySignalLab({ ...researchInput, resolveCompanyProfile: async () => null });
assert.equal(missingProfile.status, "candidate_company_profile_pending");
assert.equal(missingProfile.openAiCalled, false, "Unverified products and customers must block paid review and publication");
assert.equal(missingProfile.seriousSignalFound, false);
const wrongIssuerProfile = await runEquitySignalLab({ ...researchInput, resolveCompanyProfile: async identity => companyProfileFixture({ ...identity, cik: "0000000002" }, researchInput.now) });
assert.equal(wrongIssuerProfile.status, "candidate_company_profile_pending", "The real profile validator must reject another issuer's profile");
console.log(JSON.stringify({ ok: true, eventQualifiedAtZeroPercentMove: true, cryptoDisabled: true, priorMoveNotRequired: true, strictCommitteeStillRequired: true, historyNeverBlocksCurrentEvidence: true, targetedCurrentEvidenceCanReachCommitteeWithoutHistory: true, paidCommitteeFailureRetainsCostReservation: true, staleQuoteCannotBecomeActionable: true, unknownHaltStateForcesWatch: true, historyStillStoredAndRefined: true, strongHistoryStillImprovesForecastContext: true, noWritesOrPublishing: true }, null, 2));
