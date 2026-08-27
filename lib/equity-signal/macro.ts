import type { MacroContext, MacroSeriesSnapshot } from "@/lib/equity-signal/types";

const FRED_API_URL = "https://api.stlouisfed.org/fred/series/observations";
const FRANKFURTER_URL = "https://api.frankfurter.app/latest?from=USD&to=EUR,JPY,CHF,CNY,GBP";
// Keep the last successful regime through the 59-minute durable provider cadence.
// A shorter cache would expire before the next call is eligible and turn a healthy
// cadence guard into an hour of false "failed" macro context.
const CACHE_MS = 60 * 60 * 1000;

const SERIES = [
  { id: "DGS2", label: "2-year Treasury yield" },
  { id: "DGS10", label: "10-year Treasury yield" },
  { id: "T10Y2Y", label: "10y minus 2y Treasury spread" },
  { id: "DTWEXBGS", label: "trade-weighted U.S. dollar" },
  { id: "VIXCLS", label: "VIX volatility index" },
  { id: "DCOILWTICO", label: "WTI crude oil" },
  { id: "BAMLH0A0HYM2", label: "high-yield credit spread" },
  { id: "WALCL", label: "Federal Reserve balance sheet" },
  { id: "CPIAUCSL", label: "consumer price index" },
  { id: "UNRATE", label: "unemployment rate" },
  { id: "PAYEMS", label: "nonfarm payroll employment" },
  { id: "ICSA", label: "initial unemployment claims" },
] as const;

type Cache = { at: number; context: MacroContext; provider: Record<string, unknown> };
const globalCache = globalThis as typeof globalThis & { __swingUpEquityMacro?: Cache };

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function percentile(values: number[], current: number) {
  if (values.length < 10) return null;
  return Math.round((values.filter((value) => value <= current).length / values.length) * 1000) / 10;
}

function zScore(values: number[], current: number) {
  if (values.length < 10) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const deviation = Math.sqrt(variance);
  return deviation > 0 ? Math.round(((current - mean) / deviation) * 100) / 100 : null;
}

function parseCsv(csv: string, seriesId: string) {
  const lines = csv.trim().split(/\r?\n/);
  const headers = (lines.shift() ?? "").split(",").map((value) => value.trim());
  const column = headers.indexOf(seriesId);
  return lines.flatMap((line) => {
    const values = line.split(",");
    const value = number(values[column]);
    return value === null ? [] : [{ date: values[0]?.trim() ?? "", value }];
  });
}

async function fetchSeries(fetchImpl: typeof fetch, seriesId: string) {
  const key = process.env.FRED_API_KEY?.trim();
  if (!key) {
    const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}`;
    const response = await fetchImpl(url, { headers: { Accept: "text/csv" }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`fred_${seriesId}_http_${response.status}`);
    return { rows: parseCsv(await response.text(), seriesId).slice(-520), sourceUrl: url };
  }
  const url = new URL(FRED_API_URL);
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("api_key", key);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set("limit", "520");
  const response = await fetchImpl(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`fred_${seriesId}_http_${response.status}`);
  const body = await response.json() as { observations?: Array<{ date?: unknown; value?: unknown }> };
  const rows = (Array.isArray(body.observations) ? body.observations : []).flatMap((observation) => {
    const value = number(observation.value);
    return value === null || typeof observation.date !== "string" ? [] : [{ date: observation.date, value }];
  }).reverse();
  return { rows, sourceUrl: `https://fred.stlouisfed.org/series/${seriesId}` };
}

function snapshot(seriesId: string, label: string, rows: Array<{ date: string; value: number }>, sourceUrl: string): MacroSeriesSnapshot {
  const latest = rows.at(-1);
  const previous = rows.at(-2);
  const changes = rows.slice(1).map((row, index) => row.value - rows[index].value).filter(Number.isFinite);
  const change = latest && previous ? latest.value - previous.value : null;
  return {
    seriesId,
    label,
    latestDate: latest?.date ?? null,
    value: latest?.value ?? null,
    previousValue: previous?.value ?? null,
    change: change === null ? null : Math.round(change * 10_000) / 10_000,
    changePercentile: change === null ? null : percentile(changes, change),
    changeZScore: change === null ? null : zScore(changes, change),
    observationCount: rows.length,
    sourceUrl,
  };
}

function regimeLabels(series: MacroSeriesSnapshot[]) {
  const byId = new Map(series.map((item) => [item.seriesId, item]));
  const labels: string[] = [];
  const high = (id: string, threshold: number) => Math.abs(byId.get(id)?.changeZScore ?? 0) >= threshold;
  if (high("DGS2", 1.5) || high("DGS10", 1.5)) labels.push("unusual_rate_move");
  if ((byId.get("VIXCLS")?.changeZScore ?? 0) >= 1.5) labels.push("volatility_shock");
  if ((byId.get("DTWEXBGS")?.changeZScore ?? 0) >= 1.5) labels.push("dollar_strength_shock");
  if (high("DCOILWTICO", 1.5)) labels.push("oil_price_shock");
  if ((byId.get("BAMLH0A0HYM2")?.changeZScore ?? 0) >= 1.5) labels.push("credit_stress_rising");
  if (!labels.length) labels.push("no_extreme_macro_change_in_latest_official_observations");
  return labels;
}

export async function fetchMacroContext(fetchImpl: typeof fetch, now: Date) {
  const cached = globalCache.__swingUpEquityMacro;
  if (cached && now.getTime() - cached.at < CACHE_MS) return { context: cached.context, provider: { ...cached.provider, cached: true } };
  const settled = await Promise.allSettled(SERIES.map(async (item) => {
    const response = await fetchSeries(fetchImpl, item.id);
    return snapshot(item.id, item.label, response.rows, response.sourceUrl);
  }));
  const series = settled.flatMap((item) => item.status === "fulfilled" ? [item.value] : []);
  const errors = settled.flatMap((item, index) => item.status === "rejected" ? [`${SERIES[index].id}:${item.reason instanceof Error ? item.reason.message : "failed"}`] : []);
  let fx: Record<string, unknown> = { status: "temporarily_unavailable", sourceUrl: FRANKFURTER_URL, rates: {}, date: null };
  try {
    const response = await fetchImpl(FRANKFURTER_URL, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`http_${response.status}`);
    const body = await response.json() as { date?: unknown; rates?: unknown };
    fx = { status: "connected", sourceUrl: FRANKFURTER_URL, date: typeof body.date === "string" ? body.date : null, rates: body.rates && typeof body.rates === "object" ? body.rates : {} };
  } catch (error) {
    errors.push(`frankfurter:${error instanceof Error ? error.message : "failed"}`);
  }
  const context: MacroContext = {
    checkedAt: now.toISOString(),
    status: series.length === SERIES.length ? "connected" : series.length ? "partial" : "failed",
    series,
    regime: regimeLabels(series),
    historicalComparisonAvailable: series.some((item) => item.observationCount >= 30 && item.changeZScore !== null),
    errors,
  };
  const provider = { provider: "fred_and_frankfurter", status: context.status, checkedAt: now.toISOString(), seriesRequested: SERIES.length, seriesConnected: series.length, errors, fx, cached: false };
  globalCache.__swingUpEquityMacro = { at: now.getTime(), context, provider };
  return { context, provider };
}

export const MACRO_SERIES = SERIES;
