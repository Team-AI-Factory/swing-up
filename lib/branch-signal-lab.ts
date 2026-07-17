import crypto from "node:crypto";
import { runAiCommittee, TRUSTED_IN_MEMORY_EVIDENCE } from "@/lib/ai-committee/orchestrator";
import type { AiCommitteeEvidencePack, EvidenceStrength } from "@/lib/ai-committee/evidence-pack";
import { getAiCommitteeProviderStatus } from "@/lib/ai-committee/provider";
import { buildMarketSentimentImpact, scoreSwingUpAlert, type SwingUpScore } from "@/lib/scoring-engine";

type CryptoAsset = { id: string; ticker: string; name: string };
type MarketRow = {
  usd?: unknown;
  usd_24h_change?: unknown;
  usd_24h_vol?: unknown;
  usd_market_cap?: unknown;
  last_updated_at?: unknown;
};
type MarketCandidate = CryptoAsset & {
  price: number;
  change24h: number;
  volume24h: number;
  marketCap: number;
  observedAt: string;
};
type NewsChannel = "google_news_rss" | "gdelt";
type NewsReceipt = { title: string; url: string; publisher: string; publishedAt: string; catalystKeywords: string[]; channel: NewsChannel };
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
type GdeltSnapshot = {
  checkedAt: string;
  receipts: NewsReceipt[];
  sourceUrl: string;
};

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

const CATALYST_KEYWORDS = [
  "approval", "approved", "etf", "regulation", "regulator", "lawsuit", "settlement", "hack", "exploit",
  "outage", "upgrade", "launch", "partnership", "adoption", "treasury", "institutional", "listing", "delisting",
  "liquidation", "whale", "security breach", "court", "sec", "cftc",
];
const NEWS_MAX_AGE_MS = 48 * 60 * 60 * 1000;
const COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price";
const GOOGLE_NEWS_URL = "https://news.google.com/rss/search";
const GDELT_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const FRED_FEDFUNDS_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=FEDFUNDS";
const FRED_DGS10_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10";
const FRED_API_URL = "https://api.stlouisfed.org/fred/series/observations";
const FRANKFURTER_URL = "https://api.frankfurter.app/latest?from=USD&to=EUR,JPY,CHF,CNY";
const GDELT_REFRESH_MS = 15 * 60 * 1000;
const MACRO_REFRESH_MS = 60 * 60 * 1000;
const SUPPLEMENTAL_AUDIT_REFRESH_MS = 24 * 60 * 60 * 1000;
const branchLabCache = globalThis as typeof globalThis & {
  __swingUpGdeltSnapshot?: GdeltSnapshot;
  __swingUpGdeltCooldownUntil?: number;
  __swingUpBranchMacroContext?: MacroContext;
  __swingUpSupplementalSourceAudit?: SupplementalSourceAudit;
};

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
  const providers = {
    openAi: { variable: "OPENAI_API_KEY", keyRequired: true, configured: has("OPENAI_API_KEY") },
    coinGecko: { variable: "COINGECKO_API_KEY", keyRequired: false, configured: has("COINGECKO_API_KEY"), fallback: "keyless_public" },
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
          : record && record.filings && typeof record.filings === "object" && !Array.isArray(record.filings) && Array.isArray((record.filings as Record<string, unknown>).recent)
            ? (record.filings as Record<string, unknown>).recent as unknown[]
            : [];
    const recordsChecked = Array.isArray(body) ? body.length : nestedRows.length || 1;
    return { status: "connected", ok: true, recordsChecked, rateLimited: false };
  } catch (error) {
    return { status: "failed", ok: false, recordsChecked: 0, rateLimited: false, error: error instanceof Error ? error.message.slice(0, 180) : `${params.name}_audit_failed` };
  }
}

