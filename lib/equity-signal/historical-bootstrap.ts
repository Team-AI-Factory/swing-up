import crypto from "node:crypto";
import type { HistoricalAnalogHorizon, HistoricalSignalRecord } from "@/lib/equity-signal/historical-analogs";
import type { ProviderResult, ProviderStatus } from "@/lib/equity-signal/types";

type HistoricalBootstrapSeed = {
  id: string;
  ticker: string;
  eventFamily: string;
  direction: "upside" | "downside";
  relationship: "direct" | "second_order" | "third_order";
  eventObservedAt: string;
  eventPublisher: string;
  eventSourceUrl: string;
  causalChain: string[];
};

type PriceBar = { observedAt: string; close: number; source: string };
type SeriesResult = { ticker: string; bars: PriceBar[]; source: string };

const YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart";
const FMP_HISTORY_URL = "https://financialmodelingprep.com/stable/historical-price-eod/light";
const BENCHMARK_TICKER = "SPY";
const METHODOLOGY_VERSION = "public-bootstrap-calendar-horizons-v1";
const HORIZONS: Array<{ label: HistoricalAnalogHorizon; milliseconds: number }> = [
  { label: "1D", milliseconds: 24 * 60 * 60 * 1000 },
  { label: "3D", milliseconds: 3 * 24 * 60 * 60 * 1000 },
  { label: "7D", milliseconds: 7 * 24 * 60 * 60 * 1000 },
  { label: "30D", milliseconds: 30 * 24 * 60 * 60 * 1000 },
  { label: "90D", milliseconds: 90 * 24 * 60 * 60 * 1000 },
];

// These factual event receipts already existed in Swing Up's curated historical
// backfill. Numeric returns are never hard-coded: they are rebuilt from public
// daily price history at runtime and stored in R2 with their sources.
const SEEDS: HistoricalBootstrapSeed[] = [
  {
    id: "nvda-2023-05-24-guidance-raise",
    ticker: "NVDA",
    eventFamily: "earnings_guidance",
    direction: "upside",
    relationship: "direct",
    eventObservedAt: "2023-05-24T23:59:59.000Z",
    eventPublisher: "NVIDIA Investor Relations",
    eventSourceUrl: "https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-first-quarter-fiscal-2024",
    causalChain: ["material guidance increase", "higher expected data-centre revenue", "earnings and valuation estimate revision"],
  },
  {
    id: "biib-2019-03-21-trial-failure",
    ticker: "BIIB",
    eventFamily: "regulatory_enforcement",
    direction: "downside",
    relationship: "direct",
    eventObservedAt: "2019-03-21T23:59:59.000Z",
    eventPublisher: "Biogen",
    eventSourceUrl: "https://investors.biogen.com/news-releases/news-release-details/biogen-and-eisai-discontinue-phase-3-engage-and-emerge-trials",
    causalChain: ["pivotal trial stopped for futility", "pipeline value impaired", "expected future cash flows reduced"],
  },
  {
    id: "pfe-2021-08-23-fda-approval",
    ticker: "PFE",
    eventFamily: "regulatory_approval",
    direction: "upside",
    relationship: "direct",
    eventObservedAt: "2021-08-23T23:59:59.000Z",
    eventPublisher: "U.S. Food and Drug Administration",
    eventSourceUrl: "https://www.fda.gov/news-events/press-announcements/fda-approves-first-covid-19-vaccine",
    causalChain: ["official product approval", "commercial and adoption certainty improved", "revenue opportunity and risk discount changed"],
  },
  {
    id: "meta-2022-10-26-guidance-cut",
    ticker: "META",
    eventFamily: "earnings_guidance",
    direction: "downside",
    relationship: "direct",
    eventObservedAt: "2022-10-26T23:59:59.000Z",
    eventPublisher: "Meta Investor Relations",
    eventSourceUrl: "https://investor.fb.com/investor-news/press-release-details/2022/Meta-Reports-Third-Quarter-2022-Results/default.aspx",
    causalChain: ["slower growth and elevated expense outlook", "expected margins and cash flow reduced", "earnings and valuation estimate revision"],
  },
  {
    id: "jpm-2023-05-01-bank-acquisition",
    ticker: "JPM",
    eventFamily: "merger_acquisition",
    direction: "upside",
    relationship: "direct",
    eventObservedAt: "2023-05-01T23:59:59.000Z",
    eventPublisher: "Federal Deposit Insurance Corporation",
    eventSourceUrl: "https://www.fdic.gov/news/press-releases/2023/pr23034.html",
    causalChain: ["bank assets and deposits acquired in regulatory resolution", "deposit franchise and earnings base changed", "expected cash flows and risk changed"],
  },
];

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" && value.trim() && Number.isFinite(Number(value))
      ? Number(value)
      : null;
}

