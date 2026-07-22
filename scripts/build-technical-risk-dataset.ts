import { mkdir, writeFile } from "node:fs/promises";

const outputPath = process.env.TECHNICAL_RISK_DATASET_PATH ?? "artifacts/technical-risk-calibration-dataset.json";
const earliestDate = process.env.TECHNICAL_RISK_EARLIEST_DATE ?? "2012-01-01";
const defaultTickers = [
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "AVGO", "AMD", "TSLA", "WMT",
  "JPM", "BAC", "XOM", "CVX", "KO", "PEP", "UNH", "HD", "COST", "CRM",
  "ORCL", "NFLX", "ADBE", "INTC", "QCOM", "CSCO", "MCD", "NKE", "DIS", "IBM",
  "TXN", "AMAT", "LRCX", "MU", "ADI", "KLAC", "INTU", "ADP", "ABT", "TMO",
  "DHR", "LLY", "MRK", "PFE", "AMGN", "GILD", "JNJ", "PG", "CL", "PM",
  "MO", "SBUX", "LOW", "TGT", "GS", "MS", "C", "BLK", "SCHW", "CAT",
  "DE", "GE", "HON", "UPS", "FDX", "COP", "SLB", "EOG", "NEE", "DUK",
  "SO", "LIN", "APD", "PLTR", "SHOP", "PYPL", "COIN", "MRNA", "ENPH", "FSLR",
  "RIVN", "LCID", "NIO", "U", "DKNG", "PINS", "ZM", "DOCU", "SNOW", "CRWD",
  "NET", "DDOG", "MDB", "TEAM", "OKTA", "TWLO", "SE", "MELI", "BABA", "JD",
  "PDD", "TSM", "ASML", "SMCI", "ROKU", "SNAP", "SQ", "PANW", "ZS", "ON",
];
const tickers = (process.env.TECHNICAL_RISK_TICKERS ?? defaultTickers.join(","))
  .split(",").map((ticker) => ticker.trim().toUpperCase()).filter(Boolean).slice(0, 150);
const concurrency = Math.max(1, Math.min(Number.parseInt(process.env.TECHNICAL_RISK_CONCURRENCY ?? "4", 10) || 4, 8));

type Json = Record<string, unknown>;
type PriceRow = {
  date: string;
  close: number;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
};

type TechnicalCase = {
  ticker: string;
  eventDate: string;
  features: Record<string, number | string | null>;
  outcomes: Record<string, number | null>;
  sourceUrl: string;
};

const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const finite = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/,/g, "")) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
};
const round = (value: number | null, digits = 8) => value === null || !Number.isFinite(value) ? null : Number(value.toFixed(digits));
const safe = (error: unknown) => error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 260) : "technical_dataset_error";
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fetchJson(url: string, attempts = 4): Promise<Json> {
  let last: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; SwingUpCalibration/1.0)", Referer: "https://finance.yahoo.com/" },
        signal: AbortSignal.timeout(45_000),
      });
      if (response.ok) return object(await response.json());
      last = new Error(`yahoo_http_${response.status}`);
      if (response.status !== 429 && response.status < 500) break;
    } catch (error) {
      last = error;
    }
    await sleep(700 * 2 ** attempt);
  }
  throw last instanceof Error ? last : new Error("yahoo_fetch_failed");
}

function parseChart(payload: Json, ticker: string): PriceRow[] {
  const chart = object(payload.chart);
  if (Object.keys(object(chart.error)).length) throw new Error(`yahoo_chart_error:${ticker}`);
  const result = object(array(chart.result)[0]);
  const timestamps = array(result.timestamp);
  const indicators = object(result.indicators);
  const quote = object(array(indicators.quote)[0]);
  const adjusted = object(array(indicators.adjclose)[0]);
  const adjustedCloses = array(adjusted.adjclose);
  const closes = array(quote.close);
  const opens = array(quote.open);
  const highs = array(quote.high);
  const lows = array(quote.low);
  const volumes = array(quote.volume);
  const rows = timestamps.flatMap((timestamp, index): PriceRow[] => {
    const seconds = finite(timestamp);
    const adjustedClose = finite(adjustedCloses[index]);
    const rawClose = finite(closes[index]);
    const close = adjustedClose ?? rawClose;
    if (seconds === null || close === null || close <= 0) return [];
    const adjustment = adjustedClose !== null && rawClose !== null && rawClose > 0 ? adjustedClose / rawClose : 1;
    const adjustedValue = (value: unknown) => {
      const parsed = finite(value);
      return parsed === null ? null : parsed * adjustment;
    };
    return [{
      date: new Date(seconds * 1000).toISOString().slice(0, 10),
      close,
      open: adjustedValue(opens[index]),
      high: adjustedValue(highs[index]),
      low: adjustedValue(lows[index]),
      volume: finite(volumes[index]),
    }];
  }).sort((left, right) => left.date.localeCompare(right.date));
  if (rows.length < 380) throw new Error(`insufficient_history:${ticker}:${rows.length}`);
  return rows;
}

