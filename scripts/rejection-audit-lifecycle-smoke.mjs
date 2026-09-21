import assert from "node:assert/strict";
import crypto from "node:crypto";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";

const now = new Date("2026-09-18T09:00:00Z");
const digest = id => crypto.createHash("sha256").update(id).digest("hex").slice(0, 24);
const sampledIds = Array.from({ length: 200 }, (_, i) => `rejected-${i}`)
  .filter(id => parseInt(digest(id).slice(0, 4), 16) % 10 === 0);
const objects = new Map(); let revision = 0, refuseAuditWrite = false;
const storage = {
  readVersionedTextFromR2: async key => objects.has(key)
    ? { found: true, text: JSON.stringify(objects.get(key).value), etag: objects.get(key).etag }
    : { found: false, text: null, etag: null },
  writeVersionedJsonToR2: async (key, value, options = {}) => {
    if (refuseAuditWrite && key.includes("/rejection-audit/") && !key.endsWith("paid-sample-reservation.json")) return { written: false, conflict: false };
    const existing = objects.get(key);
    if ((options.createOnly && existing) || (options.expectedEtag && options.expectedEtag !== existing?.etag)) return { written: false, conflict: true };
    objects.set(key, { value: structuredClone(value), etag: String(++revision) });
    return { written: true, conflict: false };
  },
};
const evidence = loadTsModule("@/lib/opportunity-engine/pr262-research-evidence", {
  "@/lib/r2-warehouse": storage,
  "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: path => `test/${path}` },
  "@/lib/opportunity-engine/company-profile-cache": { readCompanyProfiles: async () => new Map() },
  "@/lib/signal-explanation": { explainCandidate: () => ({}), plainEvidenceGaps: value => value },
});
const reservationKey = `test/research-evidence/rejection-audit/2026-09-18/paid-sample-reservation.json`;
const event = { id: sampledIds[0], ticker: "EXM", cik: "0000000001", observedAt: now.toISOString() };
const auditKey = `test/research-evidence/rejection-audit/2026-09-18/${digest(event.id)}.json`;
const record = report => evidence.recordResearchEvidence({ event, report, sourceDecisionGrade: true, sourceFailureReason: null, now });
const audit = () => objects.get(auditKey)?.value;

const raced = await Promise.all(sampledIds.slice(0, 2).map(id => evidence.reserveRejectionAudit(id, now)));
assert.equal(raced.filter(Boolean).length, 1, "Concurrent selectors must own only one daily slot");
const first = raced.find(Boolean);
await first.release(now);
const replacement = await evidence.reserveRejectionAudit(sampledIds[1], now);
assert.ok(replacement, "A no-call selection must release its allowance");
await first.release(now);
assert.equal(await first.commit(now), false, "An old owner cannot commit the replacement's slot");
assert.equal(await replacement.commit(now), true);
await replacement.release(now);
assert.equal(await evidence.reserveRejectionAudit(sampledIds[2], now), null, "An attempted review keeps the daily slot even after cleanup");
assert.ok(await evidence.reserveRejectionAudit(sampledIds[2], new Date(now.getTime() + 86400000)), "A new UTC day has its own allowance");

objects.clear();
const abandoned = await evidence.reserveRejectionAudit(sampledIds[0], now);
const afterLease = new Date(now.getTime() + 5 * 60000);
const recovered = await evidence.reserveRejectionAudit(sampledIds[1], afterLease);
assert.ok(recovered, "A process interrupted before a paid call cannot consume the whole day's allowance");
assert.equal(await abandoned.commit(afterLease), false);
await abandoned.release(afterLease);
assert.equal(await recovered.commit(afterLease), true);
objects.clear();
await storage.writeVersionedJsonToR2(reservationKey, { eventId: sampledIds[0], reservedAt: now.toISOString(), maximumPerDay: 1 });
assert.equal(await evidence.reserveRejectionAudit(sampledIds[1], now), null, "Legacy paid reservations remain conservatively consumed");
objects.clear();
const midnightLease = await evidence.reserveRejectionAudit(sampledIds[0], new Date("2026-09-18T23:59:59Z"));
assert.equal(await midnightLease.commit(new Date("2026-09-19T00:00:00Z")), false, "A prior-day selection cannot spend the new day's allowance");

