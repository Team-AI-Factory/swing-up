import {
  CERTIFIED_EXTREME_VOLATILITY_RULE,
  opportunityCoverageSummary,
} from "./serious-alert-registry";

export type GlobalStock = {
  symbol: string;
  name: string;
  exchange: string;
  exchangeShortName: string;
  country: string | null;
  currency: string | null;
  type: string | null;
  activelyTrading: boolean;
};

export type GlobalQuote = {
  symbol: string;
  name: string | null;
  price: number | null;
  changePercent: number | null;
  volume: number | null;
  averageVolume: number | null;
  marketCap: number | null;
  yearHigh: number | null;
  yearLow: number | null;
  exchange: string | null;
  country: string | null;
  currency: string | null;
  timestamp: number | null;
};

export type GlobalScanCandidate = GlobalStock & Omit<GlobalQuote, "exchange" | "name" | "country" | "currency"> & {
  quoteExchange: string | null;
  listingKey: string;
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

export type CertifiedExtremeVolatilityAlert = {
  ruleId: typeof CERTIFIED_EXTREME_VOLATILITY_RULE.id;
  action: "watch_out";
  subtype: "extreme_volatility_direction_uncertain";
  seriousSignal: true;
  publicationStatus: "review_only";
  notificationEligible: false;
  symbol: string;
  company: string;
  listingKey: string;
  exchange: string;
  country: string | null;
  currency: string | null;
  currentPrice: number;
  independentQuotePrice: number | null;
  trailing120SessionHigh: number;
  trailing120SessionDrawdownPercent: number;
  priceAgreementPercent: number | null;
  observedAt: string;
  horizonTradingDays: 30;
  expectedMoveThresholdPercent: 12;
  message: string;
  reasons: string[];
  alertKey: string;
  evidence: {
    sessionsUsed: 120;
    latestMarketDate: string;
    marketDataAgeDays: number;
    adjustedDailyHistorySource: "Yahoo Finance public chart API";
    adjustedDailyHistoryUrl: string;
    independentQuoteSource: "Financial Modeling Prep";
    noSyntheticData: true;
  };
  calibration: typeof CERTIFIED_EXTREME_VOLATILITY_RULE.certification;
};

export type GlobalScanResult = {
  ok: boolean;
  checkedAt: string;
  universe: {
    provider: "Financial Modeling Prep";
    directorySource: string;
    attemptedDirectorySources: string[];
    directoryErrors: string[];
    stocksAvailable: number;
    stocksEligible: number;
    uniqueSymbols: number;
    exchanges: number;
    countries: number;
    currencies: number;
  };
  scan: {
    requestedStocks: number;
    requestedSymbols: number;
    quotedStocks: number;
    failedBatches: number;
    batches: number;
    batchSize: number;
    coveragePercent: number;
    coverageComplete: boolean;
  };
  candidates: {
    opportunity: GlobalScanCandidate[];
    watchOut: GlobalScanCandidate[];
    buyResearch: GlobalScanCandidate[];
    sellResearch: GlobalScanCandidate[];
    watchOutResearch: GlobalScanCandidate[];
    deepAnalysisQueue: string[];
  };
  seriousAlerts: {
    buy: [];
    sell: [];
    watchOut: CertifiedExtremeVolatilityAlert[];
    certifiedRuleIds: string[];
    verification: {
      prefilterCandidates: number;
      checkedCandidates: number;
      qualifyingAlerts: number;
      failedCandidates: number;
      skippedCandidates: number;
      coveragePercent: number;
      coverageComplete: boolean;
      maximumCandidates: number;
      concurrency: number;
      dataFreshnessMaximumDays: number;
      errors: string[];
    };
  };
  opportunityCoverage: ReturnType<typeof opportunityCoverageSummary>;
  errors: string[];
  safety: {
    databaseWrites: false;
    publishing: false;
    notifications: false;
    seriousSignalsUnlocked: boolean;
    certifiedRuleEnabled: true;
  };
};

type Json = Record<string, unknown>;
type PriceHistoryRow = { date: string; close: number; high: number };
type VerifiedHistory = { rows: PriceHistoryRow[]; sourceUrl: string };
type DirectoryResult = {
  rows: GlobalStock[];
  source: string;
  attemptedSources: string[];
  errors: string[];
};
type CertifiedVerification = {
  alerts: CertifiedExtremeVolatilityAlert[];
  prefilterCandidates: number;
  checkedCandidates: number;
  failedCandidates: number;
  skippedCandidates: number;
  coveragePercent: number;
  coverageComplete: boolean;
  errors: string[];
};

const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const numeric = (value: unknown) => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/,/g, "")) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
};
const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const exchangeKey = (value: string | null | undefined) => (value ?? "UNKNOWN").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
const listingKey = (stock: Pick<GlobalStock, "exchangeShortName" | "symbol">) => `${exchangeKey(stock.exchangeShortName)}:${stock.symbol}`;
const percentChange = (from: number, to: number) => ((to / from) - 1) * 100;
const US_PRIMARY_EXCHANGES = new Set(["NASDAQ", "NYSE", "AMEX", "NYSEAMERICAN"]);

