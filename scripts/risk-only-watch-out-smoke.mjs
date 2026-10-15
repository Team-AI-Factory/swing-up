import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { terminalHarness } from "./terminal-review-runner-smoke.mjs";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { inSimpleAlertPilot } from "./helpers/simple-alert-pilot-fixture.mjs";
import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";
let networkAttempts = 0;
const blocked = () => { networkAttempts++; throw new Error("real_network_forbidden"); };
globalThis.fetch = http.request = http.get = https.request = https.get = net.Socket.prototype.connect = blocked;
const checks = [];
let retainedCandidate, retainedNow;
await inSimpleAlertPilot(async () => {
  process.env.SWING_UP_PR262_EXTERNAL_NOTIFICATIONS_ENABLED = "false";
  const now = new Date(), identity = { ticker: "AIOT", company: "Powerfleet, Inc.", cik: "0001774170" };
  const day = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  const receipt = { id: "official", url: "https://www.sec.gov/Archives/edgar/data/1774170/000177417026000001/event.htm", official: true, primarySource: true };
  const lossCandidate = { ...identity, companyProfile: companyProfileFixture(identity, now), direction: "upside", action: "buy", kind: "event",
    eventFamily: "contract_award", relationship: "direct", currency: "USD", quote: { price: 100 }, valuationRange: null, receipts: [receipt],
    eventMagnitude: { metrics: [{ kind: "contract_value", promotionEvidenceVerified: true, value: 100000000, sourceReceiptId: receipt.id, sourceUrl: receipt.url }] },
    fundamentals: { available: true, checkedAt: now.toISOString(), sourceUrl: "https://data.sec.gov/api/xbrl/companyfacts/CIK0001774170.json",
      items: [{ metric: "net_income", value: -1000000, unit: "USD", periodEnd: day, filedAt: day }] } };
  const detailPolicy = loadTsModule("@/lib/alert-details");
  for (const action of ["buy", "sell"]) {
    const candidate = { ...lossCandidate, action, direction: action === "buy" ? "upside" : "downside" };
    const detail = detailPolicy.alertDetails(candidate, undefined, now);
    assert.equal(loadTsModule("@/lib/restricted-beta-policy").restrictedBetaScopeBlocker(candidate), null);
    assert.equal(detail.valuationException, false); assert.equal(detail.complete, false);
    assert.equal(detailPolicy.publicAlertDetailsComplete({ ...candidate, industry: detail.industry, outlook: detail.outlook }, now), false);
  }
  checks.push("pilot negative earnings cannot authorize target-free Buy or Sell");

  const h = terminalHarness({ eventMode: "sec", riskOnly: true });
  const { report, result } = await h.runJob();
  assert.equal(report.alertType, "watch_out", JSON.stringify({ status: report.status, blockers: report.blockers, gates: report.selectedCandidate?.gateChecks, policy: report.selectedCandidate?.riskWarningPolicy }));
  assert.equal(report.seriousSignalFound, true);
  assert.equal(report.selectedCandidate.riskWarningPolicy, "direct_material_risk_v1");
  assert.equal(report.committee.agentsCompleted, 4, "Risk analyst, accountant, skeptic and final judge complete");
  assert.equal(report.committee.agentsFailed, 0);
  assert.ok(h.prompts.some(prompt => JSON.stringify(prompt).includes("SERIOUS WATCH OUT risk-only candidate")));
  const [outboxKey, stored] = [...h.objects].find(([key]) => key.includes("/outbox/watch-out-v2/"));
  assert.equal(stored.value.alertType, "watch_out");
  assert.equal([...h.objects].filter(([key]) => key.includes("/outbox/event-job/")).length, 0);
  const details = loadTsModule("@/lib/alert-details").alertDetails(stored.value.candidate, undefined, h.state.now);
  assert.equal(details.complete, true); assert.equal(details.riskWarningException, true);
  assert.equal(details.outlook.basis, "unavailable"); assert.equal(details.outlook.base.price, null);
  assert.equal(details.outlook.potentialPercent, null);
  const delivery = loadTsModule("@/lib/notifications/serious-signal-delivery", {
    "@/lib/r2-warehouse": h.storage,
    "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: h.key },
    "@/lib/opportunity-engine/pr262-terminal-reviews": h.modules.journal,
    "@/lib/opportunity-engine/company-profile-cache": { readCompanyProfiles: async () => new Map() },
  });
  retainedCandidate = structuredClone(stored.value.candidate); retainedNow = h.state.now;
  const { completeRiskWarningReview } = loadTsModule("@/lib/equity-signal/risk-warning-policy");
  assert.equal(completeRiskWarningReview(stored.value.candidate, stored.value.committee), true);
  const regulatoryCandidate = { ...stored.value.candidate, eventFamily: "regulatory_enforcement" };
  assert.equal(completeRiskWarningReview(regulatoryCandidate, stored.value.committee), false, "Regulatory warnings require the industry reviewer");
  const regulatoryReview = structuredClone(stored.value.committee);
  const regulatorySummary = regulatoryReview.output.modelUsageSummary;
  regulatorySummary.reviewPlan.agentIds = regulatorySummary.reviewPlan.agentIds.map(id => id === "accountant_agent" ? "industry_agent" : id);
  regulatorySummary.roleDiagnostics.forEach(role => { if (role.agentId === "accountant_agent") role.agentId = "industry_agent"; });
  assert.equal(completeRiskWarningReview(regulatoryCandidate, regulatoryReview), true);

  const original = structuredClone(stored), writesBefore = h.writes.length;
  for (const [name, mutation] of [
    ["sell relabel", value => { value.alertType = "sell"; }],
    ["buy relabel", value => { value.alertType = "buy"; value.candidate.direction = "upside"; }],
    ["wrong issuer source", value => { value.candidate.receipts[0].url = "https://www.sec.gov/Archives/edgar/data/999/000000099926000001/event.htm"; }],
    ["unofficial source", value => { value.candidate.receipts.forEach(row => row.official = false); }],
    ["indirect risk", value => { value.candidate.relationship = "second_order"; }],
    ["valuation fallback", value => { value.candidate.eventFamily = "valuation_gap"; }],
    ["unknown direction", value => { value.candidate.direction = "unknown"; }],
    ["missing source quantity", value => { delete value.candidate.eventMagnitude; }],
    ["wrong pilot issuer", value => { value.ticker = "ZZZZ"; value.candidate.ticker = "ZZZZ"; }],
    ["nonmaterial risk", value => { value.candidate.materiality = 64; }],
    ["invalid score", value => { value.candidate.materiality = "NaN"; }],
    ["stale event", value => { value.candidate.eventObservedAt = "2026-09-01T15:00:00Z"; }],
    ["stale quote", value => { value.candidate.quote.observedAt = "2026-09-01T15:00:00Z"; }],
    ["failed review", value => { value.committee.agentsFailed = 1; }],
    ["missing required role", value => { value.committee.agentsCompleted = 3; }],
    ["coherently omitted required accountant", value => {
      const summary = value.committee.output.modelUsageSummary;
      summary.reviewPlan.agentIds = summary.reviewPlan.agentIds.filter(id => id !== "accountant_agent");
      summary.roleDiagnostics = summary.roleDiagnostics.filter(role => role.agentId !== "accountant_agent");
      value.committee.agentsCompleted = summary.reviewPlan.agentIds.length;
      value.authority.fullCommitteeAgentsCompleted = value.committee.agentsCompleted;
    }],
    ["changed quantified magnitude after review", value => { value.candidate.eventMagnitude.metrics[0].value += 5; }],
    ["missing financial transport", value => { value.candidate.financialDocuments.documents.forEach(row => { delete row.transportProof; delete row.transportCompleteness; }); }],
  ]) {
    const copy = structuredClone(original); mutation(copy.value); h.objects.set(outboxKey, copy);
    await assert.rejects(() => delivery.deliverSeriousSignalOutbox(outboxKey, { now: h.state.now }), undefined, name);
    assert.equal(h.writes.length, writesBefore, name + " must not create delivery state"); checks.push(name);
  }
  h.objects.set(outboxKey, structuredClone(original));
  const accepted = await delivery.deliverSeriousSignalOutbox(outboxKey, { now: h.state.now });
  assert.equal(accepted.deliveryStatus, "delivered");
  assert.match(accepted.message, /Price impact, target price and expected return have not been established/);
  assert.doesNotMatch(accepted.message, /Conservative:|Optimistic:|Historical price scenarios|Estimated business value/);
  assert.equal([...h.objects].filter(([key]) => key.includes("/receipts/web_feed/")).length, 1);
  await delivery.deliverSeriousSignalOutbox(outboxKey, { now: h.state.now });
  assert.equal([...h.objects].filter(([key]) => key.includes("/receipts/web_feed/")).length, 1);
  // A legacy target-free loss-company Buy/Sell is historical only in this pilot.
  const legacy = structuredClone(original), loss = legacy.value.candidate;
  delete loss.riskWarningPolicy; delete loss.riskWarningRule;
  delete loss.terminalEvidence; delete loss.terminalDecisionKey;
  loss.kind = "event"; loss.eventFamily = "contract_award"; loss.direction = "downside";
  loss.valuationRange = null; loss.priceForecast = null;
  loss.eventMagnitude.metrics = [{ ...loss.eventMagnitude.metrics[0], kind: "contract_value", value: 100000000 }];
  loss.fundamentals = { available: true, checkedAt: h.state.now.toISOString(),
    sourceUrl: `https://data.sec.gov/api/xbrl/companyfacts/CIK${loss.cik}.json`,
    items: [{ metric: "net_income", value: -1000000, unit: "USD", periodEnd: "2026-06-30", filedAt: "2026-08-01" }] };
  legacy.value.kind = "pr262_committee_verified_event_signal"; legacy.value.alertType = "sell";
  h.objects.set(outboxKey, legacy);
  const beforeLegacyWrites = h.writes.length;
  await assert.rejects(() => delivery.deliverSeriousSignalOutbox(outboxKey, { now: h.state.now }), /alert_details_incomplete/);
  const archived = await delivery.getSeriousSignalStatus({ now: h.state.now, hours: 48 });
  assert.equal(archived.alerts.length, 1, "Delivered legacy target-free approval remains in history");
  assert.equal(archived.alerts[0].publicationEligible, false);
  assert.equal(archived.alerts[0].publicationHoldReason, "pilot_valuation_targets_required");
  assert.equal(archived.alerts[0].delivery.status, "delivered");
  const [legacyReceiptKey, legacyReceipt] = [...h.objects].find(([key]) => key.includes("/receipts/web_feed/"));
  h.objects.delete(legacyReceiptKey);
  assert.equal((await delivery.getSeriousSignalStatus({ now: h.state.now, hours: 48 })).alerts.length, 0, "A job flag without a real receipt cannot establish legacy delivery history");
  h.objects.set(legacyReceiptKey, { ...legacyReceipt, value: { ...legacyReceipt.value, outboxKey: "wrong-outbox" } });
  assert.equal((await delivery.getSeriousSignalStatus({ now: h.state.now, hours: 48 })).alerts.length, 0, "Legacy receipt must bind the exact outbox");
  h.objects.set(legacyReceiptKey, legacyReceipt);
  assert.equal(h.writes.length, beforeLegacyWrites, "Legacy history and blocked delivery must leave receipts untouched");
  h.objects.set(outboxKey, structuredClone(original));
  checks.push("legacy target-free loss-company approval retained as history, current delivery blocked");
  const beforeRecovery = new Map([...h.objects].map(([key, value]) => [key, structuredClone(value)]));
  const oldResult = structuredClone(h.objects.get(result.resultKey));
  oldResult.value.report = { ...oldResult.value.report, alertType: "sell", openAiCalled: false,
    selectedCandidate: { ...loss, terminalEvidence: original.value.candidate.terminalEvidence,
      terminalDecisionKey: original.value.candidate.terminalDecisionKey } };
  h.objects.set(result.resultKey, oldResult);
  const { STATE_KEY, LEASE_KEY } = h.modules.eventJob.PR262_EVENT_JOB_KEYS;
  h.objects.get(STATE_KEY).value.runs = [];
  h.objects.get(LEASE_KEY).value.lease = null;
  for (const key of [...h.objects.keys()].filter(key => key.includes("/outbox/"))) h.objects.delete(key);
  const callsBeforeRecovery = h.state.roleCalls;
  const recovery = await h.runJob();
  assert.equal(recovery.result.recoveredPersistedResult, true, "Exercise recovery of the saved pre-policy report");
  assert.equal(recovery.result.outboxKey, null, "A saved target-free Buy/Sell approval cannot create a new outbox");
  assert.equal([...h.objects.keys()].filter(key => key.includes("/outbox/")).length, 0);
  assert.equal(h.state.roleCalls, callsBeforeRecovery, "Legacy recovery cannot purchase another review");
  h.objects.clear(); for (const [key, value] of beforeRecovery) h.objects.set(key, value);
  checks.push("saved legacy target-free report recovery creates no outbox and buys no review");

  const beforeStatusWrites = h.writes.length;
  const historical = await delivery.getSeriousSignalStatus({ now: new Date(h.state.now.getTime() + 25 * 3600000), hours: 48 });
  assert.equal(historical.alerts.length, 1, "Delivered risk history remains visible after its relevance window");
  assert.equal(historical.alerts[0].publicationEligible, false);
  assert.equal(historical.alerts[0].publicationHoldReason, "risk_warning_evidence_no_longer_current");
  assert.equal(historical.alerts[0].delivery.status, "delivered");
  assert.equal(h.writes.length, beforeStatusWrites, "Historical status read must not mutate receipts or approvals");
  const calls = h.state.roleCalls;
  h.newEvent("unchanged"); const replay = await h.runJob();
  assert.equal(replay.report.alertType, "watch_out", "Same substantive risk packet reuses its original approved label");
  assert.equal(h.state.roleCalls, calls, "Same evidence cannot buy another risk review");
  assert.ok(result.resultKey);
  checks.push("end-to-end risk review, authority, receipt, duplicate suppression, unchanged-evidence hold");

  for (const [name, mutate] of [
    ["incomplete source", state => { state.sourceComplete = false; }],
    ["missing financial transport before review", state => { state.filingStatus = 206; }],
    ["stale market eligibility", state => { state.quoteReady = false; }],
    ["review rejection", state => { state.verdict = "negative"; }],
    ["review timeout", state => { state.failRole = "skeptic_agent"; }],
  ]) {
    const negative = terminalHarness({ eventMode: "sec", riskOnly: true }); mutate(negative.state);
    const outcome = await negative.runJob();
    assert.equal(outcome.report.seriousSignalFound, false, name);
    assert.equal([...negative.objects].filter(([key]) => key.includes("/outbox/")).length, 0, name);
    checks.push(name);
  }
});
assert.equal(loadTsModule("@/lib/equity-signal/risk-warning-policy").riskOnlyWarning(retainedCandidate, retainedNow), false, "New risk authority is unavailable outside exact pilot runtime");
assert.equal(networkAttempts, 0);
console.log(JSON.stringify({ result: "PASS", checks, networkAttempts }, null, 2));
