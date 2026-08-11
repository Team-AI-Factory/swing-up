import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/opportunity-engine/us-serious-signal-consistency.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const cjsModule = { exports: {} };
new Function("require", "module", "exports", output)(() => {
  throw new Error("The consistency gate must not load runtime dependencies.");
}, cjsModule, cjsModule.exports);
const { verifyUsSeriousSignals } = cjsModule.exports;

function watchOut(overrides = {}) {
  return {
    fingerprint: "event-proof-1",
    ticker: "SAFE",
    company: "Safe Corp",
    action: "watch_out",
    status: "new",
    source: "event_pilot",
    firstSeenAt: "2026-08-11T00:00:00.000Z",
    lastSeenAt: "2026-08-11T00:00:00.000Z",
    currentPrice: null,
    conservativeFairValue: null,
    baseFairValue: null,
    optimisticFairValue: null,
    potentialPercent: null,
    qualityScore: 80,
    riskScore: 20,
    confidenceScore: 85,
    marketRegime: "neutral",
    reasons: ["Decision-grade official event."],
    blockers: [],
    evidence: {
      officialSourceConfirmed: true,
      secDiligenceConfirmed: true,
      priceCrossChecked: false,
      historicalPilotPassed: true,
      longTermNormalizationPassed: true,
      specialistModel: "general",
      committeeApproved: true,
      committeeAgentsCompleted: 14,
      committeeAgentsFailed: 0,
      finalJudgePositive: true,
      finalJudgeConfidence: 80,
    },
    thesisSnapshot: { baseFairValue: null, qualityScore: 80, riskScore: 20 },
    ...overrides,
  };
}

function report(signals) {
  return {
    checkedAt: "2026-08-11T00:00:00.000Z",
    seriousSignals: { buy: [], sell: [], watchOut: signals },
  };
}

const approved = verifyUsSeriousSignals(report([watchOut()]));
assert.equal(approved.verifiedCounts.watchOut, 1);
assert.equal(approved.invariants.fullCommitteeAndFinalJudgeRequired, true);

const incompleteCommittee = verifyUsSeriousSignals(report([watchOut({
  fingerprint: "event-proof-2",
  evidence: { ...watchOut().evidence, committeeAgentsCompleted: 13 },
})]));
assert.equal(incompleteCommittee.verifiedCounts.watchOut, 0);
assert.ok(incompleteCommittee.rejected[0].reasons.some((reason) => /13 specialists plus the Final Judge/i.test(reason)));

const weakJudge = verifyUsSeriousSignals(report([watchOut({
  fingerprint: "event-proof-3",
  evidence: { ...watchOut().evidence, finalJudgeConfidence: 79 },
})]));
assert.equal(weakJudge.verifiedCounts.watchOut, 0);
assert.ok(weakJudge.rejected[0].reasons.some((reason) => /80% confidence/i.test(reason)));

const legacySignal = watchOut({ fingerprint: "legacy", evidence: {
  officialSourceConfirmed: true,
  secDiligenceConfirmed: true,
  priceCrossChecked: false,
  historicalPilotPassed: true,
  longTermNormalizationPassed: true,
  specialistModel: "general",
} });
const legacyRejected = verifyUsSeriousSignals(report([legacySignal]));
assert.equal(legacyRejected.verifiedCounts.watchOut, 0);
assert.ok(legacyRejected.rejected[0].reasons.some((reason) => /full AI committee/i.test(reason)));

console.log(JSON.stringify({
  ok: true,
  allThirteenSpecialistsAndJudgeRequired: true,
  judgeMinimumConfidence: 80,
  legacyScannerOutputsFailClosed: true,
}, null, 2));