async function supplementalSourceAudit(now: Date, fetchImpl: typeof fetch): Promise<SupplementalSourceAudit> {
  const cached = branchLabCache.__swingUpSupplementalSourceAudit;
  if (cached && now.getTime() - Date.parse(cached.checkedAt) < SUPPLEMENTAL_AUDIT_REFRESH_MS) return cached;
  const fmpKey = process.env.FMP_API_KEY?.trim() ?? "";
  const marketauxKey = process.env.MARKETAUX_API_KEY?.trim() ?? "";
  const alphaVantageKey = process.env.ALPHA_VANTAGE_API_KEY?.trim() ?? "";
  const openFdaKey = process.env.OPENFDA_API_KEY?.trim() ?? "";
  const secUserAgent = process.env.SEC_USER_AGENT?.trim() || "SwingUp/0.1 support@swingup.app";
  const urls = {
    secEdgar: new URL("https://data.sec.gov/submissions/CIK0001679788.json"),
    openFda: new URL("https://api.fda.gov/drug/enforcement.json"),
    marketaux: new URL("https://api.marketaux.com/v1/news/all"),
    alphaVantage: new URL("https://www.alphavantage.co/query"),
    fmp: new URL("https://financialmodelingprep.com/stable/historical-price-eod/light"),
  };
  urls.openFda.searchParams.set("limit", "1");
  if (openFdaKey) urls.openFda.searchParams.set("api_key", openFdaKey);
  urls.marketaux.searchParams.set("api_token", marketauxKey);
  urls.marketaux.searchParams.set("symbols", "COIN");
  urls.marketaux.searchParams.set("language", "en");
  urls.marketaux.searchParams.set("filter_entities", "true");
  urls.marketaux.searchParams.set("limit", "1");
  urls.alphaVantage.searchParams.set("function", "NEWS_SENTIMENT");
  urls.alphaVantage.searchParams.set("tickers", "CRYPTO:BTC");
  urls.alphaVantage.searchParams.set("limit", "1");
  urls.alphaVantage.searchParams.set("apikey", alphaVantageKey);
  urls.fmp.searchParams.set("symbol", "BTCUSD");
  urls.fmp.searchParams.set("apikey", fmpKey);
  const settled = await Promise.allSettled([
    auditJsonProvider({ name: "sec_edgar", url: urls.secEdgar, fetchImpl, headers: { "user-agent": secUserAgent }, configured: true, configurationRequired: false }),
    auditJsonProvider({ name: "openfda", url: urls.openFda, fetchImpl, configured: true, configurationRequired: false }),
    auditJsonProvider({ name: "marketaux", url: urls.marketaux, fetchImpl, configured: Boolean(marketauxKey), configurationRequired: true }),
    auditJsonProvider({ name: "alpha_vantage", url: urls.alphaVantage, fetchImpl, configured: Boolean(alphaVantageKey), configurationRequired: true }),
    auditJsonProvider({ name: "fmp", url: urls.fmp, fetchImpl, configured: Boolean(fmpKey), configurationRequired: true }),
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
      marketaux: value(settled[2]),
      alphaVantage: value(settled[3]),
      fmp: value(settled[4]),
    },
  };
  branchLabCache.__swingUpSupplementalSourceAudit = audit;
  return audit;
}

function parseNewsRss(xml: string, now: Date): NewsReceipt[] {
  return Array.from(xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)).flatMap(([item]) => {
    const title = tagValue(item, "title").slice(0, 240);
    const url = tagValue(item, "link");
    const publisher = tagValue(item, "source").slice(0, 120);
    const rawDate = tagValue(item, "pubDate");
    const publishedAt = new Date(rawDate);
    if (!title || !url || !publisher || Number.isNaN(publishedAt.getTime())) return [];
    if (now.getTime() - publishedAt.getTime() > NEWS_MAX_AGE_MS || publishedAt.getTime() > now.getTime() + 5 * 60_000) return [];
    const lower = title.toLowerCase();
    const catalystKeywords = CATALYST_KEYWORDS.filter((keyword) => lower.includes(keyword));
    return [{ title, url, publisher, publishedAt: publishedAt.toISOString(), catalystKeywords, channel: "google_news_rss" as const }];
  });
}

