import assert from "node:assert/strict";
import { terminalHarness } from "./terminal-review-runner-smoke.mjs";
import { inSimpleAlertPilot } from "./helpers/simple-alert-pilot-fixture.mjs";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";

// Real runner, role orchestration, terminal journal, quality writer and public
// projection; only provider/source/storage responses are synthetic and local.
globalThis.fetch = async () => { throw new Error("Live I/O prohibited by telemetry regression"); };
const metrics = loadTsModule("@/lib/opportunity-engine/pr262-evidence-metrics");
const telemetry = loadTsModule("@/lib/opportunity-engine/pr262-review-telemetry");
const { assemblePublicSignals } = loadTsModule("@/lib/public-signals");
const evidence = (h, report, event) => h.modules.research.recordResearchEvidence({ event, report,
  sourceDecisionGrade: true, sourceFailureReason: null,
  now: new Date(Math.max(h.state.now.getTime(), Date.parse(report.committee?.finishedAt ?? "") || 0) + 1000) });
const daily = h => h.objects.get(h.key(`research-evidence/quality/${h.state.now.toISOString().slice(0, 10)}.json`)).value;
const card = h => h.objects.get(h.modules.research.RESEARCH_ALERT_INDEX_KEY).value.alerts[0];

const barePaid = telemetry.currentReviewTelemetry({ openAiCalled: true }, "unknown-paid", "incomplete_evidence");
assert.equal(barePaid.reviewOutcome, "unknown_attempt");
assert.equal(barePaid.committeeRolesCompleted, null);
assert.equal(barePaid.committeeRolesFailed, null);
assert.equal(barePaid.lastPaidAttempt.checkedAt, null);
const caughtFailure = telemetry.currentReviewTelemetry({ openAiCalled: true, status: "source_temporarily_unavailable",
  technicalFailureFingerprint: "external_provider_equity_universe", checkedAt: "2026-10-06T23:00:00Z",
  committee: { startedAt: "2026-10-06T23:00:01Z", finishedAt: null } }, "caught-failure", "incomplete_evidence");
assert.equal(caughtFailure.reviewOutcome, "technical_failure");
assert.equal(caughtFailure.committeeRolesCompleted, null);
assert.equal(caughtFailure.committeeRolesFailed, null);
assert.equal(caughtFailure.lastPaidAttempt.committeeFinishedAt, null);
assert.equal(telemetry.currentReviewTelemetry({ openAiCalled: false }, "caught-failure", "awaiting_review", caughtFailure).reviewOutcome,
  "technical_failure", "The runner's explicit paid catch failure survives without fabricating missing role diagnostics");
assert.equal(telemetry.currentReviewTelemetry({ openAiCalled: false }, "legacy-unmeasured", "awaiting_review",
  { reviewOutcome: "technical_failure" }).legacyReviewObservation.observedCommitteeCompleted, null);

