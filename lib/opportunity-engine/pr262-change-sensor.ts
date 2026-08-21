import crypto from "node:crypto";
import { readVersionedTextFromR2, writeVersionedJsonToR2 } from "@/lib/r2-warehouse";
import { pr262StorageKey } from "@/lib/opportunity-engine/pr262-storage";

const SENSOR_STATE_KEY = pr262StorageKey("sensor/state-v1.json");
const VALUE_STATE_KEY = pr262StorageKey("value-investing/resumable/state.json");
const SEC_AGENT = "SwingUp/1.0 support@swingup.app";
const TRADINGVIEW_SCAN = "https://scanner.tradingview.com/america/scan";
const MAX_SEEN = 20_000;
const MAX_READY_PENDING = 2_000;
const MAX_UNRESOLVED_PENDING = 500;
const MAX_FRESH_PER_RUN = 500;
const UNRESOLVED_EVENT_TTL_MS = 24 * 60 * 60_000;
const FIVE_MINUTES_MS = 5 * 60_000;
const FIFTEEN_MINUTES_MS = 15 * 60_000;
const MAX_SOURCE_CLOCK_SKEW_MS = FIVE_MINUTES_MS;
const SEC_URGENT_FORMS = ["8-K", "6-K", "424B5", "S-3", "10-Q", "10-K"] as const;
const NEWS_QUERIES = [
  '(earnings OR guidance OR acquisition OR merger OR "contract award" OR recall OR investigation OR offering) (NASDAQ OR NYSE OR company)',
  '("press release" OR "investor relations" OR "company announcement") (NASDAQ OR NYSE)',
  '(FDA OR tariff OR sanctions OR cyberattack OR lawsuit OR bankruptcy OR "product launch") (NASDAQ OR NYSE OR stock)',
] as const;
const OFFICIAL_FEEDS = [
  { url: "https://www.sec.gov/news/pressreleases.rss", kind: "sec_press" },
  { url: "https://www.federalreserve.gov/feeds/press_all.xml", kind: "fed" },
  { url: "https://www.bls.gov/feed/bls_latest.rss", kind: "bls" },
  { url: "https://www.cisa.gov/cybersecurity-advisories/all.xml", kind: "cisa" },
] as const;

export type Pr262SensorProviderStatus =
  | "connected"
  | "partial"
  | "not_due"
  | "temporarily_unavailable"
  | "rate_limited"
  | "failed";

export type Pr262SensorSourceHealth = {
  provider: string;
  status: Pr262SensorProviderStatus;
  checkedAt: string | null;
  lastSuccessAt: string | null;
  lastSuccessStatus: "connected" | "partial" | null;
  nextRetryAt: string | null;
  consecutiveFailures: number;
  recordsRead: number;
  error: string | null;
  sourceUrls: string[];
  attemptedThisCycle: boolean;
  skipReason: "healthy_success_cadence" | "failure_retry_cooldown" | "not_scheduled" | null;
};

export type Pr262SensorEvent = {
  id: string;
  source: "sec" | "company_news" | "official" | "market_price";
  sourceProvider: string;
  sourceHealthStatus: "connected" | "partial";
  observedAt: string;
  title: string;
  url: string;
  sourceUrl: string;
  ticker: string | null;
  company: string | null;
  kind: string;
  priority: number;
  reason: string;
  cik: string | null;
  form: string | null;
  accession: string | null;
  canonicalSecIndexUrl: string | null;
  identityMethod: "official_sec_archive_link" | "sec_identity_unavailable" | "not_applicable";
  mappingStatus?: "mapped" | "unmapped" | "ambiguous";
  mappingMethod?: string;
  mappingReason?: string;
  tradingViewSymbol?: string;
  queueAttempts: number;
  queueNextAttemptAt: string | null;
  queueLastAttemptAt: string | null;
  queueLastError: string | null;
};

type SensorCursors = {
  secUrgentFormIndex: number;
  newsQueryIndex: number;
  officialFeedIndex: number;
  directIssuerFeedIndex: number;
};

export type Pr262SensorReadiness = {
  version: 1;
  checkedAt: string;
  universeReady: boolean;
  universeEntries: number;
  exposureReady: boolean;
  exposureEntries: number;
};

export type Pr262CloudflareSensorMetadata = {
  version: 1;
  owner: "cloudflare_worker";
  lastScanId: string | null;
  lastRunKey: string | null;
  checkedAt: string | null;
};

type SensorState = {
  version: 2;
  updatedAt: string;
  seen: string[];
  pending: Pr262SensorEvent[];
  lastMarketWatchAt: string | null;
  cursors: SensorCursors;
  sourceHealth: Record<string, Pr262SensorSourceHealth>;
  sensorReadiness: Pr262SensorReadiness;
  cloudflareSensor: Pr262CloudflareSensorMetadata | null;
};

export type Pr262SensorState = SensorState;

function processingReady(event: Pr262SensorEvent) {
  return event.priority >= 80
    && Boolean(event.ticker)
    && event.mappingStatus === "mapped"
    && (event.source !== "sec" || (
      event.identityMethod === "official_sec_archive_link"
      && Boolean(event.cik)
      && Boolean(event.accession)
      && Boolean(event.canonicalSecIndexUrl)
    ));
}

function pendingOrder(left: Pr262SensorEvent, right: Pr262SensorEvent, nowMs: number) {
  const retryRank = (event: Pr262SensorEvent) => {
    const retryAt = event.queueNextAttemptAt ? Date.parse(event.queueNextAttemptAt) : Number.NaN;
    if (event.queueAttempts > 0 && (!Number.isFinite(retryAt) || retryAt <= nowMs)) return 0;
    if (event.queueAttempts > 0) return 1;
    return 2;
  };
  const leftRank = retryRank(left);
  const rightRank = retryRank(right);
  return leftRank - rightRank
    || right.priority - left.priority
    || (leftRank === 2
      ? right.observedAt.localeCompare(left.observedAt)
      : left.observedAt.localeCompare(right.observedAt));
}

