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
import { loadEquityUniverse, type EquityUniverseEntry } from "@/lib/equity-signal/universe";
import { readVersionedTextFromR2, writeVersionedJsonToR2 } from "@/lib/r2-warehouse";
import {
  partitionPr262PendingEvents,
  runPr262ChangeSensor,
  type Pr262SensorEvent,
  type Pr262SensorSourceHealth,
} from "@/lib/opportunity-engine/pr262-change-sensor";
import { runPr262DirectAnnouncementMonitor } from "@/lib/opportunity-engine/pr262-direct-announcements";
import { loadPr262ExposureIndex, type Pr262ExposureEntry } from "@/lib/opportunity-engine/pr262-exposure-index";

const SENSOR_STATE_KEY = "branch-labs/pr-262/sensor/state-v1.json";
const TRADINGVIEW_SCAN = "https://scanner.tradingview.com/america/scan";
const FMP_NEWS_URL = "https://financialmodelingprep.com/stable/news/stock";
const MAX_SEEN = 20_000;
const MAX_FRESH = 500;
const FIVE_MINUTES_MS = 5 * 60_000;
const FIFTEEN_MINUTES_MS = 15 * 60_000;
const TWENTY_MINUTES_MS = 20 * 60_000;
const THIRTY_MINUTES_MS = 30 * 60_000;
const TWO_HOURS_MS = 2 * 60 * 60_000;
const SIX_HOURS_MS = 6 * 60 * 60_000;
const TWELVE_HOURS_MS = 12 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

type Json = Record<string, unknown>;
type CompatState = {
  version: 2;
  updatedAt: string;
  seen: string[];
  pending: Pr262SensorEvent[];
  lastMarketWatchAt: string | null;
  cursors: { secUrgentFormIndex: number; newsQueryIndex: number; officialFeedIndex: number };
  sourceHealth: Record<string, Pr262SensorSourceHealth>;
};

