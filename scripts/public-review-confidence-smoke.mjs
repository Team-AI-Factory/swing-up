import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";

const { completedCommitteeConfidence, publicReviewConfidence } = loadTsModule("@/lib/public-review-confidence");
const roles = ["analyst_agent", "skeptic_agent", "final_judge"];
const committee = { ok: true, agentsCompleted: 3, agentsFailed: 0,
  finalJudge: { confidence: 0, verdict: "needs_more_data" },
  output: { overallRecommendation: "needs_more_data", modelUsageSummary: {
    reviewPlan: { policy: "focused_v1", agentIds: roles },
    roleDiagnostics: roles.map(agentId => ({ agentId, status: "completed" })),
  } },
};
assert.equal(completedCommitteeConfidence(committee), 0, "A genuine completed judge can assign zero");
const failed = { ...committee, ok: false, agentsCompleted: 2, agentsFailed: 1,
  output: { ...committee.output, modelUsageSummary: { ...committee.output.modelUsageSummary,
    roleDiagnostics: roles.map(agentId => ({ agentId, status: agentId === "final_judge" ? "failed" : "completed" })),
  } },
};
assert.equal(completedCommitteeConfidence(failed), null, "A failed judge's fallback zero is not a measured confidence");
assert.equal(completedCommitteeConfidence({ ...failed, finalJudge: { confidence: 92 } }), null);
for (const confidence of [null, undefined, "0", NaN, Infinity, -1, 101]) {
  assert.equal(completedCommitteeConfidence({ ...committee, finalJudge: { confidence } }), null);
}

const proof = { fingerprint: "same-evidence", committee };
const legacy = { reviewEvidenceFingerprint: "same-evidence", completedReview: proof,
  committee: { completed: 3, failed: 0, confidence: 0 } };
assert.deepEqual(publicReviewConfidence(legacy), { confidence: 0, confidenceBasis: "historical_committee_review" },
  "A valid legacy review needs no newly added source field");
assert.deepEqual(publicReviewConfidence({ ...legacy, committee: { ...legacy.committee, source: "current_attempt" } }),
  { confidence: 0, confidenceBasis: "committee_review" });
assert.deepEqual(publicReviewConfidence({ ...legacy, committee: { ...legacy.committee, source: "current_attempt", confidence: 92 } }),
  { confidence: 0, confidenceBasis: "historical_committee_review" }, "A condensed summary cannot replace the score bound to the actual completed decision");
const legacyCountOnlyProof = { ...committee };
delete legacyCountOnlyProof.finalJudge;
assert.deepEqual(publicReviewConfidence({ ...legacy, completedReview: { ...proof, committee: legacyCountOnlyProof } }),
  { confidence: null, confidenceBasis: null }, "A legacy scalar cannot be bound merely by matching completed-role counts");
const secondCommittee = { ...committee, finalJudge: { confidence: 37, verdict: "needs_more_data" } };
assert.deepEqual(publicReviewConfidence({ ...legacy, reviewEvidenceFingerprint: "second-decision",
  completedReview: { fingerprint: "second-decision", committee: secondCommittee },
  committee: { completed: 3, failed: 0, confidence: 92 } }),
  { confidence: 37, confidenceBasis: "historical_committee_review" }, "Same-size committees with different fingerprints and scores cannot borrow the previous scalar");
assert.deepEqual(publicReviewConfidence({ ...legacy, completedReview: { ...proof, confidence: 92 } }),
  { confidence: null, confidenceBasis: null }, "Conflicting scores on the same proof fail closed");
for (const row of [
  { committee: { completed: 3, failed: 1, confidence: 0 } },
  { committee: { completed: 3, failed: 0, confidence: 92 }, quality: { committeeCompleted: true } },
  { ...legacy, completedReview: undefined },
  { ...legacy, reviewEvidenceFingerprint: "new-evidence" },
  { ...legacy, completedReview: { ...proof, committee: failed } },
]) assert.deepEqual(publicReviewConfidence(row), { confidence: null, confidenceBasis: null });

const history = { source: "terminal_decision", fingerprint: "same-evidence", committeeCompleted: true,
  committeeRolesCompleted: 3, committeeRolesFailed: 0, confidence: 0, decidedAt: "2026-10-13T01:00:00Z" };
