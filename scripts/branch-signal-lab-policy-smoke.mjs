import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../lib/branch-signal-lab-policy.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const cjsModule = { exports: {} };
vm.runInNewContext(`(function (exports, module) { ${compiled}\n})(cjsModule.exports, cjsModule);`, { cjsModule, URL });
const policy = cjsModule.exports;

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

const externalFailure = { status: "source_temporarily_unavailable", failureScope: "external_provider", repairEligible: false, technicalFailureFingerprint: "external_provider_gdelt" };
assert.equal(policy.noGainRepairAttempts([externalFailure, externalFailure], externalFailure), 0);
const applicationFailure = { status: "technical_failure", failureScope: "application", repairEligible: true, technicalFailureFingerprint: "local_parser_invariant" };
assert.equal(policy.noGainRepairAttempts([applicationFailure, applicationFailure], applicationFailure), 3);
assert.equal(policy.noGainRepairAttempts([applicationFailure, { status: "no_qualified_signal", repairEligible: false }], applicationFailure), 1);
assert.equal(policy.noGainRepairAttempts([applicationFailure, applicationFailure], { ...applicationFailure, measurableGain: true }), 0);

console.log(JSON.stringify({
  ok: true,
  eventFirstWithoutPriceMove: officialEvidenceGate.passed,
  strictIssuerMatching: true,
  officialOrIndependentEvidenceRequired: true,
  rumourScoreCappedBelowSerious: true,
  balancedEvidenceChannels: true,
  stableEventFingerprint: true,
  durableProviderBudgetPolicy: true,
  legacyMarketauxReservationsCountTowardCurrentPlan: true,
  externalFailuresNotRepairEligible: true,
  applicationFailureStopPolicy: true,
}, null, 2));
