import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

function compile(url, dependencies = {}) {
  const source = readFileSync(url, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (name in dependencies) return dependencies[name];
    throw new Error(`Unexpected import in five-case pilot smoke: ${name}`);
  }, cjsModule, cjsModule.exports);
  return cjsModule.exports;
}

const policy = compile(new URL("../lib/equity-signal/pilot-serious-signal-policy.ts", import.meta.url));
let nextResult = null;
const wrapper = compile(new URL("../lib/equity-signal/pilot-runner.ts", import.meta.url), {
  "@/lib/equity-signal/pilot-serious-signal-policy": policy,
  "@/lib/equity-signal/pilot-historical-bootstrap": {
    bootstrapPilotHistoricalSignals: async () => ({
      records: [{ id: "public-history" }],
      requestedSeeds: 1,
      builtSeeds: 1,
      errors: [],
      priceSource: "public_adjusted_prices",
      noSyntheticData: true,
    }),
    mergePilotHistoricalSignals: (supplied, records) => [...supplied, ...records],
  },
  "@/lib/equity-signal/runner": {
    runEquitySignalLab: async () => structuredClone(nextResult),
  },
});

function resultWith({ action = "buy", samples = 0, hitRate = 0, p25 = null, leakageSafe = true, horizon = "7D" } = {}) {
  return {
    ok: true,
    status: `serious_${action}`,
    seriousSignalFound: true,
    actionableSignalFound: true,
    alertType: action,
    blockers: [],
    selectedCandidate: {
      ticker: "EXM",
      historicalAnalog: {
        sampleSize: samples,
        weightedHitRatePercent: hitRate,
        hitRatePercent: hitRate,
        p25DirectionAdjustedReturnPercent: p25,
        leakageSafe,
        selectedHorizon: horizon,
      },
    },
    historicalLearning: {},
    liveSourcePolicy: {},
    _historicalSignalLibraryAdditions: [{ id: "forward-finding" }],
  };
}

nextResult = resultWith();
const noHistory = await wrapper.runPilotEquitySignalLab({});
assert.equal(noHistory.seriousSignalFound, false);
assert.equal(noHistory.status, "candidate_needs_five_case_pilot_history");

nextResult = resultWith({ samples: 4, hitRate: 100, p25: 1 });
const fourCases = await wrapper.runPilotEquitySignalLab({});
assert.equal(fourCases.seriousSignalFound, false);
assert.equal(fourCases.pilotHistoricalGate.checks.fiveIndependentRealEvents, false);

nextResult = resultWith({ samples: 5, hitRate: 80, p25: 1 });
const weakHitRate = await wrapper.runPilotEquitySignalLab({});
assert.equal(weakHitRate.seriousSignalFound, false);
assert.equal(weakHitRate.pilotHistoricalGate.checks.observedDirectionalHitRateAtLeast90, false);

nextResult = resultWith({ samples: 5, hitRate: 100, p25: -0.1 });
const weakLowerQuartile = await wrapper.runPilotEquitySignalLab({});
assert.equal(weakLowerQuartile.seriousSignalFound, false);
assert.equal(weakLowerQuartile.pilotHistoricalGate.checks.lowerQuartileNotOppositeDirection, false);

nextResult = resultWith({ samples: 5, hitRate: 100, p25: 0.5 });
const pilotBuy = await wrapper.runPilotEquitySignalLab({});
assert.equal(pilotBuy.seriousSignalFound, true);
assert.equal(pilotBuy.alertType, "buy");
assert.equal(pilotBuy.liveSourcePolicy.nonUsMarketsEnabled, false);
assert.equal(pilotBuy.liveSourcePolicy.analystExpectationsCanVetoBuy, false);
assert.equal(pilotBuy.historicalLearning.minimumIndependentRealEventsForPilotSeriousBuySell, 5);
assert.equal(pilotBuy.historicalLearning.statisticallyEquivalentToThirtySamples, false);
assert.deepEqual(
  pilotBuy._historicalSignalLibraryAdditions.map((record) => record.id),
  ["forward-finding", "public-history"],
);

nextResult = resultWith({ action: "sell", samples: 6, hitRate: 100, p25: 0.2 });
const pilotSell = await wrapper.runPilotEquitySignalLab({});
assert.equal(pilotSell.seriousSignalFound, true);
assert.equal(pilotSell.alertType, "sell");

nextResult = resultWith({ action: "watch", samples: 10, hitRate: 100, p25: 1 });
const watchBlocked = await wrapper.runPilotEquitySignalLab({});
assert.equal(watchBlocked.seriousSignalFound, false);
assert.equal(watchBlocked.alertType, null);

console.log(JSON.stringify({
  ok: true,
  marketScope: policy.US_SERIOUS_SIGNAL_PILOT_POLICY.marketScope,
  minimumIndependentEvents: policy.US_SERIOUS_SIGNAL_PILOT_POLICY.minimumIndependentHistoricalEvents,
  minimumObservedHitRatePercent: policy.US_SERIOUS_SIGNAL_PILOT_POLICY.minimumObservedDirectionalHitRatePercent,
  analystExpectationsCanVetoBuy: policy.US_SERIOUS_SIGNAL_PILOT_POLICY.analystExpectationsCanVetoBuy,
  noHistoryBlocked: true,
  fourCasesBlocked: true,
  weakHitRateBlocked: true,
  negativeLowerQuartileBlocked: true,
  fiveCaseBuyAllowed: true,
  fiveCaseSellAllowed: true,
  uncertifiedWatchBlocked: true,
  historyStillPersisted: true,
}, null, 2));
