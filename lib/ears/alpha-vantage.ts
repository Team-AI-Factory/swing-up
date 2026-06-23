import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { trySaveRawDataToR2 } from "@/lib/r2-warehouse";
import { writeRawSignal, type WriteRawSignalResult } from "@/lib/raw-signal-writer";
import { catalystImpactScores } from "@/lib/catalyst-impact-scoring";

export const ALPHA_VANTAGE_SOURCE = "Alpha Vantage Catalyst";
export const DEFAULT_ALPHA_VANTAGE_TICKERS = ["NVDA", "AAPL", "MSFT", "TSLA", "AMZN", "META", "GOOGL", "AMD", "SHOP", "PLTR"] as const;

const ALPHA_VANTAGE_BASE_URL = "https://www.alphavantage.co/query";
const DEFAULT_LIMIT = 1;
const MAX_LIMIT = 3;
const MIN_CALL_SPACING_MS = 1_200;
const MAX_ENDPOINT_CALLS_PER_RUN = 2;

type AlphaVantageRunOptions = { dryRun?: boolean; limit?: number; tickers?: string[] };
type AlphaVantageEventType = "stock_news" | "management_commentary" | "earnings_transcript" | "analyst_estimate" | "quote_movement" | "price_volume_confirmation" | "company_overview_change" | "light_fundamentals";
type AlphaVantageJson = Record<string, unknown>;

type AlphaVantageCandidate = {
  ticker: string;
  eventType: AlphaVantageEventType;
  title: string;
  summary: string;
  url: string;
  detectedAt: string;
  duplicateKey: string;
  importanceHint: "low" | "medium" | "high";
  payload: Prisma.InputJsonObject;
};

export type AlphaVantageRunResult = {
  ok: boolean;
  source: typeof ALPHA_VANTAGE_SOURCE;
  dryRun: boolean;
  apiKeyConfigured: boolean;
  status?: "missing_key" | "complete" | "error" | "degraded_rate_limited";
  rateLimited?: boolean;
  endpointCallsAttempted?: number;
  tickersChecked: number;
  recordsChecked: number;
  rawSignalsCreated: number;
  duplicatesSkipped: number;
  rejected: number;
  errors: string[];
  sourceHealthStatus: string;
};

function getApiKey() {
  return process.env.ALPHA_VANTAGE_API_KEY?.trim() || "";
}

