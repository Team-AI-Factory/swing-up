import type { LiveOpportunitySnapshot } from "./live-data";
import type { CompanyFoundationInput, ExpectationsMetrics, SourceReceipt } from "./types";

type JsonRecord = Record<string, unknown>;
type ProviderValue = { provider: string; value: number; observedAt: string; sourceUrl: string };

type EnrichmentResult = {
  snapshots: LiveOpportunitySnapshot[];
  providerSummary: Array<{
    ticker: string;
    providersAttempted: string[];
    providersUsed: string[];
    providerErrors: string[];
    expectationSources: string[];
    priceSources: string[];
    contradictions: string[];
  }>;
};

const object = (value: unknown): JsonRecord => value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
const rows = (value: unknown): JsonRecord[] => Array.isArray(value)
  ? value.filter((item): item is JsonRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item))
  : value && typeof value === "object" ? [value as JsonRecord] : [];
const finite = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/[,%$]/g, "")) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
};
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const unique = <T>(values: T[]) => [...new Set(values)];
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function safeError(value: unknown) {
  const message = value instanceof Error ? value.message : String(value ?? "provider_error");
  return message.replace(/[A-Za-z0-9_\-]{24,}/g, "[redacted]").replace(/apikey=[^&\s]+/gi, "apikey=[redacted]").slice(0, 220);
}

function ageDays(value: string | null | undefined) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? Math.max(0, (Date.now() - time) / 86_400_000) : null;
}

function fiscalPeriodEnd(value: string | null) {
  const candidate = value?.split(":").at(-1) ?? null;
  return candidate && /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : null;
}

async function fetchJson(url: URL, headers: Record<string, string> = {}) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", ...headers },
    cache: "no-store",
    signal: AbortSignal.timeout(18_000),
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = await response.text().catch(() => null);
  }
  const message = JSON.stringify(body ?? "").toLowerCase();
  if (!response.ok || /invalid.*api|rate limit|limit reach|subscription|plan required/.test(message)) {
    throw new Error(`provider_http_${response.status}:${url.hostname}:${message.slice(0, 120)}`);
  }
  return body;
}

function firstNumber(row: JsonRecord | null, names: string[]) {
  if (!row) return null;
  for (const name of names) {
    const value = finite(row[name]);
    if (value !== null) return value;
  }
  return null;
}

function firstDate(row: JsonRecord | null, names: string[]) {
  if (!row) return null;
  for (const name of names) {
    const raw = text(row[name]);
    if (raw && Number.isFinite(Date.parse(raw))) return new Date(raw).toISOString();
  }
  return null;
}

function agreementScore(values: number[]) {
  if (values.length < 2) return null;
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const midpoint = (minimum + maximum) / 2;
  if (midpoint <= 0) return null;
  const spread = ((maximum - minimum) / midpoint) * 100;
  if (spread <= 1) return 100;
  if (spread <= 3) return 95;
  if (spread <= 7) return 88;
  if (spread <= 15) return 75;
  if (spread <= 30) return 55;
  return 30;
}

function agreementPercent(values: number[]) {
  if (values.length < 2) return null;
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const midpoint = (minimum + maximum) / 2;
  return midpoint > 0 ? ((maximum - minimum) / midpoint) * 100 : null;
}

function fmpBase() {
  return (process.env.FMP_BASE_URL?.trim() || "https://financialmodelingprep.com").replace(/\/api\/v3\/?$/, "");
}

async function fmpCall(path: string, ticker: string, params: Record<string, string> = {}) {
  const key = process.env.FMP_API_KEY?.trim();
  if (!key) return null;
  const url = new URL(`${fmpBase()}${path}`);
  url.searchParams.set("symbol", ticker);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  url.searchParams.set("apikey", key);
  const body = await fetchJson(url, { apikey: key });
  return { body, sourceUrl: url.toString().replace(key, "[redacted]") };
}