function safeError(error: unknown) {
  return error instanceof Error
    ? error.message.replace(/apikey=[^&\s]+/gi, "apikey=[redacted]").replace(/\s+/g, " ").slice(0, 300)
    : "unknown_global_scan_error";
}

async function fmp(path: string, apiKey: string, attempts = 3): Promise<unknown> {
  const separator = path.includes("?") ? "&" : "?";
  const url = `https://financialmodelingprep.com/stable/${path}${separator}apikey=${encodeURIComponent(apiKey)}`;
  let last: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers: { accept: "application/json", apikey: apiKey, "user-agent": "SwingUpGlobalScanner/3.0" },
        signal: AbortSignal.timeout(60_000),
      });
      const payload = await response.json().catch(() => null);
      const message = JSON.stringify(payload ?? "").toLowerCase();
      if (response.ok && !/subscription|plan required|payment required|invalid api|limit reached/.test(message)) return payload;
      last = new Error(`fmp_http_${response.status}:${path.split("?")[0]}:${message.slice(0, 120)}`);
      if (response.status !== 429 && response.status < 500) break;
    } catch (error) {
      last = error;
    }
    await sleep(800 * 2 ** attempt);
  }
  throw last instanceof Error ? last : new Error(`fmp_request_failed:${path}`);
}

function stockFromRow(value: unknown, exchangeCountry: Map<string, string>): GlobalStock | null {
  if (typeof value === "string") {
    const symbol = value.trim().toUpperCase();
    return symbol ? { symbol, name: symbol, exchange: "UNKNOWN", exchangeShortName: "UNKNOWN", country: null, currency: null, type: "stock", activelyTrading: true } : null;
  }
  const row = object(value);
  const symbol = text(row.symbol)?.toUpperCase();
  if (!symbol) return null;
  const exchangeShortName = text(row.exchangeShortName) ?? text(row.exchange) ?? "UNKNOWN";
  const exchange = text(row.exchange) ?? exchangeShortName;
  const name = text(row.companyName) ?? text(row.name) ?? symbol;
  const type = text(row.type) ?? text(row.assetType) ?? "stock";
  const activelyTrading = row.isActivelyTrading !== false && row.activelyTrading !== false;
  const isEtf = row.isEtf === true || row.isETF === true;
  const isFund = isEtf || /etf|fund|trust|mutual/i.test(type) || /\bETF\b/i.test(name);
  const isOrdinaryShare = /stock|common|ordinary|share|equity|adr|gdr/i.test(type) || type === "stock";
  if (!activelyTrading || isFund || !isOrdinaryShare) return null;
  return {
    symbol,
    name,
    exchange,
    exchangeShortName,
    country: text(row.country) ?? exchangeCountry.get(exchangeKey(exchangeShortName)) ?? exchangeCountry.get(exchangeKey(exchange)) ?? null,
    currency: text(row.currency),
    type,
    activelyTrading,
  };
}

