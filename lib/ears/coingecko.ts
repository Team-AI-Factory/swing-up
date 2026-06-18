import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";

export const COINGECKO_SOURCE = "CoinGecko";

const SIMPLE_PRICE_URL = "https://api.coingecko.com/api/v3/simple/price";
export const DEFAULT_COINGECKO_ASSETS = [
  { id: "bitcoin", ticker: "BTC", name: "Bitcoin" },
  { id: "ethereum", ticker: "ETH", name: "Ethereum" },
  { id: "solana", ticker: "SOL", name: "Solana" },
  { id: "xrp", ticker: "XRP", name: "XRP" },
  { id: "dogecoin", ticker: "DOGE", name: "Dogecoin" },
  { id: "binancecoin", ticker: "BNB", name: "BNB" },
  { id: "cardano", ticker: "ADA", name: "Cardano" },
  { id: "chainlink", ticker: "LINK", name: "Chainlink" },
  { id: "avalanche-2", ticker: "AVAX", name: "Avalanche" },
  { id: "polygon-ecosystem-token", ticker: "POL", name: "Polygon Ecosystem Token" },
] as const;

const DEFAULT_LIMIT = DEFAULT_COINGECKO_ASSETS.length;
const MAX_LIMIT = DEFAULT_COINGECKO_ASSETS.length;
const RATE_LIMIT_MESSAGE = "CoinGecko rate-limited the request. The system is degraded and should wait before retrying.";

type CoinGeckoAsset = (typeof DEFAULT_COINGECKO_ASSETS)[number];
type CoinGeckoSimplePriceRow = {
  usd?: number;
  usd_24h_change?: number;
  usd_24h_vol?: number;
  usd_market_cap?: number;
  last_updated_at?: number;
};
type CoinGeckoSimplePriceResponse = Record<string, CoinGeckoSimplePriceRow | undefined>;

export type CoinGeckoRunOptions = { limit?: number; dryRun?: boolean };
export type CoinGeckoQuote = {
  id: string;
  ticker: string;
  name: string;
  usdPrice: number | null;
  change24h: number | null;
  volume24h: number | null;
  marketCap: number | null;
  lastUpdatedAt: string | null;
  importanceHint: "low" | "medium" | "high";
};
export type CoinGeckoRunResult = {
  ok: boolean;
  source: typeof COINGECKO_SOURCE;
  mode: "demo_public" | "api_key";
  dryRun: boolean;
  assetsRequested: number;
  assetsChecked: number;
  signalsCreated: number;
  duplicatesSkipped: number;
  rateLimited: boolean;
  cooldownUntil: string | null;
  responseTimeMs: number;
  quotes: CoinGeckoQuote[];
  errors: string[];
};

