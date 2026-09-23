import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";

const metrics = loadTsModule("@/lib/opportunity-engine/pr262-evidence-metrics");
const now = new Date("2026-09-17T23:00:00Z");
const event = { id: "timed-event", ticker: "TEST", cik: "0000000001", observedAt: "2026-09-17T22:00:00Z", firstQueuedAt: "2026-09-17T22:05:00Z" };
const candidate = { ticker: "TEST", company: "Test Software", cik: event.cik, direction: "upside",
  companyProfile: companyProfileFixture({ ticker: "TEST", company: "Test Software", cik: event.cik }, now),
  currency: "USD", valuationRange: { conservativeValue: 80, baseValue: 125, optimisticValue: 150 },
  fundamentals: { available: true },
  quote: { price: 100, observedAt: "2026-09-17T22:50:00Z", providerFetchedAt: "2026-09-17T22:58:00Z", actionableForSeriousSignal: true } };
const committee = { ok: true, agentsFailed: 0, startedAt: "2026-09-17T22:30:00Z", finishedAt: "2026-09-17T22:31:00Z", agentsCompleted: 14, output: { overallRecommendation: "needs_more_data" } };
const collection = { startedAt: "2026-09-17T22:15:00Z", finishedAt: "2026-09-17T22:20:00Z", sourceCollectedAt: "2026-09-17T22:20:00Z" };
const timing = metrics.evidenceTiming({ event, candidate, committee, collection, now, paid: true });
assert.equal(timing.sourceAgeMinutes, 60);
assert.equal(timing.sourceCollectionAgeMinutes, 40);
assert.equal(timing.quoteAgeMinutes, 10, "Fetching a provider response must not reset the quote's observation age.");
assert.equal(timing.quoteCacheAgeMinutes, 2);
assert.equal(timing.queueWaitMinutes, 10);
assert.equal(timing.collectionDurationMinutes, 5);
assert.equal(timing.committeeDurationMinutes, 1);
assert.equal(timing.eventToFirstCommitteeMinutes, 30, "Committee start, not job start or completion, defines time to review.");
assert.equal(timing.queueToFirstCommitteeMinutes, 25);
assert.equal(timing.eventToCompletedCommitteeMinutes, 31);
assert.equal(metrics.evidenceTiming({ event, candidate, committee: { ...committee, ok: false, agentsFailed: 1 }, collection, now, paid: true }).eventToCompletedCommitteeMinutes, null);
const missing = metrics.evidenceTiming({ event: { observedAt: "2026-09-18T00:00:00Z" }, candidate: {}, committee: {}, now, paid: false });
assert.equal(missing.sourceAgeMinutes, null, "A future timestamp is invalid, not fresh evidence.");
assert.equal(missing.quoteAgeMinutes, null);
assert.equal(missing.queueWaitMinutes, null, "Legacy queue timestamps must not be invented.");
assert.equal(metrics.summarizeEvidenceQuality([{ availableFields: 7, requiredFields: 7, fields: { issuer: true, sourceDocument: true, financialFacts: true, marketPrice: true, currentMarketPrice: true, direction: true, tradingHaltCheck: true } }]).usableEvidenceRatioPercent, 0, "A legacy seven-field sample cannot imply a verified company profile.");

