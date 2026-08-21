import crypto from "node:crypto";
import {
  fetchAlphaEarningsCalendar,
  fetchAlphaNews,
  fetchCommerceNews,
  fetchFederalRegister,
  fetchGdeltDiscovery,
  fetchMarketauxDiscovery,
  fetchNasdaqTradeHalts,
  fetchOfficialFeeds,
  fetchOpenFdaRecalls,
} from "@/lib/equity-signal/event-sources";
import { fetchMacroContext } from "@/lib/equity-signal/macro";
import type { EventReceipt, ProviderResult } from "@/lib/equity-signal/types";
import {
  loadEquityUniverse,
  validEquityUniverseSnapshot,
  type EquityUniverseEntry,
  type EquityUniverseSnapshot,
} from "@/lib/equity-signal/universe";
import { readVersionedTextFromR2, writeVersionedJsonToR2 } from "@/lib/r2-warehouse";
import { pr262StorageKey } from "@/lib/opportunity-engine/pr262-storage";
import {
  parseRssForPr262Sensor,
  parseSecAtomForSensor,
  partitionPr262PendingEvents,
  type Pr262SensorEvent,
  type Pr262SensorReadiness,
  type Pr262SensorSourceHealth,
} from "@/lib/opportunity-engine/pr262-change-sensor";
import { runPr262DirectAnnouncementMonitor } from "@/lib/opportunity-engine/pr262-direct-announcements";
import {
  loadPr262ExposureIndex,
  type Pr262ExposureEntry,
  type Pr262ExposureIndex,
} from "@/lib/opportunity-engine/pr262-exposure-index";

const SENSOR_STATE_KEY = pr262StorageKey("sensor/state-v1.json");
const SEC_AGENT = "SwingUp/1.0 support@swingup.app";
const TRADINGVIEW_SCAN = "https://scanner.tradingview.com/america/scan";
const FMP_NEWS_URL = "https://financialmodelingprep.com/stable/news/stock";
const FDA_MEDWATCH_RSS_URL = "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/medwatch/rss.xml";
const MAX_SEEN = 20_000;
const MAX_FRESH = 500;
const FIVE_MINUTES_MS = 5 * 60_000;
const FIFTEEN_MINUTES_MS = 15 * 60_000;
const THIRTY_MINUTES_MS = 30 * 60_000;
const SEVENTY_FIVE_MINUTES_MS = 75 * 60_000;
const TWO_HOURS_MS = 2 * 60 * 60_000;
const TWELVE_HOURS_MS = 12 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const UNIVERSE_READINESS_MAX_AGE_MS = 30 * 60 * 60_000;
const URGENT_SEC_FORMS = ["8-K", "6-K", "424B5"] as const;
const GOOGLE_QUERIES = [
  '(earnings OR guidance OR acquisition OR merger OR "contract award" OR recall OR investigation OR offering) (NASDAQ OR NYSE OR company)',
  '("press release" OR "investor relations" OR "company announcement" OR buyback OR dividend) (NASDAQ OR NYSE)',
  '(FDA OR tariff OR sanctions OR cyberattack OR lawsuit OR bankruptcy OR "product launch") (NASDAQ OR NYSE OR stock)',
] as const;

type Json = Record<string, unknown>;
type CompatState = {
  version: 2;
  updatedAt: string;
  seen: string[];
  pending: Pr262SensorEvent[];
  lastMarketWatchAt: string | null;
  cursors: { secUrgentFormIndex: number; newsQueryIndex: number; officialFeedIndex: number; directIssuerFeedIndex: number };
  sourceHealth: Record<string, Pr262SensorSourceHealth>;
  sensorReadiness: Pr262SensorReadiness;
  cloudflareSensor: null;
};

type SourceSummary = {
  provider: string;
  attempted: boolean;
  status: string;
  recordsRead: number;
  newEvents: number;
  error: string | null;
  nextRetryAt: string | null;
};

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finite(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/,/g, "")) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export function pr262UniverseReadyForSensor(snapshot: EquityUniverseSnapshot, now = new Date()) {
  const refreshedAt = Date.parse(snapshot?.refreshedAt ?? "");
  return validEquityUniverseSnapshot(snapshot)
    && snapshot.constructionMode === "nasdaq_plus_sec"
    && Number.isFinite(refreshedAt)
    && refreshedAt <= now.getTime() + FIVE_MINUTES_MS
    && now.getTime() - refreshedAt <= UNIVERSE_READINESS_MAX_AGE_MS;
}

