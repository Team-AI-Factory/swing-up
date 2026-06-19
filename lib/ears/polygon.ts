import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { writeRawSignal, type WriteRawSignalResult } from "@/lib/raw-signal-writer";

export const POLYGON_SOURCE = "Polygon";
export const DEFAULT_POLYGON_TICKERS = ["AAPL", "MSFT", "NVDA"] as const;

const POLYGON_BASE_URL = "https://api.polygon.io";
const DEFAULT_LIMIT = DEFAULT_POLYGON_TICKERS.length;
const MAX_LIMIT = DEFAULT_POLYGON_TICKERS.length;

type PolygonRunOptions = { dryRun?: boolean; limit?: number; tickers?: string[] };
type PolygonEventType = "price_movement" | "volume_movement" | "unusual_ticker_activity" | "market_reaction_confirmation";
type PolygonAggResult = { T?: string; c?: number; o?: number; h?: number; l?: number; v?: number; vw?: number; t?: number; n?: number };
type PolygonPrevCloseResponse = { ticker?: string; queryCount?: number; resultsCount?: number; results?: PolygonAggResult[]; status?: string };

type PolygonCandidate = {
  ticker: string;
  eventType: PolygonEventType;
  title: string;
  summary: string;
  url: string;
  detectedAt: string;
  duplicateKey: string;
  importanceHint: "low" | "medium" | "high";
  payload: Prisma.InputJsonObject;
};

export type PolygonRunResult = {
  ok: boolean;
  source: typeof POLYGON_SOURCE;
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
  return process.env.POLYGON_API_KEY?.trim() || "";
}

