import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { evaluateFoundation } from "../lib/opportunity-engine/engine";
import { buildHistoricalOpportunityCases } from "../lib/opportunity-engine/historical-cases";
import { evaluateCalibrationRule, selectTrainingRule, type ScoredHistoricalCase } from "../lib/opportunity-engine/calibration-search";
import { evaluateSelectiveModel, selectSelectiveModel } from "../lib/opportunity-engine/selective-calibration";

const outputPath = process.env.CALIBRATION_REPORT_PATH ?? "artifacts/combined-opportunity-engine-calibration.json";
const earliestDate = process.env.CALIBRATION_EARLIEST_DATE ?? "2016-01-01";
const minimumFinalSamples = Number.parseInt(process.env.CALIBRATION_MIN_HOLDOUT_SAMPLES ?? "30", 10) || 30;
const tickers = (process.env.CALIBRATION_TICKERS ?? "AAPL,MSFT,NVDA,GOOGL,AMZN,META,AVGO,AMD,TSLA,WMT,JPM,BAC,XOM,CVX,KO,PEP,UNH,HD,COST,CRM,ORCL,NFLX,UBER,ADBE,INTC,QCOM,CSCO,MCD,NKE,DIS")
  .split(",").map((ticker) => ticker.trim().toUpperCase()).filter(Boolean).slice(0, 35);

const safe = (error: unknown) => error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 280) : "calibration_failed";
const round = (value: number | null) => value === null ? null : Number(value.toFixed(6));

function compactEvaluation(evaluation: ReturnType<typeof evaluateSelectiveModel> | null) {
  if (!evaluation) return null;
  return {
    model: evaluation.model,
    sampleSize: evaluation.sampleSize,
    wins: evaluation.wins,
    losses: evaluation.losses,
    precision: evaluation.precision,
    lowerConfidenceBound: evaluation.lowerConfidenceBound,
    coverage: evaluation.coverage,
    averageReturn: evaluation.averageReturn,
    averageExcessReturn: evaluation.averageExcessReturn,
    averageDrawdown: evaluation.averageDrawdown,
  };
}