const reused = { reviewEvidenceFingerprint: "same-evidence", committee: { source: "none", completed: 0, failed: 0, confidence: null },
  quality: { historicalReview: history } };
assert.deepEqual(publicReviewConfidence(reused), { confidence: 0, confidenceBasis: "historical_committee_review" });
for (const change of [{ committeeCompleted: false }, { committeeRolesFailed: 1 }, { fingerprint: "different" }, { decidedAt: null }, { confidence: "92" }]) {
  assert.deepEqual(publicReviewConfidence({ ...reused, quality: { historicalReview: { ...history, ...change } } }), { confidence: null, confidenceBasis: null });
}
assert.deepEqual(publicReviewConfidence({ ...reused, quality: {}, completedReview: { ...proof, confidence: 0 } }),
  { confidence: 0, confidenceBasis: "historical_committee_review" }, "An unpaid refresh may retain the proved earlier score");

const { assemblePublicSignals } = loadTsModule("@/lib/public-signals");
const { buildPriceOutlook } = loadTsModule("@/lib/signal-outlook");
const profile = companyProfileFixture();
const event = { ticker: profile.ticker, company: profile.company, cik: profile.cik, companyProfile: profile,
  id: "failed-judge-observation", kind: "event", eventFamily: "contract_award", action: "buy", userAlertEligible: true,
  committeeApproved: false, committeeStatus: "needs_more_data", currentPrice: 100,
  outlook: buildPriceOutlook({ currentPrice: 100, currency: "USD", action: "buy", conservative: 80, base: 120, optimistic: 140 }),
  explanation: { whatHappened: "The company reported a contract update." },
  committee: { completed: 2, failed: 1, confidence: 0 },
};
const visible = assemblePublicSignals([], [event]);
assert.equal(visible.length, 1, "Confidence presentation must not change provisional publication eligibility");
assert.equal(visible[0].confidence, null);
assert.equal(visible[0].committeeApproved, false);
assert.equal(visible[0].committeeStatus, "needs_more_data");
const completed = assemblePublicSignals([], [{ ...event, ...legacy }]);
assert.equal(completed[0].confidence, 0);
assert.equal(completed[0].confidenceBasis, "historical_committee_review");

// Verify the real recording boundary, using in-memory storage only.
const objects = new Map();
const evidence = loadTsModule("@/lib/opportunity-engine/pr262-research-evidence", {
  "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => key },
  "@/lib/r2-warehouse": {
    readVersionedTextFromR2: async key => ({ found: objects.has(key), text: objects.has(key) ? JSON.stringify(objects.get(key)) : null, etag: null }),
    writeVersionedJsonToR2: async (key, value) => { objects.set(key, structuredClone(value)); return { written: true, conflict: false }; },
  },
});
const recordCandidate = { ...event, evidenceFingerprint: "same-evidence", direction: "upside", currency: "USD",
  quote: { price: 100, observedAt: new Date().toISOString(), actionableForSeriousSignal: true },
  valuationRange: { conservativeValue: 80, baseValue: 120, optimisticValue: 140 } };
const input = { event: { id: "confidence-storage", ticker: event.ticker, cik: event.cik },
  report: { selectedCandidate: recordCandidate, candidateFingerprint: "same-evidence", openAiCalled: true,
    status: "committee_failed", committee: failed }, sourceDecisionGrade: true, now: new Date() };
await evidence.recordResearchEvidence(input);
const storedAlert = () => [...objects.values()].flatMap(value => Array.isArray(value.alerts) ? value.alerts : [])
  .find(value => value.eventId === "confidence-storage");
assert.equal(storedAlert().committee.confidence, null, "The failed judge's internal sentinel must not be persisted as a public score");
assert.equal(storedAlert().completedReview, null);
await evidence.recordResearchEvidence({ ...input, report: { ...input.report, status: "candidate_needs_more_data", committee } });
assert.equal(storedAlert().committee.confidence, 0);
assert.equal(storedAlert().completedReview.confidence, 0, "The retained score must be stored inside its matching completed-review proof");
assert.equal(storedAlert().completedReview.fingerprint, "same-evidence");
assert.equal(publicReviewConfidence(storedAlert()).confidence, 0);
console.log("PASS: failed/unrun judge scores unavailable, genuine completed zero preserved, exact legacy review proof, historical provenance and unchanged provisional/publication gates");