async function fetchFmp(ticker: string, annualRevenue: number | null) {
  if (!process.env.FMP_API_KEY?.trim()) return null;
  const [quoteResult, estimatesResult, targetsResult, gradesResult] = await Promise.allSettled([
    fmpCall("/stable/quote", ticker),
    fmpCall("/stable/analyst-estimates", ticker, { period: "annual", page: "0", limit: "5" }),
    fmpCall("/stable/price-target-consensus", ticker),
    fmpCall("/stable/grades-summary", ticker),
  ]);
  const errors: string[] = [];
  const fulfilled = <T>(result: PromiseSettledResult<T>, label: string): T | null => {
    if (result.status === "fulfilled") return result.value;
    errors.push(`FMP ${label}: ${safeError(result.reason)}`);
    return null;
  };
  const quote = fulfilled(quoteResult, "quote");
  const estimates = fulfilled(estimatesResult, "analyst-estimates");
  const targets = fulfilled(targetsResult, "price-target-consensus");
  const grades = fulfilled(gradesResult, "grades-summary");
  const quoteRow = rows(quote?.body)[0] ?? null;
  const estimateRows = rows(estimates?.body).sort((left, right) => String(left.date ?? left.calendarYear ?? "").localeCompare(String(right.date ?? right.calendarYear ?? "")));
  const futureEstimate = estimateRows.find((row) => {
    const date = firstDate(row, ["date", "fiscalDateEnding"]);
    return date ? Date.parse(date) > Date.now() - 180 * 86_400_000 : true;
  }) ?? estimateRows.at(-1) ?? null;
  const targetRow = rows(targets?.body)[0] ?? null;
  const gradeRow = rows(grades?.body)[0] ?? null;
  const estimatedRevenue = firstNumber(futureEstimate, ["estimatedRevenueAvg", "estimatedRevenueAverage", "revenueAvg", "estimatedRevenue"]);
  const consensusRevenueGrowthPercent = annualRevenue && estimatedRevenue ? ((estimatedRevenue / annualRevenue) - 1) * 100 : null;
  return {
    provider: "FMP",
    errors,
    quote: firstNumber(quoteRow, ["price"]),
    quoteObservedAt: new Date().toISOString(),
    quoteSourceUrl: quote?.sourceUrl ?? null,
    marketCap: firstNumber(quoteRow, ["marketCap"]),
    forwardPe: firstNumber(quoteRow, ["forwardPE", "forwardPe"]),
    consensusRevenueGrowthPercent,
    consensusEpsGrowthPercent: firstNumber(futureEstimate, ["estimatedEpsAvg", "estimatedEPSAvg", "epsAvg"]),
    targetConsensus: firstNumber(targetRow, ["targetConsensus", "targetPriceConsensus", "priceTargetConsensus", "targetMedian"]),
    targetMedian: firstNumber(targetRow, ["targetMedian", "targetPriceMedian"]),
    targetHigh: firstNumber(targetRow, ["targetHigh", "targetPriceHigh"]),
    targetLow: firstNumber(targetRow, ["targetLow", "targetPriceLow"]),
    analystCount: firstNumber(futureEstimate, ["numberAnalystEstimatedRevenue", "numberAnalystsEstimatedRevenue", "numberAnalystsEstimatedEps", "numberAnalystEstimatedEps"]),
    strongBuy: firstNumber(gradeRow, ["strongBuy"]),
    buy: firstNumber(gradeRow, ["buy"]),
    hold: firstNumber(gradeRow, ["hold"]),
    sell: firstNumber(gradeRow, ["sell"]),
    strongSell: firstNumber(gradeRow, ["strongSell"]),
    observedAt: firstDate(targetRow, ["lastUpdated", "date", "publishedDate"]) ?? new Date().toISOString(),
    sourceUrls: unique([quote?.sourceUrl, estimates?.sourceUrl, targets?.sourceUrl, grades?.sourceUrl].filter((value): value is string => Boolean(value))),
  };
}

async function fetchAlphaVantage(ticker: string) {
  const key = process.env.ALPHA_VANTAGE_API_KEY?.trim();
  if (!key) return null;
  const call = async (functionName: string) => {
    const url = new URL("https://www.alphavantage.co/query");
    url.searchParams.set("function", functionName);
    url.searchParams.set("symbol", ticker);
    url.searchParams.set("apikey", key);
    return { body: await fetchJson(url), sourceUrl: url.toString().replace(key, "[redacted]") };
  };
  const [quoteResult, overviewResult] = await Promise.allSettled([call("GLOBAL_QUOTE"), call("OVERVIEW")]);
  const errors: string[] = [];
  const quote = quoteResult.status === "fulfilled" ? quoteResult.value : (errors.push(`Alpha Vantage quote: ${safeError(quoteResult.reason)}`), null);
  const overview = overviewResult.status === "fulfilled" ? overviewResult.value : (errors.push(`Alpha Vantage overview: ${safeError(overviewResult.reason)}`), null);
  const quoteRow = object(object(quote?.body)["Global Quote"]);
  const overviewRow = object(overview?.body);
  const target = firstNumber(overviewRow, ["AnalystTargetPrice"]);
  return {
    provider: "Alpha Vantage",
    errors,
    quote: firstNumber(quoteRow, ["05. price"]),
    quoteObservedAt: new Date().toISOString(),
    quoteSourceUrl: quote?.sourceUrl ?? null,
    targetConsensus: target,
    forwardPe: firstNumber(overviewRow, ["ForwardPE"]),
    revenueGrowthPercent: firstNumber(overviewRow, ["QuarterlyRevenueGrowthYOY"]),
    epsGrowthPercent: firstNumber(overviewRow, ["QuarterlyEarningsGrowthYOY"]),
    observedAt: new Date().toISOString(),
    sourceUrls: unique([quote?.sourceUrl, overview?.sourceUrl].filter((value): value is string => Boolean(value))),
  };
}

