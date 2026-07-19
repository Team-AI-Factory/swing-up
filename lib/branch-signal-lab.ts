import crypto from "node:crypto";
import { runAiCommittee, TRUSTED_IN_MEMORY_EVIDENCE } from "@/lib/ai-committee/orchestrator";
import type { AiCommitteeEvidencePack, EvidenceStrength } from "@/lib/ai-committee/evidence-pack";
import { getAiCommitteeProviderStatus } from "@/lib/ai-committee/provider";
import { candidateFingerprintInput, canonicalEventIdentity, computeActionStrength, matchesAssetText, normalizeProviderCryptoSymbol, providerCooldownMs, providerFailurePolicy, selectBalancedReceipts } from "@/lib/branch-signal-lab-policy";
import { buildMarketSentimentImpact, scoreSwingUpAlert, type SwingUpScore } from "@/lib/scoring-engine";

type CryptoAsset = { id: string; ticker: string; name: string };
type MarketRow = {
  id?: unknown;
  current_price?: unknown;
  price_change_percentage_24h?: unknown;
  price_change_percentage_7d_in_currency?: unknown;
  total_volume?: unknown;
  market_cap?: unknown;
  fully_diluted_valuation?: unknown;
  circulating_supply?: unknown;
  total_supply?: unknown;
  max_supply?: unknown;
  high_24h?: unknown;
  low_24h?: unknown;
  ath_change_percentage?: unknown;
  last_updated?: unknown;
};
type MarketCandidate = CryptoAsset & {
  price: number;
  change24h: number;
  change7d: number | null;
  volume24h: number;
  marketCap: number;
  fullyDilutedValuation: number | null;
  circulatingSupply: number | null;
  totalSupply: number | null;
  maxSupply: number | null;
  high24h: number;
  low24h: number;
  athChangePercentage: number | null;
  observedAt: string;
};
type EventMarketConfirmation = {
  status: "confirmed" | "not_confirmed" | "unavailable";
  eventObservedAt: string;
  checkedAt: string;
  eventPrice: number | null;
  currentPrice: number;
  postEventMovePercent: number | null;
  sourceUrl: string;
  error: string | null;
  cached: boolean;
};
type NewsChannel = "google_news_rss" | "gdelt" | "marketaux" | "alpha_vantage" | "fmp_crypto_news";
type CatalystDirection = "upside" | "downside" | "neutral";
type NewsReceipt = {
  title: string;
  summary: string | null;
  url: string;
  publisher: string;
  publishedAt: string;
  catalystKeywords: string[];
  catalystDirection: CatalystDirection;
  channel: NewsChannel;
  assetTickers: string[];
};
type ProviderStatus = "connected" | "rate_limited" | "temporarily_unavailable" | "not_configured" | "not_entitled" | "failed";
type NewsProviderResult = {
  receipts: NewsReceipt[];
  sourceUrl: string;
  status: ProviderStatus;
  error: string | null;
  checkedAt: string | null;
  nextRetryAt: string | null;
  cached: boolean;
};
type MacroContext = {
  checkedAt: string;
  fred: { status: "connected" | "failed"; sourceUrls: string[]; fedFundsRate: number | null; tenYearYield: number | null; latestObservationDate: string | null; error: string | null };
  frankfurter: { status: "connected" | "failed"; sourceUrl: string; date: string | null; rates: Record<string, number>; error: string | null };
};
type SupplementalSourceAudit = {
  checkedAt: string;
  performanceEvidence: false;
  databaseWrites: false;
  r2Writes: false;
  publishing: false;
  notifications: false;
  providers: Record<string, Record<string, unknown>>;
};
type NewsSnapshot = {
  checkedAt: string;
  receipts: NewsReceipt[];
  sourceUrl: string;
};
type NewsProviderState = {
  failureCount: number;
  cooldownUntil: number;
  status: Extract<ProviderStatus, "rate_limited" | "temporarily_unavailable" | "not_entitled" | "failed">;
  error: string;
};
export type BranchProviderCallRequest = {
  provider: "coingecko" | "gdelt" | "marketaux" | "alpha_vantage" | "fmp" | "fred" | "frankfurter" | "sec_edgar" | "openfda";
  quotaKey: string;
  cadenceKey: string;
  checkedAt: string;
  rollingWindowMs: number;
  maximumCallsInWindow: number;
  minimumIntervalMs: number;
};
export type BranchProviderCallDecision = { allowed: boolean; nextRetryAt: string | null; reason: "reserved" | "cadence_guard" | "rolling_quota_guard" };

const ASSETS: CryptoAsset[] = [
  { id: "bitcoin", ticker: "BTC", name: "Bitcoin" },
  { id: "ethereum", ticker: "ETH", name: "Ethereum" },
  { id: "solana", ticker: "SOL", name: "Solana" },
  { id: "ripple", ticker: "XRP", name: "XRP" },
  { id: "binancecoin", ticker: "BNB", name: "BNB" },
  { id: "cardano", ticker: "ADA", name: "Cardano" },
  { id: "dogecoin", ticker: "DOGE", name: "Dogecoin" },
  { id: "chainlink", ticker: "LINK", name: "Chainlink" },
  { id: "avalanche-2", ticker: "AVAX", name: "Avalanche" },
  { id: "sui", ticker: "SUI", name: "Sui" },
];