export function capPolygonLimit(limit?: number) {
  if (!Number.isFinite(limit) || !limit || limit < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

function requestedTickers(tickers?: string[], limit?: number) {
  const cleaned = (tickers?.length ? tickers : [...DEFAULT_POLYGON_TICKERS])
    .map((ticker) => ticker.trim().toUpperCase())
    .filter((ticker) => /^[A-Z.]{1,8}$/.test(ticker));
  const unique = [...new Set(cleaned)];
  return (unique.length ? unique : [...DEFAULT_POLYGON_TICKERS]).slice(0, capPolygonLimit(limit));
}

function safeError(error: unknown) {
  if (error instanceof Error) return error.message.split("\n")[0]?.slice(0, 220) || "Polygon request failed";
  return "Polygon request failed";
}

async function updatePolygonSourceHealth(status: "connected" | "not_configured" | "degraded" | "error", startedAt: number, errorMessage: string | null) {
  if (!process.env.DATABASE_URL) return status;
  const now = new Date();
  await prisma.sourceHealth.upsert({
    where: { source: POLYGON_SOURCE },
    create: { source: POLYGON_SOURCE, status, checkedAt: now, lastSuccessAt: status === "connected" || status === "degraded" ? now : null, responseTimeMs: Date.now() - startedAt, errorMessage, usage: "Optional Polygon paid market data ear", notes: "Uses POLYGON_API_KEY for tiny samples of previous close price, volume, transaction activity, and market reaction confirmation. Creates raw signals only; never final alerts." },
    update: { status, checkedAt: now, lastSuccessAt: status === "connected" || status === "degraded" ? now : undefined, responseTimeMs: Date.now() - startedAt, errorMessage, usage: "Optional Polygon paid market data ear", notes: "Uses POLYGON_API_KEY for tiny samples of previous close price, volume, transaction activity, and market reaction confirmation. Creates raw signals only; never final alerts." },
  });
  return status;
}

async function fetchPolygonPrevClose(ticker: string, apiKey: string) {
  const url = new URL(`${POLYGON_BASE_URL}/v2/aggs/ticker/${ticker}/prev`);
  url.searchParams.set("adjusted", "true");
  url.searchParams.set("apiKey", apiKey);
  const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!response.ok) throw new Error(`Polygon prev close for ${ticker} failed with status ${response.status}`);
  return (await response.json()) as PolygonPrevCloseResponse;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function detectedAt(row: PolygonAggResult) {
  const date = typeof row.t === "number" ? new Date(row.t) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function movePercent(row: PolygonAggResult) {
  const open = numberValue(row.o);
  const close = numberValue(row.c);
  if (open === null || close === null || open === 0) return null;
  return ((close - open) / open) * 100;
}

function candidatesForTicker(ticker: string, row: PolygonAggResult, marketMove: number | null): PolygonCandidate[] {
  const candidates: PolygonCandidate[] = [];
  const detected = detectedAt(row);
  const day = detected.slice(0, 10);
  const move = movePercent(row);
  const volume = numberValue(row.v);
  const transactions = numberValue(row.n);
  const price = numberValue(row.c);
  const payloadBase = { provider: POLYGON_SOURCE, endpoint: "v2/aggs/ticker/{ticker}/prev", row: row as Prisma.InputJsonObject, noFinalAlerts: true };
  const url = `https://polygon.io/quote/${ticker}`;

  if (move !== null && Math.abs(move) >= 2) {
    candidates.push({ ticker, eventType: "price_movement", title: `${ticker} notable Polygon price move`, summary: `${ticker} moved ${move.toFixed(2)}% from open to close in the latest Polygon previous-close sample${price === null ? "." : ` with close near $${price}.`} This is raw market evidence only.`, url, detectedAt: detected, duplicateKey: `${POLYGON_SOURCE}|price_movement|${ticker}|${day}`, importanceHint: Math.abs(move) >= 5 ? "high" : "medium", payload: { ...payloadBase, movePercent: move } });
  }

  if (volume !== null && volume >= 10_000_000) {
    candidates.push({ ticker, eventType: "volume_movement", title: `${ticker} elevated Polygon volume sample`, summary: `${ticker} latest Polygon previous-close sample showed volume near ${Math.round(volume).toLocaleString()}. This is raw volume evidence only.`, url, detectedAt: detected, duplicateKey: `${POLYGON_SOURCE}|volume_movement|${ticker}|${day}`, importanceHint: volume >= 50_000_000 ? "high" : "medium", payload: { ...payloadBase, volume } });
  }

  if (transactions !== null && transactions >= 100_000) {
    candidates.push({ ticker, eventType: "unusual_ticker_activity", title: `${ticker} unusual Polygon ticker activity sample`, summary: `${ticker} latest Polygon previous-close sample showed approximately ${Math.round(transactions).toLocaleString()} transactions. This flags activity context only.`, url, detectedAt: detected, duplicateKey: `${POLYGON_SOURCE}|unusual_ticker_activity|${ticker}|${day}`, importanceHint: "medium", payload: { ...payloadBase, transactions } });
  }

  if (move !== null && marketMove !== null && Math.abs(move) >= 2 && Math.sign(move) === Math.sign(marketMove)) {
    candidates.push({ ticker, eventType: "market_reaction_confirmation", title: `${ticker} Polygon market reaction confirmation`, summary: `${ticker} moved ${move.toFixed(2)}% while SPY moved ${marketMove.toFixed(2)}% in the latest Polygon samples, suggesting broad-market confirmation. This is raw market context only.`, url, detectedAt: detected, duplicateKey: `${POLYGON_SOURCE}|market_reaction_confirmation|${ticker}|${day}`, importanceHint: "low", payload: { ...payloadBase, movePercent: move, marketTicker: "SPY", marketMovePercent: marketMove } });
  }

  return candidates;
}

async function writeCandidate(candidate: PolygonCandidate, dryRun: boolean): Promise<WriteRawSignalResult> {
  return writeRawSignal({ sourceName: POLYGON_SOURCE, sourceType: "market", ticker: candidate.ticker, eventType: candidate.eventType, title: candidate.title, summary: candidate.summary, url: candidate.url, detectedAt: candidate.detectedAt, duplicateKey: candidate.duplicateKey, qualityHints: { importanceHint: candidate.importanceHint, sourceQuality: "high", useful: true, reasons: ["Polygon market data sample"] }, rawPayload: candidate.payload, dryRun });
}

export async function runPolygonIngestion(options: PolygonRunOptions = {}): Promise<PolygonRunResult> {
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
    const sourceHealthStatus = await updatePolygonSourceHealth("not_configured", startedAt, "POLYGON_API_KEY is not configured.").catch(() => "not_configured");
    return { ok: true, source: POLYGON_SOURCE, dryRun, apiKeyConfigured: false, status: "missing_key", tickersChecked: 0, recordsChecked, rawSignalsCreated, duplicatesSkipped, rejected, errors, sourceHealthStatus };
  }

  try {
    const market = await fetchPolygonPrevClose("SPY", apiKey).catch((error) => { errors.push(safeError(error)); return null; });
    const marketMove = market?.results?.[0] ? movePercent(market.results[0]) : null;
    if (market?.results?.length) recordsChecked += market.results.length;

    for (const ticker of tickers) {
      const response = await fetchPolygonPrevClose(ticker, apiKey);
      const row = response.results?.[0];
      if (!row) continue;
      recordsChecked += 1;
      for (const candidate of candidatesForTicker(ticker, row, marketMove).slice(0, 4)) {
        const result = await writeCandidate(candidate, dryRun);
        if (result.status === "saved") rawSignalsCreated += 1;
        else if (result.status === "skipped" && result.reason === "duplicate") duplicatesSkipped += 1;
        else if (result.status === "rejected") rejected += 1;
      }
    }
  } catch (error) {
    errors.push(safeError(error));
  }

  const sourceHealthStatus = await updatePolygonSourceHealth(errors.length ? (recordsChecked ? "degraded" : "error") : "connected", startedAt, errors[0] ?? null).catch(() => errors.length ? "error" : "connected");
  return { ok: recordsChecked > 0 || errors.length === 0, source: POLYGON_SOURCE, dryRun, apiKeyConfigured: true, status: errors.length ? "error" : "complete", tickersChecked: tickers.length, recordsChecked, rawSignalsCreated, duplicatesSkipped, rejected, errors: [...new Set(errors)].slice(0, 10), sourceHealthStatus };
}
