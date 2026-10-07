// Keep operational evidence ahead of the potentially truncated full response.
// Missing fields stay null: missing evidence must never become a zero/success.
function pick(value, keys) {
  return Object.fromEntries(keys.map(key => {
    const item = value?.[key];
    return [key, typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item))
      ? item : typeof item === "string" ? item.slice(0, 200) : null];
  }));
}

export function simpleAlertCycleSummary(body) {
  let result;
  try { result = JSON.parse(body); } catch { return { summaryStatus: "unparseable_response" }; }
  if (!result || typeof result !== "object" || Array.isArray(result)) return { summaryStatus: "invalid_response" };
  const recovery = result.notifications?.durableRecoveryConsumer;
  const direct = result.sensor?.directAnnouncementMonitoring;
  const issuerRows = Array.isArray(direct?.issuerSourceCoverage) ? direct.issuerSourceCoverage.slice(0, 25) : null;
  return {
    summaryStatus: "parsed",
    pilot: pick(result.pilot, ["name", "branch", "cohortId", "companies"]),
    cycle: pick(result, ["ok", "mode", "checkedAt", "durationMs", "error"]),
    processing: pick(result.processing, ["eventsProcessed", "eventFailures", "eventDeferrals", "aiCalls", "seriousBuys", "seriousSells", "seriousWatchOuts", "deadlineMs", "deliveryReserveMs", "reportingReserveMs", "paidAdmissionMinimumMs", "paidTimeBudgetDeferrals"]),
    processingReliability: pick(result.processing?.reliability, ["processingAttempts", "processingFailures", "processingFailureRatePercent", "committeeReviewAttempts", "committeeTechnicalFailures", "committeeFailureRatePercent", "committeeOutcomeUnknown", "nontechnicalDeferrals"]),
    funnel: pick(result.processing?.funnel, ["admittedThisCycle", "decisionGradeEvidence", "sourceEvidenceRejectedUnread", "paidCommitteeReviews", "committeeApproved"]),
    queue: pick(result.processing?.readiness, ["profileReadyCount", "profileBlockedCount", "profileBlockedCompanyCount", "freshAuthoritativeReadyCount", "oldestProfileReadyQueueWaitMinutes"]),
    accounting: pick(result.aiCostControl, ["spentUsd", "reservedUsd", "exposureUsd", "limitUsd", "activeReservations", "accountingHealthy", "hardFuseTripped", "pendingUsageUpperBoundUsd"]),
    notifications: pick(result.notifications, ["healthy", "directFailures"]),
    recovery: pick(recovery, ["ok", "skipped", "reason", "dueJobs", "jobsAttempted", "delivered", "retryScheduled", "blockedNoChannel", "queuePageTruncated"]),
    discovery: pick(recovery?.discovery, ["outboxesFound", "jobsCreatedOrConfirmed", "truncated"]),
    issuerSources: {
      ...pick(direct, ["eligibleCompanies", "officialSecIdentityMappedCompanies", "currentEligibleCompaniesKnown", "registeredFeeds", "feedsPolled", "feedSuccesses", "feedFailures", "secSubmissionsChecked", "secCheckAttempts", "secCheckSuccesses", "secCheckFailures", "secCheckDeferred", "secCacheHits", "sourcePreparationFailures", "initialCatchupEvents", "sourceCollectionDeadlineReached"]),
      liveNewEvents: pick(result.sensor, ["newEvents"]).newEvents,
      queuedCatchupEvents: pick(result.sensor, ["initialCatchupEvents"]).initialCatchupEvents,
      currentSecSnapshots: issuerRows ? issuerRows.filter(row => row?.sec?.status === "current_snapshot").length : null,
      issuerRowsTruncated: issuerRows ? direct.issuerSourceCoverage.length > 25 : null,
      issuers: issuerRows?.map(row => ({ ticker: pick(row, ["ticker"]).ticker,
        sec: pick(row?.sec, ["status", "snapshotFetchedAt", "nextCheckAt"]),
        ir: pick(row?.ir, ["status", "lastSuccessAt"]) })) ?? null,
    },
    sourceDaily: pick(result.cost?.daily, ["date", "sourceAttempts", "sourceFailures", "sourceAccountingVersion", "sourceAccountingStartedAt", "sourceMeasuredCycles", "sourceMeasuredAttempts", "sourceMeasuredFailures"]),
    processingDaily: pick(result.cost?.daily, ["date", "processingAttempts", "processingFailures", "committeeReviewAttempts", "committeeTechnicalFailures", "committeeOutcomeUnknown", "processingMeasuredCycles", "processingMeasurementStartedAt"]),
    profiles: pick(result.companyProfiles, ["attempted", "verified", "status"]),
    profileProduction: pick(result, ["status", "target", "attempted", "verifiedThisRun", "newlyVerifiedThisRun", "newlyVerifiedToday", "remaining", "verificationCountsStatus", "lastReconciledNewlyVerifiedToday", "countReconciliationFailure", "failureCategory", "storageFailureObserved", "failureRateBasis", "failure", "requests", "requestFailures", "responseBodyFailures", "failureRatePercent"]),
    cohortProfiles: pick(result.cohortProfiles, ["configuredCompanies", "verifiedCompanies", "currentVerificationApplied"]),
    // This is a diagnostic summary, never an approval or delivery receipt.
    receiptVerifiedBySummary: false,
  };
}