async function fetchPolygon(ticker: string) {
  const key = process.env.POLYGON_API_KEY?.trim();
  if (!key) return null;
  const url = new URL(`https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(ticker)}/prev`);
  url.searchParams.set("adjusted", "true");
  url.searchParams.set("apiKey", key);
  const body = await fetchJson(url);
  const row = rows(object(body).results)[0] ?? null;
  return {
    provider: "Polygon",
    quote: firstNumber(row, ["c", "close"]),
    quoteObservedAt: firstNumber(row, ["t"]) ? new Date((firstNumber(row, ["t"]) ?? 0)).toISOString() : new Date().toISOString(),
    quoteSourceUrl: url.toString().replace(key, "[redacted]"),
  };
}

async function fetchMarketaux(ticker: string) {
  const key = process.env.MARKETAUX_API_KEY?.trim();
  if (!key) return null;
  const url = new URL("https://api.marketaux.com/v1/news/all");
  url.searchParams.set("symbols", ticker);
  url.searchParams.set("filter_entities", "true");
  url.searchParams.set("language", "en");
  url.searchParams.set("limit", "3");
  url.searchParams.set("api_token", key);
  const body = await fetchJson(url);
  const articles = rows(object(body).data).map((article) => ({
    title: text(article.title),
    description: text(article.description),
    url: text(article.url),
    publishedAt: firstDate(article, ["published_at", "publishedAt"]),
    source: text(article.source),
    entities: rows(article.entities),
  })).filter((article) => article.title && article.url);
  const relevant = articles.filter((article) => {
    const age = ageDays(article.publishedAt);
    return age !== null && age <= 7;
  });
  const sentimentValues = relevant.flatMap((article) => article.entities.map((entity) => finite(entity.sentiment_score)).filter((value): value is number => value !== null));
  const sentiment = sentimentValues.length ? sentimentValues.reduce((sum, value) => sum + value, 0) / sentimentValues.length : null;
  return {
    provider: "Marketaux",
    articles: relevant,
    sentiment,
    sourceUrl: url.toString().replace(key, "[redacted]"),
  };
}

function annualRevenue(snapshot: LiveOpportunitySnapshot) {
  const raw = object(snapshot.foundation.raw);
  const annual = object(raw.annual);
  const current = object(annual.current);
  return finite(current.val);
}

function receipt(source: string, url: string | null, observedAt: string | null, fields: string[]): SourceReceipt | null {
  return url ? { source, url, observedAt, reliability: "high", fields } : null;
}

function mergeExpectations(base: ExpectationsMetrics, values: {
  fmp: Awaited<ReturnType<typeof fetchFmp>>;
  alpha: Awaited<ReturnType<typeof fetchAlphaVantage>>;
}): ExpectationsMetrics {
  const targetValues = [values.fmp?.targetConsensus, values.alpha?.targetConsensus].filter((value): value is number => value !== null && value !== undefined && value > 0);
  const sources = unique([
    ...(base.sources ?? []),
    ...(values.fmp && values.fmp.sourceUrls.length ? ["FMP"] : []),
    ...(values.alpha && values.alpha.sourceUrls.length ? ["Alpha Vantage"] : []),
  ]);
  return {
    ...base,
    consensusRevenueGrowthPercent: values.fmp?.consensusRevenueGrowthPercent ?? base.consensusRevenueGrowthPercent,
    consensusEpsGrowthPercent: values.alpha?.epsGrowthPercent ?? values.fmp?.consensusEpsGrowthPercent ?? base.consensusEpsGrowthPercent ?? null,
    targetPriceConsensus: values.fmp?.targetConsensus ?? values.alpha?.targetConsensus ?? base.targetPriceConsensus ?? null,
    targetPriceMedian: values.fmp?.targetMedian ?? base.targetPriceMedian ?? null,
    targetPriceHigh: values.fmp?.targetHigh ?? base.targetPriceHigh ?? null,
    targetPriceLow: values.fmp?.targetLow ?? base.targetPriceLow ?? null,
    analystCount: values.fmp?.analystCount ?? base.analystCount ?? null,
    strongBuyCount: values.fmp?.strongBuy ?? base.strongBuyCount ?? null,
    buyCount: values.fmp?.buy ?? base.buyCount ?? null,
    holdCount: values.fmp?.hold ?? base.holdCount ?? null,
    sellCount: values.fmp?.sell ?? base.sellCount ?? null,
    strongSellCount: values.fmp?.strongSell ?? base.strongSellCount ?? null,
    observedAt: values.fmp?.observedAt ?? values.alpha?.observedAt ?? base.observedAt ?? null,
    sources,
    providerAgreementScore: agreementScore(targetValues),
  };
}

