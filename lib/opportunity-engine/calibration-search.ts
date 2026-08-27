import type { FoundationScoreBreakdown, SeriousSignalAction } from "./types";

export type ScoredHistoricalCase = {
  ticker: string;
  filingDate: string;
  scores: FoundationScoreBreakdown;
  revenueGrowth: number | null;
  marginChange: number | null;
  priceChange90d: number | null;
  return30d: number;
  excess30d: number;
  drawdown30d: number;
  return90d: number;
  excess90d: number;
  drawdown90d: number;
};

export type CalibrationRule = {
  action: Exclude<SeriousSignalAction, "watch" | "no_action">;
  horizonDays: 30 | 90;
  minOpportunity?: number;
  maxOpportunity?: number;
  minMomentum?: number;
  maxMomentum?: number;
  minQuality?: number;
  maxQuality?: number;
  minValuation?: number;
  maxRisk?: number;
  minRisk?: number;
  minGrowth?: number;
  maxGrowth?: number;
  minMarginChange?: number;
  maxMarginChange?: number;
  maxPriceChange90d?: number;
  minPriceChange90d?: number;
};

export type CalibrationEvaluation = {
  rule: CalibrationRule;
  sampleSize: number;
  wins: number;
  losses: number;
  precision: number | null;
  lowerConfidenceBound: number | null;
  averageReturn: number | null;
  averageExcessReturn: number | null;
  averageDrawdown: number | null;
  tickers: string[];
  cases: Array<{ ticker: string; filingDate: string; returnPercent: number; excessReturn: number; drawdown: number; won: boolean }>;
};

const z90 = 1.2815515655446004;

export function wilsonLower90(wins: number, sampleSize: number) {
  if (!sampleSize) return null;
  const probability = wins / sampleSize;
  const denominator = 1 + (z90 * z90) / sampleSize;
  const centre = probability + (z90 * z90) / (2 * sampleSize);
  const adjustment = z90 * Math.sqrt((probability * (1 - probability)) / sampleSize + (z90 * z90) / (4 * sampleSize * sampleSize));
  return (centre - adjustment) / denominator;
}

function matches(row: ScoredHistoricalCase, rule: CalibrationRule) {
  const scores = row.scores;
  if (rule.minOpportunity !== undefined && scores.opportunityScore < rule.minOpportunity) return false;
  if (rule.maxOpportunity !== undefined && scores.opportunityScore > rule.maxOpportunity) return false;
  if (rule.minMomentum !== undefined && scores.financialMomentum < rule.minMomentum) return false;
  if (rule.maxMomentum !== undefined && scores.financialMomentum > rule.maxMomentum) return false;
  if (rule.minQuality !== undefined && scores.businessQuality < rule.minQuality) return false;
  if (rule.maxQuality !== undefined && scores.businessQuality > rule.maxQuality) return false;
  if (rule.minValuation !== undefined && scores.valuationSupport < rule.minValuation) return false;
  if (rule.maxRisk !== undefined && scores.riskScore > rule.maxRisk) return false;
  if (rule.minRisk !== undefined && scores.riskScore < rule.minRisk) return false;
  if (rule.minGrowth !== undefined && (row.revenueGrowth === null || row.revenueGrowth < rule.minGrowth)) return false;
  if (rule.maxGrowth !== undefined && (row.revenueGrowth === null || row.revenueGrowth > rule.maxGrowth)) return false;
  if (rule.minMarginChange !== undefined && (row.marginChange === null || row.marginChange < rule.minMarginChange)) return false;
  if (rule.maxMarginChange !== undefined && (row.marginChange === null || row.marginChange > rule.maxMarginChange)) return false;
  if (rule.maxPriceChange90d !== undefined && (row.priceChange90d === null || row.priceChange90d > rule.maxPriceChange90d)) return false;
  if (rule.minPriceChange90d !== undefined && (row.priceChange90d === null || row.priceChange90d < rule.minPriceChange90d)) return false;
  return true;
}

function result(row: ScoredHistoricalCase, rule: CalibrationRule) {
  const returnPercent = rule.horizonDays === 30 ? row.return30d : row.return90d;
  const excessReturn = rule.horizonDays === 30 ? row.excess30d : row.excess90d;
  const drawdown = rule.horizonDays === 30 ? row.drawdown30d : row.drawdown90d;
  if (rule.action === "buy") return { won: returnPercent >= 5 && excessReturn >= 2, returnPercent, excessReturn, drawdown };
  if (rule.action === "sell") return { won: returnPercent <= -5 && excessReturn <= -2, returnPercent, excessReturn, drawdown };
  return { won: drawdown <= -10 || (returnPercent < 0 && excessReturn <= -5), returnPercent, excessReturn, drawdown };
}

