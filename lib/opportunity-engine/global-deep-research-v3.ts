import { runGlobalDeepResearchV2 } from "./global-deep-research-v2";
import type { GlobalDeepResearchCase, GlobalDeepResearchResult, GlobalResearchAction } from "./global-deep-research";
import { fetchTradingViewFundamentals, type TradingViewFundamentalSnapshot } from "./tradingview-deep-enrichment";

export type GlobalDeepResearchCaseV3 = GlobalDeepResearchCase & {
  tradingViewFundamentals: TradingViewFundamentalSnapshot | null;
  fundamentalSupportCount: number;
  fundamentalWarningCount: number;
  fundamentalReasons: string[];
};

export type GlobalDeepResearchResultV3 = Omit<GlobalDeepResearchResult, "results"> & {
  results: {
    buy: GlobalDeepResearchCaseV3[];
    sell: GlobalDeepResearchCaseV3[];
    watchOut: GlobalDeepResearchCaseV3[];
  };
  liveFundamentalCoverage: {
    requested: number;
    received: number;
    coveragePercent: number;
    errors: string[];
  };
};

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const unique = <T>(values: T[]) => [...new Set(values)];
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function upside(current: number, target: number | null) {
  return target !== null && current > 0 ? ((target / current) - 1) * 100 : null;
}

function daysUntil(value: string | null) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? (time - Date.now()) / 86_400_000 : null;
}

function buyAssessment(snapshot: TradingViewFundamentalSnapshot, currentPrice: number) {
  const targetUpside = upside(currentPrice, snapshot.targetPrice);
  const support = [
    { pass: (snapshot.recommendation ?? -1) >= 0.3, reason: "TradingView's combined technical recommendation is positive." },
    { pass: (snapshot.revenueGrowthTtmPercent ?? -100) >= 5, reason: `Revenue is growing ${snapshot.revenueGrowthTtmPercent?.toFixed(1)}% year over year.` },
    { pass: (snapshot.epsGrowthTtmPercent ?? -100) >= 5, reason: `Diluted EPS is growing ${snapshot.epsGrowthTtmPercent?.toFixed(1)}% year over year.` },
    { pass: (snapshot.operatingMarginPercent ?? -100) > 5, reason: `Operating margin is ${snapshot.operatingMarginPercent?.toFixed(1)}%.` },
    { pass: (snapshot.freeCashFlow ?? -1) > 0, reason: "Free cash flow is positive." },
    { pass: targetUpside !== null && targetUpside >= 15, reason: `Current target-price upside is ${targetUpside?.toFixed(1)}%.` },
    { pass: (snapshot.returnOnAssetsPercent ?? -100) >= 5, reason: `Return on assets is ${snapshot.returnOnAssetsPercent?.toFixed(1)}%.` },
  ].filter((row) => row.pass);
  const warnings = [
    { pass: finite(snapshot.priceToEarnings) && snapshot.priceToEarnings > 60, reason: `P/E is high at ${snapshot.priceToEarnings?.toFixed(1)}x.` },
    { pass: finite(snapshot.debtToEquity) && snapshot.debtToEquity > 3, reason: `Debt-to-equity is elevated at ${snapshot.debtToEquity?.toFixed(2)}.` },
    { pass: finite(snapshot.currentRatio) && snapshot.currentRatio < 0.8, reason: `Current ratio is low at ${snapshot.currentRatio?.toFixed(2)}.` },
    { pass: targetUpside !== null && targetUpside < 0, reason: `The target price is ${Math.abs(targetUpside ?? 0).toFixed(1)}% below the current price.` },
    { pass: (snapshot.revenueGrowthTtmPercent ?? 0) < 0, reason: `Revenue is declining ${Math.abs(snapshot.revenueGrowthTtmPercent ?? 0).toFixed(1)}%.` },
  ].filter((row) => row.pass);
  return { support, warnings, targetUpside };
}

