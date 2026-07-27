import { mkdir, writeFile } from "node:fs/promises";
import { analyzeHistoricalAnalogs } from "../lib/equity-signal/historical-analogs";
import { bootstrapPilotHistoricalSignals } from "../lib/equity-signal/pilot-historical-bootstrap";
import { evaluateFiveCasePilotGate } from "../lib/equity-signal/pilot-serious-signal-policy";

const outputPath = process.env.US_FIVE_CASE_PILOT_REPORT_PATH ?? "artifacts/us-five-case-pilot-history.json";
const now = new Date();

const bootstrap = await bootstrapPilotHistoricalSignals([], fetch, now);
if (bootstrap.records.length < 10) {
  throw new Error(`The official-event pilot bootstrap built ${bootstrap.records.length}/10 records: ${bootstrap.errors.join(" | ")}`);
}

function analysis(direction: "upside" | "downside") {
  return analyzeHistoricalAnalogs({
    eventKey: `current-pilot-${direction}-${now.toISOString()}`,
    eventFamily: "earnings_guidance",
    direction,
    relationship: "direct",
    causalChain: direction === "upside"
      ? ["official results or guidance improve expected earnings and cash flow"]
      : ["official results or guidance reduce expected earnings and cash flow"],
    macroRegime: [],
    asOf: now.toISOString(),
    featuresAsOf: now.toISOString(),
  }, bootstrap.records, {
    minimumSimilarity: 0.45,
    maximumAnalogs: 50,
    maximumAnalogsPerTicker: 3,
    minimumSamplesForPreferredHorizon: 5,
    hitThresholdPercent: 0,
  });
}

const buyAnalysis = analysis("upside");
const sellAnalysis = analysis("downside");
const buyGate = evaluateFiveCasePilotGate({ historicalAnalog: buyAnalysis });
const sellGate = evaluateFiveCasePilotGate({ historicalAnalog: sellAnalysis });

const report = {
  ok: true,
  checkedAt: now.toISOString(),
  marketScope: "US listed common equities and ADRs only",
  sourcePolicy: {
    officialEventAnnouncements: true,
    adjustedStockHistory: bootstrap.priceSource,
    benchmark: "SPY adjusted history from the same public source",
    noSyntheticData: bootstrap.noSyntheticData,
    hardCodedReturns: false,
    futureDataLeakageAllowed: false,
  },
  bootstrap: {
    requestedSeeds: bootstrap.requestedSeeds,
    builtSeeds: bootstrap.builtSeeds,
    errors: bootstrap.errors,
  },
  buy: {
    analysis: buyAnalysis,
    pilotGate: buyGate,
  },
  sell: {
    analysis: sellAnalysis,
    pilotGate: sellGate,
  },
  conclusion: {
    pilotSeriousBuyFamilyEligible: buyGate.passed,
    pilotSeriousSellFamilyEligible: sellGate.passed,
    fiveExamplesAreNotThirtySampleCertificate: true,
    noRuleWasRetunedToTheseOutcomes: true,
  },
};

await mkdir(outputPath.split("/").slice(0, -1).join("/") || ".", { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  ok: true,
  builtSeeds: bootstrap.builtSeeds,
  buy: {
    sampleSize: buyAnalysis.sampleSize,
    selectedHorizon: buyAnalysis.selectedHorizon,
    observedHitRatePercent: buyAnalysis.weightedHitRatePercent,
    p25DirectionAdjustedReturnPercent: buyAnalysis.p25DirectionAdjustedReturnPercent,
    pilotGatePassed: buyGate.passed,
  },
  sell: {
    sampleSize: sellAnalysis.sampleSize,
    selectedHorizon: sellAnalysis.selectedHorizon,
    observedHitRatePercent: sellAnalysis.weightedHitRatePercent,
    p25DirectionAdjustedReturnPercent: sellAnalysis.p25DirectionAdjustedReturnPercent,
    pilotGatePassed: sellGate.passed,
  },
  reportPath: outputPath,
}, null, 2));