type SupplementalSourceResult = {
  provider: string;
  attempted: boolean;
  status: string;
  recordsRead: number;
  events: Pr262SensorEvent[];
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

function hash(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function normalizeCik(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits || digits.length > 10 || /^0+$/.test(digits)) return null;
  return digits.padStart(10, "0");
}

function normalizeCompany(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(?:incorporated|inc|corporation|corp|company|co|limited|ltd|plc|holdings?|group|common stock|ordinary shares?|american depositary shares?|ads|adr|class [a-z])\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function priorityForReceipt(receipt: EventReceipt) {
  const value = `${receipt.title} ${receipt.summary ?? ""} ${receipt.rawEventType ?? ""}`.toLowerCase();
  if (/bankrupt|going concern|restat|trading halt|clinical hold|fda.{0,30}(reject|recall)|merger terminated|deal blocked|cyberattack|data breach|sanction|tariff|war|military strike|sec charges|doj charges|fraud/.test(value)) return 100;
  if (/earnings|guidance|acquisition|merger|contract|offering|buyback|dividend|investigation|ceo|cfo|fomc|interest rate|inflation|cpi|jobs|payroll/.test(value)) return 90;
  if (receipt.official || receipt.primarySource) return 75;
  return 65;
}

function accessionFromUrl(raw: string) {
  try {
    const url = new URL(raw);
    const pathname = decodeURIComponent(url.pathname);
    const dashed = pathname.match(/\b(\d{10}-\d{2}-\d{6})\b/)?.[1];
    if (dashed) return dashed;
    const digits = pathname.match(/\/([0-9]{18})(?:\/|$)/)?.[1];
    return digits ? `${digits.slice(0, 10)}-${digits.slice(10, 12)}-${digits.slice(12)}` : null;
  } catch {
    return null;
  }
}

function cikFromReceipt(receipt: EventReceipt) {
  const hint = receipt.companyHints.find((value) => /^CIK\d+$/i.test(value));
  return normalizeCik(hint);
}

function structuredTicker(receipt: EventReceipt) {
  const hint = receipt.symbolHints.find((value) => /^[A-Z][A-Z0-9.-]{0,9}$/i.test(value));
  if (hint) return hint.toUpperCase();
  const textValue = `${receipt.title} ${receipt.summary ?? ""}`;
  return textValue.match(/(?:\$|NASDAQ:\s*|NYSE:\s*|AMEX:\s*)([A-Z][A-Z0-9.-]{0,9})\b/)?.[1]?.toUpperCase() ?? null;
}

function buildAliasResolver(entries: EquityUniverseEntry[]) {
  const aliasMap = new Map<string, string | null>();
  const display = new Map<string, string>();
  for (const entry of entries) {
    display.set(entry.ticker, entry.name);
    const aliases = [...new Set([entry.name, ...entry.aliases].map(normalizeCompany).filter((alias) => alias.length >= 5))];
    for (const alias of aliases) {
      if (!aliasMap.has(alias)) aliasMap.set(alias, entry.ticker);
      else if (aliasMap.get(alias) !== entry.ticker) aliasMap.set(alias, null);
    }
  }
  const aliases = [...aliasMap.entries()]
    .filter((item): item is [string, string] => Boolean(item[1]))
    .sort((left, right) => right[0].length - left[0].length);
  return {
    resolve(receipt: EventReceipt) {
      const direct = structuredTicker(receipt);
      if (direct && display.has(direct)) return { ticker: direct, company: display.get(direct) ?? direct, method: "structured_ticker" };
      for (const companyHint of receipt.companyHints) {
        const normalized = normalizeCompany(companyHint.replace(/^CIK\d+$/i, ""));
        const ticker = aliasMap.get(normalized);
        if (ticker) return { ticker, company: display.get(ticker) ?? companyHint, method: "company_hint_exact_alias" };
      }
      const haystack = ` ${normalizeCompany(`${receipt.title} ${receipt.summary ?? ""}`)} `;
      const matches = new Map<string, string>();
      for (const [alias, ticker] of aliases) {
        if (!haystack.includes(` ${alias} `)) continue;
        matches.set(ticker, alias);
        if (matches.size > 1) break;
      }
      if (matches.size === 1) {
        const ticker = [...matches.keys()][0];
        return { ticker, company: display.get(ticker) ?? ticker, method: "unique_full_company_alias" };
      }
      return { ticker: null, company: null, method: matches.size > 1 ? "ambiguous_company_alias" : "unmapped" };
    },
  };
}

function receiptSource(receipt: EventReceipt, provider: string): Pr262SensorEvent["source"] {
  if (receipt.channel === "nasdaq_trade_halts") return "official";
  if (receipt.channel === "openfda") return "official";
  if (receipt.official || receipt.primarySource) return "official";
  if (/alpha|marketaux|gdelt|google|fmp/i.test(provider)) return "company_news";
  return "official";
}

function receiptToEvent(receipt: EventReceipt, provider: string, resolver: ReturnType<typeof buildAliasResolver>, now: Date): Pr262SensorEvent | null {
  const observedMs = Date.parse(receipt.publishedAt);
  if (!Number.isFinite(observedMs) || observedMs > now.getTime() + 5 * 60_000 || now.getTime() - observedMs > 14 * DAY_MS) return null;
  const source = receiptSource(receipt, provider);
  const resolved = resolver.resolve(receipt);
  const ticker = resolved.ticker;
  const company = resolved.company;
  const cik = receipt.channel === "sec_current_filings" ? cikFromReceipt(receipt) : null;
  const accession = receipt.channel === "sec_current_filings" ? accessionFromUrl(receipt.url) : null;
  const canonicalSecIndexUrl = cik && accession
    ? `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}/${accession}-index.html`
    : null;
  return {
    id: receipt.channel === "sec_current_filings" && accession ? `sec:${accession}` : `v2:${hash(`${provider}|${receipt.id}|${receipt.url}|${receipt.publishedAt}`)}`,
    source: receipt.channel === "sec_current_filings" ? "sec" : source,
    sourceProvider: provider,
    sourceHealthStatus: "connected",
    observedAt: new Date(observedMs).toISOString(),
    title: receipt.title.slice(0, 300),
    url: canonicalSecIndexUrl ?? receipt.url,
    sourceUrl: receipt.url,
    ticker: receipt.channel === "sec_current_filings" ? null : ticker,
    company: receipt.channel === "sec_current_filings" ? null : company,
    kind: receipt.rawEventType ?? receipt.channel,
    priority: priorityForReceipt(receipt),
    reason: receipt.official || receipt.primarySource
      ? "New primary or official information detected by the lightweight sensor; no deep analysis has run yet."
      : "New public company information detected by a low-cost discovery feed; no deep analysis has run yet.",
    cik,
    form: receipt.channel === "sec_current_filings" ? receipt.rawEventType : null,
    accession,
    canonicalSecIndexUrl,
    identityMethod: receipt.channel === "sec_current_filings" && cik && accession ? "official_sec_archive_link" : receipt.channel === "sec_current_filings" ? "sec_identity_unavailable" : "not_applicable",
    ...(ticker ? { mappingStatus: "mapped" as const, mappingMethod: resolved.method, mappingReason: "The source supplied a ticker or one unique full company alias matched the authoritative U.S. universe." } : {}),
    queueAttempts: 0,
    queueNextAttemptAt: null,
    queueLastAttemptAt: null,
    queueLastError: null,
  };
}

function sectorTargets(title: string) {
  const value = title.toLowerCase();
  const sectors = new Set<string>();
  if (/federal reserve|fomc|interest rate|treasury yield|inflation|cpi/.test(value)) {
    ["financial", "real estate", "consumer cyclical"].forEach((item) => sectors.add(item));
  }
  if (/tariff|trade war|export control|sanction|customs|import duty/.test(value)) {
    ["technology", "industrials", "basic materials", "consumer cyclical", "energy"].forEach((item) => sectors.add(item));
  }
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
  const matches = exposure
    .filter((entry) => {
      const haystack = `${entry.sector ?? ""} ${entry.industry ?? ""}`.toLowerCase();
      return targets.some((target) => haystack.includes(target));
    })
    .sort((left, right) => (right.marketCap ?? 0) - (left.marketCap ?? 0) || right.risk - left.risk)
    .slice(0, 30);
  return matches.map((entry) => ({
    ...event,
    id: `${event.id}:fanout:${entry.ticker}`,
    ticker: entry.ticker,
    company: entry.company,
    priority: Math.max(82, event.priority - 3),
    reason: `${event.reason} Market/sector fan-out mapped this event to ${entry.ticker} through its stored ${entry.sector ?? "sector"}/${entry.industry ?? "industry"} exposure.`,
    mappingStatus: "mapped",
    mappingMethod: "deterministic_sector_fanout",
    mappingReason: "The event keyword maps to the company's stored sector or industry exposure; the specialist must still prove issuer-specific transmission before a Serious Signal.",
    tradingViewSymbol: entry.tradingViewSymbol,
  }));
}

async function loadState() {
  const current = await readVersionedTextFromR2(SENSOR_STATE_KEY);
  if (!current.found || !current.text) throw new Error("pr262_sensor_state_missing_after_core_cycle");
  return { state: JSON.parse(current.text) as CompatState, etag: current.etag };
}

function due(health: Record<string, Pr262SensorSourceHealth>, provider: string, cadenceMs: number, now: Date) {
  const prior = health[provider];
  const retryAt = prior?.nextRetryAt ? Date.parse(prior.nextRetryAt) : Number.NaN;
  if (Number.isFinite(retryAt) && retryAt > now.getTime()) return false;
  const successAt = prior?.lastSuccessAt ? Date.parse(prior.lastSuccessAt) : Number.NaN;
  return !Number.isFinite(successAt) || now.getTime() - successAt >= cadenceMs;
}

function resultHealth(provider: string, status: string, recordsRead: number, error: string | null, sourceUrls: string[], now: Date, prior?: Pr262SensorSourceHealth): Pr262SensorSourceHealth {
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
    sourceUrls,
    attemptedThisCycle: true,
    skipReason: null,
  };
}

function providerEvents(result: ProviderResult, resolver: ReturnType<typeof buildAliasResolver>, now: Date) {
  return result.receipts.flatMap((receipt) => receiptToEvent(receipt, result.provider, resolver, now) ?? []);
}

async function runFmpNews(fetchImpl: typeof fetch, exposure: Pr262ExposureEntry[], now: Date) {
  const key = process.env.FMP_API_KEY?.trim();
  if (!key) return { provider: "fmp_news", status: "not_configured", recordsRead: 0, receipts: [] as EventReceipt[], error: "FMP_API_KEY not configured", sourceUrls: [FMP_NEWS_URL] };
  const leaders = exposure.filter((item) => item.businessQuality >= 65).slice(0, 120);
  if (!leaders.length) return { provider: "fmp_news", status: "connected", recordsRead: 0, receipts: [] as EventReceipt[], error: null, sourceUrls: [FMP_NEWS_URL] };
  const bucket = Math.floor(now.getTime() / THIRTY_MINUTES_MS);
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
    return [{
      id: `fmp:${hash(`${ticker}|${articleUrl}|${publishedRaw}`)}`,
      title,
      summary: text(row.text ?? row.summary) ?? null,
      url: articleUrl,
      publisher: "Financial Modeling Prep",
      publishedAt: new Date(publishedMs).toISOString(),
      channel: "gdelt",
      official: false,
      primarySource: false,
      scheduled: false,
      symbolHints: [ticker],
      companyHints: [],
      rawEventType: "fmp_stock_news",
    }];
  });
  return { provider: "fmp_news", status: "connected", recordsRead: rows.length, receipts, error: null, sourceUrls: [FMP_NEWS_URL] };
}

