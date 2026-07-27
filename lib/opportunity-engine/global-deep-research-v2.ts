import { runGlobalDeepResearch, type GlobalDeepResearchCase, type GlobalDeepResearchResult } from "./global-deep-research";

type YahooMapping = { symbol: string; reason: string };
type YahooPrice = { price: number; observedAt: string; sourceUrl: string };

const unique = <T>(values: T[]) => [...new Set(values)];
const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const safeError = (error: unknown) => error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 260) : "yahoo_fallback_failed";

function yahooMapping(item: GlobalDeepResearchCase): YahooMapping | null {
  const exchange = item.exchange.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const symbol = item.symbol.toUpperCase();
  const direct = () => symbol.replace(/\.([A-Z])$/, "-$1");
  if (["NASDAQ", "NYSE", "AMEX", "NYSEARCA", "BATS", "CBOE", "OTC", "OTCQX", "OTCQB"].includes(exchange)) return { symbol: direct(), reason: "US primary listing" };
  if (["LSE", "LSIN"].includes(exchange)) return { symbol: `${symbol}.L`, reason: "London Stock Exchange" };
  if (["TSE", "JPX"].includes(exchange)) return { symbol: `${symbol}.T`, reason: "Tokyo Stock Exchange" };
  if (exchange === "HKEX") return { symbol: `${symbol.padStart(4, "0")}.HK`, reason: "Hong Kong Exchange" };
  if (exchange === "NSE") return { symbol: `${symbol}.NS`, reason: "National Stock Exchange of India" };
  if (exchange === "BSE") return { symbol: `${symbol}.BO`, reason: "Bombay Stock Exchange" };
  if (exchange === "ASX") return { symbol: `${symbol}.AX`, reason: "Australian Securities Exchange" };
  if (exchange === "TSX") return { symbol: `${symbol}.TO`, reason: "Toronto Stock Exchange" };
  if (["TSXV", "TSXVENTURE"].includes(exchange)) return { symbol: `${symbol}.V`, reason: "TSX Venture" };
  if (exchange === "NEO") return { symbol: `${symbol}.NE`, reason: "Cboe Canada" };
  if (["XETR", "TRADEGATE"].includes(exchange)) return { symbol: `${symbol}.DE`, reason: "German electronic listing" };
  if (exchange === "FWB") return { symbol: `${symbol}.F`, reason: "Frankfurt Stock Exchange" };
  if (exchange === "MIL") return { symbol: `${symbol}.MI`, reason: "Borsa Italiana" };
  if (["BME", "BMAD"].includes(exchange)) return { symbol: `${symbol}.MC`, reason: "Madrid Stock Exchange" };
  if (exchange === "SIX") return { symbol: `${symbol}.SW`, reason: "SIX Swiss Exchange" };
  if (exchange === "VIE") return { symbol: `${symbol}.VI`, reason: "Vienna Stock Exchange" };
  if (["OMXSTO", "NGM"].includes(exchange)) return { symbol: `${symbol}.ST`, reason: "Sweden" };
  if (exchange === "OMXCOP") return { symbol: `${symbol}.CO`, reason: "Copenhagen" };
  if (exchange === "OMXHEL") return { symbol: `${symbol}.HE`, reason: "Helsinki" };
  if (exchange === "OSL") return { symbol: `${symbol}.OL`, reason: "Oslo" };
  if (exchange === "WSE") return { symbol: `${symbol}.WA`, reason: "Warsaw" };
  if (exchange === "PSE") return { symbol: `${symbol}.PR`, reason: "Prague" };
  if (exchange === "BET") return { symbol: `${symbol}.RO`, reason: "Bucharest" };
  if (exchange === "ATHEX") return { symbol: `${symbol}.AT`, reason: "Athens" };
  if (exchange === "BIST") return { symbol: `${symbol}.IS`, reason: "Borsa Istanbul" };
  if (exchange === "TASE") return { symbol: `${symbol}.TA`, reason: "Tel Aviv" };
  if (exchange === "KRX") return { symbol: `${symbol.padStart(6, "0")}.KS`, reason: "Korea Exchange" };
  if (exchange === "KOSDAQ") return { symbol: `${symbol.padStart(6, "0")}.KQ`, reason: "KOSDAQ" };
  if (exchange === "TWSE") return { symbol: `${symbol}.TW`, reason: "Taiwan Stock Exchange" };
  if (exchange === "TPEX") return { symbol: `${symbol}.TWO`, reason: "Taipei Exchange" };
  if (exchange === "SSE") return { symbol: `${symbol}.SS`, reason: "Shanghai Stock Exchange" };
  if (exchange === "SZSE") return { symbol: `${symbol}.SZ`, reason: "Shenzhen Stock Exchange" };
  if (exchange === "SGX") return { symbol: `${symbol}.SI`, reason: "Singapore Exchange" };
  if (["MYX", "BURSA"].includes(exchange)) return { symbol: `${symbol}.KL`, reason: "Bursa Malaysia" };
  if (exchange === "IDX") return { symbol: `${symbol}.JK`, reason: "Indonesia Stock Exchange" };
  if (exchange === "SET") return { symbol: `${symbol}.BK`, reason: "Stock Exchange of Thailand" };
  if (exchange === "PSE") return { symbol: `${symbol}.PS`, reason: "Philippine Stock Exchange" };
  if (exchange === "NZX") return { symbol: `${symbol}.NZ`, reason: "New Zealand Exchange" };
  if (exchange === "JSE") return { symbol: `${symbol}.JO`, reason: "Johannesburg Stock Exchange" };
  if (["BMFBOVESPA", "B3"].includes(exchange)) return { symbol: `${symbol}.SA`, reason: "B3 Brazil" };
  if (exchange === "BMV") return { symbol: `${symbol}.MX`, reason: "Mexican Stock Exchange" };
  if (exchange === "BYMA") return { symbol: `${symbol}.BA`, reason: "Buenos Aires" };
  if (exchange === "BCS") return { symbol: `${symbol}.SN`, reason: "Santiago" };
  if (exchange === "TADAWUL") return { symbol: `${symbol}.SR`, reason: "Saudi Exchange" };
  if (exchange === "QSE") return { symbol: `${symbol}.QA`, reason: "Qatar Stock Exchange" };
  if (exchange === "KSE") return { symbol: `${symbol}.KW`, reason: "Kuwait" };
  const country = (item.country ?? "").toLowerCase();
  if (exchange === "EURONEXT") {
    if (country.includes("france")) return { symbol: `${symbol}.PA`, reason: "Euronext Paris" };
    if (country.includes("netherlands")) return { symbol: `${symbol}.AS`, reason: "Euronext Amsterdam" };
    if (country.includes("belgium")) return { symbol: `${symbol}.BR`, reason: "Euronext Brussels" };
    if (country.includes("portugal")) return { symbol: `${symbol}.LS`, reason: "Euronext Lisbon" };
    if (country.includes("ireland")) return { symbol: `${symbol}.IR`, reason: "Euronext Dublin" };
  }
  return null;
}

