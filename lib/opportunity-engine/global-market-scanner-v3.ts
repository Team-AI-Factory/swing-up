import {
  CERTIFIED_EXTREME_VOLATILITY_RULE,
  opportunityCoverageSummary,
} from "./serious-alert-registry";
import { mapGlobalListingToYahoo, type GlobalYahooMapping } from "./global-listing-identity";

export type TradingViewGlobalStock = {
  symbol: string;
  tradingViewSymbol: string;
  name: string;
  description: string;
  exchange: string;
  country: string | null;
  currency: string | null;
  market: string;
  isPrimary: boolean;
  type: string;
  typeSpecs: string[];
  price: number;
  changePercent: number | null;
  volume: number | null;
  relativeVolume: number | null;
  averageVolume: number | null;
  marketCap: number | null;
  yearHigh: number | null;
  yearLow: number | null;
  updateMode: string | null;
};

export type GlobalResearchCandidate = TradingViewGlobalStock & {
  liquidityScore: number;
  momentumScore: number;
  volatilityScore: number;
  opportunityPriority: number;
  riskPriority: number;
  buyResearchThemes: string[];
  sellResearchThemes: string[];
  watchOutResearchThemes: string[];
  reasons: string[];
};

export type CertifiedGlobalWatchOut = {
  ruleId: typeof CERTIFIED_EXTREME_VOLATILITY_RULE.id;
  action: "watch_out";
  subtype: "extreme_volatility_direction_uncertain";
  seriousSignal: true;
  publicationStatus: "review_only";
  notificationEligible: false;
  tradingViewSymbol: string;
  symbol: string;
  company: string;
  exchange: string;
  country: string | null;
  currency: string | null;
  currentPrice: number;
  tradingViewPrice: number;
  trailing120SessionHigh: number;
  trailing120SessionDrawdownPercent: number;
  independentPriceAgreementPercent: number;
  observedAt: string;
  horizonTradingDays: 30;
  expectedMoveThresholdPercent: 12;
  message: string;
  reasons: string[];
  alertKey: string;
  evidence: {
    primaryListing: true;
    sessionsUsed: 120;
    latestMarketDate: string;
    marketDataAgeDays: number;
    universeAndQuoteSource: "TradingView public stock scanner";
    adjustedHistorySource: "Yahoo Finance public chart API";
    tradingViewMarket: string;
    tradingViewSymbol: string;
    yahooSymbol: string;
    historyUrl: string;
    estimatedAverageDollarVolume10d: number;
    minimumAverageDollarVolumeRequired: number;
    splitEventsInLookback: 0;
    maximumSingleSessionPriceRatio: number;
    corporateActionAndDiscontinuityCheckPassed: true;
    noSyntheticData: true;
  };
  calibration: typeof CERTIFIED_EXTREME_VOLATILITY_RULE.certification;
};

export type TradingViewGlobalScanResult = {
  ok: boolean;
  checkedAt: string;
  universe: {
    provider: "TradingView public stock scanner";
    mode: "entire_world_primary_listings" | "regional_primary_listing_fallback";
    marketsAttempted: string[];
    marketsSucceeded: string[];
    totalProviderRows: number;
    primaryListingsFetched: number;
    eligibleListings: number;
    exchanges: number;
    countries: number;
    currencies: number;
    pageSize: number;
    pageOverlapRows: number;
    pagesRequested: number;
    pagesFailed: number;
    rawProviderRowsFetched: number;
    identifiedProviderRows: number;
    unidentifiedProviderRows: number;
    identifiedProviderRowPercent: number;
    uniqueProviderListingIdentities: number;
    duplicateProviderRowsDiscarded: number;
    unusablePrimaryListings: number;
    usablePrimaryListingsBeforeLimit: number;
    usableListingsExcludedByConfiguredLimit: number;
    usableListingPercent: number;
    coveragePercent: number;
    coverageComplete: boolean;
    sourceErrors: string[];
  };
  candidates: {
    opportunity: GlobalResearchCandidate[];
    buyResearch: GlobalResearchCandidate[];
    sellResearch: GlobalResearchCandidate[];
    watchOutResearch: GlobalResearchCandidate[];
    deepAnalysisQueue: string[];
  };
  seriousAlerts: {
    buy: [];
    sell: [];
    watchOut: CertifiedGlobalWatchOut[];
    certifiedRuleIds: string[];
    verification: {
      prefilterCandidates: number;
      mappedCandidates: number;
      checkedCandidates: number;
      qualifyingAlerts: number;
      unsupportedYahooMappings: number;
      failedHistoryChecks: number;
      verifiedHistoryCandidates: number;
      priceConflictsBlocked: number;
      insufficientHistoryBlocked: number;
      staleHistoryBlocked: number;
      corporateActionBlocked: number;
      historyDiscontinuityBlocked: number;
      liquidityBlocked: number;
      providerFailures: number;
      skippedCandidates: number;
      independentHistoryAvailablePercent: number;
      processingCoveragePercent: number;
      coveragePercent: number;
      coverageComplete: boolean;
      executionComplete: boolean;
      allCandidatesAccountedFor: boolean;
      promotionSafetyComplete: boolean;
      errors: string[];
    };
  };
  opportunityCoverage: ReturnType<typeof opportunityCoverageSummary>;
  safety: {
    databaseWrites: false;
    publishing: false;
    notifications: false;
    seriousSignalsUnlocked: boolean;
    certifiedRuleEnabled: true;
  };
};

