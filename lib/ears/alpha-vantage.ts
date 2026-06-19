import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { writeRawSignal, type WriteRawSignalResult } from "@/lib/raw-signal-writer";

export const ALPHA_VANTAGE_SOURCE = "Alpha Vantage";
export const DEFAULT_ALPHA_VANTAGE_TICKERS = ["AAPL"] as const;

const ALPHA_VANTAGE_BASE_URL = "https://www.alphavantage.co/query";
const DEFAULT_LIMIT = DEFAULT_ALPHA_VANTAGE_TICKERS.length;
const MAX_LIMIT = 2;

type AlphaVantageRunOptions = { dryRun?: boolean; limit?: number; tickers?: string[] };
type AlphaVantageEventType = "quote_movement" | "price_volume_confirmation" | "company_overview_change" | "light_fundamentals";
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

type AlphaVantageQuoteResponse = { "Global Quote"?: Record<string, string>; Information?: string; Note?: string; Error?: string };
type AlphaVantageOverviewResponse = Record<string, string | undefined> & { Information?: string; Note?: string; Error?: string };
type AlphaVantageIncomeStatementResponse = { symbol?: string; quarterlyReports?: Array<Record<string, string>>; Information?: string; Note?: string; Error?: string };

export type AlphaVantageRunResult = {
  ok: boolean;
  source: typeof ALPHA_VANTAGE_SOURCE;
  dryRun: boolean;
  apiKeyConfigured: boolean;
  status?: "missing_key" | "complete" | "error";
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
  if (error instanceof Error) return error.message.split("\n")[0]?.slice(0, 220) || "Alpha Vantage request failed";
  return "Alpha Vantage request failed";
}

async function updateAlphaVantageSourceHealth(status: "connected" | "not_configured" | "degraded" | "error", startedAt: number, errorMessage: string | null) {
  if (!process.env.DATABASE_URL) return status;
  const now = new Date();
  await prisma.sourceHealth.upsert({
    where: { source: ALPHA_VANTAGE_SOURCE },
    create: { source: ALPHA_VANTAGE_SOURCE, status, checkedAt: now, lastSuccessAt: status === "connected" || status === "degraded" ? now : null, responseTimeMs: Date.now() - startedAt, errorMessage, usage: "Alpha Vantage free-mode backup market/fundamental ear", notes: "Uses ALPHA_VANTAGE_API_KEY for tiny samples of global quote, company overview, and income statement data. Creates raw signals only; never final alerts." },
    update: { status, checkedAt: now, lastSuccessAt: status === "connected" || status === "degraded" ? now : undefined, responseTimeMs: Date.now() - startedAt, errorMessage, usage: "Alpha Vantage free-mode backup market/fundamental ear", notes: "Uses ALPHA_VANTAGE_API_KEY for tiny samples of global quote, company overview, and income statement data. Creates raw signals only; never final alerts." },
  });
  return status;
}

async function fetchAlphaVantage<T>(apiKey: string, params: Record<string, string>) {
  const url = new URL(ALPHA_VANTAGE_BASE_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("apikey", apiKey);
  const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!response.ok) throw new Error(`Alpha Vantage ${params.function ?? "query"} failed with status ${response.status}`);
  const json = (await response.json()) as T & { Information?: string; Note?: string; Error?: string };
  if (json.Note || json.Information || json.Error) throw new Error(json.Note || json.Information || json.Error || "Alpha Vantage returned an API message");
  return json as T;
}