export function capAlphaVantageLimit(limit?: number) {
  if (!Number.isFinite(limit) || !limit || limit < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

function requestedTickers(tickers?: string[], limit?: number) {
  const cleaned = (tickers?.length ? tickers : [...DEFAULT_ALPHA_VANTAGE_TICKERS])
    .map((ticker) => ticker.trim().toUpperCase())
    .filter((ticker) => /^[A-Z.]{1,8}$/.test(ticker));
  const unique = [...new Set(cleaned)];
  return (unique.length ? unique : [...DEFAULT_ALPHA_VANTAGE_TICKERS]).slice(0, capAlphaVantageLimit(limit));
}

function safeError(error: unknown) {
  const apiKey = getApiKey();
  const message = error instanceof Error ? error.message : "Alpha Vantage request failed";
  const redacted = apiKey ? message.replaceAll(apiKey, "[redacted]") : message;
  return redacted.split("\n")[0]?.slice(0, 220) || "Alpha Vantage request failed";
}

async function updateAlphaVantageSourceHealth(status: "connected" | "not_configured" | "degraded" | "error", startedAt: number, errorMessage: string | null) {
  if (!process.env.DATABASE_URL) return status;
  const now = new Date();
  await prisma.sourceHealth.upsert({
    where: { source: ALPHA_VANTAGE_SOURCE },
    create: { source: ALPHA_VANTAGE_SOURCE, status, checkedAt: now, lastSuccessAt: status === "connected" || status === "degraded" ? now : null, responseTimeMs: Date.now() - startedAt, errorMessage, usage: "Alpha Vantage live catalyst ear", notes: "Uses ALPHA_VANTAGE_API_KEY for tiny news sentiment plus backup quote/fundamental catalyst samples. Creates raw live_catalyst raw signals only; never final alerts." },
    update: { status, checkedAt: now, lastSuccessAt: status === "connected" || status === "degraded" ? now : undefined, responseTimeMs: Date.now() - startedAt, errorMessage, usage: "Alpha Vantage live catalyst ear", notes: "Uses ALPHA_VANTAGE_API_KEY for tiny news sentiment plus backup quote/fundamental catalyst samples. Creates raw live_catalyst raw signals only; never final alerts." },
  });
  return status;
}

function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function isAlphaRateLimit(error: unknown) { return safeError(error).toLowerCase().includes("standard api rate limit") || safeError(error).toLowerCase().includes("frequency") || safeError(error).toLowerCase().includes("spread out"); }

async function fetchAlphaVantage(functionName: string, ticker: string, apiKey: string) {
  const url = new URL(ALPHA_VANTAGE_BASE_URL);
  url.searchParams.set("function", functionName);
  url.searchParams.set("symbol", ticker);
  url.searchParams.set("apikey", apiKey);
  const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!response.ok) throw new Error(`Alpha Vantage ${functionName} for ${ticker} failed with status ${response.status}`);
  const json = (await response.json()) as AlphaVantageJson;
  const note = typeof json.Note === "string" ? json.Note : typeof json.Information === "string" ? json.Information : null;
  if (note) throw new Error(`Alpha Vantage ${functionName} for ${ticker}: ${note.slice(0, 160)}`);
  if (typeof json["Error Message"] === "string") throw new Error(`Alpha Vantage ${functionName} for ${ticker}: ${json["Error Message"]}`);
  await trySaveRawDataToR2("alpha-vantage", "stocks", ticker, functionName.toLowerCase(), new Date().toISOString().slice(0,10), json, { sourceUrl: url.toString().replace(apiKey, "[redacted]") });
  return json;
}

async function fetchAlphaVantageNews(ticker: string, apiKey: string) {
  const url = new URL(ALPHA_VANTAGE_BASE_URL);
  url.searchParams.set("function", "NEWS_SENTIMENT");
  url.searchParams.set("tickers", ticker);
  url.searchParams.set("limit", "1");
  url.searchParams.set("apikey", apiKey);
  const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!response.ok) throw new Error(`Alpha Vantage NEWS_SENTIMENT for ${ticker} failed with status ${response.status}`);
  const json = (await response.json()) as AlphaVantageJson;
  const note = typeof json.Note === "string" ? json.Note : typeof json.Information === "string" ? json.Information : null;
  if (note) throw new Error(`Alpha Vantage NEWS_SENTIMENT for ${ticker}: ${note.slice(0, 160)}`);
  if (typeof json["Error Message"] === "string") throw new Error(`Alpha Vantage NEWS_SENTIMENT for ${ticker}: ${json["Error Message"]}`);
  await trySaveRawDataToR2("alpha-vantage", "stocks", ticker, "news-sentiment", new Date().toISOString().slice(0,10), json, { sourceUrl: url.toString().replace(apiKey, "[redacted]"), recordCount: Array.isArray(json.feed) ? json.feed.length : 0 });
  return json;
}

