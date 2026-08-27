import type { CompanyFoundationInput } from "./types";

type Json = Record<string, unknown>;
type Fact = { start?: string; end?: string; val: number; accn?: string; fp?: string; form?: string; filed?: string };
type Price = { date: string; close: number; volume: number | null };

export type HistoricalOpportunityCase = {
  ticker: string;
  company: string;
  filingDate: string;
  accession: string;
  input: CompanyFoundationInput;
  return30d: number;
  excess30d: number;
  drawdown30d: number;
  return90d: number;
  excess90d: number;
  drawdown90d: number;
};

const SEC_HEADERS = {
  "User-Agent": process.env.SEC_USER_AGENT?.trim() || "Swing Up calibration research contact@example.com",
  Accept: "application/json,*/*",
};
const REVENUE = ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "SalesRevenueGoodsNet"];
const OPERATING = ["OperatingIncomeLoss"];
const NET = ["NetIncomeLoss", "ProfitLoss"];
const ASSETS = ["Assets"];
const LIABILITIES = ["Liabilities"];
const SHARES = [["dei", ["EntityCommonStockSharesOutstanding"]], ["us-gaap", ["WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfSharesOutstandingBasic"]]] as const;

const obj = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const arr = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const str = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const num = (value: unknown) => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/,/g, "")) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
};
const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function safe(error: unknown) {
  return error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 240) : "historical_source_failed";
}

async function json(url: string, headers: Record<string, string> = {}, attempts = 4): Promise<Json> {
  let last: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { Accept: "application/json", ...headers }, cache: "no-store", signal: AbortSignal.timeout(30_000) });
      if (response.ok) return obj(await response.json());
      last = new Error(`http_${response.status}:${url}`);
      if (response.status < 500 && response.status !== 429) break;
    } catch (error) {
      last = error;
    }
    await wait(600 * 2 ** attempt);
  }
  throw last instanceof Error ? last : new Error(`fetch_failed:${url}`);
}

function facts(company: Json, namespace: string, concept: string, units: string[]): Fact[] {
  const unitMap = obj(obj(obj(company.facts)[namespace])[concept]).units;
  for (const unit of units) {
    const rows = arr(obj(unitMap)[unit]).flatMap((value): Fact[] => {
      const row = obj(value);
      const val = num(row.val);
      return val === null ? [] : [{ start: str(row.start) ?? undefined, end: str(row.end) ?? undefined, val, accn: str(row.accn) ?? undefined, fp: str(row.fp) ?? undefined, form: str(row.form) ?? undefined, filed: str(row.filed) ?? undefined }];
    });
    if (rows.length) return rows;
  }
  return [];
}

function days(later?: string, earlier?: string) {
  if (!later || !earlier) return null;
  const value = (Date.parse(later) - Date.parse(earlier)) / 86_400_000;
  return Number.isFinite(value) ? value : null;
}

