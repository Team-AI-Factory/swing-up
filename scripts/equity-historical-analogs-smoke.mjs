import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/equity-signal/historical-analogs.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const cjsModule = { exports: {} };
new Function("module", "exports", output)(cjsModule, cjsModule.exports);
const { analyzeHistoricalAnalogs, comparePreEventFeatures, horizonPlanForRelationship } = cjsModule.exports;

const AS_OF = "2026-07-22T12:00:00.000Z";
const query = {
  eventKey: "current-event",
  eventFamily: "regulatory_approval",
  direction: "upside",
  relationship: "direct",
  causalChain: ["regulatory approval", "commercial access", "revenue opportunity"],
  macroRegime: ["stable_rates", "risk_on"],
  asOf: AS_OF,
  featuresAsOf: "2026-07-22T11:59:00.000Z",
};

function record(overrides = {}) {
  const id = overrides.id ?? "record-1";
  return {
    id,
    eventKey: overrides.eventKey ?? `event-${id}`,
    ticker: overrides.ticker ?? "EXM",
    eventFamily: overrides.eventFamily ?? "regulatory_approval",
    direction: overrides.direction ?? "upside",
    relationship: overrides.relationship ?? "direct",
    causalChain: overrides.causalChain ?? ["regulatory approval", "commercial access", "revenue opportunity"],
    macroRegime: overrides.macroRegime ?? ["stable_rates", "risk_on"],
    signalObservedAt: overrides.signalObservedAt ?? "2025-01-02T14:30:00.000Z",
    featuresAsOf: overrides.featuresAsOf ?? "2025-01-02T14:29:00.000Z",
    dataQuality: overrides.dataQuality ?? "real",
    checkpoints: overrides.checkpoints ?? {
      "1D": {
        returnPercent: overrides.returnPercent ?? 4,
        benchmarkReturnPercent: overrides.benchmarkReturnPercent ?? 1,
        observedAt: overrides.outcomeObservedAt ?? "2025-01-03T20:00:00.000Z",
        source: "real adjusted market fixture",
      },
    },
  };
}

// Similarity is invariant to all outcome values because the comparison accepts only pre-event fields.
const baseRecord = record({ id: "leakage-base" });
const mutatedFutureOutcome = { ...baseRecord, checkpoints: { "1D": { ...baseRecord.checkpoints["1D"], returnPercent: -99, benchmarkReturnPercent: 70 } } };
assert.deepEqual(comparePreEventFeatures(query, baseRecord), comparePreEventFeatures(query, mutatedFutureOutcome));
assert.deepEqual(horizonPlanForRelationship("direct"), ["7D", "3D", "1D"]);

const guarded = analyzeHistoricalAnalogs(query, [
  record({ id: "eligible-past" }),
  record({ id: "same-event", eventKey: "current-event" }),
  record({ id: "future-signal", signalObservedAt: "2026-08-01T12:00:00.000Z", featuresAsOf: "2026-08-01T11:59:00.000Z", outcomeObservedAt: "2026-08-02T12:00:00.000Z" }),
  record({ id: "future-features", featuresAsOf: "2025-01-03T14:30:00.000Z" }),
  record({ id: "future-outcome", outcomeObservedAt: "2026-08-02T12:00:00.000Z" }),
  record({ id: "mock", dataQuality: "mock" }),
], { minimumSamplesForPreferredHorizon: 2 });
assert.equal(guarded.leakageSafe, true);
assert.equal(guarded.sampleSize, 1);
assert.equal(guarded.selectedHorizon, "1D");
assert.equal(guarded.usedFallbackHorizon, true);
assert.equal(guarded.diagnostics.excludedSameEvent, 1);
assert.equal(guarded.diagnostics.excludedFutureSignal, 1);
assert.equal(guarded.diagnostics.excludedPostSignalFeatures, 1);
assert.equal(guarded.diagnostics.excludedUnavailableOutcome, 1);
assert.equal(guarded.diagnostics.excludedNonReal, 1);