async function fetchMarket(fetchImpl: typeof fetch, now: Date) {
  const url = new URL(COINGECKO_URL);
  url.searchParams.set("ids", ASSETS.map((asset) => asset.id).join(","));
  url.searchParams.set("vs_currencies", "usd");
  url.searchParams.set("include_24hr_change", "true");
  url.searchParams.set("include_24hr_vol", "true");
  url.searchParams.set("include_market_cap", "true");
  url.searchParams.set("include_last_updated_at", "true");
  const coinGeckoKey = process.env.COINGECKO_API_KEY?.trim();
  const response = await fetchImpl(url, { headers: { Accept: "application/json", ...(coinGeckoKey ? { "x-cg-demo-api-key": coinGeckoKey } : {}) }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`coingecko_http_${response.status}`);
  const body = await response.json() as Record<string, MarketRow | undefined>;
  const rows = ASSETS.flatMap((asset): MarketCandidate[] => {
    const row = body[asset.id];
    const price = number(row?.usd);
    const change24h = number(row?.usd_24h_change);
    const volume24h = number(row?.usd_24h_vol);
    const marketCap = number(row?.usd_market_cap);
    const timestamp = number(row?.last_updated_at);
    const observedAt = timestamp ? new Date(timestamp * 1000) : now;
    if (!price || change24h === null || !volume24h || !marketCap || Number.isNaN(observedAt.getTime())) return [];
    return [{ ...asset, price, change24h, volume24h, marketCap, observedAt: observedAt.toISOString() }];
  });
  if (rows.length < 5) throw new Error("coingecko_incomplete_market_snapshot");
  return { rows, sourceUrl: url.toString() };
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
  const cached = branchLabCache.__swingUpGdeltSnapshot;
  if (cached && now.getTime() - Date.parse(cached.checkedAt) < GDELT_REFRESH_MS) {
    return { receipts: cached.receipts, sourceUrl: cached.sourceUrl };
  }
  if ((branchLabCache.__swingUpGdeltCooldownUntil ?? 0) > now.getTime()) {
    throw new Error("gdelt_http_429_cooldown");
  }
  const gdeltUrl = new URL(GDELT_URL);
  gdeltUrl.searchParams.set("query", `(${assets.flatMap((asset) => [`"${asset.name}"`, `"${asset.ticker}"`]).join(" OR ")}) (crypto OR cryptocurrency)`);
  gdeltUrl.searchParams.set("mode", "ArtList");
  gdeltUrl.searchParams.set("format", "json");
  gdeltUrl.searchParams.set("timespan", "48h");
  gdeltUrl.searchParams.set("maxrecords", "100");
  gdeltUrl.searchParams.set("sort", "DateDesc");
  const response = await fetchImpl(gdeltUrl, { headers: { Accept: "application/json", "user-agent": "SwingUpBranchLab/1.0" }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after")?.trim() ?? "";
    const retryAfterSeconds = Number(retryAfter);
    const retryAfterDate = Date.parse(retryAfter);
    const providerDelayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
      ? retryAfterSeconds * 1000
      : Number.isFinite(retryAfterDate)
        ? Math.max(0, retryAfterDate - now.getTime())
        : 0;
    branchLabCache.__swingUpGdeltCooldownUntil = now.getTime() + Math.max(GDELT_REFRESH_MS, providerDelayMs);
    throw new Error("gdelt_http_429");
  }
  if (!response.ok) throw new Error(`gdelt_http_${response.status}`);
  const body = await response.json() as { articles?: Array<Record<string, unknown>> };
  const receipts = (Array.isArray(body.articles) ? body.articles : []).flatMap((article): NewsReceipt[] => {
    const title = typeof article.title === "string" ? article.title.trim().slice(0, 240) : "";
    const articleUrl = typeof article.url === "string" ? article.url.trim() : "";
    const domain = typeof article.domain === "string" ? article.domain.trim().toLowerCase() : "";
    const seenDate = typeof article.seendate === "string" ? article.seendate.trim() : "";
    const normalizedDate = /^\d{8}T\d{6}Z$/.test(seenDate) ? `${seenDate.slice(0, 4)}-${seenDate.slice(4, 6)}-${seenDate.slice(6, 8)}T${seenDate.slice(9, 11)}:${seenDate.slice(11, 13)}:${seenDate.slice(13, 15)}Z` : seenDate;
    const publishedAt = new Date(normalizedDate);
    let publisher = domain;
    if (!publisher && articleUrl) {
      try { publisher = new URL(articleUrl).hostname.replace(/^www\./, ""); } catch {}
    }
    if (!title || !articleUrl || !publisher || Number.isNaN(publishedAt.getTime())) return [];
    if (now.getTime() - publishedAt.getTime() > NEWS_MAX_AGE_MS || publishedAt.getTime() > now.getTime() + 5 * 60_000) return [];
    const lower = title.toLowerCase();
    return [{ title, url: articleUrl, publisher, publishedAt: publishedAt.toISOString(), catalystKeywords: CATALYST_KEYWORDS.filter((keyword) => lower.includes(keyword)), channel: "gdelt" }];
  });
  const unique = new Map<string, NewsReceipt>();
  for (const receipt of receipts) {
    const key = `${receipt.publisher.toLowerCase()}|${receipt.title.toLowerCase().replace(/\s+/g, " ")}`;
    if (!unique.has(key)) unique.set(key, receipt);
  }
  const snapshot: GdeltSnapshot = {
    checkedAt: now.toISOString(),
    receipts: [...unique.values()].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)),
    sourceUrl: gdeltUrl.toString(),
  };
  branchLabCache.__swingUpGdeltSnapshot = snapshot;
  branchLabCache.__swingUpGdeltCooldownUntil = undefined;
  return { receipts: snapshot.receipts, sourceUrl: snapshot.sourceUrl };
}