function numeric(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/[%,$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function todayIso() {
  return new Date().toISOString();
}

function quoteCandidates(ticker: string, quote: Record<string, string>): AlphaVantageCandidate[] {
  const price = numeric(quote["05. price"]);
  const changePercent = numeric(quote["10. change percent"]);
  const volume = numeric(quote["06. volume"]);
  const tradingDay = quote["07. latest trading day"] || todayIso().slice(0, 10);
  const detectedAt = new Date(`${tradingDay}T21:00:00.000Z`).toISOString();
  const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(ticker)}`;
  const payloadBase = { provider: ALPHA_VANTAGE_SOURCE, endpoint: "GLOBAL_QUOTE", quote: quote as Prisma.InputJsonObject, noFinalAlerts: true };
  const candidates: AlphaVantageCandidate[] = [];

  if (changePercent !== null && Math.abs(changePercent) >= 1.5) {
    candidates.push({ ticker, eventType: "quote_movement", title: `${ticker} Alpha Vantage quote movement`, summary: `${ticker} moved ${changePercent.toFixed(2)}% in the latest Alpha Vantage quote sample${price === null ? "." : ` with price near $${price}.`} This is raw market evidence only.`, url, detectedAt, duplicateKey: `${ALPHA_VANTAGE_SOURCE}|quote_movement|${ticker}|${tradingDay}`, importanceHint: Math.abs(changePercent) >= 4 ? "high" : "medium", payload: { ...payloadBase, changePercent } });
  }

  if (price !== null && volume !== null && volume >= 5_000_000) {
    candidates.push({ ticker, eventType: "price_volume_confirmation", title: `${ticker} Alpha Vantage price and volume confirmation`, summary: `${ticker} latest Alpha Vantage quote sample showed price near $${price} and volume near ${Math.round(volume).toLocaleString()}. This is raw price/volume context only.`, url, detectedAt, duplicateKey: `${ALPHA_VANTAGE_SOURCE}|price_volume_confirmation|${ticker}|${tradingDay}`, importanceHint: volume >= 25_000_000 ? "high" : "medium", payload: { ...payloadBase, price, volume, changePercent } });
  }

  return candidates;
}

function overviewCandidate(ticker: string, overview: AlphaVantageOverviewResponse): AlphaVantageCandidate | null {
  const name = overview.Name || ticker;
  const sector = overview.Sector || "unknown sector";
  const marketCap = numeric(overview.MarketCapitalization);
  if (!overview.Symbol && !overview.Name) return null;
  const day = todayIso().slice(0, 10);
  return { ticker, eventType: "company_overview_change", title: `${ticker} Alpha Vantage company overview snapshot`, summary: `${name} Alpha Vantage overview lists ${sector}${marketCap === null ? "." : ` with market capitalization near ${marketCap}.`} This flags company overview context only.`, url: `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${encodeURIComponent(ticker)}`, detectedAt: todayIso(), duplicateKey: `${ALPHA_VANTAGE_SOURCE}|company_overview_change|${ticker}|${day}`, importanceHint: "low", payload: { provider: ALPHA_VANTAGE_SOURCE, endpoint: "OVERVIEW", overview: overview as Prisma.InputJsonObject, noFinalAlerts: true } };
}

function fundamentalsCandidate(ticker: string, income: AlphaVantageIncomeStatementResponse): AlphaVantageCandidate | null {
  const latest = income.quarterlyReports?.[0];
  if (!latest) return null;
  const fiscalDate = latest.fiscalDateEnding || todayIso().slice(0, 10);
  const revenue = numeric(latest.totalRevenue);
  const netIncome = numeric(latest.netIncome);
  if (revenue === null && netIncome === null) return null;
  return { ticker, eventType: "light_fundamentals", title: `${ticker} Alpha Vantage lightweight fundamentals snapshot`, summary: `${ticker} latest Alpha Vantage quarterly income statement sample shows revenue ${revenue ?? "unknown"} and net income ${netIncome ?? "unknown"}. This captures fundamentals context only.`, url: `https://www.alphavantage.co/query?function=INCOME_STATEMENT&symbol=${encodeURIComponent(ticker)}`, detectedAt: new Date(`${fiscalDate}T00:00:00.000Z`).toISOString(), duplicateKey: `${ALPHA_VANTAGE_SOURCE}|light_fundamentals|${ticker}|${fiscalDate}`, importanceHint: "medium", payload: { provider: ALPHA_VANTAGE_SOURCE, endpoint: "INCOME_STATEMENT", latest: latest as Prisma.InputJsonObject, noFinalAlerts: true } };
}

async function writeCandidate(candidate: AlphaVantageCandidate, dryRun: boolean): Promise<WriteRawSignalResult> {
  return writeRawSignal({ sourceName: ALPHA_VANTAGE_SOURCE, sourceType: "market", ticker: candidate.ticker, eventType: candidate.eventType, title: candidate.title, summary: candidate.summary, url: candidate.url, detectedAt: candidate.detectedAt, duplicateKey: candidate.duplicateKey, qualityHints: { importanceHint: candidate.importanceHint, sourceQuality: "medium", useful: true, reasons: ["Alpha Vantage backup market/fundamental data sample"] }, rawPayload: candidate.payload, dryRun });
}

export async function runAlphaVantageIngestion(options: AlphaVantageRunOptions = {}): Promise<AlphaVantageRunResult> {
  const startedAt = Date.now();
  const dryRun = options.dryRun !== false;
  const apiKey = getApiKey();
  const errors: string[] = [];
  const tickers = requestedTickers(options.tickers, options.limit);
  let recordsChecked = 0;
  let rawSignalsCreated = 0;
  let duplicatesSkipped = 0;
  let rejected = 0;

  if (!apiKey) {
    const sourceHealthStatus = await updateAlphaVantageSourceHealth("not_configured", startedAt, "ALPHA_VANTAGE_API_KEY is not configured.").catch(() => "not_configured");
    return { ok: true, source: ALPHA_VANTAGE_SOURCE, dryRun, apiKeyConfigured: false, status: "missing_key", tickersChecked: 0, recordsChecked, rawSignalsCreated, duplicatesSkipped, rejected, errors, sourceHealthStatus };
  }

  try {
    for (const ticker of tickers) {
      const [quote, overview, income] = await Promise.allSettled([
        fetchAlphaVantage<AlphaVantageQuoteResponse>(apiKey, { function: "GLOBAL_QUOTE", symbol: ticker }),
        fetchAlphaVantage<AlphaVantageOverviewResponse>(apiKey, { function: "OVERVIEW", symbol: ticker }),
        fetchAlphaVantage<AlphaVantageIncomeStatementResponse>(apiKey, { function: "INCOME_STATEMENT", symbol: ticker }),
      ]);

      const candidates: Array<AlphaVantageCandidate | null> = [];
      if (quote.status === "fulfilled") { const row = quote.value["Global Quote"] ?? {}; recordsChecked += Object.keys(row).length ? 1 : 0; candidates.push(...quoteCandidates(ticker, row)); } else errors.push(safeError(quote.reason));
      if (overview.status === "fulfilled") { recordsChecked += overview.value.Symbol || overview.value.Name ? 1 : 0; candidates.push(overviewCandidate(ticker, overview.value)); } else errors.push(safeError(overview.reason));
      if (income.status === "fulfilled") { recordsChecked += income.value.quarterlyReports?.length ? 1 : 0; candidates.push(fundamentalsCandidate(ticker, income.value)); } else errors.push(safeError(income.reason));

      for (const candidate of candidates.filter((item): item is AlphaVantageCandidate => Boolean(item)).slice(0, 4)) {
        const result = await writeCandidate(candidate, dryRun);
        if (result.status === "saved") rawSignalsCreated += 1;
        else if (result.status === "skipped" && result.reason === "duplicate") duplicatesSkipped += 1;
        else if (result.status === "rejected") rejected += 1;
      }
    }
  } catch (error) {
    errors.push(safeError(error));
  }

  const sourceHealthStatus = await updateAlphaVantageSourceHealth(errors.length ? (recordsChecked ? "degraded" : "error") : "connected", startedAt, errors[0] ?? null).catch(() => errors.length ? "error" : "connected");
  return { ok: recordsChecked > 0 || errors.length === 0, source: ALPHA_VANTAGE_SOURCE, dryRun, apiKeyConfigured: true, status: errors.length ? "error" : "complete", tickersChecked: tickers.length, recordsChecked, rawSignalsCreated, duplicatesSkipped, rejected, errors: [...new Set(errors)].slice(0, 10), sourceHealthStatus };
}