type Json = Record<string, unknown>;
type TradingViewPage = {
  market: string;
  totalCount: number;
  start: number;
  rawRowCount: number;
  rawListingIdentities: string[];
  rows: TradingViewGlobalStock[];
  error: string | null;
};
type PriceHistoryRow = { date: string; close: number; high: number };
type SplitEvent = { date: string; numerator: number | null; denominator: number | null; splitRatio: string | null };

export const LIVE_CERTIFIED_WATCH_OUT_QUALITY_POLICY = {
  id: "live_certified_watch_out_evidence_quality_v1",
  minimumEstimatedAverageDollarVolume10d: 1_000_000,
  maximumMarketDataAgeDays: 4,
  maximumSingleSessionPriceRatio: 4,
} as const;

const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const finite = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/,/g, "")) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
};
const boolean = (value: unknown) => value === true || value === 1 || value === "true";
const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const percentChange = (from: number, to: number) => ((to / from) - 1) * 100;
const safeError = (error: unknown) => error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 320) : "unknown_global_scan_error";

const TV_COLUMNS = [
  "name", "description", "exchange", "country", "currency", "type", "typespecs", "is_primary",
  "close", "change", "volume", "relative_volume_10d_calc", "market_cap_basic",
  "price_52_week_high", "price_52_week_low", "update_mode",
] as const;

const REGIONAL_FALLBACK_MARKETS = [
  "america", "canada", "mexico", "brazil", "argentina", "chile", "colombia", "peru",
  "uk", "germany", "france", "italy", "spain", "portugal", "netherlands", "belgium", "switzerland", "austria",
  "denmark", "sweden", "norway", "finland", "iceland", "poland", "czech", "hungary", "romania", "greece", "turkey", "israel",
  "japan", "china", "hongkong", "korea", "taiwan", "india", "singapore", "malaysia", "indonesia", "thailand", "vietnam", "philippines", "pakistan", "bangladesh", "srilanka",
  "australia", "newzealand", "southafrica", "egypt", "nigeria", "saudiarabia", "uae", "qatar", "kuwait", "bahrain", "oman",
];

function parseTradingViewRow(value: unknown, market: string): TradingViewGlobalStock | null {
  const row = object(value);
  const tradingViewSymbol = text(row.s)?.toUpperCase();
  const data = array(row.d);
  if (!tradingViewSymbol || data.length < TV_COLUMNS.length) return null;
  const split = tradingViewSymbol.indexOf(":");
  const exchangeFromSymbol = split > 0 ? tradingViewSymbol.slice(0, split) : "UNKNOWN";
  const symbol = split > 0 ? tradingViewSymbol.slice(split + 1) : tradingViewSymbol;
  const type = text(data[5]) ?? "stock";
  const specs = array(data[6]).flatMap((item) => text(item) ?? []);
  const price = finite(data[8]);
  const isPrimary = boolean(data[7]);
  if (!price || price <= 0 || type !== "stock" || !isPrimary) return null;
  const volume = finite(data[10]);
  const relativeVolume = finite(data[11]);
  return {
    symbol,
    tradingViewSymbol,
    name: text(data[0]) ?? symbol,
    description: text(data[1]) ?? text(data[0]) ?? symbol,
    exchange: text(data[2]) ?? exchangeFromSymbol,
    country: text(data[3]),
    currency: text(data[4]),
    market,
    isPrimary,
    type,
    typeSpecs: specs,
    price,
    changePercent: finite(data[9]),
    volume,
    relativeVolume,
    averageVolume: volume !== null && relativeVolume !== null && relativeVolume > 0 ? volume / relativeVolume : null,
    marketCap: finite(data[12]),
    yearHigh: finite(data[13]),
    yearLow: finite(data[14]),
    updateMode: text(data[15]),
  };
}

