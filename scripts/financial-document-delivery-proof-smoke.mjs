import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { terminalHarness } from "./terminal-review-runner-smoke.mjs";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { inSimpleAlertPilot } from "./helpers/simple-alert-pilot-fixture.mjs";
let realNetworkAttempts = 0;
const blocked = () => { realNetworkAttempts++; throw new Error("real_network_forbidden"); };
globalThis.fetch = http.request = http.get = https.request = https.get = net.Socket.prototype.connect = blocked;
const observations = [];
await inSimpleAlertPilot(async () => {
  process.env.SWING_UP_PR262_EXTERNAL_NOTIFICATIONS_ENABLED = "false";
  const h = terminalHarness({ eventMode: "sec", useFinancialCollector: true });
  const event = h.newEvent("delivery-documents");
  const followup = h.key(`research-evidence/followups/${crypto.createHash("sha256").update(event.id).digest("hex").slice(0, 24)}.json`);
  h.objects.set(followup, { value: { version: 1, eventId: event.id, status: "collecting_evidence", gaps: [],
    tasks: [{ type: "financial_documents", topics: [], complete: false }] }, etag: '"seed"' });
  const reviewed = await h.runJob();
  assert.equal(reviewed.report.seriousSignalFound, true);
  const [outboxKey, stored] = [...h.objects].find(([key]) => key.includes("/outbox/event-job/"));
  const original = structuredClone(stored);
  const originalJournal = structuredClone(h.journal);
  const delivery = loadTsModule("@/lib/notifications/serious-signal-delivery", {
    "@/lib/r2-warehouse": h.storage,
    "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: h.key },
    "@/lib/opportunity-engine/pr262-terminal-reviews": h.modules.journal,
    "@/lib/opportunity-engine/company-profile-cache": { readCompanyProfiles: async () => new Map() },
  });
  const mutate = change => { const copy = structuredClone(original); change(copy.value.candidate); h.objects.set(outboxKey, copy); };
  const writes = h.writes.length, sources = h.fetches.length, roles = h.state.roleCalls;
  for (const [name, change] of [
    ["legacy unknown", candidate => { for (const row of candidate.financialDocuments.documents) { delete row.transportProof; delete row.transportCompleteness; } }],
    ["known partial", candidate => { for (const row of candidate.financialDocuments.documents) { delete row.transportProof; delete row.transportCompleteness; row.readComplete = false; } }],
    ["unbound typed numeric payload", candidate => { candidate.financialDocuments.documents[0].factExtraction = { version: 1, status: "extracted", facts: [{ metric: "fixture_only", value: 1, unit: "USD" }] }; }],
    ["missing dependency", candidate => { candidate.financialDocuments = null; candidate.financialDocumentsRequired = false; }],
    ["unknown original requirement", candidate => { delete candidate.financialDocumentsRequired; }],
  ]) {
    mutate(change);
    await assert.rejects(() => delivery.deliverSeriousSignalOutbox(outboxKey, { now: h.state.now }), /financial_completeness_unproved/, name);
    assert.equal(h.writes.length, writes, "A held outbox cannot create jobs, receipts or feed entries");
    assert.equal(h.fetches.length, sources); assert.equal(h.state.roleCalls, roles);
    assert.deepEqual(h.journal, originalJournal);
    observations.push({ test: name, additionalWrites: 0, additionalSources: 0, additionalPaidCalls: 0 });
  }
  h.objects.set(outboxKey, structuredClone(original));
  const accepted = await delivery.deliverSeriousSignalOutbox(outboxKey, { now: h.state.now });
  assert.equal(accepted.deliveryStatus, "delivered");
  const receipts = [...h.objects].filter(([key]) => key.includes("/receipts/web_feed/"));
  assert.equal(receipts.length, 1);
  const receiptSnapshot = structuredClone(receipts), afterDeliveryWrites = h.writes.length;
  const repeat = await delivery.deliverSeriousSignalOutbox(outboxKey, { now: h.state.now });
  assert.equal(repeat.deliveryStatus, "delivered");
  assert.deepEqual([...h.objects].filter(([key]) => key.includes("/receipts/web_feed/")), receiptSnapshot);
  observations.push({ test: "Fresh exact200/EOF original and canonical repeat", receipts: 1 });
  mutate(candidate => { for (const row of candidate.financialDocuments.documents) { delete row.transportProof; delete row.transportCompleteness; } });
  const beforeRead = h.writes.length;
  const status = await delivery.getSeriousSignalStatus({ now: h.state.now });
  assert.equal(status.alerts.length, 1, "Historical delivered approval remains visible");
  assert.equal(status.alerts[0].publicationEligible, false);
  assert.equal(status.alerts[0].delivery.status, "delivered");
  assert.equal(status.alerts[0].committee.recommendation, "approve");
  assert.equal(status.summary.currentlyEligible, 0);
  assert.equal(h.writes.length, beforeRead);
  assert.deepEqual([...h.objects].filter(([key]) => key.includes("/receipts/web_feed/")), receiptSnapshot);
  assert.ok(afterDeliveryWrites > writes);
  observations.push({ test: "Legacy status projection", approvalRetained: true, actualReceiptRetained: true, currentlyEligible: false, writes: 0 });
});
assert.equal(realNetworkAttempts, 0);
console.log(JSON.stringify({ result: "PASS", observations, realNetworkAttempts }, null, 2));
