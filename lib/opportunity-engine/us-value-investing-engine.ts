import {
  getR2Config,
  writeVersionedJsonToR2,
} from "@/lib/r2-warehouse";

export type ValueAlertAction = "buy" | "sell" | "watch_out" | "watch" | "no_action";
export type ValueAlertTier =
  | "serious_foundation_buy"
  | "serious_foundation_sell"
  | "serious_foundation_watch_out"
  | "quality_price_watchlist"
  | "research_only"
  | "insufficient_evidence";

export type ValueMethod = {
  method: "earnings_power" | "owner_earnings_fcf" | "graham_value";
  value: number;
  assumption: string;
};

export type UsValueCompanyAnalysis = {
  ticker: string;
  tradingViewSymbol: string;
  company: string;
  exchange: string;
  sector: string | null;
  industry: string | null;
  currency: string | null;
  observedAt: string;
  currentPrice: number;
  marketCap: number | null;
  estimatedAverageDollarVolume10d: number | null;
  fundamentals: {
    revenue: number | null;
    netIncome: number | null;
    freeCashFlow: number | null;
    dilutedEpsTtm: number | null;
    revenueGrowthTtmPercent: number | null;
    revenueGrowthFyPercent: number | null;
    netIncomeGrowthTtmPercent: number | null;
    epsGrowthTtmPercent: number | null;
    grossMarginPercent: number | null;
    operatingMarginPercent: number | null;
    netMarginPercent: number | null;
    debtToEquityPercent: number | null;
    currentRatio: number | null;
    returnOnEquityPercent: number | null;
    returnOnAssetsPercent: number | null;
  };
  valuation: {
    priceToEarnings: number | null;
    priceToBook: number | null;
    priceToSales: number | null;
    enterpriseValueToEbitda: number | null;
    providerTargetPrice: number | null;
    providerAnalystCount: number | null;
  };
  scores: {
    businessQuality: number;
    profitability: number;
    balanceSheet: number;
    growthDurability: number;
    cashGeneration: number;
    risk: number;
    evidenceCompleteness: number;
    fairValueConfidence: number;
  };
  fairValue: {
    methods: ValueMethod[];
    conservativeValue: number | null;
    baseValue: number | null;
    optimisticValue: number | null;
    buyBelowPrice: number | null;
    strongBuyBelowPrice: number | null;
    trimAbovePrice: number | null;
    upsideToBasePercent: number | null;
    discountToBasePercent: number | null;
    marginOfSafetyPercent: number | null;
  };
  decision: {
    action: ValueAlertAction;
    tier: ValueAlertTier;
    seriousSignal: boolean;
    userAlertEligible: false;
    publicationStatus: "serious_internal_review_only" | "watchlist_internal" | "research_only";
    historicallyCertified: false;
    evidenceTriggered: boolean;
    noNewsRequired: true;
    reasons: string[];
    blockers: string[];
  };
};

export type UsValueInvestingCycle = {
  ok: boolean;
  checkedAt: string;
  marketScope: "US listed common stocks and ADRs only";
  methodology: {
    style: "company_first_conservative_intrinsic_value";
    analystTargetUsedAsFairValue: false;
    newsRequiredForFoundationAlert: false;
    fullFundamentalRefreshMinutes: number;
    fullWarehousePersistenceHours: number;
    minimumMarginOfSafetyPercent: number;
    seriousBuyMinimumUpsidePercent: number;
    seriousSellMinimumPremiumPercent: number;
    noSyntheticData: true;
  };
  coverage: {
    provider: "TradingView public US stock scanner";
    totalProviderRows: number;
    usPrimaryListings: number;
    companiesAnalyzed: number;
    companiesWithFairValue: number;
    companiesWithoutFairValue: number;
    pagesRequested: number;
    pagesFailed: number;
    processingCoveragePercent: number;
    errors: string[];
  };
  seriousAlerts: {
    buy: UsValueCompanyAnalysis[];
    sell: UsValueCompanyAnalysis[];
    watchOut: UsValueCompanyAnalysis[];
  };
  watchlists: {
    qualityWaitingForPrice: UsValueCompanyAnalysis[];
    researchOnly: UsValueCompanyAnalysis[];
  };
  warehouse: {
    storage: "cloudflare_r2" | "not_persisted";
    branchPrefix: "branch-labs/pr-262/value-investing";
    latestIndexKey: string;
    immutableRunKey: string | null;
    shardKeys: string[];
    persistedThisCycle: boolean;
    companyRecordsStored: number;
    errors: string[];
  };
  cacheUsed: boolean;
  analyses: UsValueCompanyAnalysis[];
  safety: {
    databaseWrites: false;
    publishing: false;
    notifications: false;
    trades: false;
  };
};

