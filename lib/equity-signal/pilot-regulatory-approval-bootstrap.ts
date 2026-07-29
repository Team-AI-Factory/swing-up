import crypto from "node:crypto";
import type { HistoricalAnalogHorizon, HistoricalSignalRecord } from "@/lib/equity-signal/historical-analogs";

export type RegulatoryApprovalBootstrapResult = {
  records: HistoricalSignalRecord[];
  requestedSeeds: number;
  builtSeeds: number;
  errors: string[];
  eventFamily: "regulatory_approval";
  priceSource: "Yahoo Finance public adjusted daily chart history";
  officialEventSource: "U.S. Food and Drug Administration";
  noSyntheticData: true;
};

type Seed = {
  id: string;
  ticker: string;
  eventObservedAt: string;
  eventSourceUrl: string;
  title: string;
};

type PriceBar = { observedAt: string; close: number };
type Series = { ticker: string; bars: PriceBar[] };

const SOURCE = "Yahoo Finance public adjusted daily chart history" as const;
const BENCHMARK = "SPY";
const METHOD = "us-peer-pilot-fda-approval-adjusted-prices-v1";
const HORIZONS: Array<{ label: HistoricalAnalogHorizon; milliseconds: number }> = [
  { label: "1D", milliseconds: 86_400_000 },
  { label: "3D", milliseconds: 3 * 86_400_000 },
  { label: "7D", milliseconds: 7 * 86_400_000 },
  { label: "30D", milliseconds: 30 * 86_400_000 },
  { label: "90D", milliseconds: 90 * 86_400_000 },
];

// The events were selected from official FDA approval announcements before
// any stock-return calculation. Prices and outcomes are rebuilt at runtime.
const SEEDS: Seed[] = [
  {
    id: "vrtx-2023-12-08-casgevy-fda-approval",
    ticker: "VRTX",
    eventObservedAt: "2023-12-08T23:59:59.000Z",
    eventSourceUrl: "https://www.fda.gov/news-events/press-announcements/fda-approves-first-gene-therapies-treat-patients-sickle-cell-disease",
    title: "FDA approves Casgevy for sickle cell disease",
  },
  {
    id: "srpt-2023-06-22-elevidys-fda-approval",
    ticker: "SRPT",
    eventObservedAt: "2023-06-22T23:59:59.000Z",
    eventSourceUrl: "https://www.fda.gov/news-events/press-announcements/fda-approves-first-gene-therapy-treatment-certain-patients-duchenne-muscular-dystrophy",
    title: "FDA approves Elevidys for certain Duchenne muscular dystrophy patients",
  },
  {
    id: "bmrn-2023-06-29-roctavian-fda-approval",
    ticker: "BMRN",
    eventObservedAt: "2023-06-29T23:59:59.000Z",
    eventSourceUrl: "https://www.fda.gov/news-events/press-announcements/fda-approves-first-gene-therapy-adults-severe-hemophilia",
    title: "FDA approves Roctavian for adults with severe hemophilia A",
  },
  {
    id: "iova-2024-02-16-amtagvi-fda-approval",
    ticker: "IOVA",
    eventObservedAt: "2024-02-16T23:59:59.000Z",
    eventSourceUrl: "https://www.fda.gov/news-events/press-announcements/fda-approves-first-cellular-therapy-treat-patients-unresectable-or-metastatic-melanoma",
    title: "FDA approves Amtagvi for unresectable or metastatic melanoma",
  },
  {
    id: "mrna-2023-09-11-updated-spikevax-fda-approval",
    ticker: "MRNA",
    eventObservedAt: "2023-09-11T23:59:59.000Z",
    eventSourceUrl: "https://www.fda.gov/news-events/press-announcements/fda-takes-action-updated-mrna-covid-19-vaccines-better-protect-against-currently-circulating",
    title: "FDA approves updated Spikevax formulation",
  },
];