export function normalizeGlobalStockUniverse(payload: unknown, exchangeCountry = new Map<string, string>()): GlobalStock[] {
  const seen = new Set<string>();
  return array(payload).flatMap((value): GlobalStock[] => {
    const stock = stockFromRow(value, exchangeCountry);
    if (!stock) return [];
    if (!US_PRIMARY_EXCHANGES.has(exchangeKey(stock.exchangeShortName))) return [];
    const key = listingKey(stock);
    if (seen.has(key)) return [];
    seen.add(key);
    return [stock];
  });
}

export function normalizeGlobalQuotes(payload: unknown): GlobalQuote[] {
  return array(payload).flatMap((value): GlobalQuote[] => {
    const row = object(value);
    const symbol = text(row.symbol)?.toUpperCase();
    if (!symbol) return [];
    return [{
      symbol,
      name: text(row.name) ?? text(row.companyName),
      price: numeric(row.price),
      changePercent: numeric(row.changePercentage) ?? numeric(row.changesPercentage),
      volume: numeric(row.volume),
      averageVolume: numeric(row.avgVolume) ?? numeric(row.averageVolume),
      marketCap: numeric(row.marketCap),
      yearHigh: numeric(row.yearHigh),
      yearLow: numeric(row.yearLow),
      exchange: text(row.exchange) ?? text(row.exchangeShortName),
      country: text(row.country),
      currency: text(row.currency),
      timestamp: numeric(row.timestamp),
    }];
  });
}