export function partitionPr262PendingEvents(events: Pr262SensorEvent[], now: Date) {
  const deduped = [...events.reduce((map, event) => {
    const current = map.get(event.id);
    if (!current || event.priority > current.priority || event.queueAttempts > current.queueAttempts) map.set(event.id, event);
    return map;
  }, new Map<string, Pr262SensorEvent>()).values()];
  const nowMs = now.getTime();
  const ready = deduped
    .filter(processingReady)
    .sort((left, right) => pendingOrder(left, right, nowMs))
    .slice(0, MAX_READY_PENDING);
  const unresolved = deduped
    .filter((event) => !processingReady(event))
    .filter((event) => {
      const observedAt = Date.parse(event.observedAt);
      return Number.isFinite(observedAt) && nowMs - observedAt <= UNRESOLVED_EVENT_TTL_MS;
    })
    .sort((left, right) => right.priority - left.priority || right.observedAt.localeCompare(left.observedAt))
    .slice(0, MAX_UNRESOLVED_PENDING);
  return [...ready, ...unresolved];
}

type ValueWatchItem = {
  ticker?: string;
  tradingViewSymbol?: string;
  company?: string;
  currentPrice?: number;
  fairValue?: {
    buyBelowPrice?: number | null;
    strongBuyBelowPrice?: number | null;
    trimAbovePrice?: number | null;
    baseValue?: number | null;
  };
  scores?: { businessQuality?: number; risk?: number };
};

type ProviderAttempt = Pr262SensorSourceHealth & {
  events: Pr262SensorEvent[];
};

type ProviderPayload = {
  events: Pr262SensorEvent[];
  recordsRead: number;
  status?: "connected" | "partial";
  error?: string | null;
};

type SecAtomParseResult = ProviderPayload & { invalidIdentityCount: number; invalidTimestampCount: number };

function hash(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cleanText(value: string) {
  return value
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function xmlAttribute(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function tag(block: string, name: string) {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
  return cleanText(match?.[1] ?? "");
}

function attribute(block: string, name: string) {
  const match = block.match(new RegExp(`\\b${name}=["']([^"']+)["']`, "i"));
  return xmlAttribute(match?.[1] ?? "").trim();
}

function link(block: string) {
  const candidates = [...block.matchAll(/<link\b[^>]*>/gi)]
    .map((match) => ({
      href: attribute(match[0], "href"),
      rel: attribute(match[0], "rel").toLowerCase(),
    }))
    .filter((item) => Boolean(item.href))
    .sort((left, right) => {
      const score = (item: { href: string; rel: string }) =>
        (/\/archives\/edgar\/data\//i.test(item.href) ? 4 : 0) + (item.rel === "alternate" ? 2 : 0);
      return score(right) - score(left);
    });
  return candidates[0]?.href ?? cleanText(tag(block, "link"));
}

function parseTimestamp(value: string, now: Date) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || ms > now.getTime() + MAX_SOURCE_CLOCK_SKEW_MS) return null;
  return new Date(ms).toISOString();
}

export function normalizePr262SecCik(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits || digits.length > 10 || /^0+$/.test(digits)) return null;
  return digits.padStart(10, "0");
}

function normalizeAccession(value: unknown) {
  const raw = String(value ?? "").trim();
  const dashed = raw.match(/\b(\d{10}-\d{2}-\d{6})\b/)?.[1];
  if (dashed) return dashed;
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 18) return null;
  return `${digits.slice(0, 10)}-${digits.slice(10, 12)}-${digits.slice(12)}`;
}

function secArchiveTarget(rawUrl: string) {
  try {
    const parsed = new URL(xmlAttribute(rawUrl));
    const inlineDocument = parsed.pathname.toLowerCase() === "/ix" ? parsed.searchParams.get("doc") : null;
    return decodeURIComponent(inlineDocument || parsed.pathname);
  } catch {
    return xmlAttribute(rawUrl);
  }
}

