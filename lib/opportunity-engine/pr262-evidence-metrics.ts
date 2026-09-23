import { completeCommitteeReview } from "@/lib/ai-committee/review-policy";
type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function timestamp(value: unknown, now: Date) {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed <= now.getTime() ? new Date(parsed).toISOString() : null;
}

function minutes(start: unknown, end: unknown) {
  const from = typeof start === "string" ? Date.parse(start) : Number.NaN;
  const to = typeof end === "string" ? Date.parse(end) : Number.NaN;
  return Number.isFinite(from) && Number.isFinite(to) && to >= from ? Math.round((to - from) / 60_000 * 100) / 100 : null;
}

export function evidenceTiming(input: { event: Json; candidate: Json; committee: Json; previous?: Json; collection?: Json; paid: boolean; now: Date }) {
  const { event, candidate, committee, now } = input;
  const previous = input.previous ?? {};
  const collection = input.collection ?? {};
  const checkedAt = now.toISOString();
  const quote = object(candidate.quote);
  const sourcePublishedAt = timestamp(event.observedAt, now);
  const firstQueuedAt = timestamp(event.firstQueuedAt, now) ?? timestamp(previous.firstQueuedAt, now);
  const collectionStartedAt = timestamp(collection.startedAt, now);
  const collectionFinishedAt = timestamp(collection.finishedAt, now);
  const sourceCollectedAt = timestamp(collection.sourceCollectedAt, now);
  const firstCollectionStartedAt = timestamp(previous.firstCollectionStartedAt, now) ?? collectionStartedAt;
  const committeeStartedAt = input.paid ? timestamp(committee.startedAt, now) : null;
  const committeeFinishedAt = input.paid ? timestamp(committee.finishedAt, now) : null;
  const firstCommitteeAttemptAt = timestamp(previous.firstCommitteeAttemptAt, now) ?? committeeStartedAt;
  const firstCompletedCommitteeAt = timestamp(previous.firstCompletedCommitteeAt, now)
    ?? (completeCommitteeReview(committee) ? committeeFinishedAt : null);
  const quoteObservedAt = timestamp(quote.observedAt, now);
  const quoteFetchedAt = timestamp(quote.providerFetchedAt, now);
  return {
    collectionScope: "source, halt and optional-history collection batch; excludes later quote, financial and Committee work",
    checkedAt, sourcePublishedAt, firstQueuedAt, firstCollectionStartedAt,
    collectionStartedAt, collectionFinishedAt, sourceCollectedAt,
    committeeStartedAt, committeeFinishedAt, firstCommitteeAttemptAt, firstCompletedCommitteeAt,
    quoteObservedAt, quoteFetchedAt,
    sourceAgeMinutes: minutes(sourcePublishedAt, checkedAt),
    sourceCollectionAgeMinutes: minutes(sourceCollectedAt, checkedAt),
    quoteAgeMinutes: minutes(quoteObservedAt, checkedAt),
    quoteCacheAgeMinutes: minutes(quoteFetchedAt, checkedAt),
    queueWaitMinutes: minutes(firstQueuedAt, firstCollectionStartedAt),
    collectionDurationMinutes: minutes(collectionStartedAt, collectionFinishedAt),
    committeeDurationMinutes: minutes(committeeStartedAt, committeeFinishedAt),
    eventToFirstCommitteeMinutes: minutes(sourcePublishedAt, firstCommitteeAttemptAt),
    queueToFirstCommitteeMinutes: minutes(firstQueuedAt, firstCommitteeAttemptAt),
    eventToCompletedCommitteeMinutes: minutes(sourcePublishedAt, firstCompletedCommitteeAt),
    queueToCompletedCommitteeMinutes: minutes(firstQueuedAt, firstCompletedCommitteeAt),
  };
}

export function summarizeEvidenceQuality(samples: Json[]) {
  const measured = samples.filter(row => finite(row.availableFields) && finite(row.requiredFields) && row.requiredFields > 0);
  const requiredFields = ["companyProfile", "industry", "priceScenarios", "issuer", "sourceDocument", "financialFacts", "marketPrice", "currentMarketPrice", "direction", "tradingHaltCheck"];
  const complete = measured.filter(row => requiredFields.every(field => object(row.fields)[field] === true
    || (field === "priceScenarios" && object(row.applicability).priceScenarios === false && row.valuationException === "verified_negative_earnings_event")));
  const ratio = (count: number) => measured.length ? Math.round(count / measured.length * 10_000) / 100 : null;
  const average = (values: unknown[]) => {
    const known = values.filter(finite);
    return { measuredEvents: known.length, missingEvents: samples.length - known.length,
      averageMinutes: known.length ? Math.round(known.reduce((sum, value) => sum + value, 0) / known.length * 100) / 100 : null };
  };
  const timingFields = ["sourceAgeMinutes", "sourceCollectionAgeMinutes", "quoteAgeMinutes", "quoteCacheAgeMinutes", "queueWaitMinutes", "collectionDurationMinutes", "committeeDurationMinutes", "eventToFirstCommitteeMinutes", "queueToFirstCommitteeMinutes", "eventToCompletedCommitteeMinutes", "queueToCompletedCommitteeMinutes"];
  return {
    sampleUnit: "latest evidence assessment per unique event in the UTC day",
    sampledEvents: samples.length,
    measuredEvents: measured.length,
    incompleteMetricEvents: samples.length - measured.length,
    completeEvidenceEvents: complete.length,
    usableEvidenceRatioPercent: ratio(complete.length),
    usableEvidenceDefinition: "All applicable evidence checks pass. Price scenarios may be unavailable for an event with verified negative earnings; this exception never supplies a price target or Committee approval.",
    negativeEarningsEventExceptions: measured.filter(row => row.valuationException === "verified_negative_earnings_event").length,
    reviewOutcomes: Object.fromEntries(["approved", "rejected", "incomplete_evidence", "technical_failure", "budget_deferred", "awaiting_review"].map(outcome => [outcome, samples.filter(row => row.reviewOutcome === outcome).length])),
    completedCommitteeReviews: samples.filter(row => row.committeeCompleted === true).length,
    decisionGradeSourceEvents: measured.filter(row => object(row.fields).sourceDocument === true).length,
    decisionGradeSourceRatioPercent: ratio(measured.filter(row => object(row.fields).sourceDocument === true).length),
    averageCompletenessPercent: measured.length ? Math.round(measured.reduce((sum, row) => sum + Number(row.availableFields) / Number(row.requiredFields) * 100, 0) / measured.length) : null,
    timing: Object.fromEntries(timingFields.map(field => [field, average(samples.map(row => object(row.timing)[field]))])),
    sourceConnectionSuccessUsedAsEvidence: false,
    committeeTimingMeaning: "First-attempt timing includes failed requests. Completed-review timing requires every selected reviewer to finish; approval is counted separately.",
  };
}