function receiptMatchesAsset(receipt: NewsReceipt, asset: CryptoAsset) {
  const text = receipt.title.toLowerCase();
  const escapedName = asset.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedTicker = asset.ticker.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])(${escapedName}|${escapedTicker})([^a-z0-9]|$)`, "i").test(text);
}

function marketSentiment(rows: MarketCandidate[], now: Date, macro: MacroContext) {
  const average = rows.reduce((sum, row) => sum + row.change24h, 0) / rows.length;
  const support = clamp(50 + average * 4);
  const macroPressure = (macro.fred.fedFundsRate !== null && macro.fred.fedFundsRate > 4.5 ? 15 : 0) + (macro.fred.tenYearYield !== null && macro.fred.tenYearYield > 4.5 ? 15 : 0);
  const macroSupport = clamp(75 - macroPressure);
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
  const publishers = new Set(receipts.map((receipt) => receipt.publisher.toLowerCase()));
  const channels = new Set(receipts.map((receipt) => receipt.channel));
  const keywordCount = new Set(receipts.flatMap((receipt) => receipt.catalystKeywords)).size;
  const catalystStrength = clamp(40 + keywordCount * 12 + Math.min(18, Math.abs(row.change24h) * 2));
  const volumeToMarketCap = row.volume24h / row.marketCap;
  const priceVolume = clamp(40 + Math.abs(row.change24h) * 6 + Math.min(25, volumeToMarketCap * 100));
  const sourceQuality = publishers.size >= 3 ? "high" as const : publishers.size >= 2 ? "medium" as const : "low" as const;
  const expectedMove = Math.max(4, Math.min(20, Math.abs(row.change24h) * 1.25));
  const inputProvenance = {
    catalystStrengthScore: `live_google_news_and_gdelt_${publishers.size}_publishers_${keywordCount}_catalysts`,
    priceMovePercent: `live_coingecko_24h_${row.observedAt}`,
    sourceQuality: `live_news_channels_${channels.size}_unique_publishers_${publishers.size}`,
    independentReceipts: `live_coingecko_plus_news_channels_${channels.size}_publishers_${publishers.size}`,
    priceVolumeConfirmationScore: `live_coingecko_price_volume_market_cap_${row.observedAt}`,
    macroSupportScore: "live_fred_fedfunds_and_dgs10",
  };
  const score = scoreSwingUpAlert({
    ticker: row.ticker,
    company: row.name,
    expectedUpsidePercent: row.change24h >= 0 ? expectedMove : Math.max(3, expectedMove * 0.6),
    expectedDownsidePercent: Math.max(8, Math.min(28, Math.abs(row.change24h) * 1.4)),
    historicalPatternMatch: "no_clear_match",
    valuationSupportScore: clamp(75 - Math.log10(Math.max(row.marketCap, 1)) * 2),
    catalystStrengthScore: catalystStrength,
    priceMovePercent: row.change24h,
    sectorSupportScore: sentiment.sentimentSupportScore,
    macroSupportScore: sentiment.macroSupportScore,
    sourceQuality,
    independentReceipts: publishers.size + 1,
    hasConfirmedFilingOrExchangeSource: false,
    priceVolumeConfirmationScore: priceVolume,
    financialSupportScore: clamp(50 + Math.min(30, volumeToMarketCap * 100)),
    verifiedRippleLinks: 0,
    contradictionCount: 0,
    isRumour: false,
    overboughtRiskScore: row.change24h > 0 ? clamp(25 + row.change24h * 5) : 35,
    balanceSheetRiskScore: 70,
    sourceRiskScore: publishers.size >= 3 ? 18 : publishers.size >= 2 ? 30 : 65,
    liquidityRiskScore: clamp(60 - volumeToMarketCap * 120),
    dilutionRiskScore: 70,
    inputProvenance,
    liveEvidenceOnly: true,
  }, sentiment);
  return { score, publishers: [...publishers], channels: [...channels], keywordCount, catalystStrength, priceVolume, volumeToMarketCap };
}

function section(available: boolean, strength: EvidenceStrength, summary: string, items: Array<Record<string, unknown>>) {
  return { available, strength, summary, items };
}

function evidencePack(params: { row: MarketCandidate; receipts: NewsReceipt[]; score: SwingUpScore; marketSourceUrl: string; newsSourceUrls: { googleNewsRss: string; gdelt: string }; publishers: string[]; volumeToMarketCap: number; macro: MacroContext; now: Date }): AiCommitteeEvidencePack {
  const { row, receipts, score, publishers, now } = params;
  const links = [params.marketSourceUrl, params.newsSourceUrls.googleNewsRss, params.newsSourceUrls.gdelt, ...params.macro.fred.sourceUrls, params.macro.frankfurter.sourceUrl, ...receipts.map((receipt) => receipt.url)];
  const newsItems = receipts.map((receipt) => ({ source: receipt.publisher, discoveryChannel: receipt.channel, title: receipt.title, url: receipt.url, observedAt: receipt.publishedAt, catalystKeywords: receipt.catalystKeywords }));
  const marketItem = { source: "CoinGecko", ticker: row.ticker, priceUsd: row.price, change24h: row.change24h, volume24h: row.volume24h, marketCap: row.marketCap, volumeToMarketCap: params.volumeToMarketCap, observedAt: row.observedAt, url: params.marketSourceUrl };
  return {
    candidateAlertId: `branch-lab-${crypto.randomUUID()}`,
    rawSignalIds: [], ticker: row.ticker, company: `${row.name} digital asset`, actionLabel: score.suggestedAction,
    eventHeadline: receipts[0]?.title ?? `${row.ticker} live market catalyst scan`,
    whatHappened: `${row.name} moved ${row.change24h.toFixed(2)}% in 24 hours. ${receipts.length} recent news receipts from ${publishers.length} unique publishers were checked.`,
    sourceNames: ["CoinGecko", "Google News RSS", "GDELT", "FRED", "Frankfurter FX", ...publishers], sourceLinks: [...new Set(links)],
    sourceFreshness: [
      { source: "CoinGecko", collectedAt: row.observedAt, ageHours: Math.max(0, (now.getTime() - Date.parse(row.observedAt)) / 3_600_000), freshness: "fresh" },
      ...receipts.map((receipt) => ({ source: receipt.publisher, collectedAt: receipt.publishedAt, ageHours: Math.max(0, (now.getTime() - Date.parse(receipt.publishedAt)) / 3_600_000), freshness: "fresh" as const })),
    ],
    sourceHealth: [{ source: "CoinGecko", status: "connected", checkedAt: now.toISOString(), lastSuccessAt: now.toISOString(), responseTimeMs: null, problem: null, notes: "Live read-only branch experiment." }, { source: "Google News RSS", status: "connected", checkedAt: now.toISOString(), lastSuccessAt: now.toISOString(), responseTimeMs: null, problem: null, notes: "Live read-only branch experiment." }, { source: "GDELT", status: "connected", checkedAt: now.toISOString(), lastSuccessAt: now.toISOString(), responseTimeMs: null, problem: null, notes: "Live read-only branch experiment." }, { source: "FRED", status: params.macro.fred.status, checkedAt: params.macro.checkedAt, lastSuccessAt: params.macro.fred.status === "connected" ? params.macro.checkedAt : null, responseTimeMs: null, problem: params.macro.fred.error, notes: "Live public macro context." }, { source: "Frankfurter FX", status: params.macro.frankfurter.status, checkedAt: params.macro.checkedAt, lastSuccessAt: params.macro.frankfurter.status === "connected" ? params.macro.checkedAt : null, responseTimeMs: null, problem: params.macro.frankfurter.error, notes: "Live public FX context." }],
    proofBundleSummary: { proofCount: links.length, proofTypes: ["news", "price_volume", "crypto_market"], uniquePublishers: publishers.length, liveOnly: true },
    filingEvidence: section(true, "medium", "Issuer filings are not applicable to this digital asset; regulatory news receipts are included in the news section.", []),
    newsEvidence: section(newsItems.length >= 2, newsItems.length >= 3 ? "strong" : "medium", `${newsItems.length} recent receipts from ${publishers.length} unique publishers.`, newsItems),
    priceVolumeEvidence: section(true, "strong", "Current price, 24-hour move, volume, and market capitalization came directly from CoinGecko.", [marketItem]),
    fundamentalsEvidence: section(true, "medium", "Crypto market structure uses live market cap and turnover; company accounting metrics do not apply.", [marketItem]),
    macroEvidence: section(params.macro.fred.status === "connected" && params.macro.frankfurter.status === "connected", "strong", `Top-asset crypto sentiment is ${score.marketSentimentImpact.overallMarketMood}; FRED rates and Frankfurter FX context were checked from live public endpoints.`, [score.marketSentimentImpact, params.macro.fred, params.macro.frankfurter]),
    fdaRegulatoryEvidence: section(true, "medium", "FDA evidence is not applicable; relevant regulatory headlines are in news evidence.", []),
    cryptoFxEvidence: section(true, "strong", "Direct live digital-asset market evidence is available.", [marketItem]),
    finraShortPressureEvidence: section(true, "medium", "FINRA short-sale data is not applicable to this spot digital asset.", []),
    wikidataRippleRelationships: section(true, "medium", "No ecosystem relationship is asserted without a direct receipt.", []),
    historicalPatternMatch: section(true, "medium", "No historical pattern assumption was used in this live experiment.", []),
    previousSimilarOutcomes: section(true, "medium", "Outcome tracking is enabled, but no past result is invented for this new candidate.", []),
    score: { profitPotential: score.profitPotentialScore, evidenceConfidence: score.evidenceConfidenceScore, riskLevel: score.riskLevel, pricedInCheck: score.pricedInCheck, inputCompleteness: score.inputCompleteness, liveDataReady: score.liveDataReady, missingInputs: score.missingInputs, inputProvenance: score.inputProvenance, createdAt: now.toISOString(), persisted: false },
    currentRiskLabels: [`risk:${score.riskLevel}`, `priced_in:${score.pricedInCheck}`, ...(row.change24h > 8 ? ["large_24h_move"] : [])],
    missingEvidence: [], dataFreshnessWarnings: [],
    compatibility: { callsOpenAi: false, publishes: false, sendsTelegram: false, writesDatabase: false },
  };
}

function candidateFingerprint(row: MarketCandidate, receipts: NewsReceipt[]) {
  const evidence = receipts
    .map((receipt) => `${receipt.publisher.toLowerCase()}|${receipt.title.toLowerCase()}`)
    .sort()
    .join("||");
  return crypto.createHash("sha256").update(`${row.ticker}|${evidence}`).digest("hex").slice(0, 20);
}

export async function runBranchSignalLab(input: { allowOpenAi?: boolean; fetchImpl?: typeof fetch; now?: Date; skipOpenAiCandidateFingerprints?: string[] } = {}) {
  const now = input.now ?? new Date();
  const fetchImpl = input.fetchImpl ?? fetch;
  const mode = "railway_branch_live_read_only";
  const startedAt = Date.now();
  try {
    const [market, macro, supplementalAudit] = await Promise.all([fetchMarket(fetchImpl, now), fetchMacroContext(fetchImpl, now), supplementalSourceAudit(now, fetchImpl)]);
    const sentiment = marketSentiment(market.rows, now, macro);
    const movers = [...market.rows].sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h)).slice(0, 5);
    const [googleResults, gdelt] = await Promise.all([
      Promise.all(movers.map((row) => fetchGoogleNews(row, fetchImpl, now)
        .then((result) => ({ ...result, status: "connected" as const, error: null }))
        .catch((error: unknown) => ({ receipts: [] as NewsReceipt[], sourceUrl: "", status: "failed" as const, error: error instanceof Error ? error.message : "google_news_failed" })))),
      fetchGdeltNews(movers, fetchImpl, now)
        .then((result) => ({ ...result, status: "connected" as const, error: null }))
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "gdelt_failed";
          return { receipts: [] as NewsReceipt[], sourceUrl: "", status: message.includes("429") ? "rate_limited" as const : "failed" as const, error: message };
        }),
    ]);
    const newsResults = movers.map((row, index) => {
      const google = googleResults[index];
      const combined = [...google.receipts, ...gdelt.receipts.filter((receipt) => receiptMatchesAsset(receipt, row))];
      const unique = new Map(combined.map((receipt) => [`${receipt.publisher.toLowerCase()}|${receipt.title.toLowerCase().replace(/\s+/g, " ")}`, receipt]));
      return { row, receipts: [...unique.values()].slice(0, 16), sourceUrls: { googleNewsRss: google.sourceUrl, gdelt: gdelt.sourceUrl }, sourceStatus: { googleNewsRss: google.status, gdelt: gdelt.status }, errors: [google.error, gdelt.error].filter((value): value is string => Boolean(value)) };
    });
    const ranked = newsResults.map(({ row, receipts, sourceUrls, sourceStatus, errors }) => {
      const scored = scoreCandidate(row, receipts, sentiment);
      const qualityScore = clamp(scored.score.profitPotentialScore * 0.4 + scored.score.evidenceConfidenceScore * 0.4 + Math.min(100, scored.publishers.length * 25) * 0.2);
      return { row, receipts, newsSourceUrls: sourceUrls, newsSourceStatus: sourceStatus, newsErrors: errors, ...scored, qualityScore };
    }).sort((a, b) => b.qualityScore - a.qualityScore);
    const best = ranked.find((candidate) => candidate.score.liveDataReady && candidate.score.inputCompleteness === 100 && candidate.publishers.length >= 2 && candidate.channels.length === 2 && candidate.newsSourceStatus.googleNewsRss === "connected" && candidate.newsSourceStatus.gdelt === "connected" && macro.fred.status === "connected" && macro.frankfurter.status === "connected" && candidate.keywordCount >= 1 && Math.abs(candidate.row.change24h) >= 2 && candidate.score.evidenceConfidenceScore >= 55) ?? null;
    const common = {
      ok: true, mode, checkedAt: now.toISOString(), durationMs: Date.now() - startedAt,
      sources: {
        coinGecko: "connected",
        googleNewsRss: newsResults.some((result) => result.sourceStatus.googleNewsRss === "connected") ? "connected" : "failed",
        gdelt: gdelt.status,
        fred: macro.fred.status,
        frankfurterFx: macro.frankfurter.status,
      },
      macroContext: macro,
      providerConfiguration: providerConfiguration(),
      supplementalSourceAudit: supplementalAudit,
      liveSourcePolicy: {
        performanceResultsRequireRealHttpResponses: true,
        fixtureOrMockPerformanceResultsAllowed: false,
        applicableDigitalAssetSources: ["CoinGecko", "Google News RSS", "GDELT", "FRED", "Frankfurter FX"],
        supplementalProvidersAuditedButNotCountedAsCryptoPerformanceEvidence: ["SEC EDGAR", "openFDA", "FMP", "Marketaux", "Alpha Vantage"],
        nonApplicableIntegratedEars: ["FINRA short sale", "Wikidata relationship context", "Polygon equity feeds"],
        nonApplicableReason: "Supplemental sources are checked in read-only dry-run mode at most once per day. Only evidence that directly matches the digital asset and event may be promoted in a future gate; connectivity alone never increases confidence.",
      },
      assetsChecked: market.rows.length, candidatesChecked: ranked.length, databaseWrites: false, publishing: false, notifications: false,
      marketSnapshot: market.rows.map((row) => ({ ticker: row.ticker, price: row.price, observedAt: row.observedAt })),
      rankedCandidates: ranked.map((candidate) => ({ ticker: candidate.row.ticker, change24h: Math.round(candidate.row.change24h * 100) / 100, newsReceipts: candidate.receipts.length, newsChannels: candidate.channels, uniquePublishers: candidate.publishers.length, catalystKeywordCount: candidate.keywordCount, inputCompleteness: candidate.score.inputCompleteness, profitPotentialScore: candidate.score.profitPotentialScore, evidenceConfidenceScore: candidate.score.evidenceConfidenceScore, suggestedAction: candidate.score.suggestedAction, qualityScore: candidate.qualityScore, qualifiedForCommittee: candidate === best })),
    };
    const failedRequiredSources = Object.entries(common.sources).filter(([, status]) => status === "failed").map(([source]) => source);
    if (failedRequiredSources.length) return { ...common, ok: false, status: "technical_failure", seriousSignalFound: false, openAiCalled: false, qualityScore: ranked[0]?.qualityScore ?? 0, blockers: [`Required live sources failed: ${failedRequiredSources.join(", ")}. No substitute data was used.`], technicalFailureFingerprint: `required_live_sources_${failedRequiredSources.sort().join("_")}` };
    if (common.sources.gdelt === "rate_limited") return { ...common, status: "source_rate_limit_cooldown", seriousSignalFound: false, openAiCalled: false, qualityScore: ranked[0]?.qualityScore ?? 0, blockers: ["GDELT asked the lab to slow down. The next live cycle will retry without substituting or inventing news."], technicalFailureFingerprint: null };
    if (!best) return { ...common, status: "no_qualified_signal", seriousSignalFound: false, openAiCalled: false, qualityScore: ranked[0]?.qualityScore ?? 0, blockers: ["No current asset had enough independent, recent catalyst evidence and market confirmation. Filters were not weakened."], technicalFailureFingerprint: null };
    const fingerprint = candidateFingerprint(best.row, best.receipts);
    const pack = evidencePack({ row: best.row, receipts: best.receipts, score: best.score, marketSourceUrl: market.sourceUrl, newsSourceUrls: best.newsSourceUrls, publishers: best.publishers, volumeToMarketCap: best.volumeToMarketCap, macro, now });
    const provider = getAiCommitteeProviderStatus();
    const selectedCandidate = { ticker: best.row.ticker, company: best.row.name, price: best.row.price, change24h: best.row.change24h, direction: best.row.change24h >= 0 ? "upside" : "downside", newsReceipts: best.receipts, score: best.score };
    if (input.skipOpenAiCandidateFingerprints?.includes(fingerprint)) return { ...common, status: "qualified_candidate_already_reviewed", seriousSignalFound: false, openAiCalled: false, candidateFingerprint: fingerprint, qualityScore: best.qualityScore, selectedCandidate, committee: { configured: provider.configured, enabled: provider.enabled }, blockers: ["The same evidence was already reviewed recently, so OpenAI was not called again."], technicalFailureFingerprint: null };
    if (!input.allowOpenAi) return { ...common, status: "qualified_signal_openai_not_requested", seriousSignalFound: false, openAiCalled: false, candidateFingerprint: fingerprint, qualityScore: best.qualityScore, selectedCandidate, committee: { configured: provider.configured, enabled: provider.enabled }, blockers: ["The rolling OpenAI test budget has been reached; the candidate was retained without another paid review."], technicalFailureFingerprint: null };
    if (!provider.configured || !provider.enabled) return { ...common, ok: false, status: "technical_failure", seriousSignalFound: false, openAiCalled: false, candidateFingerprint: fingerprint, qualityScore: best.qualityScore, selectedCandidate, blockers: [provider.configured ? "AI committee is disabled." : "OPENAI_API_KEY is not available in this deployment."], technicalFailureFingerprint: provider.configured ? "ai_committee_disabled" : "openai_key_missing" };
    const committee = await runAiCommittee({ [TRUSTED_IN_MEMORY_EVIDENCE]: pack, persistResult: false, dryRun: false, confirmRun: true, mode: "preview", maxAgents: 13, maxCostUsd: 0.75 });
    const results = Array.isArray(committee.agentResults) ? committee.agentResults : [];
    const completed = results.filter((result) => result.status === "completed").length;
    const failed = results.filter((result) => result.status === "failed").length;
    const finalJudge = results.find((result) => result.agentId === "final_judge");
    const recommendation = committee.committeeOutput?.overallRecommendation ?? "needs_more_data";
    const seriousSignalFound = committee.ok === true && completed === 14 && failed === 0 && recommendation === "approve" && best.score.profitPotentialScore >= 60 && best.score.evidenceConfidenceScore >= 60 && best.score.liveDataReady;
    return { ...common, status: seriousSignalFound ? "serious_signal" : "candidate_needs_more_data", seriousSignalFound, openAiCalled: true, candidateFingerprint: fingerprint, qualityScore: clamp(best.qualityScore * 0.55 + (committee.committeeOutput?.evidenceConfidenceScore ?? 0) * 0.25 + (finalJudge?.confidence ?? 0) * 0.2), selectedCandidate, committee: { ok: committee.ok, status: committee.status, agentsPlanned: committee.plannedAgents?.length ?? 0, agentsCompleted: completed, agentsFailed: failed, finalJudge: finalJudge ? { verdict: finalJudge.verdict, confidence: finalJudge.confidence, concerns: finalJudge.concerns, missingData: finalJudge.missingData } : null, output: committee.committeeOutput, writesDatabase: committee.compatibility?.writesDatabase ?? false }, blockers: seriousSignalFound ? [] : [...new Set([...(committee.committeeOutput?.missingEvidence ?? []), ...(finalJudge?.missingData ?? []), ...(finalJudge?.concerns ?? [])])].slice(0, 12), technicalFailureFingerprint: committee.ok ? null : `committee_${committee.status}` };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 200) : "branch_signal_lab_failed";
    return { ok: false, mode, status: "technical_failure", checkedAt: now.toISOString(), durationMs: Date.now() - startedAt, seriousSignalFound: false, openAiCalled: false, databaseWrites: false, publishing: false, notifications: false, qualityScore: 0, blockers: [message], technicalFailureFingerprint: message.replace(/\d+/g, "#") };
  }
}
