import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import ts from "typescript";

const outputPath = process.env.US_FIVE_CASE_PILOT_REPORT_PATH ?? "artifacts/us-five-case-pilot-history.json";

async function compile(path, dependencies = {}) {
  const source = await readFile(path, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (name in dependencies) return dependencies[name];
    throw new Error(`Unexpected import in US five-case pilot validation: ${name}`);
  }, cjsModule, cjsModule.exports);
  return cjsModule.exports;
}

async function save(report) {
  await mkdir(outputPath.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function main() {
  const historical = await compile("lib/equity-signal/historical-analogs.ts");
  const policy = await compile("lib/equity-signal/pilot-serious-signal-policy.ts");
  const bootstrapModule = await compile("lib/equity-signal/pilot-historical-bootstrap.ts", {
    "node:crypto": crypto,
  });
  const now = new Date();
  const bootstrap = await bootstrapModule.bootstrapPilotHistoricalSignals([], fetch, now);
  if (bootstrap.records.length < 10) {
    throw new Error(`The official-event pilot bootstrap built ${bootstrap.records.length}/10 records: ${bootstrap.errors.join(" | ")}`);
  }

  function analyze(direction) {
    return historical.analyzeHistoricalAnalogs({
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

  const buyAnalysis = analyze("upside");
  const sellAnalysis = analyze("downside");
  const buyGate = policy.evaluateFiveCasePilotGate({ historicalAnalog: buyAnalysis });
  const sellGate = policy.evaluateFiveCasePilotGate({ historicalAnalog: sellAnalysis });
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
    buy: { analysis: buyAnalysis, pilotGate: buyGate },
    sell: { analysis: sellAnalysis, pilotGate: sellGate },
    conclusion: {
      pilotSeriousBuyFamilyEligible: buyGate.passed,
      pilotSeriousSellFamilyEligible: sellGate.passed,
      fiveExamplesAreNotThirtySampleCertificate: true,
      noRuleWasRetunedToTheseOutcomes: true,
    },
  };
  await save(report);
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
}

try {
  await main();
} catch (error) {
  const failure = {
    ok: false,
    checkedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message.slice(0, 1200) : "unknown_pilot_history_failure",
    safety: { seriousSignalPromoted: false, publishing: false, notifications: false },
  };
  await save(failure);
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
}
