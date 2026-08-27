import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/equity-signal/pilot-serious-signal-policy.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const cjsModule = { exports: {} };
new Function("require", "module", "exports", output)((name) => { throw new Error(`Unexpected import: ${name}`); }, cjsModule, cjsModule.exports);
const { evaluateFiveCasePilotGate, US_SERIOUS_SIGNAL_PILOT_POLICY } = cjsModule.exports;

function candidate({ samples, wins, p25 = 0.5 }) {
  const items = Array.from({ length: samples }, (_, index) => ({
    eventKey: `event-${index}`,
    recordId: `record-${index}`,
    hit: index < wins,
    matchedFeatures: ["optional historical context"],
    provenance: { origin: "public_historical_bootstrap", eventSourceUrl: `https://official.example/${index}`, priceSource: "public adjusted prices" },
  }));
  return {
    historicalAnalog: {
      sampleSize: samples,
      weightedHitRatePercent: samples ? (wins / samples) * 100 : 0,
      hitRatePercent: samples ? (wins / samples) * 100 : 0,
      p25DirectionAdjustedReturnPercent: p25,
      leakageSafe: true,
      selectedHorizon: samples ? "7D" : null,
      items,
    },
  };
}

const noHistory = evaluateFiveCasePilotGate(candidate({ samples: 0, wins: 0, p25: null }));
assert.equal(noHistory.passed, true);
assert.equal(noHistory.historicallyRequired, false);
assert.equal(noHistory.checks.historicalGateDisabled, true);
assert.equal(noHistory.checks.currentEvidenceMayAdvanceWithoutHistory, true);

const weakHistory = evaluateFiveCasePilotGate(candidate({ samples: 5, wins: 1, p25: -20 }));
assert.equal(weakHistory.passed, true, "Weak historical analogs may remain context but cannot block current evidence");
assert.equal(weakHistory.observedDirectionalHitRatePercent, 20);
assert.equal(weakHistory.lowerQuartileDirectionAdjustedReturnPercent, -20);

const strongHistory = evaluateFiveCasePilotGate(candidate({ samples: 8, wins: 7, p25: 3 }));
assert.equal(strongHistory.passed, true);
assert.equal(strongHistory.independentRealEventCount, 8);
assert.equal(strongHistory.observedDirectionalHitRatePercent, 87.5);

assert.equal(US_SERIOUS_SIGNAL_PILOT_POLICY.minimumIndependentHistoricalEvents, 0);
assert.equal(US_SERIOUS_SIGNAL_PILOT_POLICY.minimumObservedDirectionalHitRatePercent, 0);
assert.equal(US_SERIOUS_SIGNAL_PILOT_POLICY.historicalCasesRequiredForSeriousSignal, false);
assert.equal(US_SERIOUS_SIGNAL_PILOT_POLICY.requireLeakageSafeHistory, false);
assert.equal(US_SERIOUS_SIGNAL_PILOT_POLICY.forwardOutcomeRequiredBeforeAlert, false);
assert.equal(US_SERIOUS_SIGNAL_PILOT_POLICY.analystExpectationsCanVetoBuy, false);

console.log(JSON.stringify({
  ok: true,
  historicalGateDisabled: true,
  noHistoryCanAdvance: true,
  weakHistoryDoesNotBlock: true,
  strongHistoryStillRecordedAsContext: true,
  ownForwardOutcomeNotRequiredBeforeAlert: true,
}, null, 2));
