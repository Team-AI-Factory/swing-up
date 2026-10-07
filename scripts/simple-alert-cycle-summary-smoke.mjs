import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { simpleAlertCycleSummary } from "./helpers/simple-alert-cycle-summary.mjs";

const oversized = JSON.stringify({ processing: { eventResults: [{ evidence: "private-evidence".repeat(20000) }], eventFailures: 1,
  funnel: { committeeApproved: 0 } }, aiCostControl: { spentUsd: 0.3, reservedUsd: 0.156, limitUsd: 10, accountingHealthy: true },
  notifications: { durableRecoveryConsumer: { skipped: true, reason: "cycle_deadline_reserve" } } });
assert.ok(oversized.length > 80000);
const summary = simpleAlertCycleSummary(oversized);
const measured = simpleAlertCycleSummary(JSON.stringify({ processing: { reliability: { processingAttempts: 1, processingFailures: 1, committeeTechnicalFailures: 1 } } }));
assert.equal(measured.processingReliability.processingFailures, 1);
assert.equal(measured.processingReliability.committeeTechnicalFailures, 1);
assert.equal(summary.processingReliability.processingAttempts, null, "Legacy responses have no invented denominator");
assert.equal(summary.accounting.reservedUsd, 0.156);
assert.equal(summary.processing.eventFailures, 1);
assert.equal(summary.funnel.committeeApproved, 0);
assert.equal(summary.recovery.skipped, true);
assert.equal(summary.recovery.delivered, null);
assert.equal(summary.receiptVerifiedBySummary, false);
assert.equal(summary.sourceDaily.sourceAccountingStartedAt, null, "Historical responses must not acquire a fabricated source measurement start");
const sourceAccounting = simpleAlertCycleSummary(JSON.stringify({ cost: { daily: { sourceAccountingVersion: 2,
  sourceAccountingStartedAt: "2026-10-03T14:45:00Z", sourceAttempts: 12, sourceFailures: 2, sourceMeasuredCycles: 1, sourceMeasuredAttempts: 5, sourceMeasuredFailures: 0 } } }));
assert.equal(sourceAccounting.sourceDaily.sourceFailures, 2);
assert.equal(sourceAccounting.sourceDaily.sourceMeasuredFailures, 0);
assert.equal(sourceAccounting.sourceDaily.sourceAccountingVersion, 2);
assert.equal(summary.issuerSources.currentSecSnapshots, null);
assert.equal(summary.issuerSources.issuers, null, "Legacy missing coverage cannot become a healthy zero");
const sourceCoverage = simpleAlertCycleSummary(JSON.stringify({ sensor: { newEvents: 0, initialCatchupEvents: 1, directAnnouncementMonitoring: {
  eligibleCompanies: 25, registeredFeeds: 8, secCheckAttempts: 13, secCheckSuccesses: 12, secCheckFailures: 1, initialCatchupEvents: 4,
  issuerSourceCoverage: Array.from({ length: 25 }, (_, index) => ({ ticker: `C${index}`, sec: {
    status: index < 12 ? "current_snapshot" : "not_checked", snapshotFetchedAt: index < 12 ? "2026-10-03T17:00:00Z" : null,
    nextCheckAt: "2026-10-03T17:29:00Z", sourceUrl: "https://data.sec.gov/submissions/source" },
  ir: { status: "registered_not_checked", lastSuccessAt: null, seedVerifiedAt: "2026-10-03T16:00:00Z" } }))
} } }));
assert.equal(sourceCoverage.issuerSources.currentSecSnapshots, 12);
assert.equal(sourceCoverage.issuerSources.liveNewEvents, 0);
assert.equal(sourceCoverage.issuerSources.initialCatchupEvents, 4);
assert.equal(sourceCoverage.issuerSources.queuedCatchupEvents, 1, "Deduplicated queued catch-up is distinct from all source catch-up observations");
assert.equal(sourceCoverage.issuerSources.issuers[0].ir.lastSuccessAt, null, "Registering a feed is not a successful poll");
assert.equal(sourceCoverage.issuerSources.issuers[24].sec.snapshotFetchedAt, null);
assert.equal(sourceCoverage.issuerSources.issuerRowsTruncated, false);
assert.ok(JSON.stringify(sourceCoverage).length < 12000, "All25 bounded source rows must fit ahead of full-response truncation");
assert.ok(JSON.stringify(summary).length < 8000);
assert.ok(!JSON.stringify(summary).includes("private-evidence"));
assert.equal(simpleAlertCycleSummary('{"ok":false}').accounting.accountingHealthy, null);
assert.equal(simpleAlertCycleSummary('{"ok":false}').funnel.committeeApproved, null);
assert.equal(simpleAlertCycleSummary('{"ok":').summaryStatus, "unparseable_response");
assert.equal(simpleAlertCycleSummary('null').summaryStatus, "invalid_response");
const profiles = simpleAlertCycleSummary(JSON.stringify({ attempted: 100, newlyVerifiedThisRun: 7, newlyVerifiedToday: 12, remaining: 488 }));
assert.equal(profiles.profileProduction.newlyVerifiedThisRun, 7);
assert.equal(profiles.profileProduction.attempted, 100);
const cohortProfiles = simpleAlertCycleSummary(JSON.stringify({ cohortProfiles: { configuredCompanies: 25, verifiedCompanies: 25, currentVerificationApplied: true } }));
assert.equal(cohortProfiles.cohortProfiles.verifiedCompanies, 25);
assert.equal(summary.cohortProfiles.verifiedCompanies, null);
const storageFailure = simpleAlertCycleSummary(JSON.stringify({ ok: false, status: "failed", attempted: 21,
  verifiedThisRun: 4, newlyVerifiedThisRun: null, newlyVerifiedToday: null, remaining: null,
  verificationCountsStatus: "unreconciled", lastReconciledNewlyVerifiedToday: 36,
  failureCategory: "storage", storageFailureObserved: true, failure: "r2_state_write_http_502",
  failureRateBasis: "source_requests_only", requests: 42, requestFailures: 0, failureRatePercent: 0 }));
