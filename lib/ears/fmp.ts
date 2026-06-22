import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { writeRawSignal, type WriteRawSignalResult } from "@/lib/raw-signal-writer";

export const FMP_SOURCE = "FMP Catalyst";
export const DEFAULT_FMP_TICKERS = ["NVDA", "AAPL", "MSFT", "TSLA", "AMZN", "META", "GOOGL", "AMD", "SHOP", "PLTR"] as const;

const FMP_BASE_URL = "https://financialmodelingprep.com/api/v3";
const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 3;

type FmpRunOptions = { dryRun?: boolean; limit?: number; tickers?: string[] };
type FmpEventType = "press_release" | "stock_news" | "earnings_transcript" | "earnings_event" | "guidance_update" | "analyst_estimate" | "price_target" | "management_commentary";
type FmpCandidate = {
  ticker: string;
  eventType: FmpEventType;
  title: string;
  summary: string;
  url: string;
  detectedAt: string;
  duplicateKey: string;
  importanceHint: "low" | "medium" | "high";
  payload: Prisma.InputJsonObject;
};

export type FmpRunResult = {
  ok: boolean;
  source: typeof FMP_SOURCE;
  dryRun: boolean;
  apiKeyConfigured: boolean;
  status?: "missing_key" | "complete" | "error";
  recordsChecked: number;
  rawSignalsCreated: number;
  duplicatesSkipped: number;
  rejected: number;
  errors: string[];
  sourceHealthStatus: string;
};

function getApiKey() {
  return process.env.FMP_API_KEY?.trim() || "";
}

