import crypto from "node:crypto";
import { readVersionedTextFromR2, writeVersionedJsonToR2 } from "@/lib/r2-warehouse";

const SENSOR_STATE_KEY = "branch-labs/pr-262/sensor/state-v1.json";
const VALUE_STATE_KEY = "branch-labs/pr-262/value-investing/resumable/state.json";
const SEC_AGENT = "SwingUp/1.0 support@swingup.app";
const TRADINGVIEW_SCAN = "https://scanner.tradingview.com/america/scan";

export type Pr262SensorEvent = {
  id: string;
  source: "sec" | "company_news" | "official" | "market_price";
  observedAt: string;
  title: string;
  url: string;
  ticker: string | null;
  company: string | null;
  kind: string;
  priority: number;
  reason: string;
};

type SensorState = {
  version: 1;
  updatedAt: string;
  seen: string[];
  pending: Pr262SensorEvent[];
  lastMarketWatchAt: string | null;
};

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

function hash(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function cleanText(value: string) {
  return value.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, " ").trim();
}

function tag(block: string, name: string) {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
  return cleanText(match?.[1] ?? "");
}

function link(block: string) {
  const href = block.match(/<link\b[^>]*href=["']([^"']+)["']/i)?.[1];
  return cleanText(href ?? tag(block, "link"));
}

function parseDate(value: string, fallback: Date) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : fallback.toISOString();
}

function parseRss(xml: string, source: Pr262SensorEvent["source"], now: Date, kind: string) {
  return [...xml.matchAll(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi)].flatMap((match): Pr262SensorEvent[] => {
    const block = match[0];
    const title = tag(block, "title").slice(0, 300);
    const url = link(block);
    const observedAt = parseDate(tag(block, "pubDate") || tag(block, "updated") || tag(block, "published"), now);
    if (!title || !url) return [];
    const ticker = title.match(/(?:\$|NASDAQ:\s*|NYSE:\s*)([A-Z][A-Z0-9.-]{0,9})\b/i)?.[1]?.toUpperCase() ?? null;
    return [{
      id: hash(`${source}|${url}|${title}|${observedAt}`),
      source,
      observedAt,
      title,
      url,
      ticker,
      company: null,
      kind,
      priority: /earnings|guidance|acquisition|merger|contract|recall|investigation|offering|bankrupt|fda|cyber|tariff|sanction/i.test(title) ? 90 : 60,
      reason: "New public information detected by a cheap central feed; no deep analysis has run yet.",
    }];
  });
}