function sellAssessment(snapshot: TradingViewFundamentalSnapshot, currentPrice: number) {
  const targetUpside = upside(currentPrice, snapshot.targetPrice);
  const support = [
    { pass: (snapshot.recommendation ?? 1) <= -0.3, reason: "TradingView's combined technical recommendation is negative." },
    { pass: (snapshot.revenueGrowthTtmPercent ?? 0) < 0, reason: `Revenue is declining ${Math.abs(snapshot.revenueGrowthTtmPercent ?? 0).toFixed(1)}%.` },
    { pass: (snapshot.epsGrowthTtmPercent ?? 0) < 0, reason: `Diluted EPS is declining ${Math.abs(snapshot.epsGrowthTtmPercent ?? 0).toFixed(1)}%.` },
    { pass: (snapshot.freeCashFlow ?? 0) < 0, reason: "Free cash flow is negative." },
    { pass: (snapshot.operatingMarginPercent ?? 0) < 0, reason: `Operating margin is negative at ${snapshot.operatingMarginPercent?.toFixed(1)}%.` },
    { pass: targetUpside !== null && targetUpside <= -10, reason: `The target price is ${Math.abs(targetUpside ?? 0).toFixed(1)}% below the current price.` },
    { pass: finite(snapshot.debtToEquity) && snapshot.debtToEquity > 3 && finite(snapshot.currentRatio) && snapshot.currentRatio < 1, reason: "Leverage is high while short-term liquidity is weak." },
  ].filter((row) => row.pass);
  const warnings = [
    { pass: (snapshot.recommendation ?? -1) >= 0.3, reason: "The combined technical recommendation remains positive." },
    { pass: (snapshot.revenueGrowthTtmPercent ?? -100) >= 10, reason: `Revenue is still growing ${snapshot.revenueGrowthTtmPercent?.toFixed(1)}%.` },
    { pass: (snapshot.freeCashFlow ?? -1) > 0, reason: "Free cash flow remains positive." },
    { pass: targetUpside !== null && targetUpside >= 15, reason: `The current target price indicates ${targetUpside?.toFixed(1)}% upside.` },
  ].filter((row) => row.pass);
  return { support, warnings, targetUpside };
}

function watchOutAssessment(snapshot: TradingViewFundamentalSnapshot) {
  const nextEarningsDays = daysUntil(snapshot.nextEarningsAt);
  const support = [
    { pass: (snapshot.dailyVolatilityPercent ?? 0) >= 5, reason: `Daily volatility is elevated at ${snapshot.dailyVolatilityPercent?.toFixed(1)}%.` },
    { pass: (snapshot.beta1Year ?? 0) >= 2, reason: `One-year beta is high at ${snapshot.beta1Year?.toFixed(2)}.` },
    { pass: finite(snapshot.debtToEquity) && snapshot.debtToEquity > 4, reason: `Debt-to-equity is very high at ${snapshot.debtToEquity?.toFixed(2)}.` },
    { pass: finite(snapshot.currentRatio) && snapshot.currentRatio < 0.75, reason: `Current ratio is weak at ${snapshot.currentRatio?.toFixed(2)}.` },
    { pass: (snapshot.recommendation ?? 1) <= -0.4, reason: "The combined technical recommendation is strongly negative." },
    { pass: nextEarningsDays !== null && nextEarningsDays >= 0 && nextEarningsDays <= 14, reason: `Earnings are expected within ${Math.ceil(nextEarningsDays ?? 0)} days.` },
    { pass: (snapshot.relativeVolume10d ?? 0) >= 2, reason: `Relative volume is ${snapshot.relativeVolume10d?.toFixed(1)}x normal.` },
  ].filter((row) => row.pass);
  const warnings = [
    { pass: (snapshot.dailyVolatilityPercent ?? 100) < 2, reason: "Current daily volatility is not elevated." },
    { pass: (snapshot.beta1Year ?? 100) < 1, reason: "One-year beta is below one." },
  ].filter((row) => row.pass);
  return { support, warnings, targetUpside: null };
}

function assessment(action: GlobalResearchAction, snapshot: TradingViewFundamentalSnapshot, currentPrice: number) {
  return action === "buy" ? buyAssessment(snapshot, currentPrice)
    : action === "sell" ? sellAssessment(snapshot, currentPrice)
      : watchOutAssessment(snapshot);
}

