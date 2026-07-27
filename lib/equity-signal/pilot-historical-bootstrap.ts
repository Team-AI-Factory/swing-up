import crypto from "node:crypto";
import type {
  HistoricalAnalogHorizon,
  HistoricalSignalRecord,
} from "@/lib/equity-signal/historical-analogs";

export type PilotHistoricalBootstrapResult = {
  records: HistoricalSignalRecord[];
  requestedSeeds: number;
  builtSeeds: number;
  errors: string[];
  priceSource: "Yahoo Finance public adjusted daily chart history";
  noSyntheticData: true;
};

type PilotSeed = {
  id: string;
  ticker: string;
  eventFamily: "earnings_guidance";
  direction: "upside" | "downside";
  eventObservedAt: string;
  eventPublisher: string;
  eventSourceUrl: string;
  causalChain: string[];
};

type PriceBar = { observedAt: string; close: number };
type PriceSeries = { ticker: string; bars: PriceBar[] };

const BENCHMARK_TICKER = "SPY";
const SOURCE = "Yahoo Finance public adjusted daily chart history" as const;
const METHODOLOGY_VERSION = "us-five-case-pilot-official-events-adjusted-prices-v1";
const HORIZONS: Array<{ label: HistoricalAnalogHorizon; milliseconds: number }> = [
  { label: "1D", milliseconds: 24 * 60 * 60 * 1000 },
  { label: "3D", milliseconds: 3 * 24 * 60 * 60 * 1000 },
  { label: "7D", milliseconds: 7 * 24 * 60 * 60 * 1000 },
  { label: "30D", milliseconds: 30 * 24 * 60 * 60 * 1000 },
  { label: "90D", milliseconds: 90 * 24 * 60 * 60 * 1000 },
];

// Official event facts only. Returns and benchmark-relative outcomes are rebuilt
// from public adjusted daily price history at runtime; no performance values are
// hard-coded in this catalog.
const PILOT_SEEDS: PilotSeed[] = [
  {
    id: "nvda-2024-02-21-record-results-outlook",
    ticker: "NVDA",
    eventFamily: "earnings_guidance",
    direction: "upside",
    eventObservedAt: "2024-02-21T23:59:59.000Z",
    eventPublisher: "NVIDIA Newsroom",
    eventSourceUrl: "https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-fourth-quarter-and-fiscal-2024",
    causalChain: ["record quarterly results", "strong next-quarter revenue outlook", "higher expected earnings and cash flow"],
  },
  {
    id: "nvda-2024-05-22-record-results-outlook",
    ticker: "NVDA",
    eventFamily: "earnings_guidance",
    direction: "upside",
    eventObservedAt: "2024-05-22T23:59:59.000Z",
    eventPublisher: "NVIDIA Newsroom",
    eventSourceUrl: "https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-first-quarter-fiscal-2025",
    causalChain: ["record revenue and data-centre growth", "continued strong outlook", "higher expected earnings and cash flow"],
  },
  {
    id: "meta-2024-02-01-results-dividend-buyback",
    ticker: "META",
    eventFamily: "earnings_guidance",
    direction: "upside",
    eventObservedAt: "2024-02-01T23:59:59.000Z",
    eventPublisher: "Meta Investor Relations",
    eventSourceUrl: "https://investor.atmeta.com/investor-news/press-release-details/2024/Meta-Reports-Fourth-Quarter-and-Full-Year-2023-Results-Initiates-Quarterly-Dividend/default.aspx",
    causalChain: ["strong revenue and margin growth", "capital return increased", "higher per-share cash-flow value"],
  },
  {
    id: "fdx-2023-09-20-improved-profit-outlook",
    ticker: "FDX",
    eventFamily: "earnings_guidance",
    direction: "upside",
    eventObservedAt: "2023-09-20T23:59:59.000Z",
    eventPublisher: "FedEx Investor Relations",
    eventSourceUrl: "https://investors.fedex.com/news-and-events/investor-news/investor-news-details/2023/FedEx-Reports-Higher-First-Quarter-Diluted-EPS-of-4.23-and-Adjusted-Diluted-EPS-of-4.55/default.aspx",
    causalChain: ["better-than-expected profitability", "full-year adjusted earnings outlook increased", "higher expected cash flow"],
  },
  {
    id: "wmt-2022-07-25-profit-outlook-cut",
    ticker: "WMT",
    eventFamily: "earnings_guidance",
    direction: "downside",
    eventObservedAt: "2022-07-25T23:59:59.000Z",
    eventPublisher: "Walmart Investor Relations",
    eventSourceUrl: "https://stock.walmart.com/sec-filings/all-sec-filings/content/0000104169-22-000058/exhibit991-pressrelease.htm",
    causalChain: ["profit outlook lowered", "markdown and product-mix pressure", "lower expected earnings and margin"],
  },
  {
    id: "intc-2022-07-28-results-guidance-cut",
    ticker: "INTC",
    eventFamily: "earnings_guidance",
    direction: "downside",
    eventObservedAt: "2022-07-28T23:59:59.000Z",
    eventPublisher: "Intel Investor Relations",
    eventSourceUrl: "https://www.intc.com/news-events/press-releases/detail/1563/intel-reports-second-quarter-2022-financial-results",
    causalChain: ["results below company standards", "full-year revenue guidance reduced", "lower expected earnings and margin"],
  },
  {
    id: "fdx-2022-09-22-margin-profit-pressure",
    ticker: "FDX",
    eventFamily: "earnings_guidance",
    direction: "downside",
    eventObservedAt: "2022-09-22T23:59:59.000Z",
    eventPublisher: "FedEx Investor Relations",
    eventSourceUrl: "https://investors.fedex.com/news-and-events/investor-news/investor-news-details/2022/FedEx-Corp.-Reports-First-Quarter-Results/default.aspx",
    causalChain: ["operating income and margin declined", "cost actions required", "lower near-term earnings quality"],
  },
  {
    id: "snap-2022-07-21-weak-q2-results",
    ticker: "SNAP",
    eventFamily: "earnings_guidance",
    direction: "downside",
    eventObservedAt: "2022-07-21T23:59:59.000Z",
    eventPublisher: "Snap Investor Relations",
    eventSourceUrl: "https://investor.snap.com/news/news-details/2022/Snap-Inc.-Announces-Second-Quarter-2022-Financial-Results/default.aspx",
    causalChain: ["revenue growth slowed", "negative operating and free cash flow", "lower expected earnings quality"],
  },
];

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" && value.trim() && Number.isFinite(Number(value))
      ? Number(value)
      : null;
}