// One perfect historical hit must not masquerade as high confidence.
assert.equal(guarded.strength, "weak");
assert.ok(guarded.historicalSupport <= 15);
assert.ok(guarded.posteriorHitProbabilityPercent <= 60);
assert.ok(guarded.conservativeHitProbabilityPercent < 51);

const independentRecords = [
  record({ id: "a", eventKey: "independent-a", ticker: "AAA", returnPercent: 6, benchmarkReturnPercent: 1 }),
  record({ id: "a-copy", eventKey: "independent-a", ticker: "AAA", returnPercent: 6, benchmarkReturnPercent: 1 }),
  record({ id: "b", eventKey: "independent-b", ticker: "BBB", returnPercent: 4, benchmarkReturnPercent: 0.5 }),
  record({ id: "c", eventKey: "independent-c", ticker: "CCC", returnPercent: 2, benchmarkReturnPercent: 0 }),
  record({ id: "d", eventKey: "independent-d", ticker: "DDD", returnPercent: -1, benchmarkReturnPercent: 0 }),
  record({ id: "e", eventKey: "independent-e", ticker: "EEE", returnPercent: -3, benchmarkReturnPercent: -0.5 }),
  record({ id: "f", eventKey: "independent-f", ticker: "FFF", returnPercent: -5, benchmarkReturnPercent: -1 }),
];
const mixed = analyzeHistoricalAnalogs(query, independentRecords, { minimumSamplesForPreferredHorizon: 3 });
assert.equal(mixed.sampleSize, 6);
assert.equal(mixed.diagnostics.duplicateRecordsCollapsed, 1);
assert.equal(new Set(mixed.items.map((item) => item.eventKey)).size, 6);
assert.equal(mixed.hitRatePercent, 50);
assert.ok(mixed.items.some((item) => item.hit === false));
assert.ok(mixed.p25DirectionAdjustedReturnPercent < 0);
assert.ok(mixed.marketRelative && mixed.marketRelative.sampleSize === 6);

// A downside prediction treats a negative raw stock return as a successful direction-adjusted outcome.
const downsideQuery = { ...query, eventKey: "current-downside", direction: "downside" };
const downside = analyzeHistoricalAnalogs(downsideQuery, [
  record({ id: "down-a", eventKey: "down-a", direction: "downside", returnPercent: -7 }),
  record({ id: "down-b", eventKey: "down-b", direction: "downside", returnPercent: -2 }),
  record({ id: "down-c", eventKey: "down-c", direction: "downside", returnPercent: 3 }),
], { minimumSamplesForPreferredHorizon: 3 });
assert.equal(downside.sampleSize, 3);
assert.equal(downside.hitRatePercent, 66.67);
assert.ok(downside.items.find((item) => item.eventKey === "down-a").directionAdjustedReturnPercent > 0);
assert.ok(downside.items.find((item) => item.eventKey === "down-c").directionAdjustedReturnPercent < 0);

// Partial earlier checkpoints are sufficient; 3D/7D/30D/90D are not required.
assert.equal(mixed.requestedHorizon, "7D");
assert.equal(mixed.selectedHorizon, "1D");
assert.equal(mixed.usedFallbackHorizon, true);
assert.equal(mixed.available, true);

console.log(JSON.stringify({
  ok: true,
  futureSignalsExcluded: true,
  futureOutcomesExcluded: true,
  sameEventExcluded: true,
  duplicateEventsCountOnce: true,
  smallSampleProbabilityCapped: true,
  positiveAndNegativeAnalogsMeasured: true,
  downsideDirectionAdjusted: true,
  partialEarlierCheckpointAccepted: true,
  sampleSize: mixed.sampleSize,
  selectedHorizon: mixed.selectedHorizon,
  posteriorHitProbabilityPercent: mixed.posteriorHitProbabilityPercent,
}, null, 2));