async function fetchTradingViewPage(market: string, start: number, pageSize: number, primaryOnly = true): Promise<TradingViewPage> {
  const endpoint = `https://scanner.tradingview.com/${market}/scan`;
  const filters: Array<{ left: string; operation: string; right: unknown }> = [{ left: "type", operation: "equal", right: "stock" }];
  if (primaryOnly) filters.push({ left: "is_primary", operation: "equal", right: true });
  const body = {
    filter: filters,
    options: { lang: "en" },
    markets: market === "global" ? [] : [market],
    symbols: { query: { types: [] }, tickers: [] },
    columns: [...TV_COLUMNS],
    // A stable symbol sort plus overlapping page windows reduces omissions when
    // live market-cap values change while the worldwide scan is paginating.
    sort: { sortBy: "name", sortOrder: "asc" },
    range: [start, start + pageSize],
  };
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      cache: "no-store",
      headers: { accept: "application/json", "content-type": "application/json", origin: "https://www.tradingview.com", referer: "https://www.tradingview.com/", "user-agent": "Mozilla/5.0 (compatible; SwingUpGlobalScanner/4.0)" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
    const payload = await response.json().catch(async () => await response.text().catch(() => null));
    if (!response.ok) throw new Error(`tradingview_http_${response.status}:${JSON.stringify(payload).slice(0, 140)}`);
    const container = object(payload);
    const rawRows = array(container.data);
    const rawListingIdentities = rawRows.flatMap((value) => text(object(value).s)?.toUpperCase() ?? []);
    return {
      market,
      totalCount: Math.max(rawRows.length, Math.floor(finite(container.totalCount) ?? rawRows.length)),
      start,
      rawRowCount: rawRows.length,
      rawListingIdentities,
      rows: rawRows.flatMap((row) => parseTradingViewRow(row, market) ?? []),
      error: null,
    };
  } catch (error) {
    return { market, totalCount: 0, start, rawRowCount: 0, rawListingIdentities: [], rows: [], error: safeError(error) };
  }
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
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

export function buildOverlappingPageStarts(target: number, pageSize: number) {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const pageOverlapRows = Math.min(100, Math.max(1, Math.floor(safePageSize * 0.1)));
  const pageStep = Math.max(1, safePageSize - pageOverlapRows);
  const starts = Array.from(
    { length: Math.max(0, Math.ceil(Math.max(0, target - safePageSize) / pageStep)) },
    (_, index) => pageStep * (index + 1),
  ).filter((start) => start < target);
  return { pageOverlapRows, pageStep, starts };
}

export function summarizeGlobalUniverseRows(
  pages: Array<{ rawRowCount: number; rawListingIdentities: string[] }>,
  usablePrimaryListingsBeforeLimit: number,
  primaryListingsFetched: number,
  providerTarget: number,
) {
  const rawProviderRowsFetched = pages.reduce((sum, page) => sum + page.rawRowCount, 0);
  const identifiedProviderRows = pages.reduce((sum, page) => sum + page.rawListingIdentities.length, 0);
  const unidentifiedProviderRows = Math.max(0, rawProviderRowsFetched - identifiedProviderRows);
  const identifiedProviderRowPercent = rawProviderRowsFetched
    ? Number(((identifiedProviderRows / rawProviderRowsFetched) * 100).toFixed(2))
    : 0;
  const uniqueProviderListingIdentities = new Set(pages.flatMap((page) => page.rawListingIdentities)).size;
  const duplicateProviderRowsDiscarded = Math.max(0, identifiedProviderRows - uniqueProviderListingIdentities);
  const unusablePrimaryListings = Math.max(0, uniqueProviderListingIdentities - usablePrimaryListingsBeforeLimit);
  const usableListingsExcludedByConfiguredLimit = Math.max(0, usablePrimaryListingsBeforeLimit - primaryListingsFetched);
  const usableListingPercent = uniqueProviderListingIdentities
    ? Number(((usablePrimaryListingsBeforeLimit / uniqueProviderListingIdentities) * 100).toFixed(2))
    : 0;
  const coveragePercent = providerTarget
    ? Number((Math.min(1, uniqueProviderListingIdentities / providerTarget) * 100).toFixed(2))
    : 0;
  return {
    rawProviderRowsFetched,
    identifiedProviderRows,
    unidentifiedProviderRows,
    identifiedProviderRowPercent,
    uniqueProviderListingIdentities,
    duplicateProviderRowsDiscarded,
    unusablePrimaryListings,
    usablePrimaryListingsBeforeLimit,
    usableListingsExcludedByConfiguredLimit,
    usableListingPercent,
    coveragePercent,
  };
}

export function assessLiveCertifiedWatchOutQuality(input: {
  rows: PriceHistoryRow[];
  splitEvents: SplitEvent[];
  averageVolume: number | null;
  now: Date;
}) {
  const rows = input.rows.slice(-120);
  const first = rows[0];
  const latest = rows.at(-1);
  if (!first || !latest) {
    return { eligible: false as const, reason: "insufficient_history" as const };
  }
  const marketDataAgeDays = Math.max(
    0,
    Math.floor((input.now.getTime() - Date.parse(`${latest.date}T23:59:59Z`)) / 86_400_000),
  );
  if (marketDataAgeDays > LIVE_CERTIFIED_WATCH_OUT_QUALITY_POLICY.maximumMarketDataAgeDays) {
    return { eligible: false as const, reason: "stale_history" as const, marketDataAgeDays };
  }
  const splitEventsInLookback = input.splitEvents.filter(
    (event) => event.date >= first.date && event.date <= latest.date,
  ).length;
  if (splitEventsInLookback > 0) {
    return { eligible: false as const, reason: "corporate_action_in_lookback" as const, splitEventsInLookback };
  }
  let maximumSingleSessionPriceRatio = 1;
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1].close;
    const current = rows[index].close;
    if (previous <= 0 || current <= 0) continue;
    maximumSingleSessionPriceRatio = Math.max(
      maximumSingleSessionPriceRatio,
      current / previous,
      previous / current,
    );
  }
  if (maximumSingleSessionPriceRatio >= LIVE_CERTIFIED_WATCH_OUT_QUALITY_POLICY.maximumSingleSessionPriceRatio) {
    return {
      eligible: false as const,
      reason: "history_price_discontinuity" as const,
      maximumSingleSessionPriceRatio,
    };
  }
  if (input.averageVolume === null || !Number.isFinite(input.averageVolume) || input.averageVolume <= 0) {
    return { eligible: false as const, reason: "liquidity_evidence_unavailable" as const };
  }
  const estimatedAverageDollarVolume10d = latest.close * input.averageVolume;
  if (estimatedAverageDollarVolume10d < LIVE_CERTIFIED_WATCH_OUT_QUALITY_POLICY.minimumEstimatedAverageDollarVolume10d) {
    return {
      eligible: false as const,
      reason: "insufficient_liquidity" as const,
      estimatedAverageDollarVolume10d,
    };
  }
  return {
    eligible: true as const,
    marketDataAgeDays,
    splitEventsInLookback: 0 as const,
    maximumSingleSessionPriceRatio,
    estimatedAverageDollarVolume10d,
  };
}

