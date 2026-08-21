import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/opportunity-engine/us-serious-signal-consistency.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const cjsModule = { exports: {} };
new Function("require", "module", "exports", output)(() => { throw new Error("Unexpected runtime import"); }, cjsModule, cjsModule.exports);
const { verifyUsSeriousSignals } = cjsModule.exports;

function signal(overrides = {}) {
  return {
    fingerprint: "fingerprint",
    ticker: "SAFE",
    company: "Safe Company",
    action: "buy",
    status: "new",
    source: "foundation_value",
    firstSeenAt: "2026-08-09T00:00:00Z",
    lastSeenAt: "2026-08-09T00:00:00Z",
    currentPrice: 50,
    conservativeFairValue: 80,
    baseFairValue: 100,
    optimisticFairValue: 120,
    potentialPercent: 100,
    qualityScore: 90,
    riskScore: 20,
    confidenceScore: 90,
    marketRegime: "neutral",
    reasons: [],
    blockers: [],
    evidence: {
      officialSourceConfirmed: true,
      secDiligenceConfirmed: true,
      priceCrossChecked: true,
      historicalContextAvailable: null,
      longTermNormalizationPassed: true,
      specialistModel: "general",
      committeeApproved: true,
      committeeAgentsCompleted: 14,
      committeeAgentsFailed: 0,
      finalJudgePositive: true,
      finalJudgeConfidence: 85,
    },
    thesisSnapshot: { baseFairValue: 100, qualityScore: 90, riskScore: 20 },
    ...overrides,
  };
}

const validGeneral = signal();
const inconsistentSpecialist = signal({
  ticker: "GSL",
  company: "Global Ship Lease Inc New",
  currentPrice: 42.44,
  conservativeFairValue: 108.12,
  baseFairValue: 20.68,
  optimisticFairValue: 171.54,
  potentialPercent: -51.27,
  evidence: {
    ...signal().evidence,
    specialistModel: "cyclical_mid_cycle",
  },
});
const unsupportedPharma = signal({
  ticker: "IRWD",
  company: "Ironwood Pharmaceuticals, Inc.",
  currentPrice: 4.32,
  conservativeFairValue: 16.91,
  baseFairValue: 19.01,
  optimisticFairValue: 21.11,
  potentialPercent: 340.05,
});
const validSpecialist = signal({
  ticker: "CYCLE",
  company: "Cycle Example",
  currentPrice: 60,
  conservativeFairValue: null,
  baseFairValue: 100,
  optimisticFairValue: null,
  potentialPercent: 66.67,
  evidence: {
    ...signal().evidence,
    specialistModel: "cyclical_mid_cycle",
  },
});
const noHistory = signal({
  ticker: "EVENT",
  company: "Event Example",
  source: "event_pilot",
  evidence: {
    ...signal().evidence,
    historicalContextAvailable: false,
  },
});
const incompleteCommittee = signal({
  ticker: "PARTIAL",
  company: "Partial Committee Example",
  evidence: {
    ...signal().evidence,
    committeeAgentsCompleted: 13,
  },
});

const verified = verifyUsSeriousSignals({
  checkedAt: "2026-08-09T00:00:00Z",
  seriousSignals: {
    buy: [validGeneral, inconsistentSpecialist, unsupportedPharma, validSpecialist, noHistory, incompleteCommittee],
    sell: [],
    watchOut: [],
  },
});

assert.deepEqual(verified.seriousSignals.buy.map((item) => item.ticker), ["SAFE", "CYCLE", "EVENT"]);
assert.equal(verified.verifiedCounts.buy, 3);
assert.equal(verified.rawCounts.buy, 6);
assert.ok(verified.rejected.some((item) => item.ticker === "GSL" && item.reasons.some((reason) => reason.includes("specialist"))));
assert.ok(verified.rejected.some((item) => item.ticker === "IRWD" && item.reasons.some((reason) => reason.includes("pharmaceutical"))));
assert.equal(verified.rejected.some((item) => item.ticker === "EVENT"), false);
assert.ok(verified.rejected.some((item) => item.ticker === "PARTIAL" && item.reasons.some((reason) => reason.includes("13 specialists plus the Final Judge"))));

console.log(JSON.stringify({
  ok: true,
  specialistOverridesGenericThresholds: true,
  inconsistentShippingBuyRejected: true,
  unsupportedPharmaGeneralBuyRejected: true,
  potentialReconciliationRequired: true,
  missingHistoryDoesNotVetoCurrentEvidence: true,
  fullCommitteeProofRequired: true,
}, null, 2));
