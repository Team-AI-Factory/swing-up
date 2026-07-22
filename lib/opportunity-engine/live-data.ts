import type { CompanyFoundationInput, EventSignalInput } from "./types";

export type LiveCompanyProfile = {
  ticker: string;
  cik: string;
  company: string;
  sector: string;
  industry: string;
};

export type LiveOpportunitySnapshot = {
  profile: LiveCompanyProfile;
  foundation: CompanyFoundationInput;
  event: EventSignalInput;
  metadata: {
    sourceMode: "real_live_sec_and_market_data";
    fiscalPeriod: string;
    comparisonPeriod: string;
    latestFilingForm: string;
    latestFilingDate: string;
    latestFilingAccession: string;
    companyFactsUrl: string;
    submissionsUrl: string;
    filingUrl: string;
    marketSource: string;
    marketSourceUrl: string;
    marketDate: string;
    realDataReceipts: number;
  };
};

export type LiveUniverseResult = {
  snapshots: LiveOpportunitySnapshot[];
  errors: Array<{ ticker: string; message: string }>;
};

type JsonObject = Record<string, unknown>;
type FactRow = {
  start?: string;
  end?: string;
  val: number;
  accn?: string;
  fy?: number;
  fp?: string;
  form?: string;
  filed?: string;
};

type PeriodSelection = {
  concept: string;
  current: FactRow;
  prior: FactRow;
  prior2: FactRow | null;
  kind: "quarterly" | "annual";
};

type Filing = {
  accessionNumber: string;
  filingDate: string;
  reportDate: string | null;
  acceptanceDateTime: string | null;
  form: string;
  primaryDocument: string | null;
  primaryDocDescription: string | null;
  url: string;
};

type MarketRow = {
  date: string;
  close: number;
  volume: number | null;
};

type MarketQuote = {
  price: number;
  volume: number | null;
  averageVolume: number | null;
  priceChange1d: number | null;
  priceChange20d: number | null;
  priceChange90d: number | null;
  volumeRatio: number | null;
  observedAt: string;
  marketDate: string;
  source: string;
  sourceUrl: string;
};

export const DEFAULT_LIVE_COMPANIES: LiveCompanyProfile[] = [
  { ticker: "AAPL", cik: "0000320193", company: "Apple Inc.", sector: "Technology", industry: "Technology Hardware" },
  { ticker: "MSFT", cik: "0000789019", company: "Microsoft Corporation", sector: "Technology", industry: "Software" },
  { ticker: "NVDA", cik: "0001045810", company: "NVIDIA Corporation", sector: "Technology", industry: "Semiconductors" },
  { ticker: "XOM", cik: "0000034088", company: "Exxon Mobil Corporation", sector: "Energy", industry: "Integrated Oil and Gas" },
  { ticker: "KO", cik: "0000021344", company: "The Coca-Cola Company", sector: "Consumer Staples", industry: "Beverages" },
];

const SEC_FACTS_BASE = "https://data.sec.gov/api/xbrl/companyfacts";
const SEC_SUBMISSIONS_BASE = "https://data.sec.gov/submissions";
const SEC_ARCHIVE_BASE = "https://www.sec.gov/Archives/edgar/data";
const YAHOO_CHART_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
const FINANCIAL_FORMS = new Set(["10-Q", "10-K", "20-F", "40-F"]);
const REVENUE_CONCEPTS = [
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "Revenues",
  "SalesRevenueNet",
  "SalesRevenueGoodsNet",
];
const OPERATING_INCOME_CONCEPTS = ["OperatingIncomeLoss"];
const NET_INCOME_CONCEPTS = ["NetIncomeLoss", "ProfitLoss"];
const CFO_CONCEPTS = ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"];
const CAPEX_CONCEPTS = ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsForAdditionsToPropertyPlantAndEquipment"];
const ASSET_CONCEPTS = ["Assets"];
const LIABILITY_CONCEPTS = ["Liabilities"];
const CASH_CONCEPTS = ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"];
const CURRENT_DEBT_CONCEPTS = ["DebtCurrent", "LongTermDebtCurrent", "ShortTermBorrowings", "CommercialPaper"];
const NONCURRENT_DEBT_CONCEPTS = ["LongTermDebtNoncurrent", "LongTermDebtAndFinanceLeaseObligationsNoncurrent", "LongTermDebtAndCapitalLeaseObligations"];
const SHARES_CONCEPTS = ["EntityCommonStockSharesOutstanding"];
const WEIGHTED_SHARES_CONCEPTS = ["WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfSharesOutstandingBasic"];

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finite(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/,/g, "")) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function isoDate(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const time = Date.parse(raw);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function percent(value: number | null): string {
  return value === null ? "unavailable" : `${(value * 100).toFixed(1)}%`;
}

function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  const value = numerator / denominator;
  return Number.isFinite(value) ? value : null;
}

