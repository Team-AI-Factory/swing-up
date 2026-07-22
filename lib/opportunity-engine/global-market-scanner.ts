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
  price: number | null;
  changePercent: number | null;
  volume: number | null;
  averageVolume: number | null;
  marketCap: number | null;
  yearHigh: number | null;
  yearLow: number | null;
  exchange: string | null;
  timestamp: number | null;
};

export type GlobalScanCandidate = GlobalStock & Omit<GlobalQuote, "exchange"> & {
  quoteExchange: string | null;
  listingKey: string;
  liquidityScore: number;
  momentumScore: number;
  volatilityScore: number;
  opportunityPriority: number;
  riskPriority: number;
  reasons: string[];
};

export type GlobalScanResult = {
  ok: boolean;
  checkedAt: string;
  universe: {
    provider: "Financial Modeling Prep";
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
    deepAnalysisQueue: string[];
  };
  errors: string[];
  safety: {
    databaseWrites: false;
    publishing: false;
    notifications: false;
    seriousSignalsUnlocked: false;
  };
};

type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const number = (value: unknown) => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/,/g, "")) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
};
const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const exchangeKey = (value: string | null | undefined) => (value ?? "UNKNOWN").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
const listingKey = (stock: Pick<GlobalStock, "exchangeShortName" | "symbol">) => `${exchangeKey(stock.exchangeShortName)}:${stock.symbol}`;

function safeError(error: unknown) {
  return error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 240) : "unknown_global_scan_error";
}

async function fmp(path: string, apiKey: string, attempts = 4): Promise<unknown> {
  const separator = path.includes("?") ? "&" : "?";
  const url = `https://financialmodelingprep.com/stable/${path}${separator}apikey=${encodeURIComponent(apiKey)}`;
  let last: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers: { accept: "application/json", "user-agent": "SwingUpGlobalScanner/1.0" },
        signal: AbortSignal.timeout(60_000),
      });
      if (response.ok) return await response.json();
      last = new Error(`fmp_http_${response.status}:${path.split("?")[0]}`);
      if (response.status !== 429 && response.status < 500) break;
    } catch (error) {
      last = error;
    }
    await sleep(1_000 * 2 ** attempt);
  }
  throw last instanceof Error ? last : new Error(`fmp_request_failed:${path}`);
}

export function normalizeGlobalStockUniverse(payload: unknown): GlobalStock[] {
  const seen = new Set<string>();
  return array(payload).flatMap((value): GlobalStock[] => {
    const row = object(value);
    const symbol = text(row.symbol)?.toUpperCase();
    const exchangeShortName = text(row.exchangeShortName) ?? text(row.exchange) ?? "UNKNOWN";
    if (!symbol) return [];
    const key = `${exchangeKey(exchangeShortName)}:${symbol}`;
    if (seen.has(key)) return [];
    const type = text(row.type);
    const activelyTrading = row.isActivelyTrading !== false;
    const name = text(row.name) ?? symbol;
    const isFund = /etf|fund|trust/i.test(type ?? "") || /\bETF\b/i.test(name);
    const isOrdinaryShare = !type || /stock|common|ordinary|share|equity|adr|gdr/i.test(type);
    if (!activelyTrading || isFund || !isOrdinaryShare) return [];
    seen.add(key);
    return [{
      symbol,
      name,
      exchange: text(row.exchange) ?? exchangeShortName,
      exchangeShortName,
      country: text(row.country),
      currency: text(row.currency),
      type,
      activelyTrading,
    }];
  });
}

export function normalizeGlobalQuotes(payload: unknown): GlobalQuote[] {
  return array(payload).flatMap((value): GlobalQuote[] => {
    const row = object(value);
    const symbol = text(row.symbol)?.toUpperCase();
    if (!symbol) return [];
    return [{
      symbol,
      price: number(row.price),
      changePercent: number(row.changePercentage) ?? number(row.changesPercentage),
      volume: number(row.volume),
      averageVolume: number(row.avgVolume) ?? number(row.averageVolume),
      marketCap: number(row.marketCap),
      yearHigh: number(row.yearHigh),
      yearLow: number(row.yearLow),
      exchange: text(row.exchange) ?? text(row.exchangeShortName),
      timestamp: number(row.timestamp),
    }];
  });
}

function chooseListing(options: GlobalStock[], quote: GlobalQuote): GlobalStock | null {
  if (!options.length) return null;
  if (options.length === 1) return options[0];
  const quoteExchange = exchangeKey(quote.exchange);
  const exact = options.find((stock) => {
    const keys = [exchangeKey(stock.exchange), exchangeKey(stock.exchangeShortName)];
    return quoteExchange !== "UNKNOWN" && keys.includes(quoteExchange);
  });
  return exact ?? null;
}

