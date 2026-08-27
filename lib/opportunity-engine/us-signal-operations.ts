import crypto from "node:crypto";
import { evaluateFiveCasePilotGate } from "@/lib/equity-signal/pilot-serious-signal-policy";
import { loadEquityUniverse } from "@/lib/equity-signal/universe";
import {
  getR2Config,
  readVersionedTextFromR2,
  writeVersionedJsonToR2,
} from "@/lib/r2-warehouse";
import type { UsValueCompanyAnalysis } from "@/lib/opportunity-engine/us-value-investing-engine";
import {
  readResumableUsValueState,
  type ResumableUsValueState,
} from "@/lib/opportunity-engine/us-value-investing-resumable";
import { pr262StorageKey } from "@/lib/opportunity-engine/pr262-storage";

const BRANCH = "agent/combined-opportunity-engine" as const;
const R2_PREFIX = pr262StorageKey("signal-operations");
const REGISTRY_KEY = `${R2_PREFIX}/active-registry.json`;
const LATEST_REPORT_KEY = `${R2_PREFIX}/latest.json`;
const NOTIFICATION_DIGEST_KEY = `${R2_PREFIX}/notification-digest/latest.json`;
const NORMALIZATION_PREFIX = `${R2_PREFIX}/long-term-normalization`;
const SPECIALIST_PREFIX = `${R2_PREFIX}/specialist-valuations`;
const BRANCH_LAB_STATE_KEY = pr262StorageKey("research-candidates/state.json");
const EVENT_JOB_STATE_KEY = pr262StorageKey("event-job/state-v1.json");
const DILIGENCE_KEY = pr262StorageKey("value-investing/catalyst-diligence/latest.json");
const WATCH_OUT_KEY = pr262StorageKey("research-candidates/us-watch-out/latest.json");
const MAX_PRICE_CANDIDATES = 5_000;
const MAX_YAHOO_CROSS_CHECKS = 40;
const MAX_FRESH_SEC_NORMALIZATIONS = 12;
const ACTIVE_SIGNAL_LIMIT = 500;
const SEC_AGENT = "SwingUp/1.0 support@swingup.app";

type Json = Record<string, unknown>;
type SignalAction = "buy" | "sell" | "watch_out";
type SignalStatus = "new" | "active" | "strengthened" | "weakened" | "resolved" | "invalidated";
type SignalSource =
  | "foundation_value"
  | "price_threshold"
  | "earnings_value_bridge"
  | "fundamental_acceleration"
  | "event_pilot"
  | "market_watch_out";

type Quote = {
  ticker: string;
  tradingViewSymbol: string;
  exchange: string | null;
  price: number;
  changePercent: number | null;
  volume: number | null;
  relativeVolume: number | null;
  marketCap: number | null;
  observedAt: string;
  source: "TradingView public scanner";
};

type PriceCrossCheck = {
  ticker: string;
  tradingViewPrice: number;
  yahooPrice: number | null;
  agreementPercent: number | null;
  passed: boolean;
  yahooObservedAt: string | null;
  error: string | null;
};

type EarningsSurprise = {
  ticker: string;
  reportedDate: string | null;
  reportedEps: number | null;
  estimatedEps: number | null;
  surprisePercent: number | null;
  source: "Alpha Vantage EARNINGS" | "unavailable";
  passedPositiveSurprise: boolean | null;
  error: string | null;
};

type LongTermNormalization = {
  ticker: string;
  cik: string;
  observedAt: string;
  sourceUrl: string;
  yearsAvailable: number;
  periodEnds: string[];
  revenueGrowthMedianPercent: number | null;
  netIncomeMedian: number | null;
  operatingCashFlowMedian: number | null;
  capitalExpenditureMedian: number | null;
  normalizedFreeCashFlow: number | null;
  cash: number | null;
  totalDebt: number | null;
  assets: number | null;
  debtToCash: number | null;
  debtToAssets: number | null;
  buyQualityConfirmed: boolean;
  positiveNetIncomeYears: number;
  positiveFreeCashFlowYears: number;
  earningsStabilityPercent: number;
  freeCashFlowStabilityPercent: number;
  latestNetIncomeToMedianRatio: number | null;
  latestCashConversion: number | null;
  oneTimeOrPeakRisk: boolean;
  durableEnoughForSeriousBuy: boolean;
  blockers: string[];
};

type SpecialistValuation = {
  ticker: string;
  model:
    | "general"
    | "bank_or_insurer_book_value"
    | "reit_requires_ffo_affo"
    | "utility_earnings_power"
    | "mega_cap_cloud_platform"
    | "semiconductor_mid_cycle"
    | "cyclical_mid_cycle"
    | "biotech_pipeline_required";
  fairValue: number | null;
  seriousEligible: boolean;
  confidence: number;
  reasons: string[];
  blockers: string[];
};

type MarketRegime = {
  label: "risk_on" | "recovery" | "neutral" | "risk_off";
  checkedAt: string;
  spyFiveDayReturnPercent: number | null;
  qqqFiveDayReturnPercent: number | null;
  spyAboveTwentyDayAverage: boolean | null;
  qqqAboveTwentyDayAverage: boolean | null;
  buyPriorityMultiplier: number;
  thresholdPolicy: "never_lower_core_margin_of_safety";
};

type ThesisChange = {
  ticker: string;
  priorBaseFairValue: number | null;
  currentBaseFairValue: number | null;
  fairValueChangePercent: number | null;
  qualityChange: number | null;
  riskChange: number | null;
  classification: "strengthened" | "weakened" | "stable" | "new";
  reasons: string[];
};

export type ActiveSeriousSignal = {
  fingerprint: string;
  ticker: string;
  company: string;
  action: SignalAction;
  status: SignalStatus;
  source: SignalSource;
  firstSeenAt: string;
  lastSeenAt: string;
  currentPrice: number | null;
  conservativeFairValue: number | null;
  baseFairValue: number | null;
  optimisticFairValue: number | null;
  potentialPercent: number | null;
  qualityScore: number | null;
  riskScore: number | null;
  confidenceScore: number;
  marketRegime: MarketRegime["label"];
  reasons: string[];
  blockers: string[];
  evidence: {
    officialSourceConfirmed: boolean;
    secDiligenceConfirmed: boolean;
    priceCrossChecked: boolean;
    historicalContextAvailable: boolean | null;
    longTermNormalizationPassed: boolean | null;
    specialistModel: SpecialistValuation["model"];
    committeeApproved: boolean;
    committeeAgentsCompleted: number;
    committeeAgentsFailed: number;
    finalJudgePositive: boolean;
    finalJudgeConfidence: number | null;
  };
  thesisSnapshot: {
    baseFairValue: number | null;
    qualityScore: number | null;
    riskScore: number | null;
  };
};

type ActiveRegistry = {
  version: 1;
  branch: typeof BRANCH;
  updatedAt: string;
  signals: ActiveSeriousSignal[];
};

export type UsSignalOperationsReport = {
  version: 1;
  ok: boolean;
  mode: "pr262_us_serious_signal_operations";
  branch: typeof BRANCH;
  checkedAt: string;
  runtime: { commitSha: string | null; deploymentId: string | null };
  marketRegime: MarketRegime;
  coverage: {
    totalStoredCompanies: number;
    companiesLoadedFromR2Batches: number;
    priceCandidates: number;
    liveQuotes: number;
    independentPriceCrossChecks: number;
    recentEventCandidates: number;
    earningsSurprisesChecked: number;
    longTermNormalizations: number;
    specialistValuations: number;
  };
  buyFocus: {
    priority: true;
    priceThresholdCrossings: number;
    earningsValueBridgeCandidates: number;
    seriousBuys: ActiveSeriousSignal[];
    nearMisses: Array<{
      ticker: string;
      company: string;
      currentPrice: number | null;
      buyBelowPrice: number | null;
      baseFairValue: number | null;
      blockers: string[];
    }>;
  };
  seriousSignals: {
    buy: ActiveSeriousSignal[];
    sell: ActiveSeriousSignal[];
    watchOut: ActiveSeriousSignal[];
  };
  activeRegistry: {
    key: string;
    total: number;
    new: number;
    strengthened: number;
    weakened: number;
    resolved: number;
    invalidated: number;
  };
  thesisChanges: ThesisChange[];
  notificationDigest: {
    key: string;
    newSignalCount: number;
    signals: ActiveSeriousSignal[];
    deliveryEnabledInsideDraftBranch: false;
    readyForExternalConditionWatcher: true;
  };
  longTermNormalization: LongTermNormalization[];
  specialistValuations: SpecialistValuation[];
  errors: string[];
  safety: {
    databaseWrites: false;
    publishing: false;
    directUserNotifications: false;
    trades: false;
    productionWrites: false;
    nonUsScanning: false;
  };
};

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finite(value: unknown) {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number(value.replace(/,/g, ""))
      : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function rounded(value: number | null, digits = 2) {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function median(values: number[]) {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 400) : "unknown_signal_operations_error";
}

function companyKey(item: Pick<UsValueCompanyAnalysis, "exchange" | "ticker">) {
  return `${item.exchange.toUpperCase()}:${item.ticker.toUpperCase()}`;
}

function dateKey(value: string) {
  return value.replace(/[^0-9]/g, "").slice(0, 17);
}

async function readJson(key: string) {
  const current = await readVersionedTextFromR2(key);
  if (!current.found || !current.text) return null;
  return JSON.parse(current.text) as unknown;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>) {
  const output = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), Math.max(1, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await worker(items[index]);
    }
  }));
  return output;
}

async function loadCompletedAnalyses(state: ResumableUsValueState | null) {
  if (!state) return [] as UsValueCompanyAnalysis[];
  const objects = await mapWithConcurrency(state.completedBatchKeys, 4, async (key) => {
    try {
      const parsed = object(await readJson(key));
      return array(parsed.analyses) as UsValueCompanyAnalysis[];
    } catch {
      return [] as UsValueCompanyAnalysis[];
    }
  });
  const fallback = [
    ...state.seriousAlerts.buy,
    ...state.seriousAlerts.sell,
    ...state.seriousAlerts.watchOut,
    ...state.qualityPriceWatchlist,
  ];
  const all = objects.flat().length ? objects.flat() : fallback;
  return [...new Map(all.map((item) => [companyKey(item), item])).values()];
}

