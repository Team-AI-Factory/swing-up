import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../lib/branch-signal-lab-policy.ts", import.meta.url), "utf8");
const routeSource = readFileSync(new URL("../app/api/internal/railway-branch-signal-lab/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const cjsModule = { exports: {} };
vm.runInNewContext(`(function (exports, module) { ${compiled}\n})(cjsModule.exports, cjsModule);`, { cjsModule, URL });
const policy = cjsModule.exports;

const routeTestSource = `${routeSource}
export const __routeStateTest = {
  outcomeTrackingEntries,
  historicalSignalRecords,
  pruneHistory,
  updateForwardOutcomes,
  validatedSeriousSignalEffects,
  aggregateValidatedRootSignals,
  mergeHistoricalSignalRecordsForRoute,
};`;
const routeCompiled = ts.transpileModule(routeTestSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const routeCjsModule = { exports: {} };
const routeRequire = (specifier) => {
  if (specifier === "node:fs/promises") return { readFile: async () => "" };
  if (specifier === "node:path") return { isAbsolute: () => true, join: (...parts) => parts.join("/") };
  if (specifier === "next/server") return { NextResponse: { json: (body, init) => ({ body, init }) } };
  if (specifier === "@/lib/branch-signal-lab") return { runBranchSignalLab: async () => ({}) };
  if (specifier === "@/lib/branch-signal-lab-policy") return {
    isLegacyExternalStopReason: () => false,
    noGainRepairAttempts: () => 0,
    providerCallBudgetDecision: () => ({ allowed: false }),
    repairEligibleFailure: () => null,
  };
  if (specifier === "@/lib/equity-signal/historical-analogs") return {
    summarizeEarlyOneDayOutcomes: () => ({
      reportingOnly: true,
      changesSeriousSignalPermission: false,
      changesMatureHorizonForecast: false,
      horizon: "1D",
    }),
  };
  if (specifier === "@/lib/equity-signal/historical-bootstrap") return { mergeHistoricalSignals: (...groups) => groups.flat() };
  if (specifier === "@/lib/r2-warehouse") return {
    getR2Config: () => ({ configured: false }),
    readVersionedTextFromR2: async () => ({ found: false, text: null, etag: null }),
    writeVersionedJsonToR2: async () => ({ conflict: false, etag: "test" }),
  };
  throw new Error(`Unexpected route dependency in smoke test: ${specifier}`);
};
vm.runInNewContext(
  `(function (exports, module, require) { ${routeCompiled}\n})(routeCjsModule.exports, routeCjsModule, routeRequire);`,
  { routeCjsModule, routeRequire, process, console, URL, queueMicrotask, AbortSignal },
);
const routePolicy = routeCjsModule.exports.__routeStateTest;

const at = "2026-07-19T00:00:00.000Z";
const manyGoogle = Array.from({ length: 16 }, (_, index) => ({ title: `Company event ${index}`, publisher: `g${index}.example`, publishedAt: at, channel: "google_news_rss" }));
const otherChannels = [
  { title: "Federal Reserve announces policy decision", publisher: "federalreserve.gov", publishedAt: at, channel: "federal_reserve" },
  { title: "Issuer files material agreement", publisher: "sec.gov", publishedAt: at, channel: "sec_current_filings" },
  { title: "Independent report confirms material agreement", publisher: "reuters.com", publishedAt: at, channel: "marketaux" },
  { title: "Second report confirms material agreement", publisher: "apnews.com", publishedAt: at, channel: "gdelt" },
  { title: "Company event 0", publisher: "syndicated-copy.example", publishedAt: at, channel: "marketaux" },
];
const balanced = policy.selectBalancedReceipts([...manyGoogle, ...otherChannels], 16);
assert.equal(balanced.length, 16);
assert.deepEqual([...new Set(balanced.map((item) => item.channel))].sort(), ["federal_reserve", "gdelt", "google_news_rss", "marketaux", "sec_current_filings"]);
assert.equal(balanced.filter((item) => item.title === "Company event 0").length, 1);

const verifiedEarlyEvent = {
  eventTruth: 94,
  mappingConfidence: 98,
  materiality: 86,
  transmissionConfidence: 84,
  historicalSupport: 72,
  evidenceIndependence: 88,
  contradictionPenalty: 0,
  pricedInPenalty: 0,
  rumour: false,
  priceMovePercent: 0,
  postEventMovePercent: 0,
};
assert.ok(policy.computeEventFirstStrength(verifiedEarlyEvent) >= 60);
assert.doesNotMatch(policy.computeEventFirstStrength.toString(), /absoluteMove|post.?event.?move|priceVolumeConfirmation/i);
assert.doesNotMatch(policy.eventFirstGate.toString(), /absoluteMove|post.?event.?move|priceVolumeConfirmation/i);
const noHistoryScore = policy.computeEventFirstStrength({ ...verifiedEarlyEvent, historicalSupport: 0 });
const abundantHistoryScore = policy.computeEventFirstStrength({ ...verifiedEarlyEvent, historicalSupport: 100 });
assert.equal(noHistoryScore, abundantHistoryScore);

const officialEvidenceGate = policy.eventFirstGate({
  eventTruth: 94,
  mappingConfidence: 98,
  materiality: 86,
  transmissionConfidence: 84,
  fresh: true,
  primarySource: true,
  independentPublishers: 0,
  unresolvedSevereContradiction: false,
  rumour: false,
  priceMovePercent: 0,
  postEventMovePercent: 0,
});
assert.equal(officialEvidenceGate.passed, true);
const independentEvidenceGate = policy.eventFirstGate({
  eventTruth: 90,
  mappingConfidence: 97,
  materiality: 80,
  transmissionConfidence: 78,
  fresh: true,
  primarySource: false,
  independentPublishers: 2,
  unresolvedSevereContradiction: false,
  rumour: false,
});
assert.equal(independentEvidenceGate.passed, true);
assert.equal(policy.eventFirstGate({
  eventTruth: 90,
  mappingConfidence: 97,
  materiality: 80,
  transmissionConfidence: 78,
  fresh: true,
  primarySource: false,
  independentPublishers: 1,
  unresolvedSevereContradiction: false,
  rumour: false,
}).passed, false);

assert.ok(policy.computeEventFirstStrength({ ...verifiedEarlyEvent, rumour: true }) <= 59);
assert.ok(policy.computeEventFirstStrength({ ...verifiedEarlyEvent, eventTruth: 64 }) <= 59);
assert.ok(policy.computeEventFirstStrength({ ...verifiedEarlyEvent, mappingConfidence: 69 }) <= 59);

assert.equal(policy.normalizeEquitySymbol(" $msft "), "MSFT");
assert.equal(policy.normalizeEquitySymbol("brk/b"), "BRK.B");
assert.equal(policy.normalizeEquitySymbol("not a ticker"), null);
assert.equal(policy.matchesEquityText("Microsoft announces a new Azure product", { name: "Microsoft Corporation", ticker: "MSFT" }), true);
assert.equal(policy.matchesEquityText("MSFT stock rises after the product announcement", { name: "Microsoft Corporation", ticker: "MSFT" }), true);
assert.equal(policy.matchesEquityText("MSFT is an internal warehouse code", { name: "Microsoft Corporation", ticker: "MSFT" }), false);
assert.equal(policy.matchesEquityText("AI is changing the software industry", { name: "C3.ai, Inc.", ticker: "AI" }), false);
assert.equal(policy.matchesEquityText("$AI shares react to new guidance", { name: "C3.ai, Inc.", ticker: "AI" }), true);
assert.equal(policy.matchesEquityText("ARM architecture powers many devices", { name: "Arm Holdings plc", ticker: "ARM" }), false);
assert.equal(policy.matchesEquityText("$ARM files a new earnings release", { name: "Arm Holdings plc", ticker: "ARM" }), true);
assert.equal(policy.matchesEquityText("The meeting begins at 1:00 p.m. Eastern Time", { name: "EASTERN CO", ticker: "EML", aliases: ["Eastern"] }), false);
assert.equal(policy.matchesEquityText("$EML shares react to the issuer announcement", { name: "EASTERN CO", ticker: "EML", aliases: ["Eastern"] }), true);
assert.equal(policy.matchesEquityText("Eastern Co reports quarterly earnings", { name: "EASTERN CO", ticker: "EML", aliases: ["Eastern"] }), true);
assert.equal(policy.matchesEquityText("President declassifies intel on foreign election interference", { name: "INTEL CORP", ticker: "INTC", aliases: ["Intel"] }), false);
assert.equal(policy.matchesEquityText("Intel launches a new semiconductor processor", { name: "INTEL CORP", ticker: "INTC", aliases: ["Intel"] }), true);
assert.equal(policy.matchesEquityText("People gathered for the government announcement", { name: "People Inc", ticker: "PPLI", aliases: ["People"] }), false);
assert.equal(policy.matchesEquityText("People Inc announces quarterly earnings", { name: "People Inc", ticker: "PPLI", aliases: ["People"] }), true);
assert.equal(policy.matchesEquityText("CISA and its partners publish joint guidance for corporate software users", { name: "JOINT Corp", ticker: "JYNT", aliases: ["The Joint"] }), false);
assert.equal(policy.matchesEquityText("The Joint Corp reports quarterly earnings", { name: "JOINT Corp", ticker: "JYNT", aliases: ["The Joint"] }), true);
assert.equal(policy.matchesEquityText("$JYNT shares react to new guidance", { name: "JOINT Corp", ticker: "JYNT", aliases: ["The Joint"] }), true);

const eventReceipt = { title: "Microsoft signs major cloud agreement", publisher: "sec.gov", publishedAt: "2026-07-19T00:14:00.000Z", channel: "sec_current_filings", url: "https://www.sec.gov/Archives/example.htm?tracking=one" };
const sameEventReceipt = { ...eventReceipt, publishedAt: "2026-07-19T00:58:00.000Z", url: "https://www.sec.gov/Archives/example.htm?tracking=two" };
const eventIdentity = policy.canonicalEventIdentity(eventReceipt);
assert.equal(eventIdentity, policy.canonicalEventIdentity(sameEventReceipt));
const firstFingerprint = policy.candidateFingerprintInput({ ticker: "MSFT", direction: "upside", eventFamily: "Product Launch", eventIdentity });
const reorderedFingerprint = policy.candidateFingerprintInput({ ticker: "msft", direction: "upside", eventFamily: " product launch ", eventIdentity });
assert.equal(firstFingerprint, reorderedFingerprint);
assert.notEqual(firstFingerprint, policy.candidateFingerprintInput({ ticker: "MSFT", direction: "downside", eventFamily: "Product Launch", eventIdentity }));
assert.notEqual(firstFingerprint, policy.candidateFingerprintInput({ ticker: "MSFT", direction: "upside", eventFamily: "Regulatory Action", eventIdentity }));

for (const failure of [
  policy.providerFailurePolicy({ httpStatus: 429 }),
  policy.providerFailurePolicy({ httpStatus: 200, bodyText: "Please limit requests to one every 5 seconds" }),
  policy.providerFailurePolicy({ httpStatus: 503 }),
  policy.providerFailurePolicy({ transportFailure: true }),
  policy.providerFailurePolicy({ malformedPayload: true }),
]) {
  assert.equal(failure.repairEligible, false);
  assert.equal(failure.failureScope, "external_provider");
}
assert.equal(policy.providerFailurePolicy({ httpStatus: 429 }).status, "rate_limited");
assert.equal(policy.providerFailurePolicy({ httpStatus: 503 }).status, "temporarily_unavailable");
assert.ok(policy.providerCooldownMs({ failureCount: 1, refreshMs: 15 * 60_000, maximumCooldownMs: 6 * 60 * 60_000 }) >= 15 * 60_000);

const providerBudgetRequest = { quotaKey: "marketaux_free", cadenceKey: "marketaux_news", rollingWindowMs: 24 * 60 * 60_000, maximumCallsInWindow: 2, minimumIntervalMs: 20 * 60_000 };
const providerBudgetHistory = [{ quotaKey: "marketaux_free", cadenceKey: "marketaux_news", reservedAt: at }];
assert.equal(policy.providerCallBudgetDecision(providerBudgetHistory, providerBudgetRequest, Date.parse(at) + 5 * 60_000).reason, "cadence_guard");
assert.equal(policy.providerCallBudgetDecision(providerBudgetHistory, providerBudgetRequest, Date.parse(at) + 21 * 60_000).allowed, true);
assert.equal(policy.providerCallBudgetDecision([...providerBudgetHistory, { ...providerBudgetHistory[0], reservedAt: "2026-07-19T00:21:00.000Z" }], providerBudgetRequest, Date.parse(at) + 42 * 60_000).reason, "rolling_quota_guard");
const migratedMarketauxBudget = policy.providerCallBudgetDecision([
  { quotaKey: "marketaux_free", cadenceKey: "marketaux_news", reservedAt: at },
  { quotaKey: "marketaux_free_100_daily", cadenceKey: "marketaux_equity_news", reservedAt: new Date(Date.parse(at) + 30_000).toISOString() },
], { quotaKey: "marketaux_free_100_daily", cadenceKey: "marketaux_equity_news_v2", rollingWindowMs: 24 * 60 * 60_000, maximumCallsInWindow: 2, minimumIntervalMs: 0 }, Date.parse(at) + 60_000);
assert.equal(migratedMarketauxBudget.reason, "rolling_quota_guard");

const trackedCandidate = ({
  fingerprint,
  ticker,
  price,
  rootEventKey = fingerprint,
  findingDisposition = "qualified",
}) => ({
  evidenceFingerprint: fingerprint,
  rootEventKey,
  ticker,
  price,
  benchmarkTicker: "SPY",
  benchmarkPrice: 100,
  direction: "upside",
  relationship: "direct",
  eventFamily: "contract_award",
  causalChain: ["verified event", "issuer revenue changes"],
  macroRegime: ["neutral"],
  findingDisposition,
  receipts: [{ primarySource: true, publisher: "issuer.example", url: `https://issuer.example/${fingerprint}` }],
});
const performanceRun = (overrides = {}) => ({
  mode: "railway_branch_live_read_only",
  assetClass: "public_equity",
  realProviderResponsesOnly: true,
  databaseWrites: false,
  publishing: false,
  notifications: false,
  seriousSignalFound: false,
  openAiCalled: false,
  checkedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});
const routeHistory = (runs) => ({
  version: 6,
  branch: "agent/live-signal-evaluation-automation",
  deploymentId: "test",
  stopped: false,
  stopReason: null,
  scanLease: null,
  totalRunCount: runs.length,
  runs,
  openAiReservations: [],
  providerCallReservations: [],
  updatedAt: "2026-07-29T00:00:00.000Z",
});

const promotedFingerprint = "promoted-fingerprint";
const earlierShadow = performanceRun({
  checkedAt: "2026-01-01T00:00:00.000Z",
  shadowOutcomeTrackingCandidates: [trackedCandidate({
    fingerprint: promotedFingerprint,
    ticker: "AAA",
    price: 100,
    findingDisposition: "shadow_near_miss",
  })],
});
const approvedCandidate = trackedCandidate({ fingerprint: promotedFingerprint, ticker: "AAA", price: 110 });
const laterApproved = performanceRun({
  checkedAt: "2026-01-02T00:00:00.000Z",
  seriousSignalFound: true,
  openAiCalled: true,
  candidateFingerprint: promotedFingerprint,
  selectedCandidate: approvedCandidate,
  outcomeTrackingCandidates: [{ ...approvedCandidate }],
  runArchiveObject: "branch-labs/pr-261/serious-signal/runs/2026-01-02/approved.json",
});
const promotedHistory = routeHistory([earlierShadow, laterApproved]);
routePolicy.updateForwardOutcomes(promotedHistory, performanceRun({
  checkedAt: "2026-01-03T00:00:00.000Z",
  marketSnapshot: [
    { ticker: "AAA", price: 121, observedAt: "2026-01-03T00:00:00.000Z", source: "test equity quote" },
    { ticker: "SPY", price: 101, observedAt: "2026-01-03T00:00:00.000Z", source: "test benchmark quote" },
  ],
}));
const promotedEntries = routePolicy.outcomeTrackingEntries(promotedHistory);
assert.equal(promotedEntries.length, 1);
assert.equal(promotedEntries[0].committeeApproved, true);
assert.equal(promotedEntries[0].candidate.price, 110);
assert.equal(promotedEntries[0].run.checkedAt, "2026-01-02T00:00:00.000Z");
const promotedRecords = routePolicy.historicalSignalRecords(promotedHistory);
assert.equal(promotedRecords.length, 1);
assert.equal(promotedRecords[0].learningUse, "forecast_eligible");
assert.equal(promotedRecords[0].signalObservedAt, "2026-01-02T00:00:00.000Z");
assert.equal(promotedRecords[0].checkpoints["1D"].returnPercent, 10);

const unrelatedFingerprint = "unrelated-shadow";
const otherApprovedFingerprint = "other-approved";
const otherApprovedCandidate = trackedCandidate({ fingerprint: otherApprovedFingerprint, ticker: "BBB", price: 50 });
const unrelatedApprovalRun = performanceRun({
  checkedAt: "2026-02-01T00:00:00.000Z",
  seriousSignalFound: true,
  openAiCalled: true,
  candidateFingerprint: otherApprovedFingerprint,
  selectedCandidate: otherApprovedCandidate,
  shadowOutcomeTrackingCandidates: [trackedCandidate({
    fingerprint: unrelatedFingerprint,
    ticker: "CCC",
    price: 75,
    findingDisposition: "shadow_near_miss",
  })],
  runArchiveObject: "branch-labs/pr-261/serious-signal/runs/2026-02-01/other.json",
});
const unrelatedRecord = routePolicy.historicalSignalRecords(routeHistory([unrelatedApprovalRun]))
  .find((item) => item.eventKey === unrelatedFingerprint);
assert.equal(unrelatedRecord?.learningUse, "diagnostics_only");

const unarchivedApproved = { ...laterApproved, runArchiveObject: undefined };
const unarchivedRecord = routePolicy.historicalSignalRecords(routeHistory([unarchivedApproved]))[0];
assert.equal(unarchivedRecord.learningUse, "diagnostics_only");
assert.ok(unarchivedRecord.learningReasons.includes("approved_occurrence_pending_immutable_run_archive"));
assert.doesNotMatch(routeSource, /historyIncludingCurrentReport/);
assert.match(routeSource, /forwardOutcomeAdditions\s*=\s*historicalSignalRecords\(history\)/);

const trustedLegacyOneDay = {
  ...promotedRecords[0],
  checkpoints: { "1D": promotedRecords[0].checkpoints["1D"] },
};
const diagnosticSameRecordThreeDay = {
  ...trustedLegacyOneDay,
  learningUse: "diagnostics_only",
  learningReasons: ["approved_occurrence_pending_immutable_run_archive", "diagnostics_only"],
  checkpoints: {
    "3D": {
      returnPercent: 14,
      benchmarkReturnPercent: 2,
      observedAt: "2026-01-05T00:00:00.000Z",
      source: "test three-day quote",
    },
  },
};
const mergedLegacyCheckpoints = routePolicy.mergeHistoricalSignalRecordsForRoute(
  [trustedLegacyOneDay],
  [diagnosticSameRecordThreeDay],
);
assert.equal(mergedLegacyCheckpoints.length, 1);
assert.equal(mergedLegacyCheckpoints[0].learningUse, "forecast_eligible");
assert.deepEqual(Object.keys(mergedLegacyCheckpoints[0].checkpoints).sort(), ["1D", "3D"]);
const differentShadowOccurrence = {
  ...diagnosticSameRecordThreeDay,
  id: `${promotedFingerprint}:2026-01-01T00:00:00.000Z`,
  signalObservedAt: "2026-01-01T00:00:00.000Z",
  featuresAsOf: "2026-01-01T00:00:00.000Z",
  findingDisposition: "shadow_near_miss",
};
const separatedShadowOccurrence = routePolicy.mergeHistoricalSignalRecordsForRoute(
  [trustedLegacyOneDay],
  [differentShadowOccurrence],
);
assert.equal(separatedShadowOccurrence.length, 2);
assert.equal(separatedShadowOccurrence.find((item) => item.id === differentShadowOccurrence.id)?.learningUse, "diagnostics_only");

const pruningNow = Date.parse("2026-07-29T00:00:00.000Z");
const duplicateShadowRuns = Array.from({ length: 100 }, (_, index) => performanceRun({
  checkedAt: new Date(Date.parse("2026-07-01T00:00:00.000Z") + index * 5 * 60_000).toISOString(),
  shadowDuplicateIndex: index,
  shadowOutcomeTrackingCandidates: [trackedCandidate({
    fingerprint: "old-duplicate-shadow",
    ticker: "DDD",
    price: 40,
    findingDisposition: "shadow_near_miss",
  })],
}));
const recentQuietRuns = Array.from({ length: 576 }, (_, index) => performanceRun({
  checkedAt: new Date(Date.parse("2026-07-27T00:00:00.000Z") + index * 5 * 60_000).toISOString(),
  recentQuietIndex: index,
}));
const prunedDuplicateHistory = routeHistory([...duplicateShadowRuns, ...recentQuietRuns]);
routePolicy.pruneHistory(prunedDuplicateHistory, pruningNow);
assert.equal(prunedDuplicateHistory.runs.length, 577);
assert.deepEqual(
  prunedDuplicateHistory.runs.filter((run) => Number.isInteger(run.shadowDuplicateIndex)).map((run) => run.shadowDuplicateIndex),
  [0],
);

const replacementCandidate = trackedCandidate({ fingerprint: "old-duplicate-shadow", ticker: "DDD", price: 44 });
const approvedReplacementRun = performanceRun({
  checkedAt: "2026-07-02T00:00:00.000Z",
  seriousSignalFound: true,
  openAiCalled: true,
  candidateFingerprint: "old-duplicate-shadow",
  selectedCandidate: replacementCandidate,
  runArchiveObject: "branch-labs/pr-261/serious-signal/runs/2026-07-02/replacement.json",
  approvedReplacement: true,
});
const replacedOwnerHistory = routeHistory([...duplicateShadowRuns, approvedReplacementRun, ...recentQuietRuns]);
routePolicy.pruneHistory(replacedOwnerHistory, pruningNow);
assert.equal(replacedOwnerHistory.runs.length, 577);
assert.equal(replacedOwnerHistory.runs.filter((run) => Number.isInteger(run.shadowDuplicateIndex)).length, 0);
assert.equal(replacedOwnerHistory.runs.filter((run) => run.approvedReplacement === true).length, 1);

const oneDayOutcome = ({ checkedAt, evaluationPrice, benchmarkEvaluationPrice, usefulAtCheckpoint }) => {
  const targetAt = new Date(Date.parse(checkedAt) + 24 * 60 * 60_000).toISOString();
  const forwardReturnPercent = evaluationPrice - 100;
  const benchmarkReturnPercent = benchmarkEvaluationPrice - 100;
  const marketRelativeReturnPercent = forwardReturnPercent - benchmarkReturnPercent;
  return {
    checkpoint: "1D",
    targetAt,
    evaluatedAt: targetAt,
    evaluationPollCheckedAt: targetAt,
    evaluationDelayMs: 0,
    evaluationPollDelayMs: 0,
    maximumEvaluationDelayMs: 72 * 60 * 60_000,
    priceAtSignal: 100,
    evaluationPrice,
    forwardReturnPercent,
    directionAdjustedReturnPercent: forwardReturnPercent,
    benchmarkTicker: "SPY",
    benchmarkPriceAtSignal: 100,
    benchmarkEvaluationPrice,
    benchmarkObservedAt: targetAt,
    benchmarkReturnPercent,
    marketRelativeReturnPercent,
    directionAdjustedMarketRelativeReturnPercent: marketRelativeReturnPercent,
    usefulAtCheckpoint,
    source: "test outcome quote",
    benchmarkSource: "test benchmark quote",
  };
};
const validatedEffectRun = ({ fingerprint, ticker, checkedAt, evaluationPrice, benchmarkEvaluationPrice, usefulAtCheckpoint, rootEventKey = "shared-root-event" }) => {
  const selectedCandidate = trackedCandidate({ fingerprint, ticker, price: 100, rootEventKey });
  return performanceRun({
    checkedAt,
    seriousSignalFound: true,
    openAiCalled: true,
    candidateFingerprint: fingerprint,
    selectedCandidate,
    runArchiveObject: `branch-labs/pr-261/serious-signal/runs/${fingerprint}.json`,
    outcomeEvaluations: [oneDayOutcome({ checkedAt, evaluationPrice, benchmarkEvaluationPrice, usefulAtCheckpoint })],
  });
};
const usefulEffect = validatedEffectRun({
  fingerprint: "root-effect-useful",
  ticker: "EEE",
  checkedAt: "2026-03-01T00:00:00.000Z",
  evaluationPrice: 101.2,
  benchmarkEvaluationPrice: 100.1,
  usefulAtCheckpoint: true,
});
const nonUsefulEffect = validatedEffectRun({
  fingerprint: "root-effect-not-useful",
  ticker: "FFF",
  checkedAt: "2026-03-02T00:00:00.000Z",
  evaluationPrice: 99.6,
  benchmarkEvaluationPrice: 100.1,
  usefulAtCheckpoint: false,
});
const aggregateRoots = (runs) => routePolicy.aggregateValidatedRootSignals(routePolicy.validatedSeriousSignalEffects(routeHistory(runs)));
const forwardRootAggregation = aggregateRoots([usefulEffect, nonUsefulEffect]);
const reverseRootAggregation = aggregateRoots([nonUsefulEffect, usefulEffect]);
assert.deepEqual(JSON.parse(JSON.stringify(forwardRootAggregation)), JSON.parse(JSON.stringify(reverseRootAggregation)));
assert.equal(forwardRootAggregation.length, 1);
assert.equal(forwardRootAggregation[0].effectCount, 2);
assert.equal(forwardRootAggregation[0].jointUsefulEffectCount, 1);
assert.equal(forwardRootAggregation[0].jointUsefulEffectRate, 0.5);
assert.ok(Math.abs(forwardRootAggregation[0].medianDirectionAdjustedReturnPercent - 0.4) < 0.0001);
assert.ok(Math.abs(forwardRootAggregation[0].medianDirectionAdjustedMarketRelativeReturnPercent - 0.3) < 0.0001);
assert.equal(forwardRootAggregation[0].usefulAtCheckpoint, false);

const secondUsefulEffect = validatedEffectRun({
  fingerprint: "root-effect-useful-2",
  ticker: "GGG",
  checkedAt: "2026-03-03T00:00:00.000Z",
  evaluationPrice: 100.8,
  benchmarkEvaluationPrice: 100.1,
  usefulAtCheckpoint: true,
});
const majorityRootAggregation = aggregateRoots([nonUsefulEffect, secondUsefulEffect, usefulEffect]);
assert.equal(majorityRootAggregation[0].jointUsefulEffectCount, 2);
assert.equal(majorityRootAggregation[0].effectCount, 3);
assert.equal(majorityRootAggregation[0].usefulAtCheckpoint, true);

const disjointAbsoluteEffect = validatedEffectRun({
  fingerprint: "disjoint-absolute-only",
  ticker: "HHH",
  checkedAt: "2026-04-01T00:00:00.000Z",
  evaluationPrice: 101,
  benchmarkEvaluationPrice: 101.1,
  usefulAtCheckpoint: false,
  rootEventKey: "disjoint-threshold-root",
});
const disjointRelativeEffect = validatedEffectRun({
  fingerprint: "disjoint-relative-only",
  ticker: "III",
  checkedAt: "2026-04-02T00:00:00.000Z",
  evaluationPrice: 100,
  benchmarkEvaluationPrice: 99,
  usefulAtCheckpoint: false,
  rootEventKey: "disjoint-threshold-root",
});
const disjointForward = aggregateRoots([disjointAbsoluteEffect, disjointRelativeEffect]);
const disjointReverse = aggregateRoots([disjointRelativeEffect, disjointAbsoluteEffect]);
assert.deepEqual(JSON.parse(JSON.stringify(disjointForward)), JSON.parse(JSON.stringify(disjointReverse)));
assert.equal(disjointForward.length, 1);
assert.equal(disjointForward[0].jointUsefulEffectCount, 0);
assert.ok(disjointForward[0].medianDirectionAdjustedReturnPercent >= 0.5);
assert.ok(disjointForward[0].medianDirectionAdjustedMarketRelativeReturnPercent > 0);
assert.equal(disjointForward[0].usefulAtCheckpoint, false);

assert.match(routeSource, /pendingProviderReservations/);
assert.match(routeSource, /queueMicrotask\(flushProviderReservations\)/);
assert.match(routeSource, /if \(addedReservation\) storage = await saveHistory\(history, storage\)/);
assert.match(routeSource, /shadowOutcomeTrackingCandidates/);
assert.match(
  readFileSync(new URL("../lib/branch-signal-lab.ts", import.meta.url), "utf8"),
  /quotaKey: "nasdaq_trader_trade_halts"[\s\S]{0,180}maximumCallsInWindow: 300[\s\S]{0,100}minimumIntervalMs: 4\.5 \* minute/,
);
assert.match(routeSource, /findingDisposition:\s*FindingDisposition/);
assert.match(routeSource, /learningUse:\s*LearningUse/);
assert.match(routeSource, /exactApprovedFingerprint/);
assert.match(routeSource, /committeeApproved/);
assert.match(routeSource, /selectedOutcomeOwnerRuns/);
assert.match(routeSource, /rootEventKey/);
assert.match(routeSource, /rootUsefulnessAggregation/);
assert.match(routeSource, /alertWaitsForOutcomes:\s*false/);
assert.match(routeSource, /checkpointsArePostSignalLearningOnly:\s*true/);
assert.match(routeSource, /earlyOneDayOutcomeTelemetry:\s*summarizeEarlyOneDayOutcomes/);
assert.match(routeSource, /historicalOutcomeLibrary:\s*\{/);
assert.match(routeSource, /containsCompleteFindingAuditLedger:\s*true/);
assert.match(routeSource, /containsCompleteMappedFindingReceiptProofDictionary:\s*true/);
assert.match(routeSource, /mappedFindingAuditLedger:\s*undefined/);
assert.match(routeSource, /mappedFindingReceiptProofDictionary:\s*undefined/);
assert.ok(
  routeSource.indexOf("const runArchiveObject = await archiveCompletedRun(runNumber, invocation, completedRun);")
    < routeSource.indexOf("mappedFindingReceiptProofDictionary: undefined"),
);

const externalFailure = { status: "source_temporarily_unavailable", failureScope: "external_provider", repairEligible: false, technicalFailureFingerprint: "external_provider_gdelt" };
assert.equal(policy.noGainRepairAttempts([externalFailure, externalFailure], externalFailure), 0);
const applicationFailure = { status: "technical_failure", failureScope: "application", repairEligible: true, technicalFailureFingerprint: "local_parser_invariant" };
assert.equal(policy.noGainRepairAttempts([applicationFailure, applicationFailure], applicationFailure), 3);
assert.equal(policy.noGainRepairAttempts([applicationFailure, { status: "no_qualified_signal", repairEligible: false }], applicationFailure), 1);
assert.equal(policy.noGainRepairAttempts([applicationFailure, applicationFailure], { ...applicationFailure, measurableGain: true }), 0);

console.log(JSON.stringify({
  ok: true,
  eventFirstWithoutPriceMove: officialEvidenceGate.passed,
  currentEvidenceDecisionInvariantToHistory: true,
  strictIssuerMatching: true,
  officialOrIndependentEvidenceRequired: true,
  rumourScoreCappedBelowSerious: true,
  balancedEvidenceChannels: true,
  stableEventFingerprint: true,
  durableProviderBudgetPolicy: true,
  concurrentProviderReservationsPersistedInOneBatch: true,
  qualifiedAndShadowTrackersPersistedSeparately: true,
  onlyExactApprovedSeriousFingerprintCanTeachForecasts: true,
  approvedOccurrenceOwnsOutcomeTracking: true,
  unarchivedCurrentRunCannotTeachForecasts: true,
  trustedLegacyCheckpointsContinueAccumulating: true,
  shadowOccurrencesCannotInheritTrust: true,
  duplicateTrackerRunsPrunedFromRollingState: true,
  consistencyGroupedByRootEvent: true,
  rootUsefulnessAggregationOrderIndependent: true,
  rootUsefulnessRequiresJointPerEffectSuccess: true,
  rootUsefulnessMajorityRequiredAndTiesFail: true,
  checkpointsNeverGateImmediateSignals: true,
  earlyOneDayLearningReportedWithoutChangingForecasts: true,
  completeFindingProofArchivedWithoutBloatedRollingState: true,
  legacyMarketauxReservationsCountTowardCurrentPlan: true,
  externalFailuresNotRepairEligible: true,
  applicationFailureStopPolicy: true,
}, null, 2));