export async function enrichLiveOpportunityUniverse(snapshots: LiveOpportunitySnapshot[]): Promise<EnrichmentResult> {
  const enriched: LiveOpportunitySnapshot[] = [];
  const providerSummary: EnrichmentResult["providerSummary"] = [];
  for (const snapshot of snapshots) {
    const ticker = snapshot.foundation.ticker;
    const attempted: string[] = [];
    const errors: string[] = [];
    const contradictions: string[] = [];
    const [fmpResult, alphaResult, polygonResult, marketauxResult] = await Promise.allSettled([
      process.env.FMP_API_KEY?.trim() ? (attempted.push("FMP"), fetchFmp(ticker, annualRevenue(snapshot))) : Promise.resolve(null),
      process.env.ALPHA_VANTAGE_API_KEY?.trim() ? (attempted.push("Alpha Vantage"), fetchAlphaVantage(ticker)) : Promise.resolve(null),
      process.env.POLYGON_API_KEY?.trim() ? (attempted.push("Polygon"), fetchPolygon(ticker)) : Promise.resolve(null),
      process.env.MARKETAUX_API_KEY?.trim() ? (attempted.push("Marketaux"), fetchMarketaux(ticker)) : Promise.resolve(null),
    ]);
    const settle = <T>(result: PromiseSettledResult<T>, label: string): T | null => {
      if (result.status === "fulfilled") return result.value;
      errors.push(`${label}: ${safeError(result.reason)}`);
      return null;
    };
    const fmp = settle(fmpResult, "FMP");
    const alpha = settle(alphaResult, "Alpha Vantage");
    const polygon = settle(polygonResult, "Polygon");
    const marketaux = settle(marketauxResult, "Marketaux");
    errors.push(...(fmp?.errors ?? []), ...(alpha?.errors ?? []));

    const priceValues: ProviderValue[] = [
      { provider: "Yahoo Finance", value: snapshot.foundation.market.currentPrice ?? Number.NaN, observedAt: snapshot.foundation.market.priceObservedAt ?? snapshot.foundation.observedAt, sourceUrl: snapshot.metadata.marketSourceUrl },
      ...(fmp?.quote && fmp.quoteSourceUrl ? [{ provider: "FMP", value: fmp.quote, observedAt: fmp.quoteObservedAt, sourceUrl: fmp.quoteSourceUrl }] : []),
      ...(alpha?.quote && alpha.quoteSourceUrl ? [{ provider: "Alpha Vantage", value: alpha.quote, observedAt: alpha.quoteObservedAt, sourceUrl: alpha.quoteSourceUrl }] : []),
      ...(polygon?.quote && polygon.quoteSourceUrl ? [{ provider: "Polygon", value: polygon.quote, observedAt: polygon.quoteObservedAt, sourceUrl: polygon.quoteSourceUrl }] : []),
    ].filter((value) => Number.isFinite(value.value) && value.value > 0);
    const prices = priceValues.map((value) => value.value);
    const priceSpread = agreementPercent(prices);
    if (priceSpread !== null && priceSpread > 3) contradictions.push(`Independent prices disagree by ${priceSpread.toFixed(2)}%.`);
    const targets = [fmp?.targetConsensus, alpha?.targetConsensus].filter((value): value is number => value !== null && value !== undefined && value > 0);
    const targetSpread = agreementPercent(targets);
    if (targetSpread !== null && targetSpread > 20) contradictions.push(`Independent target prices disagree by ${targetSpread.toFixed(2)}%.`);

    const expectations = mergeExpectations(snapshot.foundation.expectations, { fmp, alpha });
    const providerReceipts = [
      ...priceValues.slice(1).map((value) => receipt(`${value.provider} market data`, value.sourceUrl, value.observedAt, ["price"])),
      ...(fmp?.sourceUrls ?? []).map((url) => receipt("FMP estimates and targets", url, fmp?.observedAt ?? null, ["analyst estimates", "target consensus", "ratings"])),
      ...(alpha?.sourceUrls ?? []).map((url) => receipt("Alpha Vantage overview", url, alpha?.observedAt ?? null, ["target price", "forward valuation", "growth"])),
      ...(marketaux?.articles ?? []).slice(0, 2).map((article) => receipt(`Marketaux ${article.source ?? "news"}`, article.url, article.publishedAt, ["independent company news"])),
    ].filter((value): value is SourceReceipt => Boolean(value));
    const periodEnd = fiscalPeriodEnd(snapshot.foundation.fiscalPeriod);
    const expectationSources = unique(expectations.sources ?? []);
    const usableProviders = unique([
      ...(fmp && (fmp.quote || fmp.targetConsensus || fmp.consensusRevenueGrowthPercent !== null) ? ["FMP"] : []),
      ...(alpha && (alpha.quote || alpha.targetConsensus || alpha.forwardPe) ? ["Alpha Vantage"] : []),
      ...(polygon?.quote ? ["Polygon"] : []),
      ...(marketaux?.articles.length ? ["Marketaux"] : []),
    ]);
    const sourceAgreement = agreementScore(prices);
    const dataQuality = {
      marketAgeDays: ageDays(snapshot.foundation.market.priceObservedAt),
      financialPeriodAgeDays: periodEnd ? ageDays(`${periodEnd}T00:00:00.000Z`) : null,
      filingAgeDays: ageDays(`${snapshot.metadata.latestFilingDate}T00:00:00.000Z`),
      independentPriceSources: priceValues.length,
      independentFundamentalSources: 1,
      independentExpectationSources: expectationSources.length,
      contradictionCount: contradictions.length,
      staleFields: [
        ...(periodEnd && (ageDays(`${periodEnd}T00:00:00.000Z`) ?? 9999) > 550 ? ["financialPeriod"] : []),
        ...((ageDays(snapshot.foundation.market.priceObservedAt) ?? 9999) > 10 ? ["marketPrice"] : []),
      ],
      providerErrors: unique(errors),
      sourceAgreementPercent: priceSpread,
    };
    const eventReceipts = 1 + (marketaux?.articles.length ? 1 : 0);
    const nextFoundation: CompanyFoundationInput = {
      ...snapshot.foundation,
      valuation: {
        ...snapshot.foundation.valuation,
        marketCap: fmp?.marketCap ?? snapshot.foundation.valuation.marketCap,
        forwardPriceToEarnings: fmp?.forwardPe ?? alpha?.forwardPe ?? snapshot.foundation.valuation.forwardPriceToEarnings,
      },
      market: {
        ...snapshot.foundation.market,
        secondSourcePrice: priceValues[1]?.value ?? null,
        secondSourceObservedAt: priceValues[1]?.observedAt ?? null,
        priceSourceCount: priceValues.length,
        priceAgreementPercent: priceSpread,
      },
      expectations,
      receipts: [...snapshot.foundation.receipts, ...providerReceipts],
      warnings: unique([
        ...snapshot.foundation.warnings,
        ...(usableProviders.length ? [`Live Railway enrichment used: ${usableProviders.join(", ")}.`] : ["No optional Railway estimates/news provider returned usable data; the signal remains gated."]),
        ...errors.map((error) => `Optional provider issue: ${error}`),
      ]),
      dataQuality,
      contradictions,
      raw: {
        ...(snapshot.foundation.raw ?? {}),
        providerEnrichment: {
          providersAttempted: attempted,
          providersUsed: usableProviders,
          expectationSources,
          priceSources: priceValues.map((value) => value.provider),
          marketauxArticles: marketaux?.articles ?? [],
          marketauxSentiment: marketaux?.sentiment ?? null,
          noSyntheticData: true,
        },
      },
    };
    enriched.push({
      ...snapshot,
      foundation: nextFoundation,
      event: {
        ...snapshot.event,
        payload: {
          ...snapshot.event.payload,
          independentReceipts: eventReceipts,
          independentNewsReceipts: marketaux?.articles.length ?? 0,
          providerEnrichmentUsed: usableProviders,
          noSyntheticData: true,
        },
      },
      metadata: {
        ...snapshot.metadata,
        realDataReceipts: nextFoundation.receipts.length,
      },
    });
    providerSummary.push({
      ticker,
      providersAttempted: attempted,
      providersUsed: usableProviders,
      providerErrors: unique(errors),
      expectationSources,
      priceSources: priceValues.map((value) => value.provider),
      contradictions,
    });
    await sleep(250);
  }
  return { snapshots: enriched, providerSummary };
}