function safeTimestamp(value: unknown) {
  const seconds = finiteNumber(value);
  if (seconds === null) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function dateKey(value: string) {
  return value.slice(0, 10);
}

function seedEventKey(seed: PilotSeed) {
  return crypto.createHash("sha256").update(`pilot-bootstrap|${seed.id}`).digest("hex").slice(0, 20);
}

async function yahooSeries(ticker: string, fetchImpl: typeof fetch, now: Date): Promise<PriceSeries> {
  const tickerSeeds = PILOT_SEEDS.filter((seed) => seed.ticker === ticker);
  const earliestEvent = ticker === BENCHMARK_TICKER
    ? Math.min(...PILOT_SEEDS.map((seed) => Date.parse(seed.eventObservedAt)))
    : Math.min(...tickerSeeds.map((seed) => Date.parse(seed.eventObservedAt)));
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`);
  url.searchParams.set("interval", "1d");
  url.searchParams.set("period1", String(Math.floor((earliestEvent - 10 * 86_400_000) / 1000)));
  url.searchParams.set("period2", String(Math.floor(now.getTime() / 1000)));
  url.searchParams.set("events", "div,splits");
  url.searchParams.set("includeAdjustedClose", "true");
  const response = await fetchImpl(url, {
    headers: { Accept: "application/json", "user-agent": "SwingUp/1.0 support@swingup.app" },
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`yahoo_history_http_${response.status}:${ticker}`);
  const body = await response.json() as { chart?: { result?: Array<Record<string, unknown>> } };
  const chart = body.chart?.result?.[0];
  if (!chart) throw new Error(`yahoo_history_empty_or_malformed:${ticker}`);
  const timestamps = Array.isArray(chart.timestamp) ? chart.timestamp : [];
  const indicators = chart.indicators && typeof chart.indicators === "object" ? chart.indicators as Record<string, unknown> : {};
  const adjustedGroups = Array.isArray(indicators.adjclose) ? indicators.adjclose : [];
  const adjusted = adjustedGroups[0] && typeof adjustedGroups[0] === "object" && Array.isArray((adjustedGroups[0] as Record<string, unknown>).adjclose)
    ? (adjustedGroups[0] as Record<string, unknown>).adjclose as unknown[]
    : [];
  const quoteGroups = Array.isArray(indicators.quote) ? indicators.quote : [];
  const closes = quoteGroups[0] && typeof quoteGroups[0] === "object" && Array.isArray((quoteGroups[0] as Record<string, unknown>).close)
    ? (quoteGroups[0] as Record<string, unknown>).close as unknown[]
    : [];
  const bars = timestamps.flatMap((rawTimestamp, index): PriceBar[] => {
    const observedAt = safeTimestamp(rawTimestamp);
    const close = finiteNumber(adjusted[index] ?? closes[index]);
    return observedAt && close !== null && close > 0 ? [{ observedAt, close }] : [];
  }).sort((left, right) => left.observedAt.localeCompare(right.observedAt));
  if (bars.length < 2) throw new Error(`yahoo_history_insufficient_rows:${ticker}`);
  return { ticker, bars };
}

function firstAtOrAfter(bars: PriceBar[], target: number, maximumDelayMs = 5 * 86_400_000) {
  return bars.find((bar) => {
    const observedAt = Date.parse(bar.observedAt);
    return observedAt >= target && observedAt - target <= maximumDelayMs;
  }) ?? null;
}

function barOnSameTradingDate(bars: PriceBar[], observedAt: string) {
  const targetDate = dateKey(observedAt);
  return bars.find((bar) => dateKey(bar.observedAt) === targetDate) ?? null;
}

function recordFromSeed(seed: PilotSeed, security: PriceSeries, benchmark: PriceSeries): HistoricalSignalRecord | null {
  const eventAt = Date.parse(seed.eventObservedAt);
  const entry = firstAtOrAfter(security.bars, eventAt + 1);
  if (!entry) return null;
  const benchmarkEntry = barOnSameTradingDate(benchmark.bars, entry.observedAt);
  if (!benchmarkEntry) return null;
  const entryAt = Date.parse(entry.observedAt);
  const checkpoints: HistoricalSignalRecord["checkpoints"] = {};
  for (const horizon of HORIZONS) {
    const securityOutcome = firstAtOrAfter(security.bars, entryAt + horizon.milliseconds);
    const benchmarkOutcome = securityOutcome ? barOnSameTradingDate(benchmark.bars, securityOutcome.observedAt) : null;
    if (!securityOutcome || !benchmarkOutcome) continue;
    checkpoints[horizon.label] = {
      returnPercent: ((securityOutcome.close - entry.close) / entry.close) * 100,
      benchmarkReturnPercent: ((benchmarkOutcome.close - benchmarkEntry.close) / benchmarkEntry.close) * 100,
      observedAt: securityOutcome.observedAt,
      source: `${SOURCE}; benchmark ${SOURCE}`,
    };
  }
  if (!checkpoints["1D"]) return null;
  const eventKey = seedEventKey(seed);
  return {
    id: `${eventKey}:${seed.ticker}`,
    eventKey,
    ticker: seed.ticker,
    eventFamily: seed.eventFamily,
    direction: seed.direction,
    relationship: "direct",
    causalChain: seed.causalChain,
    macroRegime: [],
    signalObservedAt: entry.observedAt,
    featuresAsOf: seed.eventObservedAt,
    dataQuality: "real",
    provenance: {
      origin: "public_historical_bootstrap",
      eventPublisher: seed.eventPublisher,
      eventSourceUrl: seed.eventSourceUrl,
      priceSource: SOURCE,
      benchmarkSource: SOURCE,
      methodologyVersion: METHODOLOGY_VERSION,
    },
    checkpoints,
  };
}

export async function bootstrapPilotHistoricalSignals(
  existing: HistoricalSignalRecord[],
  fetchImpl: typeof fetch,
  now = new Date(),
): Promise<PilotHistoricalBootstrapResult> {
  const existingKeys = new Set(existing.map((record) => `${record.eventKey}:${record.ticker}`));
  const pendingSeeds = PILOT_SEEDS.filter((seed) => !existingKeys.has(`${seedEventKey(seed)}:${seed.ticker}`));
  const tickers = [...new Set(pendingSeeds.map((seed) => seed.ticker).concat(BENCHMARK_TICKER))];
  const series = new Map<string, PriceSeries>();
  const errors: string[] = [];
  for (const ticker of tickers) {
    try {
      series.set(ticker, await yahooSeries(ticker, fetchImpl, now));
    } catch (error) {
      errors.push(error instanceof Error ? error.message.slice(0, 240) : `pilot_history_failed:${ticker}`);
    }
  }
  const benchmark = series.get(BENCHMARK_TICKER);
  const records = pendingSeeds.flatMap((seed): HistoricalSignalRecord[] => {
    const security = series.get(seed.ticker);
    if (!security || !benchmark) return [];
    const record = recordFromSeed(seed, security, benchmark);
    return record ? [record] : [];
  });
  return {
    records,
    requestedSeeds: pendingSeeds.length,
    builtSeeds: records.length,
    errors,
    priceSource: SOURCE,
    noSyntheticData: true,
  };
}

export function mergePilotHistoricalSignals(...groups: HistoricalSignalRecord[][]) {
  const merged = new Map<string, HistoricalSignalRecord>();
  for (const record of groups.flat()) {
    const key = `${record.eventKey}:${record.ticker}`;
    const current = merged.get(key);
    const currentCheckpoints = current ? Object.keys(current.checkpoints).length : -1;
    if (!current || Object.keys(record.checkpoints).length > currentCheckpoints) merged.set(key, record);
  }
  return [...merged.values()];
}

export function pilotHistoricalSeedCatalog() {
  return PILOT_SEEDS.map(({ id, ticker, eventFamily, direction, eventObservedAt, eventPublisher, eventSourceUrl }) => ({
    id,
    ticker,
    eventFamily,
    direction,
    eventObservedAt,
    eventPublisher,
    eventSourceUrl,
  }));
}