function parseEventCandidates(historyValue: unknown) {
  const history = object(historyValue);
  const runs = array(history.runs).map(object).slice(-30);
  const candidates: Json[] = [];
  for (const run of runs) {
    for (const candidate of array(run.rankedCandidates).map(object).slice(0, 30)) candidates.push(candidate);
    const selected = object(run.selectedCandidate);
    if (Object.keys(selected).length) {
      candidates.push({ ...selected, committeeApproval: committeeApprovalFromRun(run) });
    }
  }
  const unique = new Map<string, Json>();
  for (const candidate of candidates) {
    const ticker = text(candidate.ticker)?.toUpperCase();
    const eventFamily = text(candidate.eventFamily);
    const eventObservedAt = text(candidate.eventObservedAt);
    if (!ticker || !eventFamily || !eventObservedAt) continue;
    unique.set(`${ticker}|${eventFamily}|${eventObservedAt}`, candidate);
  }
  return [...unique.values()];
}

type CommitteeApproval = {
  approved: boolean;
  actionable: boolean;
  historicalContextAvailable: boolean;
  agentsCompleted: number;
  agentsFailed: number;
  finalJudgePositive: boolean;
  finalJudgeConfidence: number | null;
};

function committeeApprovalFromRun(runValue: unknown): CommitteeApproval {
  const run = object(runValue);
  const committee = object(run.committee);
  const finalJudge = object(committee.finalJudge);
  const output = object(committee.output);
  const historicalPilot = object(run.historicalPilot);
  const historicalContextAvailable = (finite(historicalPilot.reportedSampleSize) ?? 0) > 0
    || (finite(historicalPilot.independentRealEventCount) ?? 0) > 0;
  const agentsCompleted = Math.max(0, Math.floor(finite(committee.agentsCompleted) ?? 0));
  const agentsFailed = Math.max(0, Math.floor(finite(committee.agentsFailed) ?? 0));
  const confidence = finite(finalJudge.confidence);
  const finalJudgePositive = finalJudge.verdict === "positive" && (confidence ?? 0) >= 80;
  return {
    approved: run.seriousSignalFound === true
      && committee.ok === true
      && agentsCompleted === 14
      && agentsFailed === 0
      && finalJudgePositive
      && output.overallRecommendation === "approve",
    actionable: run.actionableSignalFound === true && (run.alertType === "buy" || run.alertType === "sell"),
    historicalContextAvailable,
    agentsCompleted,
    agentsFailed,
    finalJudgePositive,
    finalJudgeConfidence: confidence,
  };
}

function committeeApprovalFromCandidate(candidate: Json): CommitteeApproval {
  const approval = object(candidate.committeeApproval);
  return {
    approved: approval.approved === true,
    actionable: approval.actionable === true,
    historicalContextAvailable: approval.historicalContextAvailable === true,
    agentsCompleted: Math.max(0, Math.floor(finite(approval.agentsCompleted) ?? 0)),
    agentsFailed: Math.max(0, Math.floor(finite(approval.agentsFailed) ?? 0)),
    finalJudgePositive: approval.finalJudgePositive === true,
    finalJudgeConfidence: finite(approval.finalJudgeConfidence),
  };
}

function diligenceConfirmation(value: unknown) {
  const report = object(value);
  const confirmation = object(report.alertConfirmation);
  const tickers = (input: unknown) => array(input)
    .map((item) => text(item)?.toUpperCase() ?? null)
    .filter((item): item is string => Boolean(item));
  return {
    buy: new Set(tickers(confirmation.buy)),
    sell: new Set(tickers(confirmation.sell)),
    watchOut: new Set(tickers(confirmation.watchOut)),
  };
}

function watchOutSignals(value: unknown) {
  const report = object(value);
  return array(report.seriousSignals).map(object);
}

function quotePriority(
  analyses: UsValueCompanyAnalysis[],
  priorRegistry: ActiveRegistry | null,
  recentEvents: Json[],
) {
  const activeTickers = new Set((priorRegistry?.signals ?? [])
    .filter((signal) => ["new", "active", "strengthened", "weakened"].includes(signal.status))
    .map((signal) => signal.ticker.toUpperCase()));
  const eventTickers = new Set(recentEvents.map((item) => text(item.ticker)?.toUpperCase()).filter((item): item is string => Boolean(item)));
  return [...analyses]
    .sort((left, right) => {
      const leftPriority = (activeTickers.has(left.ticker.toUpperCase()) ? 1_000 : 0)
        + (eventTickers.has(left.ticker.toUpperCase()) ? 800 : 0)
        + (left.decision.tier === "serious_foundation_buy" ? 700 : 0)
        + (left.decision.tier === "quality_price_watchlist" ? 500 : 0)
        + left.scores.businessQuality
        - left.scores.risk;
      const rightPriority = (activeTickers.has(right.ticker.toUpperCase()) ? 1_000 : 0)
        + (eventTickers.has(right.ticker.toUpperCase()) ? 800 : 0)
        + (right.decision.tier === "serious_foundation_buy" ? 700 : 0)
        + (right.decision.tier === "quality_price_watchlist" ? 500 : 0)
        + right.scores.businessQuality
        - right.scores.risk;
      return rightPriority - leftPriority;
    })
    .slice(0, MAX_PRICE_CANDIDATES);
}

