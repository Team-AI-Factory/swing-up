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
    throw new Error(`Unexpected import in history-optional pilot smoke: ${name}`);
  }, cjsModule, cjsModule.exports);
  return cjsModule.exports;
}

let nextResult = null;
let receivedHistory = null;
let bootstrapRecords = [];
const wrapper = compile(new URL("../lib/equity-signal/pilot-runner.ts", import.meta.url), {
  "@/lib/equity-signal/pilot-historical-bootstrap": {
    bootstrapPilotHistoricalSignals: async () => ({
      records: structuredClone(bootstrapRecords),
      requestedSeeds: bootstrapRecords.length,
      builtSeeds: bootstrapRecords.length,
      errors: [],
      priceSource: "public_adjusted_prices",
      noSyntheticData: true,
    }),
    mergePilotHistoricalSignals: (supplied, records) => [...supplied, ...records],
  },
  "@/lib/equity-signal/runner": {
    runEquitySignalLab: async (input) => {
      receivedHistory = input.historicalSignals;
      return structuredClone(nextResult);
    },
  },
});

function approvedResult(action) {
  return {
    ok: true,
    status: `serious_${action}`,
    seriousSignalFound: true,
    actionableSignalFound: true,
    alertType: action,
    blockers: [],
    historicalLearning: {},
    liveSourcePolicy: {},
    _historicalSignalLibraryAdditions: [{ id: "forward-finding" }],
  };
}

nextResult = approvedResult("buy");
const buy = await wrapper.runPilotEquitySignalLab({ historicalSignals: [] });
assert.equal(buy.seriousSignalFound, true);
assert.equal(buy.alertType, "buy");
assert.equal(buy.historicalLearning.historicalComparisonRequiredForSeriousSignal, false);
assert.equal(buy.historicalLearning.actionableBuySellRequiresCalibratedHistory, false);
assert.equal(buy.historicalLearning.historicalEvidenceRole, "optional_context_and_r2_learning_only");
assert.equal(receivedHistory.length, 0);
assert.deepEqual(
  buy._historicalSignalLibraryAdditions.map((record) => record.id),
  ["forward-finding"],
);

nextResult = approvedResult("sell");
const sell = await wrapper.runPilotEquitySignalLab({ historicalSignals: [] });
assert.equal(sell.seriousSignalFound, true);
assert.equal(sell.alertType, "sell");

nextResult = approvedResult("watch");
const watch = await wrapper.runPilotEquitySignalLab({ historicalSignals: [] });
assert.equal(watch.seriousSignalFound, true);
assert.equal(watch.alertType, "watch");

bootstrapRecords = [{ id: "public-analogue" }];
nextResult = approvedResult("buy");
const contextualBuy = await wrapper.runPilotEquitySignalLab({ historicalSignals: [] });
assert.equal(contextualBuy.seriousSignalFound, true);
assert.equal(receivedHistory.length, 1);
assert.deepEqual(
  contextualBuy._historicalSignalLibraryAdditions.map((record) => record.id),
  ["forward-finding", "public-analogue"],
);

nextResult = {
  ...approvedResult("sell"),
  seriousSignalFound: false,
  actionableSignalFound: false,
  alertType: null,
  status: "no_serious_signal",
};
const rejected = await wrapper.runPilotEquitySignalLab({ historicalSignals: [] });
assert.equal(rejected.seriousSignalFound, false);
assert.equal(rejected.alertType, null);

console.log(JSON.stringify({
  ok: true,
  currentEvidenceDecisionPreserved: true,
  buyWithoutHistoricalComparisonAllowed: true,
  sellWithoutHistoricalComparisonAllowed: true,
  watchWithoutHistoricalComparisonAllowed: true,
  rejectedCurrentEvidenceStaysRejected: true,
  publicHistoryStillLoadedForContext: true,
  publicAndForwardHistoryPersistedForLearning: true,
}, null, 2));