async function fetchEntireWorld(maximumListings: number, pageSize: number, concurrency: number) {
  const errors: string[] = [];
  const { pageOverlapRows, pageStep } = buildOverlappingPageStarts(maximumListings, pageSize);
  const first = await fetchTradingViewPage("global", 0, pageSize, true);
  if (!first.error && first.totalCount >= 1_000 && first.rows.length) {
    const target = Math.min(maximumListings, first.totalCount);
    const { starts } = buildOverlappingPageStarts(target, pageSize);
    const remaining = await mapWithConcurrency(starts, concurrency, (start) => fetchTradingViewPage("global", start, pageSize, true));
    const pages = [first, ...remaining];
    for (const page of pages) if (page.error) errors.push(`global:${page.start}:${page.error}`);
    return { mode: "entire_world_primary_listings" as const, marketsAttempted: ["global"], marketsSucceeded: pages.some((page) => page.rawRowCount > 0) ? ["global"] : [], totalCount: first.totalCount, pages, errors, pageOverlapRows };
  }
  if (first.error) errors.push(`global:0:${first.error}`);
  else errors.push(`global:insufficient_rows:${first.rows.length}:total:${first.totalCount}`);

  const firstPages = await mapWithConcurrency(REGIONAL_FALLBACK_MARKETS, Math.min(concurrency, 10), (market) => fetchTradingViewPage(market, 0, pageSize, true));
  const jobs: Array<{ market: string; start: number }> = [];
  for (const page of firstPages) {
    if (page.error) errors.push(`${page.market}:0:${page.error}`);
    const target = Math.min(maximumListings, page.totalCount);
    for (let start = pageStep; start < target; start += pageStep) jobs.push({ market: page.market, start });
  }
  const remaining = await mapWithConcurrency(jobs, concurrency, (job) => fetchTradingViewPage(job.market, job.start, pageSize, true));
  const pages = [...firstPages, ...remaining];
  for (const page of remaining) if (page.error) errors.push(`${page.market}:${page.start}:${page.error}`);
  return {
    mode: "regional_primary_listing_fallback" as const,
    marketsAttempted: [...REGIONAL_FALLBACK_MARKETS],
    marketsSucceeded: [...new Set(pages.filter((page) => page.rawRowCount > 0).map((page) => page.market))],
    totalCount: firstPages.reduce((sum, page) => sum + page.totalCount, 0),
    pages,
    errors,
    pageOverlapRows,
  };
}

