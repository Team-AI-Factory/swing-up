import { wilsonLower90, type ScoredHistoricalCase } from "./calibration-search";
import type { SeriousSignalAction } from "./types";

export type SelectiveModel = {
  action: Exclude<SeriousSignalAction, "watch" | "no_action">;
  horizonDays: 30 | 90;
  neighbours: number;
  probabilityThreshold: number;
  maximumDistanceQuantile: number;
  sameTickerDistanceDiscount: number;
};

export type SelectiveEvaluation = {
  model: SelectiveModel;
  sampleSize: number;
  wins: number;
  losses: number;
  precision: number | null;
  lowerConfidenceBound: number | null;
  coverage: number;
  averageReturn: number | null;
  averageExcessReturn: number | null;
  averageDrawdown: number | null;
  predictions: Array<{ ticker: string; filingDate: string; probability: number; distance: number; won: boolean; returnPercent: number; excessReturn: number; drawdown: number }>;
};

type Normalizer = { means: number[]; deviations: number[] };
type RowVector = { row: ScoredHistoricalCase; values: number[]; label: boolean; result: { returnPercent: number; excessReturn: number; drawdown: number } };

const value = (input: number | null | undefined, fallback = 0) => typeof input === "number" && Number.isFinite(input) ? input : fallback;

function featureValues(row: ScoredHistoricalCase) {
  return [
    row.scores.opportunityScore,
    row.scores.businessQuality,
    row.scores.financialMomentum,
    row.scores.valuationSupport,
    row.scores.expectationsGap,
    row.scores.timingQuality,
    row.scores.evidenceConfidence,
    row.scores.riskScore,
    value(row.revenueGrowth) * 100,
    value(row.marginChange) * 100,
    value(row.priceChange90d),
    new Date(`${row.filingDate}T00:00:00Z`).getUTCMonth() / 11,
  ];
}

function outcome(row: ScoredHistoricalCase, action: SelectiveModel["action"], horizonDays: 30 | 90) {
  const returnPercent = horizonDays === 30 ? row.return30d : row.return90d;
  const excessReturn = horizonDays === 30 ? row.excess30d : row.excess90d;
  const drawdown = horizonDays === 30 ? row.drawdown30d : row.drawdown90d;
  const label = action === "buy"
    ? returnPercent > 0 && excessReturn > 0
    : action === "sell"
      ? returnPercent < 0 && excessReturn < 0
      : drawdown <= -8;
  return { label, returnPercent, excessReturn, drawdown };
}

function normalizer(rows: ScoredHistoricalCase[]): Normalizer {
  const all = rows.map(featureValues);
  const means = all[0].map((_, index) => all.reduce((sum, row) => sum + row[index], 0) / all.length);
  const deviations = means.map((mean, index) => {
    const variance = all.reduce((sum, row) => sum + (row[index] - mean) ** 2, 0) / Math.max(1, all.length - 1);
    const deviation = Math.sqrt(variance);
    return deviation > 1e-9 ? deviation : 1;
  });
  return { means, deviations };
}

function vector(row: ScoredHistoricalCase, scale: Normalizer, action: SelectiveModel["action"], horizonDays: 30 | 90): RowVector {
  const result = outcome(row, action, horizonDays);
  return {
    row,
    values: featureValues(row).map((item, index) => (item - scale.means[index]) / scale.deviations[index]),
    label: result.label,
    result: { returnPercent: result.returnPercent, excessReturn: result.excessReturn, drawdown: result.drawdown },
  };
}

function distance(left: RowVector, right: RowVector, sameTickerDiscount: number) {
  const raw = Math.sqrt(left.values.reduce((sum, item, index) => sum + (item - right.values[index]) ** 2, 0) / left.values.length);
  return left.row.ticker === right.row.ticker ? raw * sameTickerDiscount : raw;
}

function quantile(values: number[], probability: number) {
  if (!values.length) return Number.POSITIVE_INFINITY;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * probability)))];
}