type Json = Record<string, unknown>;
type RawRow = {
  ticker: string;
  tradingViewSymbol: string;
  company: string;
  exchange: string;
  country: string | null;
  currency: string | null;
  currentPrice: number;
  changePercent: number | null;
  volume: number | null;
  relativeVolume10d: number | null;
  marketCap: number | null;
  sector: string | null;
  industry: string | null;
  priceToEarnings: number | null;
  priceToBook: number | null;
  priceToSales: number | null;
  enterpriseValueToEbitda: number | null;
  totalRevenue: number | null;
  netIncome: number | null;
  freeCashFlow: number | null;
  dilutedEpsTtm: number | null;
  revenueGrowthTtmPercent: number | null;
  revenueGrowthFyPercent: number | null;
  netIncomeGrowthTtmPercent: number | null;
  epsGrowthTtmPercent: number | null;
  grossMarginPercent: number | null;
  operatingMarginPercent: number | null;
  netMarginPercent: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  returnOnEquityPercent: number | null;
  returnOnAssetsPercent: number | null;
  targetPrice: number | null;
  numberOfAnalysts: number | null;
  beta1Year: number | null;
  dailyVolatilityPercent: number | null;
};

type PageResult = {
  totalCount: number;
  rows: RawRow[];
  error: string | null;
};

const MARKET_SCOPE = "US listed common stocks and ADRs only" as const;
const R2_PREFIX = "branch-labs/pr-262/value-investing" as const;
const LATEST_INDEX_KEY = `${R2_PREFIX}/latest/index.json`;
const PAGE_SIZE = 1_000;
const MAX_LISTINGS = 20_000;
const SHARD_SIZE = 500;
const REFRESH_MS = 15 * 60 * 1000;
const PERSIST_MS = 6 * 60 * 60 * 1000;
const US_EXCHANGES = new Set(["NASDAQ", "NYSE", "AMEX", "NYSEAMERICAN"]);
const COLUMNS = [
  "name",
  "description",
  "exchange",
  "country",
  "currency",
  "type",
  "typespecs",
  "is_primary",
  "close",
  "change",
  "volume",
  "relative_volume_10d_calc",
  "market_cap_basic",
  "sector",
  "industry",
  "price_earnings_ttm",
  "price_book_ratio",
  "price_sales_ratio",
  "enterprise_value_ebitda_ttm",
  "total_revenue",
  "net_income",
  "free_cash_flow",
  "earnings_per_share_diluted_ttm",
  "total_revenue_yoy_growth_ttm",
  "total_revenue_yoy_growth_fy",
  "net_income_yoy_growth_ttm",
  "earnings_per_share_diluted_yoy_growth_ttm",
  "gross_margin",
  "operating_margin",
  "net_margin",
  "debt_to_equity",
  "current_ratio",
  "return_on_equity",
  "return_on_assets",
  "target_price",
  "number_of_analysts",
  "beta_1_year",
  "Volatility.D",
] as const;

const state = globalThis as typeof globalThis & {
  __swingUpValueCycle?: { expiresAt: number; result: UsValueInvestingCycle };
  __swingUpValueWarehousePersistedAt?: number;
};

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
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

function boolean(value: unknown) {
  return value === true || value === 1 || value === "true";
}

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, value));
}

function rounded(value: number | null, digits = 2) {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 260) : "unknown_value_engine_error";
}

