import { completeCommitteeReview } from "@/lib/ai-committee/review-policy";

type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const text = (value: unknown) => typeof value === "string" && value ? value : null;
const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
const count = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;

/** Describes an already-validated terminal decision; never grants review or publication authority. */
export function historicalReviewTelemetry(decision: Json) {
  const committee = object(decision.committee);
  const completed = completeCommitteeReview(committee), confidence = object(committee.finalJudge).confidence;
  return {
    source: "terminal_decision", decisionKey: text(decision.decisionKey), fingerprint: text(decision.fingerprint),
    outcome: text(decision.outcome), sourceEventId: text(decision.eventId), decidedAt: date(decision.decidedAt),
    resultKey: text(decision.resultKey), committeeStartedAt: date(committee.startedAt), committeeFinishedAt: date(committee.finishedAt),
    committeeCompleted: completed, committeeRolesCompleted: Number(committee.agentsCompleted ?? 0),
    committeeRolesFailed: Number(committee.agentsFailed ?? 0),
    confidence: completed && typeof confidence === "number" && Number.isFinite(confidence) && confidence >= 0 && confidence <= 100 ? confidence : null,
  };
}

/** A current assessment may reuse a decision, but may not overwrite this event's paid attempt. */
export function retainPaidReviewTelemetry(current: Json, previous: Json): Json {
  const priorAttempt = object(previous.lastPaidAttempt);
  const currentAttempt = object(current.lastPaidAttempt);
  const priorMatches = previous.reviewTelemetryVersion === 2 && priorAttempt.eventId === current.eventId;
  const priorIsNewer = priorMatches && date(priorAttempt.checkedAt) && date(currentAttempt.checkedAt)
    && Date.parse(String(priorAttempt.checkedAt)) > Date.parse(String(currentAttempt.checkedAt));
  const lastPaidAttempt = priorIsNewer ? priorAttempt : Object.keys(currentAttempt).length ? currentAttempt : priorMatches ? priorAttempt : null;
  // Old quality samples can prove what was observed, but cannot establish a
  // paid attempt's identity or date. In particular, do not discard a recorded
  // failure on the first post-upgrade unpaid refresh or certify an old success.
  const previousLegacy = object(previous.legacyReviewObservation), currentLegacy = object(current.legacyReviewObservation);
  const oldObservation = previous.reviewTelemetryVersion !== 2 && (previous.paidReview === true || previous.reviewOutcome === "technical_failure" || previous.committeeCompleted === true)
      ? { source: "legacy_event_quality", eventId: current.eventId, attemptProvenance: "unknown",
        observedReviewOutcome: text(previous.reviewOutcome), observedCommitteeCompleted: typeof previous.committeeCompleted === "boolean" ? previous.committeeCompleted : null,
        observedRolesCompleted: count(previous.committeeRolesCompleted), observedRolesFailed: count(previous.committeeRolesFailed),
        observationCheckedAt: date(previous.checkedAt) }
      : null;
  const legacyObservations = [currentLegacy, previousLegacy, oldObservation].map(object)
    .filter(row => row.source === "legacy_event_quality" && row.eventId === current.eventId);
  const legacyReviewObservation = lastPaidAttempt ? null
    : legacyObservations.find(row => row.observedReviewOutcome === "technical_failure") ?? legacyObservations[0] ?? null;
  return { ...current, lastPaidAttempt, legacyReviewObservation,
    reviewOutcome: lastPaidAttempt?.reviewOutcome ?? (legacyReviewObservation?.observedReviewOutcome === "technical_failure"
      ? "technical_failure" : current.assessmentOutcome) };
}

export function currentReviewTelemetry(report: Json, eventId: string, assessmentOutcome: string, previous: Json = {}) {
  const committee = object(report.committee), paid = report.openAiCalled === true;
  const completed = paid && completeCommitteeReview(committee);
  const recommendation = object(committee.output).overallRecommendation;
  const rolesCompleted = count(committee.agentsCompleted), rolesFailed = count(committee.agentsFailed);
  const failed = (rolesFailed !== null && rolesFailed > 0) || committee.ok === false
    || Boolean(text(report.technicalFailureFingerprint)) || report.reviewOutcome === "technical_failure"
    || report.status === "committee_failed" || report.status === "technical_failure";
  const paidOutcome = completed ? recommendation === "approve" ? "approved" : recommendation === "reject" ? "rejected"
    : recommendation === "needs_more_data" ? "incomplete_evidence" : "unknown_attempt"
    : failed ? "technical_failure" : "unknown_attempt";
  const historicalReview = !paid && object(report.historicalReview).source === "terminal_decision" ? object(report.historicalReview) : null;
  const outcome = paid ? paidOutcome : historicalReview ? "historical_review_reused"
    : report.terminalReviewUncertain === true || text(object(report.terminalReviewHold).reason) || completeCommitteeReview(committee)
      ? "unknown_history" : assessmentOutcome;
  return retainPaidReviewTelemetry({ reviewTelemetryVersion: 2, eventId, currentPassPaidReview: paid,
    committeeCompleted: completed, committeeRolesCompleted: paid ? rolesCompleted : 0,
    committeeRolesFailed: paid ? rolesFailed : 0,
    historicalReview, assessmentOutcome: outcome,
    lastPaidAttempt: paid ? { eventId, checkedAt: date(report.checkedAt), fingerprint: text(report.candidateFingerprint),
      status: text(report.status), reviewOutcome: paidOutcome, committeeCompleted: completed,
      committeeRolesCompleted: rolesCompleted, committeeRolesFailed: rolesFailed,
      committeeStartedAt: date(committee.startedAt), committeeFinishedAt: date(committee.finishedAt),
      technicalFailureFingerprint: text(report.technicalFailureFingerprint) } : null,
  }, previous);
}