function scoreCandidate(stock: GlobalStock, quote: GlobalQuote): GlobalScanCandidate {
  const volumeRatio = quote.volume !== null && quote.averageVolume !== null && quote.averageVolume > 0 ? quote.volume / quote.averageVolume : 0;
  const marketCapBillions = quote.marketCap !== null ? quote.marketCap / 1_000_000_000 : 0;
  const liquidityScore = clamp(Math.log10(Math.max(1, quote.volume ?? 0)) * 12 + Math.log10(Math.max(1, quote.marketCap ?? 0)) * 3 - 30);
  const momentumScore = clamp(50 + (quote.changePercent ?? 0) * 5);
  const rangePosition = quote.price !== null && quote.yearHigh !== null && quote.yearLow !== null && quote.yearHigh > quote.yearLow
    ? (quote.price - quote.yearLow) / (quote.yearHigh - quote.yearLow)
    : 0.5;
  const volatilityScore = clamp(Math.abs(quote.changePercent ?? 0) * 10 + Math.max(0, volumeRatio - 1) * 15);
  const opportunityPriority = clamp(
    liquidityScore * 0.3
    + momentumScore * 0.25
    + clamp(volumeRatio * 35) * 0.2
    + clamp((1 - Math.abs(rangePosition - 0.45)) * 100) * 0.15
    + clamp(Math.log10(Math.max(1, marketCapBillions)) * 25) * 0.1,
  );
  const riskPriority = clamp(
    volatilityScore * 0.45
    + clamp(Math.max(0, -(quote.changePercent ?? 0)) * 10) * 0.3
    + clamp(Math.max(0, 0.2 - rangePosition) * 250) * 0.25,
  );
  const reasons = [
    ...(volumeRatio >= 1.5 ? [`Volume is ${volumeRatio.toFixed(1)}x normal`] : []),
    ...((quote.changePercent ?? 0) >= 4 ? [`Price rose ${quote.changePercent?.toFixed(1)}%`] : []),
    ...((quote.changePercent ?? 0) <= -4 ? [`Price fell ${quote.changePercent?.toFixed(1)}%`] : []),
    ...(rangePosition <= 0.15 ? ["Trading near its 52-week low"] : []),
    ...(rangePosition >= 0.9 ? ["Trading near its 52-week high"] : []),
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
    reasons,
  };
}

export async function scanAllGlobalStocks(options?: {
  maximumStocks?: number;
  batchSize?: number;
  deepQueueSize?: number;
  minimumPrice?: number;
  minimumMarketCap?: number;
}): Promise<GlobalScanResult> {
  const apiKey = process.env.FMP_API_KEY?.trim();
  if (!apiKey) throw new Error("FMP_API_KEY is required for the global stock scanner");
  const maximumStocks = Math.max(1, Math.min(options?.maximumStocks ?? 100_000, 150_000));
  const batchSize = Math.max(1, Math.min(options?.batchSize ?? 250, 500));
  const deepQueueSize = Math.max(10, Math.min(options?.deepQueueSize ?? 250, 2_000));
  const minimumPrice = Math.max(0, options?.minimumPrice ?? 0.25);
  const minimumMarketCap = Math.max(0, options?.minimumMarketCap ?? 25_000_000);
  const errors: string[] = [];

  const universePayload = await fmp("stock-list", apiKey);
  const allStocks = normalizeGlobalStockUniverse(universePayload).slice(0, maximumStocks);
  const eligible = allStocks.filter((stock) => stock.symbol.length <= 24);
  const stocksBySymbol = new Map<string, GlobalStock[]>();
  for (const stock of eligible) stocksBySymbol.set(stock.symbol, [...(stocksBySymbol.get(stock.symbol) ?? []), stock]);
  const requestSymbols = [...stocksBySymbol.keys()];
  const quoteRows: GlobalQuote[] = [];
  let failedBatches = 0;
  const batches = Array.from({ length: Math.ceil(requestSymbols.length / batchSize) }, (_, index) => requestSymbols.slice(index * batchSize, (index + 1) * batchSize));

  for (const symbols of batches) {
    try {
      const payload = await fmp(`batch-quote?symbols=${encodeURIComponent(symbols.join(","))}`, apiKey);
      quoteRows.push(...normalizeGlobalQuotes(payload));
    } catch (error) {
      failedBatches += 1;
      errors.push(safeError(error));
    }
    await sleep(250);
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
  const deepAnalysisQueue = [...new Set([...opportunity, ...watchOut].map((row) => row.symbol))].slice(0, deepQueueSize * 2);
  const countries = new Set(eligible.map((stock) => stock.country).filter((value): value is string => Boolean(value)));
  const exchanges = new Set(eligible.map((stock) => stock.exchangeShortName));
  const currencies = new Set(eligible.map((stock) => stock.currency).filter((value): value is string => Boolean(value)));
  const coveragePercent = requestSymbols.length ? Number(((quotedSymbols.size / requestSymbols.length) * 100).toFixed(2)) : 0;
  const coverageComplete = failedBatches === 0 && coveragePercent >= 99;

  return {
    ok: coverageComplete,
    checkedAt: new Date().toISOString(),
    universe: {
      provider: "Financial Modeling Prep",
      stocksAvailable: allStocks.length,
      stocksEligible: eligible.length,
      uniqueSymbols: requestSymbols.length,
      exchanges: exchanges.size,
      countries: countries.size,
      currencies: currencies.size,
    },
    scan: {
      requestedStocks: eligible.length,
      requestedSymbols: requestSymbols.length,
      quotedStocks: quotedSymbols.size,
      failedBatches,
      batches: batches.length,
      batchSize,
      coveragePercent,
      coverageComplete,
    },
    candidates: { opportunity, watchOut, deepAnalysisQueue },
    errors: [...new Set(errors)].slice(0, 50),
    safety: { databaseWrites: false, publishing: false, notifications: false, seriousSignalsUnlocked: false },
  };
}