await inSimpleAlertPilot(async () => {
  const h = terminalHarness();
  h.state.verdict = "needs_more_data";
  const historical = await h.runRunner();
  const decision = structuredClone(h.journal.decisions[0]);
  h.advance(86400000);
  h.state.factsRevision = 1;
  h.state.failRole = "final_judge";
  h.state.failRoleStatus = "prompt_too_large";
  const failed = await h.runRunner();
  const event = h.newEvent("current-failure");
  const first = (await evidence(h, failed, event)).quality;
  assert.equal(first.committeeCompleted, false);
  assert.equal(first.committeeRolesCompleted, 3);
  assert.equal(first.committeeRolesFailed, 1);
  assert.equal(first.reviewOutcome, "technical_failure");
  assert.equal(first.lastPaidAttempt.fingerprint, failed.candidateFingerprint);
  const originalAttempt = structuredClone(first.lastPaidAttempt);
  const receiptsBefore = [...h.objects].filter(([key]) => key.includes("terminal-reviews-v1/attempts/"));
  const calls = h.state.roleCalls, admissions = h.state.moneyCalls;
  h.advance(3600000);
  h.state.factsRevision = 0;
  const reused = await h.runRunner();
  const refreshed = (await evidence(h, reused, event)).quality;
  assert.equal(reused.openAiCalled, false);
  assert.deepEqual(reused.committee, historical.committee);
  assert.equal(h.state.roleCalls, calls);
  assert.equal(h.state.moneyCalls, admissions);
  assert.deepEqual(h.journal.decisions, [decision]);
  assert.deepEqual([...h.objects].filter(([key]) => key.includes("terminal-reviews-v1/attempts/")), receiptsBefore);
  assert.equal(refreshed.committeeCompleted, false);
  assert.equal(refreshed.committeeRolesCompleted, 0);
  assert.equal(refreshed.committeeRolesFailed, 0);
  assert.equal(refreshed.currentPassPaidReview, false);
  assert.equal(refreshed.assessmentOutcome, "historical_review_reused");
  assert.equal(refreshed.reviewOutcome, "technical_failure");
  assert.deepEqual(refreshed.lastPaidAttempt, originalAttempt);
  assert.deepEqual(refreshed.historicalReview, {
    source: "terminal_decision", decisionKey: decision.decisionKey, fingerprint: decision.fingerprint,
    outcome: "needs_more_data", sourceEventId: decision.eventId, decidedAt: decision.decidedAt,
    resultKey: null, committeeStartedAt: historical.committee.startedAt, committeeFinishedAt: historical.committee.finishedAt,
    committeeCompleted: true, committeeRolesCompleted: 4, committeeRolesFailed: 0, confidence: historical.committee.finalJudge.confidence,
  });
  assert.equal(refreshed.timing.firstCompletedCommitteeAt, null);
  assert.equal(refreshed.timing.committeeStartedAt, null);
  assert.equal(refreshed.timing.committeeFinishedAt, null);
  assert.equal(daily(h).completedCommitteeReviews, 0);
  assert.equal(daily(h).historicalReviewReusedEvents, 1);
  assert.equal(daily(h).reviewOutcomes.technical_failure, 1);
  assert.equal(daily(h).samples[0].paidReview, true);
  assert.equal(card(h).committee.completed, 0);
  assert.equal(card(h).committee.source, "none");
  assert.deepEqual(card(h).quality.lastPaidAttempt, originalAttempt);
  assert.equal(card(h).completedReview.committee.agentsCompleted, 4);
  assert.equal(card(h).completedReview.fingerprint, historical.candidateFingerprint);
  assert.equal(reused.seriousSignalFound, false);
  assert.equal(card(h).committeeApproved, false);
  assert.equal(card(h).publicationStatus, "provisional_alert");
  const publicRows = assemblePublicSignals([], [card(h)]);
  assert.equal(publicRows.length, 1);
  assert.equal(publicRows[0].committeeApproved, false);
  assert.deepEqual(publicRows[0].reviewProvenance, { source: "historical_terminal_decision", decidedAt: decision.decidedAt });
  assert.equal(publicRows[0].confidence, historical.committee.finalJudge.confidence, "A score bound to the reused completed decision remains available");
  assert.equal(publicRows[0].confidenceBasis, "historical_committee_review", "Historical confidence must not be presented as a new current attempt");

  // Simulate an existing pre-fix followup, card and daily sample at the upgrade
  // boundary. Its explicit failure survives, without upgrading it into a fully
  // identified paid attempt or inventing the missing original attempt date.
  const legacyQuality = { committeeCompleted: false, committeeRolesCompleted: 3, reviewOutcome: "technical_failure",
    timing: { firstCompletedCommitteeAt: null }, paidReview: true };
  assert.equal(metrics.summarizeEvidenceQuality([legacyQuality]).reviewOutcomes.technical_failure, 1);
  const replaceStoredQuality = quality => {
    for (const [key, stored] of h.objects) {
      if (key.includes("research-evidence/followups/")) stored.value.quality = structuredClone(quality);
      if (key === h.modules.research.RESEARCH_ALERT_INDEX_KEY) stored.value.alerts[0].quality = structuredClone(quality);
      if (key.includes("research-evidence/quality/")) stored.value.samples = [{ ...structuredClone(quality), eventId: event.id }];
    }
  };
  replaceStoredQuality(legacyQuality);
  const migratedFailure = (await evidence(h, reused, event)).quality;
  assert.equal(migratedFailure.reviewOutcome, "technical_failure");
  assert.equal(migratedFailure.lastPaidAttempt, null);
  assert.equal(migratedFailure.legacyReviewObservation.attemptProvenance, "unknown");
  assert.equal(migratedFailure.legacyReviewObservation.observedRolesCompleted, 3);
  assert.equal(migratedFailure.legacyReviewObservation.observedRolesFailed, null, "The old quality row did not store failed-role count");
  assert.equal(migratedFailure.legacyReviewObservation.observationCheckedAt, null);
  assert.equal(daily(h).completedCommitteeReviews, 0);
  assert.equal(daily(h).reviewOutcomes.technical_failure, 1);
  const retainedLegacyFailure = (await evidence(h, reused, event)).quality;
  assert.deepEqual(retainedLegacyFailure.legacyReviewObservation, migratedFailure.legacyReviewObservation);
  replaceStoredQuality({ ...legacyQuality, reviewOutcome: "incomplete_evidence", committeeCompleted: true, committeeRolesCompleted: 4 });
  const migratedAmbiguous = (await evidence(h, reused, event)).quality;
  assert.equal(migratedAmbiguous.reviewOutcome, "historical_review_reused");
  assert.equal(migratedAmbiguous.lastPaidAttempt, null);
  assert.equal(migratedAmbiguous.legacyReviewObservation.observedCommitteeCompleted, true);
  assert.equal(migratedAmbiguous.legacyReviewObservation.attemptProvenance, "unknown");
  assert.equal(daily(h).completedCommitteeReviews, 0);
  assert.equal(daily(h).reviewOutcomes.technical_failure, 0, "A failure already overwritten before upgrade cannot be reconstructed from this sample");
  assert.equal(daily(h).unknownReviewProvenanceEvents, 1);

  // A genuinely new current completion counts once, survives unpaid same-event
  // refreshes, and cannot be counted again by an unpaid daily alias or UTC rollover.
  const fresh = terminalHarness();
  fresh.state.verdict = "needs_more_data";
  const completed = await fresh.runRunner();
  const freshEvent = fresh.newEvent("paid-completion");
  const completedQuality = (await evidence(fresh, completed, freshEvent)).quality;
  assert.equal(completedQuality.committeeCompleted, true);
  assert.equal(completedQuality.committeeRolesCompleted, 4);
  assert.equal(completedQuality.historicalReview, null);
  assert.equal(completedQuality.timing.firstCompletedCommitteeAt, completed.committee.finishedAt);
  assert.equal(daily(fresh).completedCommitteeReviews, 1);
  fresh.advance(60000);
  const sameDayReuse = await fresh.runRunner();
  await evidence(fresh, sameDayReuse, freshEvent);
  await evidence(fresh, sameDayReuse, freshEvent);
  await evidence(fresh, sameDayReuse, fresh.newEvent("unpaid-alias"));
  assert.equal(daily(fresh).completedCommitteeReviews, 1);
  assert.equal(daily(fresh).samples.length, 2);
  fresh.advance(86400000);
  await evidence(fresh, await fresh.runRunner(), freshEvent);
  assert.equal(daily(fresh).completedCommitteeReviews, 0);
  assert.equal(daily(fresh).historicalReviewReusedEvents, 1);
  assert.equal(daily(fresh).samples[0].lastPaidAttempt.checkedAt, completed.checkedAt);

  // Unknown legacy is a hold with no proof, invented reviewer or invented date.
  const legacy = terminalHarness();
  const probe = await legacy.runRunner({ allowOpenAi: false });
  const held = await legacy.runRunner({ terminalReview: query => legacy.modules.journal.checkTerminalReview({ ...query,
    legacy: { cik: legacy.identity.cik, fingerprint: probe.candidateFingerprint, outcome: "unknown", completionProven: false } }) });
  const unknown = (await evidence(legacy, held, legacy.newEvent("legacy-hold"))).quality;
  assert.equal(held.openAiCalled, false);
  assert.equal(held.committee, undefined);
  assert.equal(unknown.committeeCompleted, false);
  assert.equal(unknown.committeeRolesCompleted, 0);
  assert.equal(unknown.lastPaidAttempt, null);
  assert.equal(unknown.historicalReview, null);
  assert.equal(unknown.reviewOutcome, "unknown_history");
  assert.equal(unknown.timing.firstCompletedCommitteeAt, null);
  assert.equal(daily(legacy).unknownReviewProvenanceEvents, 1);
  assert.equal(telemetry.currentReviewTelemetry({ openAiCalled: false,
    terminalReviewHold: { reason: "terminal_legacy_provenance_unknown", outcome: "approved" } }, "legacy-approved", "awaiting_review").assessmentOutcome,
  "unknown_history", "A stored legacy verdict without full provenance is not a current completion");
  const undatedHistory = telemetry.historicalReviewTelemetry({ committee: historical.committee });
  assert.equal(undatedHistory.decidedAt, null);
  assert.equal(undatedHistory.sourceEventId, null);
  const legacySamples = [{ eventId: "old-unknown", paidReview: true, committeeCompleted: true,
    committeeRolesCompleted: 4, reviewOutcome: "incomplete_evidence", timing: { firstCompletedCommitteeAt: null } }];
  const legacySummary = metrics.summarizeEvidenceQuality(legacySamples);
  assert.equal(legacySummary.completedCommitteeReviews, 0);
  assert.equal(legacySummary.historicalReviewReusedEvents, 0, "Legacy role totals alone cannot prove a historical decision either");
  assert.equal(legacySummary.unknownReviewProvenanceEvents, 1);
  const acrossMidnight = { reviewTelemetryVersion: 2, eventId: "midnight", checkedAt: "2026-10-06T00:02:00Z",
    lastPaidAttempt: { eventId: "midnight", checkedAt: "2026-10-05T23:59:00Z", committeeCompleted: true,
      committeeFinishedAt: "2026-10-05T20:01:00-04:00" } };
  assert.equal(metrics.summarizeEvidenceQuality([acrossMidnight]).completedCommitteeReviews, 1,
    "Completion belongs to its actual UTC finish date, including an attempt started the prior day");
  assert.equal(metrics.summarizeEvidenceQuality([{ ...acrossMidnight,
    lastPaidAttempt: { ...acrossMidnight.lastPaidAttempt, committeeFinishedAt: null } }]).completedCommitteeReviews, 0,
    "Missing completion dates cannot be replaced by the date of this assessment");

  // Public dataQuality shape: three proven historical reuses and three unpaid
  // incomplete assessments, with no current-day paid attempt or review timing.
  const publicShape = terminalHarness();
  publicShape.state.verdict = "needs_more_data";
  await publicShape.runRunner();
  publicShape.advance(86400000);
  for (let i = 0; i < 3; i++) await evidence(publicShape, await publicShape.runRunner(), publicShape.newEvent(`history-${i}`));
  for (let i = 0; i < 3; i++) await evidence(publicShape, { openAiCalled: false, status: "no_qualified_signal" }, publicShape.newEvent(`unpaid-${i}`));
  const publicQuality = await publicShape.modules.research.readEvidenceQuality(publicShape.state.now);
  assert.equal(publicQuality.uniqueEvents, 6);
  assert.equal(publicQuality.completedCommitteeReviews, 0);
  assert.equal(publicQuality.historicalReviewReusedEvents, 3);
  assert.equal(publicQuality.timing.committeeDurationMinutes.measuredEvents, 0);
  assert.equal(publicQuality.timing.eventToCompletedCommitteeMinutes.measuredEvents, 0);
  assert.match(publicQuality.reviewOutcomeMeaning, /not an attempt-based reliability denominator/);
});

console.log("Review telemetry passed: paid partial failure retained through historical reuse; current/historical roles separated; genuine completions, aliases and UTC rollover; unknown legacy; unchanged terminal receipts/admission; public provenance and six-event quality projection.");