function enrichCase(item: GlobalDeepResearchCase, snapshot: TradingViewFundamentalSnapshot | null): GlobalDeepResearchCaseV3 {
  if (!snapshot) {
    return {
      ...item,
      tradingViewFundamentals: null,
      fundamentalSupportCount: 0,
      fundamentalWarningCount: 0,
      fundamentalReasons: [],
      providerErrors: unique([...item.providerErrors, "TradingView fundamental snapshot was unavailable."]),
      blockedReasons: unique([...item.blockedReasons, "Current worldwide fundamental data was unavailable for this listing."]),
    };
  }
  const result = assessment(item.action, snapshot, item.currentPrice);
  const target = item.targetConsensus ?? snapshot.targetPrice;
  const targetUpside = upside(item.currentPrice, target);
  const analystCount = item.analystCount ?? snapshot.numberOfAnalysts;
  const fundamentalCompleteness = [
    snapshot.recommendation,
    snapshot.revenueGrowthTtmPercent,
    snapshot.epsGrowthTtmPercent,
    snapshot.operatingMarginPercent,
    snapshot.freeCashFlow,
    snapshot.debtToEquity,
    snapshot.currentRatio,
    snapshot.returnOnAssetsPercent,
  ].filter((value) => value !== null).length;
  const evidenceScore = clamp(
    item.evidenceScore
    + Math.min(22, fundamentalCompleteness * 2.75)
    + (snapshot.targetPrice !== null ? 5 : 0)
    + ((snapshot.numberOfAnalysts ?? 0) >= 3 ? 4 : 0)
    - result.warnings.length * 3,
  );
  const conflicts = result.warnings.length >= 3;
  const disposition = !conflicts && evidenceScore >= 80 && result.support.length >= 3
    ? "advance_to_committee_research"
    : evidenceScore >= 58 && result.support.length >= 1
      ? "watch_for_more_evidence"
      : "reject_or_deprioritize";
  const receipt = {
    source: "TradingView current global fundamentals",
    url: snapshot.sourceUrl,
    observedAt: snapshot.observedAt,
    fields: ["valuation", "growth", "margins", "cash flow", "balance sheet", "returns", "analyst recommendation", "target price", "earnings dates"],
  };
  return {
    ...item,
    targetConsensus: target,
    targetUpsidePercent: targetUpside,
    analystCount,
    consensusRevenueGrowthPercent: item.consensusRevenueGrowthPercent ?? snapshot.revenueGrowthTtmPercent,
    consensusEps: item.consensusEps ?? snapshot.dilutedEpsTtm,
    providersUsed: unique([...item.providersUsed, "TradingView fundamentals"]),
    evidenceScore,
    researchDisposition: disposition,
    blockedReasons: unique([
      ...item.blockedReasons,
      "Current fundamentals improve research quality but do not replace an independent outcome certificate.",
      ...(conflicts ? ["Multiple current fundamental warnings conflict with the proposed direction."] : []),
    ]),
    receipts: [...item.receipts, receipt],
    tradingViewFundamentals: snapshot,
    fundamentalSupportCount: result.support.length,
    fundamentalWarningCount: result.warnings.length,
    fundamentalReasons: [...result.support.map((row) => row.reason), ...result.warnings.map((row) => `Warning: ${row.reason}`)],
  };
}

export async function runGlobalDeepResearchV3(options?: { perAction?: number }): Promise<GlobalDeepResearchResultV3> {
  const base = await runGlobalDeepResearchV2(options);
  const sourceCases = [...base.results.buy, ...base.results.sell, ...base.results.watchOut];
  const fundamentals = await fetchTradingViewFundamentals(sourceCases);
  const mapCases = (cases: GlobalDeepResearchCase[]) => cases.map((item) => enrichCase(item, fundamentals.snapshots.get(item.tradingViewSymbol) ?? null));
  const buy = mapCases(base.results.buy);
  const sell = mapCases(base.results.sell);
  const watchOut = mapCases(base.results.watchOut);
  const all = [...buy, ...sell, ...watchOut];
  return {
    ...base,
    checkedAt: new Date().toISOString(),
    results: { buy, sell, watchOut },
    summary: {
      researched: all.length,
      advanced: all.filter((row) => row.researchDisposition === "advance_to_committee_research").length,
      watched: all.filter((row) => row.researchDisposition === "watch_for_more_evidence").length,
      rejected: all.filter((row) => row.researchDisposition === "reject_or_deprioritize").length,
      seriousSignals: 0,
      providerErrors: all.reduce((sum, row) => sum + row.providerErrors.length, 0),
    },
    liveFundamentalCoverage: {
      requested: sourceCases.length,
      received: fundamentals.snapshots.size,
      coveragePercent: sourceCases.length ? Number(((fundamentals.snapshots.size / sourceCases.length) * 100).toFixed(2)) : 100,
      errors: fundamentals.errors,
    },
  };
}