async function fetchYahooPrice(mapping: YahooMapping): Promise<YahooPrice> {
  const failures: string[] = [];
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(mapping.symbol)}?range=10d&interval=1d&events=history&includeAdjustedClose=true`;
    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; SwingUpDeepResearch/2.0)", referer: "https://finance.yahoo.com/" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`yahoo_http_${response.status}`);
      const payload = await response.json() as Record<string, unknown>;
      const chart = payload.chart as Record<string, unknown> | undefined;
      const result = Array.isArray(chart?.result) ? chart.result[0] as Record<string, unknown> : null;
      const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
      const indicators = result?.indicators as Record<string, unknown> | undefined;
      const adjustedContainer = Array.isArray(indicators?.adjclose) ? indicators.adjclose[0] as Record<string, unknown> : null;
      const quoteContainer = Array.isArray(indicators?.quote) ? indicators.quote[0] as Record<string, unknown> : null;
      const adjusted = Array.isArray(adjustedContainer?.adjclose) ? adjustedContainer.adjclose : [];
      const closes = Array.isArray(quoteContainer?.close) ? quoteContainer.close : [];
      for (let index = timestamps.length - 1; index >= 0; index -= 1) {
        const seconds = Number(timestamps[index]);
        const value = Number(adjusted[index] ?? closes[index]);
        if (Number.isFinite(seconds) && Number.isFinite(value) && value > 0) {
          return { price: value, observedAt: new Date(seconds * 1000).toISOString(), sourceUrl: url };
        }
      }
      throw new Error(`yahoo_price_unavailable:${mapping.symbol}`);
    } catch (error) {
      failures.push(`${host}:${safeError(error)}`);
    }
  }
  throw new Error(`all_yahoo_price_sources_failed:${mapping.symbol}:${failures.join("|")}`);
}

function agreementPercent(left: number, right: number) {
  const midpoint = (left + right) / 2;
  return midpoint > 0 ? (Math.abs(left - right) / midpoint) * 100 : null;
}

async function enrichCase(item: GlobalDeepResearchCase): Promise<GlobalDeepResearchCase> {
  if (item.secondSourcePrice !== null) return item;
  const mapping = yahooMapping(item);
  if (!mapping) {
    return {
      ...item,
      providersAttempted: unique([...item.providersAttempted, "Yahoo Finance"]),
      providerErrors: unique([...item.providerErrors, `Yahoo mapping unavailable for ${item.exchange}:${item.symbol}`]),
      blockedReasons: unique([...item.blockedReasons, "A supported independent price mapping was unavailable for this listing."]),
    };
  }
  try {
    const yahoo = await fetchYahooPrice(mapping);
    const agreement = agreementPercent(item.currentPrice, yahoo.price);
    const conflict = agreement !== null && agreement > 5;
    const evidenceScore = clamp(item.evidenceScore + (conflict ? -20 : agreement !== null && agreement <= 2 ? 20 : 10));
    const blockedReasons = unique([
      ...item.blockedReasons.filter((reason) => reason !== "A second current price source was unavailable."),
      ...(conflict ? [`TradingView and Yahoo prices disagree by ${agreement?.toFixed(2)}%.`] : []),
    ]);
    const researchDisposition = conflict
      ? "reject_or_deprioritize"
      : evidenceScore >= 80 && item.researchDisposition !== "reject_or_deprioritize"
        ? "advance_to_committee_research"
        : evidenceScore >= 55
          ? "watch_for_more_evidence"
          : "reject_or_deprioritize";
    return {
      ...item,
      secondSourcePrice: yahoo.price,
      priceAgreementPercent: agreement,
      providersAttempted: unique([...item.providersAttempted, "Yahoo Finance"]),
      providersUsed: unique([...item.providersUsed, "Yahoo Finance"]),
      evidenceScore,
      researchDisposition,
      blockedReasons,
      receipts: [...item.receipts, { source: `Yahoo Finance adjusted price (${mapping.reason})`, url: yahoo.sourceUrl, observedAt: yahoo.observedAt, fields: ["adjusted close", "independent price confirmation"] }],
    };
  } catch (error) {
    return {
      ...item,
      providersAttempted: unique([...item.providersAttempted, "Yahoo Finance"]),
      providerErrors: unique([...item.providerErrors, `Yahoo Finance: ${safeError(error)}`]),
      blockedReasons: unique([...item.blockedReasons, "Independent adjusted-price confirmation failed."]),
    };
  }
}

export async function runGlobalDeepResearchV2(options?: { perAction?: number }): Promise<GlobalDeepResearchResult> {
  const base = await runGlobalDeepResearch(options);
  const buy: GlobalDeepResearchCase[] = [];
  const sell: GlobalDeepResearchCase[] = [];
  const watchOut: GlobalDeepResearchCase[] = [];
  for (const item of base.results.buy) buy.push(await enrichCase(item));
  for (const item of base.results.sell) sell.push(await enrichCase(item));
  for (const item of base.results.watchOut) watchOut.push(await enrichCase(item));
  const all = [...buy, ...sell, ...watchOut];
  return {
    ...base,
    checkedAt: new Date().toISOString(),
    results: { buy, sell, watchOut },
    summary: {
      researched: all.length,
      advanced: all.filter((row) => row.researchDisposition === "advance_to_committee_research").length,
      watched: all.filter((row) => row.researchDisposition === "watch_for_more_evidence").length,
      rejected: all.filter((row) => row.researchDisposition === "reject_or_deprioritize").length,
      seriousSignals: 0,
      providerErrors: all.reduce((sum, row) => sum + row.providerErrors.length, 0),
    },
  };
}