function dateKey(value: string) {
  return value.slice(0, 10);
}

function eventKey(seed: HistoricalBootstrapSeed) {
  return crypto.createHash("sha256").update(`public-bootstrap|${seed.id}`).digest("hex").slice(0, 20);
}

function existingSeedKeys(records: HistoricalSignalRecord[]) {
  return new Set(records.map((record) => record.eventKey));
}

function safeTimestamp(value: unknown) {
  const seconds = finiteNumber(value);
  if (seconds === null) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function yahooSeries(ticker: string, fetchImpl: typeof fetch, now: Date): Promise<SeriesResult> {
  const earliest = Math.min(...SEEDS.filter((seed) => seed.ticker === ticker || ticker === BENCHMARK_TICKER).map((seed) => Date.parse(seed.eventObservedAt)), now.getTime() - 365 * 24 * 60 * 60 * 1000);
  const url = new URL(`${YAHOO_CHART_URL}/${encodeURIComponent(ticker)}`);
  url.searchParams.set("interval", "1d");
  url.searchParams.set("period1", String(Math.floor((earliest - 7 * 24 * 60 * 60 * 1000) / 1000)));
  url.searchParams.set("period2", String(Math.floor(now.getTime() / 1000)));
  url.searchParams.set("events", "div,splits");
  const response = await fetchImpl(url, { headers: { Accept: "application/json", "user-agent": "SwingUp/1.0 support@swingup.app" }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`yahoo_history_http_${response.status}`);
  const body = await response.json() as { chart?: { result?: Array<Record<string, unknown>> } };
  const chart = body.chart?.result?.[0];
  if (!chart) throw new Error("yahoo_history_empty_or_malformed");
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
  const source = "Yahoo Finance public adjusted daily chart history";
  const bars = timestamps.flatMap((rawTimestamp, index): PriceBar[] => {
    const observedAt = safeTimestamp(rawTimestamp);
    const close = finiteNumber(adjusted[index] ?? closes[index]);
    return observedAt && close !== null && close > 0 ? [{ observedAt, close, source }] : [];
  }).sort((left, right) => left.observedAt.localeCompare(right.observedAt));
  if (bars.length < 2) throw new Error("yahoo_history_insufficient_rows");
  return { ticker, bars, source };
}

async function fmpSeries(ticker: string, fetchImpl: typeof fetch, now: Date): Promise<SeriesResult> {
  const key = process.env.FMP_API_KEY?.trim();
  if (!key) throw new Error("fmp_history_not_configured");
  const earliest = Math.min(...SEEDS.filter((seed) => seed.ticker === ticker || ticker === BENCHMARK_TICKER).map((seed) => Date.parse(seed.eventObservedAt)), now.getTime() - 365 * 24 * 60 * 60 * 1000);
  const url = new URL(FMP_HISTORY_URL);
  url.searchParams.set("symbol", ticker);
  url.searchParams.set("from", new Date(earliest - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  url.searchParams.set("to", now.toISOString().slice(0, 10));
  url.searchParams.set("apikey", key);
  const response = await fetchImpl(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if ([401, 402, 403].includes(response.status)) throw new Error(`fmp_history_not_entitled_http_${response.status}`);
  if (!response.ok) throw new Error(`fmp_history_http_${response.status}`);
  const body = await response.json() as unknown;
  const rows = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as Record<string, unknown>).historical)
      ? (body as Record<string, unknown>).historical as unknown[]
      : [];
  const source = "Financial Modeling Prep free end-of-day history";
  const bars = rows.flatMap((raw): PriceBar[] => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const row = raw as Record<string, unknown>;
    const date = typeof row.date === "string" && /^\d{4}-\d{2}-\d{2}/.test(row.date) ? `${row.date.slice(0, 10)}T21:00:00.000Z` : null;
    const close = finiteNumber(row.adjClose ?? row.price ?? row.close);
    return date && close !== null && close > 0 ? [{ observedAt: date, close, source }] : [];
  }).sort((left, right) => left.observedAt.localeCompare(right.observedAt));
  if (bars.length < 2) throw new Error("fmp_history_insufficient_rows");
  return { ticker, bars, source };
}

async function priceSeries(ticker: string, fetchImpl: typeof fetch, now: Date): Promise<SeriesResult> {
  const errors: string[] = [];
  for (const adapter of [yahooSeries, fmpSeries]) {
    try {
      return await adapter(ticker, fetchImpl, now);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "historical_price_adapter_failed");
    }
  }
  throw new Error(errors.join(" | ").slice(0, 400));
}

function firstAtOrAfter(bars: PriceBar[], target: number, maximumDelayMs = 5 * 24 * 60 * 60 * 1000) {
  return bars.find((bar) => {
    const observedAt = Date.parse(bar.observedAt);
    return observedAt >= target && observedAt - target <= maximumDelayMs;
  }) ?? null;
}

function barOnSameTradingDate(bars: PriceBar[], observedAt: string) {
  const targetDate = dateKey(observedAt);
  return bars.find((bar) => dateKey(bar.observedAt) === targetDate) ?? null;
}

function recordFromSeed(seed: HistoricalBootstrapSeed, security: SeriesResult, benchmark: SeriesResult): HistoricalSignalRecord | null {
  const eventAt = Date.parse(seed.eventObservedAt);
  const entry = firstAtOrAfter(security.bars, eventAt + 1);
  if (!entry) return null;
  const entryAt = Date.parse(entry.observedAt);
  const benchmarkEntry = barOnSameTradingDate(benchmark.bars, entry.observedAt);
  if (!benchmarkEntry) return null;
  const checkpoints: HistoricalSignalRecord["checkpoints"] = {};
  for (const horizon of HORIZONS) {
    const targetAt = entryAt + horizon.milliseconds;
    const securityOutcome = firstAtOrAfter(security.bars, targetAt);
    const benchmarkOutcome = securityOutcome ? barOnSameTradingDate(benchmark.bars, securityOutcome.observedAt) : null;
    if (!securityOutcome || !benchmarkOutcome) continue;
    checkpoints[horizon.label] = {
      returnPercent: ((securityOutcome.close - entry.close) / entry.close) * 100,
      benchmarkReturnPercent: ((benchmarkOutcome.close - benchmarkEntry.close) / benchmarkEntry.close) * 100,
      observedAt: securityOutcome.observedAt,
      source: `${security.source}; benchmark ${benchmark.source}`,
    };
  }
  if (!checkpoints["1D"]) return null;
  const key = eventKey(seed);
  return {
    id: `${key}:${seed.ticker}`,
    eventKey: key,
    ticker: seed.ticker,
    eventFamily: seed.eventFamily,
    direction: seed.direction,
    relationship: seed.relationship,
    causalChain: seed.causalChain,
    macroRegime: [],
    signalObservedAt: entry.observedAt,
    featuresAsOf: seed.eventObservedAt,
    dataQuality: "real",
    provenance: {
      origin: "public_historical_bootstrap",
      eventPublisher: seed.eventPublisher,
      eventSourceUrl: seed.eventSourceUrl,
      priceSource: security.source,
      benchmarkSource: benchmark.source,
      methodologyVersion: METHODOLOGY_VERSION,
    },
    checkpoints,
  };
}

function failureStatus(errors: string[]): ProviderStatus {
  if (errors.some((error) => /cadence_guard|rolling_quota_guard/.test(error))) return "not_due";
  if (errors.some((error) => /rate|429/.test(error))) return "rate_limited";
  if (errors.some((error) => /not_entitled|http_(?:401|402|403)/.test(error))) return "not_entitled";
  return "temporarily_unavailable";
}

function richness(record: HistoricalSignalRecord) {
  return Object.keys(record.checkpoints).length + (record.provenance ? 10 : 0);
}

export function mergeHistoricalSignals(...groups: HistoricalSignalRecord[][]) {
  const merged = new Map<string, HistoricalSignalRecord>();
  for (const record of groups.flat()) {
    const key = `${record.eventKey}|${record.ticker}|${record.direction}|${record.relationship}`;
    const existing = merged.get(key);
    if (!existing || richness(record) >= richness(existing)) merged.set(key, record);
  }
  return [...merged.values()].sort((left, right) => left.signalObservedAt.localeCompare(right.signalObservedAt) || left.id.localeCompare(right.id));
}

export async function bootstrapPublicHistoricalSignals(
  existing: HistoricalSignalRecord[],
  fetchImpl: typeof fetch,
  now: Date,
) {
  const known = existingSeedKeys(existing);
  const missing = SEEDS.filter((seed) => !known.has(eventKey(seed)) && Date.parse(seed.eventObservedAt) < now.getTime() - 100 * 24 * 60 * 60 * 1000);
  if (!missing.length) {
    const provider: ProviderResult = { provider: "public_historical_price_bootstrap", status: "not_due", checkedAt: null, nextRetryAt: null, sourceUrls: [YAHOO_CHART_URL, FMP_HISTORY_URL], receipts: [], recordsRead: 0, error: null, entitlementVerified: true, cached: true };
    return { records: [] as HistoricalSignalRecord[], provider, seedsAvailable: SEEDS.length, seedsRemaining: 0 };
  }
  const tickers = [...new Set([...missing.map((seed) => seed.ticker), BENCHMARK_TICKER])];
  const settled = await Promise.all(tickers.map(async (ticker) => {
    try {
      return { ticker, series: await priceSeries(ticker, fetchImpl, now), error: null };
    } catch (error) {
      return { ticker, series: null, error: error instanceof Error ? error.message.slice(0, 400) : "historical_price_failed" };
    }
  }));
  const byTicker = new Map(settled.flatMap((item) => item.series ? [[item.ticker, item.series] as const] : []));
  const benchmark = byTicker.get(BENCHMARK_TICKER) ?? null;
  const records = benchmark ? missing.flatMap((seed) => {
    const security = byTicker.get(seed.ticker);
    const record = security ? recordFromSeed(seed, security, benchmark) : null;
    return record ? [record] : [];
  }) : [];
  const errors = settled.flatMap((item) => item.error ? [`${item.ticker}:${item.error}`] : []);
  const provider: ProviderResult = {
    provider: "public_historical_price_bootstrap",
    status: records.length ? "connected" : failureStatus(errors),
    checkedAt: now.toISOString(),
    nextRetryAt: null,
    sourceUrls: [YAHOO_CHART_URL, FMP_HISTORY_URL, ...missing.map((seed) => seed.eventSourceUrl)],
    receipts: [],
    recordsRead: records.length,
    error: errors.length ? errors.join(" | ").slice(0, 600) : null,
    entitlementVerified: records.length > 0,
    cached: false,
  };
  return { records, provider, seedsAvailable: SEEDS.length, seedsRemaining: Math.max(0, missing.length - records.length) };
}

export function historicalBootstrapSeedsForTest() {
  return SEEDS.map((seed) => ({ ...seed, eventKey: eventKey(seed), eventDate: dateKey(seed.eventObservedAt) }));
}