export function capFmpLimit(limit?: number) {
  if (!Number.isFinite(limit) || !limit || limit < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

function requestedTickers(tickers?: string[], limit?: number) {
  const cleaned = (tickers?.length ? tickers : [...DEFAULT_FMP_TICKERS])
    .map((ticker) => ticker.trim().toUpperCase())
    .filter((ticker) => /^[A-Z.]{1,8}$/.test(ticker));
  const unique = [...new Set(cleaned)];
  return (unique.length ? unique : [...DEFAULT_FMP_TICKERS]).slice(0, capFmpLimit(limit));
}

function safeError(error: unknown) {
  if (error instanceof Error) return error.message.split("\n")[0]?.slice(0, 220) || "FMP request failed";
  return "FMP request failed";
}

async function updateFmpSourceHealth(status: "connected" | "not_configured" | "degraded" | "error", startedAt: number, errorMessage: string | null) {
  if (!process.env.DATABASE_URL) return status;
  const now = new Date();
  await prisma.sourceHealth.upsert({
    where: { source: FMP_SOURCE },
    create: { source: FMP_SOURCE, status, checkedAt: now, lastSuccessAt: status === "connected" || status === "degraded" ? now : null, responseTimeMs: Date.now() - startedAt, errorMessage, usage: "Financial Modeling Prep live catalyst ear", notes: "Uses FMP_API_KEY for tiny batches of press releases, stock news, earnings events, transcripts, and analyst/target data. Creates raw live_catalyst raw signals only; never final alerts." },
    update: { status, checkedAt: now, lastSuccessAt: status === "connected" || status === "degraded" ? now : undefined, responseTimeMs: Date.now() - startedAt, errorMessage, usage: "Financial Modeling Prep live catalyst ear", notes: "Uses FMP_API_KEY for tiny batches of press releases, stock news, earnings events, transcripts, and analyst/target data. Creates raw live_catalyst raw signals only; never final alerts." },
  });
  return status;
}

async function fetchFmp<T>(path: string, apiKey: string, params: Record<string, string> = {}) {
  const url = new URL(`${FMP_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("apikey", apiKey);
  const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!response.ok) throw new Error(`FMP ${path} failed with status ${response.status}`);
  const json = (await response.json()) as unknown;
  if (json && typeof json === "object" && !Array.isArray(json) && typeof (json as Record<string, unknown>).Error === "string") throw new Error(`FMP ${path}: ${(json as Record<string, string>).Error.slice(0, 160)}`);
  return json as T;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dateValue(value: unknown) {
  const date = typeof value === "number" || typeof value === "string" ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function priceCandidate(ticker: string, row: Record<string, unknown>): FmpCandidate | null {
  const changesPercentage = numberValue(row.changesPercentage);
  const price = numberValue(row.price);
  if (changesPercentage === null || Math.abs(changesPercentage) < 2) return null;
  const detectedAt = dateValue(row.timestamp ? Number(row.timestamp) * 1000 : undefined);
  return {
    ticker,
    eventType: "management_commentary",
    title: `${ticker} notable FMP price move`,
    summary: `${ticker} moved ${changesPercentage.toFixed(2)}% in the latest FMP quote sample${price === null ? "." : ` with price near $${price}.`} This is raw market evidence only.`,
    url: `https://financialmodelingprep.com/financial-summary/${ticker}`,
    detectedAt,
    duplicateKey: `${FMP_SOURCE}|price_movement|${ticker}|${detectedAt.slice(0, 13)}`,
    importanceHint: Math.abs(changesPercentage) >= 5 ? "high" : "medium",
    payload: { provider: FMP_SOURCE, endpoint: "quote", row: row as Prisma.InputJsonObject, noFinalAlerts: true },
  };
}

function fundamentalsCandidate(ticker: string, rows: Record<string, unknown>[]): FmpCandidate | null {
  const latest = rows[0];
  if (!latest) return null;
  const revenue = numberValue(latest.revenue);
  const netIncome = numberValue(latest.netIncome);
  const date = dateValue(latest.date);
  if (revenue === null && netIncome === null) return null;
  return { ticker, eventType: "guidance_update", title: `${ticker} latest FMP fundamentals snapshot`, summary: `${ticker} latest FMP income statement sample shows revenue ${revenue ?? "unknown"} and net income ${netIncome ?? "unknown"}. This captures fundamentals context only.`, url: `https://financialmodelingprep.com/financial-summary/${ticker}`, detectedAt: date, duplicateKey: `${FMP_SOURCE}|fundamentals_change|${ticker}|${date.slice(0, 10)}`, importanceHint: "medium", payload: { provider: FMP_SOURCE, endpoint: "income-statement", latest: latest as Prisma.InputJsonObject, noFinalAlerts: true } };
}

function earningsCandidate(ticker: string, rows: Record<string, unknown>[]): FmpCandidate | null {
  const row = rows.find((item) => item.symbol === ticker) ?? rows[0];
  if (!row) return null;
  const date = dateValue(row.date);
  return { ticker, eventType: "earnings_event", title: `${ticker} FMP earnings calendar signal`, summary: `${ticker} has an earnings calendar item in the FMP sample dated ${date.slice(0, 10)}. This is raw scheduling evidence only.`, url: `https://financialmodelingprep.com/financial-summary/${ticker}`, detectedAt: date, duplicateKey: `${FMP_SOURCE}|earnings_event|${ticker}|${date.slice(0, 10)}`, importanceHint: "medium", payload: { provider: FMP_SOURCE, endpoint: "earning_calendar", row: row as Prisma.InputJsonObject, noFinalAlerts: true } };
}

function analystCandidate(ticker: string, row: Record<string, unknown>): FmpCandidate | null {
  const target = numberValue(row.targetConsensus ?? row.targetMean ?? row.priceTargetAverage);
  if (target === null) return null;
  const detectedAt = new Date().toISOString();
  return { ticker, eventType: "price_target", title: `${ticker} FMP analyst target snapshot`, summary: `${ticker} FMP analyst target sample shows a consensus/average target near $${target}. This is raw analyst-target context only.`, url: `https://financialmodelingprep.com/financial-summary/${ticker}`, detectedAt, duplicateKey: `${FMP_SOURCE}|analyst_target_change|${ticker}|${detectedAt.slice(0, 10)}`, importanceHint: "low", payload: { provider: FMP_SOURCE, endpoint: "price-target-consensus", row: row as Prisma.InputJsonObject, noFinalAlerts: true } };
}

function transcriptCandidate(ticker: string, rows: Record<string, unknown>[]): FmpCandidate | null {
  const row = rows[0];
  if (!row) return null;
  const date = dateValue(row.date);
  return { ticker, eventType: "earnings_transcript", title: `${ticker} FMP transcript availability signal`, summary: `${ticker} has transcript-related data available in the FMP sample for ${date.slice(0, 10)}. This flags evidence availability only.`, url: `https://financialmodelingprep.com/financial-summary/${ticker}`, detectedAt: date, duplicateKey: `${FMP_SOURCE}|transcript_signal|${ticker}|${date.slice(0, 10)}`, importanceHint: "low", payload: { provider: FMP_SOURCE, endpoint: "earning_call_transcript", row: row as Prisma.InputJsonObject, noFinalAlerts: true } };
}


function stringValue(value: unknown, maxLength = 500) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : null;
}

function urlForFmp(ticker: string, row: Record<string, unknown>) {
  return stringValue(row.url ?? row.link, 1000) ?? `https://financialmodelingprep.com/financial-summary/${ticker}`;
}

function pressReleaseCandidate(ticker: string, rows: Record<string, unknown>[]): FmpCandidate | null {
  const row = rows[0];
  if (!row) return null;
  const title = stringValue(row.title ?? row.headline, 220);
  const url = urlForFmp(ticker, row);
  if (!title || !url) return null;
  const detectedAt = dateValue(row.date ?? row.publishedDate);
  return { ticker, eventType: "press_release", title, summary: stringValue(row.text ?? row.summary, 900) ?? `${ticker} FMP press release catalyst with a real provider receipt.`, url, detectedAt, duplicateKey: `${FMP_SOURCE}|press_release|${ticker}|${url}`, importanceHint: "high", payload: { sourceCategory: "live_catalyst", catalystType: "press_release", provider: FMP_SOURCE, ticker, companyName: stringValue(row.symbol) ?? ticker, headline: title, publishedAt: detectedAt, url, rawPayloadReference: "press-releases", urgency: "medium", likelyMarketImpact: "medium", sourceReliability: "high", proofNeeds: ["independent_news_coverage", "price_reaction_or_filing_if_material"], row: row as Prisma.InputJsonObject, noFinalAlerts: true } };
}

function stockNewsCandidate(ticker: string, rows: Record<string, unknown>[]): FmpCandidate | null {
  const row = rows[0];
  if (!row) return null;
  const title = stringValue(row.title ?? row.headline, 220);
  const url = urlForFmp(ticker, row);
  if (!title || !url) return null;
  const detectedAt = dateValue(row.publishedDate ?? row.date);
  return { ticker, eventType: "stock_news", title, summary: stringValue(row.text ?? row.summary ?? row.site, 900) ?? `${ticker} FMP stock-specific news catalyst with a real provider receipt.`, url, detectedAt, duplicateKey: `${FMP_SOURCE}|stock_news|${ticker}|${url}`, importanceHint: "medium", payload: { sourceCategory: "live_catalyst", catalystType: "stock_news", provider: FMP_SOURCE, ticker, companyName: stringValue(row.symbol) ?? ticker, headline: title, publishedAt: detectedAt, url, rawPayloadReference: "stock_news", urgency: "medium", likelyMarketImpact: "medium", sourceReliability: "high", proofNeeds: ["second_source", "company_or_filing_receipt_if_material"], row: row as Prisma.InputJsonObject, noFinalAlerts: true } };
}

async function writeCandidate(candidate: FmpCandidate, dryRun: boolean): Promise<WriteRawSignalResult> {
  return writeRawSignal({ sourceName: FMP_SOURCE, sourceType: "news", ticker: candidate.ticker, eventType: candidate.eventType, title: candidate.title, summary: candidate.summary, url: candidate.url, detectedAt: candidate.detectedAt, duplicateKey: candidate.duplicateKey, qualityHints: { importanceHint: candidate.importanceHint, sourceQuality: "high", useful: true, reasons: ["FMP live_catalyst provider data sample"] }, rawPayload: candidate.payload, dryRun });
}

export async function runFmpIngestion(options: FmpRunOptions = {}): Promise<FmpRunResult> {
  const startedAt = Date.now();
  const dryRun = options.dryRun !== false;
  const apiKey = getApiKey();
  const errors: string[] = [];
  let recordsChecked = 0;
  let rawSignalsCreated = 0;
  let duplicatesSkipped = 0;
  let rejected = 0;

  if (!apiKey) {
    const sourceHealthStatus = await updateFmpSourceHealth("not_configured", startedAt, "FMP_API_KEY is not configured.").catch(() => "not_configured");
    return { ok: true, source: FMP_SOURCE, dryRun, apiKeyConfigured: false, status: "missing_key", recordsChecked, rawSignalsCreated, duplicatesSkipped, rejected, errors, sourceHealthStatus };
  }

  try {
    const tickers = requestedTickers(options.tickers, options.limit);
    for (const ticker of tickers) {
      const [pressReleases, stockNews, quote, fundamentals, earnings, analyst, transcripts] = await Promise.allSettled([
        fetchFmp<Record<string, unknown>[]>(`/press-releases/${ticker}`, apiKey, { limit: "1" }),
        fetchFmp<Record<string, unknown>[]>("/stock_news", apiKey, { tickers: ticker, limit: "1" }),
        fetchFmp<Record<string, unknown>[]>(`/quote/${ticker}`, apiKey),
        fetchFmp<Record<string, unknown>[]>(`/income-statement/${ticker}`, apiKey, { limit: "1" }),
        fetchFmp<Record<string, unknown>[]>("/earning_calendar", apiKey, { symbol: ticker, limit: "1" }),
        fetchFmp<Record<string, unknown>[]>(`/price-target-consensus/${ticker}`, apiKey),
        fetchFmp<Record<string, unknown>[]>(`/earning_call_transcript/${ticker}`, apiKey, { limit: "1" }),
      ]);

      const candidates: Array<FmpCandidate | null> = [];
      if (pressReleases.status === "fulfilled") { recordsChecked += pressReleases.value.length; candidates.push(pressReleaseCandidate(ticker, pressReleases.value)); } else errors.push(safeError(pressReleases.reason));
      if (stockNews.status === "fulfilled") { recordsChecked += stockNews.value.length; candidates.push(stockNewsCandidate(ticker, stockNews.value)); } else errors.push(safeError(stockNews.reason));
      if (quote.status === "fulfilled") { recordsChecked += quote.value.length; candidates.push(priceCandidate(ticker, quote.value[0] ?? {})); } else errors.push(safeError(quote.reason));
      if (fundamentals.status === "fulfilled") { recordsChecked += fundamentals.value.length; candidates.push(fundamentalsCandidate(ticker, fundamentals.value)); } else errors.push(safeError(fundamentals.reason));
      if (earnings.status === "fulfilled") { recordsChecked += earnings.value.length; candidates.push(earningsCandidate(ticker, earnings.value)); } else errors.push(safeError(earnings.reason));
      if (analyst.status === "fulfilled") { recordsChecked += analyst.value.length; candidates.push(analystCandidate(ticker, analyst.value[0] ?? {})); } else errors.push(safeError(analyst.reason));
      if (transcripts.status === "fulfilled") { recordsChecked += transcripts.value.length; candidates.push(transcriptCandidate(ticker, transcripts.value)); } else errors.push(safeError(transcripts.reason));

      for (const candidate of candidates.filter((item): item is FmpCandidate => Boolean(item)).slice(0, 5)) {
        const result = await writeCandidate(candidate, dryRun);
        if (result.status === "saved") rawSignalsCreated += 1;
        else if (result.status === "skipped" && result.reason === "duplicate") duplicatesSkipped += 1;
        else if (result.status === "rejected") rejected += 1;
      }
    }
  } catch (error) {
    errors.push(safeError(error));
  }

  const sourceHealthStatus = await updateFmpSourceHealth(errors.length ? (recordsChecked ? "degraded" : "error") : "connected", startedAt, errors[0] ?? null).catch(() => errors.length ? "error" : "connected");
  return { ok: recordsChecked > 0 || errors.length === 0, source: FMP_SOURCE, dryRun, apiKeyConfigured: true, status: errors.length ? "error" : "complete", recordsChecked, rawSignalsCreated, duplicatesSkipped, rejected, errors: [...new Set(errors)].slice(0, 10), sourceHealthStatus };
}