function scoreCandidate(stock: TradingViewGlobalStock): GlobalResearchCandidate {
  const volumeRatio = stock.relativeVolume ?? 0;
  const liquidityScore = clamp(Math.log10(Math.max(1, stock.volume ?? 0)) * 12 + Math.log10(Math.max(1, stock.marketCap ?? 0)) * 3 - 30);
  const momentumScore = clamp(50 + (stock.changePercent ?? 0) * 5);
  const rangePosition = stock.yearHigh !== null && stock.yearLow !== null && stock.yearHigh > stock.yearLow ? (stock.price - stock.yearLow) / (stock.yearHigh - stock.yearLow) : 0.5;
  const volatilityScore = clamp(Math.abs(stock.changePercent ?? 0) * 10 + Math.max(0, volumeRatio - 1) * 15);
  const marketCapBillions = (stock.marketCap ?? 0) / 1_000_000_000;
  const opportunityPriority = clamp(liquidityScore * 0.3 + momentumScore * 0.25 + clamp(volumeRatio * 35) * 0.2 + clamp((1 - Math.abs(rangePosition - 0.45)) * 100) * 0.15 + clamp(Math.log10(Math.max(1, marketCapBillions)) * 25) * 0.1);
  const riskPriority = clamp(volatilityScore * 0.45 + clamp(Math.max(0, -(stock.changePercent ?? 0)) * 10) * 0.3 + clamp(Math.max(0, 0.2 - rangePosition) * 250) * 0.25);
  const yearDrawdown = stock.yearHigh && stock.yearHigh > 0 ? percentChange(stock.yearHigh, stock.price) : null;
  const buyResearchThemes = [
    ...(rangePosition >= 0.9 && (stock.changePercent ?? 0) >= 2 ? ["buy_breakout_momentum"] : []),
    ...(rangePosition <= 0.2 && (stock.changePercent ?? 0) >= 2 ? ["buy_oversold_recovery"] : []),
    ...((stock.changePercent ?? 0) >= 4 && volumeRatio >= 1.5 ? ["buy_catalyst_repricing"] : []),
    ...(liquidityScore >= 80 && momentumScore >= 60 ? ["buy_quality_value_dislocation_research"] : []),
  ];
  const sellResearchThemes = [
    ...(rangePosition <= 0.1 && (stock.changePercent ?? 0) <= -2 ? ["sell_technical_breakdown"] : []),
    ...((stock.changePercent ?? 0) <= -4 && volumeRatio >= 1.5 ? ["sell_distribution_pressure"] : []),
    ...(rangePosition <= 0.2 ? ["sell_thesis_break_research"] : []),
  ];
  const watchOutResearchThemes = [
    ...(yearDrawdown !== null && yearDrawdown <= -55 ? ["watch_out_extreme_volatility_candidate"] : []),
    ...(volatilityScore >= 70 ? ["watch_out_unusual_volatility"] : []),
    ...(liquidityScore < 30 ? ["watch_out_liquidity_gap"] : []),
  ];
  const reasons = [
    ...(volumeRatio >= 1.5 ? [`Volume is ${volumeRatio.toFixed(1)}x normal`] : []),
    ...((stock.changePercent ?? 0) >= 4 ? [`Price rose ${stock.changePercent?.toFixed(1)}%`] : []),
    ...((stock.changePercent ?? 0) <= -4 ? [`Price fell ${stock.changePercent?.toFixed(1)}%`] : []),
    ...(rangePosition <= 0.15 ? ["Trading near its 52-week low"] : []),
    ...(rangePosition >= 0.9 ? ["Trading near its 52-week high"] : []),
    ...(yearDrawdown !== null && yearDrawdown <= -55 ? [`Price is ${Math.abs(yearDrawdown).toFixed(1)}% below its 52-week high`] : []),
  ];
  return { ...stock, liquidityScore, momentumScore, volatilityScore, opportunityPriority, riskPriority, buyResearchThemes, sellResearchThemes, watchOutResearchThemes, reasons };
}

