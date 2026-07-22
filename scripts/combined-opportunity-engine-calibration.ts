import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { evaluateFoundation } from "../lib/opportunity-engine/engine";
import { buildHistoricalOpportunityCases } from "../lib/opportunity-engine/historical-cases";
import { evaluateCalibrationRule, selectTrainingRule, type ScoredHistoricalCase } from "../lib/opportunity-engine/calibration-search";

const outputPath = process.env.CALIBRATION_REPORT_PATH ?? "artifacts/combined-opportunity-engine-calibration.json";
const earliestDate = process.env.CALIBRATION_EARLIEST_DATE ?? "2016-01-01";
const minimumHoldoutSamples = Number.parseInt(process.env.CALIBRATION_MIN_HOLDOUT_SAMPLES ?? "30", 10) || 30;
const tickers = (process.env.CALIBRATION_TICKERS ?? "AAPL,MSFT,NVDA,GOOGL,AMZN,META,AVGO,AMD,TSLA,WMT,JPM,BAC,XOM,CVX,KO,PEP,UNH,HD,COST,CRM,ORCL,NFLX,UBER,ADBE,INTC,QCOM,CSCO,MCD,NKE,DIS")
  .split(",").map((ticker) => ticker.trim().toUpperCase()).filter(Boolean).slice(0, 35);

const safe = (error: unknown) => error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 280) : "calibration_failed";
const round = (value: number | null) => value === null ? null : Number(value.toFixed(6));

async function main() {
  const source = await buildHistoricalOpportunityCases(tickers, earliestDate);
  assert.ok(source.cases.length >= 120, `Only ${source.cases.length} historical cases were available; at least 120 are required.`);
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
  const splitIndex = Math.floor(scored.length * 0.5);
  const training = scored.slice(0, splitIndex);
  const holdout = scored.slice(splitIndex);
  const evaluations = [];
  for (const action of ["buy", "sell", "watch_out"] as const) {
    for (const horizonDays of [30, 90] as const) {
      const trainingSelection = selectTrainingRule(training, action, horizonDays);
      const holdoutEvaluation = trainingSelection.selected ? evaluateCalibrationRule(holdout, trainingSelection.selected.rule) : null;
      const passed = Boolean(
        holdoutEvaluation
        && holdoutEvaluation.sampleSize >= minimumHoldoutSamples
        && (holdoutEvaluation.precision ?? 0) >= 0.9
        && (holdoutEvaluation.lowerConfidenceBound ?? 0) >= 0.9,
      );
      evaluations.push({ action, horizonDays, passed, minimumHoldoutSamples, trainingSelection, holdoutEvaluation });
    }
  }
  const passedRules = evaluations.filter((evaluation) => evaluation.passed);
  const report = {
    version: 1,
    passed: passedRules.length > 0,
    checkedAt: new Date().toISOString(),
    methodology: {
      sourceMode: "real_historical_sec_filings_and_yahoo_prices",
      earliestDate,
      requestedTickers: tickers,
      chronologicalSplit: "Oldest 50% selected the rule. Newest 50% remained untouched until final scoring.",
      confidenceLevel: 0.9,
      confidenceMethod: "one-sided 90% Wilson lower confidence bound",
      minimumHoldoutSamples,
      buySuccess: "+5% absolute and +2% versus SPY at the declared horizon",
      sellSuccess: "-5% absolute and -2% versus SPY at the declared horizon",
      watchOutSuccess: "-10% maximum drawdown, or a negative return with at least 5% SPY underperformance",
      noSyntheticData: true,
      survivorshipCaveat: "The first calibration universe uses current liquid large-cap stocks; delisted securities must be added before production reliance.",
    },
    summary: {
      totalCases: scored.length,
      trainingCases: training.length,
      holdoutCases: holdout.length,
      tickersWithCases: [...new Set(scored.map((row) => row.ticker))],
      sourceErrors: source.errors,
      passedRuleCount: passedRules.length,
      passedActions: passedRules.map((evaluation) => `${evaluation.action}_${evaluation.horizonDays}d`),
      seriousSignalReady: passedRules.length > 0,
    },
    evaluations,
    passedRules,
    safety: { databaseWrites: false, r2Writes: false, publishing: false, notifications: false, payments: false, openAiCalls: false },
  };
  await mkdir(outputPath.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    passed: report.passed,
    totalCases: report.summary.totalCases,
    trainingCases: report.summary.trainingCases,
    holdoutCases: report.summary.holdoutCases,
    tickersWithCases: report.summary.tickersWithCases.length,
    sourceErrors: report.summary.sourceErrors.length,
    passedActions: report.summary.passedActions,
    results: evaluations.map((evaluation) => ({
      action: evaluation.action,
      horizonDays: evaluation.horizonDays,
      sampleSize: evaluation.holdoutEvaluation?.sampleSize ?? 0,
      precision: round(evaluation.holdoutEvaluation?.precision ?? null),
      lowerConfidenceBound: round(evaluation.holdoutEvaluation?.lowerConfidenceBound ?? null),
    })),
    reportPath: outputPath,
  }, null, 2));
  if (!report.passed) process.exitCode = 2;
}

main().catch(async (error) => {
  const report = { version: 1, passed: false, checkedAt: new Date().toISOString(), fatalError: safe(error), safety: { databaseWrites: false, publishing: false, notifications: false, payments: false, openAiCalls: false } };
  await mkdir(outputPath.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
});