async function marketWatch(fetchImpl: typeof fetch, exposure: Pr262ExposureEntry[], now: Date): Promise<Pr262SensorEvent[]> {
  const watch = exposure
    .filter((item) => item.tradingViewSymbol && (item.buyBelowPrice !== null || item.strongBuyBelowPrice !== null || item.trimAbovePrice !== null || item.businessQuality >= 70))
    .sort((left, right) => right.businessQuality - left.businessQuality || (right.marketCap ?? 0) - (left.marketCap ?? 0))
    .slice(0, 500);
  if (!watch.length) return [];
  const response = await fetchImpl(TRADINGVIEW_SCAN, {
    method: "POST",
    headers: { "content-type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ symbols: { tickers: watch.map((item) => item.tradingViewSymbol), query: { types: [] } }, columns: ["name", "description", "close", "change", "volume", "relative_volume_10d_calc"] }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`pr262_v2_market_http_${response.status}`);
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
    const threshold = item.strongBuyBelowPrice !== null && price <= item.strongBuyBelowPrice ? "strong_buy_price_crossed"
      : item.buyBelowPrice !== null && price <= item.buyBelowPrice ? "buy_price_crossed"
      : item.trimAbovePrice !== null && price >= item.trimAbovePrice ? "trim_price_crossed"
      : null;
    const unusual = Math.abs(change) >= 5 || relativeVolume >= 3;
    if (!threshold && !unusual) return [];
    const kind = threshold ?? "unusual_price_or_volume";
    return [{
      id: `v2-market:${hash(`${ticker}|${kind}|${Math.round(price * 100) / 100}|${now.toISOString().slice(0, 16)}`)}`,
      source: "market_price",
      sourceProvider: "tradingview_quality_watchlist_v2",
      sourceHealthStatus: "connected",
      observedAt: now.toISOString(),
      title: `${ticker} ${kind} at ${price}`,
      url: `https://www.tradingview.com/symbols/${encodeURIComponent(row.s ?? ticker)}/`,
      sourceUrl: TRADINGVIEW_SCAN,
      ticker,
      company: item.company,
      kind,
      priority: threshold === "strong_buy_price_crossed" ? 100 : threshold ? 92 : 80,
      reason: threshold ? "A stored valuation threshold crossed; reuse the existing company thesis and inspect only this ticker." : `A large market change was detected (${change.toFixed(1)}%, ${relativeVolume.toFixed(1)}x relative volume).`,
      cik: item.cik,
      form: null,
      accession: null,
      canonicalSecIndexUrl: null,
      identityMethod: "not_applicable",
      mappingStatus: "mapped",
      mappingMethod: "stored_watchlist_ticker",
      mappingReason: "The ticker comes from the stored PR262 company exposure index.",
      tradingViewSymbol: item.tradingViewSymbol,
      queueAttempts: 0,
      queueNextAttemptAt: null,
      queueLastAttemptAt: null,
      queueLastError: null,
    }];
  });
}

export async function runPr262LightweightSensorV2(input: { now?: Date; fetchImpl?: typeof fetch } = {}) {
  const now = input.now ?? new Date();
  const fetchImpl = input.fetchImpl ?? fetch;
  const core = await runPr262ChangeSensor(now, { fetchImpl });
  const exposure = await loadPr262ExposureIndex(now);
  const universe = await loadEquityUniverse(fetchImpl, now);
  const resolver = buildAliasResolver(universe.snapshot.entries);
  const loaded = await loadState();
  const state = loaded.state;
  const supplemental: SupplementalSourceResult[] = [];
  const discoveredEvents: Pr262SensorEvent[] = [];

  const runProvider = async (provider: string, cadenceMs: number, sourceUrls: string[], runner: () => Promise<ProviderResult | ProviderResult[]>) => {
    if (!due(state.sourceHealth, `v2_${provider}`, cadenceMs, now)) {
      supplemental.push({ provider, attempted: false, status: "not_due", recordsRead: 0, events: [], error: null, nextRetryAt: null });
      return;
    }
    try {
      const value = await runner();
      const rows = Array.isArray(value) ? value : [value];
      const events = rows.flatMap((row) => providerEvents(row, resolver, now));
      discoveredEvents.push(...events);
      const connectedRows = rows.filter((row) => row.status === "connected");
      const status = connectedRows.length === rows.length ? "connected" : connectedRows.length ? "partial" : rows[0]?.status ?? "temporarily_unavailable";
      const recordsRead = rows.reduce((sum, row) => sum + row.recordsRead, 0);
      const error = rows.map((row) => row.error).filter(Boolean).join(" | ").slice(0, 300) || null;
      state.sourceHealth[`v2_${provider}`] = resultHealth(`v2_${provider}`, status, recordsRead, error, sourceUrls, now, state.sourceHealth[`v2_${provider}`]);
      supplemental.push({ provider, attempted: true, status, recordsRead, events, error, nextRetryAt: state.sourceHealth[`v2_${provider}`].nextRetryAt });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 200) : `${provider}_failed`;
      state.sourceHealth[`v2_${provider}`] = resultHealth(`v2_${provider}`, "temporarily_unavailable", 0, message, sourceUrls, now, state.sourceHealth[`v2_${provider}`]);
      supplemental.push({ provider, attempted: true, status: "temporarily_unavailable", recordsRead: 0, events: [], error: message, nextRetryAt: state.sourceHealth[`v2_${provider}`].nextRetryAt });
    }
  };

  await Promise.all([
    runProvider("gdelt", FIFTEEN_MINUTES_MS, ["https://api.gdeltproject.org/api/v2/doc/doc"], () => fetchGdeltDiscovery(fetchImpl, now)),
    runProvider("marketaux", TWENTY_MINUTES_MS, ["https://api.marketaux.com/v1/news/all"], () => fetchMarketauxDiscovery(fetchImpl, now)),
    runProvider("commerce", THIRTY_MINUTES_MS, ["https://api.commerce.gov/api/news"], () => fetchCommerceNews(fetchImpl, now)),
    runProvider("alpha_news", TWO_HOURS_MS, ["https://www.alphavantage.co/query"], () => fetchAlphaNews(fetchImpl, now)),
    runProvider("alpha_earnings", DAY_MS, ["https://www.alphavantage.co/query"], () => fetchAlphaEarningsCalendar(fetchImpl, now)),
    runProvider("federal_register", THIRTY_MINUTES_MS, ["https://www.federalregister.gov/api/v1/documents.json"], () => fetchFederalRegister(fetchImpl, now)),
    runProvider("openfda", SIX_HOURS_MS, ["https://api.fda.gov/drug/enforcement.json"], () => fetchOpenFdaRecalls(fetchImpl, now)),
    runProvider("trade_halts", FIVE_MINUTES_MS, ["https://www.nyse.com/api/trade-halts/current", "https://www.nasdaqtrader.com/rss.aspx?feed=tradehalts"], () => fetchNasdaqTradeHalts(fetchImpl, now)),
    runProvider("official_all", FIFTEEN_MINUTES_MS, ["official_public_feeds"], () => fetchOfficialFeeds(fetchImpl, now)),
  ]);

  if (due(state.sourceHealth, "v2_fmp_news", THIRTY_MINUTES_MS, now)) {
    try {
      const fmp = await runFmpNews(fetchImpl, exposure.entries, now);
      const events = fmp.receipts.flatMap((receipt) => receiptToEvent(receipt, fmp.provider, resolver, now) ?? []);
      discoveredEvents.push(...events);
      state.sourceHealth.v2_fmp_news = resultHealth("v2_fmp_news", fmp.status, fmp.recordsRead, fmp.error, fmp.sourceUrls, now, state.sourceHealth.v2_fmp_news);
      supplemental.push({ provider: "fmp_news", attempted: true, status: fmp.status, recordsRead: fmp.recordsRead, events, error: fmp.error, nextRetryAt: state.sourceHealth.v2_fmp_news.nextRetryAt });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 200) : "fmp_news_failed";
      state.sourceHealth.v2_fmp_news = resultHealth("v2_fmp_news", "temporarily_unavailable", 0, message, [FMP_NEWS_URL], now, state.sourceHealth.v2_fmp_news);
      supplemental.push({ provider: "fmp_news", attempted: true, status: "temporarily_unavailable", recordsRead: 0, events: [], error: message, nextRetryAt: state.sourceHealth.v2_fmp_news.nextRetryAt });
    }
  }

  if (due(state.sourceHealth, "v2_macro", TWELVE_HOURS_MS, now)) {
    try {
      const macro = await fetchMacroContext(fetchImpl, now);
      const meaningful = macro.context.regime.filter((label) => label !== "no_extreme_macro_change_in_latest_official_observations");
      const events = meaningful.map((label): Pr262SensorEvent => ({
        id: `macro:${hash(`${label}|${now.toISOString().slice(0, 13)}`)}`,
        source: "official",
        sourceProvider: "fred_and_frankfurter",
        sourceHealthStatus: macro.context.status === "connected" ? "connected" : "partial",
        observedAt: now.toISOString(),
        title: `Macro regime change: ${label.replace(/_/g, " ")}`,
        url: macro.context.series.find((item) => item.changeZScore !== null)?.sourceUrl ?? "https://fred.stlouisfed.org/",
        sourceUrl: "https://fred.stlouisfed.org/",
        ticker: null,
        company: null,
        kind: `macro_${label}`,
        priority: 88,
        reason: `Official macro data moved into the ${label.replace(/_/g, " ")} regime. The event will be fanned out only to sectors with a deterministic exposure link.`,
        cik: null,
        form: null,
        accession: null,
        canonicalSecIndexUrl: null,
        identityMethod: "not_applicable",
        queueAttempts: 0,
        queueNextAttemptAt: null,
        queueLastAttemptAt: null,
        queueLastError: null,
      }));
      discoveredEvents.push(...events);
      state.sourceHealth.v2_macro = resultHealth("v2_macro", macro.context.status, macro.context.series.length, macro.context.errors.join(" | ").slice(0, 300) || null, macro.context.series.map((item) => item.sourceUrl), now, state.sourceHealth.v2_macro);
      supplemental.push({ provider: "macro", attempted: true, status: macro.context.status, recordsRead: macro.context.series.length, events, error: macro.context.errors.join(" | ").slice(0, 300) || null, nextRetryAt: state.sourceHealth.v2_macro.nextRetryAt });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 200) : "macro_failed";
      state.sourceHealth.v2_macro = resultHealth("v2_macro", "temporarily_unavailable", 0, message, ["https://fred.stlouisfed.org/", "https://api.frankfurter.app/"], now, state.sourceHealth.v2_macro);
    }
  }

  if (due(state.sourceHealth, "v2_market_watch", FIVE_MINUTES_MS, now)) {
    try {
      const events = await marketWatch(fetchImpl, exposure.entries, now);
      discoveredEvents.push(...events);
      state.sourceHealth.v2_market_watch = resultHealth("v2_market_watch", "connected", Math.min(500, exposure.entries.length), null, [TRADINGVIEW_SCAN], now, state.sourceHealth.v2_market_watch);
      supplemental.push({ provider: "market_watch", attempted: true, status: "connected", recordsRead: Math.min(500, exposure.entries.length), events, error: null, nextRetryAt: null });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 200) : "market_watch_failed";
      state.sourceHealth.v2_market_watch = resultHealth("v2_market_watch", "temporarily_unavailable", 0, message, [TRADINGVIEW_SCAN], now, state.sourceHealth.v2_market_watch);
    }
  }

  try {
    const direct = await runPr262DirectAnnouncementMonitor({ exposure: exposure.entries, now, fetchImpl });
    discoveredEvents.push(...direct.events);
    supplemental.push({ provider: "direct_issuer_feeds", attempted: direct.feedsPolled > 0 || direct.discoveriesAttempted > 0, status: direct.feedSuccesses === direct.feedsPolled ? "connected" : direct.feedSuccesses > 0 ? "partial" : direct.feedsPolled ? "temporarily_unavailable" : "not_due", recordsRead: direct.events.length, events: direct.events, error: null, nextRetryAt: null });
  } catch (error) {
    supplemental.push({ provider: "direct_issuer_feeds", attempted: true, status: "temporarily_unavailable", recordsRead: 0, events: [], error: error instanceof Error ? error.message.slice(0, 200) : "direct_issuer_feeds_failed", nextRetryAt: null });
  }

  const fanout = discoveredEvents.flatMap((event) => fanOut(event, exposure.entries));
  const allSupplemental = [...discoveredEvents, ...fanout];
  const priorIds = new Set([...state.seen, ...state.pending.map((event) => event.id)]);
  const fresh = [...allSupplemental.reduce((map, event) => {
    const current = map.get(event.id);
    if (!current || event.priority > current.priority) map.set(event.id, event);
    return map;
  }, new Map<string, Pr262SensorEvent>()).values()]
    .filter((event) => !priorIds.has(event.id))
    .sort((left, right) => right.priority - left.priority || right.observedAt.localeCompare(left.observedAt))
    .slice(0, MAX_FRESH);

  const pending = partitionPr262PendingEvents([...state.pending, ...fresh], now);
  const retained = new Set(pending.map((event) => event.id));
  const seen = new Set(state.seen);
  for (const event of fresh) if (retained.has(event.id)) seen.add(event.id);
  const next: CompatState = {
    ...state,
    version: 2,
    updatedAt: now.toISOString(),
    seen: [...seen].slice(-MAX_SEEN),
    pending,
    lastMarketWatchAt: state.sourceHealth.v2_market_watch?.lastSuccessAt ?? state.lastMarketWatchAt,
    sourceHealth: state.sourceHealth,
  };
  const written = await writeVersionedJsonToR2(SENSOR_STATE_KEY, next, loaded.etag ? { expectedEtag: loaded.etag } : { createOnly: true });
  if (written.conflict) throw new Error("pr262_v2_sensor_state_conflict");

  return {
    ok: core.ok,
    mode: "pr262_lightweight_sensor_v2",
    checkedAt: now.toISOString(),
    core,
    supplementalSources: supplemental.map((item) => ({ provider: item.provider, attempted: item.attempted, status: item.status, recordsRead: item.recordsRead, newEvents: item.events.length, error: item.error, nextRetryAt: item.nextRetryAt })),
    exposureCompanies: exposure.entries.length,
    newSupplementalEvents: fresh.length,
    sectorFanoutEvents: fanout.filter((event) => fresh.some((freshEvent) => freshEvent.id === event.id)).length,
    pendingEventCount: pending.length,
    cheapCyclePolicy: {
      aiCalls: 0,
      fullArticleReads: 0,
      fullCompanyWarehouseRebuilds: 0,
      broadSecMinutes: 5,
      googleNewsMinutes: 5,
      tradeHaltMinutes: 5,
      priceWatchMinutes: 5,
      allOfficialFeedsMinutes: 15,
      gdeltMinutes: 15,
      marketauxMinutes: 20,
      commerceMinutes: 30,
      federalRegisterMinutes: 30,
      fmpNewsMinutes: 30,
      alphaNewsMinutes: 120,
      openFdaMinutes: 360,
      macroMinutes: 720,
      alphaEarningsMinutes: 1440,
      directIssuerFeedsTargetMinutes: 60,
    },
  };
}
