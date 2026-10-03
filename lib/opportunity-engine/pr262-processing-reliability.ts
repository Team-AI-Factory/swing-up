type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};

/** Transport success and a scheduled retry do not prove a successful review. */
export function pr262ProcessingReliability(outcomes: unknown[]) {
  const attempts = outcomes.map(object).filter(row => !["idle", "busy"].includes(String(row.status)));
  const committeeState = (row: Json) => {
    const diagnostic = object(row.analysisDiagnostics);
    const committee = object(diagnostic.committee);
    const roles = Array.isArray(committee.roleDiagnostics) ? committee.roleDiagnostics.map(object) : [];
    const failed = diagnostic.status === "committee_failed" || committee.status === "agent_failures"
      || Number(committee.agentsFailed) > 0 || roles.some(role => ["failed", "blocked"].includes(String(role.status)));
    const completed = committee.status === "completed" && committee.agentsFailed === 0
      && Number(committee.agentsCompleted) > 0;
    return { failed, completed };
  };
  const failed = (row: Json) => row.ok === false || row.status === "event_job_error"
    || ["committee_failed", "technical_failure"].includes(String(object(row.analysisDiagnostics).status))
    || committeeState(row).failed;
  const processingAttempts = attempts.length;
  const processingFailures = attempts.filter(failed).length;
  const reviews = attempts.filter(row => row.openAiCalled === true);
  const committeeTechnicalFailures = reviews.filter(row => committeeState(row).failed).length;
  return {
    processingAttempts, processingFailures,
    processingFailureRatePercent: processingAttempts ? processingFailures / processingAttempts * 100 : null,
    committeeReviewAttempts: reviews.length, committeeTechnicalFailures,
    committeeFailureRatePercent: reviews.length ? committeeTechnicalFailures / reviews.length * 100 : null,
    committeeOutcomeUnknown: reviews.filter(row => !committeeState(row).failed && !committeeState(row).completed).length,
    nontechnicalDeferrals: attempts.filter(row => !failed(row) && (row.nonterminal === true || row.status === "event_job_deferred")).length,
    attemptUnit: "one non-idle event-job invocation; retries count separately, deferrals are not completed assessments",
    committeeAttemptUnit: "one conservatively admitted paid Committee review, including partial or failed required roles",
  };
}
