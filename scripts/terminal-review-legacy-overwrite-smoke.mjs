import assert from "node:assert/strict";
import crypto from "node:crypto";
import { terminalHarness } from "./terminal-review-runner-smoke.mjs";
import { inSimpleAlertPilot } from "./helpers/simple-alert-pilot-fixture.mjs";

const auditKey = h => [...h.objects.keys()].find(key => key.includes("/nonterminal-audits/"));
const copy = value => structuredClone(value);
const clearJournal = h => {
  for (const key of h.objects.keys()) if (key.includes("/terminal-reviews-v1/")) h.objects.delete(key);
};
const recordFinishedTiming = async (h, result) => {
  const key = result.result.resultKey ?? result.result.nonterminalAuditKey;
  const payload = h.objects.get(key).value;
  // The harness uses a frozen job clock. Let the real legacy writer observe
  // the Committee finish time, as it does under the advancing live clock.
  await h.modules.research.recordResearchEvidence({ event: payload.event, report: result.report,
    sourceDecisionGrade: true, sourceFailureReason: null,
    now: new Date(Date.parse(result.report.committee.finishedAt) + 1),
    ...(result.result.seriousSignalFound ? { approvedResultKey: key } : {}) });
};

await inSimpleAlertPilot(async () => {
  for (const [verdict, outcome] of [["positive", "approved"], ["negative", "rejected"], ["needs_more_data", "needs_more_data"]]) {
    // Obtain both reports from the actual event job, runner and Committee. The
    // two isolated stores represent the pre-journal code's completed attempt
    // followed by a technical attempt that overwrote its mutable legacy card.
    const h = terminalHarness({ eventMode: "sec", eventAliases: false });
    h.state.verdict = verdict;
    const first = await h.runJob();
    assert.equal(first.result.openAiCalled, true);
    assert.equal(h.journal.decisions[0].outcome, outcome);
    await recordFinishedTiming(h, first);
    const firstKey = first.result.resultKey ?? first.result.nonterminalAuditKey;
    const originalPayload = copy(h.objects.get(firstKey));
    const originalFingerprint = first.report.candidateFingerprint;
    const originalFinishedAt = first.report.committee.finishedAt;
    const indexKey = h.modules.research.RESEARCH_ALERT_INDEX_KEY;
    const originalCard = copy(h.objects.get(indexKey).value.alerts[0]);
    assert.equal(originalCard.quality.timing.firstCompletedCommitteeAt, originalFinishedAt);

    const failed = terminalHarness({ eventMode: "sec", eventAliases: false });
    failed.state.now = new Date(h.state.now.getTime() + 120000);
    failed.state.factsRevision = 1;
    failed.state.failRole = outcome === "needs_more_data" ? "analyst_agent" : "skeptic_agent";
    failed.state.failRoleStatus = outcome === "needs_more_data" ? "prompt_too_large" : "provider_error";
    const technical = await failed.runJob();
    assert.equal(technical.result.openAiCalled, true);
    assert.ok(technical.report.committee.agentsFailed > 0);
    if (outcome === "needs_more_data") {
      assert.equal(technical.report.committee.agentsCompleted, 0);
      assert.equal(technical.report.committee.output.modelUsageSummary.actualOpenAiUsage.responsesWithUsage, 0,
        "A later definite zero-usage preflight cannot erase the original completed insufficiency");
    } else assert.ok(technical.report.committee.agentsCompleted > 0, "Real partial paid failure must not terminalize");
    assert.notEqual(technical.report.candidateFingerprint, originalFingerprint);
    const overwritten = copy(failed.objects.get(indexKey));
    // This is the exact pre-preservation shape: current failed counts and B's
    // fingerprint, retained first-completion timing, no completedReview field.
    delete overwritten.value.alerts[0].completedReview;
    overwritten.value.alerts[0].quality.timing.firstCompletedCommitteeAt = originalFinishedAt;
    h.objects.set(indexKey, overwritten);
    const failedKey = auditKey(failed);
    h.objects.set(failedKey, copy(failed.objects.get(failedKey)));
    clearJournal(h);
    const immutableBefore = copy([...h.objects].filter(([key]) => key === firstKey || key === failedKey));
    const signal = new AbortController().signal;
    const recovered = await h.modules.research.readLegacyTerminalReviews(h.identity.cik, signal);
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].fingerprint, originalFingerprint, "Recovery must use A's immutable fingerprint, never technical B's display fingerprint");
    assert.equal(recovered[0].outcome, outcome);
    assert.equal(recovered[0].completionProven, true);
    assert.deepEqual(recovered[0].primarySourceProvenance.sources, first.report.selectedCandidate.receipts);
    assert.equal(recovered[0].primarySourceProvenance.eventObservedAt, first.report.selectedCandidate.eventObservedAt);
    h.objects.get(firstKey).value.event.observedAt = "2020-01-01T00:00:00.000Z";
    const envelopeChanged = await h.modules.research.readLegacyTerminalReviews(h.identity.cik, signal);
    assert.equal(envelopeChanged[0].primarySourceProvenance.eventObservedAt, first.report.selectedCandidate.eventObservedAt,
      "Unhashed envelope timing cannot manufacture novelty; only original report publication timing counts");
    h.objects.set(firstKey, copy(originalPayload));
    assert.ok(h.reads.filter(row => row.operation === "list").every(row => row.options.signal === signal));
    assert.deepEqual(h.objects.get(indexKey), overwritten, "Migration never edits the legacy source index");
    assert.deepEqual(h.objects.get(firstKey), originalPayload);

    const paidCalls = h.state.roleCalls, moneyCalls = h.state.moneyCalls;
    h.state.eventAliases = true;
    h.advance(13 * 3600000); h.reload();
    assert.equal((await h.runJob()).result.openAiCalled, false, `${outcome} survives the old 12-hour cooldown`);
    assert.equal(h.journal.legacy[0].fingerprint, originalFingerprint);
    assert.equal(h.journal.legacy[0].outcome, outcome);
    h.advance(24 * 3600000); h.reload();
    assert.equal((await h.runJob()).result.openAiCalled, false, `${outcome} survives restart and a new daily alias`);
    assert.equal(h.state.roleCalls, paidCalls);
    assert.equal(h.state.moneyCalls, moneyCalls, "Migration must hold before money admission");
    assert.deepEqual([...h.objects].filter(([key]) => key === firstKey || key === failedKey), immutableBefore);
    h.state.sourceRevision++;
    h.state.sourcePublishedAt = h.state.now.toISOString();
    h.newEvent();
    assert.equal((await h.runJob()).result.openAiCalled, true, "An authenticated later SEC accession remains eligible");

    // A failed attempt without any retained prior-completion evidence remains
    // on the normal recovery path; no role failure is fabricated into a verdict.
    assert.deepEqual(await failed.modules.research.readLegacyTerminalReviews(failed.identity.cik), []);
  }

  const history = terminalHarness({ eventMode: "sec", eventAliases: false });
  history.state.verdict = "needs_more_data";
  const complete = await history.runJob();
  await recordFinishedTiming(history, complete);
  const key = complete.result.nonterminalAuditKey;
  const intact = copy(history.objects.get(key));
  const indexKey = history.modules.research.RESEARCH_ALERT_INDEX_KEY;
  const index = history.objects.get(indexKey).value;
  const row = index.alerts[0];
  delete row.completedReview;
  row.committee = { completed: 0, failed: 5 };
  row.quality.committeeCompleted = false;
  row.reviewEvidenceFingerprint = "newer-technical-fingerprint";
  clearJournal(history);
  history.state.eventAliases = true;
  history.advance(37 * 3600000);
  const paidCalls = history.state.roleCalls, moneyCalls = history.state.moneyCalls;
  for (const fault of ["missing", "bad-hash", "partial", "wrong-identity", "wrong-fingerprint", "truncated", "timeout"]) {
    history.objects.set(key, copy(intact));
    history.state.historyFault = fault;
    if (fault === "missing") history.objects.delete(key);
    if (fault === "bad-hash") history.objects.get(key).value.report.candidateFingerprint = "tampered";
    if (["partial", "wrong-identity", "wrong-fingerprint"].includes(fault)) {
      // A correctly re-keyed object still has to prove the real completion and
      // exact issuer/fingerprint contracts, independently from content hashing.
      const payload = history.objects.get(key).value;
      if (fault === "partial") payload.report.committee.agentsFailed = 1;
      if (fault === "wrong-identity") payload.report.selectedCandidate.cik = "0000000001";
      if (fault === "wrong-fingerprint") payload.report.selectedCandidate.evidenceFingerprint = "wrong";
      payload.auditId = crypto.createHash("sha256").update(JSON.stringify({ eventId: payload.event.id, attemptCheckedAt: payload.attemptCheckedAt, report: payload.report })).digest("hex");
      const changedKey = key.replace(/[a-f0-9]{24}\.json$/, `${payload.auditId.slice(0, 24)}.json`);
      history.objects.set(changedKey, history.objects.get(key));
      history.objects.delete(key);
    }
    await assert.rejects(() => history.runJob(), /terminal_review_legacy_|fixture_history_timeout/, fault);
    assert.equal(history.state.roleCalls, paidCalls, `${fault}: unavailable history must never be considered new evidence`);
    assert.equal(history.state.moneyCalls, moneyCalls);
    assert.equal(history.journal?.decisions.length ?? 0, 0);
    for (const objectKey of history.objects.keys()) if (objectKey.includes("/nonterminal-audits/")) history.objects.delete(objectKey);
  }
  history.state.historyFault = null;
  history.objects.set(key, intact);
  history.reload();
  assert.equal((await history.runJob()).result.openAiCalled, false, "Restoring the authentic immutable body repairs the unpaid history hold");
  assert.equal(history.journal.legacy[0].outcome, "needs_more_data");
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(history.modules.research.readLegacyTerminalReviews(history.identity.cik, aborted.signal), /abort/i);
  // Synthetic boundary timestamps on the real report exercise an attempt that
  // started yesterday and completed just after midnight.
  const boundary = copy(intact);
  boundary.value.attemptCheckedAt = boundary.value.report.checkedAt = "2026-10-05T23:59:00.000Z";
  boundary.value.report.committee.startedAt = "2026-10-05T23:59:00.000Z";
  boundary.value.report.committee.finishedAt = "2026-10-06T00:00:10.000Z";
  boundary.value.auditId = crypto.createHash("sha256").update(JSON.stringify({ eventId: boundary.value.event.id,
    attemptCheckedAt: boundary.value.attemptCheckedAt, report: boundary.value.report })).digest("hex");
  const boundaryKey = key.replace(/[a-f0-9]{24}\.json$/, `${boundary.value.auditId.slice(0, 24)}.json`);
  history.objects.delete(key);
  history.objects.set(boundaryKey, boundary);
  row.quality.timing.firstCompletedCommitteeAt = boundary.value.report.committee.finishedAt;
  history.objects.set(indexKey, { value: { version: 1, alerts: [row] }, etag: "boundary-card" });
  clearJournal(history);
  const overnight = await history.modules.research.readLegacyTerminalReviews(history.identity.cik);
  assert.equal(overnight[0].fingerprint, complete.report.candidateFingerprint);
  assert.ok(history.reads.some(row => row.operation === "list" && row.key.includes("/nonterminal-audits/2026-10-06/")));
  assert.ok(history.reads.some(row => row.operation === "list" && row.key.includes("/nonterminal-audits/2026-10-05/")));
  console.log("Legacy overwrite integration passed: actual completed/technical reports, all outcomes, original immutable fingerprint/provenance, expiry/restart aliases, later SEC evidence, corruption/missing/truncated/timeout/abort holds, and partial-only recovery.");
});
