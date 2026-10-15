import assert from "node:assert/strict";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { terminalHarness } from "./terminal-review-runner-smoke.mjs";
import { inSimpleAlertPilot } from "./helpers/simple-alert-pilot-fixture.mjs";

// Real collector, runner, Committee orchestration, journal, research persistence
// and event job; synthetic transport/storage/provider replies only.
let blockedNetworkAttempts = 0;
const blocked = () => { blockedNetworkAttempts++; throw new Error("live_network_forbidden"); };
globalThis.fetch = blocked;
http.request = http.get = https.request = https.get = blocked;
net.Socket.prototype.connect = blocked;
const hour = 3600000;
const observations = [];
const baselineRoot = process.env.FINANCIAL_COMPLETENESS_BASELINE_ROOT;
const baselineHarness = baselineRoot
  ? (await import(pathToFileURL(`${baselineRoot}/scripts/terminal-review-runner-smoke.mjs`))).terminalHarness : null;
const financialKey = h => h.key(`research-evidence/financial-documents/${h.identity.cik}.json`);
const raw = h => h.objects.get(financialKey(h)).value;
const collect = h => h.modules.financial.collectFinancialDocuments(h.identity.cik, h.fetchImpl, h.state.now);
const stripProof = documents => ({ ...documents, documents: documents.documents.map(value => {
  const document = { ...value }; delete document.transportProof; return document;
}) });
const setRaw = (h, value) => h.objects.set(financialKey(h), { value: structuredClone(value), etag: '"synthetic-old-cache"' });
const keyProjection = report => ({ fingerprint: report.candidateFingerprint,
  snapshot: report.selectedCandidate.reviewEvidenceSnapshot, baseline: report.selectedCandidate.valuationBaseline,
  terminal: report.selectedCandidate.terminalEvidence });
const transfer = (from, to) => {
  Object.assign(to.state, structuredClone(from.state));
  for (const [key, value] of from.objects) to.objects.set(key, structuredClone(value));
  to.reload();
};
const recordResearch = (h, report, extra = {}) => h.modules.research.recordResearchEvidence({
  event: { ...h.identity, id: "synthetic-proof-event", observedAt: h.state.now.toISOString() }, report,
  sourceDecisionGrade: true, sourceFailureReason: null, now: h.state.now, ...extra });