function growth(current: number | null, prior: number | null): number | null {
  if (current === null || prior === null || prior === 0) return null;
  const value = current / prior - 1;
  return Number.isFinite(value) ? value : null;
}

function daysBetween(later: string | undefined, earlier: string | undefined): number | null {
  if (!later || !earlier) return null;
  const difference = Date.parse(later) - Date.parse(earlier);
  return Number.isFinite(difference) ? Math.round(difference / 86_400_000) : null;
}

function durationDays(row: FactRow): number | null {
  return daysBetween(row.end, row.start);
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 280) : "unknown_live_data_error";
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchWithRetry(url: string, headers: Record<string, string> = {}, attempts = 4): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json,*/*;q=0.8", ...headers },
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.ok) return response;
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === attempts - 1) throw new Error(`live_fetch_http_${response.status}:${url}`);
      lastError = new Error(`live_fetch_http_${response.status}:${url}`);
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) break;
    } finally {
      clearTimeout(timeout);
    }
    await sleep(600 * 2 ** attempt);
  }
  throw lastError instanceof Error ? lastError : new Error(`live_fetch_failed:${url}`);
}

async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<JsonObject> {
  const response = await fetchWithRetry(url, headers);
  return object(await response.json());
}

function factRows(companyFacts: JsonObject, namespace: string, concept: string, acceptedUnits: string[]): FactRow[] {
  const conceptFact = object(object(object(companyFacts.facts)[namespace])[concept]);
  const units = object(conceptFact.units);
  for (const unit of acceptedUnits) {
    const rows = array(units[unit]).flatMap((value): FactRow[] => {
      const row = object(value);
      const val = finite(row.val);
      if (val === null) return [];
      return [{
        start: text(row.start) ?? undefined,
        end: text(row.end) ?? undefined,
        val,
        accn: text(row.accn) ?? undefined,
        fy: finite(row.fy) ?? undefined,
        fp: text(row.fp) ?? undefined,
        form: text(row.form) ?? undefined,
        filed: text(row.filed) ?? undefined,
      }];
    });
    if (rows.length) return rows;
  }
  return [];
}

function dedupePeriods(rows: FactRow[]): FactRow[] {
  const ordered = [...rows].sort((left, right) => `${right.filed ?? ""}:${right.end ?? ""}`.localeCompare(`${left.filed ?? ""}:${left.end ?? ""}`));
  const seen = new Set<string>();
  const unique: FactRow[] = [];
  for (const row of ordered) {
    const key = `${row.form ?? ""}|${row.fp ?? ""}|${row.start ?? ""}|${row.end ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  return unique.sort((left, right) => `${right.end ?? ""}:${right.filed ?? ""}`.localeCompare(`${left.end ?? ""}:${left.filed ?? ""}`));
}

function comparablePrior(rows: FactRow[], current: FactRow): FactRow | null {
  if (!current.end) return null;
  return rows.find((row) => {
    if (!row.end || row.end === current.end) return false;
    const difference = daysBetween(current.end, row.end);
    return row.fp === current.fp && difference !== null && difference >= 300 && difference <= 430;
  }) ?? rows.find((row) => {
    if (!row.end || row.end === current.end) return false;
    const difference = daysBetween(current.end, row.end);
    return difference !== null && difference >= 300 && difference <= 430;
  }) ?? null;
}

function selectTrend(companyFacts: JsonObject, concepts: string[], kind: "quarterly" | "annual"): PeriodSelection | null {
  for (const concept of concepts) {
    const rows = dedupePeriods(factRows(companyFacts, "us-gaap", concept, ["USD"]).filter((row) => {
      const duration = durationDays(row);
      if (duration === null) return false;
      if (kind === "quarterly") return row.form === "10-Q" && duration >= 65 && duration <= 115;
      return row.form === "10-K" && duration >= 300 && duration <= 400;
    }));
    const current = rows[0];
    if (!current) continue;
    const prior = comparablePrior(rows, current);
    if (!prior) continue;
    return { concept, current, prior, prior2: comparablePrior(rows, prior), kind };
  }
  return null;
}

function matchingPeriodValue(companyFacts: JsonObject, concepts: string[], period: FactRow, acceptedUnits = ["USD"]): number | null {
  for (const concept of concepts) {
    const rows = factRows(companyFacts, "us-gaap", concept, acceptedUnits)
      .filter((row) => row.start === period.start && row.end === period.end && row.form === period.form)
      .sort((left, right) => `${right.filed ?? ""}`.localeCompare(`${left.filed ?? ""}`));
    if (rows[0]) return rows[0].val;
  }
  return null;
}

function latestInstant(companyFacts: JsonObject, namespace: string, concepts: string[], acceptedUnits: string[], endAtOrBefore?: string): FactRow | null {
  for (const concept of concepts) {
    const rows = factRows(companyFacts, namespace, concept, acceptedUnits)
      .filter((row) => row.end && (!endAtOrBefore || row.end <= endAtOrBefore) && FINANCIAL_FORMS.has(row.form ?? ""))
      .sort((left, right) => `${right.end ?? ""}:${right.filed ?? ""}`.localeCompare(`${left.end ?? ""}:${left.filed ?? ""}`));
    if (rows[0]) return rows[0];
  }
  return null;
}

function priorInstant(rows: FactRow[], current: FactRow): FactRow | null {
  if (!current.end) return null;
  return rows.find((row) => {
    if (!row.end || row.end === current.end) return false;
    const difference = daysBetween(current.end, row.end);
    return difference !== null && difference >= 300 && difference <= 430;
  }) ?? null;
}

function sharesTrend(companyFacts: JsonObject, endAtOrBefore: string): { current: number | null; prior: number | null } {
  for (const [namespace, concepts] of [["dei", SHARES_CONCEPTS], ["us-gaap", WEIGHTED_SHARES_CONCEPTS]] as const) {
    for (const concept of concepts) {
      const rows = factRows(companyFacts, namespace, concept, ["shares"])
        .filter((row) => row.end && row.end <= endAtOrBefore && FINANCIAL_FORMS.has(row.form ?? ""))
        .sort((left, right) => `${right.end ?? ""}:${right.filed ?? ""}`.localeCompare(`${left.end ?? ""}:${left.filed ?? ""}`));
      const current = rows[0];
      if (!current) continue;
      return { current: current.val, prior: priorInstant(rows, current)?.val ?? null };
    }
  }
  return { current: null, prior: null };
}

function latestFinancialFiling(submissions: JsonObject, profile: LiveCompanyProfile): Filing {
  const recent = object(object(submissions.filings).recent);
  const forms = array(recent.form);
  const accessions = array(recent.accessionNumber);
  const filingDates = array(recent.filingDate);
  const reportDates = array(recent.reportDate);
  const acceptanceDates = array(recent.acceptanceDateTime);
  const primaryDocuments = array(recent.primaryDocument);
  const primaryDescriptions = array(recent.primaryDocDescription);
  for (let index = 0; index < forms.length; index += 1) {
    const form = text(forms[index]);
    const accessionNumber = text(accessions[index]);
    const filingDate = text(filingDates[index]);
    if (!form || !accessionNumber || !filingDate || !FINANCIAL_FORMS.has(form)) continue;
    const primaryDocument = text(primaryDocuments[index]);
    const cleanCik = String(Number(profile.cik));
    const cleanAccession = accessionNumber.replace(/-/g, "");
    const url = primaryDocument
      ? `${SEC_ARCHIVE_BASE}/${cleanCik}/${cleanAccession}/${primaryDocument}`
      : `${SEC_ARCHIVE_BASE}/${cleanCik}/${cleanAccession}/`;
    return {
      accessionNumber,
      filingDate,
      reportDate: text(reportDates[index]),
      acceptanceDateTime: isoDate(acceptanceDates[index]),
      form,
      primaryDocument,
      primaryDocDescription: text(primaryDescriptions[index]),
      url,
    };
  }
  throw new Error(`no_recent_financial_sec_filing:${profile.ticker}`);
}

function parseYahooChart(json: JsonObject, ticker: string, sourceUrl: string): MarketQuote {
  const chart = object(json.chart);
  const error = object(chart.error);
  if (Object.keys(error).length) throw new Error(`yahoo_chart_error:${ticker}:${text(error.description) ?? text(error.code) ?? "unknown"}`);
  const result = object(array(chart.result)[0]);
  const timestamps = array(result.timestamp);
  const indicators = object(result.indicators);
  const quote = object(array(indicators.quote)[0]);
  const closes = array(quote.close);
  const volumes = array(quote.volume);
  const rows: MarketRow[] = timestamps.flatMap((timestamp, index) => {
    const seconds = finite(timestamp);
    const close = finite(closes[index]);
    if (seconds === null || close === null || close <= 0) return [];
    return [{ date: new Date(seconds * 1000).toISOString().slice(0, 10), close, volume: finite(volumes[index]) }];
  }).sort((left, right) => left.date.localeCompare(right.date));
  if (rows.length < 25) throw new Error(`yahoo_insufficient_history:${ticker}:${rows.length}`);
  const latest = rows.at(-1)!;
  const previous = rows.at(-2)!;
  const point20 = rows.length > 20 ? rows.at(-21)! : rows[0];
  const point90 = rows.length > 90 ? rows.at(-91)! : rows[0];
  const recentVolumes = rows.slice(Math.max(0, rows.length - 21), -1).map((row) => row.volume).filter((value): value is number => value !== null && value > 0);
  const averageVolume = recentVolumes.length ? recentVolumes.reduce((sum, value) => sum + value, 0) / recentVolumes.length : null;
  const changePercent = (base: number) => Number((((latest.close / base) - 1) * 100).toFixed(4));
  return {
    price: latest.close,
    volume: latest.volume,
    averageVolume,
    priceChange1d: changePercent(previous.close),
    priceChange20d: changePercent(point20.close),
    priceChange90d: changePercent(point90.close),
    volumeRatio: latest.volume !== null && averageVolume ? latest.volume / averageVolume : null,
    observedAt: `${latest.date}T00:00:00.000Z`,
    marketDate: latest.date,
    source: "Yahoo Finance public chart API",
    sourceUrl,
  };
}

async function fetchMarketQuote(profile: LiveCompanyProfile, now: Date): Promise<MarketQuote> {
  const period1 = Math.floor((now.getTime() - 220 * 86_400_000) / 1000);
  const period2 = Math.floor((now.getTime() + 86_400_000) / 1000);
  const failures: string[] = [];
  for (const host of YAHOO_CHART_HOSTS) {
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(profile.ticker)}?period1=${period1}&period2=${period2}&interval=1d&events=history&includeAdjustedClose=true`;
    try {
      const json = await fetchJson(url, {
        "User-Agent": "Mozilla/5.0 (compatible; SwingUpResearch/1.0)",
        Referer: "https://finance.yahoo.com/",
      });
      return parseYahooChart(json, profile.ticker, url);
    } catch (error) {
      failures.push(`${host}:${safeError(error)}`);
    }
  }
  throw new Error(`all_live_market_sources_failed:${profile.ticker}:${failures.join("|")}`);
}

function buildEvent(profile: LiveCompanyProfile, filing: Filing, foundation: CompanyFoundationInput): EventSignalInput {
  const revenueGrowth = foundation.metrics.revenueGrowthYoY;
  const margin = foundation.metrics.operatingMargin;
  const priorMargin = foundation.metrics.priorOperatingMargin;
  const marginChange = margin !== null && priorMargin !== null ? margin - priorMargin : null;
  const positiveGrowth = revenueGrowth !== null && revenueGrowth >= 0.03;
  const negativeGrowth = revenueGrowth !== null && revenueGrowth <= -0.03;
  const marginExpansion = marginChange !== null && marginChange >= 0.002;
  const marginPressure = marginChange !== null && marginChange <= -0.002;
  let title = `Official SEC ${filing.form} updates reported fundamentals`;
  if (positiveGrowth && marginExpansion) title = `Official SEC ${filing.form} shows revenue growth and margin expansion`;
  else if (negativeGrowth && marginPressure) title = `Official SEC ${filing.form} shows revenue decline and margin pressure`;
  else if (positiveGrowth) title = `Official SEC ${filing.form} shows revenue growth`;
  else if (negativeGrowth) title = `Official SEC ${filing.form} shows revenue decline`;
  else if (marginExpansion) title = `Official SEC ${filing.form} shows margin expansion`;
  else if (marginPressure) title = `Official SEC ${filing.form} shows margin pressure`;
  return {
    rawSignalId: `sec:${filing.accessionNumber}`,
    ticker: profile.ticker,
    signalType: filing.form,
    title,
    summary: [
      `${profile.company} filed ${filing.form} on ${filing.filingDate}.`,
      `Comparable-period revenue growth was ${percent(revenueGrowth)}.`,
      `Operating margin changed from ${percent(priorMargin)} to ${percent(margin)}.`,
      `Accession ${filing.accessionNumber}.`,
    ].join(" "),
    source: "SEC EDGAR",
    sourceUrl: filing.url,
    receivedAt: filing.acceptanceDateTime ?? `${filing.filingDate}T00:00:00.000Z`,
    importanceHint: "high",
    payload: {
      sourceMode: "real_live_sec_and_market_data",
      accessionNumber: filing.accessionNumber,
      filingDate: filing.filingDate,
      reportDate: filing.reportDate,
      form: filing.form,
      primaryDocument: filing.primaryDocument,
      primaryDocDescription: filing.primaryDocDescription,
      revenueGrowthYoY: revenueGrowth,
      operatingMargin: margin,
      priorOperatingMargin: priorMargin,
      derivedFromOfficialFacts: true,
      noSyntheticData: true,
    },
  };
}

export async function fetchLiveOpportunitySnapshot(profile: LiveCompanyProfile, now = new Date()): Promise<LiveOpportunitySnapshot> {
  const userAgent = process.env.SEC_USER_AGENT?.trim() || "Swing Up research automation contact@example.com";
  const companyFactsUrl = `${SEC_FACTS_BASE}/CIK${profile.cik}.json`;
  const submissionsUrl = `${SEC_SUBMISSIONS_BASE}/CIK${profile.cik}.json`;
  const secHeaders = { "User-Agent": userAgent, "Accept-Encoding": "gzip, deflate" };
  const [companyFacts, submissions, market] = await Promise.all([
    fetchJson(companyFactsUrl, secHeaders),
    fetchJson(submissionsUrl, secHeaders),
    fetchMarketQuote(profile, now),
  ]);
  const period = selectTrend(companyFacts, REVENUE_CONCEPTS, "quarterly") ?? selectTrend(companyFacts, REVENUE_CONCEPTS, "annual");
  const annual = selectTrend(companyFacts, REVENUE_CONCEPTS, "annual");
  if (!period || !annual) throw new Error(`comparable_sec_revenue_periods_unavailable:${profile.ticker}`);
  const filing = latestFinancialFiling(submissions, profile);
  const currentRevenue = period.current.val;
  const priorRevenue = period.prior.val;
  const prior2Revenue = period.prior2?.val ?? null;
  const currentOperatingIncome = matchingPeriodValue(companyFacts, OPERATING_INCOME_CONCEPTS, period.current);
  const priorOperatingIncome = matchingPeriodValue(companyFacts, OPERATING_INCOME_CONCEPTS, period.prior);
  const currentNetIncome = matchingPeriodValue(companyFacts, NET_INCOME_CONCEPTS, period.current);
  const annualRevenue = annual.current.val;
  const annualNetIncome = matchingPeriodValue(companyFacts, NET_INCOME_CONCEPTS, annual.current);
  const annualCfo = matchingPeriodValue(companyFacts, CFO_CONCEPTS, annual.current);
  const annualCapexRaw = matchingPeriodValue(companyFacts, CAPEX_CONCEPTS, annual.current);
  const annualCapex = annualCapexRaw === null ? null : Math.abs(annualCapexRaw);
  const freeCashFlow = annualCfo === null || annualCapex === null ? null : annualCfo - annualCapex;
  const periodEnd = period.current.end ?? annual.current.end ?? filing.reportDate ?? filing.filingDate;
  const assets = latestInstant(companyFacts, "us-gaap", ASSET_CONCEPTS, ["USD"], periodEnd)?.val ?? null;
  const liabilities = latestInstant(companyFacts, "us-gaap", LIABILITY_CONCEPTS, ["USD"], periodEnd)?.val ?? null;
  const cash = latestInstant(companyFacts, "us-gaap", CASH_CONCEPTS, ["USD"], periodEnd)?.val ?? null;
  const currentDebt = latestInstant(companyFacts, "us-gaap", CURRENT_DEBT_CONCEPTS, ["USD"], periodEnd)?.val ?? 0;
  const noncurrentDebt = latestInstant(companyFacts, "us-gaap", NONCURRENT_DEBT_CONCEPTS, ["USD"], periodEnd)?.val ?? 0;
  const shares = sharesTrend(companyFacts, periodEnd);
  const totalDebt = currentDebt + noncurrentDebt;
  const marketCap = shares.current === null ? null : market.price * shares.current;
  const trailingPe = marketCap !== null && annualNetIncome !== null && annualNetIncome > 0 ? marketCap / annualNetIncome : null;
  const priceToSales = ratio(marketCap, annualRevenue);
  const freeCashFlowYield = ratio(freeCashFlow, marketCap);
  const revenueGrowthYoY = growth(currentRevenue, priorRevenue);
  const priorRevenueGrowthYoY = growth(priorRevenue, prior2Revenue);
  const operatingMargin = ratio(currentOperatingIncome, currentRevenue);
  const priorOperatingMargin = ratio(priorOperatingIncome, priorRevenue);
  const netMargin = ratio(currentNetIncome, currentRevenue);
  const freeCashFlowMargin = ratio(freeCashFlow, annualRevenue);
  const missingFields = [
    ["metrics.revenueGrowthYoY", revenueGrowthYoY],
    ["metrics.operatingMargin", operatingMargin],
    ["metrics.netMargin", netMargin],
    ["metrics.freeCashFlowMargin", freeCashFlowMargin],
    ["metrics.debtToAssets", ratio(totalDebt, assets)],
    ["valuation.marketCap", marketCap],
    ["valuation.priceToSales", priceToSales],
    ["market.currentPrice", market.price],
  ].filter((entry) => entry[1] === null).map((entry) => String(entry[0]));
  const foundation: CompanyFoundationInput = {
    ticker: profile.ticker,
    company: text(companyFacts.entityName) ?? profile.company,
    sector: profile.sector,
    industry: profile.industry,
    observedAt: new Date().toISOString(),
    fiscalPeriod: `${period.kind}:${period.current.start ?? "unknown"}:${period.current.end ?? "unknown"}`,
    metrics: {
      revenueGrowthYoY,
      priorRevenueGrowthYoY,
      operatingMargin,
      priorOperatingMargin,
      netMargin,
      freeCashFlowMargin,
      cashToLiabilities: ratio(cash, liabilities),
      debtToAssets: ratio(totalDebt, assets),
      sharesGrowthYoY: growth(shares.current, shares.prior),
      returnOnAssets: ratio(annualNetIncome, assets),
    },
    valuation: {
      marketCap,
      priceToSales,
      priceToEarnings: trailingPe,
      freeCashFlowYield,
      forwardPriceToEarnings: null,
    },
    market: {
      currentPrice: market.price,
      priceChange1d: market.priceChange1d,
      priceChange20d: market.priceChange20d,
      priceChange90d: market.priceChange90d,
      volumeRatio: market.volumeRatio,
      priceObservedAt: market.observedAt,
    },
    expectations: {
      analystRevisionScore: null,
      earningsSurprisePercent: null,
      consensusRevenueGrowthPercent: null,
    },
    catalyst: {
      description: `Latest official ${filing.form} filed ${filing.filingDate}`,
      expectedAt: null,
      confidence: 95,
    },
    receipts: [
      { source: "SEC Company Facts", url: companyFactsUrl, observedAt: new Date().toISOString(), reliability: "official", fields: [period.concept, annual.concept] },
      { source: `SEC ${filing.form}`, url: filing.url, observedAt: filing.acceptanceDateTime ?? `${filing.filingDate}T00:00:00.000Z`, reliability: "official", fields: [filing.accessionNumber] },
      { source: market.source, url: market.sourceUrl, observedAt: market.observedAt, reliability: "medium", fields: ["close", "volume", "1d", "20d", "90d"] },
    ],
    missingFields,
    warnings: [
      "This live harness uses official SEC filings and a real public daily market-data feed; market data can be delayed.",
      "Consensus estimates and analyst revisions are intentionally not invented. They remain unavailable until a verified estimates provider is connected.",
      ...(period.kind === "annual" ? ["Quarterly comparable revenue was unavailable, so annual comparable periods were used."] : []),
    ],
    raw: {
      sourceMode: "real_live_sec_and_market_data",
      companyFactsUrl,
      submissionsUrl,
      filing,
      period: { kind: period.kind, concept: period.concept, current: period.current, prior: period.prior, prior2: period.prior2 },
      annual: { concept: annual.concept, current: annual.current, prior: annual.prior },
      market: { source: market.source, sourceUrl: market.sourceUrl, marketDate: market.marketDate },
      noSyntheticData: true,
    },
  };
  return {
    profile,
    foundation,
    event: buildEvent(profile, filing, foundation),
    metadata: {
      sourceMode: "real_live_sec_and_market_data",
      fiscalPeriod: foundation.fiscalPeriod ?? "unknown",
      comparisonPeriod: `${period.prior.start ?? "unknown"}:${period.prior.end ?? "unknown"}`,
      latestFilingForm: filing.form,
      latestFilingDate: filing.filingDate,
      latestFilingAccession: filing.accessionNumber,
      companyFactsUrl,
      submissionsUrl,
      filingUrl: filing.url,
      marketSource: market.source,
      marketSourceUrl: market.sourceUrl,
      marketDate: market.marketDate,
      realDataReceipts: foundation.receipts.length,
    },
  };
}

export async function fetchLiveOpportunityUniverse(tickers: string[], now = new Date()): Promise<LiveUniverseResult> {
  const requested = [...new Set(tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean))].slice(0, 10);
  const profiles = requested.length
    ? requested.flatMap((ticker) => DEFAULT_LIVE_COMPANIES.find((profile) => profile.ticker === ticker) ?? [])
    : DEFAULT_LIVE_COMPANIES;
  const unknown = requested.filter((ticker) => !DEFAULT_LIVE_COMPANIES.some((profile) => profile.ticker === ticker));
  const snapshots: LiveOpportunitySnapshot[] = [];
  const errors: Array<{ ticker: string; message: string }> = unknown.map((ticker) => ({ ticker, message: "ticker_not_in_branch_live_test_universe" }));
  for (const profile of profiles) {
    try {
      snapshots.push(await fetchLiveOpportunitySnapshot(profile, now));
    } catch (error) {
      errors.push({ ticker: profile.ticker, message: safeError(error) });
    }
    await sleep(250);
  }
  return { snapshots, errors };
}
