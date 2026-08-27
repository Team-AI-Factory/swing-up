import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/opportunity-engine/pr262-serious-watch-out-authority.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const objects = new Map();
let etag = 0;
const storage = {
  readVersionedTextFromR2: async (key) => {
    const found = objects.get(key);
    return found
      ? { found: true, text: JSON.stringify(found.value), etag: found.etag }
      : { found: false, text: null, etag: null };
  },
  writeVersionedJsonToR2: async (key, value, options = {}) => {
    const found = objects.get(key);
    if (options.createOnly && found) return { written: false, conflict: true, etag: found.etag };
    const nextEtag = `etag-${++etag}`;
    objects.set(key, { value: structuredClone(value), etag: nextEtag });
    return { written: true, conflict: false, etag: nextEtag };
  },
};
const loaded = { exports: {} };
new Function("require", "module", "exports", output)((name) => {
  if (name === "node:crypto") return crypto;
  if (name === "@/lib/r2-warehouse") return storage;
  if (name === "@/lib/opportunity-engine/pr262-storage") return { pr262StorageKey: (relative) => `production/pr262/${relative}` };
  throw new Error(`Unexpected Watch Out authority import: ${name}`);
}, loaded, loaded.exports);

function resultPayload(overrides = {}) {
  const candidate = {
    ticker: "RISK",
    cik: "0001234567",
    direction: "downside",
    evidenceFingerprint: "risk-fingerprint",
    eventHeadline: "RISK reports a material data breach",
    whatHappened: "The issuer confirmed a data breach in an official filing.",
    eventFamily: "cyber_incident",
    gatePassed: true,
    eventTruth: 98,
    mappingConfidence: 100,
    materiality: 90,
    transmissionConfidence: 88,
    evidenceIndependence: 92,
    contradictionPenalty: 0,
    pricedInPenalty: 0,
    rumour: false,
    receipts: [{ official: true, primarySource: true, channel: "sec_current_filings", title: "Cybersecurity incident" }],
    quote: { price: 20, actionableForSeriousSignal: true, marketSession: "regular" },
  };
  return {
    version: 1,
    kind: "pr262_targeted_event_job_result",
    companyPointer: { ticker: "RISK", cik: "0001234567" },
    report: {
      checkedAt: "2026-08-20T10:00:00.000Z",
      seriousSignalFound: true,
      actionableSignalFound: true,
      alertType: "sell",
      candidateFingerprint: "risk-fingerprint",
      selectedCandidate: candidate,
      tradingHaltSafety: { currentStateKnown: true },
      committee: {
        ok: true,
        agentsCompleted: 14,
        agentsFailed: 0,
        finalJudge: { verdict: "positive", confidence: 88 },
        output: { overallRecommendation: "approve" },
      },
    },
    ...overrides,
  };
}

const validKey = "production/pr262/event-job/runs/2026-08-20/risk.json";
objects.set(validKey, { value: resultPayload(), etag: `etag-${++etag}` });
const promoted = await loaded.exports.promotePr262SeriousWatchOut(validKey);
assert.equal(promoted.promoted, true);
assert.equal(promoted.reason, "new_serious_watch_out");
assert.equal(promoted.ruleId, "cyber_or_operational_outage");
const outbox = objects.get(promoted.outboxKey).value;
assert.equal(outbox.kind, "pr262_committee_verified_serious_watch_out");
assert.equal(outbox.authority.historicalCasesRequired, false);
assert.equal(outbox.committee.agentsCompleted, 14);
const duplicate = await loaded.exports.promotePr262SeriousWatchOut(validKey);
assert.equal(duplicate.promoted, true);
assert.equal(duplicate.reason, "already_recorded");
objects.set(promoted.outboxKey, { value: { ...outbox, resultKey: "different-result" }, etag: `etag-${++etag}` });
await assert.rejects(
  () => loaded.exports.promotePr262SeriousWatchOut(validKey),
  /pr262_watch_out_outbox_content_conflict/,
  "An immutable outbox collision must not be treated as an idempotent duplicate.",
);

const pricedKey = "production/pr262/event-job/runs/2026-08-20/priced.json";
const priced = resultPayload();
priced.report.selectedCandidate.pricedInPenalty = 70;
objects.set(pricedKey, { value: priced, etag: `etag-${++etag}` });
assert.equal((await loaded.exports.promotePr262SeriousWatchOut(pricedKey)).promoted, false);

const wrongIssuerKey = "production/pr262/event-job/runs/2026-08-20/wrong-issuer.json";
const wrongIssuer = resultPayload();
wrongIssuer.companyPointer.cik = "0007654321";
objects.set(wrongIssuerKey, { value: wrongIssuer, etag: `etag-${++etag}` });
assert.equal((await loaded.exports.promotePr262SeriousWatchOut(wrongIssuerKey)).promoted, false);

const partialCommitteeKey = "production/pr262/event-job/runs/2026-08-20/partial.json";
const partialCommittee = resultPayload();
partialCommittee.report.committee.agentsCompleted = 13;
objects.set(partialCommitteeKey, { value: partialCommittee, etag: `etag-${++etag}` });
assert.equal((await loaded.exports.promotePr262SeriousWatchOut(partialCommitteeKey)).promoted, false);

const zeroCikKey = "production/pr262/event-job/runs/2026-08-20/zero-cik.json";
const zeroCik = resultPayload();
zeroCik.companyPointer.cik = "0000000000";
zeroCik.report.selectedCandidate.cik = "0000000000";
objects.set(zeroCikKey, { value: zeroCik, etag: `etag-${++etag}` });
assert.equal((await loaded.exports.promotePr262SeriousWatchOut(zeroCikKey)).promoted, false, "An all-zero issuer identifier must never satisfy exact CIK authority.");

console.log(JSON.stringify({
  ok: true,
  approvedRiskFamilyRequired: true,
  exactIssuerRequired: true,
  zeroCikRejected: true,
  currentQuoteAndHaltStateRequired: true,
  pricedInRiskFailsClosed: true,
  allFourteenCommitteeRolesRequired: true,
  historicalCasesRemainOptional: true,
  outboxIdempotent: true,
  outboxContentConflictFailsClosed: true,
}, null, 2));