await inSimpleAlertPilot(async () => {
  const complete = terminalHarness({ useFinancialCollector: true });
  const fresh = await collect(complete), doc = fresh.documents[0], financial = complete.modules.financial;
  assert.equal(financial.financialDocumentCompleteness(doc), "complete");
  assert.equal(doc.transportProof.httpStatus, 200);
  assert.equal(doc.transportProof.reachedEof, true);
  const legacy = stripProof(fresh);
  assert.equal(financial.financialDocumentCompleteness(legacy.documents[0]), "unknown");
  assert.equal(financial.financialDocumentCompleteness({ ...legacy.documents[0], readComplete: false }), "partial");
  const unknownView = financial.financialDocumentsEvidenceView(legacy);
  assert.equal(unknownView.documents[0].readComplete, false);
  assert.equal(unknownView.documents[0].transportCompleteness, "unknown");
  assert.deepEqual(financial.financialDocumentsEvidenceView(unknownView), unknownView);
  assert.deepEqual(unknownView.documents[0].excerpts, doc.excerpts);
  for (const field of ["url", "accession", "form", "filedAt", "reportingPeriod", "digest", "collectedAt"]) {
    assert.equal(financial.financialDocumentCompleteness({ ...doc, [field]: `${doc[field]}-changed` }), "unknown", field);
  }
  for (const mutation of [{ version: 2 }, { httpStatus: 206 }, { httpStatus: "200" }, { reachedEof: false },
    { reachedEof: "true" }, { documentKey: "copied-or-stale" }]) {
    assert.equal(financial.financialDocumentCompleteness({ ...doc, transportProof: { ...doc.transportProof, ...mutation } }), "unknown");
  }
  assert.equal(financial.financialDocumentCompleteness({ ...doc, excerpts: [...doc.excerpts, { topic: "segments", text: "changed" }] }), "unknown");
  observations.push({ test: "Actual 200/EOF and bound metadata", complete: true, legacy: "unknown", partial: "partial", tamperCases: 14 });

  const old = terminalHarness({ useFinancialCollector: true }); setRaw(old, legacy);
  const before = structuredClone(raw(old));
  const initial = await collect(old);
  assert.equal(initial.cached, true); assert.equal(old.fetches.length, 0); assert.equal(old.writes.length, 0);
  for (let i = 0; i < 5; i++) { old.advance(7 * hour); await collect(old); }
  assert.deepEqual(raw(old).documents, before.documents);
  assert.equal(old.fetches.length, 5); assert.ok(old.fetches.every(url => url.includes("/submissions/")));
  assert.equal(old.writes.length, 5);
  const oldReport = await old.runRunner({ allowOpenAi: false });
  assert.equal(oldReport.selectedCandidate.financialDocuments.documents[0].transportCompleteness, "unknown");
  if (baselineHarness) {
    const base = baselineHarness({ useFinancialCollector: true }); setRaw(base, legacy);
    await collect(base);
    for (let i = 0; i < 5; i++) { base.advance(7 * hour); await collect(base); }
    const baseReport = await base.runRunner({ allowOpenAi: false });
    assert.deepEqual(old.fetches, base.fetches);
    assert.deepEqual(old.writes, base.writes);
    assert.deepEqual(keyProjection(oldReport), keyProjection(baseReport), "Exact ab20 identity projections must survive outward proof downgrade");
  }
  observations.push({ test: "35-hour legacy cache", indexReads: 5, filingReads: 0, writes: 5,
    rawDocumentsUnchanged: true, exactBaselineKeysCompared: Boolean(baselineHarness), fingerprint: oldReport.candidateFingerprint });

  // First successful Committee can be positive while publication is held. Its
  // actual completion is preserved in journal and research persistence.
  const unknown = terminalHarness({ useFinancialCollector: true }); setRaw(unknown, legacy);
  const held = await unknown.runRunner();
  assert.equal(held.openAiCalled, true); assert.equal(held.seriousSignalFound, false);
  assert.equal(held.committee.finalJudge.verdict, "positive");
  assert.equal(held.reviewOutcome, "insufficient_evidence");
  assert.equal(unknown.journal.decisions[0].outcome, "needs_more_data");
  assert.equal(unknown.journal.decisions[0].publicationGatePassed, held.selectedCandidate.gatePassed,
    "The historical candidate gate remains unchanged; it is not transport proof");
  assert.ok(JSON.stringify(unknown.prompts).includes('"transportCompleteness":"unknown"'));
  assert.ok(JSON.stringify(unknown.prompts).includes("excerpts are selected windows"));
  const quality = await recordResearch(unknown, held);
  assert.equal(quality.quality.fields.financialDocuments, false);
  assert.equal(quality.quality.fields.financialFacts, true, "Valid numeric facts cannot establish whole-document response coverage");
  const persisted = unknown.objects.get(unknown.modules.research.RESEARCH_ALERT_INDEX_KEY).value.alerts[0];
  assert.equal(persisted.financialDocuments.documents[0].transportCompleteness, "unknown");
  assert.equal(persisted.committeeApproved, false);
  assert.equal(persisted.completedReview.committee.output.overallRecommendation, "needs_more_data");
  assert.deepEqual(unknown.modules.research.evidenceTasks(held).tasks,
    unknown.modules.research.evidenceTasks({ ...held, blockers: [], researchReview: {}, committee: {} }).tasks,
    "Unknown transport diagnostics cannot schedule extra source or financial retrieval tasks");
  const paid = unknown.state.roleCalls, money = unknown.state.moneyCalls;
  assert.equal((await unknown.runRunner()).openAiCalled, false);
  assert.equal(unknown.state.roleCalls, paid); assert.equal(unknown.state.moneyCalls, money);

  const approved = terminalHarness({ useFinancialCollector: true });
  const first = await approved.runRunner();
  assert.equal(first.seriousSignalFound, true, JSON.stringify(first));
  await recordResearch(approved, first, { approvedResultKey: "synthetic/approved-result.json" });
  const approvedCard = approved.objects.get(approved.modules.research.RESEARCH_ALERT_INDEX_KEY).value.alerts[0];
  const identity = keyProjection(first), decision = structuredClone(approved.journal.decisions[0]);
  setRaw(approved, stripProof(raw(approved)));
  const replay = await approved.runRunner();
  assert.deepEqual(keyProjection(replay), identity);
  assert.equal(replay.openAiCalled, false); assert.equal(replay.seriousSignalFound, false);
  assert.equal(replay.reviewOutcome, "approved_pending_checks");
  assert.deepEqual(approved.journal.decisions[0], decision);
  assert.equal(approved.state.moneyCalls, 1);
  observations.push({ test: "Fresh positive hold and approved replay", historicalApprovalRetained: true, addedReviewCalls: 0 });

  // Defensive runner gate: explicitly synthetic approved Committee output, not
  // the real orchestrator's needs_more_data response to the unknown-body gap.
  const syntheticCommitteeResult = { ok: true, status: "completed", committeeOutput: first.committee.output,
    agentResults: first.committee.output.modelUsageSummary.reviewPlan.agentIds.map(agentId => ({ agentId, status: "completed",
      verdict: "positive", confidence: 95, keyFindings: [], concerns: [], missingData: [], followUpChecks: [] })) };
  const defensive = terminalHarness({ useFinancialCollector: true, syntheticCommitteeResult }); setRaw(defensive, legacy);
  const defensiveReport = await defensive.runRunner();
  assert.equal(defensiveReport.committee.output.overallRecommendation, "approve");
  assert.equal(defensiveReport.reviewOutcome, "approved_pending_checks");
  assert.equal(defensiveReport.seriousSignalFound, false);
  assert.equal(defensive.journal.decisions[0].outcome, "approved");
  observations.push({ test: "Explicit synthetic approval tests defensive fresh gate", publicationHeld: true });

  for (const [name, mutate, expected] of [
    ["206 prefix reaches EOF", h => { h.state.filingStatus = 206; }, null],
    ["complete source exceeds byte budget", h => { h.state.filingMode = "capped"; }, "partial"],
    ["interrupted response", h => { h.state.filingMode = "interrupted"; }, null],
    ["206 index", h => { h.state.indexStatus = 206; }, null],
  ]) {
    const h = terminalHarness({ useFinancialCollector: true }); mutate(h);
    const report = await h.runRunner();
    assert.equal(report.seriousSignalFound, false, name);
    assert.equal(h.modules.financial.financialDocumentsReady(raw(h)), false);
    if (expected) assert.equal(report.selectedCandidate.financialDocuments.documents[0].transportCompleteness, expected);
    else assert.deepEqual(raw(h).documents, []);
    assert.ok(raw(h).documents.every(row => !row.transportProof));
    const outcome = await recordResearch(h, report);
    assert.equal(outcome.quality.fields.financialDocuments, false);
  }

  // Persisted old cards are projected without migration writes. A second
  // collection cannot restore current approval from the same old snapshot.
  const card = terminalHarness();
  const oldCard = { ...approvedCard, committeeApproved: true, committeeStatus: "approved", publicationStatus: "committee_approved_alert",
    financialDocuments: legacy, completedReview: { ...approvedCard.completedReview, confidence: 0 } };
  card.objects.set(card.modules.research.RESEARCH_ALERT_INDEX_KEY, { value: { version: 1, alerts: [oldCard] }, etag: '"old-card"' });
  const oldCardBytes = JSON.stringify(card.objects.get(card.modules.research.RESEARCH_ALERT_INDEX_KEY));
  const [shown] = await card.modules.research.readResearchAlerts();
  assert.equal(shown.committeeApproved, false); assert.equal(shown.committeeStatus, "approved");
  assert.equal(shown.completedReview.confidence, 0); assert.deepEqual(shown.completedReview, oldCard.completedReview);
  assert.equal(shown.financialDocuments.documents[0].transportCompleteness, "unknown");
  assert.equal(shown.quality.fields.financialDocuments, false);
  assert.equal(JSON.stringify(card.objects.get(card.modules.research.RESEARCH_ALERT_INDEX_KEY)), oldCardBytes);
  assert.equal(card.writes.length, 0);
  for (let pass = 0; pass < 2; pass++) {
    await recordResearch(card, { ...held, openAiCalled: false, committee: undefined });
    const [shownAgain] = await card.modules.research.readResearchAlerts();
    assert.equal(shownAgain.committeeApproved, false);
    assert.equal(shownAgain.completedReview.confidence, 0);
    assert.equal(shownAgain.completedReview.committee.output.overallRecommendation, "approve");
  }
  const unrelated = { ticker: "AIOT", cik: card.identity.cik, kind: "event", eventFamily: "contract_award",
    financialDocumentsRequired: false, financialDocumentsRequirementKnown: true,
    committeeStatus: "approved", committeeApproved: true, publicationStatus: "committee_approved_alert" };
  card.objects.set(card.modules.research.RESEARCH_ALERT_INDEX_KEY, { value: { version: 1, alerts: [unrelated] }, etag: '"unrelated"' });
  assert.deepEqual((await card.modules.research.readResearchAlerts())[0], unrelated);
  const ambiguous = { ...unrelated }; delete ambiguous.financialDocumentsRequired; delete ambiguous.financialDocumentsRequirementKnown;
  card.objects.set(card.modules.research.RESEARCH_ALERT_INDEX_KEY, { value: { version: 1, alerts: [ambiguous] }, etag: '"old-unknown-dependency"' });
  const [ambiguousView] = await card.modules.research.readResearchAlerts();
  assert.equal(ambiguousView.committeeApproved, false); assert.equal(ambiguousView.committeeStatus, "approved");
  assert.equal(ambiguousView.financialDocumentsRequirementKnown, false);
  observations.push({ test: "Stored-card read and repeated refresh", migrationWrites: 0, historicalZeroConfidencePreserved: true, unrelatedEventUnchanged: true });

  for (const eventFamily of ["valuation_gap", "earnings_guidance", "financing_dilution", "merger_acquisition"]) {
    const h = terminalHarness();
    const report = { ...held, selectedCandidate: { ...held.selectedCandidate, eventFamily } };
    const { quality } = await recordResearch(h, report);
    const storedQuality = h.objects.get(h.modules.research.RESEARCH_ALERT_INDEX_KEY).value.alerts[0].quality;
    const [readback] = await h.modules.research.readResearchAlerts();
    assert.equal(quality.fields.financialDocuments, false, eventFamily);
    assert.equal(quality.applicability.financialDocuments, true, eventFamily);
    assert.deepEqual(storedQuality, quality, `${eventFamily}: persisted score must match returned score`);
    assert.deepEqual(readback.quality, quality, `${eventFamily}: readback score must match persisted score`);
  }
  const excluded = terminalHarness();
  excluded.objects.set(excluded.modules.research.RESEARCH_ALERT_INDEX_KEY, { value: { version: 1, alerts: [{ ...oldCard,
    kind: "event", eventFamily: "earnings_guidance", quality: { fields: { financialDocuments: true, issuer: true, direction: false },
      applicability: { financialDocuments: false }, availableFields: 1, requiredFields: 2, completenessPercent: 50 } }] }, etag: '"excluded"' });
  const [corrected] = await excluded.modules.research.readResearchAlerts();
  assert.equal(corrected.quality.availableFields, 1); assert.equal(corrected.quality.requiredFields, 3);
  assert.equal(corrected.quality.completenessPercent, 33);
  assert.equal(corrected.quality.applicability.financialDocuments, true);
  observations.push({ test: "All filing-required event families", returnedPersistedReadbackQualityEqual: true, excludedFieldDenominatorCorrect: true });

  // Old outcomes are created by the exact baseline runner where available,
  // then consumed by the new actual journal across aliases and lock expiry.
  for (const outcome of ["approved", "rejected", "needs_more_data", "uncertain", "pending"]) {
    const before = (baselineHarness ?? terminalHarness)({ useFinancialCollector: true });
    before.state.verdict = outcome === "rejected" ? "negative" : outcome === "needs_more_data" ? "needs_more_data" : "positive";
    let original;
    if (outcome === "uncertain") {
      original = await before.runRunner({ allowOpenAi: false });
      await before.modules.journal.checkTerminalReview({ ...before.identity, fingerprint: original.candidateFingerprint,
        evidence: original.selectedCandidate.terminalEvidence,
        legacy: [{ cik: before.identity.cik, fingerprint: original.candidateFingerprint, outcome: "unknown", completionProven: false }] });
    } else original = await before.runRunner({ persist: outcome !== "pending" });
    setRaw(before, stripProof(raw(before)));
    const next = terminalHarness({ useFinancialCollector: true }); transfer(before, next);
    const initialDecisions = structuredClone(next.journal.decisions), roles = next.state.roleCalls, reservations = next.state.moneyCalls;
    for (const elapsed of [0, 13 * hour, 24 * hour]) {
      next.advance(elapsed); next.reload();
      const report = await next.runRunner();
      assert.equal(report.openAiCalled, false, outcome);
      assert.equal(report.candidateFingerprint, original.candidateFingerprint, `${outcome}: alias and expiry preserve exact key`);
      assert.equal(next.state.roleCalls, roles); assert.equal(next.state.moneyCalls, reservations);
      assert.deepEqual(next.journal.decisions, initialDecisions, `${outcome}: no invented completion`);
    }
    observations.push({ test: `Historical ${outcome}`, addedReviewCalls: 0, addedReservations: 0, aliasesAndExpiryHeld: true });
  }

  // The separate exact-input hold is not a terminal outcome. Build it through
  // real rejection/recording code, then preserve its key across the migration.
  const inputBefore = (baselineHarness ?? terminalHarness)({ useFinancialCollector: true });
  inputBefore.state.failRole = "analyst_agent"; inputBefore.state.failRoleStatus = "prompt_too_large";
  const rejectedInput = await inputBefore.runJob();
  const heldFingerprint = rejectedInput.report.candidateFingerprint;
  assert.equal(await inputBefore.modules.research.unchangedCommitteeInputLimitHeld(heldFingerprint), true);
  const holdRows = [...inputBefore.objects].filter(([key]) => key.includes("/committee-input-holds/"));
  const inputAfter = terminalHarness({ useFinancialCollector: true }); transfer(inputBefore, inputAfter);
  setRaw(inputAfter, stripProof(raw(inputAfter))); inputAfter.state.failRole = null;
  const inputRoles = inputAfter.state.roleCalls, inputReservations = inputAfter.state.moneyCalls;
  inputAfter.advance(13 * hour); inputAfter.reload();
  const stillInputHeld = await inputAfter.runJob();
  assert.equal(stillInputHeld.result.openAiCalled, false);
  assert.equal(stillInputHeld.report.candidateFingerprint, heldFingerprint);
  assert.equal(inputAfter.state.roleCalls, inputRoles); assert.equal(inputAfter.state.moneyCalls, inputReservations);
  assert.deepEqual([...inputAfter.objects].filter(([key]) => key.includes("/committee-input-holds/")), holdRows);
  assert.equal(inputAfter.journal.decisions.length, 0);
  observations.push({ test: "Exact legacy input-limit hold", keyUnchanged: true, addedProviderCalls: 0, addedReservations: 0 });

  const dependency = terminalHarness({ eventMode: "sec", useFinancialCollector: true });
  const requiredEvent = dependency.newEvent("required-documents");
  const requiredFollowupKey = dependency.key(`research-evidence/followups/${crypto.createHash("sha256").update(requiredEvent.id).digest("hex").slice(0, 24)}.json`);
  dependency.objects.set(requiredFollowupKey, { value: { version: 1, eventId: requiredEvent.id, status: "collecting_evidence",
    tasks: [{ type: "financial_documents", topics: ["segments"] }], gaps: [] }, etag: '"requested-documents"' });
  const originallyRequired = await dependency.runJob();
  assert.equal(originallyRequired.report.seriousSignalFound, true, JSON.stringify(originallyRequired));
  assert.ok(dependency.journal.decisions[0].evidence.comparison.external.documents.length > 0);
  const dependencyRoles = dependency.state.roleCalls, dependencyMoney = dependency.state.moneyCalls;
  dependency.advance(60000); dependency.reload();
  const missingDependency = await dependency.runJob();
  assert.equal(missingDependency.report.selectedCandidate.financialDocuments, null);
  assert.equal(missingDependency.report.seriousSignalFound, false, "Approved reuse cannot drop its originally applicable document dependency");
  assert.equal(missingDependency.result.openAiCalled, false);
  assert.equal(dependency.state.roleCalls, dependencyRoles); assert.equal(dependency.state.moneyCalls, dependencyMoney);
  observations.push({ test: "Replayed optional-event approval retains original filing dependency", noAddedCalls: true, publicationHeld: true });

  // Full event-job persistence uses the actual collector and raw legacy cache.
  const job = terminalHarness({ useFinancialCollector: true }); setRaw(job, legacy);
  const result = await job.runJob();
  assert.equal(result.report.openAiCalled, true, JSON.stringify(result));
  assert.equal(result.report.seriousSignalFound, false);
  assert.equal(job.journal.decisions[0].outcome, "needs_more_data");
  assert.ok(job.writes.some(row => row.key.includes("terminal-reviews-v1/attempts/")));
  assert.equal([...job.objects.keys()].filter(key => key.includes("/outbox/event-job/")).length, 0);
  assert.equal(raw(job).documents[0].transportProof, undefined);
  const jobRoles = job.state.roleCalls, jobMoney = job.state.moneyCalls;
  job.advance(13 * hour); job.reload();
  const jobReplay = await job.runJob();
  assert.equal(jobReplay.result.openAiCalled, false);
  assert.equal(job.state.roleCalls, jobRoles); assert.equal(job.state.moneyCalls, jobMoney);
  assert.equal(jobReplay.result.seriousSignalFound, false);
  assert.ok(job.fetches.filter(url => url.includes("/Archives/")).length === 0,
    "Follow-up plans cannot rearm complete-flagged legacy filing reads");
  const followups = [...job.objects].filter(([key]) => key.includes("/followups/")).map(([, row]) => row.value);
  assert.ok(followups.length > 0);
  assert.ok(followups.every(row => row.tasks.every(task => task.type === "financial_documents")),
    "Existing valuation document tasks survive; unknown transport adds no source/fact task");
  if (baselineHarness) {
    const baselineJob = baselineHarness({ useFinancialCollector: true }); setRaw(baselineJob, legacy);
    await baselineJob.runJob(); baselineJob.advance(13 * hour); baselineJob.reload(); await baselineJob.runJob();
    assert.deepEqual(job.fetches, baselineJob.fetches,
      "Unknown-proof follow-up and actual next event-job pass have the exact baseline source I/O trace");
  }
  observations.push({ test: "Collector to event-job persistence", actualNeedsMoreDataCompletionStored: true, outboxes: 0, replayAddedCalls: 0 });
});
assert.equal(blockedNetworkAttempts, 0);
console.log(JSON.stringify({ result: "PASS", observations, blockedNetworkAttempts, realStorageCalls: 0 }, null, 2));