async function fetchYahooHistory(mapping: GlobalYahooMapping, now: Date) {
  const period1 = Math.floor((now.getTime() - 430 * 86_400_000) / 1000);
  const period2 = Math.floor((now.getTime() + 2 * 86_400_000) / 1000);
  const failures: string[] = [];
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(mapping.symbol)}?period1=${period1}&period2=${period2}&interval=1d&events=div%2Csplits%2CcapitalGains&includeAdjustedClose=true`;
    try {
      const response = await fetch(url, { cache: "no-store", headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; SwingUpLiveCertification/2.0)", referer: "https://finance.yahoo.com/" }, signal: AbortSignal.timeout(25_000) });
      if (!response.ok) throw new Error(`yahoo_http_${response.status}`);
      const payload = object(await response.json());
      const chart = object(payload.chart);
      if (Object.keys(object(chart.error)).length) throw new Error(`yahoo_chart_error:${mapping.symbol}`);
      const result = object(array(chart.result)[0]);
      const timestamps = array(result.timestamp);
      const indicators = object(result.indicators);
      const quote = object(array(indicators.quote)[0]);
      const adjusted = object(array(indicators.adjclose)[0]);
      const closes = array(quote.close);
      const highs = array(quote.high);
      const adjustedCloses = array(adjusted.adjclose);
      const rows = timestamps.flatMap((timestamp, index): PriceHistoryRow[] => {
        const seconds = finite(timestamp);
        const rawClose = finite(closes[index]);
        const adjustedClose = finite(adjustedCloses[index]) ?? rawClose;
        if (seconds === null || rawClose === null || adjustedClose === null || adjustedClose <= 0) return [];
        const adjustment = rawClose > 0 ? adjustedClose / rawClose : 1;
        const rawHigh = finite(highs[index]) ?? rawClose;
        return [{ date: new Date(seconds * 1000).toISOString().slice(0, 10), close: adjustedClose, high: Math.max(adjustedClose, rawHigh * adjustment) }];
      }).sort((left, right) => left.date.localeCompare(right.date));
      if (rows.length < 120) throw new Error(`insufficient_history:${mapping.symbol}:${rows.length}`);
      const splitEvents = Object.values(object(object(result.events).splits)).flatMap((value): SplitEvent[] => {
        const event = object(value);
        const seconds = finite(event.date);
        if (seconds === null) return [];
        return [{
          date: new Date(seconds * 1000).toISOString().slice(0, 10),
          numerator: finite(event.numerator),
          denominator: finite(event.denominator),
          splitRatio: text(event.splitRatio),
        }];
      }).sort((left, right) => left.date.localeCompare(right.date));
      return { rows, splitEvents, url };
    } catch (error) {
      failures.push(`${host}:${safeError(error)}`);
    }
  }
  throw new Error(`all_yahoo_sources_failed:${mapping.symbol}:${failures.join("|")}`);
}

function evaluateCertifiedAlert(
  candidate: GlobalResearchCandidate,
  mapping: GlobalYahooMapping,
  history: { rows: PriceHistoryRow[]; splitEvents: SplitEvent[]; url: string },
  now: Date,
): CertifiedGlobalWatchOut | null {
  const rows = history.rows.slice(-120);
  const latest = rows.at(-1);
  if (!latest || rows.length < 120) return null;
  const high = Math.max(...rows.map((row) => row.high));
  const drawdown = percentChange(high, latest.close);
  if (drawdown > CERTIFIED_EXTREME_VOLATILITY_RULE.trailing120SessionDrawdownMaximumPercent) return null;
  const quality = assessLiveCertifiedWatchOutQuality({
    rows,
    splitEvents: history.splitEvents,
    averageVolume: candidate.averageVolume,
    now,
  });
  if (!quality.eligible) throw new Error(`${quality.reason}:${mapping.symbol}`);
  const midpoint = (candidate.price + latest.close) / 2;
  const agreement = midpoint > 0 ? (Math.abs(candidate.price - latest.close) / midpoint) * 100 : 100;
  if (agreement > 5) throw new Error(`price_disagreement:${candidate.tradingViewSymbol}:${mapping.symbol}:${agreement.toFixed(2)}pct`);
  return {
    ruleId: CERTIFIED_EXTREME_VOLATILITY_RULE.id,
    action: "watch_out",
    subtype: CERTIFIED_EXTREME_VOLATILITY_RULE.subtype,
    seriousSignal: true,
    publicationStatus: "review_only",
    notificationEligible: false,
    tradingViewSymbol: candidate.tradingViewSymbol,
    symbol: candidate.symbol,
    company: candidate.description,
    exchange: candidate.exchange,
    country: candidate.country,
    currency: candidate.currency,
    currentPrice: latest.close,
    tradingViewPrice: candidate.price,
    trailing120SessionHigh: high,
    trailing120SessionDrawdownPercent: drawdown,
    independentPriceAgreementPercent: agreement,
    observedAt: `${latest.date}T23:59:59.000Z`,
    horizonTradingDays: 30,
    expectedMoveThresholdPercent: 12,
    message: `${candidate.tradingViewSymbol} is ${Math.abs(drawdown).toFixed(1)}% below its 120-session high. The certified rule indicates a high likelihood of at least a 12% move in either direction within 30 trading sessions. This is a volatility warning, not a Sell instruction.`,
    reasons: [`Adjusted price is ${Math.abs(drawdown).toFixed(1)}% below the highest adjusted price in the last 120 sessions.`, `TradingView and Yahoo prices agree within ${agreement.toFixed(2)}%.`, `Estimated 10-session average dollar volume is $${Math.round(quality.estimatedAverageDollarVolume10d).toLocaleString("en-US")}.`, "No reported split or extreme single-session price discontinuity appears inside the 120-session evidence window.", `Independent historical certification produced ${CERTIFIED_EXTREME_VOLATILITY_RULE.certification.wins} wins from ${CERTIFIED_EXTREME_VOLATILITY_RULE.certification.sampleSize} signals.`],
    alertKey: [CERTIFIED_EXTREME_VOLATILITY_RULE.id, candidate.tradingViewSymbol, latest.date, Math.floor(drawdown / 5) * 5].join(":"),
    evidence: { primaryListing: true, sessionsUsed: 120, latestMarketDate: latest.date, marketDataAgeDays: quality.marketDataAgeDays, universeAndQuoteSource: "TradingView public stock scanner", adjustedHistorySource: "Yahoo Finance public chart API", tradingViewMarket: candidate.market, tradingViewSymbol: candidate.tradingViewSymbol, yahooSymbol: mapping.symbol, historyUrl: history.url, estimatedAverageDollarVolume10d: quality.estimatedAverageDollarVolume10d, minimumAverageDollarVolumeRequired: LIVE_CERTIFIED_WATCH_OUT_QUALITY_POLICY.minimumEstimatedAverageDollarVolume10d, splitEventsInLookback: quality.splitEventsInLookback, maximumSingleSessionPriceRatio: quality.maximumSingleSessionPriceRatio, corporateActionAndDiscontinuityCheckPassed: true, noSyntheticData: true },
    calibration: CERTIFIED_EXTREME_VOLATILITY_RULE.certification,
  };
}

export async function scanTradingViewGlobalStocks(options?: {
  maximumListings?: number;
  pageSize?: number;
  pageConcurrency?: number;
  deepQueueSize?: number;
  minimumPrice?: number;
  minimumMarketCap?: number;
  maximumCertifiedChecks?: number;
  historyConcurrency?: number;
  now?: Date;
}): Promise<TradingViewGlobalScanResult> {
  const now = options?.now ?? new Date();
  const maximumListings = Math.max(1_000, Math.min(options?.maximumListings ?? 150_000, 200_000));
  const pageSize = Math.max(100, Math.min(options?.pageSize ?? 1_000, 2_000));
  const pageConcurrency = Math.max(1, Math.min(options?.pageConcurrency ?? 8, 16));
  const deepQueueSize = Math.max(10, Math.min(options?.deepQueueSize ?? 300, 2_000));
  const minimumPrice = Math.max(0, options?.minimumPrice ?? 0.25);
  const minimumMarketCap = Math.max(0, options?.minimumMarketCap ?? 25_000_000);
  const maximumCertifiedChecks = Math.max(10, Math.min(options?.maximumCertifiedChecks ?? 5_000, 15_000));
  const historyConcurrency = Math.max(1, Math.min(options?.historyConcurrency ?? 10, 20));

  const world = await fetchEntireWorld(maximumListings, pageSize, pageConcurrency);
  const bySymbol = new Map<string, TradingViewGlobalStock>();
  for (const page of world.pages) for (const row of page.rows) if (!bySymbol.has(row.tradingViewSymbol)) bySymbol.set(row.tradingViewSymbol, row);
  const usablePrimaryListingsBeforeLimit = bySymbol.size;
  const allRows = [...bySymbol.values()].slice(0, maximumListings);
  const eligible = allRows.filter((row) => row.price >= minimumPrice && row.marketCap !== null && row.marketCap >= minimumMarketCap);
  const candidates = eligible.map(scoreCandidate);
  const opportunity = [...candidates].sort((left, right) => right.opportunityPriority - left.opportunityPriority).slice(0, deepQueueSize);
  const buyResearch = candidates.filter((row) => row.buyResearchThemes.length).sort((left, right) => right.opportunityPriority - left.opportunityPriority).slice(0, deepQueueSize);
  const sellResearch = candidates.filter((row) => row.sellResearchThemes.length).sort((left, right) => right.riskPriority - left.riskPriority).slice(0, deepQueueSize);
  const watchOutResearch = candidates.filter((row) => row.watchOutResearchThemes.length).sort((left, right) => right.riskPriority - left.riskPriority).slice(0, deepQueueSize);
  const deepAnalysisQueue = [...new Set([...buyResearch, ...sellResearch, ...watchOutResearch, ...opportunity].map((row) => row.tradingViewSymbol))].slice(0, deepQueueSize * 3);

  const prefilter = candidates.filter((row) => row.yearHigh !== null && row.yearHigh > 0 && percentChange(row.yearHigh, row.price) <= -55).sort((left, right) => right.riskPriority - left.riskPriority);
  const mapped = prefilter.flatMap((candidate) => {
    const mapping = mapGlobalListingToYahoo(candidate);
    return mapping ? [{ candidate, mapping }] : [];
  });
  const selected = mapped.slice(0, maximumCertifiedChecks);
  const historyErrors: string[] = [];
  const verificationOutcomes = await mapWithConcurrency(selected, historyConcurrency, async ({ candidate, mapping }) => {
    try {
      return {
        alert: evaluateCertifiedAlert(candidate, mapping, await fetchYahooHistory(mapping, now), now),
        status: "verified_history" as const,
        error: null,
      };
    } catch (error) {
      const message = safeError(error);
      const status = message.includes("price_disagreement:")
        ? "price_conflict" as const
        : message.includes("insufficient_history:")
          ? "insufficient_history" as const
          : message.includes("stale_history:")
            ? "stale_history" as const
            : message.includes("corporate_action_in_lookback:")
              ? "corporate_action" as const
              : message.includes("history_price_discontinuity:")
                ? "history_discontinuity" as const
                : message.includes("liquidity_evidence_unavailable:") || message.includes("insufficient_liquidity:")
                  ? "liquidity_blocked" as const
                  : "provider_failure" as const;
      const fullError = `${candidate.tradingViewSymbol}:${message}`;
      historyErrors.push(fullError);
      return { alert: null, status, error: fullError };
    }
  });
  const alerts = verificationOutcomes.flatMap((row) => row.alert ? [row.alert] : []);
  const unsupportedYahooMappings = prefilter.length - mapped.length;
  const skippedCandidates = Math.max(0, mapped.length - selected.length);
  const verifiedHistoryCandidates = verificationOutcomes.filter((row) => row.status === "verified_history").length;
  const priceConflictsBlocked = verificationOutcomes.filter((row) => row.status === "price_conflict").length;
  const insufficientHistoryBlocked = verificationOutcomes.filter((row) => row.status === "insufficient_history").length;
  const staleHistoryBlocked = verificationOutcomes.filter((row) => row.status === "stale_history").length;
  const corporateActionBlocked = verificationOutcomes.filter((row) => row.status === "corporate_action").length;
  const historyDiscontinuityBlocked = verificationOutcomes.filter((row) => row.status === "history_discontinuity").length;
  const liquidityBlocked = verificationOutcomes.filter((row) => row.status === "liquidity_blocked").length;
  const providerFailures = verificationOutcomes.filter((row) => row.status === "provider_failure").length;
  const failedHistoryChecks = providerFailures;
  const independentHistoryAvailableCandidates = verifiedHistoryCandidates
    + priceConflictsBlocked
    + staleHistoryBlocked
    + corporateActionBlocked
    + historyDiscontinuityBlocked
    + liquidityBlocked;
  const independentHistoryAvailablePercent = prefilter.length
    ? Number(((independentHistoryAvailableCandidates / prefilter.length) * 100).toFixed(2))
    : 100;
  const attemptedOrUnsupported = selected.length + unsupportedYahooMappings;
  const coveragePercent = prefilter.length ? Number(((attemptedOrUnsupported / prefilter.length) * 100).toFixed(2)) : 100;
  const classifiedCandidates = verifiedHistoryCandidates
    + priceConflictsBlocked
    + insufficientHistoryBlocked
    + staleHistoryBlocked
    + corporateActionBlocked
    + historyDiscontinuityBlocked
    + liquidityBlocked
    + providerFailures;
  const allCandidatesAccountedFor = mapped.length + unsupportedYahooMappings === prefilter.length
    && selected.length + skippedCandidates === mapped.length
    && verificationOutcomes.length === selected.length
    && classifiedCandidates === selected.length;
  const executionComplete = skippedCandidates === 0 && verificationOutcomes.length === selected.length;
  const promotionSafetyComplete = verificationOutcomes.every((outcome) => outcome.alert === null || (
    outcome.status === "verified_history"
    && outcome.alert.seriousSignal
    && outcome.alert.action === "watch_out"
    && outcome.alert.evidence.noSyntheticData
    && outcome.alert.independentPriceAgreementPercent <= 5
    && outcome.alert.evidence.estimatedAverageDollarVolume10d
      >= LIVE_CERTIFIED_WATCH_OUT_QUALITY_POLICY.minimumEstimatedAverageDollarVolume10d
    && outcome.alert.evidence.splitEventsInLookback === 0
    && outcome.alert.evidence.maximumSingleSessionPriceRatio
      < LIVE_CERTIFIED_WATCH_OUT_QUALITY_POLICY.maximumSingleSessionPriceRatio
    && outcome.alert.evidence.marketDataAgeDays
      <= LIVE_CERTIFIED_WATCH_OUT_QUALITY_POLICY.maximumMarketDataAgeDays
    && outcome.alert.trailing120SessionDrawdownPercent
      <= CERTIFIED_EXTREME_VOLATILITY_RULE.trailing120SessionDrawdownMaximumPercent
  ));
  const coverageComplete = executionComplete && allCandidatesAccountedFor && promotionSafetyComplete;
  const providerTarget = Math.min(maximumListings, world.totalCount || maximumListings);
  const pagesFailed = world.pages.filter((page) => page.error).length;
  const universeRows = summarizeGlobalUniverseRows(
    world.pages,
    usablePrimaryListingsBeforeLimit,
    allRows.length,
    providerTarget,
  );
  const universeCoverage = universeRows.coveragePercent;
  const universeCoverageComplete = pagesFailed === 0
    && universeCoverage >= 99
    && universeRows.identifiedProviderRowPercent >= 99
    && universeRows.usableListingPercent >= 95
    && (world.mode === "entire_world_primary_listings" || world.marketsSucceeded.length >= 40);
  const exchanges = new Set(eligible.map((row) => row.exchange));
  const countries = new Set(eligible.map((row) => row.country).filter((row): row is string => Boolean(row)));
  const currencies = new Set(eligible.map((row) => row.currency).filter((row): row is string => Boolean(row)));

  return {
    ok: universeCoverageComplete && coverageComplete,
    checkedAt: now.toISOString(),
    universe: { provider: "TradingView public stock scanner", mode: world.mode, marketsAttempted: world.marketsAttempted, marketsSucceeded: world.marketsSucceeded, totalProviderRows: world.totalCount, primaryListingsFetched: allRows.length, eligibleListings: eligible.length, exchanges: exchanges.size, countries: countries.size, currencies: currencies.size, pageSize, pageOverlapRows: world.pageOverlapRows, pagesRequested: world.pages.length, pagesFailed, ...universeRows, coverageComplete: universeCoverageComplete, sourceErrors: [...new Set(world.errors)].slice(0, 100) },
    candidates: { opportunity, buyResearch, sellResearch, watchOutResearch, deepAnalysisQueue },
    seriousAlerts: { buy: [], sell: [], watchOut: alerts, certifiedRuleIds: [CERTIFIED_EXTREME_VOLATILITY_RULE.id], verification: { prefilterCandidates: prefilter.length, mappedCandidates: mapped.length, checkedCandidates: selected.length, qualifyingAlerts: alerts.length, unsupportedYahooMappings, failedHistoryChecks, verifiedHistoryCandidates, priceConflictsBlocked, insufficientHistoryBlocked, staleHistoryBlocked, corporateActionBlocked, historyDiscontinuityBlocked, liquidityBlocked, providerFailures, skippedCandidates, independentHistoryAvailablePercent, processingCoveragePercent: coveragePercent, coveragePercent, coverageComplete, executionComplete, allCandidatesAccountedFor, promotionSafetyComplete, errors: [...new Set(historyErrors)].slice(0, 150) } },
    opportunityCoverage: opportunityCoverageSummary(),
    safety: { databaseWrites: false, publishing: false, notifications: false, seriousSignalsUnlocked: alerts.length > 0, certifiedRuleEnabled: true },
  };
}
