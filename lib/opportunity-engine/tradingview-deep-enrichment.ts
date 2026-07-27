import type { GlobalDeepResearchCase } from "./global-deep-research";

export type TradingViewFundamentalSnapshot = {
  tradingViewSymbol: string;
  recommendation: number | null;
  movingAverageRecommendation: number | null;
  oscillatorRecommendation: number | null;
  rsi: number | null;
  sector: string | null;
  industry: string | null;
  priceToEarnings: number | null;
  priceToSales: number | null;
  priceToBook: number | null;
  enterpriseValueToEbitda: number | null;
  totalRevenue: number | null;
  revenueGrowthTtmPercent: number | null;
  revenueGrowthFyPercent: number | null;
  netIncome: number | null;
  netIncomeGrowthTtmPercent: number | null;
  dilutedEpsTtm: number | null;
  epsGrowthTtmPercent: number | null;
  grossMarginPercent: number | null;
  operatingMarginPercent: number | null;
  netMarginPercent: number | null;
  freeCashFlow: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  returnOnEquityPercent: number | null;
  returnOnAssetsPercent: number | null;
  targetPrice: number | null;
  targetPriceDate: string | null;
  numberOfAnalysts: number | null;
  nextEarningsAt: string | null;
  lastEarningsAt: string | null;
  dividendYieldPercent: number | null;
  beta1Year: number | null;
  dailyVolatilityPercent: number | null;
  relativeVolume10d: number | null;
  observedAt: string;
  sourceUrl: string;
};

const FIELDS = [
  "Recommend.All",
  "Recommend.MA",
  "Recommend.Other",
  "RSI",
  "sector",
  "industry",
  "price_earnings_ttm",
  "price_sales_ratio",
  "price_book_ratio",
  "enterprise_value_ebitda_ttm",
  "total_revenue",
  "total_revenue_yoy_growth_ttm",
  "total_revenue_yoy_growth_fy",
  "net_income",
  "net_income_yoy_growth_ttm",
  "earnings_per_share_diluted_ttm",
  "earnings_per_share_diluted_yoy_growth_ttm",
  "gross_margin",
  "operating_margin",
  "net_margin",
  "free_cash_flow",
  "debt_to_equity",
  "current_ratio",
  "return_on_equity",
  "return_on_assets",
  "target_price",
  "target_price_date",
  "number_of_analysts",
  "earnings_release_next_date",
  "earnings_release_date",
  "dividends_yield_current",
  "beta_1_year",
  "Volatility.D",
  "relative_volume_10d_calc",
] as const;

type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const finite = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/,/g, "")) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
};
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const timestamp = (value: unknown) => {
  const seconds = finite(value);
  return seconds !== null && seconds > 0 ? new Date(seconds * 1000).toISOString() : text(value) && Number.isFinite(Date.parse(String(value))) ? new Date(String(value)).toISOString() : null;
};

function parseRow(value: unknown, observedAt: string, sourceUrl: string): TradingViewFundamentalSnapshot | null {
  const row = object(value);
  const tradingViewSymbol = text(row.s)?.toUpperCase();
  const data = array(row.d);
  if (!tradingViewSymbol || data.length < FIELDS.length) return null;
  return {
    tradingViewSymbol,
    recommendation: finite(data[0]),
    movingAverageRecommendation: finite(data[1]),
    oscillatorRecommendation: finite(data[2]),
    rsi: finite(data[3]),
    sector: text(data[4]),
    industry: text(data[5]),
    priceToEarnings: finite(data[6]),
    priceToSales: finite(data[7]),
    priceToBook: finite(data[8]),
    enterpriseValueToEbitda: finite(data[9]),
    totalRevenue: finite(data[10]),
    revenueGrowthTtmPercent: finite(data[11]),
    revenueGrowthFyPercent: finite(data[12]),
    netIncome: finite(data[13]),
    netIncomeGrowthTtmPercent: finite(data[14]),
    dilutedEpsTtm: finite(data[15]),
    epsGrowthTtmPercent: finite(data[16]),
    grossMarginPercent: finite(data[17]),
    operatingMarginPercent: finite(data[18]),
    netMarginPercent: finite(data[19]),
    freeCashFlow: finite(data[20]),
    debtToEquity: finite(data[21]),
    currentRatio: finite(data[22]),
    returnOnEquityPercent: finite(data[23]),
    returnOnAssetsPercent: finite(data[24]),
    targetPrice: finite(data[25]),
    targetPriceDate: timestamp(data[26]),
    numberOfAnalysts: finite(data[27]),
    nextEarningsAt: timestamp(data[28]),
    lastEarningsAt: timestamp(data[29]),
    dividendYieldPercent: finite(data[30]),
    beta1Year: finite(data[31]),
    dailyVolatilityPercent: finite(data[32]),
    relativeVolume10d: finite(data[33]),
    observedAt,
    sourceUrl,
  };
}

export async function fetchTradingViewFundamentals(cases: GlobalDeepResearchCase[]) {
  const symbols = [...new Set(cases.map((item) => item.tradingViewSymbol).filter(Boolean))];
  if (!symbols.length) return { snapshots: new Map<string, TradingViewFundamentalSnapshot>(), errors: [] as string[] };
  const sourceUrl = "https://scanner.tradingview.com/america/scan";
  const observedAt = new Date().toISOString();
  try {
    const response = await fetch(sourceUrl, {
      method: "POST",
      cache: "no-store",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        origin: "https://www.tradingview.com",
        referer: "https://www.tradingview.com/",
        "user-agent": "Mozilla/5.0 (compatible; SwingUpDeepResearch/3.0)",
      },
      body: JSON.stringify({
        symbols: { tickers: symbols, query: { types: [] } },
        markets: ["america"],
        columns: [...FIELDS],
        range: [0, symbols.length],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const payload = await response.json().catch(async () => await response.text().catch(() => null));
    if (!response.ok) throw new Error(`tradingview_fundamental_http_${response.status}:${JSON.stringify(payload).slice(0, 200)}`);
    const container = object(payload);
    const snapshots = new Map<string, TradingViewFundamentalSnapshot>();
    for (const value of array(container.data)) {
      const parsed = parseRow(value, observedAt, sourceUrl);
      if (parsed) snapshots.set(parsed.tradingViewSymbol, parsed);
    }
    const missing = symbols.filter((symbol) => !snapshots.has(symbol));
    return {
      snapshots,
      errors: missing.map((symbol) => `TradingView fundamentals unavailable for ${symbol}`),
    };
  } catch (error) {
    return {
      snapshots: new Map<string, TradingViewFundamentalSnapshot>(),
      errors: [error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 300) : "tradingview_fundamental_fetch_failed"],
    };
  }
}