function median(values: number[]) {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function scoreRange(value: number | null, poor: number, strong: number) {
  if (value === null) return 45;
  return clamp(((value - poor) / (strong - poor)) * 100);
}

function positiveScore(value: number | null, weak: number, strong: number) {
  return scoreRange(value, weak, strong);
}

function inverseScore(value: number | null, strong: number, poor: number) {
  if (value === null) return 45;
  return 100 - scoreRange(value, strong, poor);
}

function normalizedDebtToEquity(value: number | null) {
  if (value === null) return null;
  return Math.abs(value) <= 10 ? value * 100 : value;
}

function parseRow(value: unknown): RawRow | null {
  const row = object(value);
  const symbol = text(row.s)?.toUpperCase();
  const data = array(row.d);
  if (!symbol || data.length < COLUMNS.length) return null;
  const separator = symbol.indexOf(":");
  const ticker = separator >= 0 ? symbol.slice(separator + 1) : symbol;
  const exchange = (text(data[2]) ?? (separator >= 0 ? symbol.slice(0, separator) : "UNKNOWN")).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const country = text(data[3]);
  const type = text(data[5]);
  const specs = array(data[6]).flatMap((item) => text(item) ?? []);
  const isPrimary = boolean(data[7]);
  const currentPrice = finite(data[8]);
  if (!ticker || type !== "stock" || !isPrimary || currentPrice === null || currentPrice <= 0) return null;
  const isUs = country?.toLowerCase().includes("united states") || US_EXCHANGES.has(exchange);
  const isFund = specs.some((item) => /fund|etf|etn|unit|preferred/i.test(item));
  if (!isUs || isFund) return null;
  return {
    ticker,
    tradingViewSymbol: symbol,
    company: text(data[1]) ?? text(data[0]) ?? ticker,
    exchange,
    country,
    currency: text(data[4]),
    currentPrice,
    changePercent: finite(data[9]),
    volume: finite(data[10]),
    relativeVolume10d: finite(data[11]),
    marketCap: finite(data[12]),
    sector: text(data[13]),
    industry: text(data[14]),
    priceToEarnings: finite(data[15]),
    priceToBook: finite(data[16]),
    priceToSales: finite(data[17]),
    enterpriseValueToEbitda: finite(data[18]),
    totalRevenue: finite(data[19]),
    netIncome: finite(data[20]),
    freeCashFlow: finite(data[21]),
    dilutedEpsTtm: finite(data[22]),
    revenueGrowthTtmPercent: finite(data[23]),
    revenueGrowthFyPercent: finite(data[24]),
    netIncomeGrowthTtmPercent: finite(data[25]),
    epsGrowthTtmPercent: finite(data[26]),
    grossMarginPercent: finite(data[27]),
    operatingMarginPercent: finite(data[28]),
    netMarginPercent: finite(data[29]),
    debtToEquity: finite(data[30]),
    currentRatio: finite(data[31]),
    returnOnEquityPercent: finite(data[32]),
    returnOnAssetsPercent: finite(data[33]),
    targetPrice: finite(data[34]),
    numberOfAnalysts: finite(data[35]),
    beta1Year: finite(data[36]),
    dailyVolatilityPercent: finite(data[37]),
  };
}

async function fetchPage(fetchImpl: typeof fetch, start: number): Promise<PageResult> {
  try {
    const response = await fetchImpl("https://scanner.tradingview.com/america/scan", {
      method: "POST",
      cache: "no-store",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        origin: "https://www.tradingview.com",
        referer: "https://www.tradingview.com/",
        "user-agent": "Mozilla/5.0 (compatible; SwingUpValueInvesting/1.0)",
      },
      body: JSON.stringify({
        filter: [
          { left: "type", operation: "equal", right: "stock" },
          { left: "is_primary", operation: "equal", right: true },
        ],
        options: { lang: "en" },
        markets: ["america"],
        symbols: { query: { types: [] }, tickers: [] },
        columns: [...COLUMNS],
        sort: { sortBy: "name", sortOrder: "asc" },
        range: [start, start + PAGE_SIZE],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const payload = await response.json().catch(async () => await response.text().catch(() => null));
    if (!response.ok) throw new Error(`tradingview_value_http_${response.status}`);
    const container = object(payload);
    const rawRows = array(container.data);
    return {
      totalCount: Math.max(rawRows.length, Math.floor(finite(container.totalCount) ?? rawRows.length)),
      rows: rawRows.flatMap((item) => parseRow(item) ?? []),
      error: null,
    };
  } catch (error) {
    return { totalCount: 0, rows: [], error: safeError(error) };
  }
}

async function fetchTargetedCompany(fetchImpl: typeof fetch, tradingViewSymbol: string, ticker: string) {
  const expectedSymbol = tradingViewSymbol.trim().toUpperCase();
  const expectedTicker = ticker.trim().toUpperCase();
  if (!expectedSymbol || !expectedTicker) throw new Error("targeted_value_company_identity_required");
  const response = await fetchImpl("https://scanner.tradingview.com/america/scan", {
    method: "POST",
    cache: "no-store",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      origin: "https://www.tradingview.com",
      referer: "https://www.tradingview.com/",
      "user-agent": "Mozilla/5.0 (compatible; SwingUpValueInvesting/1.0)",
    },
    body: JSON.stringify({
      filter: [
        { left: "type", operation: "equal", right: "stock" },
        { left: "is_primary", operation: "equal", right: true },
      ],
      options: { lang: "en" },
      markets: ["america"],
      symbols: { query: { types: [] }, tickers: [expectedSymbol] },
      columns: [...COLUMNS],
      range: [0, 10],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(async () => await response.text().catch(() => null));
  if (!response.ok) throw new Error(`tradingview_targeted_value_http_${response.status}`);
  const rows = array(object(payload).data).flatMap((item) => parseRow(item) ?? []);
  const exact = rows.filter((row) => row.tradingViewSymbol === expectedSymbol && row.ticker === expectedTicker);
  if (exact.length !== 1) throw new Error(exact.length ? "targeted_value_company_ambiguous" : "targeted_value_company_unavailable");
  return exact[0];
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>) {
  const output = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(items[index]);
    }
  }));
  return output;
}

async function fetchUsUniverse(fetchImpl: typeof fetch) {
  const first = await fetchPage(fetchImpl, 0);
  const target = Math.min(MAX_LISTINGS, first.totalCount);
  const starts = Array.from({ length: Math.max(0, Math.ceil(target / PAGE_SIZE) - 1) }, (_, index) => (index + 1) * PAGE_SIZE);
  const remaining = await mapWithConcurrency(starts, 6, (start) => fetchPage(fetchImpl, start));
  const pages = [first, ...remaining];
  const rows = new Map<string, RawRow>();
  for (const page of pages) {
    for (const row of page.rows) {
      const key = `${row.exchange}:${row.ticker}`;
      if (!rows.has(key)) rows.set(key, row);
    }
  }
  return {
    rows: [...rows.values()],
    totalProviderRows: first.totalCount,
    pagesRequested: pages.length,
    pagesFailed: pages.filter((page) => page.error).length,
    errors: pages.flatMap((page) => page.error ?? []),
  };
}

function evidenceCompleteness(row: RawRow) {
  const fields = [
    row.currentPrice,
    row.marketCap,
    row.totalRevenue,
    row.netIncome,
    row.freeCashFlow,
    row.dilutedEpsTtm,
    row.revenueGrowthTtmPercent ?? row.revenueGrowthFyPercent,
    row.operatingMarginPercent,
    row.netMarginPercent,
    row.debtToEquity,
    row.currentRatio,
    row.returnOnEquityPercent,
    row.returnOnAssetsPercent,
    row.priceToEarnings,
    row.priceToBook,
  ];
  return Math.round((fields.filter((value) => value !== null).length / fields.length) * 100);
}

function analyzeRow(row: RawRow, observedAt: string): UsValueCompanyAnalysis {
  const debtToEquityPercent = normalizedDebtToEquity(row.debtToEquity);
  const shares = row.marketCap !== null && row.marketCap > 0 ? row.marketCap / row.currentPrice : null;
  const fcfPerShare = shares !== null && shares > 0 && row.freeCashFlow !== null ? row.freeCashFlow / shares : null;
  const bookValuePerShare = row.priceToBook !== null && row.priceToBook > 0 ? row.currentPrice / row.priceToBook : null;
  const averageVolume = row.volume !== null && row.relativeVolume10d !== null && row.relativeVolume10d > 0 ? row.volume / row.relativeVolume10d : null;
  const averageDollarVolume = averageVolume !== null ? averageVolume * row.currentPrice : null;

  const profitability = Math.round(
    positiveScore(row.netMarginPercent, 0, 20) * 0.35
    + positiveScore(row.returnOnEquityPercent, 5, 25) * 0.35
    + positiveScore(row.returnOnAssetsPercent, 2, 12) * 0.3,
  );
  const balanceSheet = Math.round(
    inverseScore(debtToEquityPercent, 30, 250) * 0.65
    + positiveScore(row.currentRatio, 0.8, 2.2) * 0.35,
  );
  const growthValues = [row.revenueGrowthTtmPercent, row.revenueGrowthFyPercent, row.netIncomeGrowthTtmPercent, row.epsGrowthTtmPercent].filter((value): value is number => value !== null);
  const growthMedian = median(growthValues);
  const growthDurability = Math.round(
    positiveScore(growthMedian, -10, 25) * 0.7
    + positiveScore(row.operatingMarginPercent, 0, 20) * 0.3,
  );
  const fcfMarginPercent = row.freeCashFlow !== null && row.totalRevenue !== null && row.totalRevenue !== 0 ? (row.freeCashFlow / row.totalRevenue) * 100 : null;
  const cashGeneration = Math.round(
    positiveScore(fcfMarginPercent, 0, 18) * 0.7
    + (row.freeCashFlow !== null && row.freeCashFlow > 0 ? 100 : row.freeCashFlow === null ? 45 : 5) * 0.3,
  );
  const businessQuality = Math.round(profitability * 0.32 + balanceSheet * 0.23 + growthDurability * 0.2 + cashGeneration * 0.25);

  let risk = 15;
  if (row.netIncome !== null && row.netIncome <= 0) risk += 20;
  if (row.freeCashFlow !== null && row.freeCashFlow <= 0) risk += 25;
  if (debtToEquityPercent !== null && debtToEquityPercent > 200) risk += 20;
  if (row.currentRatio !== null && row.currentRatio < 1) risk += 15;
  if (growthMedian !== null && growthMedian < -10) risk += 15;
  if (row.epsGrowthTtmPercent !== null && row.epsGrowthTtmPercent < -20) risk += 10;
  if (row.dailyVolatilityPercent !== null && row.dailyVolatilityPercent > 8) risk += 10;
  if (row.marketCap !== null && row.marketCap < 300_000_000) risk += 10;
  if (averageDollarVolume !== null && averageDollarVolume < 2_000_000) risk += 15;
  risk = Math.round(clamp(risk));

  const methods: ValueMethod[] = [];
  const growthAdjustment = clamp((growthMedian ?? 0) * 0.2, -4, 5);
  const justifiedPe = clamp(8 + businessQuality / 6 + growthAdjustment, 8, 26);
  if (row.dilutedEpsTtm !== null && row.dilutedEpsTtm > 0) {
    methods.push({ method: "earnings_power", value: row.dilutedEpsTtm * justifiedPe, assumption: `Normalized earnings valued at a conservative ${justifiedPe.toFixed(1)}x multiple based on quality and growth.` });
  }
  const targetFcfYield = clamp(0.1 - businessQuality * 0.0006, 0.045, 0.1);
  if (fcfPerShare !== null && fcfPerShare > 0) {
    methods.push({ method: "owner_earnings_fcf", value: fcfPerShare / targetFcfYield, assumption: `Owner earnings valued at a ${(targetFcfYield * 100).toFixed(1)}% required free-cash-flow yield.` });
  }
  if (row.dilutedEpsTtm !== null && row.dilutedEpsTtm > 0 && bookValuePerShare !== null && bookValuePerShare > 0) {
    methods.push({ method: "graham_value", value: Math.sqrt(22.5 * row.dilutedEpsTtm * bookValuePerShare), assumption: "Conservative Graham earnings-and-book-value cross-check." });
  }
  const plausibleMethods = methods
    .filter((method) => method.value >= row.currentPrice * 0.2 && method.value <= row.currentPrice * 5)
    .map((method) => ({ ...method, value: rounded(method.value) ?? method.value }));
  const methodValues = plausibleMethods.map((method) => method.value);
  const baseValue = median(methodValues);
  const conservativeValue = methodValues.length ? Math.min(...methodValues) : null;
  const optimisticValue = methodValues.length ? Math.max(...methodValues) : null;
  const completeness = evidenceCompleteness(row);
  const methodScore = Math.min(36, plausibleMethods.length * 12);
  const fairValueConfidence = Math.round(clamp(30 + methodScore + completeness * 0.2 + businessQuality * 0.14 - risk * 0.08));
  const upsideToBase = baseValue !== null ? ((baseValue / row.currentPrice) - 1) * 100 : null;
  const discountToBase = baseValue !== null ? (1 - row.currentPrice / baseValue) * 100 : null;
  const buyBelowPrice = baseValue !== null ? baseValue * 0.75 : null;
  const strongBuyBelowPrice = baseValue !== null ? baseValue * 0.7 : null;
  const trimAbovePrice = baseValue !== null ? baseValue * (businessQuality >= 75 ? 1.75 : 1.5) : null;

  const profitable = (row.netIncome ?? 0) > 0 && (row.freeCashFlow ?? 0) > 0 && (row.dilutedEpsTtm ?? 0) > 0;
  const liquid = (row.marketCap ?? 0) >= 500_000_000 && (averageDollarVolume === null || averageDollarVolume >= 5_000_000);
  const seriousBuy = baseValue !== null
    && upsideToBase !== null
    && upsideToBase >= 40
    && businessQuality >= 75
    && balanceSheet >= 60
    && risk <= 45
    && fairValueConfidence >= 75
    && plausibleMethods.length >= 2
    && profitable
    && liquid;
  const sellPremiumRequired = businessQuality >= 75 ? 75 : 50;
  const premiumToBase = baseValue !== null ? ((row.currentPrice / baseValue) - 1) * 100 : null;
  const fundamentalsDeteriorating = (growthMedian !== null && growthMedian < -5) || risk >= 55 || businessQuality < 65;
  const seriousSell = baseValue !== null
    && premiumToBase !== null
    && premiumToBase >= sellPremiumRequired
    && fairValueConfidence >= 70
    && plausibleMethods.length >= 2
    && fundamentalsDeteriorating;
  const seriousWatchOut = risk >= 75
    && completeness >= 60
    && ((row.freeCashFlow ?? 0) <= 0 || (row.netIncome ?? 0) <= 0 || (debtToEquityPercent ?? 0) > 250);
  const qualityWatch = !seriousBuy && !seriousSell && !seriousWatchOut
    && businessQuality >= 70
    && risk <= 50
    && baseValue !== null;

  let action: ValueAlertAction = "no_action";
  let tier: ValueAlertTier = baseValue === null ? "insufficient_evidence" : "research_only";
  let publicationStatus: UsValueCompanyAnalysis["decision"]["publicationStatus"] = "research_only";
  const reasons: string[] = [];
  const blockers: string[] = [];
  if (seriousBuy) {
    action = "buy";
    tier = "serious_foundation_buy";
    publicationStatus = "serious_internal_review_only";
    reasons.push(`Conservative base fair value is ${upsideToBase!.toFixed(1)}% above the current price.`);
    reasons.push(`Business quality is ${businessQuality}/100 with risk ${risk}/100 and ${plausibleMethods.length} independent valuation methods.`);
    reasons.push("Positive earnings and owner earnings provide a margin-of-safety foundation without requiring a news catalyst.");
  } else if (seriousSell) {
    action = "sell";
    tier = "serious_foundation_sell";
    publicationStatus = "serious_internal_review_only";
    reasons.push(`The current price is ${premiumToBase!.toFixed(1)}% above conservative base fair value.`);
    reasons.push(`Fundamental quality or risk does not justify the premium; quality ${businessQuality}/100, risk ${risk}/100.`);
  } else if (seriousWatchOut) {
    action = "watch_out";
    tier = "serious_foundation_watch_out";
    publicationStatus = "serious_internal_review_only";
    reasons.push(`Fundamental risk is ${risk}/100 with cash-flow, profitability, or leverage stress.`);
  } else if (qualityWatch) {
    action = "watch";
    tier = "quality_price_watchlist";
    publicationStatus = "watchlist_internal";
    reasons.push(`Quality is ${businessQuality}/100; wait for price at or below ${rounded(buyBelowPrice)?.toFixed(2) ?? "the margin-of-safety threshold"}.`);
  }
  if (baseValue === null) blockers.push("Fewer than two plausible independent fair-value methods were available.");
  if (businessQuality < 75) blockers.push("Business quality is below the serious Buy threshold.");
  if (!profitable) blockers.push("Positive earnings, free cash flow, and diluted EPS were not all present.");
  if (!liquid) blockers.push("Market capitalization or trading liquidity is below the serious-alert threshold.");
  if (fairValueConfidence < 75) blockers.push("Fair-value confidence is below 75/100.");

  return {
    ticker: row.ticker,
    tradingViewSymbol: row.tradingViewSymbol,
    company: row.company,
    exchange: row.exchange,
    sector: row.sector,
    industry: row.industry,
    currency: row.currency,
    observedAt,
    currentPrice: rounded(row.currentPrice) ?? row.currentPrice,
    marketCap: rounded(row.marketCap, 0),
    estimatedAverageDollarVolume10d: rounded(averageDollarVolume, 0),
    fundamentals: {
      revenue: rounded(row.totalRevenue, 0),
      netIncome: rounded(row.netIncome, 0),
      freeCashFlow: rounded(row.freeCashFlow, 0),
      dilutedEpsTtm: rounded(row.dilutedEpsTtm),
      revenueGrowthTtmPercent: rounded(row.revenueGrowthTtmPercent),
      revenueGrowthFyPercent: rounded(row.revenueGrowthFyPercent),
      netIncomeGrowthTtmPercent: rounded(row.netIncomeGrowthTtmPercent),
      epsGrowthTtmPercent: rounded(row.epsGrowthTtmPercent),
      grossMarginPercent: rounded(row.grossMarginPercent),
      operatingMarginPercent: rounded(row.operatingMarginPercent),
      netMarginPercent: rounded(row.netMarginPercent),
      debtToEquityPercent: rounded(debtToEquityPercent),
      currentRatio: rounded(row.currentRatio),
      returnOnEquityPercent: rounded(row.returnOnEquityPercent),
      returnOnAssetsPercent: rounded(row.returnOnAssetsPercent),
    },
    valuation: {
      priceToEarnings: rounded(row.priceToEarnings),
      priceToBook: rounded(row.priceToBook),
      priceToSales: rounded(row.priceToSales),
      enterpriseValueToEbitda: rounded(row.enterpriseValueToEbitda),
      providerTargetPrice: rounded(row.targetPrice),
      providerAnalystCount: rounded(row.numberOfAnalysts, 0),
    },
    scores: {
      businessQuality,
      profitability,
      balanceSheet,
      growthDurability,
      cashGeneration,
      risk,
      evidenceCompleteness: completeness,
      fairValueConfidence,
    },
    fairValue: {
      methods: plausibleMethods,
      conservativeValue: rounded(conservativeValue),
      baseValue: rounded(baseValue),
      optimisticValue: rounded(optimisticValue),
      buyBelowPrice: rounded(buyBelowPrice),
      strongBuyBelowPrice: rounded(strongBuyBelowPrice),
      trimAbovePrice: rounded(trimAbovePrice),
      upsideToBasePercent: rounded(upsideToBase),
      discountToBasePercent: rounded(discountToBase),
      marginOfSafetyPercent: rounded(discountToBase),
    },
    decision: {
      action,
      tier,
      seriousSignal: seriousBuy || seriousSell || seriousWatchOut,
      userAlertEligible: false,
      publicationStatus,
      historicallyCertified: false,
      evidenceTriggered: seriousBuy || seriousSell || seriousWatchOut,
      noNewsRequired: true,
      reasons,
      blockers: [...new Set(blockers)],
    },
  };
}

function dateKey(value: string) {
  return value.replace(/[^0-9]/g, "").slice(0, 14);
}

async function persistWarehouse(result: UsValueInvestingCycle) {
  const errors: string[] = [];
  const shardKeys: string[] = [];
  const now = Date.now();
  const shouldPersist = !state.__swingUpValueWarehousePersistedAt || now - state.__swingUpValueWarehousePersistedAt >= PERSIST_MS;
  if (!shouldPersist || !getR2Config().configured) return { persisted: false, shardKeys, immutableRunKey: null as string | null, errors };
  try {
    for (let index = 0; index < result.analyses.length; index += SHARD_SIZE) {
      const shardNumber = Math.floor(index / SHARD_SIZE);
      const key = `${R2_PREFIX}/latest/shard-${String(shardNumber).padStart(3, "0")}.json`;
      const companies = result.analyses.slice(index, index + SHARD_SIZE);
      await writeVersionedJsonToR2(key, { version: 1, checkedAt: result.checkedAt, shardNumber, companies });
      shardKeys.push(key);
    }
    const immutableRunKey = `${R2_PREFIX}/runs/${result.checkedAt.slice(0, 10)}/${dateKey(result.checkedAt)}.json`;
    const summary = {
      version: 1,
      checkedAt: result.checkedAt,
      marketScope: result.marketScope,
      methodology: result.methodology,
      coverage: result.coverage,
      seriousAlerts: {
        buy: result.seriousAlerts.buy,
        sell: result.seriousAlerts.sell,
        watchOut: result.seriousAlerts.watchOut,
      },
      watchlists: {
        qualityWaitingForPrice: result.watchlists.qualityWaitingForPrice,
        researchOnlyCount: result.watchlists.researchOnly.length,
      },
      shardKeys,
      companyRecordsStored: result.analyses.length,
      safety: result.safety,
    };
    await writeVersionedJsonToR2(LATEST_INDEX_KEY, summary);
    await writeVersionedJsonToR2(immutableRunKey, summary, { createOnly: true });
    state.__swingUpValueWarehousePersistedAt = now;
    return { persisted: true, shardKeys, immutableRunKey, errors };
  } catch (error) {
    errors.push(safeError(error));
    return { persisted: false, shardKeys, immutableRunKey: null, errors };
  }
}

export async function runUsValueInvestingCycle(input: { fetchImpl?: typeof fetch; now?: Date; persist?: boolean } = {}): Promise<UsValueInvestingCycle> {
  const now = input.now ?? new Date();
  const cached = state.__swingUpValueCycle;
  if (cached && cached.expiresAt > now.getTime()) return { ...cached.result, cacheUsed: true };
  const fetchImpl = input.fetchImpl ?? fetch;
  const universe = await fetchUsUniverse(fetchImpl);
  const observedAt = now.toISOString();
  const analyses = universe.rows.map((row) => analyzeRow(row, observedAt));
  const seriousBuy = analyses.filter((item) => item.decision.tier === "serious_foundation_buy").sort((left, right) => (right.fairValue.upsideToBasePercent ?? -Infinity) - (left.fairValue.upsideToBasePercent ?? -Infinity));
  const seriousSell = analyses.filter((item) => item.decision.tier === "serious_foundation_sell").sort((left, right) => (left.fairValue.upsideToBasePercent ?? Infinity) - (right.fairValue.upsideToBasePercent ?? Infinity));
  const seriousWatchOut = analyses.filter((item) => item.decision.tier === "serious_foundation_watch_out").sort((left, right) => right.scores.risk - left.scores.risk);
  const qualityWatch = analyses.filter((item) => item.decision.tier === "quality_price_watchlist").sort((left, right) => right.scores.businessQuality - left.scores.businessQuality || (right.fairValue.discountToBasePercent ?? -Infinity) - (left.fairValue.discountToBasePercent ?? -Infinity));
  const researchOnly = analyses.filter((item) => ["research_only", "insufficient_evidence"].includes(item.decision.tier));
  const processingCoveragePercent = universe.totalProviderRows > 0 ? (analyses.length / universe.totalProviderRows) * 100 : 0;
  const result: UsValueInvestingCycle = {
    ok: universe.pagesFailed === 0 && analyses.length > 0,
    checkedAt: observedAt,
    marketScope: MARKET_SCOPE,
    methodology: {
      style: "company_first_conservative_intrinsic_value",
      analystTargetUsedAsFairValue: false,
      newsRequiredForFoundationAlert: false,
      fullFundamentalRefreshMinutes: REFRESH_MS / 60_000,
      fullWarehousePersistenceHours: PERSIST_MS / 3_600_000,
      minimumMarginOfSafetyPercent: 25,
      seriousBuyMinimumUpsidePercent: 40,
      seriousSellMinimumPremiumPercent: 50,
      noSyntheticData: true,
    },
    coverage: {
      provider: "TradingView public US stock scanner",
      totalProviderRows: universe.totalProviderRows,
      usPrimaryListings: universe.rows.length,
      companiesAnalyzed: analyses.length,
      companiesWithFairValue: analyses.filter((item) => item.fairValue.baseValue !== null).length,
      companiesWithoutFairValue: analyses.filter((item) => item.fairValue.baseValue === null).length,
      pagesRequested: universe.pagesRequested,
      pagesFailed: universe.pagesFailed,
      processingCoveragePercent: rounded(processingCoveragePercent) ?? 0,
      errors: universe.errors,
    },
    seriousAlerts: { buy: seriousBuy.slice(0, 250), sell: seriousSell.slice(0, 250), watchOut: seriousWatchOut.slice(0, 250) },
    watchlists: { qualityWaitingForPrice: qualityWatch.slice(0, 1_000), researchOnly },
    warehouse: {
      storage: "not_persisted",
      branchPrefix: R2_PREFIX,
      latestIndexKey: LATEST_INDEX_KEY,
      immutableRunKey: null,
      shardKeys: [],
      persistedThisCycle: false,
      companyRecordsStored: 0,
      errors: [],
    },
    cacheUsed: false,
    analyses,
    safety: { databaseWrites: false, publishing: false, notifications: false, trades: false },
  };
  if (input.persist !== false) {
    const persisted = await persistWarehouse(result);
    result.warehouse = {
      ...result.warehouse,
      storage: persisted.persisted ? "cloudflare_r2" : "not_persisted",
      immutableRunKey: persisted.immutableRunKey,
      shardKeys: persisted.shardKeys,
      persistedThisCycle: persisted.persisted,
      companyRecordsStored: persisted.persisted ? analyses.length : 0,
      errors: persisted.errors,
    };
  }
  state.__swingUpValueCycle = { expiresAt: now.getTime() + REFRESH_MS, result };
  return result;
}

export async function refreshUsValueCompany(input: {
  tradingViewSymbol: string;
  ticker: string;
  fetchImpl?: typeof fetch;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const row = await fetchTargetedCompany(input.fetchImpl ?? fetch, input.tradingViewSymbol, input.ticker);
  return analyzeRow(row, now.toISOString());
}

export function analyzeValueCompanyForTest(input: Partial<RawRow> & Pick<RawRow, "ticker" | "tradingViewSymbol" | "company" | "exchange" | "currentPrice">, observedAt = "2026-07-29T08:00:00.000Z") {
  const row: RawRow = {
    country: "United States",
    currency: "USD",
    changePercent: 0,
    volume: 10_000_000,
    relativeVolume10d: 1,
    marketCap: null,
    sector: null,
    industry: null,
    priceToEarnings: null,
    priceToBook: null,
    priceToSales: null,
    enterpriseValueToEbitda: null,
    totalRevenue: null,
    netIncome: null,
    freeCashFlow: null,
    dilutedEpsTtm: null,
    revenueGrowthTtmPercent: null,
    revenueGrowthFyPercent: null,
    netIncomeGrowthTtmPercent: null,
    epsGrowthTtmPercent: null,
    grossMarginPercent: null,
    operatingMarginPercent: null,
    netMarginPercent: null,
    debtToEquity: null,
    currentRatio: null,
    returnOnEquityPercent: null,
    returnOnAssetsPercent: null,
    targetPrice: null,
    numberOfAnalysts: null,
    beta1Year: null,
    dailyVolatilityPercent: null,
    ...input,
  };
  return analyzeRow(row, observedAt);
}