const objects = new Map();
let revision = 0;
const storage = {
  readVersionedTextFromR2: async key => objects.has(key) ? { found: true, text: JSON.stringify(objects.get(key).value), etag: objects.get(key).etag } : { found: false, text: null, etag: null },
  writeVersionedJsonToR2: async (key, value, options = {}) => {
    const prior = objects.get(key);
    if ((options.createOnly && prior) || (options.expectedEtag && options.expectedEtag !== prior?.etag)) return { written: false, conflict: true };
    objects.set(key, { value: structuredClone(value), etag: String(++revision) });
    return { written: true, conflict: false };
  },
};
const evidence = loadTsModule("@/lib/opportunity-engine/pr262-research-evidence", { "@/lib/r2-warehouse": storage, "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => `test/${key}` } });
const report = { selectedCandidate: candidate, committee, openAiCalled: true, status: "candidate_needs_more_data", tradingHaltSafety: { currentStateKnown: true } };
const input = { event, report, sourceDecisionGrade: true, sourceFailureReason: null, now, collectionTiming: collection };
const first = await evidence.recordResearchEvidence(input);
assert.equal(first.quality.completenessPercent, 100);
assert.equal((await evidence.readEvidenceQuality(now)).usableEvidenceRatioPercent, 100);
const nextDay = new Date("2026-09-18T00:05:00Z");
const retry = { ...input, now: nextDay, report: { ...report, openAiCalled: false, committee: null,
  selectedCandidate: { ...candidate, quote: { ...candidate.quote, actionableForSeriousSignal: false } } },
  collectionTiming: { ...collection, startedAt: "2026-09-18T00:00:00Z", finishedAt: "2026-09-18T00:02:00Z" } };
const second = await evidence.recordResearchEvidence(retry);
assert.equal(second.quality.timing.firstCommitteeAttemptAt, "2026-09-17T22:30:00.000Z", "Retries and the UTC date boundary must preserve the true first Committee attempt.");
assert.equal(second.quality.timing.firstCollectionStartedAt, "2026-09-17T22:15:00.000Z");
assert.equal(second.quality.timing.sourceCollectionAgeMinutes, 105, "Reading retained source evidence cannot renew its collection timestamp.");
assert.equal(second.quality.timing.quoteAgeMinutes, 75);
await evidence.recordResearchEvidence(retry);
await evidence.recordResearchEvidence({ ...retry, event: { id: "connected-but-empty", sourceHealthStatus: "connected" },
  report: { status: "no_qualified_signal", openAiCalled: false }, sourceDecisionGrade: false, collectionTiming: {} });
const quality = await evidence.readEvidenceQuality(nextDay);
assert.equal(quality.uniqueEvents, 2, "Repeated checks of one event cannot inflate the denominator.");
assert.equal(quality.usableEvidenceRatioPercent, 0);
assert.equal(quality.decisionGradeSourceRatioPercent, 50);
assert.equal(quality.sourceConnectionSuccessUsedAsEvidence, false);
assert.equal(quality.timing.quoteAgeMinutes.measuredEvents, 1);
assert.equal(quality.timing.quoteAgeMinutes.missingEvents, 1);
assert.equal(quality.averageMinutesToFirstReview, 30);
assert.equal(quality.timing.eventToFirstCommitteeMinutes.measuredEvents, 1);
assert.match(quality.scope, /not a whole-universe success rate/);
const negativeCandidate = { ...candidate, eventFamily: "regulatory_approval", valuationRange: null,
  fundamentals: { available: true, checkedAt: now.toISOString(), sourceUrl: "https://data.sec.gov/api/xbrl/companyfacts/CIK0000000001.json",
    items: [{ metric: "net_income", value: -1000, unit: "USD", periodEnd: "2026-06-30", filedAt: "2026-08-01" }] } };
const exception = await evidence.recordResearchEvidence({ ...input, event: { ...event, id: "loss-event" },
  report: { ...report, selectedCandidate: negativeCandidate, openAiCalled: false, committee: null, status: "qualified_signal_openai_not_requested" } });
assert.equal(exception.quality.fields.priceScenarios, false);
assert.equal(exception.quality.applicability.priceScenarios, false);
assert.equal(exception.quality.requiredFields, 9);
assert.equal(exception.quality.completenessPercent, 100, "A documented inapplicable estimate does not repeatedly request impossible inputs");
const exceptionSummary = metrics.summarizeEvidenceQuality([exception.quality]);
assert.equal(exceptionSummary.completeEvidenceEvents, 1);
assert.equal(exceptionSummary.negativeEarningsEventExceptions, 1);
assert.equal(exceptionSummary.completedCommitteeReviews, 0, "An evidence exception cannot manufacture Committee completion");
console.log("Evidence content, unique-event denominators, quote/source ages, missing timing, actual Committee timing and cross-day first-review preservation passed.");
