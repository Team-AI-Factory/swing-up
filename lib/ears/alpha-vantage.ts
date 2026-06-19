import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { writeRawSignal, type WriteRawSignalResult } from "@/lib/raw-signal-writer";

export const ALPHA_VANTAGE_SOURCE = "Alpha Vantage";
export const DEFAULT_ALPHA_VANTAGE_TICKERS = ["AAPL", "MSFT"] as const;

const ALPHA_VANTAGE_BASE_URL = "https://www.alphavantage.co/query";
const DEFAULT_LIMIT = DEFAULT_ALPHA_VANTAGE_TICKERS.length;
const MAX_LIMIT = DEFAULT_ALPHA_VANTAGE_TICKERS.length;

type AlphaVantageRunOptions = { dryRun?: boolean; limit?: number; tickers?: string[] };
type AlphaVantageEventType = "quote_movement" | "price_volume_confirmation" | "company_overview_change" | "light_fundamentals";
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
    create: { source: ALPHA_VANTAGE_SOURCE, status, checkedAt: now, lastSuccessAt: status === "connected" || status === "degraded" ? now : null, responseTimeMs: Date.now() - startedAt, errorMessage, usage: "Optional Alpha Vantage backup market/fundamental ear", notes: "Uses ALPHA_VANTAGE_API_KEY in free-mode for tiny samples of quote, overview, and lightweight fundamentals data. Creates raw signals only; never final alerts." },
    update: { status, checkedAt: now, lastSuccessAt: status === "connected" || status === "degraded" ? now : undefined, responseTimeMs: Date.now() - startedAt, errorMessage, usage: "Optional Alpha Vantage backup market/fundamental ear", notes: "Uses ALPHA_VANTAGE_API_KEY in free-mode for tiny samples of quote, overview, and lightweight fundamentals data. Creates raw signals only; never final alerts." },
  });
  return status;
}

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
  return json;
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

function overviewCandidate(ticker: string, overview: AlphaVantageJson): AlphaVantageCandidate | null {
  const name = stringValue(overview.Name);
  const marketCap = numberValue(overview.MarketCapitalization);
  const sector = stringValue(overview.Sector);
  const description = stringValue(overview.Description);
  if (!name && !marketCap && !sector && !description) return null;
  const detected = new Date().toISOString();
  return { ticker, eventType: "company_overview_change", title: `${ticker} Alpha Vantage company overview snapshot`, summary: `${ticker} Alpha Vantage overview sample${name ? ` for ${name}` : ""}${sector ? ` in ${sector}` : ""}${marketCap === null ? "." : ` shows market cap near ${marketCap}.`} This flags company profile context only.`, url: `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${ticker}`, detectedAt: detected, duplicateKey: `${ALPHA_VANTAGE_SOURCE}|company_overview_change|${ticker}|${detected.slice(0, 10)}`, importanceHint: "low", payload: { provider: ALPHA_VANTAGE_SOURCE, endpoint: "OVERVIEW", overview: overview as Prisma.InputJsonObject, noFinalAlerts: true } };
}

function fundamentalsCandidate(ticker: string, income: AlphaVantageJson): AlphaVantageCandidate | null {
  const reports = Array.isArray(income.annualReports) ? income.annualReports : [];
  const latest = reports[0] as AlphaVantageJson | undefined;
  if (!latest) return null;
  const fiscalDate = stringValue(latest.fiscalDateEnding);
  const totalRevenue = numberValue(latest.totalRevenue);
  const netIncome = numberValue(latest.netIncome);
  if (totalRevenue === null && netIncome === null) return null;
  const detected = dateValue(fiscalDate);
  return { ticker, eventType: "light_fundamentals", title: `${ticker} Alpha Vantage lightweight fundamentals snapshot`, summary: `${ticker} latest Alpha Vantage income statement sample shows revenue ${totalRevenue ?? "unknown"} and net income ${netIncome ?? "unknown"}. This captures backup fundamentals context only.`, url: `https://www.alphavantage.co/query?function=INCOME_STATEMENT&symbol=${ticker}`, detectedAt: detected, duplicateKey: `${ALPHA_VANTAGE_SOURCE}|light_fundamentals|${ticker}|${detected.slice(0, 10)}`, importanceHint: "medium", payload: { provider: ALPHA_VANTAGE_SOURCE, endpoint: "INCOME_STATEMENT", latest: latest as Prisma.InputJsonObject, noFinalAlerts: true } };
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

  for (const ticker of tickers) {
    const [quote, overview, income] = await Promise.allSettled([
      fetchAlphaVantage("GLOBAL_QUOTE", ticker, apiKey),
      fetchAlphaVantage("OVERVIEW", ticker, apiKey),
      fetchAlphaVantage("INCOME_STATEMENT", ticker, apiKey),
    ]);
    const candidates: Array<AlphaVantageCandidate | null> = [];
    if (quote.status === "fulfilled") { recordsChecked += 1; candidates.push(...quoteCandidates(ticker, quote.value)); } else errors.push(safeError(quote.reason));
    if (overview.status === "fulfilled") { recordsChecked += 1; candidates.push(overviewCandidate(ticker, overview.value)); } else errors.push(safeError(overview.reason));
    if (income.status === "fulfilled") { recordsChecked += 1; candidates.push(fundamentalsCandidate(ticker, income.value)); } else errors.push(safeError(income.reason));

    for (const candidate of candidates.filter((item): item is AlphaVantageCandidate => Boolean(item)).slice(0, 4)) {
      const result = await writeCandidate(candidate, dryRun);
      if (result.status === "saved") rawSignalsCreated += 1;
      else if (result.status === "skipped" && result.reason === "duplicate") duplicatesSkipped += 1;
      else if (result.status === "rejected") rejected += 1;
    }
  }

  const sourceHealthStatus = await updateAlphaVantageSourceHealth(errors.length ? (recordsChecked ? "degraded" : "error") : "connected", startedAt, errors[0] ?? null).catch(() => errors.length ? "error" : "connected");
  return { ok: recordsChecked > 0 || errors.length === 0, source: ALPHA_VANTAGE_SOURCE, dryRun, apiKeyConfigured: true, status: errors.length ? "error" : "complete", tickersChecked: tickers.length, recordsChecked, rawSignalsCreated, duplicatesSkipped, rejected, errors: [...new Set(errors)].slice(0, 10), sourceHealthStatus };
}