export function capCoinGeckoLimit(limit?: number) {
  if (!Number.isFinite(limit) || !limit || limit < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

function safeError(error: unknown) {
  if (error instanceof Error) return error.message.split("\n")[0]?.slice(0, 180) || "CoinGecko request failed";
  return "CoinGecko request failed";
}

function importanceForChange(change24h: number | null): "low" | "medium" | "high" {
  const absMove = Math.abs(change24h ?? 0);
  if (absMove >= 8) return "high";
  if (absMove >= 4) return "medium";
  return "low";
}

function getApiKey() {
  return process.env.COINGECKO_API_KEY?.trim() || "";
}

function headers(): Record<string, string> {
  const apiKey = getApiKey();
  return apiKey ? { Accept: "application/json", "x-cg-demo-api-key": apiKey } : { Accept: "application/json" };
}

async function fetchCoinGeckoPrices(assets: readonly CoinGeckoAsset[]) {
  const url = new URL(SIMPLE_PRICE_URL);
  url.searchParams.set("ids", assets.map((asset) => asset.id).join(","));
  url.searchParams.set("vs_currencies", "usd");
  url.searchParams.set("include_24hr_change", "true");
  url.searchParams.set("include_24hr_vol", "true");
  url.searchParams.set("include_market_cap", "true");
  url.searchParams.set("include_last_updated_at", "true");

  const response = await fetch(url, { headers: headers(), cache: "no-store" });
  if (response.status === 429) throw new Error(RATE_LIMIT_MESSAGE);
  if (!response.ok) throw new Error(`CoinGecko request failed with status ${response.status}`);
  return (await response.json()) as CoinGeckoSimplePriceResponse;
}

function toQuote(asset: CoinGeckoAsset, row?: CoinGeckoSimplePriceRow): CoinGeckoQuote {
  const change24h = typeof row?.usd_24h_change === "number" ? row.usd_24h_change : null;
  return {
    id: asset.id,
    ticker: asset.ticker,
    name: asset.name,
    usdPrice: typeof row?.usd === "number" ? row.usd : null,
    change24h,
    volume24h: typeof row?.usd_24h_vol === "number" ? row.usd_24h_vol : null,
    marketCap: typeof row?.usd_market_cap === "number" ? row.usd_market_cap : null,
    lastUpdatedAt: typeof row?.last_updated_at === "number" ? new Date(row.last_updated_at * 1000).toISOString() : null,
    importanceHint: importanceForChange(change24h),
  };
}

async function rawSignalExists(quote: CoinGeckoQuote) {
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const existing = await prisma.rawSignal.findFirst({
    where: { source: COINGECKO_SOURCE, ticker: quote.ticker, signalType: "crypto_market", receivedAt: { gte: since } },
    select: { id: true },
  });
  return Boolean(existing);
}

async function createRawSignal(quote: CoinGeckoQuote, dryRun: boolean) {
  if (await rawSignalExists(quote)) return "duplicate" as const;
  if (dryRun) return "dry_run" as const;

  await prisma.rawSignal.create({
    data: {
      source: COINGECKO_SOURCE,
      ticker: quote.ticker,
      signalType: "crypto_market",
      title: `${quote.ticker} 24h crypto market move`,
      summary: `${quote.name} moved ${quote.change24h?.toFixed(2) ?? "unknown"}% over 24h. CoinGecko data helps measure crypto risk appetite; no final alert was created.`,
      processedStatus: "new",
      importanceHint: quote.importanceHint,
      receivedAt: quote.lastUpdatedAt ? new Date(quote.lastUpdatedAt) : new Date(),
      sourceUrl: `https://www.coingecko.com/en/coins/${quote.id}`,
      payload: { coingeckoId: quote.id, ticker: quote.ticker, name: quote.name, usdPrice: quote.usdPrice, change24h: quote.change24h, volume24h: quote.volume24h, marketCap: quote.marketCap, lastUpdatedAt: quote.lastUpdatedAt, noFinalAlerts: true } satisfies Prisma.InputJsonValue,
    },
  });
  return "created" as const;
}

async function updateCoinGeckoSourceHealth(status: "connected" | "degraded" | "error", startedAt: number, errorMessage: string | null) {
  const now = new Date();
  await prisma.sourceHealth.upsert({
    where: { source: COINGECKO_SOURCE },
    create: { source: COINGECKO_SOURCE, status, checkedAt: now, lastSuccessAt: status === "error" ? null : now, responseTimeMs: Date.now() - startedAt, errorMessage, usage: "Public CoinGecko crypto market ear", notes: "Uses the simple price endpoint for default crypto assets. Supports public/demo mode and COINGECKO_API_KEY when configured; creates raw signals only, never final alerts." },
    update: { status, checkedAt: now, lastSuccessAt: status === "error" ? undefined : now, responseTimeMs: Date.now() - startedAt, errorMessage, usage: "Public CoinGecko crypto market ear", notes: "Uses the simple price endpoint for default crypto assets. Supports public/demo mode and COINGECKO_API_KEY when configured; creates raw signals only, never final alerts." },
  });
}

export async function runCoinGeckoIngestion(options: CoinGeckoRunOptions = {}): Promise<CoinGeckoRunResult> {
  const startedAt = Date.now();
  const limit = capCoinGeckoLimit(options.limit);
  const assets = DEFAULT_COINGECKO_ASSETS.slice(0, limit);
  const errors: string[] = [];
  let quotes: CoinGeckoQuote[] = [];
  let signalsCreated = 0;
  let duplicatesSkipped = 0;
  let rateLimited = false;
  let cooldownUntil: string | null = null;

  try {
    const data = await fetchCoinGeckoPrices(assets);
    quotes = assets.map((asset) => toQuote(asset, data[asset.id]));
    for (const quote of quotes) {
      const result = await createRawSignal(quote, Boolean(options.dryRun));
      if (result === "created") signalsCreated += 1;
      if (result === "duplicate") duplicatesSkipped += 1;
    }
  } catch (error) {
    const message = safeError(error);
    rateLimited = message === RATE_LIMIT_MESSAGE || message.includes("429");
    cooldownUntil = rateLimited ? new Date(Date.now() + 10 * 60 * 1000).toISOString() : null;
    errors.push(rateLimited ? RATE_LIMIT_MESSAGE : message);
  }

  const status = rateLimited ? "degraded" : errors.length ? "error" : "connected";
  await updateCoinGeckoSourceHealth(status, startedAt, errors[0] ?? null);

  return { ok: !errors.length || rateLimited, source: COINGECKO_SOURCE, mode: getApiKey() ? "api_key" : "demo_public", dryRun: Boolean(options.dryRun), assetsRequested: limit, assetsChecked: quotes.length, signalsCreated, duplicatesSkipped, rateLimited, cooldownUntil, responseTimeMs: Date.now() - startedAt, quotes, errors };
}

export async function getCoinGeckoSourceHealth() {
  const row = await prisma.sourceHealth.findUnique({ where: { source: COINGECKO_SOURCE } });
  return row ? { source: row.source, status: row.status, lastChecked: row.checkedAt.toISOString(), lastSuccess: row.lastSuccessAt?.toISOString() ?? null, responseTimeMs: row.responseTimeMs, lastError: row.errorMessage ? row.errorMessage.slice(0, 240) : null, usage: row.usage, notes: row.notes, mode: getApiKey() ? "api_key" : "demo_public" } : { source: COINGECKO_SOURCE, status: "stubbed", lastChecked: null, lastSuccess: null, responseTimeMs: null, lastError: null, usage: "Public CoinGecko crypto market ear", notes: "CoinGecko has not been checked yet. It will use the simple price endpoint in public/demo mode unless COINGECKO_API_KEY is configured.", mode: getApiKey() ? "api_key" : "demo_public" };
}