export function evaluateCalibrationRule(rows: ScoredHistoricalCase[], rule: CalibrationRule): CalibrationEvaluation {
  const selected = rows.filter((row) => matches(row, rule)).map((row) => ({ row, result: result(row, rule) }));
  const wins = selected.filter((item) => item.result.won).length;
  const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  return {
    rule,
    sampleSize: selected.length,
    wins,
    losses: selected.length - wins,
    precision: selected.length ? wins / selected.length : null,
    lowerConfidenceBound: wilsonLower90(wins, selected.length),
    averageReturn: average(selected.map((item) => item.result.returnPercent)),
    averageExcessReturn: average(selected.map((item) => item.result.excessReturn)),
    averageDrawdown: average(selected.map((item) => item.result.drawdown)),
    tickers: [...new Set(selected.map((item) => item.row.ticker))],
    cases: selected.map((item) => ({ ticker: item.row.ticker, filingDate: item.row.filingDate, returnPercent: item.result.returnPercent, excessReturn: item.result.excessReturn, drawdown: item.result.drawdown, won: item.result.won })),
  };
}

function buyRules(horizonDays: 30 | 90) {
  const rules: CalibrationRule[] = [];
  for (const minOpportunity of [55, 60, 65, 70, 75])
    for (const minMomentum of [50, 60, 70, 80])
      for (const minQuality of [45, 55, 65, 75])
        for (const minValuation of [10, 25, 40, 55])
          for (const maxRisk of [35, 45, 55, 65])
            for (const minGrowth of [-0.02, 0.03, 0.08, 0.15])
              for (const maxPriceChange90d of [20, 40, 70, 120])
                rules.push({ action: "buy", horizonDays, minOpportunity, minMomentum, minQuality, minValuation, maxRisk, minGrowth, maxPriceChange90d });
  return rules;
}

function sellRules(horizonDays: 30 | 90) {
  const rules: CalibrationRule[] = [];
  for (const maxOpportunity of [35, 40, 45, 50, 55])
    for (const maxMomentum of [20, 30, 40, 50])
      for (const maxQuality of [40, 50, 60, 70])
        for (const minRisk of [45, 55, 65, 75])
          for (const maxGrowth of [-0.15, -0.08, -0.02, 0.05])
            for (const maxMarginChange of [-0.08, -0.04, -0.015, 0])
              rules.push({ action: "sell", horizonDays, maxOpportunity, maxMomentum, maxQuality, minRisk, maxGrowth, maxMarginChange });
  return rules;
}

function watchOutRules(horizonDays: 30 | 90) {
  const rules: CalibrationRule[] = [];
  for (const maxMomentum of [25, 35, 45, 55])
    for (const minRisk of [50, 60, 70, 80])
      for (const maxGrowth of [-0.12, -0.05, 0, 0.05])
        for (const maxMarginChange of [-0.06, -0.03, -0.01, 0])
          for (const minPriceChange90d of [-50, -25, -10, 0])
            rules.push({ action: "watch_out", horizonDays, maxMomentum, minRisk, maxGrowth, maxMarginChange, minPriceChange90d });
  return rules;
}

export function selectTrainingRule(rows: ScoredHistoricalCase[], action: CalibrationRule["action"], horizonDays: CalibrationRule["horizonDays"]) {
  const minimumTrainingSamples = Math.max(18, Math.floor(rows.length * 0.035));
  const rules = action === "buy" ? buyRules(horizonDays) : action === "sell" ? sellRules(horizonDays) : watchOutRules(horizonDays);
  const candidates = rules.map((rule) => evaluateCalibrationRule(rows, rule))
    .filter((evaluation) => evaluation.sampleSize >= minimumTrainingSamples)
    .sort((left, right) => {
      const lower = (right.lowerConfidenceBound ?? 0) - (left.lowerConfidenceBound ?? 0);
      if (Math.abs(lower) > 1e-9) return lower;
      const precision = (right.precision ?? 0) - (left.precision ?? 0);
      if (Math.abs(precision) > 1e-9) return precision;
      return right.sampleSize - left.sampleSize;
    });
  return { selected: candidates[0] ?? null, topCandidates: candidates.slice(0, 10), minimumTrainingSamples, searchedRules: rules.length };
}