async function fetchText(url: string, accept: string) {
  const response = await fetch(url, { headers: { Accept: accept, "user-agent": SEC_AGENT }, cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`sensor_http_${response.status}`);
  return response.text();
}

async function secEvents(now: Date) {
  const forms = ["8-K", "6-K", "10-Q", "10-K"];
  const settled = await Promise.allSettled(forms.map(async (form) => {
    const url = new URL("https://www.sec.gov/cgi-bin/browse-edgar");
    url.searchParams.set("action", "getcurrent");
    url.searchParams.set("output", "atom");
    url.searchParams.set("owner", "include");
    url.searchParams.set("count", "100");
    url.searchParams.set("type", form);
    const xml = await fetchText(url.toString(), "application/atom+xml,text/xml");
    return parseRss(xml, "sec", now, form).map((item) => ({ ...item, priority: form === "8-K" || form === "6-K" ? 100 : 85 }));
  }));
  return settled.flatMap((item) => item.status === "fulfilled" ? item.value : []);
}

async function newsEvents(now: Date) {
  const queries = [
    '(earnings OR guidance OR acquisition OR merger OR "contract award" OR recall OR investigation OR offering) (NASDAQ OR NYSE OR company)',
    '("press release" OR "investor relations" OR "company announcement") (NASDAQ OR NYSE)',
    '(FDA OR tariff OR sanctions OR cyberattack OR lawsuit OR bankruptcy OR "product launch") (NASDAQ OR NYSE OR stock)',
  ];
  const q = queries[Math.floor(now.getTime() / 120_000) % queries.length];
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", `${q} when:1h`);
  url.searchParams.set("hl", "en-US");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");
  try {
    return parseRss(await fetchText(url.toString(), "application/rss+xml,text/xml"), "company_news", now, "news");
  } catch {
    return [];
  }
}

async function officialEvents(now: Date) {
  const feeds = [
    ["https://www.sec.gov/news/pressreleases.rss", "sec_press"],
    ["https://www.federalreserve.gov/feeds/press_all.xml", "fed"],
    ["https://www.bls.gov/feed/bls_latest.rss", "bls"],
    ["https://www.cisa.gov/cybersecurity-advisories/all.xml", "cisa"],
  ] as const;
  const [url, kind] = feeds[Math.floor(now.getTime() / 60_000) % feeds.length];
  try {
    return parseRss(await fetchText(url, "application/rss+xml,application/atom+xml,text/xml"), "official", now, kind).map((item) => ({ ...item, priority: 75 }));
  } catch {
    return [];
  }
}

async function readValueWatchlist() {
  const current = await readVersionedTextFromR2(VALUE_STATE_KEY);
  if (!current.found || !current.text) return [] as ValueWatchItem[];
  const parsed = JSON.parse(current.text) as { qualityPriceWatchlist?: ValueWatchItem[] };
  return Array.isArray(parsed.qualityPriceWatchlist) ? parsed.qualityPriceWatchlist.slice(0, 500) : [];
}

async function marketEvents(now: Date, watchlist: ValueWatchItem[]) {
  if (!watchlist.length) return [] as Pr262SensorEvent[];
  const tickers = watchlist.map((item) => item.tradingViewSymbol).filter((value): value is string => Boolean(value));
  if (!tickers.length) return [];
  const response = await fetch(TRADINGVIEW_SCAN, {
    method: "POST",
    headers: { "content-type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      symbols: { tickers, query: { types: [] } },
      columns: ["name", "description", "close", "change", "volume", "relative_volume_10d_calc"],
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return [];
  const body = await response.json() as { data?: Array<{ s?: string; d?: unknown[] }> };
  const byTicker = new Map(watchlist.map((item) => [String(item.ticker ?? "").toUpperCase(), item]));
  return (body.data ?? []).flatMap((row): Pr262SensorEvent[] => {
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
      observedAt: now.toISOString(),
      title: `${ticker} ${kind} at ${price}`,
      url: `https://www.tradingview.com/symbols/${encodeURIComponent(row.s ?? ticker)}/`,
      ticker,
      company: String(item.company ?? data[1] ?? ticker),
      kind,
      priority: threshold === "strong_buy_price_crossed" ? 100 : threshold ? 92 : 80,
      reason: threshold
        ? "Stored company-first valuation threshold was crossed; reuse the existing thesis and inspect only this company."
        : `Unusual market movement detected (${change.toFixed(1)}% change, ${relativeVolume.toFixed(1)}x relative volume).`,
    }];
  });
}

async function loadSensorState(): Promise<{ state: SensorState; etag: string | null }> {
  const current = await readVersionedTextFromR2(SENSOR_STATE_KEY);
  if (!current.found || !current.text) return { state: { version: 1, updatedAt: new Date(0).toISOString(), seen: [], pending: [], lastMarketWatchAt: null }, etag: null };
  const parsed = JSON.parse(current.text) as SensorState;
  return { state: parsed.version === 1 ? parsed : { version: 1, updatedAt: new Date(0).toISOString(), seen: [], pending: [], lastMarketWatchAt: null }, etag: current.etag };
}

export async function runPr262ChangeSensor(now = new Date()) {
  const loaded = await loadSensorState();
  const seen = new Set(loaded.state.seen);
  const marketDue = !loaded.state.lastMarketWatchAt || now.getTime() - Date.parse(loaded.state.lastMarketWatchAt) >= 15 * 60_000;
  const watchlist = marketDue ? await readValueWatchlist().catch(() => []) : [];
  const [sec, news, official, market] = await Promise.all([
    secEvents(now),
    newsEvents(now),
    officialEvents(now),
    marketDue ? marketEvents(now, watchlist).catch(() => []) : Promise.resolve([]),
  ]);
  const fresh = [...sec, ...news, ...official, ...market]
    .filter((item) => !seen.has(item.id))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 100);
  fresh.forEach((item) => seen.add(item.id));
  const pending = [...fresh, ...loaded.state.pending.filter((item) => !fresh.some((next) => next.id === item.id))]
    .sort((a, b) => b.priority - a.priority || b.observedAt.localeCompare(a.observedAt))
    .slice(0, 250);
  const next: SensorState = {
    version: 1,
    updatedAt: now.toISOString(),
    seen: [...seen].slice(-5000),
    pending,
    lastMarketWatchAt: marketDue ? now.toISOString() : loaded.state.lastMarketWatchAt,
  };
  const written = await writeVersionedJsonToR2(SENSOR_STATE_KEY, next, loaded.etag ? { expectedEtag: loaded.etag } : { createOnly: true });
  if (written.conflict) throw new Error("pr262_sensor_state_conflict");
  return {
    ok: true,
    mode: "pr262_change_sensor",
    checkedAt: now.toISOString(),
    newEventCount: fresh.length,
    materialEventCount: fresh.filter((item) => item.priority >= 80).length,
    specialistQueue: fresh.filter((item) => item.priority >= 80).slice(0, 25),
    marketWatchlistChecked: marketDue ? watchlist.length : 0,
    sensorCostPolicy: {
      aiCalls: 0,
      fullCompanyRebuilds: 0,
      fullArticleReads: 0,
      marketWatchCadenceMinutes: 15,
      eventFeedsAreCentralAggregators: true,
      expensiveFallbackWhenQuiet: false,
    },
    safety: { databaseWrites: false, publishing: false, notifications: false, trades: false },
  };
}

export async function readPr262ChangeSensorState() {
  return (await loadSensorState()).state;
}