function secIdentityFromMetadata(rawUrl: string, block: string) {
  const target = secArchiveTarget(rawUrl);
  const cik = normalizePr262SecCik(
    target.match(/\/archives\/edgar\/data\/(\d+)\//i)?.[1]
      || tag(block, "cik-number"),
  );
  const pathAccession = target.match(/\/(\d{18})(?:\/|$)/)?.[1]
    ?? target.match(/\b(\d{10}-\d{2}-\d{6})\b/)?.[1]
    ?? null;
  const accession = normalizeAccession(
    pathAccession
      || tag(block, "accession-number")
      || block.match(/\bAcc(?:ession)?\s*(?:No\.?|Number)?\s*:?\s*(\d{10}-\d{2}-\d{6})\b/i)?.[1]
      || tag(block, "id"),
  );
  const canonicalSecIndexUrl = cik && accession
    ? `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}/${accession}-index.html`
    : null;
  return { cik, accession, canonicalSecIndexUrl };
}

function secForm(block: string, requestedForm: string | null, title: string) {
  const category = [...block.matchAll(/<category\b[^>]*>/gi)]
    .map((match) => attribute(match[0], "term"))
    .find(Boolean);
  return (category || requestedForm || title.match(/^([A-Z0-9-]+)\s+-\s+/i)?.[1] || "unknown").toUpperCase();
}

function secPriority(form: string, title: string) {
  if (["8-K", "6-K", "424B5", "S-3", "S-1", "F-1"].includes(form)) return 100;
  if (["10-Q", "10-K", "20-F"].includes(form)) return 85;
  return /offering|bankrupt|merger|acquisition|tender|material agreement/i.test(title) ? 95 : 75;
}

export function parseSecAtomForSensor(
  xml: string,
  input: { now: Date; provider: string; requestedForm: string | null },
): SecAtomParseResult {
  if (!/<feed\b/i.test(xml)) throw new Error("sensor_invalid_sec_atom");
  const blocks = [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((match) => match[0]);
  let invalidIdentityCount = 0;
  let invalidTimestampCount = 0;
  const events = blocks.flatMap((block): Pr262SensorEvent[] => {
    const title = tag(block, "title").slice(0, 300);
    const sourceUrl = link(block);
    if (!title || !sourceUrl) return [];
    const form = secForm(block, input.requestedForm, title);
    const observedAt = parseTimestamp(
      tag(block, "updated") || tag(block, "published") || tag(block, "filing-date"),
      input.now,
    );
    if (!observedAt) {
      invalidTimestampCount += 1;
      return [];
    }
    const identity = secIdentityFromMetadata(sourceUrl, block);
    if (!identity.cik || !identity.accession || !identity.canonicalSecIndexUrl) invalidIdentityCount += 1;
    return [{
      id: identity.accession ? `sec:${identity.accession}` : `sec-unresolved:${hash(`${sourceUrl}|${title}|${observedAt}`)}`,
      source: "sec",
      sourceProvider: input.provider,
      sourceHealthStatus: "connected",
      observedAt,
      title,
      url: identity.canonicalSecIndexUrl ?? sourceUrl,
      sourceUrl,
      ticker: null,
      company: null,
      kind: form,
      priority: secPriority(form, title),
      reason: identity.cik
        ? "A new SEC filing was detected and must be mapped only through its official SEC issuer number before any specialist work."
        : "A new SEC filing was detected, but official issuer identity is incomplete; it is retained and blocked from specialist work.",
      cik: identity.cik,
      form,
      accession: identity.accession,
      canonicalSecIndexUrl: identity.canonicalSecIndexUrl,
      identityMethod: identity.cik && identity.accession ? "official_sec_archive_link" : "sec_identity_unavailable",
      queueAttempts: 0,
      queueNextAttemptAt: null,
      queueLastAttemptAt: null,
      queueLastError: null,
    }];
  });
  const errors = [
    ...(invalidIdentityCount > 0 ? [`sec_entries_missing_official_identity:${invalidIdentityCount}`] : []),
    ...(invalidTimestampCount > 0 ? [`sec_entries_invalid_timestamp:${invalidTimestampCount}`] : []),
  ];
  return {
    events,
    recordsRead: blocks.length,
    status: errors.length > 0 ? "partial" : "connected",
    error: errors.length > 0 ? errors.join("|") : null,
    invalidIdentityCount,
    invalidTimestampCount,
  };
}

export function parseRssForPr262Sensor(
  xml: string,
  source: Pr262SensorEvent["source"],
  provider: string,
  kind: string,
  now = new Date(),
): ProviderPayload {
  if (!/<(?:rss|feed|rdf:RDF)\b/i.test(xml)) throw new Error("sensor_invalid_feed");
  const blocks = [...xml.matchAll(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi)].map((match) => match[0]);
  let invalidTimestampCount = 0;
  const events = blocks.flatMap((block): Pr262SensorEvent[] => {
    const title = tag(block, "title").slice(0, 300);
    const url = link(block);
    const observedAt = parseTimestamp(
      tag(block, "pubDate") || tag(block, "updated") || tag(block, "published"),
      now,
    );
    if (!observedAt) {
      invalidTimestampCount += 1;
      return [];
    }
    if (!title || !url) return [];
    const ticker = title.match(/(?:\$|NASDAQ:\s*|NYSE:\s*)([A-Z][A-Z0-9.-]{0,9})\b/i)?.[1]?.toUpperCase() ?? null;
    return [{
      id: hash(`${source}|${url}|${title}|${observedAt}`),
      source,
      sourceProvider: provider,
      sourceHealthStatus: "connected",
      observedAt,
      title,
      url,
      sourceUrl: url,
      ticker,
      company: null,
      kind,
      priority: /earnings|guidance|acquisition|merger|contract|recall|investigation|offering|bankrupt|fda|cyber|tariff|sanction/i.test(title) ? 90 : 60,
      reason: "New public information detected by a cheap central feed; no deep analysis has run yet.",
      cik: null,
      form: null,
      accession: null,
      canonicalSecIndexUrl: null,
      identityMethod: "not_applicable",
      mappingStatus: "mapped",
      mappingMethod: "stored_watchlist_ticker",
      mappingReason: "The ticker comes from the stored company-first valuation watchlist.",
      queueAttempts: 0,
      queueNextAttemptAt: null,
      queueLastAttemptAt: null,
      queueLastError: null,
    }];
  });
  return {
    events,
    recordsRead: blocks.length,
    status: invalidTimestampCount > 0 ? "partial" : "connected",
    error: invalidTimestampCount > 0 ? `feed_entries_invalid_timestamp:${invalidTimestampCount}` : null,
  };
}

async function fetchText(fetchImpl: typeof fetch, url: string, accept: string) {
  const response = await fetchImpl(url, {
    headers: { Accept: accept, "user-agent": SEC_AGENT },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`sensor_http_${response.status}`);
  return response.text();
}

function secFeedUrl(form: string | null) {
  const url = new URL("https://www.sec.gov/cgi-bin/browse-edgar");
  url.searchParams.set("action", "getcurrent");
  url.searchParams.set("output", "atom");
  url.searchParams.set("owner", "include");
  url.searchParams.set("count", "100");
  if (form) url.searchParams.set("type", form);
  return url.toString();
}

async function secFeed(fetchImpl: typeof fetch, now: Date, provider: string, form: string | null) {
  const url = secFeedUrl(form);
  const xml = await fetchText(fetchImpl, url, "application/atom+xml,text/xml");
  return { url, payload: parseSecAtomForSensor(xml, { now, provider, requestedForm: form }) };
}

async function newsEvents(fetchImpl: typeof fetch, now: Date, queryIndex: number) {
  const q = NEWS_QUERIES[queryIndex % NEWS_QUERIES.length];
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", `${q} when:1h`);
  url.searchParams.set("hl", "en-US");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");
  return {
    url: url.toString(),
    payload: parseRssForPr262Sensor(
      await fetchText(fetchImpl, url.toString(), "application/rss+xml,text/xml"),
      "company_news",
      "company_news",
      "news",
      now,
    ),
  };
}

async function readValueWatchlist() {
  const current = await readVersionedTextFromR2(VALUE_STATE_KEY);
  if (!current.found || !current.text) throw new Error("value_watchlist_state_unavailable");
  const parsed = JSON.parse(current.text) as { qualityPriceWatchlist?: ValueWatchItem[] };
  if (!Array.isArray(parsed.qualityPriceWatchlist)) throw new Error("value_watchlist_state_invalid");
  return parsed.qualityPriceWatchlist.slice(0, 500);
}

async function marketEvents(fetchImpl: typeof fetch, now: Date, watchlist: ValueWatchItem[]) {
  if (!watchlist.length) return { events: [] as Pr262SensorEvent[], recordsRead: 0, status: "connected" as const, error: null };
  const tickers = watchlist.map((item) => item.tradingViewSymbol).filter((value): value is string => Boolean(value));
  if (!tickers.length) return { events: [] as Pr262SensorEvent[], recordsRead: 0, status: "connected" as const, error: null };
  const response = await fetchImpl(TRADINGVIEW_SCAN, {
    method: "POST",
    headers: { "content-type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      symbols: { tickers, query: { types: [] } },
      columns: ["name", "description", "close", "change", "volume", "relative_volume_10d_calc"],
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`sensor_http_${response.status}`);
  const body = await response.json() as { data?: Array<{ s?: string; d?: unknown[] }> };
  if (!Array.isArray(body.data)) throw new Error("sensor_invalid_market_payload");
  const byTicker = new Map(watchlist.map((item) => [String(item.ticker ?? "").toUpperCase(), item]));
  const events = body.data.flatMap((row): Pr262SensorEvent[] => {
    const data = Array.isArray(row.d) ? row.d : [];
    const ticker = String(data[0] ?? "").toUpperCase();
    const price = Number(data[2]);
    const change = Number(data[3]);
    const relativeVolume = Number(data[5]);
    const item = byTicker.get(ticker);
    if (!item || !Number.isFinite(price) || price <= 0) return [];
    const strongBuy = Number(item.fairValue?.strongBuyBelowPrice);
    const buyBelow = Number(item.fairValue?.buyBelowPrice);
    const trimAbove = Number(item.fairValue?.trimAbovePrice);
    const threshold = Number.isFinite(strongBuy) && price <= strongBuy ? "strong_buy_price_crossed"
      : Number.isFinite(buyBelow) && price <= buyBelow ? "buy_price_crossed"
      : Number.isFinite(trimAbove) && price >= trimAbove ? "trim_price_crossed"
      : null;
    const unusualMove = Math.abs(change) >= 5 || relativeVolume >= 3;
    if (!threshold && !unusualMove) return [];
    const kind = threshold ?? "unusual_price_or_volume";
    return [{
      id: hash(`market|${ticker}|${kind}|${Math.round(price * 100) / 100}|${now.toISOString().slice(0, 16)}`),
      source: "market_price",
      sourceProvider: "market_price",
      sourceHealthStatus: "connected",
      observedAt: now.toISOString(),
      title: `${ticker} ${kind} at ${price}`,
      url: `https://www.tradingview.com/symbols/${encodeURIComponent(row.s ?? ticker)}/`,
      sourceUrl: TRADINGVIEW_SCAN,
      ticker,
      company: String(item.company ?? data[1] ?? ticker),
      kind,
      priority: threshold === "strong_buy_price_crossed" ? 100 : threshold ? 92 : 80,
      reason: threshold
        ? "Stored company-first valuation threshold was crossed; reuse the existing thesis and inspect only this company."
        : `Unusual market movement detected (${change.toFixed(1)}% change, ${relativeVolume.toFixed(1)}x relative volume).`,
      cik: null,
      form: null,
      accession: null,
      canonicalSecIndexUrl: null,
      identityMethod: "not_applicable",
      queueAttempts: 0,
      queueNextAttemptAt: null,
      queueLastAttemptAt: null,
      queueLastError: null,
    }];
  });
  return { events, recordsRead: body.data.length, status: "connected" as const, error: null };
}

function emptyState(): SensorState {
  return {
    version: 2,
    updatedAt: new Date(0).toISOString(),
    seen: [],
    pending: [],
    lastMarketWatchAt: null,
    cursors: { secUrgentFormIndex: 0, newsQueryIndex: 0, officialFeedIndex: 0, directIssuerFeedIndex: 0 },
    sourceHealth: {},
    sensorReadiness: {
      version: 1,
      checkedAt: new Date(0).toISOString(),
      universeReady: false,
      universeEntries: 0,
      exposureReady: false,
      exposureEntries: 0,
    },
    cloudflareSensor: null,
  };
}

function normalizePersistedEvent(value: unknown, now: Date): Pr262SensorEvent | null {
  const item = object(value);
  const source = ["sec", "company_news", "official", "market_price"].includes(String(item.source))
    ? item.source as Pr262SensorEvent["source"]
    : null;
  const title = typeof item.title === "string" ? item.title : "";
  const rawUrl = typeof item.sourceUrl === "string" ? item.sourceUrl : typeof item.url === "string" ? item.url : "";
  if (!source || !title || !rawUrl) return null;
  const form = typeof item.form === "string" ? item.form.toUpperCase() : source === "sec" && typeof item.kind === "string" ? item.kind.toUpperCase() : null;
  const recovered = source === "sec" ? secIdentityFromMetadata(rawUrl, "") : { cik: null, accession: null, canonicalSecIndexUrl: null };
  const cik = source === "sec" ? normalizePr262SecCik(item.cik) ?? recovered.cik : null;
  const accession = source === "sec" ? normalizeAccession(item.accession) ?? recovered.accession : null;
  const canonicalSecIndexUrl = source === "sec"
    ? (typeof item.canonicalSecIndexUrl === "string" && item.canonicalSecIndexUrl ? item.canonicalSecIndexUrl : recovered.canonicalSecIndexUrl)
    : null;
  const trustedSecMapping = source === "sec"
    && item.mappingStatus === "mapped"
    && typeof item.mappingMethod === "string"
    && item.mappingMethod.startsWith("official_sec_cik_exact")
    && Boolean(cik);
  const observedAt = parseTimestamp(String(item.observedAt ?? ""), now);
  if (!observedAt) return null;
  const id = source === "sec" && accession ? `sec:${accession}` : typeof item.id === "string" && item.id ? item.id : hash(`${source}|${rawUrl}|${title}|${observedAt}`);
  return {
    id,
    source,
    sourceProvider: typeof item.sourceProvider === "string" ? item.sourceProvider : source,
    sourceHealthStatus: item.sourceHealthStatus === "partial" ? "partial" : "connected",
    observedAt,
    title,
    url: canonicalSecIndexUrl ?? (typeof item.url === "string" ? item.url : rawUrl),
    sourceUrl: rawUrl,
    ticker: source === "sec" && !trustedSecMapping ? null : typeof item.ticker === "string" ? item.ticker.toUpperCase() : null,
    company: source === "sec" && !trustedSecMapping ? null : typeof item.company === "string" ? item.company : null,
    kind: typeof item.kind === "string" ? item.kind : form ?? "unknown",
    priority: Number.isFinite(Number(item.priority)) ? Number(item.priority) : 60,
    reason: typeof item.reason === "string" ? item.reason : "Persisted sensor event.",
    cik,
    form,
    accession,
    canonicalSecIndexUrl,
    identityMethod: source !== "sec" ? "not_applicable" : cik && accession ? "official_sec_archive_link" : "sec_identity_unavailable",
    ...(item.mappingStatus === "mapped" || item.mappingStatus === "unmapped" || item.mappingStatus === "ambiguous" ? { mappingStatus: item.mappingStatus } : {}),
    ...(typeof item.mappingMethod === "string" ? { mappingMethod: item.mappingMethod } : {}),
    ...(typeof item.mappingReason === "string" ? { mappingReason: item.mappingReason } : {}),
    ...(typeof item.tradingViewSymbol === "string" ? { tradingViewSymbol: item.tradingViewSymbol } : {}),
    queueAttempts: Math.max(0, Number(item.queueAttempts) || 0),
    queueNextAttemptAt: typeof item.queueNextAttemptAt === "string" ? item.queueNextAttemptAt : null,
    queueLastAttemptAt: typeof item.queueLastAttemptAt === "string" ? item.queueLastAttemptAt : null,
    queueLastError: typeof item.queueLastError === "string" ? item.queueLastError : null,
  };
}

function normalizeHealth(value: unknown): Pr262SensorSourceHealth | null {
  const item = object(value);
  if (typeof item.provider !== "string" || !item.provider) return null;
  const statuses: Pr262SensorProviderStatus[] = ["connected", "partial", "not_due", "temporarily_unavailable", "rate_limited", "failed"];
  const status = statuses.includes(item.status as Pr262SensorProviderStatus) ? item.status as Pr262SensorProviderStatus : "failed";
  return {
    provider: item.provider,
    status,
    checkedAt: typeof item.checkedAt === "string" ? item.checkedAt : null,
    lastSuccessAt: typeof item.lastSuccessAt === "string" ? item.lastSuccessAt : null,
    lastSuccessStatus: item.lastSuccessStatus === "connected" || item.lastSuccessStatus === "partial"
      ? item.lastSuccessStatus
      : status === "connected" || status === "partial" ? status : null,
    nextRetryAt: typeof item.nextRetryAt === "string" ? item.nextRetryAt : null,
    consecutiveFailures: Math.max(0, Number(item.consecutiveFailures) || 0),
    recordsRead: Math.max(0, Number(item.recordsRead) || 0),
    error: typeof item.error === "string" ? item.error : null,
    sourceUrls: Array.isArray(item.sourceUrls) ? item.sourceUrls.filter((url): url is string => typeof url === "string").slice(0, 10) : [],
    attemptedThisCycle: item.attemptedThisCycle === true,
    skipReason: item.skipReason === "healthy_success_cadence"
      || item.skipReason === "failure_retry_cooldown"
      || item.skipReason === "not_scheduled"
      ? item.skipReason
      : null,
  };
}

function migrateState(value: unknown, now: Date): SensorState {
  const item = object(value);
  const fallback = emptyState();
  const cursors = object(item.cursors);
  const rawHealth = object(item.sourceHealth);
  const rawReadiness = object(item.sensorReadiness);
  const rawCloudflare = object(item.cloudflareSensor);
  const sourceHealth: Record<string, Pr262SensorSourceHealth> = {};
  for (const [provider, raw] of Object.entries(rawHealth)) {
    const health = normalizeHealth({ ...object(raw), provider });
    if (health) sourceHealth[provider] = health;
  }
  const pending = Array.isArray(item.pending)
    ? item.pending.map((event) => normalizePersistedEvent(event, now)).filter((event): event is Pr262SensorEvent => Boolean(event))
    : [];
  return {
    version: 2,
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : fallback.updatedAt,
    seen: Array.isArray(item.seen) ? item.seen.filter((id): id is string => typeof id === "string").slice(-MAX_SEEN) : [],
    pending: partitionPr262PendingEvents(pending, now),
    lastMarketWatchAt: typeof item.lastMarketWatchAt === "string" ? item.lastMarketWatchAt : null,
    cursors: {
      secUrgentFormIndex: Math.max(0, Number(cursors.secUrgentFormIndex) || 0) % SEC_URGENT_FORMS.length,
      newsQueryIndex: Math.max(0, Number(cursors.newsQueryIndex) || 0) % NEWS_QUERIES.length,
      officialFeedIndex: Math.max(0, Number(cursors.officialFeedIndex) || 0) % OFFICIAL_FEEDS.length,
      directIssuerFeedIndex: Math.max(0, Number(cursors.directIssuerFeedIndex) || 0),
    },
    sourceHealth,
    sensorReadiness: {
      version: 1,
      checkedAt: typeof rawReadiness.checkedAt === "string" && Number.isFinite(Date.parse(rawReadiness.checkedAt))
        ? rawReadiness.checkedAt
        : fallback.sensorReadiness.checkedAt,
      universeReady: rawReadiness.universeReady === true,
      universeEntries: Math.max(0, Number(rawReadiness.universeEntries) || 0),
      exposureReady: rawReadiness.exposureReady === true,
      exposureEntries: Math.max(0, Number(rawReadiness.exposureEntries) || 0),
    },
    cloudflareSensor: rawCloudflare.version === 1 && rawCloudflare.owner === "cloudflare_worker"
      ? {
          version: 1,
          owner: "cloudflare_worker",
          lastScanId: typeof rawCloudflare.lastScanId === "string" ? rawCloudflare.lastScanId : null,
          lastRunKey: typeof rawCloudflare.lastRunKey === "string" ? rawCloudflare.lastRunKey : null,
          checkedAt: typeof rawCloudflare.checkedAt === "string" && Number.isFinite(Date.parse(rawCloudflare.checkedAt))
            ? rawCloudflare.checkedAt
            : null,
        }
      : null,
  };
}

async function loadSensorState(now = new Date()): Promise<{ state: SensorState; etag: string | null }> {
  const current = await readVersionedTextFromR2(SENSOR_STATE_KEY);
  if (!current.found || !current.text) return { state: emptyState(), etag: null };
  return { state: migrateState(JSON.parse(current.text), now), etag: current.etag };
}

function failureStatus(error: unknown): { status: "temporarily_unavailable" | "rate_limited" | "failed"; error: string } {
  const message = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").slice(0, 160);
  if (/sensor_http_429|rate.?limit|quota/i.test(message)) return { status: "rate_limited", error: message || "rate_limited" };
  if (/timeout|abort|network|fetch|sensor_http_5\d\d/i.test(message)) return { status: "temporarily_unavailable", error: message || "temporarily_unavailable" };
  return { status: "failed", error: message || "provider_failed" };
}

function retryDelayMs(status: Pr262SensorProviderStatus, consecutiveFailures: number) {
  if (status === "rate_limited") return 15 * 60_000;
  return Math.min(30 * 60_000, 60_000 * (2 ** Math.max(0, Math.min(5, consecutiveFailures - 1))));
}

async function attemptProvider(input: {
  provider: string;
  sourceUrls: string[];
  prior?: Pr262SensorSourceHealth;
  now: Date;
  successCadenceMs: number;
  run: () => Promise<ProviderPayload>;
}): Promise<ProviderAttempt> {
  const nowMs = input.now.getTime();
  const retryAt = input.prior?.nextRetryAt ? Date.parse(input.prior.nextRetryAt) : Number.NaN;
  if (Number.isFinite(retryAt) && retryAt > nowMs && input.prior) {
    return {
      ...input.prior,
      provider: input.provider,
      sourceUrls: input.prior.sourceUrls,
      attemptedThisCycle: false,
      skipReason: "failure_retry_cooldown",
      events: [],
    };
  }
  const lastSuccessMs = input.prior?.lastSuccessAt ? Date.parse(input.prior.lastSuccessAt) : Number.NaN;
  if (input.prior?.lastSuccessStatus
    && Number.isFinite(lastSuccessMs)
    && nowMs - lastSuccessMs >= 0
    && nowMs - lastSuccessMs < input.successCadenceMs) {
    return {
      provider: input.provider,
      status: "not_due",
      checkedAt: input.prior.checkedAt,
      lastSuccessAt: input.prior.lastSuccessAt,
      lastSuccessStatus: input.prior.lastSuccessStatus,
      nextRetryAt: null,
      consecutiveFailures: 0,
      recordsRead: 0,
      error: null,
      sourceUrls: input.prior.sourceUrls,
      attemptedThisCycle: false,
      skipReason: "healthy_success_cadence",
      events: [],
    };
  }
  try {
    const payload = await input.run();
    const status = payload.status ?? "connected";
    return {
      provider: input.provider,
      status,
      checkedAt: input.now.toISOString(),
      lastSuccessAt: input.now.toISOString(),
      lastSuccessStatus: status,
      nextRetryAt: null,
      consecutiveFailures: 0,
      recordsRead: payload.recordsRead,
      error: payload.error ?? null,
      sourceUrls: input.sourceUrls,
      attemptedThisCycle: true,
      skipReason: null,
      events: payload.events.map((event) => ({ ...event, sourceHealthStatus: status })),
    };
  } catch (error) {
    const failure = failureStatus(error);
    const consecutiveFailures = (input.prior?.consecutiveFailures ?? 0) + 1;
    return {
      provider: input.provider,
      status: failure.status,
      checkedAt: input.now.toISOString(),
      lastSuccessAt: input.prior?.lastSuccessAt ?? null,
      lastSuccessStatus: input.prior?.lastSuccessStatus ?? null,
      nextRetryAt: new Date(nowMs + retryDelayMs(failure.status, consecutiveFailures)).toISOString(),
      consecutiveFailures,
      recordsRead: 0,
      error: failure.error,
      sourceUrls: input.sourceUrls,
      attemptedThisCycle: true,
      skipReason: null,
      events: [],
    };
  }
}

type CoverageAttempt = Pick<ProviderAttempt, "status"> & Partial<Pick<ProviderAttempt, "lastSuccessStatus" | "attemptedThisCycle" | "skipReason">>;

function effectiveSuccessStatus(attempt: CoverageAttempt) {
  if (attempt.status === "connected" || attempt.status === "partial") return attempt.status;
  if (attempt.status === "not_due" && attempt.skipReason === "healthy_success_cadence") return attempt.lastSuccessStatus ?? null;
  return null;
}

function usable(attempt: CoverageAttempt) {
  return effectiveSuccessStatus(attempt) !== null;
}

function polledThisCycle(attempt: CoverageAttempt) {
  return attempt.attemptedThisCycle !== false;
}

export function summarizePr262SensorCoverage(input: {
  secBroad: CoverageAttempt;
  secUrgent: CoverageAttempt;
  companyNews: CoverageAttempt;
  official: CoverageAttempt;
  market?: CoverageAttempt;
  marketDue?: boolean;
}) {
  const secStatuses = [effectiveSuccessStatus(input.secBroad), effectiveSuccessStatus(input.secUrgent)];
  const secUsable = secStatuses.filter(Boolean).length;
  const secStatus = secStatuses.every((status) => status === "connected")
    ? "complete"
    : secUsable > 0 ? "partial" : "blind";
  const companyNewsStatus = effectiveSuccessStatus(input.companyNews);
  const officialStatus = effectiveSuccessStatus(input.official);
  const groups = [
    { source: "sec", status: secStatus, polledThisCycle: polledThisCycle(input.secBroad) || polledThisCycle(input.secUrgent) },
    { source: "company_news", status: companyNewsStatus === "connected" ? "complete" : companyNewsStatus === "partial" ? "partial" : "blind", polledThisCycle: polledThisCycle(input.companyNews) },
    { source: "official", status: officialStatus === "connected" ? "complete" : officialStatus === "partial" ? "partial" : "blind", polledThisCycle: polledThisCycle(input.official) },
  ];
  const usableGroups = groups.filter((group) => group.status !== "blind").length;
  const coreStatus = usableGroups === 0 ? "blind" : groups.every((group) => group.status === "complete") ? "complete" : "partial";
  const marketUnavailable = input.marketDue === true && (!input.market || !usable(input.market));
  const status = coreStatus === "blind" ? "blind" : coreStatus === "complete" && !marketUnavailable ? "complete" : "partial";
  const requiredAttempts = [input.secBroad, input.secUrgent, input.companyNews, input.official, ...(input.marketDue && input.market ? [input.market] : [])];
  return {
    status,
    reliableNoEventConclusion: status === "complete" && requiredAttempts.every(polledThisCycle),
    usableSourceGroups: usableGroups,
    requiredSourceGroups: groups.length,
    groups,
    marketWatch: input.marketDue
      ? { status: input.market?.status ?? "failed", requiredThisCycle: true }
      : { status: "not_due" as const, requiredThisCycle: false },
  } as const;
}

function withoutAttempt(attempt: ProviderAttempt): Pr262SensorSourceHealth {
  return {
    provider: attempt.provider,
    status: attempt.status,
    checkedAt: attempt.checkedAt,
    lastSuccessAt: attempt.lastSuccessAt,
    lastSuccessStatus: attempt.lastSuccessStatus,
    nextRetryAt: attempt.nextRetryAt,
    consecutiveFailures: attempt.consecutiveFailures,
    recordsRead: attempt.recordsRead,
    error: attempt.error,
    sourceUrls: attempt.sourceUrls,
    attemptedThisCycle: attempt.attemptedThisCycle,
    skipReason: attempt.skipReason,
  };
}

export async function runPr262ChangeSensor(
  now = new Date(),
  options: { fetchImpl?: typeof fetch } = {},
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const loaded = await loadSensorState(now);
  const state = loaded.state;
  const urgentFormIndex = state.cursors.secUrgentFormIndex % SEC_URGENT_FORMS.length;
  const urgentForm = SEC_URGENT_FORMS[urgentFormIndex];
  const newsQueryIndex = state.cursors.newsQueryIndex % NEWS_QUERIES.length;
  const officialFeedIndex = state.cursors.officialFeedIndex % OFFICIAL_FEEDS.length;
  const officialFeed = OFFICIAL_FEEDS[officialFeedIndex];
  const officialEventProvider = `official_${officialFeed.kind}`;
  const broadUrl = secFeedUrl(null);
  const urgentUrl = secFeedUrl(urgentForm);
  const newsUrl = new URL("https://news.google.com/rss/search");
  newsUrl.searchParams.set("q", `${NEWS_QUERIES[newsQueryIndex]} when:1h`);
  newsUrl.searchParams.set("hl", "en-US");
  newsUrl.searchParams.set("gl", "US");
  newsUrl.searchParams.set("ceid", "US:en");

  let marketWatchlistChecked = 0;
  const attempts = await Promise.all([
    attemptProvider({
      provider: "sec_broad",
      sourceUrls: [broadUrl],
      prior: state.sourceHealth.sec_broad,
      now,
      successCadenceMs: FIVE_MINUTES_MS,
      run: async () => (await secFeed(fetchImpl, now, "sec_broad", null)).payload,
    }),
    attemptProvider({
      provider: "sec_urgent",
      sourceUrls: [urgentUrl],
      prior: state.sourceHealth.sec_urgent,
      now,
      successCadenceMs: FIFTEEN_MINUTES_MS,
      run: async () => (await secFeed(fetchImpl, now, `sec_urgent_${urgentForm.toLowerCase()}`, urgentForm)).payload,
    }),
    attemptProvider({
      provider: "company_news",
      sourceUrls: [newsUrl.toString()],
      prior: state.sourceHealth.company_news,
      now,
      successCadenceMs: FIVE_MINUTES_MS,
      run: async () => (await newsEvents(fetchImpl, now, newsQueryIndex)).payload,
    }),
    attemptProvider({
      provider: "official",
      sourceUrls: [officialFeed.url],
      prior: state.sourceHealth.official,
      now,
      successCadenceMs: FIFTEEN_MINUTES_MS,
      run: async () => {
        const xml = await fetchText(fetchImpl, officialFeed.url, "application/rss+xml,application/atom+xml,text/xml");
        return parseRssForPr262Sensor(xml, "official", officialEventProvider, officialFeed.kind, now);
      },
    }),
    attemptProvider({
      provider: "market_price",
      sourceUrls: [TRADINGVIEW_SCAN],
      prior: state.sourceHealth.market_price,
      now,
      successCadenceMs: FIFTEEN_MINUTES_MS,
      run: async () => {
        const watchlist = await readValueWatchlist();
        marketWatchlistChecked = watchlist.length;
        return marketEvents(fetchImpl, now, watchlist);
      },
    }),
  ]);
  const [secBroad, secUrgent, companyNews, official, market] = attempts;
  const marketDue = market.status !== "not_due" || market.attemptedThisCycle;
  const coverage = summarizePr262SensorCoverage({ secBroad, secUrgent, companyNews, official, market, marketDue });
  const allEvents = [...secBroad.events, ...secUrgent.events, ...companyNews.events, ...official.events, ...market.events];
  const deduped = [...allEvents.reduce((map, event) => {
    const current = map.get(event.id);
    if (!current || event.priority > current.priority || (current.sourceHealthStatus === "partial" && event.sourceHealthStatus === "connected")) map.set(event.id, event);
    return map;
  }, new Map<string, Pr262SensorEvent>()).values()];
  const seen = new Set([...state.seen, ...state.pending.map((event) => event.id)]);
  const fresh = deduped
    .filter((event) => !seen.has(event.id))
    .sort((left, right) => right.priority - left.priority || right.observedAt.localeCompare(left.observedAt))
    .slice(0, MAX_FRESH_PER_RUN);
  const pending = partitionPr262PendingEvents([...state.pending, ...fresh], now);
  const retainedPendingIds = new Set(pending.map((event) => event.id));
  for (const event of fresh) {
    if (retainedPendingIds.has(event.id)) seen.add(event.id);
  }

  const nextSourceHealth = { ...state.sourceHealth };
  for (const provider of Object.keys(nextSourceHealth)) {
    if (/^sec_urgent_|^official_/.test(provider)) delete nextSourceHealth[provider];
  }
  for (const attempt of attempts) {
    nextSourceHealth[attempt.provider] = withoutAttempt(attempt);
  }
  const next: SensorState = {
    version: 2,
    updatedAt: now.toISOString(),
    seen: [...seen].slice(-MAX_SEEN),
    pending,
    lastMarketWatchAt: market.attemptedThisCycle && usable(market) ? now.toISOString() : state.lastMarketWatchAt,
    cursors: {
      secUrgentFormIndex: secUrgent.attemptedThisCycle && usable(secUrgent)
        ? (urgentFormIndex + 1) % SEC_URGENT_FORMS.length
        : urgentFormIndex,
      newsQueryIndex: companyNews.attemptedThisCycle && usable(companyNews)
        ? (newsQueryIndex + 1) % NEWS_QUERIES.length
        : newsQueryIndex,
      officialFeedIndex: official.attemptedThisCycle && usable(official)
        ? (officialFeedIndex + 1) % OFFICIAL_FEEDS.length
        : officialFeedIndex,
      directIssuerFeedIndex: state.cursors.directIssuerFeedIndex,
    },
    sourceHealth: nextSourceHealth,
    sensorReadiness: state.sensorReadiness,
    cloudflareSensor: null,
  };
  const written = await writeVersionedJsonToR2(SENSOR_STATE_KEY, next, loaded.etag ? { expectedEtag: loaded.etag } : { createOnly: true });
  if (written.conflict) throw new Error("pr262_sensor_state_conflict");
  const sourceHealth = Object.values(nextSourceHealth).sort((left, right) => left.provider.localeCompare(right.provider));
  const materialFresh = fresh.filter((event) => event.priority >= 80);
  return {
    ok: coverage.status !== "blind",
    mode: "pr262_change_sensor",
    checkedAt: now.toISOString(),
    coverageStatus: coverage.status,
    sourceCoverage: coverage,
    sourceHealth,
    newEventCount: fresh.length,
    materialEventCount: materialFresh.length,
    specialistQueue: coverage.status === "blind" ? [] : materialFresh.slice(0, 25),
    marketWatchlistChecked: market.attemptedThisCycle && usable(market) ? marketWatchlistChecked : 0,
    persistedState: {
      key: SENSOR_STATE_KEY,
      pendingEventCount: pending.length,
      seenIdentityCount: next.seen.length,
      cursors: next.cursors,
      retryingProviders: sourceHealth.filter((item) => Boolean(item.nextRetryAt)).map((item) => ({ provider: item.provider, nextRetryAt: item.nextRetryAt })),
    },
    sensorCostPolicy: {
      aiCalls: 0,
      deepAnalysisCalls: 0,
      fullCompanyRebuilds: 0,
      fullArticleReads: 0,
      broadSecCadenceMinutes: 5,
      newsCadenceMinutes: 5,
      urgentSecCadenceMinutes: 15,
      officialCadenceMinutes: 15,
      marketWatchCadenceMinutes: 15,
      secFeedCallsAttempted: [secBroad, secUrgent].filter((attempt) => attempt.attemptedThisCycle).length,
      maximumSecFeedCallsPerCycle: 2,
      eventFeedsAreCentralAggregators: true,
      expensiveFallbackWhenQuiet: false,
      quietCycleDeepWork: false,
    },
    safety: { databaseWrites: false, publishing: false, notifications: false, trades: false },
  };
}

export async function readPr262ChangeSensorState() {
  return (await loadSensorState()).state;
}

export async function readNextPr262PendingSensorEvent(input: {
  now?: Date;
  minimumPriority?: number;
} = {}) {
  const now = input.now ?? new Date();
  const state = (await loadSensorState(now)).state;
  const nowMs = now.getTime();
  const minimumPriority = Math.max(0, Math.min(100, input.minimumPriority ?? 80));
  return state.pending.find((event) => {
    const retryAt = event.queueNextAttemptAt ? Date.parse(event.queueNextAttemptAt) : Number.NaN;
    const retryDue = !Number.isFinite(retryAt) || retryAt <= nowMs;
    return event.priority >= minimumPriority && processingReady(event) && retryDue;
  }) ?? null;
}

export async function acknowledgePr262PendingSensorEvent(eventId: string) {
  const id = eventId.trim();
  if (!id) throw new Error("pr262_sensor_event_id_required");
  const loaded = await loadSensorState();
  const pending = loaded.state.pending.filter((event) => event.id !== id);
  if (pending.length === loaded.state.pending.length) return { acknowledged: false, pendingCount: pending.length };
  const next: SensorState = { ...loaded.state, updatedAt: new Date().toISOString(), pending };
  const written = await writeVersionedJsonToR2(
    SENSOR_STATE_KEY,
    next,
    loaded.etag ? { expectedEtag: loaded.etag } : { createOnly: true },
  );
  if (written.conflict) throw new Error("pr262_sensor_ack_state_conflict");
  return { acknowledged: true, pendingCount: pending.length };
}

export async function retryPr262PendingSensorEvent(input: {
  eventId: string;
  error: string;
  nextRetryAt: string;
  attemptedAt?: Date;
}) {
  const id = input.eventId.trim();
  const retryAt = Date.parse(input.nextRetryAt);
  if (!id) throw new Error("pr262_sensor_event_id_required");
  if (!Number.isFinite(retryAt)) throw new Error("pr262_sensor_retry_time_invalid");
  const attemptedAt = input.attemptedAt ?? new Date();
  const loaded = await loadSensorState();
  let updated = false;
  const pending = loaded.state.pending.map((event) => {
    if (event.id !== id) return event;
    updated = true;
    return {
      ...event,
      queueAttempts: event.queueAttempts + 1,
      queueNextAttemptAt: new Date(retryAt).toISOString(),
      queueLastAttemptAt: attemptedAt.toISOString(),
      queueLastError: input.error.replace(/\s+/g, " ").trim().slice(0, 240) || "event_processing_failed",
    };
  });
  if (!updated) return { retried: false, pendingCount: pending.length };
  const next: SensorState = { ...loaded.state, updatedAt: attemptedAt.toISOString(), pending };
  const written = await writeVersionedJsonToR2(
    SENSOR_STATE_KEY,
    next,
    loaded.etag ? { expectedEtag: loaded.etag } : { createOnly: true },
  );
  if (written.conflict) throw new Error("pr262_sensor_retry_state_conflict");
  return { retried: true, pendingCount: pending.length, nextRetryAt: new Date(retryAt).toISOString() };
}
