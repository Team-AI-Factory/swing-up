import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { terminalHarness } from "./terminal-review-runner-smoke.mjs";
import { inSimpleAlertPilot } from "./helpers/simple-alert-pilot-fixture.mjs";
let realNetworkAttempts = 0;
const blocked = () => { realNetworkAttempts++; throw new Error("real_network_forbidden"); };
globalThis.fetch = http.request = http.get = https.request = https.get = net.Socket.prototype.connect = blocked;
const roles = ["analyst_agent", "skeptic_agent", "final_judge"];
// Deliberately positive synthetic votes exercise the defensive publication gate;
// they are not evidence that the real Committee approves incomplete documents.
const syntheticCommitteeResult = { ok: true, status: "completed", committeeOutput: {
  overallRecommendation: "approve", evidenceConfidenceScore: 95, missingEvidence: [],
  modelUsageSummary: { reviewPlan: { policy: "focused_v1", agentIds: roles },
    roleDiagnostics: roles.map(agentId => ({ agentId, status: "completed" })) },
}, agentResults: roles.map(agentId => ({ agentId, status: "completed", verdict: "positive", confidence: 95,
  keyFindings: [], concerns: [], missingData: [], followUpChecks: [] })) };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, canonical(val)])) : value;
const seal = value => crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const withoutIntegrity = value => { const copy = { ...value }; delete copy.integrity; return copy; };
const outcomes = [];
await inSimpleAlertPilot(async () => {
  const h = terminalHarness({ eventMode: "sec", useFinancialCollector: true, syntheticCommitteeResult });
  const event = h.newEvent("explicit-documents");
  const followup = h.key(`research-evidence/followups/${crypto.createHash("sha256").update(event.id).digest("hex").slice(0, 24)}.json`);
  h.objects.set(followup, { value: { version: 1, eventId: event.id, status: "collecting_evidence", gaps: [],
    tasks: [{ type: "financial_documents", topics: [], complete: false }] }, etag: '"seed"' });
  h.state.filingStatus = 206;
  const first = await h.runJob();
  assert.equal(first.report.seriousSignalFound, false);
  assert.equal(first.report.selectedCandidate.financialDocumentsRequired, true);
  assert.equal(h.journal.decisions[0].outcome, "approved");
  assert.equal(h.journal.decisions[0].financialDocumentsRequired, true);
  assert.equal(h.journal.decisions[0].financialDocumentsRequested, true);
  assert.ok(h.objects.get(followup).value.tasks.some(task => task.type === "financial_documents"), "Paid persistence must retain the explicit request");
  const paidCalls = h.state.moneyCalls, providerCalls = h.state.roleCalls;
  const fingerprint = first.report.candidateFingerprint;
  h.advance(3600000); h.reload();
  const second = await h.runJob();
  assert.equal(second.report.seriousSignalFound, false, "A new daily/event alias cannot erase an empty-document dependency");
  assert.equal(second.report.selectedCandidate.financialDocumentsRequired, true);
  assert.equal(second.report.selectedCandidate.financialDocumentsRequested, true);
  assert.equal(second.report.openAiCalled, false);
  assert.equal(second.report.candidateFingerprint, fingerprint);
  assert.equal(h.state.moneyCalls, paidCalls); assert.equal(h.state.roleCalls, providerCalls);
  assert.equal([...h.objects.keys()].filter(key => key.includes("/outbox/event-job/")).length, 0);
  outcomes.push("Explicit empty-document dependency survives paid persistence, alias and restart without another paid call");

  const fresh = terminalHarness({ eventMode: "sec", syntheticCommitteeResult });
  const original = (await fresh.runJob()).report;
  assert.equal(original.selectedCandidate.financialDocumentsRequired, false);
  assert.equal(original.seriousSignalFound, true);
  assert.equal(fresh.journal.decisions[0].financialDocumentsRequired, false);
  assert.equal(fresh.journal.decisions[0].financialDocumentsRequested, false);
  const originalDecision = structuredClone(fresh.journal.decisions[0]);
  const calls = fresh.state.moneyCalls;
  fresh.advance(60000); fresh.reload();
  const reused = (await fresh.runJob()).report;
  assert.equal(reused.seriousSignalFound, true, "Facts-only approval with explicit no-document dependency can be reused");
  assert.equal(reused.openAiCalled, false); assert.equal(fresh.state.moneyCalls, calls);
  outcomes.push("New sealed false dependency preserves unrelated facts-only approval reuse");

  // Create an authentic-shaped old sealed journal by omitting only the newly
  // introduced fields. Its historical decision is still valid, but whether it
  // originally required an empty document result cannot be reconstructed.
  const row = fresh.objects.get(fresh.journalKey);
  const journal = structuredClone(row.value);
  journal.decisions = journal.decisions.map(value => {
    const body = withoutIntegrity(value); delete body.financialDocumentsRequired; delete body.financialDocumentsRequested;
    return { ...body, integrity: seal(body) };
  });
  journal.integrity = seal(withoutIntegrity(journal));
  fresh.objects.set(fresh.journalKey, { value: journal, etag: '"old-sealed-journal"' });
  const retainedJournal = structuredClone(journal), fetches = fresh.fetches.filter(url => url.includes("/Archives/")).length;
  fresh.advance(13 * 3600000); fresh.reload();
  const legacy = (await fresh.runJob()).report;
  assert.equal(legacy.seriousSignalFound, false);
  assert.equal(legacy.reviewOutcome, "approved_pending_checks");
  assert.equal(legacy.selectedCandidate.financialDocumentsRequirementKnown, false);
  assert.equal(legacy.selectedCandidate.financialDocumentsRequired, false, "Unknown is not a fabricated required=true assertion");
  assert.equal(legacy.selectedCandidate.financialDocumentsRequested, false);
  assert.equal(legacy.openAiCalled, false); assert.equal(fresh.state.moneyCalls, calls);
  assert.equal(fresh.fetches.filter(url => url.includes("/Archives/")).length, fetches);
  assert.equal(legacy.candidateFingerprint, original.candidateFingerprint);
  assert.deepEqual(fresh.journal, retainedJournal, "Read-side legacy hold never rewrites the historical sealed decision");
  assert.deepEqual(legacy.committee, originalDecision.committee);
  assert.ok(!fresh.modules.research.evidenceTasks(legacy).tasks.some(task => task.type === "financial_documents"), "Unknown legacy dependency must not create a collection request");
  const cardHarness = terminalHarness();
  await cardHarness.modules.research.recordResearchEvidence({ event: { ...fresh.identity, id: "legacy-no-dependency", observedAt: fresh.state.now.toISOString() },
    report: legacy, sourceDecisionGrade: true, sourceFailureReason: null, now: fresh.state.now });
  const cards = await cardHarness.modules.research.readResearchAlerts();
  assert.ok(cards.length); assert.equal(cards[0].committeeApproved, false);
  assert.equal(cards[0].committeeStatus, "approved_pending_checks");
  assert.equal(cards[0].financialDocumentsRequirementKnown, false);
  outcomes.push("Unknown legacy dependency preserves completed approval, blocks publication, adds no request or paid reopening");

  // A held legacy marker contains no validated original dependency. Reuse the
  // actual current SEC pack, then seed an otherwise matching historical card
  // to exercise the writer's same-snapshot retention branch explicitly.
  const legacyMarker = terminalHarness({ eventMode: "sec", syntheticCommitteeResult });
  const markerOriginal = (await legacyMarker.runJob()).report;
  const journalRow = legacyMarker.objects.get(legacyMarker.journalKey);
  const markerJournal = structuredClone(journalRow.value);
  markerJournal.decisions = [];
  markerJournal.legacy = [{ fingerprint: markerOriginal.candidateFingerprint, outcome: "approved", evidence: null, completionProven: true }];
  markerJournal.integrity = seal(withoutIntegrity(markerJournal));
  legacyMarker.objects.set(legacyMarker.journalKey, { value: markerJournal, etag: '"legacy-marker"' });
  legacyMarker.newEvent("legacy-held-alias"); legacyMarker.reload();
  const markerCalls = legacyMarker.state.moneyCalls;
  const markerReport = (await legacyMarker.runJob()).report;
  assert.equal(markerReport.selectedCandidate.financialDocumentsRequired, false);
  assert.equal(markerReport.selectedCandidate.financialDocumentsRequirementKnown, false);
  assert.equal(markerReport.openAiCalled, false); assert.equal(markerReport.seriousSignalFound, false);
  assert.equal(legacyMarker.state.moneyCalls, markerCalls);
  const markerCard = terminalHarness();
  const markerEvent = { ...markerCard.identity, id: "same-snapshot-legacy-held", observedAt: markerCard.state.now.toISOString() };
  const record = () => markerCard.modules.research.recordResearchEvidence({ event: markerEvent, report: markerReport,
    sourceDecisionGrade: true, sourceFailureReason: null, now: markerCard.state.now });
  await record();
  const indexKey = markerCard.modules.research.RESEARCH_ALERT_INDEX_KEY;
  const indexRow = markerCard.objects.get(indexKey), priorCard = indexRow.value.alerts[0];
  Object.assign(priorCard, { committeeApproved: true, committeeStatus: "approved", publicationStatus: "committee_approved_alert",
    financialDocumentsRequired: false, financialDocumentsRequirementKnown: true,
    completedReview: { fingerprint: markerReport.candidateFingerprint, confidence: 0,
      committee: structuredClone(markerOriginal.committee) } });
  const completion = structuredClone(priorCard.completedReview);
  await record();
  const retained = markerCard.objects.get(indexKey).value.alerts[0];
  assert.equal(retained.committeeApproved, false);
  assert.equal(retained.committeeStatus, "approved");
  assert.equal(retained.financialDocumentsRequirementKnown, false);
  assert.deepEqual(retained.completedReview, completion);
  assert.equal(retained.completedReview.confidence, 0);
  assert.ok(!retained.followup?.tasks.some(task => task.type === "financial_documents"));
  outcomes.push("Held legacy marker cannot restore current approval through the same-snapshot writer; history and zero confidence survive");

});
assert.equal(realNetworkAttempts, 0);
console.log(JSON.stringify({ result: "PASS", outcomes, realNetworkAttempts }, null, 2));