function alphaNewsCandidates(ticker: string, response: AlphaVantageJson): AlphaVantageCandidate[] {
  const feed = Array.isArray(response.feed) ? response.feed.slice(0, 1) as AlphaVantageJson[] : [];
  return feed.flatMap((item) => {
    const title = stringValue(item.title);
    const url = stringValue(item.url);
    if (!title || !url) return [];
    const detected = dateValue(stringValue(item.time_published));
    const sentiment = numberValue(item.overall_sentiment_score);
    return [{ ticker, eventType: "stock_news" as const, title, summary: stringValue(item.summary) ?? `${ticker} Alpha Vantage stock-specific news sentiment catalyst.`, url, detectedAt: detected, duplicateKey: `${ALPHA_VANTAGE_SOURCE}|stock_news|${ticker}|${url}`, importanceHint: sentiment !== null && Math.abs(sentiment) >= 0.35 ? "high" as const : "medium" as const, payload: { sourceCategory: "live_catalyst", catalystType: "stock_news", provider: ALPHA_VANTAGE_SOURCE, ticker, headline: title, summary: stringValue(item.summary), publishedAt: detected, url, rawPayloadReference: "NEWS_SENTIMENT", urgency: "medium", likelyMarketImpact: sentiment !== null && Math.abs(sentiment) >= 0.35 ? "high" : "medium", sourceReliability: "medium", proofNeeds: ["company_or_second_news_receipt", "price_reaction_if_material"], sentimentScore: sentiment, relevanceScore: item.relevance_score ?? null, item: item as Prisma.InputJsonObject, noFinalAlerts: true } }];
  });
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace(/[%,$]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function dateValue(value: unknown) {
  const date = typeof value === "number" || typeof value === "string" ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function quoteCandidates(ticker: string, response: AlphaVantageJson): AlphaVantageCandidate[] {
  const quote = (response["Global Quote"] && typeof response["Global Quote"] === "object" ? response["Global Quote"] : response) as AlphaVantageJson;
  const changePercent = numberValue(quote["10. change percent"]);
  const price = numberValue(quote["05. price"]);
  const volume = numberValue(quote["06. volume"]);
  const latestTradingDay = stringValue(quote["07. latest trading day"]);
  const detected = dateValue(latestTradingDay);
  const day = detected.slice(0, 10);
  const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${ticker}`;
  const payloadBase = { provider: ALPHA_VANTAGE_SOURCE, endpoint: "GLOBAL_QUOTE", quote: quote as Prisma.InputJsonObject, noFinalAlerts: true };
  const candidates: AlphaVantageCandidate[] = [];

  if (changePercent !== null && Math.abs(changePercent) >= 2) {
    candidates.push({ ticker, eventType: "quote_movement", title: `${ticker} notable Alpha Vantage quote move`, summary: `${ticker} moved ${changePercent.toFixed(2)}% in the latest Alpha Vantage quote sample${price === null ? "." : ` with price near $${price}.`} This is raw backup market evidence only.`, url, detectedAt: detected, duplicateKey: `${ALPHA_VANTAGE_SOURCE}|quote_movement|${ticker}|${day}`, importanceHint: Math.abs(changePercent) >= 5 ? "high" : "medium", payload: { ...payloadBase, changePercent } });
  }

  if (price !== null && volume !== null && volume >= 10_000_000) {
    candidates.push({ ticker, eventType: "price_volume_confirmation", title: `${ticker} Alpha Vantage price/volume confirmation`, summary: `${ticker} latest Alpha Vantage sample confirms price near $${price} with volume near ${Math.round(volume).toLocaleString()}. This is raw price/volume context only.`, url, detectedAt: detected, duplicateKey: `${ALPHA_VANTAGE_SOURCE}|price_volume_confirmation|${ticker}|${day}`, importanceHint: volume >= 50_000_000 ? "high" : "medium", payload: { ...payloadBase, price, volume } });
  }

  return candidates;
}

async function writeCandidate(candidate: AlphaVantageCandidate, dryRun: boolean): Promise<WriteRawSignalResult> {
  const scoring = catalystImpactScores({ ticker: candidate.ticker, title: candidate.title, summary: candidate.summary, url: candidate.url, publishedAt: candidate.detectedAt, sourceReliability: "medium", catalystType: String(candidate.payload.catalystType ?? candidate.eventType), proofTypes: candidate.eventType.includes("quote") ? ["price_volume"] : ["news"] });
  return writeRawSignal({ sourceName: ALPHA_VANTAGE_SOURCE, sourceType: "news", ticker: candidate.ticker, eventType: candidate.eventType, title: candidate.title, summary: candidate.summary, url: candidate.url, detectedAt: candidate.detectedAt, duplicateKey: candidate.duplicateKey, qualityHints: { importanceHint: candidate.importanceHint, sourceQuality: "medium", useful: true, reasons: ["Alpha Vantage live_catalyst provider data sample", `impact:${scoring.likelyMarketImpact}`, `specificity:${scoring.stockSpecificityScore}`] }, rawPayload: { ...candidate.payload, catalystImpact: scoring }, dryRun });
}

export async function runAlphaVantageIngestion(options: AlphaVantageRunOptions = {}): Promise<AlphaVantageRunResult> {
  const startedAt = Date.now();
  const dryRun = options.dryRun !== false;
  const apiKey = getApiKey();
  const errors: string[] = [];
  const tickers = requestedTickers(options.tickers, options.limit).slice(0, 1);
  let endpointCallsAttempted = 0;
  let rateLimited = false;
  let recordsChecked = 0;
  let rawSignalsCreated = 0;
  let duplicatesSkipped = 0;
  let rejected = 0;

  if (!apiKey) {
    const sourceHealthStatus = await updateAlphaVantageSourceHealth("not_configured", startedAt, "ALPHA_VANTAGE_API_KEY is not configured.").catch(() => "not_configured");
    return { ok: true, source: ALPHA_VANTAGE_SOURCE, dryRun, apiKeyConfigured: false, status: "missing_key", rateLimited: false, endpointCallsAttempted, tickersChecked: 0, recordsChecked, rawSignalsCreated, duplicatesSkipped, rejected, errors, sourceHealthStatus };
  }

  for (const ticker of tickers) {
    const candidates: Array<AlphaVantageCandidate | null> = [];
    try {
      endpointCallsAttempted += 1;
      const news = await fetchAlphaVantageNews(ticker, apiKey);
      recordsChecked += Array.isArray(news.feed) ? news.feed.length : 0;
      candidates.push(...alphaNewsCandidates(ticker, news));
    } catch (error) {
      errors.push(safeError(error));
      if (isAlphaRateLimit(error)) { rateLimited = true; break; }
    }

    if (!rateLimited && endpointCallsAttempted < MAX_ENDPOINT_CALLS_PER_RUN) {
      await sleep(MIN_CALL_SPACING_MS);
      try {
        endpointCallsAttempted += 1;
        const quote = await fetchAlphaVantage("GLOBAL_QUOTE", ticker, apiKey);
        recordsChecked += 1;
        candidates.push(...quoteCandidates(ticker, quote));
      } catch (error) {
        errors.push(safeError(error));
        if (isAlphaRateLimit(error)) rateLimited = true;
      }
    }

    for (const candidate of candidates.filter((item): item is AlphaVantageCandidate => Boolean(item)).slice(0, 4)) {
      const result = await writeCandidate(candidate, dryRun);
      if (result.status === "saved") rawSignalsCreated += 1;
      else if (result.status === "skipped" && result.reason === "duplicate") duplicatesSkipped += 1;
      else if (result.status === "rejected") rejected += 1;
    }
    if (rateLimited) break;
  }

  const health = rateLimited ? "degraded" : errors.length ? (recordsChecked ? "degraded" : "error") : "connected";
  const sourceHealthStatus = await updateAlphaVantageSourceHealth(health, startedAt, errors[0] ?? null).catch(() => health);
  return { ok: recordsChecked > 0 || errors.length === 0 || rateLimited, source: ALPHA_VANTAGE_SOURCE, dryRun, apiKeyConfigured: true, status: rateLimited ? "degraded_rate_limited" : errors.length ? "error" : "complete", rateLimited, endpointCallsAttempted, tickersChecked: tickers.length, recordsChecked, rawSignalsCreated, duplicatesSkipped, rejected, errors: [...new Set(errors)].slice(0, 10), sourceHealthStatus: rateLimited ? "degraded_rate_limited" : sourceHealthStatus };
}
