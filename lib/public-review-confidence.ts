import { completeCommitteeReview } from "@/lib/ai-committee/review-policy";

type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const score = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
const text = (value: unknown) => typeof value === "string" && value.length > 0 ? value : null;

/** Failed or unrun judges use internal zeroes; only a completed review owns a score. */
export function completedCommitteeConfidence(value: unknown) {
  return completeCommitteeReview(value) ? score(object(object(value).finalJudge).confidence) : null;
}

/** Reading old records must not promote an unproven confidence into a measured score. */
export function publicReviewConfidence(row: Json) {
  const summary = object(row.committee), proof = object(row.completedReview);
  const fingerprint = text(row.reviewEvidenceFingerprint);
  const proved = fingerprint !== null && proof.fingerprint === fingerprint && completeCommitteeReview(proof.committee);
  const historical = object(object(row.quality).historicalReview);
  const historyScore = score(historical.confidence);
  const fullProofScore = completedCommitteeConfidence(proof.committee), retainedProofScore = score(proof.confidence);
  const proofScore = fullProofScore !== null && retainedProofScore !== null && fullProofScore !== retainedProofScore
    ? null : fullProofScore ?? retainedProofScore;
  if (proved && proofScore !== null) {
    // The score must belong to this exact completed decision. Legacy condensed
    // summaries can survive while an unpaid refresh replaces completedReview.
    const current = summary.source === "current_attempt" && summary.failed === 0
      && summary.completed === object(proof.committee).agentsCompleted && summary.confidence === proofScore;
    return { confidence: proofScore, confidenceBasis: current ? "committee_review" : "historical_committee_review" };
  }
  if (historical.source === "terminal_decision" && historical.committeeCompleted === true
    && historical.committeeRolesFailed === 0 && historyScore !== null
    && fingerprint !== null && historical.fingerprint === fingerprint
    && typeof historical.decidedAt === "string" && Number.isFinite(Date.parse(historical.decidedAt))) {
    return { confidence: historyScore, confidenceBasis: "historical_committee_review" };
  }
  return { confidence: null, confidenceBasis: null };
}