async function fetchTradingViewQuotes(items: UsValueCompanyAnalysis[], fetchImpl: typeof fetch, observedAt: string) {
  if (!items.length) return new Map<string, Quote>();
  const chunks = Array.from(
    { length: Math.ceil(items.length / 500) },
    (_, index) => items.slice(index * 500, (index + 1) * 500),
  );
  const maps = await mapWithConcurrency(chunks, 5, async (chunk) => {
    const response = await fetchImpl("https://scanner.tradingview.com/america/scan", {
      method: "POST",
      cache: "no-store",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        origin: "https://www.tradingview.com",
        referer: "https://www.tradingview.com/",
        "user-agent": "Mozilla/5.0 (compatible; SwingUpPriceOnly/2.0)",
      },
      body: JSON.stringify({
        symbols: {
          tickers: chunk.map((item) => item.tradingViewSymbol),
          query: { types: [] },
        },
        columns: [
          "name",
          "description",
          "exchange",
          "close",
          "change",
          "volume",
          "relative_volume_10d_calc",
          "market_cap_basic",
        ],
        range: [0, chunk.length],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const payload = object(await response.json().catch(() => null));
    if (!response.ok) throw new Error(`tradingview_price_only_http_${response.status}`);
    const output = new Map<string, Quote>();
    for (const raw of array(payload.data).map(object)) {
      const symbol = text(raw.s)?.toUpperCase();
      const data = array(raw.d);
      if (!symbol || data.length < 8) continue;
      const ticker = symbol.includes(":") ? symbol.split(":").at(-1)! : symbol;
      const price = finite(data[3]);
      if (price === null || price <= 0) continue;
      output.set(ticker, {
        ticker,
        tradingViewSymbol: symbol,
        exchange: text(data[2]),
        price,
        changePercent: finite(data[4]),
        volume: finite(data[5]),
        relativeVolume: finite(data[6]),
        marketCap: finite(data[7]),
        observedAt,
        source: "TradingView public scanner",
      });
    }
    return output;
  });
  const combined = new Map<string, Quote>();
  for (const map of maps) for (const [ticker, quote] of map) combined.set(ticker, quote);
  return combined;
}

async function fetchYahooSeries(ticker: string, range: "5d" | "3mo", fetchImpl: typeof fetch) {
  const response = await fetchImpl(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=${range}&events=div%2Csplits`,
    {
      headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; SwingUpCrossCheck/1.0)" },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (!response.ok) throw new Error(`yahoo_chart_http_${response.status}`);
  const payload = object(await response.json());
  const chart = object(payload.chart);
  const result = object(array(chart.result)[0]);
  const timestamps = array(result.timestamp);
  const quote = object(array(object(result.indicators).quote)[0]);
  const closes = array(quote.close).map(finite);
  return closes.flatMap((close, index) => close === null ? [] : [{
    close,
    observedAt: timestamps[index] ? new Date(Number(timestamps[index]) * 1_000).toISOString() : null,
  }]);
}

async function crossCheckPrices(
  candidates: Array<{ ticker: string; price: number }>,
  fetchImpl: typeof fetch,
) {
  const unique = [...new Map(candidates.map((item) => [item.ticker.toUpperCase(), item])).values()]
    .slice(0, MAX_YAHOO_CROSS_CHECKS);
  const rows = await mapWithConcurrency(unique, 6, async (item): Promise<PriceCrossCheck> => {
    try {
      const series = await fetchYahooSeries(item.ticker, "5d", fetchImpl);
      const latest = series.at(-1) ?? null;
      const agreement = latest ? Math.abs(item.price - latest.close) / Math.max(item.price, latest.close) * 100 : null;
      return {
        ticker: item.ticker,
        tradingViewPrice: rounded(item.price) ?? item.price,
        yahooPrice: rounded(latest?.close ?? null),
        agreementPercent: rounded(agreement),
        passed: agreement !== null && agreement <= 2,
        yahooObservedAt: latest?.observedAt ?? null,
        error: null,
      };
    } catch (error) {
      return {
        ticker: item.ticker,
        tradingViewPrice: rounded(item.price) ?? item.price,
        yahooPrice: null,
        agreementPercent: null,
        passed: false,
        yahooObservedAt: null,
        error: safeError(error),
      };
    }
  });
  return new Map(rows.map((row) => [row.ticker.toUpperCase(), row]));
}

async function fetchEarningsSurprise(ticker: string, fetchImpl: typeof fetch, now: Date): Promise<EarningsSurprise> {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY?.trim();
  if (!apiKey) {
    return {
      ticker,
      reportedDate: null,
      reportedEps: null,
      estimatedEps: null,
      surprisePercent: null,
      source: "unavailable",
      passedPositiveSurprise: null,
      error: "alpha_vantage_not_configured",
    };
  }
  try {
    const url = new URL("https://www.alphavantage.co/query");
    url.searchParams.set("function", "EARNINGS");
    url.searchParams.set("symbol", ticker);
    url.searchParams.set("apikey", apiKey);
    const response = await fetchImpl(url, {
      headers: { accept: "application/json", "user-agent": "SwingUp/1.0" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`alpha_vantage_earnings_http_${response.status}`);
    const payload = object(await response.json());
    const rows = array(payload.quarterlyEarnings).map(object)
      .map((row) => ({
        reportedDate: text(row.reportedDate),
        reportedEps: finite(row.reportedEPS),
        estimatedEps: finite(row.estimatedEPS),
        surprisePercent: finite(row.surprisePercentage),
      }))
      .filter((row) => row.reportedDate && now.getTime() - Date.parse(row.reportedDate) <= 21 * 86_400_000)
      .sort((left, right) => String(right.reportedDate).localeCompare(String(left.reportedDate)));
    const latest = rows[0];
    if (!latest) throw new Error("alpha_vantage_recent_earnings_unavailable");
    return {
      ticker,
      ...latest,
      source: "Alpha Vantage EARNINGS",
      passedPositiveSurprise: latest.surprisePercent === null ? null : latest.surprisePercent > 0,
      error: null,
    };
  } catch (error) {
    return {
      ticker,
      reportedDate: null,
      reportedEps: null,
      estimatedEps: null,
      surprisePercent: null,
      source: "unavailable",
      passedPositiveSurprise: null,
      error: safeError(error),
    };
  }
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

async function buildMarketRegime(fetchImpl: typeof fetch, checkedAt: string): Promise<MarketRegime> {
  const [spy, qqq] = await Promise.all([
    fetchYahooSeries("SPY", "3mo", fetchImpl).catch(() => []),
    fetchYahooSeries("QQQ", "3mo", fetchImpl).catch(() => []),
  ]);
  const metrics = (series: Array<{ close: number }>) => {
    const closes = series.map((item) => item.close);
    const latest = closes.at(-1) ?? null;
    const fiveAgo = closes.at(-6) ?? closes[0] ?? null;
    const fiveDayReturn = latest !== null && fiveAgo !== null && fiveAgo !== 0 ? (latest / fiveAgo - 1) * 100 : null;
    const twenty = average(closes.slice(-20));
    return {
      fiveDayReturn,
      aboveTwenty: latest !== null && twenty !== null ? latest > twenty : null,
    };
  };
  const spyMetrics = metrics(spy);
  const qqqMetrics = metrics(qqq);
  let label: MarketRegime["label"] = "neutral";
  if (
    spyMetrics.aboveTwenty === true
    && qqqMetrics.aboveTwenty === true
    && (spyMetrics.fiveDayReturn ?? 0) > 0
    && (qqqMetrics.fiveDayReturn ?? 0) > 0
  ) label = "risk_on";
  else if ((spyMetrics.fiveDayReturn ?? 0) >= 2 && (qqqMetrics.fiveDayReturn ?? 0) >= 2) label = "recovery";
  else if (
    spyMetrics.aboveTwenty === false
    && qqqMetrics.aboveTwenty === false
    && ((spyMetrics.fiveDayReturn ?? 0) < -2 || (qqqMetrics.fiveDayReturn ?? 0) < -2)
  ) label = "risk_off";
  return {
    label,
    checkedAt,
    spyFiveDayReturnPercent: rounded(spyMetrics.fiveDayReturn),
    qqqFiveDayReturnPercent: rounded(qqqMetrics.fiveDayReturn),
    spyAboveTwentyDayAverage: spyMetrics.aboveTwenty,
    qqqAboveTwentyDayAverage: qqqMetrics.aboveTwenty,
    buyPriorityMultiplier: label === "recovery" ? 1.2 : label === "risk_on" ? 1.1 : label === "risk_off" ? 0.8 : 1,
    thresholdPolicy: "never_lower_core_margin_of_safety",
  };
}

type SecFactRow = {
  start: string | null;
  end: string;
  filed: string | null;
  form: string | null;
  value: number;
};

const SEC_ANNUAL_FORMS = new Set(["10-K", "20-F", "40-F"]);

function secRows(payload: Json, concepts: string[], units: string[]) {
  const facts = object(payload.facts);
  for (const namespace of ["us-gaap", "ifrs-full"]) {
    const namespaceFacts = object(facts[namespace]);
    for (const concept of concepts) {
      const fact = object(namespaceFacts[concept]);
      const groups = object(fact.units);
      for (const unit of units) {
        const rows = array(groups[unit]).flatMap((raw): SecFactRow[] => {
          const item = object(raw);
          const value = finite(item.val);
          const end = text(item.end);
          if (value === null || !end) return [];
          return [{
            start: text(item.start),
            end,
            filed: text(item.filed),
            form: text(item.form),
            value,
          }];
        });
        if (rows.length) return rows;
      }
    }
  }
  return [] as SecFactRow[];
}

function annualRows(payload: Json, concepts: string[], units = ["USD"]) {
  return [...new Map(
    secRows(payload, concepts, units)
      .filter((row) => {
        if (!SEC_ANNUAL_FORMS.has(row.form ?? "") || !row.start) return false;
        const duration = (Date.parse(row.end) - Date.parse(row.start)) / 86_400_000;
        return duration >= 250 && duration <= 450;
      })
      .sort((left, right) => `${right.end}:${right.filed ?? ""}`.localeCompare(`${left.end}:${left.filed ?? ""}`))
      .map((row) => [row.end, row]),
  ).values()].slice(0, 10);
}

function alignedValue(rows: SecFactRow[], end: string) {
  return rows.find((row) => row.end === end)?.value ?? null;
}

function latestInstantValue(payload: Json, concepts: string[]) {
  const rows = secRows(payload, concepts, ["USD"])
    .filter((row) => SEC_ANNUAL_FORMS.has(row.form ?? ""))
    .sort((left, right) => `${right.end}:${right.filed ?? ""}`.localeCompare(`${left.end}:${left.filed ?? ""}`));
  return rows[0]?.value ?? null;
}

function growthSeries(rows: SecFactRow[]) {
  const ordered = [...rows].sort((left, right) => left.end.localeCompare(right.end));
  const output: number[] = [];
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index - 1].value !== 0) output.push((ordered[index].value / ordered[index - 1].value - 1) * 100);
  }
  return output;
}

function buildNormalization(ticker: string, cik: string, payload: Json, observedAt: string): LongTermNormalization {
  const revenue = annualRows(payload, [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "Revenues",
    "SalesRevenueNet",
    "Revenue",
  ]);
  const netIncome = annualRows(payload, ["NetIncomeLoss", "ProfitLoss"]);
  const operatingCashFlow = annualRows(payload, [
    "NetCashProvidedByUsedInOperatingActivities",
    "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
    "CashFlowsFromUsedInOperatingActivities",
  ]);
  const capitalExpenditure = annualRows(payload, [
    "PaymentsToAcquirePropertyPlantAndEquipment",
    "PaymentsForAdditionsToPropertyPlantAndEquipment",
    "PurchaseOfPropertyPlantAndEquipment",
  ]);
  const periodEnds = [...new Set([
    ...revenue.map((row) => row.end),
    ...netIncome.map((row) => row.end),
    ...operatingCashFlow.map((row) => row.end),
  ])].sort().slice(-10);
  const netIncomeValues = periodEnds.flatMap((end) => {
    const value = alignedValue(netIncome, end);
    return value === null ? [] : [value];
  });
  const cashFlowValues = periodEnds.flatMap((end) => {
    const value = alignedValue(operatingCashFlow, end);
    return value === null ? [] : [value];
  });
  const capexValues = periodEnds.flatMap((end) => {
    const value = alignedValue(capitalExpenditure, end);
    return value === null ? [] : [Math.abs(value)];
  });
  const freeCashFlows = periodEnds.flatMap((end) => {
    const cfo = alignedValue(operatingCashFlow, end);
    const capex = alignedValue(capitalExpenditure, end);
    return cfo === null || capex === null ? [] : [cfo - Math.abs(capex)];
  });
  const netIncomeMedian = median(netIncomeValues.slice(-5));
  const operatingCashFlowMedian = median(cashFlowValues.slice(-5));
  const capitalExpenditureMedian = median(capexValues.slice(-5));
  const normalizedFreeCashFlow = median(freeCashFlows.slice(-5));
  const cash = latestInstantValue(payload, [
    "CashAndCashEquivalentsAtCarryingValue",
    "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
    "CashAndCashEquivalents",
  ]);
  const currentDebt = latestInstantValue(payload, [
    "DebtCurrent",
    "LongTermDebtCurrent",
    "ShortTermBorrowings",
    "CommercialPaper",
    "CurrentBorrowings",
  ]) ?? 0;
  const noncurrentDebt = latestInstantValue(payload, [
    "LongTermDebtNoncurrent",
    "LongTermDebtAndFinanceLeaseObligationsNoncurrent",
    "LongTermDebtAndCapitalLeaseObligations",
    "NoncurrentBorrowings",
  ]) ?? 0;
  const assets = latestInstantValue(payload, ["Assets"]);
  const totalDebt = currentDebt + noncurrentDebt;
  const debtToCash = cash && cash > 0 ? totalDebt / cash : totalDebt > 0 ? Infinity : 0;
  const debtToAssets = assets && assets > 0 ? totalDebt / assets : null;
  const balanceSheetRisk = debtToCash > 4 || (debtToAssets ?? 0) > 0.55;
  const latestNetIncome = netIncomeValues.at(-1) ?? null;
  const latestCfo = cashFlowValues.at(-1) ?? null;
  const latestNetIncomeToMedianRatio = latestNetIncome !== null && netIncomeMedian && netIncomeMedian !== 0
    ? latestNetIncome / netIncomeMedian
    : null;
  const latestCashConversion = latestNetIncome !== null && latestCfo !== null && latestNetIncome !== 0
    ? latestCfo / latestNetIncome
    : null;
  const yearsAvailable = Math.min(10, Math.max(revenue.length, netIncome.length, operatingCashFlow.length));
  const positiveNetIncomeYears = netIncomeValues.filter((value) => value > 0).length;
  const positiveFreeCashFlowYears = freeCashFlows.filter((value) => value > 0).length;
  const earningsStability = netIncomeValues.length ? positiveNetIncomeYears / netIncomeValues.length * 100 : 0;
  const freeCashFlowStability = freeCashFlows.length ? positiveFreeCashFlowYears / freeCashFlows.length * 100 : 0;
  const oneTimeOrPeakRisk = (latestNetIncomeToMedianRatio ?? 1) > 2
    || (latestCashConversion ?? 1) < 0.5
    || earningsStability < 60
    || freeCashFlowStability < 60;
  const buyQualityConfirmed = yearsAvailable >= 5
    && !oneTimeOrPeakRisk
    && !balanceSheetRisk
    && normalizedFreeCashFlow !== null
    && normalizedFreeCashFlow > 0;
  const blockers = [
    ...(yearsAvailable < 5 ? ["Fewer than five annual SEC periods are available."] : []),
    ...(earningsStability < 60 ? ["Profits were positive in fewer than 60% of available years."] : []),
    ...(freeCashFlowStability < 60 ? ["Free cash flow was positive in fewer than 60% of available years."] : []),
    ...((latestNetIncomeToMedianRatio ?? 1) > 2 ? ["Latest profit is more than twice the five-year median and may be peak-cycle or one-time."] : []),
    ...((latestCashConversion ?? 1) < 0.5 ? ["Latest operating cash flow is less than half of reported net income."] : []),
    ...(debtToCash > 4 ? ["Total debt is more than four times available cash."] : []),
    ...((debtToAssets ?? 0) > 0.55 ? ["Debt exceeds 55% of reported assets."] : []),
  ];
  return {
    ticker,
    cik,
    observedAt,
    sourceUrl: `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,
    yearsAvailable,
    periodEnds,
    revenueGrowthMedianPercent: rounded(median(growthSeries(revenue).slice(-5))),
    netIncomeMedian: rounded(netIncomeMedian, 0),
    operatingCashFlowMedian: rounded(operatingCashFlowMedian, 0),
    capitalExpenditureMedian: rounded(capitalExpenditureMedian, 0),
    normalizedFreeCashFlow: rounded(normalizedFreeCashFlow, 0),
    cash: rounded(cash, 0),
    totalDebt: rounded(totalDebt, 0),
    assets: rounded(assets, 0),
    debtToCash: Number.isFinite(debtToCash) ? rounded(debtToCash) : null,
    debtToAssets: rounded(debtToAssets),
    buyQualityConfirmed,
    positiveNetIncomeYears,
    positiveFreeCashFlowYears,
    earningsStabilityPercent: rounded(earningsStability) ?? 0,
    freeCashFlowStabilityPercent: rounded(freeCashFlowStability) ?? 0,
    latestNetIncomeToMedianRatio: rounded(latestNetIncomeToMedianRatio),
    latestCashConversion: rounded(latestCashConversion),
    oneTimeOrPeakRisk,
    durableEnoughForSeriousBuy: buyQualityConfirmed,
    blockers,
  };
}

async function loadOrBuildNormalization(
  ticker: string,
  cik: string,
  now: Date,
  fetchImpl: typeof fetch,
  allowFresh: boolean,
) {
  const latestKey = `${NORMALIZATION_PREFIX}/${ticker.toUpperCase()}/latest.json`;
  try {
    const cached = object(await readJson(latestKey));
    const observedAt = text(cached.observedAt);
    if (observedAt && now.getTime() - Date.parse(observedAt) <= 24 * 60 * 60 * 1_000) {
      return cached as unknown as LongTermNormalization;
    }
  } catch {}
  if (!allowFresh) return null;
  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
  const response = await fetchImpl(url, {
    headers: { accept: "application/json", "user-agent": SEC_AGENT },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`sec_companyfacts_http_${response.status}`);
  const normalization = buildNormalization(ticker, cik, object(await response.json()), now.toISOString());
  await writeVersionedJsonToR2(latestKey, normalization);
  await writeVersionedJsonToR2(
    `${NORMALIZATION_PREFIX}/${ticker.toUpperCase()}/runs/${now.toISOString().slice(0, 10)}/${dateKey(now.toISOString())}.json`,
    normalization,
    { createOnly: true },
  ).catch(() => {});
  return normalization;
}

function specialistModel(item: UsValueCompanyAnalysis, normalization: LongTermNormalization | null): SpecialistValuation {
  const words = `${item.sector ?? ""} ${item.industry ?? ""}`.toLowerCase();
  const eps = item.fundamentals.dilutedEpsTtm;
  const priceToBook = item.valuation.priceToBook;
  const roe = item.fundamentals.returnOnEquityPercent;
  const bookValuePerShare = priceToBook && priceToBook > 0 ? item.currentPrice / priceToBook : null;
  const shares = item.marketCap && item.currentPrice > 0 ? item.marketCap / item.currentPrice : null;
  if (/\b(bank|banks|insurance|financial services|credit services)\b/.test(words)) {
    const justifiedPriceToBook = roe !== null ? clamp(roe / 10, 0.7, 2) : null;
    const fairValue = bookValuePerShare !== null && justifiedPriceToBook !== null
      ? bookValuePerShare * justifiedPriceToBook
      : null;
    return {
      ticker: item.ticker,
      model: "bank_or_insurer_book_value",
      fairValue: rounded(fairValue),
      seriousEligible: false,
      confidence: fairValue === null ? 20 : 55,
      reasons: fairValue === null ? [] : ["Book value and return on equity supplied a conservative first-pass specialist estimate."],
      blockers: ["Regulatory capital, credit losses, reserve adequacy, and deposit or policy-liability quality must be verified before serious promotion."],
    };
  }
  if (/\b(reit|real estate)\b/.test(words)) {
    return {
      ticker: item.ticker,
      model: "reit_requires_ffo_affo",
      fairValue: null,
      seriousEligible: false,
      confidence: 10,
      reasons: [],
      blockers: ["FFO, AFFO, property-level net asset value, lease maturity, and debt maturity data are required."],
    };
  }
  if (/\b(utility|utilities)\b/.test(words)) {
    const multiple = clamp(12 + item.scores.businessQuality / 20, 12, 17);
    const fairValue = eps && eps > 0 ? eps * multiple : null;
    const seriousEligible = fairValue !== null
      && (item.fundamentals.debtToEquityPercent ?? Infinity) < 180
      && item.scores.risk <= 45;
    return {
      ticker: item.ticker,
      model: "utility_earnings_power",
      fairValue: rounded(fairValue),
      seriousEligible,
      confidence: fairValue === null ? 25 : seriousEligible ? 70 : 50,
      reasons: fairValue === null ? [] : [`Regulated-style earnings were valued at a conservative ${multiple.toFixed(1)}x multiple.`],
      blockers: seriousEligible ? [] : ["Debt burden or missing positive EPS blocks serious utility promotion."],
    };
  }
  if (
    /\b(cloud|software|internet retail|e-commerce|interactive media|digital platform|computer services)\b/.test(words)
    && (item.marketCap ?? 0) >= 100_000_000_000
    && item.scores.businessQuality >= 75
  ) {
    const normalizedFcf = normalization?.normalizedFreeCashFlow ?? null;
    const normalizedFcfPerShare = normalizedFcf !== null && shares && shares > 0 ? normalizedFcf / shares : null;
    const growth = median([
      item.fundamentals.revenueGrowthTtmPercent,
      item.fundamentals.revenueGrowthFyPercent,
      item.fundamentals.epsGrowthTtmPercent,
    ].filter((value): value is number => value !== null)) ?? 0;
    const requiredFcfYield = clamp(0.06 - Math.max(0, growth) * 0.0006 - item.scores.businessQuality * 0.00008, 0.035, 0.06);
    const justifiedPe = clamp(20 + Math.max(0, growth) * 0.25 + (item.scores.businessQuality - 75) * 0.15, 20, 32);
    const values = [
      normalizedFcfPerShare && normalizedFcfPerShare > 0 ? normalizedFcfPerShare / requiredFcfYield : null,
      eps && eps > 0 ? eps * justifiedPe : null,
    ].filter((value): value is number => value !== null);
    const fairValue = median(values);
    const seriousEligible = values.length >= 2 && normalization?.buyQualityConfirmed === true;
    return {
      ticker: item.ticker,
      model: "mega_cap_cloud_platform",
      fairValue: rounded(fairValue),
      seriousEligible,
      confidence: fairValue === null ? 25 : seriousEligible ? 85 : 60,
      reasons: fairValue === null ? [] : [
        "Five-year owner earnings and current earnings power are combined for a high-quality cloud or digital-platform company.",
        `The model uses a conservative ${(requiredFcfYield * 100).toFixed(1)}% owner-earnings yield and caps the earnings multiple at ${justifiedPe.toFixed(1)}x.`,
      ],
      blockers: seriousEligible ? [] : [
        "Five-year SEC cash-flow durability and balance-sheet confirmation are required before serious promotion.",
      ],
    };
  }
  if (/\b(semiconductor|memory|integrated circuits|chip)\b/.test(words)) {
    const normalizedFcf = normalization?.normalizedFreeCashFlow ?? null;
    const normalizedFcfPerShare = normalizedFcf !== null && shares && shares > 0 ? normalizedFcf / shares : null;
    const normalizedEarningsPerShare = normalization?.netIncomeMedian !== null
      && normalization?.netIncomeMedian !== undefined
      && shares
      && shares > 0
      ? normalization.netIncomeMedian / shares
      : null;
    const values = [
      normalizedFcfPerShare && normalizedFcfPerShare > 0 ? normalizedFcfPerShare / 0.065 : null,
      normalizedEarningsPerShare && normalizedEarningsPerShare > 0 ? normalizedEarningsPerShare * 18 : null,
    ].filter((value): value is number => value !== null);
    const fairValue = median(values);
    const seriousEligible = values.length >= 2 && normalization?.durableEnoughForSeriousBuy === true;
    return {
      ticker: item.ticker,
      model: "semiconductor_mid_cycle",
      fairValue: rounded(fairValue),
      seriousEligible,
      confidence: fairValue === null ? 20 : seriousEligible ? 80 : 50,
      reasons: fairValue === null ? [] : ["Five-year median profit and owner earnings reduce the risk of annualizing a peak semiconductor cycle."],
      blockers: seriousEligible ? [] : ["Five-year SEC normalization or stable positive mid-cycle cash generation is incomplete."],
    };
  }
  if (/\b(shipping|marine|oil|gas|steel|mining|metals|commodity|airline|chemicals)\b/.test(words)) {
    const normalizedFcf = normalization?.normalizedFreeCashFlow ?? null;
    const normalizedFcfPerShare = normalizedFcf !== null && shares && shares > 0 ? normalizedFcf / shares : null;
    const fairValue = normalizedFcfPerShare && normalizedFcfPerShare > 0 ? normalizedFcfPerShare / 0.09 : null;
    const seriousEligible = fairValue !== null && normalization?.durableEnoughForSeriousBuy === true;
    return {
      ticker: item.ticker,
      model: "cyclical_mid_cycle",
      fairValue: rounded(fairValue),
      seriousEligible,
      confidence: fairValue === null ? 20 : seriousEligible ? 75 : 45,
      reasons: fairValue === null ? [] : ["The estimate uses mid-cycle five-year owner earnings rather than the latest possibly peak year."],
      blockers: seriousEligible ? [] : ["Stable five-year cash generation is required before serious cyclical promotion."],
    };
  }
  if (/\b(biotech|biotechnology|pharmaceutical)\b/.test(words) && (item.fundamentals.netIncome ?? 0) <= 0) {
    return {
      ticker: item.ticker,
      model: "biotech_pipeline_required",
      fairValue: null,
      seriousEligible: false,
      confidence: 5,
      reasons: [],
      blockers: ["A probability-adjusted clinical pipeline, cash runway, dilution, patent, and regulatory model is required."],
    };
  }
  return {
    ticker: item.ticker,
    model: "general",
    fairValue: item.fairValue.baseValue,
    seriousEligible: true,
    confidence: item.scores.fairValueConfidence,
    reasons: ["The ordinary company model is applicable."],
    blockers: [],
  };
}

function officialReceiptConfirmed(candidate: Json) {
  return array(candidate.receipts).map(object).some((receipt) =>
    receipt.official === true
    || receipt.primarySource === true
    || text(receipt.channel) === "sec_current_filings"
  );
}

function recentCandidate(candidate: Json, now: Date, maximumDays = 7) {
  const observedAt = text(candidate.eventObservedAt);
  if (!observedAt) return false;
  const age = now.getTime() - Date.parse(observedAt);
  return age >= 0 && age <= maximumDays * 86_400_000;
}

function eventGatePassed(candidate: Json) {
  const committee = committeeApprovalFromCandidate(candidate);
  return committee.approved
    && committee.actionable
    && candidate.gatePassed === true
    && (finite(candidate.eventTruth) ?? 0) >= 80
    && (finite(candidate.mappingConfidence) ?? 0) >= 95
    && (finite(candidate.materiality) ?? 0) >= 65
    && (finite(candidate.transmissionConfidence) ?? 0) >= 70
    && (finite(candidate.evidenceIndependence) ?? 0) >= 78
    && candidate.rumour !== true
    && (finite(candidate.contradictionPenalty) ?? 0) < 50
    && (finite(candidate.pricedInPenalty) ?? 0) < 50
    && object(candidate.quote).actionableForSeriousSignal === true
    && !["halted", "unknown"].includes(text(object(candidate.quote).marketSession) ?? "unknown");
}

function methodSpreadPercent(item: UsValueCompanyAnalysis) {
  const values = item.fairValue.methods.map((method) => method.value).filter((value) => Number.isFinite(value) && value > 0);
  if (values.length < 2 || !item.fairValue.baseValue) return null;
  return (Math.max(...values) - Math.min(...values)) / item.fairValue.baseValue * 100;
}

function potentialPercent(action: SignalAction, price: number | null, fairValue: number | null) {
  if (price === null || fairValue === null || price <= 0) return null;
  return action === "sell" ? (fairValue / price - 1) * 100 : (fairValue / price - 1) * 100;
}

function signalFingerprint(input: {
  source: SignalSource;
  action: SignalAction;
  ticker: string;
  currentPrice: number | null;
  baseFairValue: number | null;
  eventKey?: string | null;
}) {
  const ratio = input.currentPrice && input.baseFairValue
    ? Math.round((input.currentPrice / input.baseFairValue) * 20) / 20
    : 0;
  return crypto.createHash("sha256")
    .update(`${input.source}|${input.action}|${input.ticker.toUpperCase()}|${ratio.toFixed(2)}|${input.eventKey ?? ""}`)
    .digest("hex")
    .slice(0, 24);
}

function makeSignal(input: {
  source: SignalSource;
  action: SignalAction;
  item: UsValueCompanyAnalysis;
  currentPrice: number | null;
  confidence: number;
  regime: MarketRegime;
  reasons: string[];
  blockers?: string[];
  officialSourceConfirmed: boolean;
  secDiligenceConfirmed: boolean;
  priceCrossChecked: boolean;
  historicalContextAvailable: boolean | null;
  normalization: LongTermNormalization | null;
  specialist: SpecialistValuation;
  eventKey?: string | null;
  checkedAt: string;
  committee?: CommitteeApproval;
}): ActiveSeriousSignal {
  const baseFairValue = input.specialist.fairValue ?? input.item.fairValue.baseValue;
  return {
    fingerprint: signalFingerprint({
      source: input.source,
      action: input.action,
      ticker: input.item.ticker,
      currentPrice: input.currentPrice,
      baseFairValue,
      eventKey: input.eventKey,
    }),
    ticker: input.item.ticker,
    company: input.item.company,
    action: input.action,
    status: "new",
    source: input.source,
    firstSeenAt: input.checkedAt,
    lastSeenAt: input.checkedAt,
    currentPrice: rounded(input.currentPrice),
    conservativeFairValue: input.item.fairValue.conservativeValue,
    baseFairValue: rounded(baseFairValue),
    optimisticFairValue: input.item.fairValue.optimisticValue,
    potentialPercent: rounded(potentialPercent(input.action, input.currentPrice, baseFairValue)),
    qualityScore: input.item.scores.businessQuality,
    riskScore: input.item.scores.risk,
    confidenceScore: Math.round(clamp(input.confidence, 0, 100)),
    marketRegime: input.regime.label,
    reasons: input.reasons,
    blockers: input.blockers ?? [],
    evidence: {
      officialSourceConfirmed: input.officialSourceConfirmed,
      secDiligenceConfirmed: input.secDiligenceConfirmed,
      priceCrossChecked: input.priceCrossChecked,
      historicalContextAvailable: input.historicalContextAvailable,
      longTermNormalizationPassed: input.normalization?.durableEnoughForSeriousBuy ?? null,
      specialistModel: input.specialist.model,
      committeeApproved: input.committee?.approved === true,
      committeeAgentsCompleted: input.committee?.agentsCompleted ?? 0,
      committeeAgentsFailed: input.committee?.agentsFailed ?? 0,
      finalJudgePositive: input.committee?.finalJudgePositive === true,
      finalJudgeConfidence: input.committee?.finalJudgeConfidence ?? null,
    },
    thesisSnapshot: {
      baseFairValue: rounded(baseFairValue),
      qualityScore: input.item.scores.businessQuality,
      riskScore: input.item.scores.risk,
    },
  };
}

function thesisChange(item: UsValueCompanyAnalysis, priorSignals: ActiveSeriousSignal[]): ThesisChange {
  const prior = priorSignals
    .filter((signal) => signal.ticker.toUpperCase() === item.ticker.toUpperCase())
    .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt))[0];
  if (!prior) {
    return {
      ticker: item.ticker,
      priorBaseFairValue: null,
      currentBaseFairValue: item.fairValue.baseValue,
      fairValueChangePercent: null,
      qualityChange: null,
      riskChange: null,
      classification: "new",
      reasons: ["No prior stored thesis snapshot exists."],
    };
  }
  const priorFair = prior.thesisSnapshot.baseFairValue;
  const currentFair = item.fairValue.baseValue;
  const fairValueChange = priorFair && currentFair ? (currentFair / priorFair - 1) * 100 : null;
  const qualityChange = prior.thesisSnapshot.qualityScore === null
    ? null
    : item.scores.businessQuality - prior.thesisSnapshot.qualityScore;
  const riskChange = prior.thesisSnapshot.riskScore === null
    ? null
    : item.scores.risk - prior.thesisSnapshot.riskScore;
  let classification: ThesisChange["classification"] = "stable";
  const reasons: string[] = [];
  if ((fairValueChange ?? 0) >= 10 || (qualityChange ?? 0) >= 8 || (riskChange ?? 0) <= -10) {
    classification = "strengthened";
    reasons.push("Fair value or business quality improved materially.");
  } else if ((fairValueChange ?? 0) <= -10 || (qualityChange ?? 0) <= -8 || (riskChange ?? 0) >= 10) {
    classification = "weakened";
    reasons.push("Fair value or business quality deteriorated materially.");
  } else reasons.push("The stored investment thesis remains broadly stable.");
  return {
    ticker: item.ticker,
    priorBaseFairValue: priorFair,
    currentBaseFairValue: currentFair,
    fairValueChangePercent: rounded(fairValueChange),
    qualityChange,
    riskChange,
    classification,
    reasons,
  };
}

function mergeRegistry(
  currentSignals: ActiveSeriousSignal[],
  previous: ActiveRegistry | null,
  checkedAt: string,
) {
  const previousSignals = previous?.signals ?? [];
  const byIdentity = new Map(previousSignals.map((signal) => [`${signal.action}|${signal.ticker}|${signal.source}`, signal]));
  const seen = new Set<string>();
  const merged: ActiveSeriousSignal[] = [];
  for (const signal of currentSignals) {
    const identity = `${signal.action}|${signal.ticker}|${signal.source}`;
    seen.add(identity);
    const prior = byIdentity.get(identity);
    if (!prior) {
      merged.push(signal);
      continue;
    }
    const priorPotential = Math.abs(prior.potentialPercent ?? 0);
    const currentPotential = Math.abs(signal.potentialPercent ?? 0);
    const status: SignalStatus = currentPotential >= priorPotential + 5 || signal.confidenceScore >= prior.confidenceScore + 5
      ? "strengthened"
      : currentPotential + 5 < priorPotential || signal.confidenceScore + 5 < prior.confidenceScore
        ? "weakened"
        : "active";
    merged.push({
      ...signal,
      status,
      firstSeenAt: prior.firstSeenAt,
      lastSeenAt: checkedAt,
    });
  }
  for (const prior of previousSignals) {
    const identity = `${prior.action}|${prior.ticker}|${prior.source}`;
    if (seen.has(identity)) continue;
    merged.push({
      ...prior,
      status: prior.status === "invalidated" ? "invalidated" : "resolved",
      lastSeenAt: checkedAt,
      reasons: [...prior.reasons, "The latest scan no longer satisfies every serious-signal gate."],
    });
  }
  return merged
    .sort((left, right) => {
      const statusRank: Record<SignalStatus, number> = {
        new: 6,
        strengthened: 5,
        active: 4,
        weakened: 3,
        resolved: 2,
        invalidated: 1,
      };
      const actionRank: Record<SignalAction, number> = { buy: 3, watch_out: 2, sell: 1 };
      return statusRank[right.status] - statusRank[left.status]
        || actionRank[right.action] - actionRank[left.action]
        || right.confidenceScore - left.confidenceScore;
    })
    .slice(0, ACTIVE_SIGNAL_LIMIT);
}

function parsePriorRegistry(value: unknown): ActiveRegistry | null {
  const parsed = object(value);
  if (parsed.version !== 1 || parsed.branch !== BRANCH || !Array.isArray(parsed.signals)) return null;
  return parsed as unknown as ActiveRegistry;
}

function eventKey(candidate: Json) {
  return text(candidate.evidenceFingerprint)
    ?? text(candidate.eventObservedAt)
    ?? text(candidate.eventHeadline)
    ?? null;
}

export async function runUsSignalOperations(input: {
  fetchImpl?: typeof fetch;
  now?: Date;
} = {}): Promise<UsSignalOperationsReport> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? new Date();
  const checkedAt = now.toISOString();
  const errors: string[] = [];
  if (!getR2Config().configured) throw new Error("cloudflare_r2_not_configured");

  const [resumableState, priorRegistryValue, branchHistory, eventJobHistory, diligenceValue, watchOutValue] = await Promise.all([
    readResumableUsValueState(),
    readJson(REGISTRY_KEY).catch(() => null),
    readJson(BRANCH_LAB_STATE_KEY).catch(() => null),
    readJson(EVENT_JOB_STATE_KEY).catch(() => null),
    readJson(DILIGENCE_KEY).catch(() => null),
    readJson(WATCH_OUT_KEY).catch(() => null),
  ]);
  const priorRegistry = parsePriorRegistry(priorRegistryValue);
  const analyses = await loadCompletedAnalyses(resumableState);
  const analysisByTicker = new Map(analyses.map((item) => [item.ticker.toUpperCase(), item]));
  const combinedEventHistory = {
    runs: [
      ...array(object(branchHistory).runs),
      ...array(object(eventJobHistory).runs),
    ],
  };
  const recentEvents = parseEventCandidates(combinedEventHistory)
    .filter((candidate) => recentCandidate(candidate, now, 14));
  const diligence = diligenceConfirmation(diligenceValue);

  const priorityAnalyses = quotePriority(analyses, priorRegistry, recentEvents);
  let quotes = new Map<string, Quote>();
  try {
    quotes = await fetchTradingViewQuotes(priorityAnalyses, fetchImpl, checkedAt);
  } catch (error) {
    errors.push(safeError(error));
  }

  const regime = await buildMarketRegime(fetchImpl, checkedAt).catch((error) => {
    errors.push(`market_regime:${safeError(error)}`);
    return {
      label: "neutral",
      checkedAt,
      spyFiveDayReturnPercent: null,
      qqqFiveDayReturnPercent: null,
      spyAboveTwentyDayAverage: null,
      qqqAboveTwentyDayAverage: null,
      buyPriorityMultiplier: 1,
      thresholdPolicy: "never_lower_core_margin_of_safety",
    } as MarketRegime;
  });

  const eventTickers = new Set(recentEvents.map((candidate) => text(candidate.ticker)?.toUpperCase()).filter((item): item is string => Boolean(item)));
  const normalizationPriorities = priorityAnalyses
    .filter((item) => item.decision.tier === "serious_foundation_buy"
      || item.decision.tier === "quality_price_watchlist"
      || eventTickers.has(item.ticker.toUpperCase()))
    .sort((left, right) => {
      const leftQuote = quotes.get(left.ticker.toUpperCase())?.price ?? left.currentPrice;
      const rightQuote = quotes.get(right.ticker.toUpperCase())?.price ?? right.currentPrice;
      const leftDistance = left.fairValue.buyBelowPrice ? leftQuote / left.fairValue.buyBelowPrice : Infinity;
      const rightDistance = right.fairValue.buyBelowPrice ? rightQuote / right.fairValue.buyBelowPrice : Infinity;
      return leftDistance - rightDistance || right.scores.businessQuality - left.scores.businessQuality;
    });

  const universe = await loadEquityUniverse(fetchImpl, now).catch((error) => {
    errors.push(`universe:${safeError(error)}`);
    return null;
  });
  const cikByTicker = new Map((universe?.snapshot.entries ?? []).flatMap((entry) =>
    entry.cik ? [[entry.ticker.toUpperCase(), entry.cik] as const] : []
  ));
  const normalizationMap = new Map<string, LongTermNormalization>();
  let freshNormalizations = 0;
  for (const item of normalizationPriorities.slice(0, 40)) {
    const cik = cikByTicker.get(item.ticker.toUpperCase());
    if (!cik) continue;
    try {
      const normalization = await loadOrBuildNormalization(
        item.ticker,
        cik,
        now,
        fetchImpl,
        freshNormalizations < MAX_FRESH_SEC_NORMALIZATIONS,
      );
      if (normalization) {
        normalizationMap.set(item.ticker.toUpperCase(), normalization);
        if (normalization.observedAt === checkedAt) freshNormalizations += 1;
      }
    } catch (error) {
      errors.push(`normalization:${item.ticker}:${safeError(error)}`);
    }
  }

  const specialistMap = new Map<string, SpecialistValuation>();
  for (const item of priorityAnalyses) {
    specialistMap.set(item.ticker.toUpperCase(), specialistModel(item, normalizationMap.get(item.ticker.toUpperCase()) ?? null));
  }
  const specialistValuations = [...specialistMap.values()];
  await writeVersionedJsonToR2(`${SPECIALIST_PREFIX}/latest.json`, {
    version: 1,
    checkedAt,
    valuations: specialistValuations,
  }).catch((error) => errors.push(`specialist_persist:${safeError(error)}`));

  const thresholdCrossers = priorityAnalyses.filter((item) => {
    const price = quotes.get(item.ticker.toUpperCase())?.price ?? item.currentPrice;
    const specialist = specialistMap.get(item.ticker.toUpperCase());
    const base = specialist?.fairValue ?? item.fairValue.baseValue;
    const strongBuy = item.fairValue.strongBuyBelowPrice ?? (base ? base * 0.7 : null);
    const sellLevel = item.fairValue.trimAbovePrice ?? (base ? base * 1.5 : null);
    return (strongBuy !== null && price <= strongBuy)
      || (sellLevel !== null && price >= sellLevel)
      || eventTickers.has(item.ticker.toUpperCase());
  });
  const priceCrossChecks = await crossCheckPrices(
    thresholdCrossers.map((item) => ({
      ticker: item.ticker,
      price: quotes.get(item.ticker.toUpperCase())?.price ?? item.currentPrice,
    })),
    fetchImpl,
  );

  const currentSignals: ActiveSeriousSignal[] = [];
  const buyNearMisses: UsSignalOperationsReport["buyFocus"]["nearMisses"] = [];
  const seriousWatchTickers = new Set<string>();
  for (const raw of watchOutSignals(watchOutValue)) {
    const ticker = text(raw.ticker)?.toUpperCase();
    if (!ticker) continue;
    seriousWatchTickers.add(ticker);
    const item = analysisByTicker.get(ticker);
    if (!item) continue;
    const quote = quotes.get(ticker);
    const price = finite(raw.currentPrice) ?? quote?.price ?? item.currentPrice;
    const specialist = specialistMap.get(ticker) ?? specialistModel(item, normalizationMap.get(ticker) ?? null);
    currentSignals.push(makeSignal({
      source: "market_watch_out",
      action: "watch_out",
      item,
      currentPrice: price,
      confidence: finite(raw.riskScore) ?? item.scores.risk,
      regime,
      reasons: array(raw.reasons).flatMap((reason) => text(reason) ?? []),
      officialSourceConfirmed: true,
      secDiligenceConfirmed: diligence.watchOut.has(ticker),
      priceCrossChecked: true,
      historicalContextAvailable: null,
      normalization: normalizationMap.get(ticker) ?? null,
      specialist,
      eventKey: text(raw.duplicateKey) ?? text(raw.ruleId),
      checkedAt,
    }));
  }

  for (const item of priorityAnalyses) {
    const ticker = item.ticker.toUpperCase();
    const quote = quotes.get(ticker);
    const currentPrice = quote?.price ?? item.currentPrice;
    const crossCheck = priceCrossChecks.get(ticker);
    const normalization = normalizationMap.get(ticker) ?? null;
    const specialist = specialistMap.get(ticker) ?? specialistModel(item, normalization);
    const baseFairValue = specialist.fairValue ?? item.fairValue.baseValue;
    const spread = methodSpreadPercent(item);
    const generalModelOkay = specialist.model === "general" || specialist.seriousEligible;
    const commonBuyQuality = item.scores.businessQuality >= 75
      && item.scores.balanceSheet >= 60
      && item.scores.risk <= 45
      && item.scores.fairValueConfidence >= 75
      && item.fairValue.methods.length >= 2
      && (spread ?? Infinity) <= 60
      && (item.fundamentals.netIncome ?? 0) > 0
      && (item.fundamentals.freeCashFlow ?? 0) > 0
      && generalModelOkay
      && !seriousWatchTickers.has(ticker);
    const secBuyConfirmed = diligence.buy.has(ticker) || normalization?.buyQualityConfirmed === true;
    const priceConfirmed = crossCheck?.passed === true;
    const strongBuyBelow = item.fairValue.strongBuyBelowPrice ?? (baseFairValue ? baseFairValue * 0.7 : null);
    const priceThresholdBuy = commonBuyQuality
      && secBuyConfirmed
      && priceConfirmed
      && strongBuyBelow !== null
      && currentPrice <= strongBuyBelow
      && (specialist.model === "general" || normalization?.durableEnoughForSeriousBuy === true);
    if (priceThresholdBuy) {
      currentSignals.push(makeSignal({
        source: "price_threshold",
        action: "buy",
        item,
        currentPrice,
        confidence: Math.min(95, item.scores.fairValueConfidence + 10),
        regime,
        reasons: [
          `The live price $${currentPrice.toFixed(2)} crossed the strong-buy threshold $${strongBuyBelow!.toFixed(2)}.`,
          "Business quality, balance sheet, valuation agreement, SEC diligence, and independent price checks all passed.",
          "The market regime changes priority, not the core margin-of-safety threshold.",
        ],
        officialSourceConfirmed: true,
        secDiligenceConfirmed: true,
        priceCrossChecked: true,
        historicalContextAvailable: null,
        normalization,
        specialist,
        checkedAt,
      }));
    }

    if (item.decision.tier === "serious_foundation_buy" && secBuyConfirmed && priceConfirmed && commonBuyQuality) {
      currentSignals.push(makeSignal({
        source: "foundation_value",
        action: "buy",
        item,
        currentPrice,
        confidence: item.scores.fairValueConfidence,
        regime,
        reasons: item.decision.reasons,
        officialSourceConfirmed: true,
        secDiligenceConfirmed: true,
        priceCrossChecked: true,
        historicalContextAvailable: null,
        normalization,
        specialist,
        checkedAt,
      }));
    }

    const revenueAcceleration = Math.max(
      item.fundamentals.revenueGrowthTtmPercent ?? -Infinity,
      item.fundamentals.revenueGrowthFyPercent ?? -Infinity,
    );
    const earningsAcceleration = Math.max(
      item.fundamentals.netIncomeGrowthTtmPercent ?? -Infinity,
      item.fundamentals.epsGrowthTtmPercent ?? -Infinity,
    );
    const accelerationUpside = baseFairValue ? (baseFairValue / currentPrice - 1) * 100 : null;
    const actualFundamentalAcceleration = commonBuyQuality
      && secBuyConfirmed
      && priceConfirmed
      && normalization?.buyQualityConfirmed === true
      && revenueAcceleration >= 12
      && earningsAcceleration >= 15
      && item.scores.businessQuality >= 80
      && item.scores.risk <= 40
      && (accelerationUpside ?? -Infinity) >= 10;
    if (actualFundamentalAcceleration) {
      currentSignals.push(makeSignal({
        source: "fundamental_acceleration",
        action: "buy",
        item,
        currentPrice,
        confidence: Math.min(96, Math.round(
          item.scores.fairValueConfidence * 0.55
          + Math.min(100, revenueAcceleration * 2) * 0.2
          + Math.min(100, earningsAcceleration * 1.5) * 0.15
          + item.scores.businessQuality * 0.1
        )),
        regime,
        reasons: [
          `Revenue growth is running at ${revenueAcceleration.toFixed(1)}% and earnings growth at ${earningsAcceleration.toFixed(1)}%.`,
          "Five-year SEC cash-flow, profit durability, cash, debt, and asset checks passed without relying on an analyst estimate.",
          `The independently checked price remains ${(accelerationUpside ?? 0).toFixed(1)}% below normalized base fair value.`,
          "This lane exists so a missed news headline cannot hide a real improvement in the business.",
        ],
        officialSourceConfirmed: true,
        secDiligenceConfirmed: true,
        priceCrossChecked: true,
        historicalContextAvailable: null,
        normalization,
        specialist,
        checkedAt,
      }));
    }

    if (item.decision.tier === "serious_foundation_sell" && diligence.sell.has(ticker) && priceConfirmed) {
      currentSignals.push(makeSignal({
        source: "foundation_value",
        action: "sell",
        item,
        currentPrice,
        confidence: item.scores.fairValueConfidence,
        regime,
        reasons: item.decision.reasons,
        officialSourceConfirmed: true,
        secDiligenceConfirmed: true,
        priceCrossChecked: true,
        historicalContextAvailable: null,
        normalization,
        specialist,
        checkedAt,
      }));
    }

    if (item.decision.tier === "serious_foundation_watch_out" && diligence.watchOut.has(ticker)) {
      currentSignals.push(makeSignal({
        source: "foundation_value",
        action: "watch_out",
        item,
        currentPrice,
        confidence: item.scores.risk,
        regime,
        reasons: item.decision.reasons,
        officialSourceConfirmed: true,
        secDiligenceConfirmed: true,
        priceCrossChecked: crossCheck?.passed ?? false,
        historicalContextAvailable: null,
        normalization,
        specialist,
        checkedAt,
      }));
    }

    const buyBelow = item.fairValue.buyBelowPrice ?? (baseFairValue ? baseFairValue * 0.75 : null);
    if (!priceThresholdBuy && item.scores.businessQuality >= 70 && buyNearMisses.length < 100) {
      const blockers = [
        ...(!secBuyConfirmed ? ["SEC buy-quality diligence has not confirmed this company in the current rotation."] : []),
        ...(!priceConfirmed ? ["Independent live-price agreement has not passed."] : []),
        ...(!commonBuyQuality ? ["One or more quality, balance-sheet, valuation-agreement, profit, or risk gates are below the serious Buy standard."] : []),
        ...(buyBelow !== null && currentPrice > buyBelow ? [`Price remains above the preferred buy-below level $${buyBelow.toFixed(2)}.`] : []),
        ...(specialist.model !== "general" && !specialist.seriousEligible ? specialist.blockers : []),
      ];
      buyNearMisses.push({
        ticker: item.ticker,
        company: item.company,
        currentPrice: rounded(currentPrice),
        buyBelowPrice: rounded(buyBelow),
        baseFairValue: rounded(baseFairValue),
        blockers: [...new Set(blockers)],
      });
    }
  }

  const earningsEventTickers = [...new Set(recentEvents
    .filter((candidate) => text(candidate.eventFamily) === "earnings_guidance" && text(candidate.direction) === "upside")
    .map((candidate) => text(candidate.ticker)?.toUpperCase())
    .filter((ticker): ticker is string => Boolean(ticker)))].slice(0, 8);
  const earningsSurpriseRows = await mapWithConcurrency(
    earningsEventTickers,
    2,
    (ticker) => fetchEarningsSurprise(ticker, fetchImpl, now),
  );
  const earningsSurprises = new Map(earningsSurpriseRows.map((row) => [row.ticker.toUpperCase(), row]));

  let earningsBridgeCandidates = 0;
  for (const candidate of recentEvents) {
    if (text(candidate.eventFamily) !== "earnings_guidance" || text(candidate.direction) !== "upside") continue;
    const ticker = text(candidate.ticker)?.toUpperCase();
    if (!ticker) continue;
    const item = analysisByTicker.get(ticker);
    if (!item) continue;
    earningsBridgeCandidates += 1;
    const currentPrice = quotes.get(ticker)?.price ?? item.currentPrice;
    const crossCheck = priceCrossChecks.get(ticker);
    const normalization = normalizationMap.get(ticker) ?? null;
    const specialist = specialistMap.get(ticker) ?? specialistModel(item, normalization);
    const baseFairValue = specialist.fairValue ?? item.fairValue.baseValue;
    const upside = baseFairValue ? (baseFairValue / currentPrice - 1) * 100 : null;
    const official = officialReceiptConfirmed(candidate);
    const eventPassed = eventGatePassed(candidate);
    const secBuyConfirmed = diligence.buy.has(ticker) || normalization?.buyQualityConfirmed === true;
    const normalizedOkay = specialist.model === "general"
      ? normalization === null || normalization.durableEnoughForSeriousBuy
      : specialist.seriousEligible && normalization?.durableEnoughForSeriousBuy === true;
    const surprise = earningsSurprises.get(ticker) ?? null;
    const surpriseSupports = surprise?.passedPositiveSurprise !== false;
    const earningsValueBuy = official
      && eventPassed
      && surpriseSupports
      && secBuyConfirmed
      && crossCheck?.passed === true
      && item.scores.businessQuality >= 80
      && item.scores.risk <= 40
      && item.scores.fairValueConfidence >= 75
      && item.fairValue.methods.length >= 2
      && (methodSpreadPercent(item) ?? Infinity) <= 60
      && (upside ?? -Infinity) >= 15
      && normalizedOkay
      && !seriousWatchTickers.has(ticker);
    if (earningsValueBuy) {
      currentSignals.push(makeSignal({
        source: "earnings_value_bridge",
        action: "buy",
        item,
        currentPrice,
        confidence: Math.min(97, Math.round(
          item.scores.fairValueConfidence * 0.5
          + (finite(candidate.eventTruth) ?? 0) * 0.2
          + (finite(candidate.materiality) ?? 0) * 0.15
          + (finite(candidate.evidenceIndependence) ?? 0) * 0.15
          + (surprise?.passedPositiveSurprise === true ? 5 : 0)
        )),
        regime,
        reasons: [
          "A fresh official earnings or guidance event strengthened the business thesis.",
          ...(surprise?.surprisePercent !== null && surprise?.surprisePercent !== undefined
            ? [`Reported EPS beat the available consensus estimate by ${surprise.surprisePercent.toFixed(1)}%.`]
            : ["No dependable consensus-surprise figure was available, so consensus was not invented or used as a veto."]),
          `The independently checked price remains ${(upside ?? 0).toFixed(1)}% below the normalized base fair value after the event.`,
          "This is a foundation-value Buy strengthened by earnings; it does not bypass valuation, balance-sheet, cash-flow, or diligence requirements.",
        ],
        officialSourceConfirmed: true,
        secDiligenceConfirmed: true,
        priceCrossChecked: true,
        historicalContextAvailable: null,
        normalization,
        specialist,
        eventKey: eventKey(candidate),
        checkedAt,
      }));
    }
  }

  for (const candidate of recentEvents) {
    if (!eventGatePassed(candidate)) continue;
    const ticker = text(candidate.ticker)?.toUpperCase();
    const direction = text(candidate.direction);
    if (!ticker || !["upside", "downside"].includes(direction ?? "")) continue;
    const item = analysisByTicker.get(ticker);
    if (!item) continue;
    const pilot = evaluateFiveCasePilotGate(candidate);
    const crossCheck = priceCrossChecks.get(ticker);
    if (crossCheck?.passed !== true) continue;
    const action: SignalAction = direction === "upside" ? "buy" : "sell";
    const specialist = specialistMap.get(ticker) ?? specialistModel(item, normalizationMap.get(ticker) ?? null);
    const committee = committeeApprovalFromCandidate(candidate);
    currentSignals.push(makeSignal({
      source: "event_pilot",
      action,
      item,
      currentPrice: crossCheck.tradingViewPrice,
      confidence: Math.min(95, Math.round(
        (finite(candidate.eventTruth) ?? 0) * 0.25
        + (finite(candidate.mappingConfidence) ?? 0) * 0.15
        + (finite(candidate.materiality) ?? 0) * 0.15
        + (finite(candidate.transmissionConfidence) ?? 0) * 0.15
        + (finite(candidate.evidenceIndependence) ?? 0) * 0.15
        + (committee.finalJudgeConfidence ?? 0) * 0.15
      )),
      regime,
      reasons: [
        text(candidate.eventHeadline) ?? "Verified event-driven opportunity.",
        pilot.reportedSampleSize > 0 || pilot.independentRealEventCount > 0
          ? `Historical analogues are available as optional context (${Math.max(pilot.reportedSampleSize, pilot.independentRealEventCount)} records); they did not grant or veto this signal.`
          : "No historical analogue was required; verified current evidence and the full Committee supplied decision authority.",
        "Historical outcomes remain learning and calibration context only.",
      ],
      officialSourceConfirmed: officialReceiptConfirmed(candidate),
      secDiligenceConfirmed: action === "buy" ? diligence.buy.has(ticker) : diligence.sell.has(ticker),
      priceCrossChecked: true,
      historicalContextAvailable: pilot.reportedSampleSize > 0 || pilot.independentRealEventCount > 0,
      normalization: normalizationMap.get(ticker) ?? null,
      specialist,
      eventKey: eventKey(candidate),
      checkedAt,
      committee,
    }));
  }

  const deduplicatedCurrent = [...new Map(currentSignals.map((signal) => [
    `${signal.action}|${signal.ticker}|${signal.source}`,
    signal,
  ])).values()];
  const mergedSignals = mergeRegistry(deduplicatedCurrent, priorRegistry, checkedAt);
  const activeRegistry: ActiveRegistry = {
    version: 1,
    branch: BRANCH,
    updatedAt: checkedAt,
    signals: mergedSignals,
  };
  await writeVersionedJsonToR2(REGISTRY_KEY, activeRegistry);

  const notificationSignals = mergedSignals.filter((signal) => ["new", "strengthened"].includes(signal.status));
  const notificationDigest = {
    version: 1,
    branch: BRANCH,
    checkedAt,
    signalCount: notificationSignals.length,
    signals: notificationSignals,
    deliveryEnabledInsideDraftBranch: false,
    readyForExternalConditionWatcher: true,
    priorityOrder: ["buy", "watch_out", "sell"],
    safety: { publishing: false, directUserNotifications: false, trades: false },
  };
  await writeVersionedJsonToR2(NOTIFICATION_DIGEST_KEY, notificationDigest);
  await writeVersionedJsonToR2(
    `${R2_PREFIX}/notification-digest/runs/${checkedAt.slice(0, 10)}/${dateKey(checkedAt)}.json`,
    notificationDigest,
    { createOnly: true },
  ).catch(() => {});

  const thesisChanges = priorityAnalyses.slice(0, 200).map((item) => thesisChange(item, priorRegistry?.signals ?? []));
  const seriousSignals = {
    buy: mergedSignals.filter((signal) => signal.action === "buy" && ["new", "active", "strengthened", "weakened"].includes(signal.status)),
    sell: mergedSignals.filter((signal) => signal.action === "sell" && ["new", "active", "strengthened", "weakened"].includes(signal.status)),
    watchOut: mergedSignals.filter((signal) => signal.action === "watch_out" && ["new", "active", "strengthened", "weakened"].includes(signal.status)),
  };
  const statusCount = (status: SignalStatus) => mergedSignals.filter((signal) => signal.status === status).length;
  const report: UsSignalOperationsReport = {
    version: 1,
    ok: analyses.length > 0 && errors.length === 0,
    mode: "pr262_us_serious_signal_operations",
    branch: BRANCH,
    checkedAt,
    runtime: {
      commitSha: process.env.RAILWAY_GIT_COMMIT_SHA?.trim() || null,
      deploymentId: process.env.RAILWAY_DEPLOYMENT_ID?.trim() || null,
    },
    marketRegime: regime,
    coverage: {
      totalStoredCompanies: resumableState?.totalCompanies ?? analyses.length,
      companiesLoadedFromR2Batches: analyses.length,
      priceCandidates: priorityAnalyses.length,
      liveQuotes: quotes.size,
      independentPriceCrossChecks: priceCrossChecks.size,
      recentEventCandidates: recentEvents.length,
      earningsSurprisesChecked: earningsSurprises.size,
      longTermNormalizations: normalizationMap.size,
      specialistValuations: specialistValuations.length,
    },
    buyFocus: {
      priority: true,
      priceThresholdCrossings: deduplicatedCurrent.filter((signal) => signal.source === "price_threshold" && signal.action === "buy").length,
      earningsValueBridgeCandidates: earningsBridgeCandidates,
      seriousBuys: seriousSignals.buy,
      nearMisses: buyNearMisses.sort((left, right) => {
        const leftGap = left.currentPrice && left.buyBelowPrice ? left.currentPrice / left.buyBelowPrice : Infinity;
        const rightGap = right.currentPrice && right.buyBelowPrice ? right.currentPrice / right.buyBelowPrice : Infinity;
        return leftGap - rightGap;
      }).slice(0, 50),
    },
    seriousSignals,
    activeRegistry: {
      key: REGISTRY_KEY,
      total: mergedSignals.length,
      new: statusCount("new"),
      strengthened: statusCount("strengthened"),
      weakened: statusCount("weakened"),
      resolved: statusCount("resolved"),
      invalidated: statusCount("invalidated"),
    },
    thesisChanges,
    notificationDigest: {
      key: NOTIFICATION_DIGEST_KEY,
      newSignalCount: notificationSignals.length,
      signals: notificationSignals,
      deliveryEnabledInsideDraftBranch: false,
      readyForExternalConditionWatcher: true,
    },
    longTermNormalization: [...normalizationMap.values()],
    specialistValuations,
    errors,
    safety: {
      databaseWrites: false,
      publishing: false,
      directUserNotifications: false,
      trades: false,
      productionWrites: false,
      nonUsScanning: false,
    },
  };
  await writeVersionedJsonToR2(LATEST_REPORT_KEY, report);
  await writeVersionedJsonToR2(
    `${R2_PREFIX}/runs/${checkedAt.slice(0, 10)}/${dateKey(checkedAt)}.json`,
    report,
    { createOnly: true },
  ).catch(() => {});
  return report;
}

export async function readLatestUsSignalOperationsReport() {
  return readJson(LATEST_REPORT_KEY);
}

export const US_SIGNAL_OPERATIONS_POLICY = Object.freeze({
  branch: BRANCH,
  buyPriority: true,
  activeSignalRegistry: true,
  notificationDigestConsumer: true,
  priceOnlyThresholdScanner: true,
  thesisChangeEngine: true,
  fundamentalAccelerationBridge: true,
  specialistValuationModels: true,
  megaCapCloudPlatformModel: true,
  fiveToTenYearNormalization: true,
  independentPriceCrossCheck: true,
  sectorAndMarketRegimeCalibration: true,
  historicalPilotProvidesOptionalContextOnly: true,
  analystExpectationsCanVetoBuy: false,
  publishing: false,
  directUserNotifications: false,
  trades: false,
});
