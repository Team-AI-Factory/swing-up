import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { trySaveRawDataToR2 } from "@/lib/r2-warehouse";
import { writeRawSignal, type WriteRawSignalResult } from "@/lib/raw-signal-writer";
import { catalystImpactScores } from "@/lib/catalyst-impact-scoring";
import { classifyGenericNews } from "@/lib/generic-news-triage";

export const MARKETAUX_SOURCE = "Marketaux Catalyst";

const MARKETAUX_NEWS_URL = "https://api.marketaux.com/v1/news/all";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_QUERIES_PER_RUN = 10;
const MAX_ARTICLES_PER_QUERY = 3;

const WATCHLIST = { NVDA: "Nvidia", AAPL: "Apple", MSFT: "Microsoft", TSLA: "Tesla", AMZN: "Amazon", META: "Meta", GOOGL: "Alphabet", AMD: "AMD", SHOP: "Shopify", PLTR: "Palantir" } as const;
const SAFE_QUERIES = Object.entries(WATCHLIST).map(([symbol, company]) => ({ label: `${symbol} ${company}`, symbols: symbol, company, countries: "us" }));

type MarketauxEntity = {
  symbol?: string | null;
  name?: string | null;
  type?: string | null;
  exchange?: string | null;
  exchange_long?: string | null;
  country?: string | null;
  sentiment_score?: number | null;
  highlights?: Array<{ highlight?: string | null; sentiment?: number | null; highlighted_in?: string | null }> | null;
};

type MarketauxArticle = {
  uuid?: string | null;
  title?: string | null;
  description?: string | null;
  snippet?: string | null;
  url?: string | null;
  image_url?: string | null;
  language?: string | null;
  published_at?: string | null;
  source?: string | null;
  relevance_score?: number | null;
  entities?: MarketauxEntity[] | null;
};

type MarketauxResponse = { data?: MarketauxArticle[]; meta?: Record<string, unknown> };

type MarketauxRunOptions = { dryRun?: boolean };

type MarketauxCandidate = {
  article: MarketauxArticle;
  entity: MarketauxEntity | null;
  eventType: string;
  ticker: string | null;
  company: string | null;
  sentiment: number | null;
  importanceHint: "low" | "medium" | "high";
  reasons: string[];
  duplicateKey: string;
  acceptedReason: string;
  rejectedReason?: string;
};

export type MarketauxRunResult = {
  ok: boolean;
  source: typeof MARKETAUX_SOURCE;
  dryRun: boolean;
  apiKeyConfigured: boolean;
  status?: "missing_key" | "complete" | "error";
  queriesChecked: number;
  articlesChecked: number;
  rawSignalsCreated: number;
  duplicatesSkipped: number;
  rejected: number;
  errors: string[];
  sourceHealthStatus: string;
  acceptedReasons: string[];
  rejectedReasons: string[];
};

function getApiKey() {
  return process.env.MARKETAUX_API_KEY?.trim() || "";
}

function safeError(error: unknown) {
  if (error instanceof Error) return error.message.split("\n")[0]?.slice(0, 220) || "Marketaux request failed";
  return "Marketaux request failed";
}