function quarterly(company: Json, earliest: string) {
  for (const concept of REVENUE) {
    const seen = new Set<string>();
    const rows = facts(company, "us-gaap", concept, ["USD"])
      .filter((row) => {
        const duration = days(row.end, row.start);
        return row.form === "10-Q" && Boolean(row.filed && row.filed >= earliest) && duration !== null && duration >= 60 && duration <= 125;
      })
      .sort((left, right) => `${left.filed}:${left.end}`.localeCompare(`${right.filed}:${right.end}`))
      .filter((row) => {
        const key = `${row.accn}|${row.start}|${row.end}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    if (rows.length >= 8) return rows;
  }
  return [];
}

function prior(rows: Fact[], current: Fact) {
  return [...rows].reverse().find((row) => {
    if (!row.end || !current.end || row.end >= current.end) return false;
    const difference = days(current.end, row.end);
    return difference !== null && difference >= 300 && difference <= 430 && (!current.fp || !row.fp || current.fp === row.fp);
  }) ?? null;
}

function periodValue(company: Json, concepts: string[], period: Fact) {
  for (const concept of concepts) {
    const match = facts(company, "us-gaap", concept, ["USD"])
      .filter((row) => row.start === period.start && row.end === period.end && row.form === period.form && (!period.accn || row.accn === period.accn))
      .sort((left, right) => String(right.filed ?? "").localeCompare(String(left.filed ?? "")))[0];
    if (match) return match.val;
  }
  return null;
}

function instant(company: Json, namespace: string, concepts: readonly string[], units: string[], end: string, filed: string) {
  for (const concept of concepts) {
    const match = facts(company, namespace, concept, units)
      .filter((row) => row.end && row.end <= end && row.filed && row.filed <= filed && ["10-Q", "10-K"].includes(row.form ?? ""))
      .sort((left, right) => `${right.end}:${right.filed}`.localeCompare(`${left.end}:${left.filed}`))[0];
    if (match) return match.val;
  }
  return null;
}

function shares(company: Json, end: string, filed: string) {
  for (const [namespace, concepts] of SHARES) {
    const value = instant(company, namespace, concepts, ["shares"], end, filed);
    if (value !== null) return value;
  }
  return null;
}

function parsePrices(data: Json, ticker: string) {
  const chart = obj(data.chart);
  if (Object.keys(obj(chart.error)).length) throw new Error(`yahoo_error:${ticker}`);
  const result = obj(arr(chart.result)[0]);
  const timestamps = arr(result.timestamp);
  const quote = obj(arr(obj(result.indicators).quote)[0]);
  const closes = arr(quote.close);
  const volumes = arr(quote.volume);
  const rows = timestamps.flatMap((timestamp, index): Price[] => {
    const seconds = num(timestamp);
    const close = num(closes[index]);
    return seconds === null || close === null || close <= 0 ? [] : [{ date: new Date(seconds * 1000).toISOString().slice(0, 10), close, volume: num(volumes[index]) }];
  }).sort((left, right) => left.date.localeCompare(right.date));
  if (rows.length < 100) throw new Error(`insufficient_yahoo_history:${ticker}`);
  return rows;
}

async function priceHistory(ticker: string, period1: number, period2: number) {
  const errors: string[] = [];
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d&events=history&includeAdjustedClose=true`;
    try {
      return { rows: parsePrices(await json(url, { "User-Agent": "Mozilla/5.0 (compatible; SwingUpCalibration/1.0)", Referer: "https://finance.yahoo.com/" }), ticker), url };
    } catch (error) {
      errors.push(`${host}:${safe(error)}`);
    }
  }
  throw new Error(`all_yahoo_sources_failed:${ticker}:${errors.join("|")}`);
}

function after(rows: Price[], date: string) {
  return rows.findIndex((row) => row.date > date);
}

function atOrAfter(rows: Price[], date: string) {
  return rows.findIndex((row) => row.date >= date);
}

function change(from: number, to: number) {
  return ((to / from) - 1) * 100;
}

function outcome(rows: Price[], benchmark: Price[], entryIndex: number, horizon: 30 | 90) {
  const entry = rows[entryIndex];
  const target = new Date(Date.parse(`${entry.date}T00:00:00Z`) + horizon * 86_400_000).toISOString().slice(0, 10);
  const exitIndex = atOrAfter(rows, target);
  const benchmarkEntry = atOrAfter(benchmark, entry.date);
  const benchmarkExit = atOrAfter(benchmark, target);
  if (exitIndex < 0 || benchmarkEntry < 0 || benchmarkExit < 0) return null;
  const stockReturn = change(entry.close, rows[exitIndex].close);
  const benchmarkReturn = change(benchmark[benchmarkEntry].close, benchmark[benchmarkExit].close);
  const drawdown = Math.min(...rows.slice(entryIndex, exitIndex + 1).map((row) => change(entry.close, row.close)));
  return { stockReturn, excessReturn: stockReturn - benchmarkReturn, drawdown };
}

function ratio(numerator: number | null, denominator: number | null) {
  return numerator !== null && denominator !== null && denominator !== 0 ? numerator / denominator : null;
}

function inputFor(ticker: string, companyName: string, company: Json, factsUrl: string, marketUrl: string, market: Price[], current: Fact, previous: Fact, previous2: Fact | null, entryIndex: number): CompanyFoundationInput {
  const operating = periodValue(company, OPERATING, current);
  const priorOperating = periodValue(company, OPERATING, previous);
  const netIncome = periodValue(company, NET, current);
  const assets = instant(company, "us-gaap", ASSETS, ["USD"], current.end!, current.filed!);
  const liabilities = instant(company, "us-gaap", LIABILITIES, ["USD"], current.end!, current.filed!);
  const shareCount = shares(company, current.end!, current.filed!);
  const price = market[entryIndex];
  const marketCap = shareCount === null ? null : shareCount * price.close;
  const annualRevenue = current.val * 4;
  const annualIncome = netIncome === null ? null : netIncome * 4;
  const growth = previous.val ? current.val / previous.val - 1 : null;
  const previousGrowth = previous2?.val ? previous.val / previous2.val - 1 : null;
  const margin = ratio(operating, current.val);
  const priorMargin = ratio(priorOperating, previous.val);
  const point20 = market[Math.max(0, entryIndex - 20)];
  const point90 = market[Math.max(0, entryIndex - 90)];
  const recentVolumes = market.slice(Math.max(0, entryIndex - 20), entryIndex).map((row) => row.volume).filter((value): value is number => value !== null && value > 0);
  const averageVolume = recentVolumes.length ? recentVolumes.reduce((sum, value) => sum + value, 0) / recentVolumes.length : null;
  return {
    ticker,
    company: companyName,
    sector: null,
    industry: null,
    observedAt: `${price.date}T00:00:00Z`,
    fiscalPeriod: `quarterly:${current.start}:${current.end}`,
    metrics: {
      revenueGrowthYoY: growth,
      priorRevenueGrowthYoY: previousGrowth,
      operatingMargin: margin,
      priorOperatingMargin: priorMargin,
      netMargin: ratio(netIncome, current.val),
      freeCashFlowMargin: null,
      cashToLiabilities: null,
      debtToAssets: null,
      sharesGrowthYoY: null,
      returnOnAssets: ratio(annualIncome, assets),
    },
    valuation: {
      marketCap,
      priceToSales: ratio(marketCap, annualRevenue),
      priceToEarnings: annualIncome !== null && annualIncome > 0 ? ratio(marketCap, annualIncome) : null,
      freeCashFlowYield: null,
      forwardPriceToEarnings: null,
    },
    market: {
      currentPrice: price.close,
      priceChange1d: entryIndex ? change(market[entryIndex - 1].close, price.close) : null,
      priceChange20d: point20 ? change(point20.close, price.close) : null,
      priceChange90d: point90 ? change(point90.close, price.close) : null,
      volumeRatio: price.volume !== null && averageVolume ? price.volume / averageVolume : null,
      priceObservedAt: `${price.date}T00:00:00Z`,
      priceSourceCount: 1,
    },
    expectations: { analystRevisionScore: null, earningsSurprisePercent: null, consensusRevenueGrowthPercent: null, sources: [] },
    catalyst: { description: `Historical SEC 10-Q filed ${current.filed}`, expectedAt: null, confidence: 95 },
    receipts: [
      { source: "SEC Company Facts", url: factsUrl, observedAt: `${current.filed}T00:00:00Z`, reliability: "official", fields: ["reported fundamentals"] },
      { source: "SEC 10-Q", url: `https://www.sec.gov/Archives/edgar/data/${current.accn?.replace(/-/g, "") ?? ""}`, observedAt: `${current.filed}T00:00:00Z`, reliability: "official", fields: [current.accn ?? "unknown"] },
      { source: "Yahoo Finance historical chart", url: marketUrl, observedAt: `${price.date}T00:00:00Z`, reliability: "medium", fields: ["price", "volume"] },
    ],
    missingFields: [
      ...(margin === null ? ["metrics.operatingMargin"] : []),
      ...(marketCap === null ? ["valuation.marketCap"] : []),
      ...(liabilities === null ? ["metrics.cashToLiabilities"] : []),
      "metrics.freeCashFlowMargin",
      "expectations",
    ],
    warnings: ["Historical case uses only data available at the filing date.", "Historical analyst expectations were unavailable and were not invented."],
    raw: { historicalCalibrationCase: true, accession: current.accn, noSyntheticData: true },
  };
}

export async function buildHistoricalOpportunityCases(tickers: string[], earliest = "2016-01-01") {
  const start = Math.floor(Date.parse(`${earliest}T00:00:00Z`) / 1000);
  const end = Math.floor((Date.now() + 2 * 86_400_000) / 1000);
  const tickerData = await json("https://www.sec.gov/files/company_tickers.json", SEC_HEADERS);
  const tickerMap = new Map(Object.values(tickerData).map((value) => {
    const row = obj(value);
    return [String(row.ticker ?? "").toUpperCase(), { cik: String(row.cik_str ?? "").padStart(10, "0"), company: String(row.title ?? row.ticker ?? "") }];
  }));
  const benchmark = await priceHistory("SPY", start, end);
  const cases: HistoricalOpportunityCase[] = [];
  const errors: Array<{ ticker: string; error: string }> = [];
  for (const ticker of [...new Set(tickers.map((value) => value.trim().toUpperCase()).filter(Boolean))]) {
    try {
      const metadata = tickerMap.get(ticker);
      if (!metadata?.cik) throw new Error("ticker_to_cik_unavailable");
      const factsUrl = `https://data.sec.gov/api/xbrl/companyfacts/CIK${metadata.cik}.json`;
      const [company, market] = await Promise.all([json(factsUrl, SEC_HEADERS), priceHistory(ticker, start, end)]);
      const periods = quarterly(company, earliest);
      for (const current of periods) {
        if (!current.filed || !current.end || !current.accn) continue;
        const previous = prior(periods, current);
        if (!previous) continue;
        const entryIndex = after(market.rows, current.filed);
        if (entryIndex < 90) continue;
        const result30 = outcome(market.rows, benchmark.rows, entryIndex, 30);
        const result90 = outcome(market.rows, benchmark.rows, entryIndex, 90);
        if (!result30 || !result90) continue;
        cases.push({
          ticker,
          company: str(company.entityName) ?? metadata.company,
          filingDate: current.filed,
          accession: current.accn,
          input: inputFor(ticker, str(company.entityName) ?? metadata.company, company, factsUrl, market.url, market.rows, current, previous, prior(periods, previous), entryIndex),
          return30d: result30.stockReturn,
          excess30d: result30.excessReturn,
          drawdown30d: result30.drawdown,
          return90d: result90.stockReturn,
          excess90d: result90.excessReturn,
          drawdown90d: result90.drawdown,
        });
      }
    } catch (error) {
      errors.push({ ticker, error: safe(error) });
    }
    await wait(300);
  }
  return { cases: cases.sort((left, right) => `${left.filingDate}:${left.ticker}`.localeCompare(`${right.filingDate}:${right.ticker}`)), errors };
}