async function main() {
  const source = await buildHistoricalOpportunityCases(tickers, earliestDate);
  assert.ok(source.cases.length >= 180, `Only ${source.cases.length} historical cases were available; at least 180 are required.`);
  const scored: ScoredHistoricalCase[] = source.cases.map((row) => {
    const decision = evaluateFoundation(row.input);
    const operatingMargin = row.input.metrics.operatingMargin;
    const priorMargin = row.input.metrics.priorOperatingMargin;
    return {
      ticker: row.ticker,
      filingDate: row.filingDate,
      scores: decision.scores,
      revenueGrowth: row.input.metrics.revenueGrowthYoY,
      marginChange: operatingMargin !== null && priorMargin !== null ? operatingMargin - priorMargin : null,
      priceChange90d: row.input.market.priceChange90d,
      return30d: row.return30d,
      excess30d: row.excess30d,
      drawdown30d: row.drawdown30d,
      return90d: row.return90d,
      excess90d: row.excess90d,
      drawdown90d: row.drawdown90d,
    };
  }).sort((left, right) => `${left.filingDate}:${left.ticker}`.localeCompare(`${right.filingDate}:${right.ticker}`));

  const trainingEnd = Math.floor(scored.length * 0.4);
  const validationEnd = Math.floor(scored.length * 0.7);
  const training = scored.slice(0, trainingEnd);
  const validation = scored.slice(trainingEnd, validationEnd);
  const development = scored.slice(0, validationEnd);
  const finalTest = scored.slice(validationEnd);
  const evaluations = [];

  for (const action of ["buy", "sell", "watch_out"] as const) {
    for (const horizonDays of [30, 90] as const) {
      const baselineSelection = selectTrainingRule(development, action, horizonDays);
      const baselineFinal = baselineSelection.selected ? evaluateCalibrationRule(finalTest, baselineSelection.selected.rule) : null;
      const modelSelection = selectSelectiveModel(training, validation, action, horizonDays);
      const finalEvaluation = modelSelection.selected ? evaluateSelectiveModel(development, finalTest, modelSelection.selected.model) : null;
      const passed = Boolean(
        finalEvaluation
        && finalEvaluation.sampleSize >= minimumFinalSamples
        && (finalEvaluation.precision ?? 0) >= 0.9
        && (finalEvaluation.lowerConfidenceBound ?? 0) >= 0.9,
      );
      evaluations.push({
        action,
        horizonDays,
        passed,
        minimumFinalSamples,
        baseline: {
          selected: baselineSelection.selected ? { ...baselineSelection.selected, cases: undefined } : null,
          final: baselineFinal ? { ...baselineFinal, cases: undefined } : null,
        },
        selective: {
          selectedValidationModel: modelSelection.selected ? compactEvaluation(modelSelection.selected) : null,
          topValidationModels: modelSelection.topCandidates.map(compactEvaluation),
          searchedModels: modelSelection.searchedModels,
          minimumValidationSamples: modelSelection.minimumValidationSamples,
          final: compactEvaluation(finalEvaluation),
        },
      });
    }
  }

  const passedRules = evaluations.filter((evaluation) => evaluation.passed);
  const report = {
    version: 2,
    passed: passedRules.length > 0,
    checkedAt: new Date().toISOString(),
    methodology: {
      sourceMode: "real_historical_sec_filings_and_yahoo_prices",
      earliestDate,
      requestedTickers: tickers,
      chronologicalSplit: "Oldest 40% trained the neighbour model; next 30% selected confidence thresholds; newest 30% was untouched until one final evaluation.",
      confidenceLevel: 0.9,
      confidenceMethod: "one-sided 90% Wilson lower confidence bound",
      minimumFinalSamples,
      buySuccess: "Positive absolute return and SPY outperformance at the declared horizon",
      sellSuccess: "Negative absolute return and SPY underperformance at the declared horizon",
      watchOutSuccess: "At least 8% maximum drawdown at the declared horizon",
      noSyntheticData: true,
      survivorshipCaveat: "The first calibration universe uses current liquid large-cap stocks; delisted securities must be added before production reliance.",
    },
    summary: {
      totalCases: scored.length,
      trainingCases: training.length,
      validationCases: validation.length,
      developmentCases: development.length,
      finalTestCases: finalTest.length,
      tickersWithCases: [...new Set(scored.map((row) => row.ticker))],
      sourceErrors: source.errors,
      passedRuleCount: passedRules.length,
      passedActions: passedRules.map((evaluation) => `${evaluation.action}_${evaluation.horizonDays}d`),
      seriousSignalReady: passedRules.length > 0,
    },
    evaluations,
    passedRules,
    developmentDataset: development.map((row) => ({
      ticker: row.ticker,
      filingDate: row.filingDate,
      scores: row.scores,
      revenueGrowth: round(row.revenueGrowth),
      marginChange: round(row.marginChange),
      priceChange90d: round(row.priceChange90d),
      return30d: round(row.return30d),
      excess30d: round(row.excess30d),
      drawdown30d: round(row.drawdown30d),
      return90d: round(row.return90d),
      excess90d: round(row.excess90d),
      drawdown90d: round(row.drawdown90d),
    })),
    finalTestDisclosure: {
      caseCount: finalTest.length,
      individualFeaturesAndOutcomesWithheld: true,
      reason: "Preserves a clean final test set for model iteration and prevents manual tuning to the answers.",
    },
    safety: { databaseWrites: false, r2Writes: false, publishing: false, notifications: false, payments: false, openAiCalls: false },
  };

  await mkdir(outputPath.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    passed: report.passed,
    totalCases: report.summary.totalCases,
    trainingCases: report.summary.trainingCases,
    validationCases: report.summary.validationCases,
    finalTestCases: report.summary.finalTestCases,
    tickersWithCases: report.summary.tickersWithCases.length,
    sourceErrors: report.summary.sourceErrors.length,
    passedActions: report.summary.passedActions,
    results: evaluations.map((evaluation) => ({
      action: evaluation.action,
      horizonDays: evaluation.horizonDays,
      sampleSize: evaluation.selective.final?.sampleSize ?? 0,
      precision: round(evaluation.selective.final?.precision ?? null),
      lowerConfidenceBound: round(evaluation.selective.final?.lowerConfidenceBound ?? null),
      coverage: round(evaluation.selective.final?.coverage ?? null),
    })),
    reportPath: outputPath,
  }, null, 2));
  if (!report.passed) process.exitCode = 2;
}

main().catch(async (error) => {
  const report = { version: 2, passed: false, checkedAt: new Date().toISOString(), fatalError: safe(error), safety: { databaseWrites: false, publishing: false, notifications: false, payments: false, openAiCalls: false } };
  await mkdir(outputPath.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
});
