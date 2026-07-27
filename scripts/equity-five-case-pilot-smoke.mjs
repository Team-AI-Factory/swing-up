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
const pilotBootstrap = {
  bootstrapPilotHistoricalSignals: async () => ({ records: [], requestedSeeds: 10, builtSeeds: 0, errors: [], priceSource: "Yahoo Finance public adjusted daily chart history", noSyntheticData: true }),
  mergePilotHistoricalSignals: (...groups) => groups.flat(),
};
const historical = {
  analyzeHistoricalAnalogs: (query, records) => ({
    available: records.length > 0,
    strength: "weak",
    requestedHorizon: "7D",
    selectedHorizon: "7D",
    usedFallbackHorizon: false,
    sampleSize: records.length,
    effectiveSampleSize: records.length,
    averageSimilarity: 100,
    hitRatePercent: records.length ? 100 : 0,
    weightedHitRatePercent: records.length ? 100 : 0,
    posteriorHitProbabilityPercent: 60,
    conservativeHitProbabilityPercent: 50,
    maximumProbabilityAllowedBySamplePercent: 88,
    medianDirectionAdjustedReturnPercent: 1,
    p25DirectionAdjustedReturnPercent: records.length ? 0.5 : null,
    p75DirectionAdjustedReturnPercent: 2,
    marketRelative: null,
    historicalSupport: 10,
    leakageSafe: true,
    summary: `${records.length} exact-direction record(s)`,
    items: [],
    diagnostics: {},
    queryDirection: query.direction,
  }),
};
const wrapper = compile(new URL("../lib/equity-signal/pilot-runner.ts", import.meta.url), {
  "@/lib/equity-signal/historical-analogs": historical,
  "@/lib/equity-signal/pilot-historical-bootstrap": pilotBootstrap,
  "@/lib/equity-signal/pilot-serious-signal-policy": policy,
  "@/lib/equity-signal/runner": {
    runEquitySignalLab: async () => structuredClone(nextResult),
  },
});

function history(direction, count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${direction}-${index}`,
    eventKey: `${direction}-${index}`,
    ticker: `${direction.slice(0, 1).toUpperCase()}${index}`,
    eventFamily: "earnings_guidance",
    direction,
    relationship: "direct",
    causalChain: [],
    macroRegime: [],
    signalObservedAt: "2025-01-01T00:00:00.000Z",
    featuresAsOf: "2025-01-01T00:00:00.000Z",
    dataQuality: "real",
    checkpoints: {},
  }));
}

function resultWith({ action = "buy", direction = "upside" } = {}) {
  return {
    ok: true,
    status: `serious_${action}`,
    seriousSignalFound: true,
    actionableSignalFound: true,
    alertType: action,
    blockers: [],
    selectedCandidate: {
      ticker: "EXM",
      evidenceFingerprint: "current-event",
      eventFamily: "earnings_guidance",
      direction,
      relationship: "direct",
      causalChain: [],
      historicalAnalog: {},
    },
    macroContext: { regime: [] },
    historicalLearning: {},
    liveSourcePolicy: {},
    _historicalSignalLibraryAdditions: [],
  };
}

nextResult = resultWith();
const fourCases = await wrapper.runPilotEquitySignalLab({ historicalSignals: history("upside", 4) });
assert.equal(fourCases.seriousSignalFound, false);
assert.equal(fourCases.pilotHistoricalGate.checks.fiveIndependentRealEvents, false);

nextResult = resultWith();
const fiveBuy = await wrapper.runPilotEquitySignalLab({ historicalSignals: [...history("upside", 5), ...history("downside", 8)] });
assert.equal(fiveBuy.seriousSignalFound, true);
assert.equal(fiveBuy.alertType, "buy");
assert.equal(fiveBuy.pilotHistoricalAnalog.sampleSize, 5);
assert.equal(fiveBuy.pilotHistoricalAnalog.queryDirection, "upside");
assert.equal(fiveBuy.historicalLearning.oppositeDirectionEventsExcludedFromPilotSample, true);
assert.equal(fiveBuy.liveSourcePolicy.nonUsMarketsEnabled, false);
assert.equal(fiveBuy.liveSourcePolicy.analystExpectationsCanVetoBuy, false);

nextResult = resultWith({ action: "sell", direction: "downside" });
const fiveSell = await wrapper.runPilotEquitySignalLab({ historicalSignals: [...history("upside", 7), ...history("downside", 5)] });
assert.equal(fiveSell.seriousSignalFound, true);
assert.equal(fiveSell.alertType, "sell");
assert.equal(fiveSell.pilotHistoricalAnalog.sampleSize, 5);
assert.equal(fiveSell.pilotHistoricalAnalog.queryDirection, "downside");

nextResult = resultWith({ action: "watch", direction: "upside" });
const watchBlocked = await wrapper.runPilotEquitySignalLab({ historicalSignals: history("upside", 5) });
assert.equal(watchBlocked.seriousSignalFound, false);
assert.equal(watchBlocked.alertType, null);

console.log(JSON.stringify({
  ok: true,
  marketScope: policy.US_SERIOUS_SIGNAL_PILOT_POLICY.marketScope,
  minimumIndependentEvents: policy.US_SERIOUS_SIGNAL_PILOT_POLICY.minimumIndependentHistoricalEvents,
  minimumObservedHitRatePercent: policy.US_SERIOUS_SIGNAL_PILOT_POLICY.minimumObservedDirectionalHitRatePercent,
  analystExpectationsCanVetoBuy: policy.US_SERIOUS_SIGNAL_PILOT_POLICY.analystExpectationsCanVetoBuy,
  oppositeDirectionEventsExcluded: true,
  fourCasesBlocked: true,
  fiveCaseBuyAllowed: true,
  fiveCaseSellAllowed: true,
  watchUsesSeparateCatalog: true,
}, null, 2));