const UPSIDE_CATALYST_KEYWORDS = [
  "approval", "approved", "etf approval", "spot etf approval", "upgrade", "launch", "partnership", "adoption",
  "listing", "integration", "mainnet", "inflows", "fund inflows", "strategic reserve", "treasury purchase",
  "lawsuit dismissed", "charges dismissed", "ban lifted", "delisting reversed", "exploit patched", "hack prevented",
];
const DOWNSIDE_CATALYST_KEYWORDS = [
  "lawsuit", "hack", "exploit", "outage", "delisting", "liquidation", "security breach", "investigation",
  "criminal charges", "sec charges", "charged with", "ban", "banned", "rejection", "rejected", "bankruptcy", "insolvency", "attack",
  "drain", "drained", "stolen", "seizure", "crackdown", "breach", "outflows", "fund outflows", "approval denied", "approval rejected",
];
const NEUTRAL_CATALYST_KEYWORDS = ["regulation", "regulator", "court", "sec", "cftc", "whale", "etf", "settlement", "treasury", "institutional"];
const CATALYST_KEYWORDS = [...UPSIDE_CATALYST_KEYWORDS, ...DOWNSIDE_CATALYST_KEYWORDS, ...NEUTRAL_CATALYST_KEYWORDS];
const NON_EVENT_NEWS_PATTERN = /\b(price prediction|top \d+|best crypto|should you buy|could [a-z0-9 ]+ reach|may [a-z0-9 ]+ reach|what is|beginner'?s guide|opinion|weekly outlook|technical analysis)\b/i;
const NEWS_MAX_AGE_MS = 48 * 60 * 60 * 1000;
const SERIOUS_EVENT_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const MARKET_MAX_AGE_MS = 15 * 60 * 1000;
const COINGECKO_URL = "https://api.coingecko.com/api/v3/coins/markets";
const GOOGLE_NEWS_URL = "https://news.google.com/rss/search";
const GDELT_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const MARKETAUX_URL = "https://api.marketaux.com/v1/news/all";
const ALPHA_VANTAGE_URL = "https://www.alphavantage.co/query";
const FMP_CRYPTO_NEWS_URL = "https://financialmodelingprep.com/stable/news/crypto-latest";
const FRED_FEDFUNDS_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=FEDFUNDS";
const FRED_DGS10_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10";
const FRED_API_URL = "https://api.stlouisfed.org/fred/series/observations";
const FRANKFURTER_URL = "https://api.frankfurter.app/latest?from=USD&to=EUR,JPY,CHF,CNY";
const GDELT_REFRESH_MS = 15 * 60 * 1000;
const MARKETAUX_REFRESH_MS = 20 * 60 * 1000;
const FMP_NEWS_REFRESH_MS = 30 * 60 * 1000;
const ALPHA_VANTAGE_REFRESH_MS = 2 * 60 * 60 * 1000;
const MAX_PROVIDER_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const MACRO_REFRESH_MS = 60 * 60 * 1000;
const SUPPLEMENTAL_AUDIT_REFRESH_MS = 24 * 60 * 60 * 1000;
const branchLabCache = globalThis as typeof globalThis & {
  __swingUpNewsSnapshots?: Partial<Record<Exclude<NewsChannel, "google_news_rss">, NewsSnapshot>>;
  __swingUpNewsProviderStates?: Partial<Record<Exclude<NewsChannel, "google_news_rss">, NewsProviderState>>;
  __swingUpEventConfirmations?: Record<string, EventMarketConfirmation>;
  __swingUpBranchMacroContext?: MacroContext;
  __swingUpSupplementalSourceAudit?: SupplementalSourceAudit;
};

class ExternalProviderError extends Error {
  constructor(public readonly provider: string, message: string) {
    super(message);
    this.name = "ExternalProviderError";
  }
}

function providerCallRequest(value: RequestInfo | URL, now: Date): BranchProviderCallRequest | null {
  let url: URL;
  try {
    url = value instanceof URL ? value : new URL(typeof value === "string" ? value : value.url);
  } catch {
    return null;
  }
  const day = 24 * 60 * 60 * 1000;
  const base = { checkedAt: now.toISOString() };
  if (url.hostname === "api.coingecko.com") {
    const eventMatch = url.pathname.match(/^\/api\/v3\/coins\/([^/]+)\/market_chart\/range$/);
    const cadenceKey = eventMatch ? `coingecko_event:${eventMatch[1]}:${url.searchParams.get("from") ?? "unknown"}` : "coingecko_markets";
    return { ...base, provider: "coingecko", quotaKey: "coingecko_demo_credits", cadenceKey, rollingWindowMs: 30 * day, maximumCallsInWindow: 9_200, minimumIntervalMs: eventMatch ? 12 * 60 * 60 * 1000 : 4.5 * 60 * 1000 };
  }
  if (url.hostname === "api.gdeltproject.org") return { ...base, provider: "gdelt", quotaKey: "gdelt_doc", cadenceKey: "gdelt_doc", rollingWindowMs: day, maximumCallsInWindow: 96, minimumIntervalMs: 14 * 60 * 1000 };
  if (url.hostname === "api.marketaux.com") return { ...base, provider: "marketaux", quotaKey: "marketaux_free", cadenceKey: "marketaux_news", rollingWindowMs: day, maximumCallsInWindow: 90, minimumIntervalMs: 19 * 60 * 1000 };
  if (url.hostname === "www.alphavantage.co") return { ...base, provider: "alpha_vantage", quotaKey: "alpha_vantage_free", cadenceKey: `alpha_vantage:${url.searchParams.get("function") ?? "unknown"}`, rollingWindowMs: day, maximumCallsInWindow: 20, minimumIntervalMs: 119 * 60 * 1000 };
  if (url.hostname === "financialmodelingprep.com") return { ...base, provider: "fmp", quotaKey: "fmp_configured_plan", cadenceKey: `fmp:${url.pathname}`, rollingWindowMs: day, maximumCallsInWindow: 100, minimumIntervalMs: 29 * 60 * 1000 };
  if (url.hostname === "api.stlouisfed.org" || url.hostname === "fred.stlouisfed.org") {
    const series = url.searchParams.get("series_id") ?? url.searchParams.get("id") ?? "unknown";
    return { ...base, provider: "fred", quotaKey: "fred_macro", cadenceKey: `fred:${series}`, rollingWindowMs: day, maximumCallsInWindow: 48, minimumIntervalMs: 59 * 60 * 1000 };
  }
  if (url.hostname === "api.frankfurter.app") return { ...base, provider: "frankfurter", quotaKey: "frankfurter_daily_reference", cadenceKey: "frankfurter_latest", rollingWindowMs: day, maximumCallsInWindow: 24, minimumIntervalMs: 59 * 60 * 1000 };
  if (url.hostname === "data.sec.gov") return { ...base, provider: "sec_edgar", quotaKey: "sec_edgar_audit", cadenceKey: "sec_edgar_audit", rollingWindowMs: day, maximumCallsInWindow: 1, minimumIntervalMs: 23 * 60 * 60 * 1000 };
  if (url.hostname === "api.fda.gov") return { ...base, provider: "openfda", quotaKey: "openfda_audit", cadenceKey: "openfda_audit", rollingWindowMs: day, maximumCallsInWindow: 1, minimumIntervalMs: 23 * 60 * 60 * 1000 };
  return null;
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escaped(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function keywordMatches(text: string, keyword: string) {
  const phrase = escaped(keyword.toLowerCase()).replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^a-z0-9])${phrase}([^a-z0-9]|$)`, "i").test(text);
}

function catalystMetadata(title: string, summary: string | null = null) {
  const text = `${title} ${summary ?? ""}`.toLowerCase();
  if (NON_EVENT_NEWS_PATTERN.test(title)) return { catalystKeywords: [], catalystDirection: "neutral" as const };
  const catalystKeywords = CATALYST_KEYWORDS
    .filter((keyword) => keywordMatches(text, keyword))
    .sort((a, b) => b.length - a.length)
    .filter((keyword, _index, matches) => !matches.some((longer) => longer.length > keyword.length && keywordMatches(longer, keyword)));
  const upside = catalystKeywords.filter((keyword) => UPSIDE_CATALYST_KEYWORDS.includes(keyword)).length;
  const downside = catalystKeywords.filter((keyword) => DOWNSIDE_CATALYST_KEYWORDS.includes(keyword)).length;
  const catalystDirection: CatalystDirection = upside > downside ? "upside" : downside > upside ? "downside" : "neutral";
  return { catalystKeywords, catalystDirection };
}

function assetTickersForText(text: string) {
  return ASSETS.filter((asset) => matchesAssetText(text, { name: asset.name, ticker: asset.ticker, aliases: asset.id === "ripple" ? ["Ripple"] : asset.id === "binancecoin" ? ["Binance Coin", "BNB Chain"] : [] })).map((asset) => asset.ticker);
}

function validPublishedAt(value: unknown, now: Date) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  if (now.getTime() - parsed.getTime() > NEWS_MAX_AGE_MS || parsed.getTime() > now.getTime() + 5 * 60_000) return null;
  return parsed.toISOString();
}

function uniqueReceipts(receipts: NewsReceipt[]) {
  return selectBalancedReceipts(receipts, receipts.length);
}

function providerSnapshots() {
  return branchLabCache.__swingUpNewsSnapshots ??= {};
}

function providerStates() {
  return branchLabCache.__swingUpNewsProviderStates ??= {};
}

function providerResultFromCache(channel: Exclude<NewsChannel, "google_news_rss">, now: Date, refreshMs: number): NewsProviderResult | null {
  const snapshot = providerSnapshots()[channel];
  const state = providerStates()[channel];
  if (state && state.cooldownUntil > now.getTime()) {
    return {
      receipts: snapshot?.receipts.filter((receipt) => now.getTime() - Date.parse(receipt.publishedAt) <= NEWS_MAX_AGE_MS) ?? [],
      sourceUrl: snapshot?.sourceUrl ?? "",
      status: state.status,
      error: state.error,
      checkedAt: snapshot?.checkedAt ?? null,
      nextRetryAt: new Date(state.cooldownUntil).toISOString(),
      cached: Boolean(snapshot),
    };
  }
  if (snapshot && now.getTime() - Date.parse(snapshot.checkedAt) < refreshMs) {
    return { receipts: snapshot.receipts.filter((receipt) => now.getTime() - Date.parse(receipt.publishedAt) <= NEWS_MAX_AGE_MS), sourceUrl: snapshot.sourceUrl, status: "connected", error: null, checkedAt: snapshot.checkedAt, nextRetryAt: null, cached: true };
  }
  return null;
}

function markProviderSuccess(channel: Exclude<NewsChannel, "google_news_rss">, snapshot: NewsSnapshot): NewsProviderResult {
  providerSnapshots()[channel] = snapshot;
  delete providerStates()[channel];
  return { receipts: snapshot.receipts, sourceUrl: snapshot.sourceUrl, status: "connected", error: null, checkedAt: snapshot.checkedAt, nextRetryAt: null, cached: false };
}

function markProviderFailure(params: {
  channel: Exclude<NewsChannel, "google_news_rss">;
  now: Date;
  refreshMs: number;
  status: NewsProviderState["status"];
  error: string;
  sourceUrl: string;
  minimumCooldownMs?: number;
}): NewsProviderResult {
  const previous = providerStates()[params.channel];
  const failureCount = (previous?.failureCount ?? 0) + 1;
  const delay = providerCooldownMs({ failureCount, refreshMs: params.refreshMs, minimumCooldownMs: params.minimumCooldownMs, maximumCooldownMs: MAX_PROVIDER_COOLDOWN_MS });
  const state: NewsProviderState = { failureCount, cooldownUntil: params.now.getTime() + delay, status: params.status, error: params.error };
  providerStates()[params.channel] = state;
  const snapshot = providerSnapshots()[params.channel];
  return {
    receipts: snapshot?.receipts.filter((receipt) => params.now.getTime() - Date.parse(receipt.publishedAt) <= NEWS_MAX_AGE_MS) ?? [],
    sourceUrl: snapshot?.sourceUrl ?? params.sourceUrl,
    status: params.status,
    error: params.error,
    checkedAt: snapshot?.checkedAt ?? null,
    nextRetryAt: new Date(state.cooldownUntil).toISOString(),
    cached: Boolean(snapshot),
  };
}

function providerMessage(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  for (const key of ["Note", "Information", "Error", "Error Message", "message"]) {
    if (typeof record[key] === "string" && record[key].trim()) return record[key].trim();
  }
  return null;
}

function tagValue(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function latestCsvNumber(csv: string, columnName: string) {
  const rows = csv.trim().split(/\r?\n/);
  const headers = rows[0]?.split(",").map((value) => value.trim()) ?? [];
  const column = headers.indexOf(columnName);
  if (column < 0) return { value: null, date: null };
  for (let index = rows.length - 1; index >= 1; index -= 1) {
    const values = rows[index]?.split(",") ?? [];
    const parsed = Number(values[column]);
    if (Number.isFinite(parsed)) return { value: parsed, date: values[0]?.trim() || null };
  }
  return { value: null, date: null };
}

async function fetchMacroContext(fetchImpl: typeof fetch, now: Date): Promise<MacroContext> {
  const cached = branchLabCache.__swingUpBranchMacroContext;
  if (cached && now.getTime() - Date.parse(cached.checkedAt) < MACRO_REFRESH_MS) return cached;
  const fredApiKey = process.env.FRED_API_KEY?.trim();

  async function fetchFredSeries(seriesId: "FEDFUNDS" | "DGS10") {
    if (!fredApiKey) {
      const url = seriesId === "FEDFUNDS" ? FRED_FEDFUNDS_URL : FRED_DGS10_URL;
      const response = await fetchImpl(url, { headers: { Accept: "text/csv" }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`fred_http_${response.status}`);
      return latestCsvNumber(await response.text(), seriesId);
    }
    const url = new URL(FRED_API_URL);
    url.searchParams.set("series_id", seriesId);
    url.searchParams.set("api_key", fredApiKey);
    url.searchParams.set("file_type", "json");
    url.searchParams.set("sort_order", "desc");
    url.searchParams.set("limit", "10");
    const response = await fetchImpl(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`fred_api_http_${response.status}`);
    const body = await response.json() as { observations?: Array<{ date?: unknown; value?: unknown }> };
    const observation = body.observations?.find((item) => typeof item.date === "string" && Number.isFinite(Number(item.value)));
    return { value: observation ? Number(observation.value) : null, date: observation && typeof observation.date === "string" ? observation.date : null };
  }

  const [fred, frankfurter] = await Promise.allSettled([
    Promise.all([
      fetchFredSeries("FEDFUNDS"),
      fetchFredSeries("DGS10"),
    ]).then(([fedFunds, tenYear]) => {
      if (fedFunds.value === null || tenYear.value === null) throw new Error("fred_incomplete_macro_snapshot");
      return { fedFunds, tenYear };
    }),
    fetchImpl(FRANKFURTER_URL, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(25_000) }).then(async (response) => {
      if (!response.ok) throw new Error(`frankfurter_http_${response.status}`);
      const body = await response.json() as { date?: unknown; base?: unknown; rates?: unknown };
      const rates = body.rates && typeof body.rates === "object" && !Array.isArray(body.rates) ? Object.fromEntries(Object.entries(body.rates).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))) : {};
      if (body.base !== "USD" || Object.keys(rates).length < 3) throw new Error("frankfurter_incomplete_fx_snapshot");
      return { date: typeof body.date === "string" ? body.date : null, rates };
    }),
  ]);
  const fredSourceUrls = fredApiKey
    ? ["https://fred.stlouisfed.org/series/FEDFUNDS", "https://fred.stlouisfed.org/series/DGS10"]
    : [FRED_FEDFUNDS_URL, FRED_DGS10_URL];
  const context: MacroContext = {
    checkedAt: now.toISOString(),
    fred: fred.status === "fulfilled"
      ? { status: "connected", sourceUrls: fredSourceUrls, fedFundsRate: fred.value.fedFunds.value, tenYearYield: fred.value.tenYear.value, latestObservationDate: fred.value.tenYear.date ?? fred.value.fedFunds.date, error: null }
      : { status: "failed", sourceUrls: fredSourceUrls, fedFundsRate: null, tenYearYield: null, latestObservationDate: null, error: fred.reason instanceof Error ? fred.reason.message : "fred_failed" },
    frankfurter: frankfurter.status === "fulfilled"
      ? { status: "connected", sourceUrl: FRANKFURTER_URL, date: frankfurter.value.date, rates: frankfurter.value.rates, error: null }
      : { status: "failed", sourceUrl: FRANKFURTER_URL, date: null, rates: {}, error: frankfurter.reason instanceof Error ? frankfurter.reason.message : "frankfurter_failed" },
  };
  branchLabCache.__swingUpBranchMacroContext = context;
  return context;
}

function providerConfiguration() {
  const has = (name: string) => Boolean(process.env[name]?.trim());
  const coinGeckoDemoConfigured = has("COINGECKO_DEMO_API_KEY") || has("COINGECKO_API_KEY");
  const providers = {
    openAi: { variable: "OPENAI_API_KEY", keyRequired: true, configured: has("OPENAI_API_KEY") },
    coinGecko: { variable: "COINGECKO_DEMO_API_KEY", legacyVariable: "COINGECKO_API_KEY", keyRequired: false, configured: coinGeckoDemoConfigured, authentication: "demo_header_only", fallback: "keyless_public_low_volume" },
    gdelt: { variable: null, keyRequired: false, configured: true },
    frankfurter: { variable: null, keyRequired: false, configured: true },
    fred: { variable: "FRED_API_KEY", keyRequired: false, configured: has("FRED_API_KEY"), fallback: "public_graph_csv_latest_only" },
    secEdgar: { variable: null, keyRequired: false, configured: true, authentication: "none", access: "free_public_api_with_declared_contact_header" },
    fmp: { variable: "FMP_API_KEY", keyRequired: true, configured: has("FMP_API_KEY") },
    marketaux: { variable: "MARKETAUX_API_KEY", keyRequired: true, configured: has("MARKETAUX_API_KEY") },
    alphaVantage: { variable: "ALPHA_VANTAGE_API_KEY", keyRequired: true, configured: has("ALPHA_VANTAGE_API_KEY") },
    openFda: { variable: "OPENFDA_API_KEY", keyRequired: false, configured: has("OPENFDA_API_KEY"), fallback: "keyless_public_lower_quota" },
  };
  const missingRequiredVariables = Object.values(providers)
    .filter((provider) => provider.keyRequired && !provider.configured && provider.variable)
    .map((provider) => provider.variable as string);
  const recommendedMissingVariables = [
    ...(!providers.fred.configured ? ["FRED_API_KEY"] : []),
    ...(!providers.openFda.configured ? ["OPENFDA_API_KEY"] : []),
  ];
  return { providers, missingRequiredVariables, recommendedMissingVariables, secretsRedacted: true };
}

async function auditJsonProvider(params: {
  name: string;
  url: URL;
  fetchImpl: typeof fetch;
  headers?: Record<string, string>;
  configured: boolean;
  configurationRequired: boolean;
}) {
  if (params.configurationRequired && !params.configured) return { status: "missing_required_variable", ok: false, recordsChecked: 0, rateLimited: false };
  try {
    const response = await params.fetchImpl(params.url, {
      headers: { Accept: "application/json", ...params.headers },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status === 429) return { status: "rate_limited", ok: false, recordsChecked: 0, rateLimited: true };
    if (!response.ok) return { status: `http_${response.status}`, ok: false, recordsChecked: 0, rateLimited: false };
    const body = await response.json() as Record<string, unknown> | unknown[];
    const record = !Array.isArray(body) ? body : null;
    const providerMessage = typeof record?.Note === "string" ? record.Note
      : typeof record?.Information === "string" ? record.Information
        : typeof record?.Error === "string" ? record.Error
          : typeof record?.["Error Message"] === "string" ? record["Error Message"]
            : null;
    if (providerMessage) {
      const rateLimited = /limit|frequency|quota|calls per day/i.test(providerMessage);
      return { status: rateLimited ? "rate_limited" : "provider_error", ok: false, recordsChecked: 0, rateLimited };
    }
    const nestedRows = record && Array.isArray(record.data) ? record.data
      : record && Array.isArray(record.results) ? record.results
        : record && Array.isArray(record.feed) ? record.feed
          : [];
    const secRecent = record && record.filings && typeof record.filings === "object" && !Array.isArray(record.filings)
      ? (record.filings as Record<string, unknown>).recent
      : null;
    const secRecentCount = secRecent && typeof secRecent === "object" && !Array.isArray(secRecent)
      ? Math.max(0, ...Object.values(secRecent).filter(Array.isArray).map((values) => values.length))
      : 0;
    const recordsChecked = Array.isArray(body) ? body.length : nestedRows.length || secRecentCount || 1;
    return { status: "connected", ok: true, recordsChecked, rateLimited: false };
  } catch (error) {
    return { status: "failed", ok: false, recordsChecked: 0, rateLimited: false, error: error instanceof Error ? error.message.slice(0, 180) : `${params.name}_audit_failed` };
  }
}

async function supplementalSourceAudit(now: Date, fetchImpl: typeof fetch): Promise<SupplementalSourceAudit> {
  const cached = branchLabCache.__swingUpSupplementalSourceAudit;
  if (cached && now.getTime() - Date.parse(cached.checkedAt) < SUPPLEMENTAL_AUDIT_REFRESH_MS) return cached;
  const openFdaKey = process.env.OPENFDA_API_KEY?.trim() ?? "";
  const secUserAgent = "SwingUp/0.1 support@swingup.app";
  const urls = {
    secEdgar: new URL("https://data.sec.gov/submissions/CIK0001679788.json"),
    openFda: new URL("https://api.fda.gov/drug/enforcement.json"),
  };
  urls.openFda.searchParams.set("limit", "1");
  if (openFdaKey) urls.openFda.searchParams.set("api_key", openFdaKey);
  const settled = await Promise.allSettled([
    auditJsonProvider({ name: "sec_edgar", url: urls.secEdgar, fetchImpl, headers: { "user-agent": secUserAgent }, configured: true, configurationRequired: false }),
    auditJsonProvider({ name: "openfda", url: urls.openFda, fetchImpl, configured: true, configurationRequired: false }),
  ]);
  const value = (result: PromiseSettledResult<Record<string, unknown>>) => result.status === "fulfilled"
    ? result.value
    : { status: "failed", ok: false, recordsChecked: 0, rateLimited: false, error: result.reason instanceof Error ? result.reason.message.slice(0, 180) : "provider_audit_failed" };
  const audit: SupplementalSourceAudit = {
    checkedAt: now.toISOString(),
    performanceEvidence: false,
    databaseWrites: false,
    r2Writes: false,
    publishing: false,
    notifications: false,
    providers: {
      secEdgar: value(settled[0]),
      openFda: value(settled[1]),
    },
  };
  branchLabCache.__swingUpSupplementalSourceAudit = audit;
  return audit;
}

function parseNewsRss(xml: string, now: Date): NewsReceipt[] {
  return Array.from(xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)).flatMap(([item]) => {
    const title = tagValue(item, "title").slice(0, 240);
    const summary = tagValue(item, "description").slice(0, 500) || null;
    const url = tagValue(item, "link");
    const publisher = tagValue(item, "source").slice(0, 120);
    const publishedAt = validPublishedAt(tagValue(item, "pubDate"), now);
    if (!title || !url || !publisher || !publishedAt) return [];
    return [{ title, summary, url, publisher, publishedAt, ...catalystMetadata(title, summary), channel: "google_news_rss" as const, assetTickers: assetTickersForText(`${title} ${summary ?? ""}`) }];
  });
}

async function fetchMarket(fetchImpl: typeof fetch, now: Date) {
  const url = new URL(COINGECKO_URL);
  url.searchParams.set("ids", ASSETS.map((asset) => asset.id).join(","));
  url.searchParams.set("vs_currency", "usd");
  url.searchParams.set("price_change_percentage", "24h,7d");
  url.searchParams.set("sparkline", "false");
  url.searchParams.set("precision", "full");
  const coinGeckoKey = process.env.COINGECKO_DEMO_API_KEY?.trim() || process.env.COINGECKO_API_KEY?.trim();
  const response = await fetchImpl(url, { headers: { Accept: "application/json", ...(coinGeckoKey ? { "x-cg-demo-api-key": coinGeckoKey } : {}) }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new ExternalProviderError("coingecko", `coingecko_http_${response.status}`);
  const body = await response.json() as MarketRow[];
  if (!Array.isArray(body)) throw new ExternalProviderError("coingecko", "coingecko_invalid_market_payload");
  const byId = new Map(body.flatMap((row) => typeof row.id === "string" ? [[row.id, row] as const] : []));
  const rows = ASSETS.flatMap((asset): MarketCandidate[] => {
    const row = byId.get(asset.id);
    const price = number(row?.current_price);
    const change24h = number(row?.price_change_percentage_24h);
    const volume24h = number(row?.total_volume);
    const marketCap = number(row?.market_cap);
    const high24h = number(row?.high_24h);
    const low24h = number(row?.low_24h);
    const observedAt = typeof row?.last_updated === "string" ? new Date(row.last_updated) : now;
    const marketAgeMs = now.getTime() - observedAt.getTime();
    if (!price || change24h === null || !volume24h || !marketCap || !high24h || !low24h || Number.isNaN(observedAt.getTime()) || marketAgeMs < -5 * 60_000 || marketAgeMs > MARKET_MAX_AGE_MS) return [];
    return [{
      ...asset,
      price,
      change24h,
      change7d: number(row?.price_change_percentage_7d_in_currency),
      volume24h,
      marketCap,
      fullyDilutedValuation: number(row?.fully_diluted_valuation),
      circulatingSupply: number(row?.circulating_supply),
      totalSupply: number(row?.total_supply),
      maxSupply: number(row?.max_supply),
      high24h,
      low24h,
      athChangePercentage: number(row?.ath_change_percentage),
      observedAt: observedAt.toISOString(),
    }];
  });
  if (rows.length < 5) throw new ExternalProviderError("coingecko", "coingecko_incomplete_market_snapshot");
  return { rows, sourceUrl: url.toString() };
}

async function fetchEventMarketConfirmation(row: MarketCandidate, alignedReceipts: NewsReceipt[], fetchImpl: typeof fetch, now: Date): Promise<EventMarketConfirmation> {
  const anchor = [...alignedReceipts].sort((left, right) => Date.parse(left.publishedAt) - Date.parse(right.publishedAt))[0];
  const eventObservedAt = anchor?.publishedAt ?? now.toISOString();
  const cacheKey = `${row.id}|${eventObservedAt}`;
  const cache = branchLabCache.__swingUpEventConfirmations ??= {};
  const cached = cache[cacheKey];
  if (cached?.eventPrice) {
    const postEventMovePercent = ((row.price - cached.eventPrice) / cached.eventPrice) * 100;
    const directionConfirmed = Math.abs(postEventMovePercent) >= 1 && Math.sign(postEventMovePercent) === Math.sign(row.change24h);
    return { ...cached, status: directionConfirmed ? "confirmed" : "not_confirmed", checkedAt: now.toISOString(), currentPrice: row.price, postEventMovePercent: Math.round(postEventMovePercent * 100) / 100, error: null, cached: true };
  }
  const url = new URL(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(row.id)}/market_chart/range`);
  url.searchParams.set("vs_currency", "usd");
  url.searchParams.set("from", `${Math.floor((Date.parse(eventObservedAt) - 30 * 60_000) / 1000)}`);
  url.searchParams.set("to", `${Math.floor(now.getTime() / 1000)}`);
  const coinGeckoKey = process.env.COINGECKO_DEMO_API_KEY?.trim() || process.env.COINGECKO_API_KEY?.trim();
  const base: EventMarketConfirmation = { status: "unavailable", eventObservedAt, checkedAt: now.toISOString(), eventPrice: null, currentPrice: row.price, postEventMovePercent: null, sourceUrl: url.toString(), error: null, cached: false };
  try {
    const response = await fetchImpl(url, { headers: { Accept: "application/json", ...(coinGeckoKey ? { "x-cg-demo-api-key": coinGeckoKey } : {}) }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      const failed = { ...base, error: `coingecko_event_range_http_${response.status}` };
      cache[cacheKey] = failed;
      return failed;
    }
    const body = await response.json() as { prices?: unknown };
    const prices = Array.isArray(body.prices) ? body.prices.flatMap((point): Array<[number, number]> => Array.isArray(point) && typeof point[0] === "number" && typeof point[1] === "number" && Number.isFinite(point[0]) && Number.isFinite(point[1]) && point[1] > 0 ? [[point[0], point[1]]] : []) : [];
    if (!prices.length) {
      const failed = { ...base, error: "coingecko_event_range_empty" };
      cache[cacheKey] = failed;
      return failed;
    }
    const eventTime = Date.parse(eventObservedAt);
    const eventPoint = [...prices].sort((left, right) => Math.abs(left[0] - eventTime) - Math.abs(right[0] - eventTime))[0];
    const postEventMovePercent = ((row.price - eventPoint[1]) / eventPoint[1]) * 100;
    const directionConfirmed = Math.abs(postEventMovePercent) >= 1 && Math.sign(postEventMovePercent) === Math.sign(row.change24h);
    const result: EventMarketConfirmation = { ...base, status: directionConfirmed ? "confirmed" : "not_confirmed", eventPrice: eventPoint[1], postEventMovePercent: Math.round(postEventMovePercent * 100) / 100 };
    cache[cacheKey] = result;
    return result;
  } catch (error) {
    const failed = { ...base, error: error instanceof Error ? `coingecko_event_range_${error.name.toLowerCase()}` : "coingecko_event_range_failed" };
    cache[cacheKey] = failed;
    return failed;
  }
}

async function fetchGoogleNews(asset: CryptoAsset, fetchImpl: typeof fetch, now: Date) {
  const googleUrl = new URL(GOOGLE_NEWS_URL);
  googleUrl.searchParams.set("q", `(${asset.name} OR ${asset.ticker}) crypto when:2d`);
  googleUrl.searchParams.set("hl", "en-US");
  googleUrl.searchParams.set("gl", "US");
  googleUrl.searchParams.set("ceid", "US:en");
  const response = await fetchImpl(googleUrl, { headers: { Accept: "application/rss+xml, text/xml" }, cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`google_news_http_${response.status}`);
  return { receipts: parseNewsRss(await response.text(), now), sourceUrl: googleUrl.toString() };
}

async function fetchGdeltNews(assets: CryptoAsset[], fetchImpl: typeof fetch, now: Date) {
  const cached = providerResultFromCache("gdelt", now, GDELT_REFRESH_MS);
  if (cached) return cached;
  const gdeltUrl = new URL(GDELT_URL);
  gdeltUrl.searchParams.set("query", `(${assets.flatMap((asset) => [`"${asset.name}"`, `"${asset.ticker}"`]).join(" OR ")}) (crypto OR cryptocurrency)`);
  gdeltUrl.searchParams.set("mode", "ArtList");
  gdeltUrl.searchParams.set("format", "json");
  gdeltUrl.searchParams.set("timespan", "48h");
  gdeltUrl.searchParams.set("maxrecords", "100");
  gdeltUrl.searchParams.set("sort", "DateDesc");
  const sourceUrl = gdeltUrl.toString();
  let response: Response;
  let responseText = "";
  try {
    response = await fetchImpl(gdeltUrl, { headers: { Accept: "application/json", "user-agent": "SwingUpBranchLab/1.0" }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    responseText = await response.text();
  } catch (error) {
    return markProviderFailure({ channel: "gdelt", now, refreshMs: GDELT_REFRESH_MS, status: "temporarily_unavailable", error: error instanceof Error ? `gdelt_${error.name.toLowerCase()}` : "gdelt_request_failed", sourceUrl });
  }
  const responsePolicy = providerFailurePolicy({ httpStatus: response.status, bodyText: response.ok ? "" : responseText });
  if (responsePolicy.status === "rate_limited") {
    const retryAfter = response.headers.get("retry-after")?.trim() ?? "";
    const retrySeconds = Number(retryAfter);
    const retryDate = Date.parse(retryAfter);
    const providerDelayMs = Number.isFinite(retrySeconds) && retrySeconds >= 0 ? retrySeconds * 1000 : Number.isFinite(retryDate) ? Math.max(0, retryDate - now.getTime()) : 0;
    return markProviderFailure({ channel: "gdelt", now, refreshMs: GDELT_REFRESH_MS, status: "rate_limited", error: "gdelt_rate_limited", sourceUrl, minimumCooldownMs: Math.max(GDELT_REFRESH_MS, providerDelayMs) });
  }
  if (!response.ok) return markProviderFailure({ channel: "gdelt", now, refreshMs: GDELT_REFRESH_MS, status: responsePolicy.status, error: `gdelt_http_${response.status}`, sourceUrl, minimumCooldownMs: responsePolicy.minimumCooldownMs });
  let body: { articles?: Array<Record<string, unknown>> };
  try {
    body = JSON.parse(responseText) as { articles?: Array<Record<string, unknown>> };
  } catch {
    const malformedPolicy = providerFailurePolicy({ malformedPayload: true });
    return markProviderFailure({ channel: "gdelt", now, refreshMs: GDELT_REFRESH_MS, status: malformedPolicy.status, error: "gdelt_invalid_json", sourceUrl, minimumCooldownMs: malformedPolicy.minimumCooldownMs });
  }
  const structuredMessage = providerMessage(body);
  if (structuredMessage && /limit requests|rate.?limit|too many requests|please wait|quota/i.test(structuredMessage)) {
    return markProviderFailure({ channel: "gdelt", now, refreshMs: GDELT_REFRESH_MS, status: "rate_limited", error: "gdelt_rate_limited", sourceUrl, minimumCooldownMs: GDELT_REFRESH_MS });
  }
  const receipts = (Array.isArray(body.articles) ? body.articles : []).flatMap((article): NewsReceipt[] => {
    const title = typeof article.title === "string" ? article.title.trim().slice(0, 240) : "";
    const articleUrl = typeof article.url === "string" ? article.url.trim() : "";
    const domain = typeof article.domain === "string" ? article.domain.trim().toLowerCase() : "";
    const seenDate = typeof article.seendate === "string" ? article.seendate.trim() : "";
    const normalizedDate = /^\d{8}T\d{6}Z$/.test(seenDate) ? `${seenDate.slice(0, 4)}-${seenDate.slice(4, 6)}-${seenDate.slice(6, 8)}T${seenDate.slice(9, 11)}:${seenDate.slice(11, 13)}:${seenDate.slice(13, 15)}Z` : seenDate;
    const publishedAt = validPublishedAt(normalizedDate, now);
    let publisher = domain;
    if (!publisher && articleUrl) {
      try { publisher = new URL(articleUrl).hostname.replace(/^www\./, ""); } catch {}
    }
    if (!title || !articleUrl || !publisher || !publishedAt) return [];
    return [{ title, summary: null, url: articleUrl, publisher, publishedAt, ...catalystMetadata(title), channel: "gdelt", assetTickers: assetTickersForText(title) }];
  });
  const snapshot: NewsSnapshot = {
    checkedAt: now.toISOString(),
    receipts: uniqueReceipts(receipts),
    sourceUrl,
  };
  return markProviderSuccess("gdelt", snapshot);
}

function unconfiguredProvider(sourceUrl: string): NewsProviderResult {
  return { receipts: [], sourceUrl, status: "not_configured", error: null, checkedAt: null, nextRetryAt: null, cached: false };
}

async function fetchMarketauxNews(fetchImpl: typeof fetch, now: Date): Promise<NewsProviderResult> {
  const key = process.env.MARKETAUX_API_KEY?.trim();
  if (!key) return unconfiguredProvider(MARKETAUX_URL);
  const cached = providerResultFromCache("marketaux", now, MARKETAUX_REFRESH_MS);
  if (cached) return cached;
  const url = new URL(MARKETAUX_URL);
  url.searchParams.set("api_token", key);
  url.searchParams.set("search", "crypto|cryptocurrency|bitcoin|ethereum|solana");
  url.searchParams.set("language", "en");
  url.searchParams.set("filter_entities", "true");
  url.searchParams.set("limit", "3");
  const sourceUrl = `${MARKETAUX_URL}?search=crypto&language=en&limit=3`;
  try {
    const response = await fetchImpl(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
    const body = await response.json().catch(() => null) as { data?: Array<Record<string, unknown>> } | Record<string, unknown> | null;
    const message = providerMessage(body);
    if (response.status === 429 || (message && /limit|quota|frequency/i.test(message))) return markProviderFailure({ channel: "marketaux", now, refreshMs: MARKETAUX_REFRESH_MS, status: "rate_limited", error: "marketaux_rate_limited", sourceUrl });
    if (response.status === 401 || response.status === 402 || response.status === 403) return markProviderFailure({ channel: "marketaux", now, refreshMs: MARKETAUX_REFRESH_MS, status: "not_entitled", error: `marketaux_http_${response.status}`, sourceUrl, minimumCooldownMs: MAX_PROVIDER_COOLDOWN_MS });
    if (!response.ok || !body || !Array.isArray((body as { data?: unknown }).data)) return markProviderFailure({ channel: "marketaux", now, refreshMs: MARKETAUX_REFRESH_MS, status: response.status >= 500 ? "temporarily_unavailable" : "failed", error: message ? "marketaux_provider_error" : `marketaux_http_${response.status}`, sourceUrl });
    const receipts = ((body as { data: Array<Record<string, unknown>> }).data).flatMap((article): NewsReceipt[] => {
      const title = typeof article.title === "string" ? article.title.trim().slice(0, 240) : "";
      const summary = typeof article.description === "string" ? article.description.trim().slice(0, 500) || null : null;
      const articleUrl = typeof article.url === "string" ? article.url.trim() : "";
      const publisher = typeof article.source === "string" ? article.source.trim().slice(0, 120) : "";
      const publishedAt = validPublishedAt(article.published_at, now);
      if (!title || !articleUrl || !publisher || !publishedAt) return [];
      const entityTickers = Array.isArray(article.entities) ? article.entities.flatMap((entity) => {
        if (!entity || typeof entity !== "object" || Array.isArray(entity)) return [];
        const entityRecord = entity as Record<string, unknown>;
        const entityType = typeof entityRecord.type === "string" ? entityRecord.type : typeof entityRecord.instrument_type === "string" ? entityRecord.instrument_type : "";
        if (entityType && !/crypto|currency|coin|token/i.test(entityType)) return [];
        const symbol = normalizeProviderCryptoSymbol(entityRecord.symbol);
        return symbol && ASSETS.some((asset) => asset.ticker === symbol) ? [symbol] : [];
      }) : [];
      return [{ title, summary, url: articleUrl, publisher, publishedAt, ...catalystMetadata(title, summary), channel: "marketaux", assetTickers: [...new Set([...entityTickers, ...assetTickersForText(`${title} ${summary ?? ""}`)])] }];
    });
    return markProviderSuccess("marketaux", { checkedAt: now.toISOString(), receipts: uniqueReceipts(receipts), sourceUrl });
  } catch (error) {
    return markProviderFailure({ channel: "marketaux", now, refreshMs: MARKETAUX_REFRESH_MS, status: "temporarily_unavailable", error: error instanceof Error ? `marketaux_${error.name.toLowerCase()}` : "marketaux_request_failed", sourceUrl });
  }
}

function alphaVantageDate(value: unknown) {
  if (typeof value !== "string") return null;
  const compact = value.trim();
  if (!/^\d{8}T\d{6}$/.test(compact)) return compact;
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}T${compact.slice(9, 11)}:${compact.slice(11, 13)}:${compact.slice(13, 15)}Z`;
}

async function fetchAlphaVantageNews(fetchImpl: typeof fetch, now: Date): Promise<NewsProviderResult> {
  const key = process.env.ALPHA_VANTAGE_API_KEY?.trim();
  if (!key) return unconfiguredProvider(ALPHA_VANTAGE_URL);
  const cached = providerResultFromCache("alpha_vantage", now, ALPHA_VANTAGE_REFRESH_MS);
  if (cached) return cached;
  const url = new URL(ALPHA_VANTAGE_URL);
  url.searchParams.set("function", "NEWS_SENTIMENT");
  url.searchParams.set("topics", "blockchain");
  url.searchParams.set("sort", "LATEST");
  url.searchParams.set("limit", "50");
  url.searchParams.set("apikey", key);
  const sourceUrl = `${ALPHA_VANTAGE_URL}?function=NEWS_SENTIMENT&topics=blockchain&sort=LATEST&limit=50`;
  try {
    const response = await fetchImpl(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    const message = providerMessage(body);
    if (response.status === 429 || (message && /limit|quota|frequency|calls per day/i.test(message))) return markProviderFailure({ channel: "alpha_vantage", now, refreshMs: ALPHA_VANTAGE_REFRESH_MS, status: "rate_limited", error: "alpha_vantage_rate_limited", sourceUrl });
    if (response.status === 401 || response.status === 402 || response.status === 403) return markProviderFailure({ channel: "alpha_vantage", now, refreshMs: ALPHA_VANTAGE_REFRESH_MS, status: "not_entitled", error: `alpha_vantage_http_${response.status}`, sourceUrl, minimumCooldownMs: MAX_PROVIDER_COOLDOWN_MS });
    if (!response.ok || !body || !Array.isArray(body.feed)) return markProviderFailure({ channel: "alpha_vantage", now, refreshMs: ALPHA_VANTAGE_REFRESH_MS, status: response.status >= 500 ? "temporarily_unavailable" : "failed", error: message ? "alpha_vantage_provider_error" : `alpha_vantage_http_${response.status}`, sourceUrl });
    const receipts = (body.feed as Array<Record<string, unknown>>).flatMap((article): NewsReceipt[] => {
      const title = typeof article.title === "string" ? article.title.trim().slice(0, 240) : "";
      const summary = typeof article.summary === "string" ? article.summary.trim().slice(0, 500) || null : null;
      const articleUrl = typeof article.url === "string" ? article.url.trim() : "";
      const publisher = typeof article.source === "string" ? article.source.trim().slice(0, 120) : "";
      const publishedAt = validPublishedAt(alphaVantageDate(article.time_published), now);
      if (!title || !articleUrl || !publisher || !publishedAt) return [];
      const sentimentTickers = Array.isArray(article.ticker_sentiment) ? article.ticker_sentiment.flatMap((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
        const ticker = (entry as Record<string, unknown>).ticker;
        if (typeof ticker !== "string" || !/^CRYPTO:/i.test(ticker.trim())) return [];
        const symbol = normalizeProviderCryptoSymbol(ticker);
        return symbol && ASSETS.some((asset) => asset.ticker === symbol) ? [symbol] : [];
      }) : [];
      return [{ title, summary, url: articleUrl, publisher, publishedAt, ...catalystMetadata(title, summary), channel: "alpha_vantage", assetTickers: [...new Set([...sentimentTickers, ...assetTickersForText(`${title} ${summary ?? ""}`)])] }];
    });
    return markProviderSuccess("alpha_vantage", { checkedAt: now.toISOString(), receipts: uniqueReceipts(receipts), sourceUrl });
  } catch (error) {
    return markProviderFailure({ channel: "alpha_vantage", now, refreshMs: ALPHA_VANTAGE_REFRESH_MS, status: "temporarily_unavailable", error: error instanceof Error ? `alpha_vantage_${error.name.toLowerCase()}` : "alpha_vantage_request_failed", sourceUrl });
  }
}

async function fetchFmpCryptoNews(fetchImpl: typeof fetch, now: Date): Promise<NewsProviderResult> {
  const key = process.env.FMP_API_KEY?.trim();
  if (!key) return unconfiguredProvider(FMP_CRYPTO_NEWS_URL);
  const cached = providerResultFromCache("fmp_crypto_news", now, FMP_NEWS_REFRESH_MS);
  if (cached) return cached;
  const url = new URL(FMP_CRYPTO_NEWS_URL);
  url.searchParams.set("page", "0");
  url.searchParams.set("limit", "20");
  url.searchParams.set("apikey", key);
  const sourceUrl = `${FMP_CRYPTO_NEWS_URL}?page=0&limit=20`;
  try {
    const response = await fetchImpl(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
    const body = await response.json().catch(() => null) as unknown;
    const message = providerMessage(body);
    if (response.status === 429 || (message && /limit|quota|frequency/i.test(message))) return markProviderFailure({ channel: "fmp_crypto_news", now, refreshMs: FMP_NEWS_REFRESH_MS, status: "rate_limited", error: "fmp_rate_limited", sourceUrl });
    if (response.status === 401 || response.status === 402 || response.status === 403 || (message && /subscription|upgrade|not available/i.test(message))) return markProviderFailure({ channel: "fmp_crypto_news", now, refreshMs: FMP_NEWS_REFRESH_MS, status: "not_entitled", error: `fmp_http_${response.status}`, sourceUrl, minimumCooldownMs: MAX_PROVIDER_COOLDOWN_MS });
    if (!response.ok || !Array.isArray(body)) return markProviderFailure({ channel: "fmp_crypto_news", now, refreshMs: FMP_NEWS_REFRESH_MS, status: response.status >= 500 ? "temporarily_unavailable" : "failed", error: message ? "fmp_provider_error" : `fmp_http_${response.status}`, sourceUrl });
    const receipts = (body as Array<Record<string, unknown>>).flatMap((article): NewsReceipt[] => {
      const title = typeof article.title === "string" ? article.title.trim().slice(0, 240) : "";
      const summaryValue = typeof article.text === "string" ? article.text : article.content;
      const summary = typeof summaryValue === "string" ? summaryValue.trim().slice(0, 500) || null : null;
      const articleUrl = typeof article.url === "string" ? article.url.trim() : "";
      const publisherValue = typeof article.site === "string" ? article.site : article.publisher;
      const publisher = typeof publisherValue === "string" ? publisherValue.trim().slice(0, 120) : "";
      const publishedAt = validPublishedAt(typeof article.publishedDate === "string" ? article.publishedDate : article.date, now);
      if (!title || !articleUrl || !publisher || !publishedAt) return [];
      const symbols = typeof article.symbol === "string" ? article.symbol.split(",").map(normalizeProviderCryptoSymbol).filter((value): value is string => Boolean(value && ASSETS.some((asset) => asset.ticker === value))) : [];
      return [{ title, summary, url: articleUrl, publisher, publishedAt, ...catalystMetadata(title, summary), channel: "fmp_crypto_news", assetTickers: [...new Set([...symbols, ...assetTickersForText(`${title} ${summary ?? ""}`)])] }];
    });
    return markProviderSuccess("fmp_crypto_news", { checkedAt: now.toISOString(), receipts: uniqueReceipts(receipts), sourceUrl });
  } catch (error) {
    return markProviderFailure({ channel: "fmp_crypto_news", now, refreshMs: FMP_NEWS_REFRESH_MS, status: "temporarily_unavailable", error: error instanceof Error ? `fmp_${error.name.toLowerCase()}` : "fmp_request_failed", sourceUrl });
  }
}

function receiptMatchesAsset(receipt: NewsReceipt, asset: CryptoAsset) {
  if (receipt.assetTickers.includes(asset.ticker)) return true;
  return matchesAssetText(`${receipt.title} ${receipt.summary ?? ""}`, { name: asset.name, ticker: asset.ticker, aliases: asset.id === "ripple" ? ["Ripple"] : asset.id === "binancecoin" ? ["Binance Coin", "BNB Chain"] : [] });
}

function catalystProximateToAsset(receipt: NewsReceipt, asset: CryptoAsset) {
  if (!receipt.assetTickers.includes(asset.ticker)) return false;
  if (receipt.assetTickers.length === 1) return true;
  const text = `${receipt.title} ${receipt.summary ?? ""}`.toLowerCase();
  const assetTerms = [asset.name, asset.ticker, ...(asset.id === "ripple" ? ["Ripple"] : []), ...(asset.id === "binancecoin" ? ["Binance Coin", "BNB Chain"] : [])].map((value) => value.toLowerCase());
  const assetPositions = assetTerms.flatMap((term) => {
    const positions: number[] = [];
    for (let index = text.indexOf(term); index >= 0; index = text.indexOf(term, index + term.length)) positions.push(index);
    return positions;
  });
  const catalystPositions = receipt.catalystKeywords.flatMap((keyword) => {
    const positions: number[] = [];
    for (let index = text.indexOf(keyword); index >= 0; index = text.indexOf(keyword, index + keyword.length)) positions.push(index);
    return positions;
  });
  return assetPositions.some((assetPosition) => catalystPositions.some((catalystPosition) => Math.abs(assetPosition - catalystPosition) <= 180));
}

const REGULATOR_PUBLISHER_PATTERN = /\b(u\.?s\.? securities and exchange commission|securities and exchange commission|sec|commodity futures trading commission|cftc|department of justice|doj|federal reserve)\b/i;
const EXCHANGE_PUBLISHER_PATTERN = /\b(coinbase|binance|kraken|okx|bybit|gemini|bitstamp|crypto\.com)\b/i;
const REGULATOR_DOMAINS = ["sec.gov", "cftc.gov", "justice.gov", "federalreserve.gov"];
const EXCHANGE_DOMAINS = ["coinbase.com", "binance.com", "kraken.com", "okx.com", "bybit.com", "gemini.com", "bitstamp.net", "crypto.com"];
const PROJECT_DOMAINS: Record<string, string[]> = {
  bitcoin: ["bitcoin.org"], ethereum: ["ethereum.org"], solana: ["solana.com"], ripple: ["ripple.com", "xrpl.org"],
  binancecoin: ["bnbchain.org"], cardano: ["cardano.org"], dogecoin: ["dogecoin.com"], chainlink: ["chain.link"],
  "avalanche-2": ["avax.network"], sui: ["sui.io"],
};
const OFFICIAL_REGULATORY_KEYWORDS = new Set(["approval", "approved", "etf approval", "spot etf approval", "criminal charges", "sec charges", "charged with", "ban", "banned", "ban lifted", "rejection", "rejected", "approval denied", "approval rejected", "seizure", "crackdown"]);
const OFFICIAL_EXCHANGE_KEYWORDS = new Set(["listing", "delisting", "delisting reversed"]);

function receiptHostname(receipt: NewsReceipt) {
  try { return new URL(receipt.url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
}

function domainMatches(hostname: string, domains: string[]) {
  return domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

function officialClaimProof(receipt: NewsReceipt, asset: CryptoAsset, alignedKeywords: string[]) {
  const hostname = receiptHostname(receipt);
  const publisher = receipt.publisher;
  if (alignedKeywords.some((keyword) => OFFICIAL_REGULATORY_KEYWORDS.has(keyword))) return REGULATOR_PUBLISHER_PATTERN.test(publisher) || domainMatches(hostname, REGULATOR_DOMAINS);
  if (alignedKeywords.some((keyword) => OFFICIAL_EXCHANGE_KEYWORDS.has(keyword))) return EXCHANGE_PUBLISHER_PATTERN.test(publisher) || domainMatches(hostname, EXCHANGE_DOMAINS);
  return domainMatches(hostname, PROJECT_DOMAINS[asset.id] ?? []) || EXCHANGE_PUBLISHER_PATTERN.test(publisher) || domainMatches(hostname, EXCHANGE_DOMAINS);
}

function marketSentiment(rows: MarketCandidate[], now: Date, macro: MacroContext) {
  const average = rows.reduce((sum, row) => sum + row.change24h, 0) / rows.length;
  const support = clamp(50 + average * 4);
  const macroAvailable = macro.fred.status === "connected" && macro.fred.fedFundsRate !== null && macro.fred.tenYearYield !== null;
  const macroPressure = macroAvailable ? (macro.fred.fedFundsRate! > 4.5 ? 15 : 0) + (macro.fred.tenYearYield! > 4.5 ? 15 : 0) : 35;
  const macroSupport = macroAvailable ? clamp(75 - macroPressure) : 0;
  const riskOff = (average <= -5 ? 35 : average <= -2 ? 20 : average >= 2 ? 5 : 12) + macroPressure;
  return buildMarketSentimentImpact({
    overallMarketMood: average >= 2 ? "risk_on" : average <= -2 ? "risk_off" : "mixed",
    macroRiskLevel: macroPressure >= 30 || average <= -5 ? "high" : macroPressure >= 15 || average <= -2 ? "medium" : "low",
    sentimentSupportScore: support,
    macroSupportScore: macroSupport,
    profitPotentialAdjustment: average >= 2 ? 3 : average <= -2 ? -4 : 0,
    confidenceAdjustment: 0,
    riskOffPenalty: riskOff,
    createdAt: now,
  });
}

function scoreCandidate(row: MarketCandidate, receipts: NewsReceipt[], sentiment: ReturnType<typeof marketSentiment>) {
  const observedAtMs = Date.parse(row.observedAt);
  const evidenceReceipts = receipts.filter((receipt) => {
    const ageMs = observedAtMs - Date.parse(receipt.publishedAt);
    return ageMs >= -5 * 60_000 && ageMs <= SERIOUS_EVENT_MAX_AGE_MS;
  });
  const publishers = new Set(evidenceReceipts.map((receipt) => receipt.publisher.toLowerCase()));
  const channels = new Set(evidenceReceipts.map((receipt) => receipt.channel));
  const direction: Exclude<CatalystDirection, "neutral"> = row.change24h >= 0 ? "upside" : "downside";
  const alignedReceipts = evidenceReceipts.filter((receipt) => receipt.catalystDirection === direction && receipt.catalystKeywords.length > 0 && catalystProximateToAsset(receipt, row));
  const contradictoryReceipts = evidenceReceipts.filter((receipt) => receipt.catalystDirection !== "neutral" && receipt.catalystDirection !== direction && catalystProximateToAsset(receipt, row));
  const alignedPublishers = new Set(alignedReceipts.map((receipt) => receipt.publisher.toLowerCase()));
  const alignedChannels = new Set(alignedReceipts.map((receipt) => receipt.channel));
  const alignedKeywords = [...new Set(alignedReceipts.flatMap((receipt) => receipt.catalystKeywords))];
  const regulatoryProofRequired = alignedKeywords.some((keyword) => OFFICIAL_REGULATORY_KEYWORDS.has(keyword));
  const exchangeProofRequired = alignedKeywords.some((keyword) => OFFICIAL_EXCHANGE_KEYWORDS.has(keyword));
  const regulatoryProofFound = !regulatoryProofRequired || alignedReceipts.some((receipt) => receipt.catalystKeywords.some((keyword) => OFFICIAL_REGULATORY_KEYWORDS.has(keyword)) && officialClaimProof(receipt, row, receipt.catalystKeywords));
  const exchangeProofFound = !exchangeProofRequired || alignedReceipts.some((receipt) => receipt.catalystKeywords.some((keyword) => OFFICIAL_EXCHANGE_KEYWORDS.has(keyword)) && officialClaimProof(receipt, row, receipt.catalystKeywords));
  const officialProofRequired = regulatoryProofRequired || exchangeProofRequired;
  const officialProofFound = regulatoryProofFound && exchangeProofFound;
  const officialReceiptCount = alignedReceipts.filter((receipt) => officialClaimProof(receipt, row, receipt.catalystKeywords)).length;
  const keywordCount = alignedKeywords.length;
  const catalystStrength = clamp(25 + keywordCount * 11 + Math.min(28, alignedReceipts.length * 7) + Math.min(12, Math.abs(row.change24h) * 2) - contradictoryReceipts.length * 5);
  const volumeToMarketCap = row.volume24h / row.marketCap;
  const intradayRangePercent = ((row.high24h - row.low24h) / row.price) * 100;
  const priceVolume = clamp(28 + Math.abs(row.change24h) * 7 + Math.min(32, volumeToMarketCap * 180) + (row.change7d !== null && Math.sign(row.change7d) === Math.sign(row.change24h) ? 8 : 0));
  const sourceQuality = officialProofFound && officialReceiptCount > 0 && channels.size >= 2 && publishers.size >= 3 ? "confirmed" as const : channels.size >= 3 && publishers.size >= 4 ? "high" as const : channels.size >= 2 && publishers.size >= 3 ? "medium" as const : "low" as const;
  const expectedMove = Math.max(4, Math.min(25, Math.abs(row.change24h) + intradayRangePercent * 0.75));
  const supplyRatios = [
    row.fullyDilutedValuation && row.marketCap ? row.fullyDilutedValuation / row.marketCap : null,
    row.totalSupply && row.circulatingSupply ? row.totalSupply / row.circulatingSupply : null,
    row.maxSupply && row.circulatingSupply ? row.maxSupply / row.circulatingSupply : null,
  ].filter((value): value is number => value !== null && Number.isFinite(value) && value >= 1);
  const supplyExpansionRatio = supplyRatios.length ? Math.max(...supplyRatios) : null;
  const dilutionRisk = supplyExpansionRatio === null ? 100 : clamp((supplyExpansionRatio - 1) * 55);
  const marketStructureRisk = clamp(intradayRangePercent * 5 + Math.abs(row.change7d ?? row.change24h) * 1.5 + Math.max(0, volumeToMarketCap < 0.015 ? 30 : 0));
  const liquidityRisk = clamp(55 - volumeToMarketCap * 180);
  const inputProvenance = {
    catalystStrengthScore: `live_direction_aligned_news_${alignedChannels.size}_channels_${alignedPublishers.size}_publishers_${keywordCount}_catalysts`,
    priceMovePercent: `live_coingecko_absolute_24h_${row.observedAt}`,
    sourceQuality: `live_matching_news_${channels.size}_channels_${publishers.size}_publishers`,
    independentReceipts: `live_coingecko_plus_${publishers.size}_independent_news_publishers`,
    priceVolumeConfirmationScore: `live_coingecko_price_volume_market_cap_range_${row.observedAt}`,
    macroSupportScore: "live_fred_rates_and_coingecko_market_breadth",
    balanceSheetRiskScore: `live_coingecko_token_market_structure_range_turnover_${row.observedAt}`,
    dilutionRiskScore: supplyExpansionRatio === null ? `live_coingecko_supply_metrics_missing_conservative_block_${row.observedAt}` : `live_coingecko_fdv_supply_expansion_ratio_${supplyExpansionRatio.toFixed(3)}_${row.observedAt}`,
    liquidityRiskScore: `live_coingecko_turnover_ratio_${volumeToMarketCap.toFixed(6)}_${row.observedAt}`,
    confirmedEventSource: officialProofFound && officialReceiptCount > 0 ? `live_official_event_receipts_${officialReceiptCount}` : "live_news_no_official_event_receipt_zero_credit",
  };
  const score = scoreSwingUpAlert({
    ticker: row.ticker,
    company: row.name,
    expectedUpsidePercent: expectedMove,
    expectedDownsidePercent: Math.max(6, Math.min(30, expectedMove * 1.1)),
    historicalPatternMatch: "no_clear_match",
    valuationSupportScore: clamp(78 - dilutionRisk * 0.35 - marketStructureRisk * 0.2),
    catalystStrengthScore: catalystStrength,
    priceMovePercent: Math.abs(row.change24h),
    sectorSupportScore: sentiment.sentimentSupportScore,
    macroSupportScore: sentiment.macroSupportScore,
    sourceQuality,
    independentReceipts: publishers.size + 1,
    hasConfirmedFilingOrExchangeSource: officialProofFound && officialReceiptCount > 0,
    priceVolumeConfirmationScore: priceVolume,
    financialSupportScore: clamp(80 - marketStructureRisk * 0.35 - dilutionRisk * 0.2 + Math.min(20, volumeToMarketCap * 100)),
    verifiedRippleLinks: 0,
    contradictionCount: contradictoryReceipts.length,
    isRumour: false,
    overboughtRiskScore: direction === "upside" ? clamp(18 + Math.max(0, row.change24h) * 5 + Math.max(0, row.change7d ?? 0) * 1.5) : clamp(18 + Math.abs(Math.min(0, row.change24h)) * 3),
    balanceSheetRiskScore: marketStructureRisk,
    sourceRiskScore: sourceQuality === "confirmed" ? 8 : channels.size >= 3 && publishers.size >= 4 ? 12 : channels.size >= 2 && publishers.size >= 3 ? 25 : 70,
    liquidityRiskScore: liquidityRisk,
    dilutionRiskScore: dilutionRisk,
    inputProvenance,
    liveEvidenceOnly: true,
  }, sentiment);
  const actionStrengthScore = computeActionStrength({ catalystStrength, priceVolumeConfirmation: priceVolume, evidenceConfidence: score.evidenceConfidenceScore, absoluteMovePercent: Math.abs(row.change24h), alignedChannelCount: alignedChannels.size, alignedPublisherCount: alignedPublishers.size, alignedKeywordCount: keywordCount });
  return {
    score,
    direction,
    publishers: [...publishers],
    channels: [...channels],
    alignedReceipts,
    alignedPublishers: [...alignedPublishers],
    alignedChannels: [...alignedChannels],
    alignedKeywords,
    evidenceReceipts,
    officialProofRequired,
    officialProofFound,
    officialReceiptCount,
    contradictoryReceiptCount: contradictoryReceipts.length,
    keywordCount,
    catalystStrength,
    priceVolume,
    volumeToMarketCap,
    intradayRangePercent,
    supplyExpansionRatio,
    actionStrengthScore,
  };
}

function section(available: boolean, strength: EvidenceStrength, summary: string, items: Array<Record<string, unknown>>) {
  return { available, strength, summary, items };
}

function channelName(channel: NewsChannel) {
  if (channel === "google_news_rss") return "Google News RSS";
  if (channel === "gdelt") return "GDELT";
  if (channel === "marketaux") return "Marketaux";
  if (channel === "alpha_vantage") return "Alpha Vantage";
  return "FMP Crypto News";
}

function evidencePack(params: {
  row: MarketCandidate;
  receipts: NewsReceipt[];
  score: SwingUpScore;
  actionStrengthScore: number;
  direction: "upside" | "downside";
  alignedReceipts: NewsReceipt[];
  contradictoryReceiptCount: number;
  alignedKeywords: string[];
  marketSourceUrl: string;
  eventMarketConfirmation: EventMarketConfirmation;
  newsSources: Partial<Record<NewsChannel, NewsProviderResult>>;
  publishers: string[];
  volumeToMarketCap: number;
  supplyExpansionRatio: number | null;
  intradayRangePercent: number;
  macro: MacroContext;
  now: Date;
}): AiCommitteeEvidencePack {
  const { row, receipts, score, publishers, now } = params;
  const providerLinks = Object.values(params.newsSources).map((source) => source.sourceUrl).filter(Boolean);
  const links = [...new Set([params.marketSourceUrl, params.eventMarketConfirmation.sourceUrl, ...providerLinks, ...params.macro.fred.sourceUrls, params.macro.frankfurter.sourceUrl, ...receipts.map((receipt) => receipt.url)].filter(Boolean))];
  const alignedReceiptKeys = new Set(params.alignedReceipts.map((receipt) => `${receipt.publisher}|${receipt.title}|${receipt.publishedAt}`));
  const orderedReceipts = [...params.alignedReceipts, ...receipts.filter((receipt) => !alignedReceiptKeys.has(`${receipt.publisher}|${receipt.title}|${receipt.publishedAt}`))];
  const evidenceChannels = [...new Set(params.alignedReceipts.map((receipt) => receipt.channel))];
  const newsItems = orderedReceipts.map((receipt) => ({ source: receipt.publisher, discoveryChannel: receipt.channel, title: receipt.title, summary: receipt.summary, url: receipt.url, observedAt: receipt.publishedAt, ageHours: Math.max(0, (now.getTime() - Date.parse(receipt.publishedAt)) / 3_600_000), catalystKeywords: receipt.catalystKeywords, catalystDirection: receipt.catalystDirection, alignedWithMarketDirection: alignedReceiptKeys.has(`${receipt.publisher}|${receipt.title}|${receipt.publishedAt}`), officialClaimSource: officialClaimProof(receipt, row, receipt.catalystKeywords) }));
  const marketItem = {
    source: "CoinGecko",
    ticker: row.ticker,
    priceUsd: row.price,
    change24h: row.change24h,
    change7d: row.change7d,
    volume24h: row.volume24h,
    marketCap: row.marketCap,
    fullyDilutedValuation: row.fullyDilutedValuation,
    circulatingSupply: row.circulatingSupply,
    totalSupply: row.totalSupply,
    maxSupply: row.maxSupply,
    supplyExpansionRatio: params.supplyExpansionRatio,
    high24h: row.high24h,
    low24h: row.low24h,
    intradayRangePercent: params.intradayRangePercent,
    athChangePercentage: row.athChangePercentage,
    volumeToMarketCap: params.volumeToMarketCap,
    eventMarketConfirmation: params.eventMarketConfirmation,
    observedAt: row.observedAt,
    url: params.marketSourceUrl,
  };
  const newsSourceHealth = Object.entries(params.newsSources).map(([channel, source]) => ({
    source: channelName(channel as NewsChannel),
    status: source.status,
    checkedAt: source.checkedAt ?? now.toISOString(),
    lastSuccessAt: source.receipts.length > 0 ? source.checkedAt : null,
    responseTimeMs: null,
    problem: source.status === "connected" ? null : source.error,
    notes: source.cached ? "Real provider response reused within its quota-safe refresh window." : "Real read-only provider request; availability alone did not increase the score.",
  }));
  return {
    candidateAlertId: `branch-lab-${crypto.randomUUID()}`,
    rawSignalIds: [], ticker: row.ticker, company: `${row.name} digital asset`, actionLabel: params.direction === "upside" ? "Review upside opportunity" : "Review downside threat",
    eventHeadline: params.alignedReceipts[0]?.title ?? `${row.ticker} live market catalyst scan`,
    whatHappened: `${row.name} moved ${row.change24h.toFixed(2)}% in 24 hours (${params.direction}). ${params.alignedReceipts.length} direction-aligned, <=12-hour receipts across ${evidenceChannels.length} live discovery channels were checked; ${params.contradictoryReceiptCount} contradictory receipts were kept visible. Direction-aligned catalysts: ${params.alignedKeywords.join(", ")}.`,
    sourceNames: [...new Set(["CoinGecko", ...evidenceChannels.map(channelName), "FRED", "Frankfurter FX", ...publishers])], sourceLinks: links,
    sourceFreshness: [
      { source: "CoinGecko", collectedAt: row.observedAt, ageHours: Math.max(0, (now.getTime() - Date.parse(row.observedAt)) / 3_600_000), freshness: now.getTime() - Date.parse(row.observedAt) <= MARKET_MAX_AGE_MS ? "fresh" : "stale" },
      ...orderedReceipts.map((receipt) => {
        const ageHours = Math.max(0, (now.getTime() - Date.parse(receipt.publishedAt)) / 3_600_000);
        return { source: receipt.publisher, collectedAt: receipt.publishedAt, ageHours, freshness: ageHours <= 12 ? "fresh" as const : ageHours <= 48 ? "stale" as const : "old" as const };
      }),
    ],
    sourceHealth: [{ source: "CoinGecko", status: "connected", checkedAt: now.toISOString(), lastSuccessAt: now.toISOString(), responseTimeMs: null, problem: null, notes: "Live read-only token price, volume, supply, and market-structure evidence." }, ...newsSourceHealth, { source: "FRED", status: params.macro.fred.status, checkedAt: params.macro.checkedAt, lastSuccessAt: params.macro.fred.status === "connected" ? params.macro.checkedAt : null, responseTimeMs: null, problem: params.macro.fred.error, notes: "Live public macro context." }, { source: "Frankfurter FX", status: params.macro.frankfurter.status, checkedAt: params.macro.checkedAt, lastSuccessAt: params.macro.frankfurter.status === "connected" ? params.macro.checkedAt : null, responseTimeMs: null, problem: params.macro.frankfurter.error, notes: "Live public FX context." }],
    proofBundleSummary: { proofCount: links.length, proofTypes: ["news", "price_volume", "crypto_market"], uniquePublishers: publishers.length, liveOnly: true },
    filingEvidence: section(false, "missing", "Not applicable to a spot digital asset unless this specific event concerns an issuer, fund, or regulated entity filing.", []),
    newsEvidence: section(params.alignedReceipts.length >= 3, params.alignedReceipts.length >= 3 && evidenceChannels.length >= 2 ? "strong" : "medium", `${params.alignedReceipts.length} fresh aligned receipts from ${new Set(params.alignedReceipts.map((receipt) => receipt.publisher.toLowerCase())).size} origin publishers and ${evidenceChannels.length} discovery channels; ${params.contradictoryReceiptCount} contradictory receipts remain visible.`, newsItems),
    priceVolumeEvidence: section(params.eventMarketConfirmation.status === "confirmed", "strong", `Current price, 24-hour and 7-day moves, range, volume, market capitalization, and the ${params.eventMarketConfirmation.postEventMovePercent}% post-event move came directly from CoinGecko.`, [marketItem]),
    fundamentalsEvidence: section(true, "strong", "For this digital asset, live supply, fully diluted valuation, market cap, turnover, range, and liquidity are the applicable token market-structure evidence; company accounting metrics do not apply.", [marketItem]),
    macroEvidence: section(params.macro.fred.status === "connected" && params.macro.frankfurter.status === "connected", "strong", `Top-asset crypto sentiment is ${score.marketSentimentImpact.overallMarketMood}; FRED rates and Frankfurter FX context were checked from live public endpoints.`, [score.marketSentimentImpact, params.macro.fred, params.macro.frankfurter]),
    fdaRegulatoryEvidence: section(false, "missing", "Not applicable to this digital-asset event; relevant financial regulation is evaluated from matched event receipts.", []),
    cryptoFxEvidence: section(true, "strong", "Direct live digital-asset market evidence is available.", [marketItem]),
    finraShortPressureEvidence: section(false, "missing", "Not applicable to spot-token trading; no equity short-pressure claim is made.", []),
    wikidataRippleRelationships: section(false, "missing", "Optional ecosystem relationships are not asserted without direct event evidence.", []),
    historicalPatternMatch: section(false, "missing", "No historical-pattern claim is used to qualify this candidate.", []),
    previousSimilarOutcomes: section(false, "missing", "Forward outcome tracking is enabled, but no previous result is invented for this candidate.", []),
    score: { actionStrength: params.actionStrengthScore, direction: params.direction, alignedCatalysts: params.alignedKeywords, profitPotential: score.profitPotentialScore, evidenceConfidence: score.evidenceConfidenceScore, riskLevel: score.riskLevel, pricedInCheck: score.pricedInCheck, inputCompleteness: score.inputCompleteness, liveDataReady: score.liveDataReady, missingInputs: score.missingInputs, inputProvenance: score.inputProvenance, createdAt: now.toISOString(), persisted: false },
    currentRiskLabels: [`direction:${params.direction}`, `risk:${score.riskLevel}`, `priced_in:${score.pricedInCheck}`, ...(Math.abs(row.change24h) > 8 ? ["large_24h_move"] : [])],
    missingEvidence: [], dataFreshnessWarnings: [],
    compatibility: { callsOpenAi: false, publishes: false, sendsTelegram: false, writesDatabase: false },
  };
}

function candidateFingerprint(row: MarketCandidate, direction: "upside" | "downside", alignedKeywords: string[], alignedReceipts: NewsReceipt[]) {
  const anchor = [...alignedReceipts].sort((left, right) => Date.parse(left.publishedAt) - Date.parse(right.publishedAt) || canonicalEventIdentity(left).localeCompare(canonicalEventIdentity(right)))[0];
  return crypto.createHash("sha256").update(candidateFingerprintInput({ ticker: row.ticker, direction, alignedKeywords, eventIdentity: canonicalEventIdentity(anchor) })).digest("hex").slice(0, 20);
}

export async function runBranchSignalLab(input: {
  allowOpenAi?: boolean;
  fetchImpl?: typeof fetch;
  now?: Date;
  skipOpenAiCandidateFingerprints?: string[];
  beforeOpenAiCall?: (reservation: { candidateFingerprint: string; checkedAt: string; ticker: string; direction: "upside" | "downside" }) => Promise<boolean>;
  beforeProviderCall?: (request: BranchProviderCallRequest) => Promise<BranchProviderCallDecision>;
} = {}) {
  const now = input.now ?? new Date();
  const rawFetch = input.fetchImpl ?? fetch;
  const fetchImpl: typeof fetch = async (request, init) => {
    const quotaRequest = providerCallRequest(request, now);
    if (quotaRequest && input.beforeProviderCall) {
      const decision = await input.beforeProviderCall(quotaRequest);
      if (!decision.allowed) throw new ExternalProviderError(quotaRequest.provider, `${quotaRequest.provider}_${decision.reason}`);
    }
    return rawFetch(request, init);
  };
  const mode = "railway_branch_live_read_only";
  const startedAt = Date.now();
  try {
    const [market, macro, supplementalAudit] = await Promise.all([fetchMarket(fetchImpl, now), fetchMacroContext(fetchImpl, now), supplementalSourceAudit(now, fetchImpl)]);
    const sentiment = marketSentiment(market.rows, now, macro);
    const movers = [...market.rows].sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h)).slice(0, 5);
    const [googleResults, gdelt, marketaux, alphaVantage, fmpCryptoNews] = await Promise.all([
      Promise.all(movers.map((row) => fetchGoogleNews(row, fetchImpl, now)
        .then((result): NewsProviderResult => ({ ...result, status: "connected", error: null, checkedAt: now.toISOString(), nextRetryAt: null, cached: false }))
        .catch((error: unknown): NewsProviderResult => ({ receipts: [], sourceUrl: GOOGLE_NEWS_URL, status: "temporarily_unavailable", error: error instanceof Error ? error.message : "google_news_failed", checkedAt: now.toISOString(), nextRetryAt: null, cached: false })))),
      fetchGdeltNews(movers, fetchImpl, now),
      fetchMarketauxNews(fetchImpl, now),
      fetchAlphaVantageNews(fetchImpl, now),
      fetchFmpCryptoNews(fetchImpl, now),
    ]);
    const sharedNewsSources = { gdelt, marketaux, alpha_vantage: alphaVantage, fmp_crypto_news: fmpCryptoNews } as const;
    const sharedReceipts = Object.values(sharedNewsSources).flatMap((result) => result.receipts);
    const newsResults = movers.map((row, index) => {
      const google = googleResults[index];
      const receipts = selectBalancedReceipts([...google.receipts.filter((receipt) => receiptMatchesAsset(receipt, row)), ...sharedReceipts.filter((receipt) => receiptMatchesAsset(receipt, row))]);
      const newsSources: Partial<Record<NewsChannel, NewsProviderResult>> = { google_news_rss: google, ...sharedNewsSources };
      return { row, receipts, newsSources, errors: Object.values(newsSources).map((source) => source?.error).filter((value): value is string => Boolean(value)) };
    });
    const ranked = newsResults.map(({ row, receipts, newsSources, errors }) => {
      const scored = scoreCandidate(row, receipts, sentiment);
      const qualityScore = clamp(scored.actionStrengthScore * 0.55 + scored.score.evidenceConfidenceScore * 0.25 + scored.score.profitPotentialScore * 0.1 + Math.min(100, scored.publishers.length * 20) * 0.1);
      return { row, receipts, newsSources, newsErrors: errors, ...scored, qualityScore, eventMarketConfirmation: null as EventMarketConfirmation | null };
    }).sort((a, b) => b.qualityScore - a.qualityScore);
    const evidenceGateChecks = (candidate: (typeof ranked)[number]) => ({
      liveDataComplete: candidate.score.liveDataReady && candidate.score.inputCompleteness === 100,
      threeFreshOriginPublishers: candidate.publishers.length >= 3,
      twoFreshDiscoveryChannels: candidate.channels.length >= 2,
      threeDirectionAlignedOriginPublishers: candidate.alignedPublishers.length >= 3,
      twoDirectionAlignedDiscoveryChannels: candidate.alignedChannels.length >= 2,
      requiredOfficialProof: !candidate.officialProofRequired || candidate.officialProofFound,
      liveMacroContext: macro.fred.status === "connected" && macro.frankfurter.status === "connected",
      explicitCatalyst: candidate.keywordCount >= 1,
      materialTwentyFourHourMove: Math.abs(candidate.row.change24h) >= 2,
      evidenceConfidence: candidate.score.evidenceConfidenceScore >= 60,
      actionStrength: candidate.actionStrengthScore >= 60,
    });
    const meetsEvidenceGate = (candidate: (typeof ranked)[number]) => Object.values(evidenceGateChecks(candidate)).every(Boolean);
    const candidatesNeedingCausalCheck = ranked.filter(meetsEvidenceGate).slice(0, 2);
    const confirmations = await Promise.all(candidatesNeedingCausalCheck.map((candidate) => fetchEventMarketConfirmation(candidate.row, candidate.alignedReceipts, fetchImpl, now)));
    candidatesNeedingCausalCheck.forEach((candidate, index) => { candidate.eventMarketConfirmation = confirmations[index]; });
    const best = ranked.find((candidate) => meetsEvidenceGate(candidate) && candidate.eventMarketConfirmation?.status === "confirmed") ?? null;
    const providerDetails = {
      googleNewsRss: {
        status: googleResults.some((result) => result.status === "connected") ? "connected" : "temporarily_unavailable",
        checkedAt: now.toISOString(),
        assetsQueried: googleResults.length,
        assetsConnected: googleResults.filter((result) => result.status === "connected").length,
        realReceipts: googleResults.reduce((sum, result) => sum + result.receipts.length, 0),
      },
      gdelt: { status: gdelt.status, checkedAt: gdelt.checkedAt, nextRetryAt: gdelt.nextRetryAt, cached: gdelt.cached, realReceipts: gdelt.receipts.length, error: gdelt.error },
      marketaux: { status: marketaux.status, checkedAt: marketaux.checkedAt, nextRetryAt: marketaux.nextRetryAt, cached: marketaux.cached, realReceipts: marketaux.receipts.length, error: marketaux.error },
      alphaVantage: { status: alphaVantage.status, checkedAt: alphaVantage.checkedAt, nextRetryAt: alphaVantage.nextRetryAt, cached: alphaVantage.cached, realReceipts: alphaVantage.receipts.length, error: alphaVantage.error },
      fmpCryptoNews: { status: fmpCryptoNews.status, checkedAt: fmpCryptoNews.checkedAt, nextRetryAt: fmpCryptoNews.nextRetryAt, cached: fmpCryptoNews.cached, realReceipts: fmpCryptoNews.receipts.length, error: fmpCryptoNews.error },
      coinGeckoEventConfirmation: { candidatesChecked: confirmations.length, confirmed: confirmations.filter((confirmation) => confirmation.status === "confirmed").length, unavailable: confirmations.filter((confirmation) => confirmation.status === "unavailable").length },
    };
    const common = {
      ok: true, mode, checkedAt: now.toISOString(), durationMs: Date.now() - startedAt,
      sources: {
        coinGecko: "connected",
        googleNewsRss: providerDetails.googleNewsRss.status,
        gdelt: gdelt.status,
        marketaux: marketaux.status,
        alphaVantage: alphaVantage.status,
        fmpCryptoNews: fmpCryptoNews.status,
        fred: macro.fred.status,
        frankfurterFx: macro.frankfurter.status,
      },
      providerDetails,
      candidateFunnel: {
        marketAssetsChecked: market.rows.length,
        topMoversScanned: movers.length,
        candidatesWithFreshNews: ranked.filter((candidate) => candidate.evidenceReceipts.length > 0).length,
        candidatesWithAlignedCatalyst: ranked.filter((candidate) => candidate.alignedReceipts.length > 0).length,
        candidatesPassingEvidenceGate: candidatesNeedingCausalCheck.length,
        candidatesWithConfirmedPostEventMove: confirmations.filter((confirmation) => confirmation.status === "confirmed").length,
        committeeCandidates: best ? 1 : 0,
      },
      macroContext: macro,
      providerConfiguration: providerConfiguration(),
      supplementalSourceAudit: supplementalAudit,
      liveSourcePolicy: {
        performanceResultsRequireRealHttpResponses: true,
        fixtureOrMockPerformanceResultsAllowed: false,
        connectivityAloneAddsScore: false,
        minimumIndependentNewsChannels: 2,
        minimumUniquePublishers: 3,
        applicableDigitalAssetSources: ["CoinGecko", "Google News RSS", "GDELT", "Marketaux", "Alpha Vantage", "FMP Crypto News", "FRED", "Frankfurter FX"],
        supplementalProvidersAuditedButNotCountedAsCryptoPerformanceEvidence: ["SEC EDGAR", "openFDA"],
        nonApplicableIntegratedEars: ["FINRA short sale", "Wikidata relationship context", "Polygon equity feeds"],
        nonApplicableReason: "SEC EDGAR and openFDA remain active read-only ears, but may count only when their real records directly match the asset event. Corporate and healthcare connectivity never increases a crypto score by itself.",
      },
      assetsChecked: market.rows.length, candidatesChecked: ranked.length, databaseWrites: false, publishing: false, notifications: false,
      realProviderResponsesOnly: true,
      failureScope: "none",
      repairEligible: false,
      marketSnapshot: market.rows.map((row) => ({ ticker: row.ticker, price: row.price, change24h: Math.round(row.change24h * 100) / 100, change7d: row.change7d === null ? null : Math.round(row.change7d * 100) / 100, observedAt: row.observedAt })),
      rankedCandidates: ranked.map((candidate) => {
        const gateChecks = evidenceGateChecks(candidate);
        return { ticker: candidate.row.ticker, direction: candidate.direction, change24h: Math.round(candidate.row.change24h * 100) / 100, newsReceipts: candidate.receipts.length, freshEvidenceReceipts: candidate.evidenceReceipts.length, newsChannels: candidate.channels, uniquePublishers: candidate.publishers.length, alignedNewsChannels: candidate.alignedChannels, alignedPublishers: candidate.alignedPublishers.length, alignedCatalysts: candidate.alignedKeywords, contradictoryReceiptCount: candidate.contradictoryReceiptCount, officialProofRequired: candidate.officialProofRequired, officialProofFound: candidate.officialProofFound, officialReceiptCount: candidate.officialReceiptCount, eventMarketConfirmation: candidate.eventMarketConfirmation, inputCompleteness: candidate.score.inputCompleteness, actionStrengthScore: candidate.actionStrengthScore, profitPotentialScore: candidate.score.profitPotentialScore, evidenceConfidenceScore: candidate.score.evidenceConfidenceScore, suggestedAction: candidate.score.suggestedAction, qualityScore: candidate.qualityScore, evidenceGateChecks: gateChecks, evidenceGateFailures: Object.entries(gateChecks).filter(([, passed]) => !passed).map(([name]) => name), qualifiedForCommittee: candidate === best };
      }),
    };
    if (!best) {
      const unavailable = Object.entries(common.sources).filter(([, status]) => status !== "connected").map(([source, status]) => `${source}:${status}`);
      return { ...common, status: "no_qualified_signal", seriousSignalFound: false, openAiCalled: false, qualityScore: ranked[0]?.qualityScore ?? 0, blockers: ["No current asset had three direction-aligned origin publishers across two live news channels, fresh <=12-hour event evidence, required official proof, and a real post-event CoinGecko move in the same direction. Filters were not weakened.", ...(unavailable.length ? [`Provider limitations this cycle: ${unavailable.join(", ")}. Cached receipts, when shown, remain real and age-limited.`] : [])], technicalFailureFingerprint: null };
    }
    const fingerprint = candidateFingerprint(best.row, best.direction, best.alignedKeywords, best.alignedReceipts);
    const pack = evidencePack({ row: best.row, receipts: best.receipts, score: best.score, actionStrengthScore: best.actionStrengthScore, direction: best.direction, alignedReceipts: best.alignedReceipts, contradictoryReceiptCount: best.contradictoryReceiptCount, alignedKeywords: best.alignedKeywords, marketSourceUrl: market.sourceUrl, eventMarketConfirmation: best.eventMarketConfirmation!, newsSources: best.newsSources, publishers: best.publishers, volumeToMarketCap: best.volumeToMarketCap, supplyExpansionRatio: best.supplyExpansionRatio, intradayRangePercent: best.intradayRangePercent, macro, now });
    const provider = getAiCommitteeProviderStatus();
    const selectedCandidate = { ticker: best.row.ticker, company: best.row.name, price: best.row.price, change24h: best.row.change24h, change7d: best.row.change7d, direction: best.direction, evidenceFingerprint: fingerprint, actionStrengthScore: best.actionStrengthScore, alignedNewsChannels: best.alignedChannels, alignedPublishers: best.alignedPublishers, alignedCatalysts: best.alignedKeywords, officialProofRequired: best.officialProofRequired, officialProofFound: best.officialProofFound, officialReceiptCount: best.officialReceiptCount, eventMarketConfirmation: best.eventMarketConfirmation, newsReceipts: best.receipts, score: best.score };
    if (input.skipOpenAiCandidateFingerprints?.includes(fingerprint)) return { ...common, status: "qualified_candidate_already_reviewed", seriousSignalFound: false, openAiCalled: false, candidateFingerprint: fingerprint, qualityScore: best.qualityScore, selectedCandidate, committee: { configured: provider.configured, enabled: provider.enabled }, blockers: ["The same evidence was already reviewed recently, so OpenAI was not called again."], technicalFailureFingerprint: null };
    if (!input.allowOpenAi) return { ...common, status: "qualified_signal_openai_not_requested", seriousSignalFound: false, openAiCalled: false, candidateFingerprint: fingerprint, qualityScore: best.qualityScore, selectedCandidate, committee: { configured: provider.configured, enabled: provider.enabled }, blockers: ["The rolling OpenAI test budget has been reached; the candidate was retained without another paid review."], technicalFailureFingerprint: null };
    if (!provider.configured || !provider.enabled) return { ...common, ok: false, status: "configuration_blocker", seriousSignalFound: false, openAiCalled: false, candidateFingerprint: fingerprint, qualityScore: best.qualityScore, selectedCandidate, blockers: [provider.configured ? "AI committee is disabled." : "OPENAI_API_KEY is not available in this deployment."], technicalFailureFingerprint: provider.configured ? "ai_committee_disabled" : "openai_key_missing", failureScope: "configuration", repairEligible: false };
    if (input.beforeOpenAiCall && !await input.beforeOpenAiCall({ candidateFingerprint: fingerprint, checkedAt: now.toISOString(), ticker: best.row.ticker, direction: best.direction })) {
      return { ...common, status: "qualified_signal_openai_reservation_denied", seriousSignalFound: false, openAiCalled: false, candidateFingerprint: fingerprint, qualityScore: best.qualityScore, selectedCandidate, committee: { configured: provider.configured, enabled: provider.enabled }, blockers: ["The durable committee budget or evidence lock denied this paid review."], technicalFailureFingerprint: null };
    }
    const committee = await runAiCommittee({ [TRUSTED_IN_MEMORY_EVIDENCE]: pack, persistResult: false, dryRun: false, confirmRun: true, mode: "preview", maxAgents: 13, maxCostUsd: 0.75 });
    const results = Array.isArray(committee.agentResults) ? committee.agentResults : [];
    const completed = results.filter((result) => result.status === "completed").length;
    const failed = results.filter((result) => result.status === "failed").length;
    const finalJudge = results.find((result) => result.agentId === "final_judge");
    const recommendation = committee.committeeOutput?.overallRecommendation ?? "needs_more_data";
    const seriousSignalFound = committee.ok === true && completed === 14 && failed === 0 && recommendation === "approve" && finalJudge?.verdict === "positive" && (finalJudge.confidence ?? 0) >= 70 && best.actionStrengthScore >= 60 && best.score.evidenceConfidenceScore >= 60 && best.score.liveDataReady;
    return { ...common, status: seriousSignalFound ? "serious_signal" : "candidate_needs_more_data", seriousSignalFound, openAiCalled: true, candidateFingerprint: fingerprint, qualityScore: clamp(best.qualityScore * 0.55 + (committee.committeeOutput?.evidenceConfidenceScore ?? 0) * 0.25 + (finalJudge?.confidence ?? 0) * 0.2), selectedCandidate, committee: { ok: committee.ok, status: committee.status, agentsPlanned: committee.plannedAgents?.length ?? 0, agentsCompleted: completed, agentsFailed: failed, finalJudge: finalJudge ? { verdict: finalJudge.verdict, confidence: finalJudge.confidence, concerns: finalJudge.concerns, missingData: finalJudge.missingData, followUpChecks: finalJudge.followUpChecks } : null, output: committee.committeeOutput, writesDatabase: committee.compatibility?.writesDatabase ?? false }, blockers: seriousSignalFound ? [] : [...new Set([...(committee.committeeOutput?.missingEvidence ?? []), ...(finalJudge?.missingData ?? []), ...(finalJudge?.concerns ?? [])])].slice(0, 12), technicalFailureFingerprint: committee.ok ? null : `committee_${committee.status}`, failureScope: committee.ok ? "none" : "external_provider", repairEligible: false };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 200) : "branch_signal_lab_failed";
    const external = error instanceof ExternalProviderError;
    return { ok: false, mode, status: external ? "source_temporarily_unavailable" : "technical_failure", checkedAt: now.toISOString(), durationMs: Date.now() - startedAt, seriousSignalFound: false, openAiCalled: false, databaseWrites: false, publishing: false, notifications: false, realProviderResponsesOnly: true, qualityScore: 0, blockers: [external ? `${error.provider} was unavailable; no substitute or invented data was used.` : message], technicalFailureFingerprint: external ? `external_provider_${error.provider}` : message.replace(/\d+/g, "#"), failureScope: external ? "external_provider" : "application", repairEligible: !external };
  }
}
