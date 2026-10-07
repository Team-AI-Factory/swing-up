import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";

const stored = new Map();
let revision = 0;
const warehouse = {
  readVersionedTextFromR2: async key => stored.has(key)
    ? { found: true, text: JSON.stringify(stored.get(key).value), etag: stored.get(key).etag }
    : { found: false, text: null, etag: null },
  writeVersionedJsonToR2: async (key, value) => {
    stored.set(key, { value: structuredClone(value), etag: String(++revision) });
    return { written: true, conflict: false };
  },
  listR2ObjectKeys: async () => ({ keys: [], isTruncated: false, nextContinuationToken: null }),
};
const policy = loadTsModule("@/lib/ai-committee/review-policy");
const blockers = loadTsModule("@/lib/opportunity-engine/pr262-review-blockers");
const evidence = loadTsModule("@/lib/opportunity-engine/pr262-research-evidence", {
  "@/lib/simple-alert-pilot-scope": { applyPilotResearchAlertPolicy: value => value },
  "@/lib/equity-signal/review-evidence-revision": { validatedReviewEvidenceSnapshot: value => value },
  "@/lib/simple-alert-pilot-runtime": { isSimpleAlertPilot: () => true, SIMPLE_PILOT_PREFIX: "test" },
  "@/lib/ai-committee/review-policy": policy,
  "@/lib/opportunity-engine/company-profile-cache": { readCompanyProfiles: async () => new Map() },
  "@/lib/company-profile": { verifiedCompanyProfile: () => null, profileCik: value => value },
  "@/lib/opportunity-engine/pr262-evidence-metrics": {
    evidenceTiming: () => ({}), summarizeEvidenceQuality: () => ({}),
  },
  "@/lib/r2-warehouse": warehouse,
  "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => `test/${key}` },
  "@/lib/signal-explanation": { explainCandidate: () => "", plainEvidenceGaps: () => [] },
  "@/lib/alert-details": {
    alertDetails: () => ({ missing: [], outlook: {}, valuationException: false }),
    completePriceOutlook: () => true,
    industryLabel: value => value,
  },
  "@/lib/equity-signal/fundamentals": { requiredFinancialFactPresent: () => false },
});

const promptLimitCommittee = {
  roleDiagnostics: [{ agentId: "analyst_agent", status: "failed", error: "prompt_too_large",
    providerFailure: { category: "input_limit", code: "prompt_too_large" }, usageReported: false }],
  output: { modelUsageSummary: {
    actualOpenAiUsage: { responsesWithUsage: 0, tokens: {}, byModel: {} },
    roleDiagnostics: [{ agentId: "analyst_agent", status: "failed", error: "prompt_too_large",
      providerFailure: { category: "input_limit", code: "prompt_too_large" }, usageReported: false }],
  } },
};
assert.equal(evidence.committeeInputLimitRejectedWithoutUsage(promptLimitCommittee), true);
await evidence.recordCommitteeInputLimitHold("valuation:issuer:downside:unchanged", promptLimitCommittee,
  new Date("2026-10-07T05:33:38Z"));
assert.equal(await evidence.unchangedCommitteeInputLimitHeld("valuation:issuer:downside:unchanged"), true,
  "Exact unchanged evidence must be held across different event IDs");
assert.equal(await evidence.unchangedCommitteeInputLimitHeld("valuation:issuer:downside:changed"), false,
  "Changed evidence must remain eligible");
assert.equal(blockers.pr262ReservationBlocker("unchanged_prompt_input_limit"), "same_evidence",
  "An exact unchanged input-limit hold must not be reported as budget or unclassified capacity");

const partialUsage = structuredClone(promptLimitCommittee);
partialUsage.output.modelUsageSummary.actualOpenAiUsage.responsesWithUsage = 1;
assert.equal(evidence.committeeInputLimitRejectedWithoutUsage(partialUsage), false,
  "Observed provider usage must never be classified as a zero-usage input rejection");

const eventJob = readFileSync(new URL("../lib/opportunity-engine/pr262-event-job.ts", import.meta.url), "utf8");
const holdCheck = eventJob.indexOf("await unchangedCommitteeInputLimitHeld(reservation.candidateFingerprint)");
const terminalReserve = eventJob.indexOf("terminalReserved = await reserveTerminalReview", holdCheck);
assert.ok(holdCheck >= 0 && terminalReserve > holdCheck,
  "The deterministic hold must run before terminal and dollar reservations");
console.log("Committee input-limit hold: unchanged evidence blocked before reservation; changed evidence and used requests remain distinct.");