objects.clear();
await record({ status: "qualified_signal_openai_reservation_denied", rejectionAuditReview: true, openAiCalled: false });
assert.equal(audit().selectedForAudit, true);
assert.equal(audit().committeeAttempted, false);
assert.equal(audit().committeeAudited, false);
assert.equal(audit().reviewOutcome, null);
const failed = { status: "committee_failed", openAiCalled: true, rejectionAuditReview: true,
  committee: { ok: false, status: "failed", agentsCompleted: 0, agentsFailed: 14,
    output: { overallRecommendation: "reject" }, roleDiagnostics: [{ agentId: "truth", status: "failed", providerFailure: { category: "permission" } }] } };
await record(failed);
assert.equal(audit().committeeAttempted, true);
assert.equal(audit().committeeAudited, false, "Zero completed roles cannot count as a completed audit");
assert.equal(audit().reviewOutcome, null, "A failed review's default rejection is not a reliable classification");
assert.equal(audit().lastAttempt.agentsFailed, 14);
assert.equal(audit().lastAttempt.roleDiagnostics[0].providerFailure.category, "permission");
const completed = { status: "candidate_needs_more_data", openAiCalled: true,
  committee: { ok: true, status: "completed", agentsCompleted: 14, agentsFailed: 0, output: { overallRecommendation: "reject" } } };
await record(completed);
assert.equal(audit().committeeAudited, true, "A real result must update the retained sample even without a new sampling selection");
assert.equal(audit().reviewOutcome, "reject");
await record({ status: "qualified_signal_openai_not_requested", openAiCalled: false });
assert.equal(audit().committeeAudited, true);
assert.equal(audit().reviewOutcome, "reject");
assert.equal(audit().lastAttempt.agentsCompleted, 14);
await record(failed);
assert.equal(audit().reviewOutcome, "reject", "A subsequent failed attempt retains the last completed verdict separately");
assert.equal(audit().lastAttempt.agentsCompleted, 0);
objects.clear();
await record({ status: "no_qualified_signal", noSignalReason: "insufficient_research_priority", openAiCalled: false });
await Promise.all([record({ status: "no_qualified_signal", openAiCalled: false }), record(completed)]);
assert.equal(audit().committeeAudited, true, "Concurrent sample and result writes must preserve the completed audit");
assert.equal(audit().reason, "insufficient_research_priority", "The initial rejection reason must survive later review");
objects.clear();
await storage.writeVersionedJsonToR2(auditKey, { version: 1, eventId: event.id, committeeAudited: true, reviewOutcome: "reject" });
await record({ status: "qualified_signal_openai_not_requested", openAiCalled: false });
assert.equal(audit().committeeAudited, false, "Legacy admission-only audit markers cannot certify completed reviews");
assert.equal(audit().reviewOutcome, null);
objects.clear(); refuseAuditWrite = true;
await assert.rejects(record({ status: "no_qualified_signal", openAiCalled: false }), /rejection_audit_write_failed/);
refuseAuditWrite = false;

const receipt = { id: event.id, title: "Example Corp provides operating update",
  summary: "Example Corp describes changes to its operating structure, customer arrangements and expected resource needs. The update explains the affected business activities, while the net financial effect and investment direction remain uncertain.",
  url: "https://issuer.example/update", publisher: "Example Corp", publishedAt: now.toISOString(), channel: "direct_issuer_feed",
  official: true, primarySource: true, scheduled: false, symbolHints: ["EXM"], companyHints: ["Example Corp"], rawEventType: null };
