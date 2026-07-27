import { DEFAULT_COINGECKO_ASSETS } from "@/lib/ears/coingecko";

export type LiveCryptoAsset = { id: string; ticker: string; name: string };
export type LivePricePoint = { price: number; capturedAt: Date };
export type LivePriceSeries = {
  ok: boolean;
  provider: "coingecko";
  asset: LiveCryptoAsset | null;
  currency: "USD";
  sourceUrl: string | null;
  points: LivePricePoint[];
  error: string | null;
  rateLimited: boolean;
};

const EXTRA_ASSETS: LiveCryptoAsset[] = [
  { id: "tether", ticker: "USDT", name: "Tether" },
  { id: "usd-coin", ticker: "USDC", name: "USDC" },
  { id: "tron", ticker: "TRX", name: "TRON" },
  { id: "the-open-network", ticker: "TON", name: "Toncoin" },
  { id: "polkadot", ticker: "DOT", name: "Polkadot" },
  { id: "litecoin", ticker: "LTC", name: "Litecoin" },
  { id: "bitcoin-cash", ticker: "BCH", name: "Bitcoin Cash" },
  { id: "uniswap", ticker: "UNI", name: "Uniswap" },
  { id: "cosmos", ticker: "ATOM", name: "Cosmos Hub" },
  { id: "near", ticker: "NEAR", name: "NEAR Protocol" },
  { id: "aptos", ticker: "APT", name: "Aptos" },
  { id: "sui", ticker: "SUI", name: "Sui" },
];

export const LIVE_CRYPTO_ASSETS: LiveCryptoAsset[] = [
  ...DEFAULT_COINGECKO_ASSETS.map((asset) => ({ ...asset })),
  ...EXTRA_ASSETS,
];

function headers(): Record<string, string> {
  const key = process.env.COINGECKO_API_KEY?.trim();
  return key
    ? { Accept: "application/json", "x-cg-demo-api-key": key }
    : { Accept: "application/json" };
}

function cleanTicker(value: string) {
  return value.trim().toUpperCase().replace(/[-/](USD|USDT|USDC)$/i, "");
}

export function resolveLiveCryptoAsset(ticker: string, explicitId?: string | null) {
  const id = explicitId?.trim().toLowerCase();
  if (id) {
    const known = LIVE_CRYPTO_ASSETS.find((asset) => asset.id === id);
    return known ?? { id, ticker: cleanTicker(ticker), name: cleanTicker(ticker) };
  }
  const normalized = cleanTicker(ticker);
  return LIVE_CRYPTO_ASSETS.find((asset) => asset.ticker === normalized) ?? null;
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 200) : "CoinGecko request failed";
}

async function request(url: URL, fetchImpl: typeof fetch) {
  const response = await fetchImpl(url, {
    headers: headers(),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (response.status === 429) throw new Error("CoinGecko rate limit reached");
  if (!response.ok) throw new Error(`CoinGecko request failed with status ${response.status}`);
  return response.json() as Promise<unknown>;
}

export async function fetchLiveCryptoPrice(
  ticker: string,
  explicitId?: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<LivePriceSeries> {
  const asset = resolveLiveCryptoAsset(ticker, explicitId);
  if (!asset) return { ok: false, provider: "coingecko", asset: null, currency: "USD", sourceUrl: null, points: [], error: "unsupported_crypto_asset", rateLimited: false };
  const url = new URL("https://api.coingecko.com/api/v3/simple/price");
  url.searchParams.set("ids", asset.id);
  url.searchParams.set("vs_currencies", "usd");
  url.searchParams.set("include_last_updated_at", "true");
  try {
    const body = (await request(url, fetchImpl)) as Record<string, { usd?: unknown; last_updated_at?: unknown } | undefined>;
    const row = body[asset.id];
    const price = typeof row?.usd === "number" && row.usd > 0 ? row.usd : null;
    const timestamp = typeof row?.last_updated_at === "number" ? new Date(row.last_updated_at * 1000) : new Date();
    if (!price || Number.isNaN(timestamp.getTime())) throw new Error("CoinGecko returned no valid live USD price");
    return { ok: true, provider: "coingecko", asset, currency: "USD", sourceUrl: url.toString(), points: [{ price, capturedAt: timestamp }], error: null, rateLimited: false };
  } catch (error) {
    const message = safeError(error);
    return { ok: false, provider: "coingecko", asset, currency: "USD", sourceUrl: url.toString(), points: [], error: message, rateLimited: /rate limit|429/i.test(message) };
  }
}

export async function fetchLiveCryptoPriceSeries(
  ticker: string,
  from: Date,
  to: Date,
  explicitId?: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<LivePriceSeries> {
  const asset = resolveLiveCryptoAsset(ticker, explicitId);
  if (!asset) return { ok: false, provider: "coingecko", asset: null, currency: "USD", sourceUrl: null, points: [], error: "unsupported_crypto_asset", rateLimited: false };
  if (to.getTime() - from.getTime() < 2 * 60 * 60 * 1000) return fetchLiveCryptoPrice(ticker, explicitId, fetchImpl);
  const url = new URL(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(asset.id)}/market_chart/range`);
  url.searchParams.set("vs_currency", "usd");
  url.searchParams.set("from", String(Math.floor(from.getTime() / 1000)));
  url.searchParams.set("to", String(Math.floor(to.getTime() / 1000)));
  try {
    const body = (await request(url, fetchImpl)) as { prices?: unknown };
    const rows = Array.isArray(body.prices) ? body.prices : [];
    const points = rows.flatMap((row) => {
      if (!Array.isArray(row) || row.length < 2) return [];
      const timestamp = typeof row[0] === "number" ? new Date(row[0]) : null;
      const price = typeof row[1] === "number" ? row[1] : null;
      return timestamp && !Number.isNaN(timestamp.getTime()) && price && price > 0 ? [{ price, capturedAt: timestamp }] : [];
    });
    if (!points.length) throw new Error("CoinGecko returned no valid historical USD prices");
    return { ok: true, provider: "coingecko", asset, currency: "USD", sourceUrl: url.toString(), points, error: null, rateLimited: false };
  } catch (error) {
    const message = safeError(error);
    return { ok: false, provider: "coingecko", asset, currency: "USD", sourceUrl: url.toString(), points: [], error: message, rateLimited: /rate limit|429/i.test(message) };
  }
}
