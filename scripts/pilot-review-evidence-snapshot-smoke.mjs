import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";

const pilot = {
  SWING_UP_SIMPLE_PILOT_ENABLED: "true", RAILWAY_GIT_BRANCH: "pilot-simple-alerts",
  RAILWAY_PROJECT_ID: "83d99341-d622-475f-8035-00ef3d0916d1",
  RAILWAY_ENVIRONMENT_ID: "87afb8d7-c4fc-4f84-92b6-5d2820a689b6",
  SWING_UP_PR262_STORAGE_PREFIX: "branch-labs/simple-alerts/", SWING_UP_R2_WRITE_PREFIX: "branch-labs/simple-alerts/",
};
Object.assign(process.env, pilot);
const { reviewEvidenceRevision, validatedReviewEvidenceSnapshot: validate } = loadTsModule("@/lib/equity-signal/review-evidence-revision");
const evidence = {
  source: [{ id: "synthetic-fixture", summary: "valuation fixture", rawEventType: "valuation_review" }],
  companyProfile: { business: "Fixture business", customers: "Fixture customers", sourceFiledAt: "2026-02-01" },
  industry: "Fixture finance", outlookRange: { low: 6.75, base: 7.79, high: 13.04 },
  reviewPolicy: { version: "fixture-policy" }, financialDocuments: [{ url: "https://example.test/filing", filedAt: "2026-08-01", digest: "fixture-digest", readComplete: true }],
  modelAssumptions: [{ method: "financial_book_roe", value: 13.04, assumption: "Fixture assumption" }],
  facts: [{ metric: "revenue", value: 100, unit: "USD", periodStart: "2026-01-01", periodEnd: "2026-06-30", filedAt: "2026-08-01" }],
  sourceComplete: true, priceReady: false, haltKnown: true, halted: false,
  valuation: { low: 6.75, base: 7.79, high: 13.04, currentPriceSupportsValuation: true },
};
const identity = { cik: "0000000001", direction: "downside", fingerprint: `valuation:0000000001:downside:${reviewEvidenceRevision(evidence, false)}` };
const input = { version: 1, ...identity, evidence };
const snapshot = validate(input, identity);
assert.deepEqual(snapshot, input);
input.evidence.facts[0].filedAt = "2026-08-02";
assert.equal(snapshot.evidence.facts[0].filedAt, "2026-08-01", "Snapshot retains original dates independently of later mutations");
assert.equal(validate(input, identity), null, "Changed evidence cannot borrow the old fingerprint");
for (const change of [{ cik: "0000000002" }, { direction: "upside" }, { fingerprint: "valuation:invalid" }]) assert.equal(validate(snapshot, { ...identity, ...change }), null);
for (const key of Object.keys(snapshot.evidence)) {
  const missing = structuredClone(snapshot); delete missing.evidence[key];
  assert.equal(validate(missing, identity), null, `Incomplete baseline: ${key}`);
}
process.env.RAILWAY_GIT_BRANCH = "main";
assert.equal(validate(snapshot, identity), null, "No main-branch snapshot writes");
process.env.RAILWAY_GIT_BRANCH = "pilot-simple-alerts";