async function priceHistory(ticker: string, start: number, end: number) {
  const errors: string[] = [];
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${start}&period2=${end}&interval=1d&events=history&includeAdjustedClose=true`;
    try {
      return { rows: parseChart(await fetchJson(url), ticker), url };
    } catch (error) {
      errors.push(`${host}:${safe(error)}`);
    }
  }
  throw new Error(`all_yahoo_sources_failed:${ticker}:${errors.join("|")}`);
}

function change(from: number, to: number) {
  return ((to / from) - 1) * 100;
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function trailingReturn(rows: PriceRow[], index: number, sessions: number) {
  const prior = rows[index - sessions];
  return prior ? change(prior.close, rows[index].close) : null;
}

function trailingDrawdown(rows: PriceRow[], index: number, sessions: number) {
  const window = rows.slice(Math.max(0, index - sessions + 1), index + 1);
  if (!window.length) return null;
  const high = Math.max(...window.map((row) => row.high ?? row.close));
  return high > 0 ? change(high, rows[index].close) : null;
}

function trailingVolatility(rows: PriceRow[], index: number, sessions: number) {
  const start = Math.max(1, index - sessions + 1);
  const returns: number[] = [];
  for (let cursor = start; cursor <= index; cursor += 1) returns.push(change(rows[cursor - 1].close, rows[cursor].close));
  const deviation = standardDeviation(returns);
  return deviation === null ? null : deviation * Math.sqrt(252);
}

function averageVolume(rows: PriceRow[], index: number, sessions: number) {
  const values = rows.slice(Math.max(0, index - sessions), index)
    .map((row) => row.volume).filter((value): value is number => value !== null && value > 0);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function rangePosition(rows: PriceRow[], index: number, sessions: number) {
  const window = rows.slice(Math.max(0, index - sessions + 1), index + 1);
  if (!window.length) return null;
  const high = Math.max(...window.map((row) => row.high ?? row.close));
  const low = Math.min(...window.map((row) => row.low ?? row.close));
  return high > low ? (rows[index].close - low) / (high - low) : 0.5;
}

function futureOutcome(rows: PriceRow[], benchmarkByDate: Map<string, PriceRow>, index: number, sessions: number) {
  const end = index + sessions;
  if (end >= rows.length) return null;
  const entry = rows[index];
  const window = rows.slice(index + 1, end + 1);
  if (!window.length) return null;
  const exit = rows[end];
  const stockReturn = change(entry.close, exit.close);
  const drawdown = Math.min(...window.map((row) => change(entry.close, row.low ?? row.close)));
  const maxGain = Math.max(...window.map((row) => change(entry.close, row.high ?? row.close)));
  const benchmarkEntry = benchmarkByDate.get(entry.date);
  const benchmarkExit = benchmarkByDate.get(exit.date);
  const benchmarkReturn = benchmarkEntry && benchmarkExit ? change(benchmarkEntry.close, benchmarkExit.close) : null;
  return { stockReturn, excessReturn: benchmarkReturn === null ? null : stockReturn - benchmarkReturn, drawdown, maxGain };
}

function technicalCases(ticker: string, rows: PriceRow[], sourceUrl: string, benchmarkByDate: Map<string, PriceRow>): TechnicalCase[] {
  const cases: TechnicalCase[] = [];
  let lastSelected = -100;
  for (let index = 252; index < rows.length - 90; index += 1) {
    const row = rows[index];
    const return1d = trailingReturn(rows, index, 1);
    const return5d = trailingReturn(rows, index, 5);
    const return20d = trailingReturn(rows, index, 20);
    const return60d = trailingReturn(rows, index, 60);
    const return120d = trailingReturn(rows, index, 120);
    const return252d = trailingReturn(rows, index, 252);
    const drawdown20d = trailingDrawdown(rows, index, 20);
    const drawdown60d = trailingDrawdown(rows, index, 60);
    const drawdown120d = trailingDrawdown(rows, index, 120);
    const volatility20d = trailingVolatility(rows, index, 20);
    const volatility60d = trailingVolatility(rows, index, 60);
    const average20d = averageVolume(rows, index, 20);
    const volumeRatio20d = row.volume !== null && average20d ? row.volume / average20d : null;
    const position252d = rangePosition(rows, index, 252);
    const unusual = Math.abs(return1d ?? 0) >= 4
      || Math.abs(return5d ?? 0) >= 8
      || Math.abs(return20d ?? 0) >= 15
      || (volumeRatio20d ?? 0) >= 2.5
      || (drawdown60d ?? 0) <= -15
      || (position252d ?? 0.5) <= 0.08;
    if (!unusual || index - lastSelected < 10) continue;
    const outcome30 = futureOutcome(rows, benchmarkByDate, index, 30);
    const outcome90 = futureOutcome(rows, benchmarkByDate, index, 90);
    if (!outcome30 || !outcome90) continue;
    const benchmark = benchmarkByDate.get(row.date);
    const benchmark20 = benchmark ? null : null;
    const gapPercent = row.open !== null && index > 0 ? change(rows[index - 1].close, row.open) : null;
    const intradayRangePercent = row.high !== null && row.low !== null && row.open !== null && row.open > 0 ? ((row.high - row.low) / row.open) * 100 : null;
    const logDollarVolume = row.volume !== null && row.close > 0 ? Math.log(Math.max(1, row.volume * row.close)) : null;
    const benchmarkIndex = benchmark ? null : null;
    void benchmark20;
    void benchmarkIndex;
    cases.push({
      ticker,
      eventDate: row.date,
      features: {
        return1d: round(return1d),
        return5d: round(return5d),
        return20d: round(return20d),
        return60d: round(return60d),
        return120d: round(return120d),
        return252d: round(return252d),
        drawdown20d: round(drawdown20d),
        drawdown60d: round(drawdown60d),
        drawdown120d: round(drawdown120d),
        volatility20d: round(volatility20d),
        volatility60d: round(volatility60d),
        volumeRatio20d: round(volumeRatio20d),
        rangePosition252d: round(position252d),
        gapPercent: round(gapPercent),
        intradayRangePercent: round(intradayRangePercent),
        logDollarVolume: round(logDollarVolume),
        month: Number(row.date.slice(5, 7)),
        year: Number(row.date.slice(0, 4)),
      },
      outcomes: {
        return30d: round(outcome30.stockReturn),
        excess30d: round(outcome30.excessReturn),
        drawdown30d: round(outcome30.drawdown),
        maxGain30d: round(outcome30.maxGain),
        return90d: round(outcome90.stockReturn),
        excess90d: round(outcome90.excessReturn),
        drawdown90d: round(outcome90.drawdown),
        maxGain90d: round(outcome90.maxGain),
      },
      sourceUrl,
    });
    lastSelected = index;
  }
  return cases;
}

async function mapLimit<T, R>(values: T[], limit: number, worker: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) return;
      results[index] = await worker(values[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

async function main() {
  const start = Math.floor(Date.parse(`${earliestDate}T00:00:00Z`) / 1000);
  const end = Math.floor((Date.now() + 2 * 86_400_000) / 1000);
  const benchmark = await priceHistory("SPY", start, end);
  const benchmarkByDate = new Map(benchmark.rows.map((row) => [row.date, row]));
  const errors: Array<{ ticker: string; error: string }> = [];
  const perTicker = await mapLimit(tickers, concurrency, async (ticker) => {
    try {
      const history = await priceHistory(ticker, start, end);
      return technicalCases(ticker, history.rows, history.url, benchmarkByDate);
    } catch (error) {
      errors.push({ ticker, error: safe(error) });
      return [];
    }
  });
  const rows = perTicker.flat().sort((left, right) => `${left.eventDate}:${left.ticker}`.localeCompare(`${right.eventDate}:${right.ticker}`));
  const dataset = {
    version: 1,
    checkedAt: new Date().toISOString(),
    sourceMode: "real_point_in_time_yahoo_adjusted_price_and_volume",
    earliestDate,
    requestedTickers: tickers,
    requestedTickerCount: tickers.length,
    tickersWithCases: [...new Set(rows.map((row) => row.ticker))],
    rows,
    sourceErrors: errors,
    selectionRule: "Unusual price, volume, drawdown, or 52-week-range event; features use only information known at the event close; minimum ten-session cooldown.",
    noSyntheticData: true,
    safety: { databaseWrites: false, r2Writes: false, publishing: false, notifications: false, payments: false, openAiCalls: false },
  };
  await mkdir(outputPath.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ok: true, rows: rows.length, requestedTickers: tickers.length, tickersWithCases: dataset.tickersWithCases.length, errors: errors.length, outputPath }, null, 2));
}

main().catch(async (error) => {
  const report = { version: 1, ok: false, checkedAt: new Date().toISOString(), fatalError: safe(error) };
  await mkdir(outputPath.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
});