assert.equal(storageFailure.cycle.ok, false);
assert.equal(storageFailure.profileProduction.verifiedThisRun, 4);
assert.equal(storageFailure.profileProduction.newlyVerifiedThisRun, null, "Missing post-failure count evidence cannot become zero");
assert.equal(storageFailure.profileProduction.newlyVerifiedToday, null);
assert.equal(storageFailure.profileProduction.remaining, null);
assert.equal(storageFailure.profileProduction.lastReconciledNewlyVerifiedToday, 36);
assert.equal(storageFailure.profileProduction.failureCategory, "storage");
assert.equal(storageFailure.profileProduction.storageFailureObserved, true);
assert.equal(storageFailure.profileProduction.failureRateBasis, "source_requests_only");
assert.equal(storageFailure.profileProduction.failure, "r2_state_write_http_502");
const launcher = readFileSync(new URL("./simple-alert-pilot-cycle.mjs", import.meta.url), "utf8");
assert.ok(launcher.indexOf("[simple-alerts-summary]") < launcher.indexOf("body.slice(0, 80000)"));
const runtime = simpleAlertCycleSummary(JSON.stringify({ pilot: { cohortId: "small-ai-25-20261003-v1", companies: 25 }, processing: { deadlineMs: 480000, deliveryReserveMs: 45000, reportingReserveMs: 15000 } }));
assert.equal(runtime.pilot.cohortId, "small-ai-25-20261003-v1");
assert.equal(runtime.processing.deadlineMs, 480000);
assert.equal(runtime.processing.deliveryReserveMs, 45000);
assert.equal(runtime.processing.reportingReserveMs, 15000);
console.log("simple alert bounded cycle summary smoke: passed");

const failedRegistrySummary = simpleAlertCycleSummary(JSON.stringify({ sensor: { directAnnouncementMonitoring: {
  secCheckAttempts: 1, secCheckSuccesses: 1, secCheckFailures: 0, sourcePreparationFailures: 1,
  registryPersistence: { written: false, conflict: false, winnerLoaded: false, failureStage: "write",
    error: "direct_registry_write:r2_state_write_http_502\nhttps://private.example/?token=not-for-logs " + "x".repeat(1000),
    telemetryBasis: "unpersisted_observation" },
  issuerSourceCoverage: [{ ticker: "SAFE", sec: { status: "current_snapshot" } }],
} } }));
assert.equal(failedRegistrySummary.issuerSources.currentSecSnapshots, 1);
assert.equal(failedRegistrySummary.issuerSources.registryPersistence.telemetryBasis, "unpersisted_observation");
assert.equal(failedRegistrySummary.issuerSources.registryPersistence.failureStage, "write");
assert.equal(failedRegistrySummary.issuerSources.registryPersistence.written, false);
assert.equal(failedRegistrySummary.issuerSources.secCheckFailures, 0);
assert.ok(!failedRegistrySummary.issuerSources.registryPersistence.error.includes("not-for-logs"));
assert.ok(!failedRegistrySummary.issuerSources.registryPersistence.error.includes("\n"));
assert.ok(failedRegistrySummary.issuerSources.registryPersistence.error.length <= 200);
assert.equal(summary.issuerSources.registryPersistence.written, null);
assert.equal(summary.issuerSources.registryPersistence.telemetryBasis, null);
const unavailableRegistry = simpleAlertCycleSummary(JSON.stringify({ sensor: { directAnnouncementMonitoring: {
  registryPersistence: { telemetryBasis: "unavailable", failureStage: "load", written: false },
  issuerSourceCoverage: [{ ticker: "SAFE", sec: { status: "registry_unavailable" } }],
} } }));
assert.equal(unavailableRegistry.issuerSources.currentSecSnapshots, null);
console.log("Bounded cycle summary retains registry acknowledgement and observed-versus-durable evidence qualifiers.");