function nearestPrediction(training: RowVector[], target: RowVector, model: SelectiveModel) {
  const nearest = training.map((row) => ({ row, distance: distance(row, target, model.sameTickerDistanceDiscount) }))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, Math.min(model.neighbours, training.length));
  const probability = nearest.length ? nearest.filter((item) => item.row.label).length / nearest.length : 0;
  const averageDistance = nearest.length ? nearest.reduce((sum, item) => sum + item.distance, 0) / nearest.length : Number.POSITIVE_INFINITY;
  return { probability, averageDistance };
}

function prepared(training: ScoredHistoricalCase[], scoring: ScoredHistoricalCase[], model: SelectiveModel) {
  const scale = normalizer(training);
  const trainVectors = training.map((row) => vector(row, scale, model.action, model.horizonDays));
  const scoringVectors = scoring.map((row) => vector(row, scale, model.action, model.horizonDays));
  const raw = scoringVectors.map((target) => ({ target, ...nearestPrediction(trainVectors, target, model) }));
  const maximumDistance = quantile(raw.map((row) => row.averageDistance), model.maximumDistanceQuantile);
  return raw.filter((row) => row.probability >= model.probabilityThreshold && row.averageDistance <= maximumDistance);
}

export function evaluateSelectiveModel(training: ScoredHistoricalCase[], scoring: ScoredHistoricalCase[], model: SelectiveModel): SelectiveEvaluation {
  const selected = prepared(training, scoring, model);
  const wins = selected.filter((item) => item.target.label).length;
  const average = (values: number[]) => values.length ? values.reduce((sum, item) => sum + item, 0) / values.length : null;
  return {
    model,
    sampleSize: selected.length,
    wins,
    losses: selected.length - wins,
    precision: selected.length ? wins / selected.length : null,
    lowerConfidenceBound: wilsonLower90(wins, selected.length),
    coverage: scoring.length ? selected.length / scoring.length : 0,
    averageReturn: average(selected.map((item) => item.target.result.returnPercent)),
    averageExcessReturn: average(selected.map((item) => item.target.result.excessReturn)),
    averageDrawdown: average(selected.map((item) => item.target.result.drawdown)),
    predictions: selected.map((item) => ({ ticker: item.target.row.ticker, filingDate: item.target.row.filingDate, probability: item.probability, distance: item.averageDistance, won: item.target.label, ...item.target.result })),
  };
}

export function selectSelectiveModel(training: ScoredHistoricalCase[], validation: ScoredHistoricalCase[], action: SelectiveModel["action"], horizonDays: 30 | 90) {
  const models: SelectiveModel[] = [];
  for (const neighbours of [3, 5, 7, 10, 15, 20, 30, 40])
    for (const probabilityThreshold of [0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1])
      for (const maximumDistanceQuantile of [0.2, 0.35, 0.5, 0.7, 1])
        for (const sameTickerDistanceDiscount of [0.5, 0.7, 0.85, 1])
          models.push({ action, horizonDays, neighbours, probabilityThreshold, maximumDistanceQuantile, sameTickerDistanceDiscount });
  const minimumValidationSamples = Math.max(15, Math.floor(validation.length * 0.035));
  const candidates = models.map((model) => evaluateSelectiveModel(training, validation, model))
    .filter((evaluation) => evaluation.sampleSize >= minimumValidationSamples)
    .sort((left, right) => {
      const lower = (right.lowerConfidenceBound ?? 0) - (left.lowerConfidenceBound ?? 0);
      if (Math.abs(lower) > 1e-9) return lower;
      const precision = (right.precision ?? 0) - (left.precision ?? 0);
      if (Math.abs(precision) > 1e-9) return precision;
      return right.sampleSize - left.sampleSize;
    });
  return { selected: candidates[0] ?? null, topCandidates: candidates.slice(0, 10), searchedModels: models.length, minimumValidationSamples };
}