const universe = { entries: [{ ticker: "EXM", name: "Example Corp", aliases: ["Example Corp"], cik: event.cik, exchange: "NASDAQ", securityType: "common_stock" }], coverage: {}, sources: [] };
const provider = name => ({ provider: name, status: "connected", checkedAt: now.toISOString(), nextRetryAt: null, sourceUrls: [], receipts: [], recordsRead: 1, error: null, entitlementVerified: true, cached: false });
const realAnalysis = loadTsModule("@/lib/equity-signal/analysis");
let profileAvailable = true, providerConfigured = true, providerEnabled = true, budgetAllowed = true, budgetThrows = false, committeeThrows = false, committeeCalls = 0;
const runner = loadTsModule("@/lib/equity-signal/runner", {
  "@/lib/equity-signal/analysis": { ...realAnalysis, buildImpactCandidates: (...args) => {
    const result = realAnalysis.buildImpactCandidates(...args);
    for (const candidate of result.candidates) { candidate.score = 50; candidate.materiality = 40; }
    return result;
  } },
  "@/lib/equity-signal/market": { enrichCandidateQuotes: async candidates => ({ candidates: candidates.map(candidate => ({ ...candidate, quote: { ticker: candidate.ticker, price: 100, observedAt: now.toISOString(), actionableForSeriousSignal: true, marketSession: "regular" } })), provider: provider("quote"), benchmarkQuote: null, marketSnapshot: [] }) },
  "@/lib/equity-signal/fundamentals": { enrichCandidateFundamentals: async candidate => ({ candidate, provider: provider("facts") }) },
  "@/lib/ai-committee/provider": { getAiCommitteeProviderStatus: () => ({ configured: providerConfigured, enabled: providerEnabled }) },
  "@/lib/ai-committee/orchestrator": { TRUSTED_IN_MEMORY_EVIDENCE: Symbol("evidence"), runAiCommittee: async () => {
    committeeCalls++;
    assert.equal(objects.get(reservationKey).value.status, "committed", "The daily sample slot must commit before invocation");
    if (committeeThrows) throw new Error("provider_timeout");
    return { ok: true, status: "completed", agentResults: Array.from({ length: 14 }, (_, i) => ({ agentId: i === 13 ? "final_judge" : `role-${i}`, status: "completed", verdict: "positive", confidence: 95 })), committeeOutput: { overallRecommendation: "approve" } };
  } },
});
const input = { now, allowOpenAi: true, allowIncompleteCommitteeReview: true,
  reserveRejectionAudit: () => evidence.reserveRejectionAudit(event.id, now),
  resolveCompanyProfile: async identity => profileAvailable ? companyProfileFixture(identity, now) : null,
  beforeOpenAiCall: async () => { if (budgetThrows) throw new Error("budget_unavailable"); return budgetAllowed; },
  targetedContext: { storedCompanyAnalysis: { currency: "USD", industry: "Application software", fairValue: { conservativeValue: 80, baseValue: 120, optimisticValue: 140 } }, universe, receipts: [receipt], providers: [provider("nasdaq_trade_halts")], historicalSignalsComplete: true } };
for (const blocker of ["profile", "provider", "configuration", "disabled", "budget", "budget_exception"]) {
  objects.clear(); profileAvailable = blocker !== "profile"; budgetAllowed = blocker !== "budget"; budgetThrows = blocker === "budget_exception";
  providerConfigured = blocker !== "configuration"; providerEnabled = blocker !== "disabled";
  const report = await runner.runEquitySignalLab({ ...input, ...(blocker === "provider" ? { aiProviderBlockedReason: "permission" } : {}) });
  assert.equal(report.rejectionAuditReview, true, JSON.stringify(report));
  assert.equal(report.openAiCalled, false);
  assert.equal(committeeCalls, 0);
  assert.ok(await evidence.reserveRejectionAudit(sampledIds[1], now), `${blocker} must return the unused daily allowance`);
}
objects.clear(); profileAvailable = true; budgetAllowed = true; budgetThrows = false;
const expired = await runner.runEquitySignalLab({ ...input, reserveRejectionAudit: async () => ({ commit: async () => false, release: async () => {} }) });
assert.equal(expired.status, "qualified_signal_openai_reservation_denied");
assert.equal(expired.openAiCalled, false);
assert.equal(committeeCalls, 0);
const reviewed = await runner.runEquitySignalLab(input);
assert.equal(reviewed.openAiCalled, true, JSON.stringify(reviewed));
assert.equal(reviewed.committee.agentsCompleted, 14);
assert.equal(reviewed.seriousSignalFound, false, "A positive audit must not bypass unchanged publication gates");
assert.equal(await evidence.reserveRejectionAudit(sampledIds[1], now), null);
objects.clear(); committeeThrows = true;
const interrupted = await runner.runEquitySignalLab(input);
assert.equal(interrupted.openAiCalled, true);
assert.equal(interrupted.rejectionAuditReview, true);
assert.equal(await evidence.reserveRejectionAudit(sampledIds[1], now), null, "Provider exceptions cannot reopen the paid allowance");
console.log("Rejection audit: leased daily bounds, no-call release, attempted/completed distinction, durable outcomes and unchanged publication gates passed.");
