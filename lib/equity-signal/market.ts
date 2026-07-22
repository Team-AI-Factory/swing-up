import type { ImpactCandidate, MarketQuote, ProviderResult, ProviderStatus } from "@/lib/equity-signal/types";

const YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart";
const ALPHA_VANTAGE_URL = "https://www.alphavantage.co/query";
const FMP_URL = "https://financialmodelingprep.com/stable/historical-price-eod/light";
const CACHE_MS = 5 * 60 * 1000;
const MAX_OUTCOME_TICKERS = 6;
const BROAD_MARKET_BENCHMARK = "SPY";

type CachedQuote = {
  at: number;
  quote: MarketQuote | null;
  status: ProviderStatus;
  error: string | null;
  attempted: string[];
};

const globalCache = globalThis as typeof globalThis & { __swingUpEquityQuotes?: Map<string, CachedQuote> };

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" && value.trim() && Number.isFinite(Number(value))
      ? Number(value)
      : null;
}

function validTicker(value: string) {
  const ticker = value.trim().toUpperCase();
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker) ? ticker : null;
}

function observedAtFromTradingDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const parsed = new Date(`${value.slice(0, 10)}T21:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function delayedMinutes(now: Date, observedAt: string) {
  return Math.max(0, Math.round((now.getTime() - Date.parse(observedAt)) / 60_000));
}

async function yahooQuote(ticker: string, fetchImpl: typeof fetch, now: Date): Promise<MarketQuote> {
  const url = new URL(`${YAHOO_CHART_URL}/${encodeURIComponent(ticker)}`);
  url.searchParams.set("interval", "5m");
  url.searchParams.set("range", "1d");
  url.searchParams.set("events", "div,splits");
  const response = await fetchImpl(url, { headers: { Accept: "application/json", "user-agent": "SwingUp/1.0 support@swingup.app" }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`yahoo_http_${response.status}`);
  const body = await response.json() as { chart?: { result?: Array<Record<string, unknown>>; error?: unknown } };
  const chart = body.chart?.result?.[0];
  if (!chart) throw new Error("yahoo_empty_or_malformed");
  const meta = chart.meta && typeof chart.meta === "object" ? chart.meta as Record<string, unknown> : {};
  const timestamps = Array.isArray(chart.timestamp) ? chart.timestamp.map(number).filter((value): value is number => value !== null) : [];
  const observedEpoch = timestamps.at(-1) ?? number(meta.regularMarketTime);
  const observedAt = observedEpoch ? new Date(observedEpoch * 1000).toISOString() : null;
  const price = number(meta.regularMarketPrice);
  const previousClose = number(meta.chartPreviousClose ?? meta.previousClose);
  if (!price || !observedAt || Number.isNaN(Date.parse(observedAt))) throw new Error("yahoo_price_or_timestamp_missing");
  return {
    ticker,
    price,
    previousClose,
    changePercent: previousClose ? Math.round((((price - previousClose) / previousClose) * 100) * 100) / 100 : null,
    volume: null,
    averageVolume: null,
    marketCap: null,
    observedAt,
    source: "Yahoo Finance public chart snapshot",
    delayedMinutes: delayedMinutes(now, observedAt),
  };
}

async function alphaQuote(ticker: string, fetchImpl: typeof fetch, now: Date): Promise<MarketQuote> {
  const key = process.env.ALPHA_VANTAGE_API_KEY?.trim();
  if (!key) throw new Error("alpha_vantage_not_configured");
  const url = new URL(ALPHA_VANTAGE_URL);
  url.searchParams.set("function", "GLOBAL_QUOTE");
  url.searchParams.set("symbol", ticker);
  url.searchParams.set("apikey", key);
  const response = await fetchImpl(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`alpha_vantage_http_${response.status}`);
  const body = await response.json() as Record<string, unknown>;
  const note = typeof body.Note === "string" ? body.Note : typeof body.Information === "string" ? body.Information : null;
  if (note) throw new Error(/limit|frequency|quota/i.test(note) ? "alpha_vantage_rate_limited" : "alpha_vantage_provider_message");
  const quote = body["Global Quote"] && typeof body["Global Quote"] === "object" ? body["Global Quote"] as Record<string, unknown> : {};
  const symbol = typeof quote["01. symbol"] === "string" ? quote["01. symbol"].trim().toUpperCase() : "";
  const price = number(quote["05. price"]);
  const previousClose = number(quote["08. previous close"]);
  const observedAt = observedAtFromTradingDate(quote["07. latest trading day"]);
  if (symbol !== ticker || !price || !observedAt) throw new Error("alpha_vantage_empty_or_malformed");
  return {
    ticker,
    price,
    previousClose,
    changePercent: previousClose ? Math.round((((price - previousClose) / previousClose) * 100) * 100) / 100 : null,
    volume: number(quote["06. volume"]),
    averageVolume: null,
    marketCap: null,
    observedAt,
    source: "Alpha Vantage GLOBAL_QUOTE latest trading day",
    delayedMinutes: delayedMinutes(now, observedAt),
  };
}

async function fmpQuote(ticker: string, fetchImpl: typeof fetch, now: Date): Promise<MarketQuote> {
  const key = process.env.FMP_API_KEY?.trim();
  if (!key) throw new Error("fmp_not_configured");
  const url = new URL(FMP_URL);
  url.searchParams.set("symbol", ticker);
  url.searchParams.set("from", new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  url.searchParams.set("to", now.toISOString().slice(0, 10));
  url.searchParams.set("apikey", key);
  const response = await fetchImpl(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const bodyText = await response.text();
  if ([401, 402, 403].includes(response.status)) throw new Error(`fmp_not_entitled_http_${response.status}`);
  if (!response.ok) throw new Error(`fmp_http_${response.status}`);
  const body = JSON.parse(bodyText) as unknown;
  const rows = Array.isArray(body) ? body.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row)) : [];
  const ordered = rows.sort((left, right) => String(right.date ?? "").localeCompare(String(left.date ?? "")));
  const latest = ordered[0];
  const previous = ordered[1];
  const price = number(latest?.price ?? latest?.close);
  const previousClose = number(previous?.price ?? previous?.close);
  const observedAt = observedAtFromTradingDate(latest?.date);
  if (!price || !observedAt) throw new Error("fmp_empty_or_malformed_eod_response");
  return {
    ticker,
    price,
    previousClose,
    changePercent: previousClose ? Math.round((((price - previousClose) / previousClose) * 100) * 100) / 100 : null,
    volume: number(latest?.volume),
    averageVolume: null,
    marketCap: null,
    observedAt,
    source: "Financial Modeling Prep free end-of-day history",
    delayedMinutes: delayedMinutes(now, observedAt),
  };
}

function failureStatus(errors: string[]): ProviderStatus {
  if (errors.some((error) => /cadence_guard|rolling_quota_guard/.test(error))) return "not_due";
  if (errors.some((error) => /rate|429/.test(error))) return "rate_limited";
  if (errors.some((error) => /not_entitled|http_(?:401|402|403)/.test(error))) return "not_entitled";
  if (errors.every((error) => /not_configured/.test(error))) return "not_configured";
  return "temporarily_unavailable";
}

async function fetchOne(ticker: string, fetchImpl: typeof fetch, now: Date): Promise<CachedQuote> {
  const cache = globalCache.__swingUpEquityQuotes ??= new Map();
  const existing = cache.get(ticker);
  if (existing && now.getTime() - existing.at < CACHE_MS) return existing;
  const attempted: string[] = [];
  const errors: string[] = [];
  for (const [name, adapter] of [
    ["yahoo_public_chart", yahooQuote],
    ["alpha_vantage_global_quote", alphaQuote],
    ["fmp_free_eod", fmpQuote],
  ] as const) {
    attempted.push(name);
    try {
      const quote = await adapter(ticker, fetchImpl, now);
      const result: CachedQuote = { at: now.getTime(), quote, status: "connected", error: null, attempted };
      cache.set(ticker, result);
      return result;
    } catch (error) {
      errors.push(error instanceof Error ? error.message.slice(0, 140) : `${name}_failed`);
    }
  }
  const status = failureStatus(errors);
  const result: CachedQuote = { at: now.getTime(), quote: existing?.quote ?? null, status, error: errors.join(" | ").slice(0, 400), attempted };
  cache.set(ticker, result);
  return result;
}

export async function enrichCandidateQuotes(
  candidates: ImpactCandidate[],
  fetchImpl: typeof fetch,
  now: Date,
  maximum = 3,
  outcomeTickers: string[] = [],
) {
  const shortlisted = candidates.filter((candidate) => candidate.gatePassed).slice(0, maximum);
  const eventTickers = [...new Set([
    ...shortlisted.map((candidate) => candidate.ticker),
    ...outcomeTickers.slice(0, MAX_OUTCOME_TICKERS).map(validTicker).filter((value): value is string => Boolean(value)),
  ])];
  const requestedTickers = eventTickers.length ? [...new Set([...eventTickers, BROAD_MARKET_BENCHMARK])] : [];
  const settled = await Promise.all(requestedTickers.map(async (ticker) => ({ ticker, outcome: await fetchOne(ticker, fetchImpl, now) })));
  const byTicker = new Map(settled.map((item) => [item.ticker, item.outcome]));
  for (const candidate of shortlisted) candidate.quote = byTicker.get(candidate.ticker)?.quote ?? null;
  const statuses = settled.map((item) => item.outcome.status);
  const connected = settled.filter((item) => item.outcome.quote && item.outcome.status === "connected");
  const provider: ProviderResult = {
    provider: "public_equity_quote_fallback_chain",
    status: !settled.length ? "not_due" : connected.length ? "connected" : statuses.includes("not_entitled") ? "not_entitled" : statuses.includes("not_due") ? "not_due" : statuses[0] ?? "temporarily_unavailable",
    checkedAt: settled.length ? now.toISOString() : null,
    nextRetryAt: null,
    sourceUrls: [YAHOO_CHART_URL, `${ALPHA_VANTAGE_URL}?function=GLOBAL_QUOTE`, FMP_URL],
    receipts: [],
    recordsRead: connected.length,
    error: settled.find((item) => item.outcome.error)?.outcome.error ?? null,
    entitlementVerified: connected.some((item) => !item.outcome.quote?.source.startsWith("Yahoo")),
    cached: settled.some((item) => now.getTime() - item.outcome.at > 1_000),
  };
  return {
    candidates,
    provider,
    marketSnapshot: settled.flatMap((item) => item.outcome.quote ? [item.outcome.quote] : []),
    benchmarkQuote: byTicker.get(BROAD_MARKET_BENCHMARK)?.quote ?? null,
    benchmarkTicker: BROAD_MARKET_BENCHMARK,
  };
}
