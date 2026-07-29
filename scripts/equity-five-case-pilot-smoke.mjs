import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/equity-signal/pilot-serious-signal-policy.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const cjsModule = { exports: {} };
new Function("require", "module", "exports", output)((name) => { throw new Error(`Unexpected import: ${name}`); }, cjsModule, cjsModule.exports);
const { evaluateFiveCasePilotGate, US_SERIOUS_SIGNAL_PILOT_POLICY } = cjsModule.exports;

function candidate({ samples, wins, p25 = 0.5, sameDirection = true, leakageSafe = true }) {
  const items = Array.from({ length: samples }, (_, index) => ({
    eventKey: `event-${index}`,
    recordId: `record-${index}`,
    hit: index < wins,
    matchedFeatures: sameDirection ? ["same predicted direction"] : [],
    provenance: { origin: "public_historical_bootstrap", eventSourceUrl: `https://official.example/${index}`, priceSource: "public adjusted prices" },
  }));
  return {
    historicalAnalog: {
      sampleSize: samples,
      weightedHitRatePercent: samples ? (wins / samples) * 100 : 0,
      hitRatePercent: samples ? (wins / samples) * 100 : 0,
      p25DirectionAdjustedReturnPercent: p25,
      leakageSafe,
      selectedHorizon: samples ? "7D" : null,
      items,
    },
  };
}

const noHistory = evaluateFiveCasePilotGate(candidate({ samples: 0, wins: 0, p25: null }));
assert.equal(noHistory.passed, false);
assert.equal(noHistory.checks.fiveIndependentRealEvents, false);

const fourCases = evaluateFiveCasePilotGate(candidate({ samples: 4, wins: 4 }));
assert.equal(fourCases.passed, false);

const fourOfFive = evaluateFiveCasePilotGate(candidate({ samples: 5, wins: 4 }));
assert.equal(fourOfFive.passed, true);
assert.equal(fourOfFive.observedDirectionalHitRatePercent, 80);
assert.equal(fourOfFive.checks.observedDirectionalHitRateAtLeast80, true);

const threeOfFive = evaluateFiveCasePilotGate(candidate({ samples: 5, wins: 3 }));
assert.equal(threeOfFive.passed, false);
assert.equal(threeOfFive.checks.observedDirectionalHitRateAtLeast80, false);

const mixedDirection = evaluateFiveCasePilotGate(candidate({ samples: 5, wins: 5, sameDirection: false }));
assert.equal(mixedDirection.passed, false);
assert.equal(mixedDirection.checks.sameDirectionHistoricalEvents, false);

const negativeWeakQuarter = evaluateFiveCasePilotGate(candidate({ samples: 5, wins: 4, p25: -0.1 }));
assert.equal(negativeWeakQuarter.passed, false);

assert.equal(US_SERIOUS_SIGNAL_PILOT_POLICY.minimumObservedDirectionalHitRatePercent, 80);
assert.equal(US_SERIOUS_SIGNAL_PILOT_POLICY.forwardOutcomeRequiredBeforeAlert, false);
assert.equal(US_SERIOUS_SIGNAL_PILOT_POLICY.analystExpectationsCanVetoBuy, false);

console.log(JSON.stringify({ ok: true, minimumIndependentEvents: 5, fourOfFivePasses: true, threeOfFiveFails: true, sameDirectionRequired: true, lowerQuartileRequired: true, ownForwardOutcomeNotRequiredBeforeAlert: true }, null, 2));