function text(value?: string | null, maxLength = 240) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function detectedAt(article: MarketauxArticle) {
  const date = article.published_at ? new Date(article.published_at) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function classifyArticle(article: MarketauxArticle): { candidate: MarketauxCandidate | null; reason: string } {
  const title = text(article.title);
  const url = text(article.url, 1000);
  const blob = `${article.title ?? ""} ${article.description ?? ""} ${article.snippet ?? ""}`.toLowerCase();
  const weakBroad = ["weekly market review", "portfolio holdings", "portfolio", "broad bank", "broad market", "market recap"].find((needle) => blob.includes(needle));
  const entities = (article.entities ?? []).filter(Boolean);
  const watchSymbols = new Set(Object.keys(WATCHLIST));
  const entity = entities.find((item) => watchSymbols.has((text(item?.symbol, 32) ?? "").toUpperCase())) ?? null;
  const sentiment = numberValue(entity?.sentiment_score);
  const ticker = text(entity?.symbol, 32)?.toUpperCase() ?? null;
  const company = text(entity?.name, 240) ?? (ticker ? WATCHLIST[ticker as keyof typeof WATCHLIST] : null);
  const relevance = numberValue(article.relevance_score);
  const published = detectedAt(article);
  const fresh = Date.now() - new Date(published).getTime() <= 72 * 60 * 60 * 1000;
  const directCompanyMention = Boolean(ticker && (blob.includes(ticker.toLowerCase()) || blob.includes(String(company).toLowerCase())));
  if (!title) return { candidate: null, reason: "rejected: missing_title" };
  if (!url) return { candidate: null, reason: `rejected ${title}: missing_url` };
  if (weakBroad && !directCompanyMention) return { candidate: null, reason: `rejected ${title}: weak_broad_topic:${weakBroad}` };
  if (!entity || !ticker || !directCompanyMention) {
    const generic = classifyGenericNews({ id: "", source: MARKETAUX_SOURCE, ticker: null, title, summary: text(article.description ?? article.snippet, 1000) ?? "", sourceUrl: url, receivedAt: new Date(published), payload: { article } });
    if (generic.rippleCandidate) {
      const reasons = ["accepted:generic_ripple_candidate", generic.genericNewsType, "no_direct_ticker_promotion", ...generic.affectedSectors.map((sector) => `sector:${sector}`), ...generic.affectedTickers.slice(0, 6).map((mappedTicker) => `affectedTicker:${mappedTicker}`)];
      const id = text(article.uuid, 120) ?? url ?? title;
      return { candidate: { article, entity: null, eventType: "generic_ripple_candidate", ticker: null, company: null, sentiment: null, importanceHint: "high", reasons, acceptedReason: reasons.join(" | "), duplicateKey: `${MARKETAUX_SOURCE}|generic_ripple_candidate|${generic.genericNewsType}|${id}` }, reason: `accepted generic_ripple_candidate: ${generic.genericNewsType} | affectedTickers:${generic.affectedTickers.join(",")}` };
    }
    return { candidate: null, reason: `rejected ${title}: no_direct_watchlist_ticker_entity` };
  }

  const reasons = ["accepted:direct_watchlist_entity", "url_present", fresh ? "fresh_within_72h" : "stale_over_72h", article.source ? "source_present" : "source_missing", sentiment !== null ? "sentiment_metadata" : "sentiment_missing", relevance !== null ? "relevance_metadata" : "relevance_missing"];
  const eventType = sentiment !== null && Math.abs(sentiment) >= 0.35 ? "marketaux_sentiment_news" : "marketaux_entity_news";
  const importanceHint = sentiment !== null && Math.abs(sentiment) >= 0.5 ? "high" : relevance !== null && relevance >= 0.7 && fresh ? "medium" : "low";
  const id = text(article.uuid, 120) ?? url ?? title;
  return { candidate: { article, entity, eventType, ticker, company, sentiment, importanceHint, reasons, acceptedReason: reasons.join(" | "), duplicateKey: `${MARKETAUX_SOURCE}|${eventType}|${ticker}|${id}` }, reason: `accepted ${ticker}: ${reasons.join(" | ")}` };
}

async function fetchMarketauxQuery(query: (typeof SAFE_QUERIES)[number], apiKey: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const url = new URL(MARKETAUX_NEWS_URL);
  url.searchParams.set("api_token", apiKey);
  url.searchParams.set("symbols", query.symbols);
  url.searchParams.set("countries", query.countries);
  url.searchParams.set("language", "en");
  url.searchParams.set("filter_entities", "true");
  url.searchParams.set("must_have_entities", "true");
  url.searchParams.set("limit", String(MAX_ARTICLES_PER_QUERY));

  try {
    const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" }, signal: controller.signal });
    if (!response.ok) throw new Error(`Marketaux ${query.label} returned ${response.status}`);
    const payload = (await response.json()) as MarketauxResponse;
    await trySaveRawDataToR2("marketaux", "news", query.symbols, "news", new Date().toISOString().slice(0,10), payload, { sourceUrl: url.toString().replace(apiKey, "[redacted]"), recordCount: payload.data?.length ?? 0 });
    return (payload.data ?? []).slice(0, MAX_ARTICLES_PER_QUERY);
  } finally {
    clearTimeout(timeout);
  }
}

async function updateMarketauxSourceHealth(status: "connected" | "not_configured" | "degraded" | "error", startedAt: number, errorMessage: string | null) {
  if (!process.env.DATABASE_URL) return status;
  const now = new Date();
  await prisma.sourceHealth.upsert({
    where: { source: MARKETAUX_SOURCE },
    create: { source: MARKETAUX_SOURCE, status, checkedAt: now, lastSuccessAt: status === "connected" || status === "degraded" ? now : null, responseTimeMs: Date.now() - startedAt, errorMessage, usage: "Marketaux live catalyst ear", notes: "Uses MARKETAUX_API_KEY for tiny company/stock-specific news batches with entity and sentiment metadata. Creates raw live_catalyst raw signals only; never final alerts." },
    update: { status, checkedAt: now, lastSuccessAt: status === "connected" || status === "degraded" ? now : undefined, responseTimeMs: Date.now() - startedAt, errorMessage, usage: "Marketaux live catalyst ear", notes: "Uses MARKETAUX_API_KEY for tiny company/stock-specific news batches with entity and sentiment metadata. Creates raw live_catalyst raw signals only; never final alerts." },
  });
  return status;
}

async function writeCandidate(candidate: MarketauxCandidate, dryRun: boolean): Promise<WriteRawSignalResult> {
  const scoring = catalystImpactScores({ ticker: candidate.ticker, company: candidate.company, title: candidate.article.title, summary: candidate.article.description ?? candidate.article.snippet, url: candidate.article.url, publishedAt: detectedAt(candidate.article), sourceReliability: "medium", catalystType: candidate.eventType, proofTypes: ["news"], providerMetadata: { symbol: candidate.ticker ?? "" } });
  return writeRawSignal({
    sourceName: MARKETAUX_SOURCE,
    sourceType: "news",
    ticker: candidate.ticker,
    company: candidate.company,
    eventType: candidate.eventType,
    title: text(candidate.article.title) ?? "Marketaux structured market news",
    summary: text(candidate.article.description ?? candidate.article.snippet, 1000) ?? `Marketaux article mentioned ${candidate.company ?? candidate.ticker ?? "a market entity"} with structured entity and sentiment metadata.`,
    url: candidate.article.url,
    detectedAt: detectedAt(candidate.article),
    duplicateKey: candidate.duplicateKey,
    qualityHints: { importanceHint: candidate.importanceHint, confidence: Math.min(Math.max(Math.abs(candidate.sentiment ?? 0.35), 0.25), 0.95), sourceQuality: "medium", useful: true, reasons: [...candidate.reasons, `impact:${scoring.likelyMarketImpact}`, `specificity:${scoring.stockSpecificityScore}`] },
    rawPayload: { sourceCategory: candidate.eventType === "generic_ripple_candidate" ? "generic_ripple_candidate" : "live_catalyst", catalystType: candidate.eventType === "generic_ripple_candidate" ? "generic_ripple_candidate" : candidate.eventType === "marketaux_sentiment_news" ? "stock_news" : "sector_competitor_event", provider: MARKETAUX_SOURCE, ticker: candidate.ticker, companyName: candidate.company, headline: text(candidate.article.title), summary: text(candidate.article.description ?? candidate.article.snippet, 1000), publishedAt: detectedAt(candidate.article), url: candidate.article.url, rawPayloadReference: "news/all", urgency: candidate.importanceHint === "high" ? "high" : "medium", likelyMarketImpact: candidate.importanceHint === "high" ? "high" : "medium", sourceReliability: "medium", proofNeeds: ["company_or_second_news_receipt", "price_reaction_if_material"], article: candidate.article as Prisma.InputJsonObject, entity: candidate.entity as Prisma.InputJsonObject | null, sentimentScore: candidate.sentiment, acceptedReason: candidate.acceptedReason, catalystImpact: scoring, noFinalAlerts: true },
    dryRun,
  });
}

export async function runMarketauxIngestion(options: MarketauxRunOptions = {}): Promise<MarketauxRunResult> {
  const startedAt = Date.now();
  const dryRun = options.dryRun !== false;
  const apiKey = getApiKey();
  const errors: string[] = [];
  let queriesChecked = 0;
  let articlesChecked = 0;
  let rawSignalsCreated = 0;
  let duplicatesSkipped = 0;
  let rejected = 0;
  const acceptedReasons: string[] = [];
  const rejectedReasons: string[] = [];

  if (!apiKey) {
    const sourceHealthStatus = await updateMarketauxSourceHealth("not_configured", startedAt, "MARKETAUX_API_KEY is not configured.").catch(() => "not_configured");
    return { ok: true, source: MARKETAUX_SOURCE, dryRun, apiKeyConfigured: false, status: "missing_key", queriesChecked, articlesChecked, rawSignalsCreated, duplicatesSkipped, rejected, errors, sourceHealthStatus, acceptedReasons, rejectedReasons };
  }

  for (const query of SAFE_QUERIES.slice(0, MAX_QUERIES_PER_RUN)) {
    queriesChecked += 1;
    try {
      const articles = await fetchMarketauxQuery(query, apiKey);
      articlesChecked += articles.length;
      for (const article of articles) {
        const classified = classifyArticle(article);
        if (!classified.candidate) {
          rejected += 1;
          rejectedReasons.push(classified.reason);
          continue;
        }
        acceptedReasons.push(classified.reason);
        const result = await writeCandidate(classified.candidate, dryRun);
        if (result.status === "saved") rawSignalsCreated += 1;
        else if (result.status === "skipped" && result.reason === "duplicate") duplicatesSkipped += 1;
        else if (result.status === "rejected") rejected += 1;
      }
    } catch (error) {
      errors.push(safeError(error));
    }
  }

  const sourceHealthStatus = await updateMarketauxSourceHealth(errors.length === queriesChecked ? "error" : errors.length ? "degraded" : "connected", startedAt, errors[0] ?? null).catch(() => errors.length === queriesChecked ? "error" : errors.length ? "degraded" : "connected");
  return { ok: errors.length < queriesChecked, source: MARKETAUX_SOURCE, dryRun, apiKeyConfigured: true, status: errors.length ? "error" : "complete", queriesChecked, articlesChecked, rawSignalsCreated, duplicatesSkipped, rejected, errors: [...new Set([...errors, ...rejectedReasons])].slice(0, 10), sourceHealthStatus, acceptedReasons: acceptedReasons.slice(0, 20), rejectedReasons: rejectedReasons.slice(0, 20) };
}