function finite(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function timestamp(value: unknown) {
  const seconds = finite(value);
  if (seconds === null) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function eventKey(seed: Seed) {
  return crypto.createHash("sha256").update(`fda-approval-peer|${seed.id}`).digest("hex").slice(0, 20);
}

async function yahooSeries(ticker: string, earliest: number, fetchImpl: typeof fetch, now: Date): Promise<Series> {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`);
  url.searchParams.set("interval", "1d");
  url.searchParams.set("period1", String(Math.floor((earliest - 10 * 86_400_000) / 1000)));
  url.searchParams.set("period2", String(Math.floor(now.getTime() / 1000)));
  url.searchParams.set("events", "div,splits");
  url.searchParams.set("includeAdjustedClose", "true");
  const response = await fetchImpl(url, { cache: "no-store", headers: { accept: "application/json", "user-agent": "SwingUp/1.0 support@swingup.app" }, signal: AbortSignal.timeout(25_000) });
  if (!response.ok) throw new Error(`yahoo_fda_history_http_${response.status}:${ticker}`);
  const body = await response.json() as { chart?: { result?: Array<Record<string, unknown>> } };
  const chart = body.chart?.result?.[0];
  if (!chart) throw new Error(`yahoo_fda_history_empty:${ticker}`);
  const times = Array.isArray(chart.timestamp) ? chart.timestamp : [];
  const indicators = chart.indicators && typeof chart.indicators === "object" ? chart.indicators as Record<string, unknown> : {};
  const adjustedGroups = Array.isArray(indicators.adjclose) ? indicators.adjclose : [];
  const quoteGroups = Array.isArray(indicators.quote) ? indicators.quote : [];
  const adjusted = adjustedGroups[0] && typeof adjustedGroups[0] === "object" && Array.isArray((adjustedGroups[0] as Record<string, unknown>).adjclose) ? (adjustedGroups[0] as Record<string, unknown>).adjclose as unknown[] : [];
  const closes = quoteGroups[0] && typeof quoteGroups[0] === "object" && Array.isArray((quoteGroups[0] as Record<string, unknown>).close) ? (quoteGroups[0] as Record<string, unknown>).close as unknown[] : [];
  const bars = times.flatMap((raw, index): PriceBar[] => {
    const observedAt = timestamp(raw);
    const close = finite(adjusted[index] ?? closes[index]);
    return observedAt && close !== null && close > 0 ? [{ observedAt, close }] : [];
  }).sort((left, right) => left.observedAt.localeCompare(right.observedAt));
  if (bars.length < 2) throw new Error(`yahoo_fda_history_insufficient:${ticker}`);
  return { ticker, bars };
}

function firstAtOrAfter(bars: PriceBar[], target: number, maximumDelay = 5 * 86_400_000) {
  return bars.find((bar) => {
    const time = Date.parse(bar.observedAt);
    return time >= target && time - target <= maximumDelay;
  }) ?? null;
}

function sameDate(bars: PriceBar[], observedAt: string) {
  return bars.find((bar) => bar.observedAt.slice(0, 10) === observedAt.slice(0, 10)) ?? null;
}

function record(seed: Seed, stock: Series, benchmark: Series): HistoricalSignalRecord | null {
  const entry = firstAtOrAfter(stock.bars, Date.parse(seed.eventObservedAt) + 1);
  if (!entry) return null;
  const benchmarkEntry = sameDate(benchmark.bars, entry.observedAt);
  if (!benchmarkEntry) return null;
  const entryTime = Date.parse(entry.observedAt);
  const checkpoints: HistoricalSignalRecord["checkpoints"] = {};
  for (const horizon of HORIZONS) {
    const stockOutcome = firstAtOrAfter(stock.bars, entryTime + horizon.milliseconds);
    const benchmarkOutcome = stockOutcome ? sameDate(benchmark.bars, stockOutcome.observedAt) : null;
    if (!stockOutcome || !benchmarkOutcome) continue;
    checkpoints[horizon.label] = {
      returnPercent: ((stockOutcome.close - entry.close) / entry.close) * 100,
      benchmarkReturnPercent: ((benchmarkOutcome.close - benchmarkEntry.close) / benchmarkEntry.close) * 100,
      observedAt: stockOutcome.observedAt,
      source: `${SOURCE}; benchmark ${SOURCE}`,
    };
  }
  if (!checkpoints["1D"]) return null;
  const key = eventKey(seed);
  return {
    id: `${key}:${seed.ticker}`,
    eventKey: key,
    ticker: seed.ticker,
    eventFamily: "regulatory_approval",
    direction: "upside",
    relationship: "direct",
    causalChain: ["official FDA approval", "commercial access or adoption certainty improved", "future revenue opportunity changed"],
    macroRegime: [],
    signalObservedAt: entry.observedAt,
    featuresAsOf: seed.eventObservedAt,
    dataQuality: "real",
    provenance: {
      origin: "public_historical_bootstrap",
      eventPublisher: "U.S. Food and Drug Administration",
      eventSourceUrl: seed.eventSourceUrl,
      priceSource: SOURCE,
      benchmarkSource: SOURCE,
      methodologyVersion: METHOD,
    },
    checkpoints,
  };
}

export async function bootstrapRegulatoryApprovalPeerHistory(existing: HistoricalSignalRecord[], fetchImpl: typeof fetch, now = new Date()): Promise<RegulatoryApprovalBootstrapResult> {
  const existingKeys = new Set(existing.map((item) => `${item.eventKey}:${item.ticker}`));
  const pending = SEEDS.filter((seed) => !existingKeys.has(`${eventKey(seed)}:${seed.ticker}`));
  const earliest = Math.min(...SEEDS.map((seed) => Date.parse(seed.eventObservedAt)));
  const series = new Map<string, Series>();
  const errors: string[] = [];
  for (const ticker of [...new Set([...pending.map((seed) => seed.ticker), BENCHMARK])]) {
    try { series.set(ticker, await yahooSeries(ticker, earliest, fetchImpl, now)); }
    catch (error) { errors.push(error instanceof Error ? error.message : `fda_history_failed:${ticker}`); }
  }
  const benchmark = series.get(BENCHMARK);
  const records = benchmark ? pending.flatMap((seed) => {
    const stock = series.get(seed.ticker);
    const value = stock ? record(seed, stock, benchmark) : null;
    return value ? [value] : [];
  }) : [];
  return { records, requestedSeeds: pending.length, builtSeeds: records.length, errors, eventFamily: "regulatory_approval", priceSource: SOURCE, officialEventSource: "U.S. Food and Drug Administration", noSyntheticData: true };
}