function mergeStocks(rows: GlobalStock[]) {
  const seen = new Set<string>();
  return rows.filter((stock) => {
    const key = listingKey(stock);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function exchangeCountryMap(apiKey: string) {
  try {
    const payload = await fmp("available-exchanges", apiKey);
    const map = new Map<string, string>();
    for (const value of array(payload)) {
      const row = object(value);
      const country = text(row.country) ?? text(row.countryName);
      if (!country) continue;
      for (const exchange of [text(row.exchange), text(row.exchangeShortName), text(row.shortName), text(row.name)]) {
        if (exchange) map.set(exchangeKey(exchange), country);
      }
    }
    return map;
  } catch {
    return new Map<string, string>();
  }
}

async function fetchProfileBulk(apiKey: string, countries: Map<string, string>) {
  const output: GlobalStock[] = [];
  for (let part = 0; part < 40; part += 1) {
    const payload = await fmp(`profile-bulk?part=${part}`, apiKey);
    const rows = normalizeGlobalStockUniverse(payload, countries);
    if (!rows.length) break;
    output.push(...rows);
    if (rows.length < 500) break;
    await sleep(100);
  }
  return mergeStocks(output);
}

async function fetchDirectory(apiKey: string): Promise<DirectoryResult> {
  const attemptedSources: string[] = [];
  const errors: string[] = [];
  const countries = await exchangeCountryMap(apiKey);
  const attempts: Array<{ name: string; run: () => Promise<GlobalStock[]> }> = [
    { name: "stock-list", run: async () => normalizeGlobalStockUniverse(await fmp("stock-list", apiKey), countries) },
    { name: "actively-trading-list", run: async () => normalizeGlobalStockUniverse(await fmp("actively-trading-list", apiKey), countries) },
    { name: "profile-bulk", run: async () => fetchProfileBulk(apiKey, countries) },
    { name: "financial-statement-symbol-list", run: async () => normalizeGlobalStockUniverse(await fmp("financial-statement-symbol-list", apiKey), countries) },
    { name: "key-metrics-ttm-bulk-symbols", run: async () => normalizeGlobalStockUniverse(await fmp("key-metrics-ttm-bulk", apiKey), countries) },
  ];
  for (const attempt of attempts) {
    attemptedSources.push(attempt.name);
    try {
      const rows = await attempt.run();
      if (rows.length >= 1000) return { rows, source: attempt.name, attemptedSources, errors };
      errors.push(`${attempt.name}:insufficient_symbols:${rows.length}`);
    } catch (error) {
      errors.push(`${attempt.name}:${safeError(error)}`);
    }
  }
  throw new Error(`all_global_directory_sources_failed:${errors.join("|")}`);
}

function chooseListing(options: GlobalStock[], quote: GlobalQuote): GlobalStock | null {
  if (!options.length) return null;
  if (options.length === 1) return options[0];
  const quoteExchange = exchangeKey(quote.exchange);
  return options.find((stock) => quoteExchange !== "UNKNOWN" && [exchangeKey(stock.exchange), exchangeKey(stock.exchangeShortName)].includes(quoteExchange)) ?? null;
}

function scoreCandidate(stockInput: GlobalStock, quote: GlobalQuote): GlobalScanCandidate {
  const stock: GlobalStock = {
    ...stockInput,
    name: quote.name ?? stockInput.name,
    exchange: quote.exchange ?? stockInput.exchange,
    exchangeShortName: quote.exchange ?? stockInput.exchangeShortName,
    country: quote.country ?? stockInput.country,
    currency: quote.currency ?? stockInput.currency,
  };
  const volumeRatio = quote.volume !== null && quote.averageVolume !== null && quote.averageVolume > 0 ? quote.volume / quote.averageVolume : 0;
  const marketCapBillions = quote.marketCap !== null ? quote.marketCap / 1_000_000_000 : 0;
  const liquidityScore = clamp(Math.log10(Math.max(1, quote.volume ?? 0)) * 12 + Math.log10(Math.max(1, quote.marketCap ?? 0)) * 3 - 30);
  const momentumScore = clamp(50 + (quote.changePercent ?? 0) * 5);
  const rangePosition = quote.price !== null && quote.yearHigh !== null && quote.yearLow !== null && quote.yearHigh > quote.yearLow
    ? (quote.price - quote.yearLow) / (quote.yearHigh - quote.yearLow) : 0.5;
  const volatilityScore = clamp(Math.abs(quote.changePercent ?? 0) * 10 + Math.max(0, volumeRatio - 1) * 15);
  const opportunityPriority = clamp(liquidityScore * 0.3 + momentumScore * 0.25 + clamp(volumeRatio * 35) * 0.2 + clamp((1 - Math.abs(rangePosition - 0.45)) * 100) * 0.15 + clamp(Math.log10(Math.max(1, marketCapBillions)) * 25) * 0.1);
  const riskPriority = clamp(volatilityScore * 0.45 + clamp(Math.max(0, -(quote.changePercent ?? 0)) * 10) * 0.3 + clamp(Math.max(0, 0.2 - rangePosition) * 250) * 0.25);
  const yearDrawdown = quote.price !== null && quote.yearHigh !== null && quote.yearHigh > 0 ? percentChange(quote.yearHigh, quote.price) : null;
  const buyResearchThemes = [
    ...(rangePosition >= 0.9 && (quote.changePercent ?? 0) >= 2 ? ["buy_breakout_momentum"] : []),
    ...(rangePosition <= 0.2 && (quote.changePercent ?? 0) >= 2 ? ["buy_oversold_recovery"] : []),
    ...((quote.changePercent ?? 0) >= 4 && volumeRatio >= 1.5 ? ["buy_catalyst_repricing"] : []),
    ...(liquidityScore >= 80 && momentumScore >= 60 ? ["buy_quality_value_dislocation_research"] : []),
  ];
  const sellResearchThemes = [
    ...(rangePosition <= 0.1 && (quote.changePercent ?? 0) <= -2 ? ["sell_technical_breakdown"] : []),
    ...((quote.changePercent ?? 0) <= -4 && volumeRatio >= 1.5 ? ["sell_distribution_pressure"] : []),
    ...(rangePosition <= 0.2 ? ["sell_thesis_break_research"] : []),
  ];
  const watchOutResearchThemes = [
    ...(yearDrawdown !== null && yearDrawdown <= -55 ? ["watch_out_extreme_volatility_candidate"] : []),
    ...(volatilityScore >= 70 ? ["watch_out_unusual_volatility"] : []),
    ...(liquidityScore < 30 ? ["watch_out_liquidity_gap"] : []),
  ];
  const reasons = [
    ...(volumeRatio >= 1.5 ? [`Volume is ${volumeRatio.toFixed(1)}x normal`] : []),
    ...((quote.changePercent ?? 0) >= 4 ? [`Price rose ${quote.changePercent?.toFixed(1)}%`] : []),
    ...((quote.changePercent ?? 0) <= -4 ? [`Price fell ${quote.changePercent?.toFixed(1)}%`] : []),
    ...(rangePosition <= 0.15 ? ["Trading near its 52-week low"] : []),
    ...(rangePosition >= 0.9 ? ["Trading near its 52-week high"] : []),
    ...(yearDrawdown !== null && yearDrawdown <= -55 ? [`Price is ${Math.abs(yearDrawdown).toFixed(1)}% below its 52-week high`] : []),
  ];
  return {
    ...stock,
    symbol: quote.symbol,
    price: quote.price,
    changePercent: quote.changePercent,
    volume: quote.volume,
    averageVolume: quote.averageVolume,
    marketCap: quote.marketCap,
    yearHigh: quote.yearHigh,
    yearLow: quote.yearLow,
    timestamp: quote.timestamp,
    quoteExchange: quote.exchange,
    listingKey: listingKey(stock),
    liquidityScore,
    momentumScore,
    volatilityScore,
    opportunityPriority,
    riskPriority,
    buyResearchThemes,
    sellResearchThemes,
    watchOutResearchThemes,
    reasons,
  };
}

function yahooSymbol(candidate: GlobalScanCandidate) {
  const exchange = exchangeKey(candidate.exchangeShortName);
  const usListing = ["NASDAQ", "NYSE", "AMEX", "NYSEARCA", "BATS"].includes(exchange) || (candidate.country ?? "").toUpperCase() === "US";
  return usListing && /^[A-Z0-9]+\.[A-Z]$/.test(candidate.symbol) ? candidate.symbol.replace(".", "-") : candidate.symbol;
}

function parseYahooHistory(payload: unknown, symbol: string, sourceUrl: string): VerifiedHistory {
  const chart = object(object(payload).chart);
  if (Object.keys(object(chart.error)).length) throw new Error(`yahoo_chart_error:${symbol}`);
  const result = object(array(chart.result)[0]);
  const timestamps = array(result.timestamp);
  const indicators = object(result.indicators);
  const quote = object(array(indicators.quote)[0]);
  const adjusted = object(array(indicators.adjclose)[0]);
  const closes = array(quote.close);
  const highs = array(quote.high);
  const adjustedCloses = array(adjusted.adjclose);
  const rows = timestamps.flatMap((timestamp, index): PriceHistoryRow[] => {
    const seconds = numeric(timestamp);
    const rawClose = numeric(closes[index]);
    const adjustedClose = numeric(adjustedCloses[index]) ?? rawClose;
    if (seconds === null || rawClose === null || adjustedClose === null || adjustedClose <= 0) return [];
    const adjustment = rawClose > 0 ? adjustedClose / rawClose : 1;
    const rawHigh = numeric(highs[index]) ?? rawClose;
    return [{ date: new Date(seconds * 1000).toISOString().slice(0, 10), close: adjustedClose, high: Math.max(adjustedClose, rawHigh * adjustment) }];
  }).sort((left, right) => left.date.localeCompare(right.date));
  if (rows.length < 120) throw new Error(`insufficient_live_history:${symbol}:${rows.length}`);
  return { rows, sourceUrl };
}

async function fetchYahooHistory(candidate: GlobalScanCandidate, now: Date): Promise<VerifiedHistory> {
  const symbol = yahooSymbol(candidate);
  const period1 = Math.floor((now.getTime() - 430 * 86_400_000) / 1000);
  const period2 = Math.floor((now.getTime() + 2 * 86_400_000) / 1000);
  const failures: string[] = [];
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&events=history&includeAdjustedClose=true`;
    try {
      const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; SwingUpLiveCertification/1.0)", Referer: "https://finance.yahoo.com/" }, signal: AbortSignal.timeout(25_000) });
      if (!response.ok) throw new Error(`yahoo_http_${response.status}`);
      return parseYahooHistory(await response.json(), symbol, url);
    } catch (error) {
      failures.push(`${host}:${safeError(error)}`);
    }
  }
  throw new Error(`all_live_history_sources_failed:${candidate.listingKey}:${failures.join("|")}`);
}

function priceAgreementPercent(left: number | null, right: number | null) {
  if (left === null || right === null || left <= 0 || right <= 0) return null;
  const midpoint = (left + right) / 2;
  return midpoint > 0 ? (Math.abs(left - right) / midpoint) * 100 : null;
}

export function evaluateCertifiedExtremeVolatilityHistory(candidate: GlobalScanCandidate, history: VerifiedHistory, now = new Date()): CertifiedExtremeVolatilityAlert | null {
  const rows = history.rows.slice(-120);
  if (rows.length < 120) return null;
  const latest = rows.at(-1);
  if (!latest) return null;
  const high = Math.max(...rows.map((row) => row.high));
  if (!Number.isFinite(high) || high <= 0) return null;
  const drawdown = percentChange(high, latest.close);
  if (drawdown > CERTIFIED_EXTREME_VOLATILITY_RULE.trailing120SessionDrawdownMaximumPercent) return null;
  const marketDataAgeDays = Math.max(0, Math.floor((now.getTime() - Date.parse(`${latest.date}T23:59:59Z`)) / 86_400_000));
  const agreement = priceAgreementPercent(candidate.price, latest.close);
  if (marketDataAgeDays > 7) throw new Error(`stale_live_history:${candidate.listingKey}:${latest.date}`);
  if (agreement !== null && agreement > 5) throw new Error(`live_price_disagreement:${candidate.listingKey}:${agreement.toFixed(2)}pct`);
  const alertKey = [CERTIFIED_EXTREME_VOLATILITY_RULE.id, candidate.listingKey, latest.date, Math.floor(drawdown / 5) * 5].join(":");
  return {
    ruleId: CERTIFIED_EXTREME_VOLATILITY_RULE.id,
    action: "watch_out",
    subtype: CERTIFIED_EXTREME_VOLATILITY_RULE.subtype,
    seriousSignal: true,
    publicationStatus: "review_only",
    notificationEligible: false,
    symbol: candidate.symbol,
    company: candidate.name,
    listingKey: candidate.listingKey,
    exchange: candidate.exchangeShortName,
    country: candidate.country,
    currency: candidate.currency,
    currentPrice: latest.close,
    independentQuotePrice: candidate.price,
    trailing120SessionHigh: high,
    trailing120SessionDrawdownPercent: drawdown,
    priceAgreementPercent: agreement,
    observedAt: `${latest.date}T23:59:59.000Z`,
    horizonTradingDays: CERTIFIED_EXTREME_VOLATILITY_RULE.horizonTradingDays,
    expectedMoveThresholdPercent: CERTIFIED_EXTREME_VOLATILITY_RULE.futureMoveThresholdPercent,
    message: `${candidate.symbol} is ${Math.abs(drawdown).toFixed(1)}% below its 120-session high. The certified rule indicates a high likelihood of at least a ${CERTIFIED_EXTREME_VOLATILITY_RULE.futureMoveThresholdPercent}% move in either direction within ${CERTIFIED_EXTREME_VOLATILITY_RULE.horizonTradingDays} trading sessions. This is a volatility warning, not a Sell instruction.`,
    reasons: [`Adjusted close is ${Math.abs(drawdown).toFixed(1)}% below the highest adjusted price in the last 120 sessions.`, `Independent external holdout observed ${CERTIFIED_EXTREME_VOLATILITY_RULE.certification.wins} wins from ${CERTIFIED_EXTREME_VOLATILITY_RULE.certification.sampleSize} signals.`, "Direction is uncertain, so position sizing and exit assumptions require review."],
    alertKey,
    evidence: { sessionsUsed: 120, latestMarketDate: latest.date, marketDataAgeDays, adjustedDailyHistorySource: "Yahoo Finance public chart API", adjustedDailyHistoryUrl: history.sourceUrl, independentQuoteSource: "Financial Modeling Prep", noSyntheticData: true },
    calibration: CERTIFIED_EXTREME_VOLATILITY_RULE.certification,
  };
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return output;
}

async function verifyCertifiedWatchOut(candidates: GlobalScanCandidate[], now: Date, maximumCandidates: number, concurrency: number): Promise<CertifiedVerification> {
  const prefilter = candidates.filter((candidate) => candidate.price !== null && candidate.price > 0 && (candidate.yearHigh === null || candidate.yearHigh <= 0 || percentChange(candidate.yearHigh, candidate.price) <= -55)).sort((left, right) => right.riskPriority - left.riskPriority);
  const selected = prefilter.slice(0, maximumCandidates);
  const errors: string[] = [];
  const results = await mapWithConcurrency(selected, concurrency, async (candidate) => {
    try {
      return evaluateCertifiedExtremeVolatilityHistory(candidate, await fetchYahooHistory(candidate, now), now);
    } catch (error) {
      errors.push(`${candidate.listingKey}:${safeError(error)}`);
      return null;
    }
  });
  const alerts = results.filter((result): result is CertifiedExtremeVolatilityAlert => Boolean(result));
  const failedCandidates = errors.length;
  const skippedCandidates = Math.max(0, prefilter.length - selected.length);
  const verified = Math.max(0, selected.length - failedCandidates);
  const coveragePercent = prefilter.length ? Number(((verified / prefilter.length) * 100).toFixed(2)) : 100;
  return { alerts, prefilterCandidates: prefilter.length, checkedCandidates: selected.length, failedCandidates, skippedCandidates, coveragePercent, coverageComplete: skippedCandidates === 0 && coveragePercent >= 99, errors: [...new Set(errors)].slice(0, 100) };
}

export async function scanAllGlobalStocks(options?: {
  maximumStocks?: number;
  batchSize?: number;
  deepQueueSize?: number;
  minimumPrice?: number;
  minimumMarketCap?: number;
  maximumCertifiedChecks?: number;
  certifiedCheckConcurrency?: number;
  now?: Date;
}): Promise<GlobalScanResult> {
  const apiKey = process.env.FMP_API_KEY?.trim();
  if (!apiKey) throw new Error("FMP_API_KEY is required for the global stock scanner");
  const now = options?.now ?? new Date();
  const maximumStocks = Math.max(1, Math.min(options?.maximumStocks ?? 100_000, 150_000));
  const batchSize = Math.max(1, Math.min(options?.batchSize ?? 250, 500));
  const deepQueueSize = Math.max(10, Math.min(options?.deepQueueSize ?? 250, 2_000));
  const minimumPrice = Math.max(0, options?.minimumPrice ?? 0.25);
  const minimumMarketCap = Math.max(0, options?.minimumMarketCap ?? 25_000_000);
  const maximumCertifiedChecks = Math.max(1, Math.min(options?.maximumCertifiedChecks ?? 2_000, 10_000));
  const certifiedCheckConcurrency = Math.max(1, Math.min(options?.certifiedCheckConcurrency ?? 8, 16));
  const errors: string[] = [];

  const directory = await fetchDirectory(apiKey);
  const allStocks = directory.rows.slice(0, maximumStocks);
  const eligible = allStocks.filter((stock) => stock.symbol.length <= 24);
  const stocksBySymbol = new Map<string, GlobalStock[]>();
  for (const stock of eligible) stocksBySymbol.set(stock.symbol, [...(stocksBySymbol.get(stock.symbol) ?? []), stock]);
  const requestSymbols = [...stocksBySymbol.keys()];
  const quoteRows: GlobalQuote[] = [];
  let failedBatches = 0;
  const batches = Array.from({ length: Math.ceil(requestSymbols.length / batchSize) }, (_, index) => requestSymbols.slice(index * batchSize, (index + 1) * batchSize));
  for (const symbols of batches) {
    try {
      quoteRows.push(...normalizeGlobalQuotes(await fmp(`batch-quote?symbols=${encodeURIComponent(symbols.join(","))}`, apiKey)));
    } catch (error) {
      failedBatches += 1;
      errors.push(safeError(error));
    }
    await sleep(150);
  }

  const quotedSymbols = new Set<string>();
  const candidates = quoteRows.flatMap((quote): GlobalScanCandidate[] => {
    const stock = chooseListing(stocksBySymbol.get(quote.symbol) ?? [], quote);
    if (!stock) {
      if ((stocksBySymbol.get(quote.symbol)?.length ?? 0) > 1) errors.push(`ambiguous_listing:${quote.symbol}:${quote.exchange ?? "unknown_exchange"}`);
      return [];
    }
    quotedSymbols.add(quote.symbol);
    if (quote.price === null || quote.price < minimumPrice || quote.marketCap === null || quote.marketCap < minimumMarketCap) return [];
    return [scoreCandidate(stock, quote)];
  });

  const opportunity = [...candidates].sort((left, right) => right.opportunityPriority - left.opportunityPriority).slice(0, deepQueueSize);
  const watchOut = [...candidates].sort((left, right) => right.riskPriority - left.riskPriority).slice(0, deepQueueSize);
  const buyResearch = candidates.filter((candidate) => candidate.buyResearchThemes.length > 0).sort((left, right) => right.opportunityPriority - left.opportunityPriority).slice(0, deepQueueSize);
  const sellResearch = candidates.filter((candidate) => candidate.sellResearchThemes.length > 0).sort((left, right) => right.riskPriority - left.riskPriority).slice(0, deepQueueSize);
  const watchOutResearch = candidates.filter((candidate) => candidate.watchOutResearchThemes.length > 0).sort((left, right) => right.riskPriority - left.riskPriority).slice(0, deepQueueSize);
  const deepAnalysisQueue = [...new Set([...buyResearch, ...sellResearch, ...watchOutResearch, ...opportunity, ...watchOut].map((row) => row.symbol))].slice(0, deepQueueSize * 3);
  const seriousVerification = await verifyCertifiedWatchOut(candidates, now, maximumCertifiedChecks, certifiedCheckConcurrency);
  const countries = new Set(candidates.map((stock) => stock.country).filter((value): value is string => Boolean(value)));
  const exchanges = new Set(candidates.map((stock) => stock.exchangeShortName).filter(Boolean));
  const currencies = new Set(candidates.map((stock) => stock.currency).filter((value): value is string => Boolean(value)));
  const coveragePercent = requestSymbols.length ? Number(((quotedSymbols.size / requestSymbols.length) * 100).toFixed(2)) : 0;
  const coverageComplete = failedBatches === 0 && coveragePercent >= 99;

  return {
    ok: coverageComplete && seriousVerification.coverageComplete,
    checkedAt: now.toISOString(),
    universe: { provider: "Financial Modeling Prep", directorySource: directory.source, attemptedDirectorySources: directory.attemptedSources, directoryErrors: directory.errors, stocksAvailable: allStocks.length, stocksEligible: eligible.length, uniqueSymbols: requestSymbols.length, exchanges: exchanges.size, countries: countries.size, currencies: currencies.size },
    scan: { requestedStocks: eligible.length, requestedSymbols: requestSymbols.length, quotedStocks: quotedSymbols.size, failedBatches, batches: batches.length, batchSize, coveragePercent, coverageComplete },
    candidates: { opportunity, watchOut, buyResearch, sellResearch, watchOutResearch, deepAnalysisQueue },
    seriousAlerts: { buy: [], sell: [], watchOut: seriousVerification.alerts, certifiedRuleIds: [CERTIFIED_EXTREME_VOLATILITY_RULE.id], verification: { prefilterCandidates: seriousVerification.prefilterCandidates, checkedCandidates: seriousVerification.checkedCandidates, qualifyingAlerts: seriousVerification.alerts.length, failedCandidates: seriousVerification.failedCandidates, skippedCandidates: seriousVerification.skippedCandidates, coveragePercent: seriousVerification.coveragePercent, coverageComplete: seriousVerification.coverageComplete, maximumCandidates: maximumCertifiedChecks, concurrency: certifiedCheckConcurrency, dataFreshnessMaximumDays: 7, errors: seriousVerification.errors } },
    opportunityCoverage: opportunityCoverageSummary(),
    errors: [...new Set([...directory.errors, ...errors, ...seriousVerification.errors])].slice(0, 200),
    safety: { databaseWrites: false, publishing: false, notifications: false, seriousSignalsUnlocked: seriousVerification.alerts.length > 0, certifiedRuleEnabled: true },
  };
}