const stored = new Map(); const writes = []; let serial = 0;
const markerKey = "test/research-evidence/valuation-reviews/0000000001.json";
const legacy = { cik: identity.cik, fingerprint: "legacy-lock", outcome: "needs_more_data", reviewedAt: "2026-10-06T04:49:16Z" };
stored.set(markerKey, { value: legacy, etag: "legacy-etag" });
const api = loadTsModule("@/lib/opportunity-engine/pr262-research-evidence", {
  "@/lib/simple-alert-pilot-scope": { applyPilotResearchAlertPolicy: value => value },
  "@/lib/opportunity-engine/company-profile-cache": { readCompanyProfiles: async () => new Map() },
  "@/lib/company-profile": { verifiedCompanyProfile: value => value, profileCik: value => value },
  "@/lib/opportunity-engine/pr262-evidence-metrics": { evidenceTiming: () => ({}), summarizeEvidenceQuality: () => ({}) },
  "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => `test/${key}` },
  "@/lib/signal-explanation": { explainCandidate: () => ({}), plainEvidenceGaps: value => value },
  "@/lib/alert-details": { alertDetails: () => ({ complete: false, missing: [], industry: "Fixture", outlook: {} }), completePriceOutlook: () => false, industryLabel: () => "Fixture" },
  "@/lib/r2-warehouse": {
    readVersionedTextFromR2: async key => stored.has(key) ? { found: true, text: JSON.stringify(stored.get(key).value), etag: stored.get(key).etag } : { found: false, text: null, etag: null },
    writeVersionedJsonToR2: async (key, value, condition) => {
      if (key === markerKey) assert.equal(condition.expectedEtag, stored.get(key).etag, "Preserve conditional writes");
      writes.push(key); stored.set(key, { value: structuredClone(value), etag: String(++serial) }); return { written: true };
    },
  },
});
const roles = ["analyst_agent", "valuation_dcf_agent", "skeptic_agent", "final_judge"];
const committee = { ok: true, agentsCompleted: 4, agentsFailed: 0, output: { overallRecommendation: "needs_more_data", modelUsageSummary: {
  reviewPlan: { policy: "focused_v1", agentIds: roles }, roleDiagnostics: roles.map(agentId => ({ agentId, status: "completed" })),
} } };
const report = { candidateFingerprint: identity.fingerprint, selectedCandidate: { ticker: "FIXTURE", cik: identity.cik, direction: identity.direction,
  eventFamily: "valuation_gap", reviewEvidenceSnapshot: snapshot }, openAiCalled: true, status: "candidate_needs_more_data", committee };
const args = { event: { id: "fixture-valuation", ticker: "FIXTURE" }, report, sourceDecisionGrade: true, sourceFailureReason: null, now: new Date("2026-10-06T18:00:00Z") };
assert.deepEqual(await api.readLastValuationReview(identity.cik), { fingerprint: legacy.fingerprint, outcome: legacy.outcome, reviewedAt: legacy.reviewedAt, admittedAt: null, valuationBaseline: undefined }, "Legacy reader and lock remain usable without inventing a materiality baseline");
for (const changed of [ { ...report, openAiCalled: false }, { ...report, committee: { ...committee, ok: false, agentsFailed: 1 } },
  { ...report, committee: { ...committee, agentsCompleted: 3 } } ]) {
  await api.recordResearchEvidence({ ...args, report: changed });
  assert.deepEqual(stored.get(markerKey).value, legacy, "Unpaid/partial/failed attempts cannot replace completed review provenance");
}
await api.recordResearchEvidence(args);
const marker = structuredClone(stored.get(markerKey).value);
assert.equal(marker.fingerprint, identity.fingerprint);
assert.equal(marker.outcome, "needs_more_data");
assert.deepEqual(marker.reviewEvidenceSnapshot, snapshot);
assert.deepEqual(await api.readLastValuationReview(identity.cik), { fingerprint: identity.fingerprint, outcome: "needs_more_data", reviewedAt: args.now.toISOString(), admittedAt: null, valuationBaseline: undefined, reviewEvidenceSnapshot: snapshot }, "Completed provenance remains readable without fabricating missing materiality inputs");
await api.recordResearchEvidence({ ...args, report: { ...report, openAiCalled: false, committee: null } });
assert.deepEqual(stored.get(markerKey).value, marker, "No-paid collection cannot renew reviewed evidence");
assert(writes.every(key => !/ledger|ai-daily|cost|reservation/.test(key)), "No accounting/allowance writes");
console.log("PASS: exact-input snapshots, dated provenance, identity/hash checks, pilot isolation, legacy locks, conditional persistence and completed-review-only writes; no paid calls");