function hash(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function safeError(error: unknown) {
  return error instanceof Error
    ? error.message.replace(/\s+/g, " ").slice(0, 200)
    : "pr262_exposure_index_unavailable";
}

function buildStructuredTickerResolver(entries: EquityUniverseEntry[]) {
  const display = new Map(entries.map((entry) => [entry.ticker, entry.name]));
  return {
    resolve(receipt: EventReceipt) {
      const direct = receipt.symbolHints.find((value) => /^[A-Z][A-Z0-9.-]{0,9}$/i.test(value))?.toUpperCase()
        ?? `${receipt.title} ${receipt.summary ?? ""}`.match(/(?:\$|NASDAQ:\s*|NYSE:\s*|AMEX:\s*)([A-Z][A-Z0-9.-]{0,9})\b/)?.[1]?.toUpperCase()
        ?? null;
      if (direct && display.has(direct)) return { ticker: direct, company: display.get(direct) ?? direct, method: "structured_ticker" };
      return { ticker: null, company: null, method: "structured_ticker_required_fail_closed" };
    },
  };
}

function priority(receipt: EventReceipt) {
  const value = `${receipt.title} ${receipt.summary ?? ""} ${receipt.rawEventType ?? ""}`.toLowerCase();
  if (/bankrupt|going concern|restat|trading halt|clinical hold|fda.{0,30}(reject|recall)|deal blocked|cyberattack|data breach|sanction|tariff|war|military strike|sec charges|doj charges|fraud/.test(value)) return 100;
  if (/earnings|guidance|acquisition|merger|contract|offering|buyback|dividend|investigation|ceo|cfo|fomc|interest rate|inflation|cpi|jobs|payroll/.test(value)) return 90;
  return receipt.official || receipt.primarySource ? 75 : 65;
}

function receiptToEvent(receipt: EventReceipt, provider: string, resolver: ReturnType<typeof buildStructuredTickerResolver>, now: Date): Pr262SensorEvent | null {
  const observedMs = Date.parse(receipt.publishedAt);
  if (!Number.isFinite(observedMs) || observedMs > now.getTime() + FIVE_MINUTES_MS || now.getTime() - observedMs > 14 * DAY_MS) return null;
  const resolved = resolver.resolve(receipt);
  const source: Pr262SensorEvent["source"] = receipt.official || receipt.primarySource || receipt.channel === "nasdaq_trade_halts" ? "official" : "company_news";
  return {
    id: `v3:${hash(`${provider}|${receipt.id}|${receipt.url}|${receipt.publishedAt}`)}`,
    source,
    sourceProvider: provider,
    sourceHealthStatus: "connected",
    observedAt: new Date(observedMs).toISOString(),
    title: receipt.title.slice(0, 300),
    url: receipt.url,
    sourceUrl: receipt.url,
    ticker: resolved.ticker,
    company: resolved.company,
    kind: receipt.rawEventType ?? receipt.channel,
    priority: priority(receipt),
    reason: receipt.official || receipt.primarySource
      ? "New primary or official information detected by the lightweight sensor; no deep analysis has run yet."
      : "New public company information detected by a low-cost discovery feed; no deep analysis has run yet.",
    cik: null,
    form: null,
    accession: null,
    canonicalSecIndexUrl: null,
    identityMethod: "not_applicable",
    ...(resolved.ticker
      ? { mappingStatus: "mapped" as const, mappingMethod: resolved.method, mappingReason: "An explicit source ticker matched the authoritative U.S. universe." }
      : { mappingStatus: "unmapped" as const, mappingMethod: resolved.method, mappingReason: "Company names and headline mentions are never used as issuer identity." }),
    queueAttempts: 0,
    queueNextAttemptAt: null,
    queueLastAttemptAt: null,
    queueLastError: null,
  };
}

function sectorTargets(title: string) {
  const value = title.toLowerCase();
  const sectors = new Set<string>();
  if (/federal reserve|fomc|interest rate|treasury yield|inflation|cpi/.test(value)) ["financial", "real estate", "consumer cyclical"].forEach((item) => sectors.add(item));
  if (/tariff|trade war|export control|sanction|customs|import duty/.test(value)) ["technology", "industrials", "basic materials", "consumer cyclical", "energy"].forEach((item) => sectors.add(item));
  if (/oil|opec|crude|natural gas|lng/.test(value)) ["energy", "industrials", "consumer cyclical"].forEach((item) => sectors.add(item));
  if (/cyber|ransomware|security vulnerability|data breach/.test(value)) ["technology", "financial"].forEach((item) => sectors.add(item));
  if (/war|military|defense|missile|invasion|geopolitical/.test(value)) ["industrials", "technology", "energy"].forEach((item) => sectors.add(item));
  if (/fda|drug|clinical|biotech|medical device/.test(value)) sectors.add("health");
  if (/jobs|payroll|unemployment|labor market/.test(value)) ["consumer cyclical", "industrials", "financial"].forEach((item) => sectors.add(item));
  return [...sectors];
}

function fanOut(event: Pr262SensorEvent, exposure: Pr262ExposureEntry[]) {
  if (event.ticker || event.priority < 85 || event.source !== "official") return [] as Pr262SensorEvent[];
  const targets = sectorTargets(`${event.title} ${event.reason}`);
  if (!targets.length) return [];
  return exposure
    .filter((entry) => {
      const value = `${entry.sector ?? ""} ${entry.industry ?? ""}`.toLowerCase();
      return targets.some((target) => value.includes(target));
    })
    .sort((left, right) => (right.marketCap ?? 0) - (left.marketCap ?? 0) || right.risk - left.risk)
    .slice(0, 30)
    .map((entry): Pr262SensorEvent => ({
      ...event,
      id: `${event.id}:fanout:${entry.ticker}`,
      ticker: entry.ticker,
      company: entry.company,
      priority: Math.max(82, event.priority - 3),
      reason: `${event.reason} Market/sector fan-out mapped this event to ${entry.ticker} through its stored ${entry.sector ?? "sector"}/${entry.industry ?? "industry"} exposure.`,
      mappingStatus: "mapped",
      mappingMethod: "deterministic_sector_fanout",
      mappingReason: "The specialist must still prove issuer-specific causal transmission before a Serious Signal.",
      tradingViewSymbol: entry.tradingViewSymbol,
    }));
}

async function loadState(): Promise<{ state: CompatState; etag: string | null }> {
  const current = await readVersionedTextFromR2(SENSOR_STATE_KEY);
  if (!current.found || !current.text) {
    return {
      state: {
        version: 2,
        updatedAt: new Date(0).toISOString(),
        seen: [],
        pending: [],
        lastMarketWatchAt: null,
        cursors: { secUrgentFormIndex: 0, newsQueryIndex: 0, officialFeedIndex: 0, directIssuerFeedIndex: 0 },
        sourceHealth: {},
        sensorReadiness: { version: 1, checkedAt: new Date(0).toISOString(), universeReady: false, universeEntries: 0, exposureReady: false, exposureEntries: 0 },
        cloudflareSensor: null,
      },
      etag: current.etag,
    };
  }
  const value = object(JSON.parse(current.text));
  return {
    state: {
      version: 2,
      updatedAt: text(value.updatedAt) ?? new Date(0).toISOString(),
      seen: Array.isArray(value.seen) ? value.seen.filter((item): item is string => typeof item === "string").slice(-MAX_SEEN) : [],
      pending: Array.isArray(value.pending) ? value.pending as Pr262SensorEvent[] : [],
      lastMarketWatchAt: text(value.lastMarketWatchAt),
      cursors: {
        secUrgentFormIndex: Math.max(0, Number(object(value.cursors).secUrgentFormIndex) || 0),
        newsQueryIndex: Math.max(0, Number(object(value.cursors).newsQueryIndex) || 0),
        officialFeedIndex: Math.max(0, Number(object(value.cursors).officialFeedIndex) || 0),
        directIssuerFeedIndex: Math.max(0, Number(object(value.cursors).directIssuerFeedIndex) || 0),
      },
      sourceHealth: object(value.sourceHealth) as Record<string, Pr262SensorSourceHealth>,
      sensorReadiness: {
        version: 1,
        checkedAt: text(object(value.sensorReadiness).checkedAt) ?? new Date(0).toISOString(),
        universeReady: object(value.sensorReadiness).universeReady === true,
        universeEntries: Math.max(0, Number(object(value.sensorReadiness).universeEntries) || 0),
        exposureReady: object(value.sensorReadiness).exposureReady === true,
        exposureEntries: Math.max(0, Number(object(value.sensorReadiness).exposureEntries) || 0),
      },
      // This writer runs only while Railway owns source sensing. Explicitly
      // clear a prior Cloudflare ownership marker while retaining its neutral
      // direct-feed cursor for a future controlled cutover.
      cloudflareSensor: null,
    },
    etag: current.etag,
  };
}

function due(health: Record<string, Pr262SensorSourceHealth>, provider: string, cadenceMs: number, now: Date) {
  const prior = health[provider];
  const retryAt = prior?.nextRetryAt ? Date.parse(prior.nextRetryAt) : Number.NaN;
  if (Number.isFinite(retryAt) && retryAt > now.getTime()) return false;
  const successAt = prior?.lastSuccessAt ? Date.parse(prior.lastSuccessAt) : Number.NaN;
  return !Number.isFinite(successAt) || now.getTime() - successAt >= cadenceMs;
}

function health(provider: string, status: string, recordsRead: number, error: string | null, urls: string[], now: Date, prior?: Pr262SensorSourceHealth): Pr262SensorSourceHealth {
  const connected = status === "connected" || status === "partial";
  const failures = connected ? 0 : (prior?.consecutiveFailures ?? 0) + 1;
  const retryMs = /rate/i.test(status) ? 30 * 60_000 : Math.min(30 * 60_000, 60_000 * (2 ** Math.min(5, Math.max(0, failures - 1))));
  return {
    provider,
    status: connected ? status as "connected" | "partial" : /rate/i.test(status) ? "rate_limited" : "temporarily_unavailable",
    checkedAt: now.toISOString(),
    lastSuccessAt: connected ? now.toISOString() : prior?.lastSuccessAt ?? null,
    lastSuccessStatus: connected ? status as "connected" | "partial" : prior?.lastSuccessStatus ?? null,
    nextRetryAt: connected ? null : new Date(now.getTime() + retryMs).toISOString(),
    consecutiveFailures: failures,
    recordsRead,
    error,
    sourceUrls: urls,
    attemptedThisCycle: true,
    skipReason: null,
  };
}

async function boundedText(fetchImpl: typeof fetch, url: string, accept: string) {
  const response = await fetchImpl(url, { headers: { Accept: accept, "user-agent": SEC_AGENT }, cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`pr262_v3_http_${response.status}`);
  const body = await response.text();
  if (Buffer.byteLength(body) > 1_000_000) throw new Error("pr262_v3_feed_too_large");
  return body;
}

function secUrl(form: string | null) {
  const url = new URL("https://www.sec.gov/cgi-bin/browse-edgar");
  url.searchParams.set("action", "getcurrent");
  url.searchParams.set("output", "atom");
  url.searchParams.set("owner", "include");
  url.searchParams.set("count", "100");
  if (form) url.searchParams.set("type", form);
  return url.toString();
}

async function runFmpNews(fetchImpl: typeof fetch, exposure: Pr262ExposureEntry[], now: Date) {
  if (process.env.FMP_COMMERCIAL_USE_APPROVED?.trim().toLowerCase() !== "true") {
    return { provider: "fmp_news", status: "not_configured", recordsRead: 0, receipts: [] as EventReceipt[], error: "FMP commercial use is not approved", urls: [FMP_NEWS_URL] };
  }
  const key = process.env.FMP_API_KEY?.trim();
  if (!key) return { provider: "fmp_news", status: "not_configured", recordsRead: 0, receipts: [] as EventReceipt[], error: "FMP_API_KEY not configured", urls: [FMP_NEWS_URL] };
  const leaders = exposure.filter((item) => item.businessQuality >= 65).slice(0, 120);
  if (!leaders.length) return { provider: "fmp_news", status: "connected", recordsRead: 0, receipts: [] as EventReceipt[], error: null, urls: [FMP_NEWS_URL] };
  const bucket = Math.floor(now.getTime() / TWO_HOURS_MS);
  const symbols = Array.from({ length: Math.min(3, leaders.length) }, (_, index) => leaders[(bucket * 3 + index) % leaders.length].ticker);
  const url = new URL(FMP_NEWS_URL);
  url.searchParams.set("symbols", symbols.join(","));
  url.searchParams.set("limit", "10");
  url.searchParams.set("apikey", key);
  const response = await fetchImpl(url, { headers: { Accept: "application/json", apikey: key }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`fmp_news_http_${response.status}`);
  const body = await response.json() as unknown;
  const rows = Array.isArray(body) ? body.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row)) : [];
  const receipts: EventReceipt[] = rows.flatMap((row) => {
    const ticker = text(row.symbol)?.toUpperCase();
    const title = text(row.title ?? row.headline);
    const articleUrl = text(row.url ?? row.link);
    const publishedRaw = text(row.publishedDate ?? row.date);
    const publishedMs = publishedRaw ? Date.parse(publishedRaw) : Number.NaN;
    if (!ticker || !title || !articleUrl || !Number.isFinite(publishedMs)) return [];
    return [{ id: `fmp:${hash(`${ticker}|${articleUrl}|${publishedRaw}`)}`, title, summary: text(row.text ?? row.summary), url: articleUrl, publisher: "Financial Modeling Prep", publishedAt: new Date(publishedMs).toISOString(), channel: "gdelt", official: false, primarySource: false, scheduled: false, symbolHints: [ticker], companyHints: [], rawEventType: "fmp_stock_news" }];
  });
  return { provider: "fmp_news", status: "connected", recordsRead: rows.length, receipts, error: null, urls: [FMP_NEWS_URL] };
}

async function marketWatch(fetchImpl: typeof fetch, exposure: Pr262ExposureEntry[], now: Date) {
  const watch = exposure.filter((item) => item.tradingViewSymbol && (item.buyBelowPrice !== null || item.strongBuyBelowPrice !== null || item.trimAbovePrice !== null || item.businessQuality >= 70))
    .sort((left, right) => right.businessQuality - left.businessQuality || (right.marketCap ?? 0) - (left.marketCap ?? 0)).slice(0, 500);
  if (!watch.length) return [] as Pr262SensorEvent[];
  const response = await fetchImpl(TRADINGVIEW_SCAN, { method: "POST", headers: { "content-type": "application/json", Accept: "application/json" }, body: JSON.stringify({ symbols: { tickers: watch.map((item) => item.tradingViewSymbol), query: { types: [] } }, columns: ["name", "description", "close", "change", "volume", "relative_volume_10d_calc"] }), cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`pr262_v3_market_http_${response.status}`);
  const body = await response.json() as { data?: Array<{ s?: string; d?: unknown[] }> };
  const byTicker = new Map(watch.map((item) => [item.ticker, item]));
  return (Array.isArray(body.data) ? body.data : []).flatMap((row): Pr262SensorEvent[] => {
    const data = Array.isArray(row.d) ? row.d : [];
    const ticker = String(data[0] ?? "").toUpperCase();
    const price = finite(data[2]);
    const change = finite(data[3]) ?? 0;
    const relativeVolume = finite(data[5]) ?? 0;
    const item = byTicker.get(ticker);
    if (!item || price === null || price <= 0) return [];
    const threshold = item.strongBuyBelowPrice !== null && price <= item.strongBuyBelowPrice ? "strong_buy_price_crossed" : item.buyBelowPrice !== null && price <= item.buyBelowPrice ? "buy_price_crossed" : item.trimAbovePrice !== null && price >= item.trimAbovePrice ? "trim_price_crossed" : null;
    if (!threshold && Math.abs(change) < 5 && relativeVolume < 3) return [];
    const kind = threshold ?? "unusual_price_or_volume";
    return [{ id: `v3-market:${hash(`${ticker}|${kind}|${Math.round(price * 100) / 100}|${now.toISOString().slice(0, 16)}`)}`, source: "market_price", sourceProvider: "tradingview_quality_watchlist_v3", sourceHealthStatus: "connected", observedAt: now.toISOString(), title: `${ticker} ${kind} at ${price}`, url: `https://www.tradingview.com/symbols/${encodeURIComponent(row.s ?? ticker)}/`, sourceUrl: TRADINGVIEW_SCAN, ticker, company: item.company, kind, priority: threshold === "strong_buy_price_crossed" ? 100 : threshold ? 92 : 80, reason: threshold ? "A stored valuation threshold crossed; reuse the existing company thesis and inspect only this ticker." : `A large market change was detected (${change.toFixed(1)}%, ${relativeVolume.toFixed(1)}x relative volume).`, cik: item.cik, form: null, accession: null, canonicalSecIndexUrl: null, identityMethod: "not_applicable", mappingStatus: "mapped", mappingMethod: "stored_watchlist_ticker", mappingReason: "The ticker comes from the stored PR262 company exposure index.", tradingViewSymbol: item.tradingViewSymbol, queueAttempts: 0, queueNextAttemptAt: null, queueLastAttemptAt: null, queueLastError: null }];
  });
}

export async function runPr262LightweightSensorV3(input: { now?: Date; fetchImpl?: typeof fetch } = {}) {
  const now = input.now ?? new Date();
  const fetchImpl = input.fetchImpl ?? fetch;
  let exposureError: string | null = null;
  const exposure = await loadPr262ExposureIndex(now).catch((error): Pr262ExposureIndex => {
    exposureError = safeError(error);
    return {
      version: 2,
      valueCycleId: "not_ready",
      builtAt: now.toISOString(),
      valueCoverage: {
        complete: false,
        totalCompanies: 0,
        companiesStored: 0,
        completedBatches: 0,
        totalBatches: 0,
      },
      entries: [],
    };
  });
  const universe = await loadEquityUniverse(fetchImpl, now);
  const resolver = buildStructuredTickerResolver(universe.snapshot.entries);
  const loaded = await loadState();
  const state = loaded.state;
  const summaries: SourceSummary[] = [];
  const events: Pr262SensorEvent[] = [];

  if (exposureError) {
    summaries.push({
      provider: "exposure_index",
      attempted: true,
      status: "not_ready",
      recordsRead: 0,
      newEvents: 0,
      error: exposureError,
      nextRetryAt: null,
    });
  }

  const run = async (provider: string, cadenceMs: number, urls: string[], worker: () => Promise<{ status: string; recordsRead: number; receipts?: EventReceipt[]; events?: Pr262SensorEvent[]; error?: string | null }>) => {
    const key = `v3_${provider}`;
    if (!due(state.sourceHealth, key, cadenceMs, now)) {
      summaries.push({ provider, attempted: false, status: "not_due", recordsRead: 0, newEvents: 0, error: null, nextRetryAt: null });
      return;
    }
    try {
      const value = await worker();
      const converted = value.events ?? (value.receipts ?? []).flatMap((receipt) => receiptToEvent(receipt, provider, resolver, now) ?? []);
      events.push(...converted);
      state.sourceHealth[key] = health(key, value.status, value.recordsRead, value.error ?? null, urls, now, state.sourceHealth[key]);
      summaries.push({ provider, attempted: true, status: value.status, recordsRead: value.recordsRead, newEvents: converted.length, error: value.error ?? null, nextRetryAt: state.sourceHealth[key].nextRetryAt });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 200) : `${provider}_failed`;
      state.sourceHealth[key] = health(key, "temporarily_unavailable", 0, message, urls, now, state.sourceHealth[key]);
      summaries.push({ provider, attempted: true, status: "temporarily_unavailable", recordsRead: 0, newEvents: 0, error: message, nextRetryAt: state.sourceHealth[key].nextRetryAt });
    }
  };

  const urgentForm = URGENT_SEC_FORMS[state.cursors.secUrgentFormIndex % URGENT_SEC_FORMS.length];
  const broadUrl = secUrl(null);
  const urgentUrl = secUrl(urgentForm);
  const newsQuery = GOOGLE_QUERIES[state.cursors.newsQueryIndex % GOOGLE_QUERIES.length];
  const newsUrl = new URL("https://news.google.com/rss/search");
  newsUrl.searchParams.set("q", `${newsQuery} when:1h`);
  newsUrl.searchParams.set("hl", "en-US");
  newsUrl.searchParams.set("gl", "US");
  newsUrl.searchParams.set("ceid", "US:en");

  await Promise.all([
    run("sec_broad", FIVE_MINUTES_MS, [broadUrl], async () => {
      const parsed = parseSecAtomForSensor(await boundedText(fetchImpl, broadUrl, "application/atom+xml,text/xml"), { now, provider: "v3_sec_broad", requestedForm: null });
      return { status: parsed.status ?? "connected", recordsRead: parsed.recordsRead, events: parsed.events, error: parsed.error };
    }),
    run("sec_urgent", FIVE_MINUTES_MS, [urgentUrl], async () => {
      const parsed = parseSecAtomForSensor(await boundedText(fetchImpl, urgentUrl, "application/atom+xml,text/xml"), { now, provider: `v3_sec_${urgentForm.toLowerCase()}`, requestedForm: urgentForm });
      return { status: parsed.status ?? "connected", recordsRead: parsed.recordsRead, events: parsed.events, error: parsed.error };
    }),
    run("google_news", FIVE_MINUTES_MS, [newsUrl.toString()], async () => {
      const parsed = parseRssForPr262Sensor(await boundedText(fetchImpl, newsUrl.toString(), "application/rss+xml,text/xml"), "company_news", "v3_google_news", "news", now);
      return { status: parsed.status ?? "connected", recordsRead: parsed.recordsRead, events: parsed.events, error: parsed.error };
    }),
    run("gdelt", FIFTEEN_MINUTES_MS, ["https://api.gdeltproject.org/api/v2/doc/doc"], async () => {
      const result = await fetchGdeltDiscovery(fetchImpl, now); return { status: result.status, recordsRead: result.recordsRead, receipts: result.receipts, error: result.error };
    }),
    run("marketaux", FIFTEEN_MINUTES_MS, ["https://api.marketaux.com/v1/news/all"], async () => {
      const result = await fetchMarketauxDiscovery(fetchImpl, now); return { status: result.status, recordsRead: result.recordsRead, receipts: result.receipts, error: result.error };
    }),
    run("commerce", THIRTY_MINUTES_MS, ["https://api.commerce.gov/api/news"], async () => {
      const result = await fetchCommerceNews(fetchImpl, now); return { status: result.status, recordsRead: result.recordsRead, receipts: result.receipts, error: result.error };
    }),
    run("alpha_news", SEVENTY_FIVE_MINUTES_MS, ["https://www.alphavantage.co/query"], async () => {
      const result = await fetchAlphaNews(fetchImpl, now); return { status: result.status, recordsRead: result.recordsRead, receipts: result.receipts, error: result.error };
    }),
    run("alpha_earnings", DAY_MS, ["https://www.alphavantage.co/query"], async () => {
      const result = await fetchAlphaEarningsCalendar(fetchImpl, now); return { status: result.status, recordsRead: result.recordsRead, receipts: result.receipts, error: result.error };
    }),
    run("federal_register", THIRTY_MINUTES_MS, ["https://www.federalregister.gov/api/v1/documents.json"], async () => {
      const result = await fetchFederalRegister(fetchImpl, now); return { status: result.status, recordsRead: result.recordsRead, receipts: result.receipts, error: result.error };
    }),
    run("fda_medwatch", FIFTEEN_MINUTES_MS, [FDA_MEDWATCH_RSS_URL], async () => {
      const parsed = parseRssForPr262Sensor(await boundedText(fetchImpl, FDA_MEDWATCH_RSS_URL, "application/rss+xml,text/xml"), "official", "v3_fda_medwatch", "fda_medwatch_safety", now);
      return { status: parsed.status ?? "connected", recordsRead: parsed.recordsRead, events: parsed.events, error: parsed.error };
    }),
    run("openfda", DAY_MS, ["https://api.fda.gov/drug/enforcement.json"], async () => {
      const result = await fetchOpenFdaRecalls(fetchImpl, now); return { status: result.status, recordsRead: result.recordsRead, receipts: result.receipts, error: result.error };
    }),
    run("trade_halts", FIVE_MINUTES_MS, ["https://www.nyse.com/api/trade-halts/current", "https://www.nasdaqtrader.com/rss.aspx?feed=tradehalts"], async () => {
      const result = await fetchNasdaqTradeHalts(fetchImpl, now); return { status: result.status, recordsRead: result.recordsRead, receipts: result.receipts, error: result.error };
    }),
    run("official_all", FIFTEEN_MINUTES_MS, ["all_official_public_feeds"], async () => {
      const rows: ProviderResult[] = await fetchOfficialFeeds(fetchImpl, now);
      return { status: rows.every((item) => item.status === "connected") ? "connected" : rows.some((item) => item.status === "connected") ? "partial" : rows[0]?.status ?? "temporarily_unavailable", recordsRead: rows.reduce((sum, item) => sum + item.recordsRead, 0), receipts: rows.flatMap((item) => item.receipts), error: rows.map((item) => item.error).filter(Boolean).join(" | ").slice(0, 300) || null };
    }),
    run("fmp_news", TWO_HOURS_MS, [FMP_NEWS_URL], async () => runFmpNews(fetchImpl, exposure.entries, now).then((value) => ({ status: value.status, recordsRead: value.recordsRead, receipts: value.receipts, error: value.error }))),
    run("market_watch", FIVE_MINUTES_MS, [TRADINGVIEW_SCAN], async () => {
      const market = await marketWatch(fetchImpl, exposure.entries, now); return { status: "connected", recordsRead: Math.min(500, exposure.entries.length), events: market, error: null };
    }),
  ]);

  if (due(state.sourceHealth, "v3_macro", TWELVE_HOURS_MS, now)) {
    try {
      const macro = await fetchMacroContext(fetchImpl, now);
      const meaningful = macro.context.regime.filter((label) => label !== "no_extreme_macro_change_in_latest_official_observations");
      const macroEvents = meaningful.map((label): Pr262SensorEvent => ({ id: `macro:${hash(`${label}|${now.toISOString().slice(0, 13)}`)}`, source: "official", sourceProvider: "fred_and_frankfurter", sourceHealthStatus: macro.context.status === "connected" ? "connected" : "partial", observedAt: now.toISOString(), title: `Macro regime change: ${label.replace(/_/g, " ")}`, url: macro.context.series.find((item) => item.changeZScore !== null)?.sourceUrl ?? "https://fred.stlouisfed.org/", sourceUrl: "https://fred.stlouisfed.org/", ticker: null, company: null, kind: `macro_${label}`, priority: 88, reason: `Official macro data moved into the ${label.replace(/_/g, " ")} regime. The event will fan out only to sectors with a deterministic exposure link.`, cik: null, form: null, accession: null, canonicalSecIndexUrl: null, identityMethod: "not_applicable", queueAttempts: 0, queueNextAttemptAt: null, queueLastAttemptAt: null, queueLastError: null }));
      events.push(...macroEvents);
      state.sourceHealth.v3_macro = health("v3_macro", macro.context.status, macro.context.series.length, macro.context.errors.join(" | ").slice(0, 300) || null, macro.context.series.map((item) => item.sourceUrl), now, state.sourceHealth.v3_macro);
      summaries.push({ provider: "macro", attempted: true, status: macro.context.status, recordsRead: macro.context.series.length, newEvents: macroEvents.length, error: macro.context.errors.join(" | ").slice(0, 300) || null, nextRetryAt: state.sourceHealth.v3_macro.nextRetryAt });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 200) : "macro_failed";
      state.sourceHealth.v3_macro = health("v3_macro", "temporarily_unavailable", 0, message, ["https://fred.stlouisfed.org/", "https://api.frankfurter.app/"], now, state.sourceHealth.v3_macro);
      summaries.push({ provider: "macro", attempted: true, status: "temporarily_unavailable", recordsRead: 0, newEvents: 0, error: message, nextRetryAt: state.sourceHealth.v3_macro.nextRetryAt });
    }
  } else summaries.push({ provider: "macro", attempted: false, status: "not_due", recordsRead: 0, newEvents: 0, error: null, nextRetryAt: null });

  try {
    const direct = await runPr262DirectAnnouncementMonitor({ exposure: exposure.entries, now, fetchImpl });
    events.push(...direct.events);
    summaries.push({ provider: "direct_issuer_feeds", attempted: direct.feedsPolled > 0 || direct.discoveriesAttempted > 0, status: direct.feedSuccesses === direct.feedsPolled ? "connected" : direct.feedSuccesses > 0 ? "partial" : direct.feedsPolled ? "temporarily_unavailable" : "not_due", recordsRead: direct.events.length, newEvents: direct.events.length, error: null, nextRetryAt: null });
  } catch (error) {
    summaries.push({ provider: "direct_issuer_feeds", attempted: true, status: "temporarily_unavailable", recordsRead: 0, newEvents: 0, error: error instanceof Error ? error.message.slice(0, 200) : "direct_issuer_feeds_failed", nextRetryAt: null });
  }

  const fanout = events.flatMap((event) => fanOut(event, exposure.entries));
  const deduped = [...[...events, ...fanout].reduce((map, event) => {
    const current = map.get(event.id); if (!current || event.priority > current.priority) map.set(event.id, event); return map;
  }, new Map<string, Pr262SensorEvent>()).values()];
  const known = new Set([...state.seen, ...state.pending.map((event) => event.id)]);
  const fresh = deduped.filter((event) => !known.has(event.id)).sort((left, right) => right.priority - left.priority || right.observedAt.localeCompare(left.observedAt)).slice(0, MAX_FRESH);
  const pending = partitionPr262PendingEvents([...state.pending, ...fresh], now);
  const retained = new Set(pending.map((event) => event.id));
  for (const event of fresh) if (retained.has(event.id)) known.add(event.id);

  const next: CompatState = {
    ...state,
    updatedAt: now.toISOString(),
    seen: [...known].slice(-MAX_SEEN),
    pending,
    lastMarketWatchAt: state.sourceHealth.v3_market_watch?.lastSuccessAt ?? state.lastMarketWatchAt,
    cursors: {
      ...state.cursors,
      secUrgentFormIndex: (state.cursors.secUrgentFormIndex + 1) % URGENT_SEC_FORMS.length,
      newsQueryIndex: (state.cursors.newsQueryIndex + 1) % GOOGLE_QUERIES.length,
    },
    sourceHealth: state.sourceHealth,
    sensorReadiness: {
      version: 1,
      checkedAt: now.toISOString(),
      universeReady: pr262UniverseReadyForSensor(universe.snapshot, now),
      universeEntries: universe.snapshot.entries.length,
      exposureReady: exposureError === null && exposure.entries.length > 0,
      exposureEntries: exposure.entries.length,
    },
  };
  const written = await writeVersionedJsonToR2(SENSOR_STATE_KEY, next, loaded.etag ? { expectedEtag: loaded.etag } : { createOnly: true });
  if (written.conflict) throw new Error("pr262_v3_sensor_state_conflict");

  return {
    ok: summaries.some((item) => item.status === "connected" || item.status === "partial"),
    mode: "pr262_lightweight_sensor_v3",
    checkedAt: now.toISOString(),
    sourceSummary: summaries,
    exposureReady: exposureError === null,
    exposureError,
    exposureCompanies: exposure.entries.length,
    newEvents: fresh.length,
    sectorFanoutEvents: fresh.filter((event) => event.mappingMethod === "deterministic_sector_fanout").length,
    pendingEventCount: pending.length,
    costPolicy: {
      aiCalls: 0,
      fullArticleReads: 0,
      fullCompanyWarehouseRebuilds: 0,
      broadSecMinutes: 5,
      prioritySecMinutes: 5,
      googleNewsMinutes: 5,
      tradeHaltMinutes: 5,
      priceWatchMinutes: 5,
      allOfficialFeedsMinutes: 15,
      gdeltMinutes: 15,
      marketauxMinutes: 15,
      commerceMinutes: 30,
      federalRegisterMinutes: 30,
      fdaMedwatchMinutes: 15,
      fmpNewsMinutes: 120,
      alphaNewsMinutes: 75,
      openFdaMinutes: 1440,
      macroMinutes: 720,
      alphaEarningsMinutes: 1440,
      directIssuerFeedTargetMinutes: 60,
    },
  };
}
