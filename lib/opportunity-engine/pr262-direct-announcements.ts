import net from "node:net";
import { lookup } from "node:dns/promises";
import { readVersionedTextFromR2, writeVersionedJsonToR2 } from "@/lib/r2-warehouse";
import { pr262StorageKey } from "@/lib/opportunity-engine/pr262-storage";
import type { Pr262ExposureEntry } from "@/lib/opportunity-engine/pr262-exposure-index";
import type { Pr262SensorEvent } from "@/lib/opportunity-engine/pr262-change-sensor";

const REGISTRY_KEY = pr262StorageKey("sensor/direct-company-feeds-v1.json");
const DISCOVERY_CADENCE_MS = 30 * 60_000;
const NO_FEED_RETRY_MS = 24 * 60 * 60_000;
const FEED_POLL_CADENCE_MS = 60 * 60_000;
const MAX_DISCOVERIES_PER_CYCLE = 24;
const DISCOVERY_CONCURRENCY = 4;
const MAX_FEEDS_POLLED_PER_CYCLE = 20;
const SEC_AGENT = "SwingUp/1.0 support@swingup.app";

type RegistryEntry = {
  ticker: string;
  company: string;
  cik: string;
  investorWebsite: string | null;
  feedUrl: string | null;
  discoveredAt: string;
  lastDiscoveryAt: string;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  nextCheckAt: string | null;
  error: string | null;
};

type Registry = {
  version: 1;
  updatedAt: string;
  discoveryCursor: number;
  lastDiscoveryCycleAt: string | null;
  entries: RegistryEntry[];
};

function emptyRegistry(): Registry {
  return { version: 1, updatedAt: new Date(0).toISOString(), discoveryCursor: 0, lastDiscoveryCycleAt: null, entries: [] };
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block: string, name: string) {
  return cleanXml(block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1] ?? "");
}

function safePriority(title: string) {
  return /bankrupt|restat|guidance|earnings|merger|acquisition|offering|contract|recall|fda|cyber|investigation|ceo|cfo|dividend|buyback/i.test(title) ? 95 : 82;
}

function localAddress(address: string) {
  const normalized = address.toLowerCase().split("%")[0];
  const kind = net.isIP(normalized);
  if (kind === 4) {
    const [a, b, c] = normalized.split(".").map(Number);
    return a === 0
      || a === 10
      || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0 && (c === 0 || c === 2))
      || (a === 192 && b === 88 && c === 99)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19))
      || (a === 198 && b === 51 && c === 100)
      || (a === 203 && b === 0 && c === 113)
      || a >= 224;
  }
  if (kind === 6) return normalized === "::" || normalized === "::1" || /^(?:fc|fd|fe[89ab]|ff)/.test(normalized);
  return true;
}

async function safePublicHttps(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) throw new Error("direct_feed_url_not_https");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || /\.(?:local|internal|home|lan)$/.test(host)) throw new Error("direct_feed_host_blocked");
  const addresses = net.isIP(host) ? [host] : (await lookup(host, { all: true, verbatim: true })).map((item) => item.address);
  if (!addresses.length || addresses.some(localAddress)) throw new Error("direct_feed_address_blocked");
  return url;
}

async function fetchBounded(fetchImpl: typeof fetch, rawUrl: string, accept: string, timeoutMs = 10_000) {
  let current = rawUrl;
  const deadlineAtMs = Date.now() + timeoutMs;
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const remainingMs = deadlineAtMs - Date.now();
    if (remainingMs <= 0) throw new Error("direct_feed_timeout");
    const url = await safePublicHttps(current);
    const response = await fetchImpl(url, {
      headers: { Accept: accept, "user-agent": SEC_AGENT },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(remainingMs),
    });
    if (response.status >= 300 && response.status < 400) {
      if (redirect >= 3) throw new Error("direct_feed_redirect_limit");
      const location = response.headers.get("location");
      if (!location) throw new Error("direct_feed_redirect_location_missing");
      current = new URL(location, url).toString();
      continue;
    }
    if (!response.ok) throw new Error(`direct_feed_http_${response.status}`);
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > 1_000_000) throw new Error("direct_feed_body_too_large");
    const body = await response.text();
    if (Buffer.byteLength(body) > 1_000_000) throw new Error("direct_feed_body_too_large");
    return { body, finalUrl: url.toString() };
  }
  throw new Error("direct_feed_redirect_limit");
}

function discoverFeedUrl(html: string, base: string) {
  const linkTags = [...html.matchAll(/<link\b[^>]*>/gi)].map((match) => match[0]);
  for (const tagValue of linkTags) {
    if (!/(?:application\/rss\+xml|application\/atom\+xml)/i.test(tagValue)) continue;
    const href = tagValue.match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    try { return new URL(href, base).toString(); } catch {}
  }
  const anchors = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)].map((match) => match[1]);
  for (const href of anchors) {
    if (!/(?:rss|atom|feed)(?:\.|\/|\?|$)/i.test(href)) continue;
    try { return new URL(href, base).toString(); } catch {}
  }
  return null;
}

function parseFeed(feed: string, entry: RegistryEntry, now: Date): Pr262SensorEvent[] {
  const blocks = [...feed.matchAll(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi)].map((match) => match[0]);
  return blocks.slice(0, 30).flatMap((block): Pr262SensorEvent[] => {
    const title = tag(block, "title").slice(0, 300);
    const linkText = tag(block, "link");
    const linkHref = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i)?.[1] ?? linkText;
    const published = tag(block, "pubDate") || tag(block, "published") || tag(block, "updated");
    const publishedMs = Date.parse(published);
    if (!title || !linkHref || !Number.isFinite(publishedMs)) return [];
    const ageMs = now.getTime() - publishedMs;
    if (ageMs < -5 * 60_000 || ageMs > 48 * 60 * 60_000) return [];
    let url = linkHref;
    try { url = new URL(linkHref, entry.feedUrl ?? entry.investorWebsite ?? undefined).toString(); } catch {}
    return [{
      id: `issuer:${entry.ticker}:${Buffer.from(`${url}|${title}|${new Date(publishedMs).toISOString()}`).toString("base64url").slice(0, 32)}`,
      source: "official",
      sourceProvider: `issuer_ir_${entry.ticker.toLowerCase()}`,
      sourceHealthStatus: "connected",
      observedAt: new Date(publishedMs).toISOString(),
      title,
      url,
      sourceUrl: entry.feedUrl ?? url,
      ticker: entry.ticker,
      company: entry.company,
      kind: "issuer_announcement",
      priority: safePriority(title),
      reason: "A new announcement was detected directly from the issuer's investor-relations feed.",
      cik: entry.cik,
      form: null,
      accession: null,
      canonicalSecIndexUrl: null,
      identityMethod: "not_applicable",
      mappingStatus: "mapped",
      mappingMethod: "direct_issuer_feed_ticker",
      mappingReason: "The direct issuer feed belongs to the stored ticker and CIK.",
      queueAttempts: 0,
      queueNextAttemptAt: null,
      queueLastAttemptAt: null,
      queueLastError: null,
    }];
  });
}

async function loadRegistry() {
  const current = await readVersionedTextFromR2(REGISTRY_KEY);
  if (!current.found || !current.text) return { registry: emptyRegistry(), etag: current.etag };
  const parsed = JSON.parse(current.text) as Partial<Registry>;
  const registry: Registry = {
    version: 1,
    updatedAt: text(parsed.updatedAt) ?? new Date(0).toISOString(),
    discoveryCursor: Math.max(0, Number(parsed.discoveryCursor) || 0),
    lastDiscoveryCycleAt: text(parsed.lastDiscoveryCycleAt),
    entries: Array.isArray(parsed.entries) ? parsed.entries.filter((entry): entry is RegistryEntry => Boolean(entry && typeof entry.ticker === "string" && typeof entry.cik === "string")) : [],
  };
  return { registry, etag: current.etag };
}

async function seedEnv(registry: Registry, exposure: Pr262ExposureEntry[]) {
  const raw = process.env.SWING_UP_PR262_DIRECT_FEEDS_JSON?.trim();
  if (!raw) return;
  let rows: unknown[] = [];
  try { rows = JSON.parse(raw) as unknown[]; } catch { return; }
  const exposureByTicker = new Map(exposure.map((item) => [item.ticker, item]));
  for (const value of rows) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const row = value as Record<string, unknown>;
    const ticker = text(row.ticker)?.toUpperCase();
    const feedUrl = text(row.feedUrl);
    const company = ticker ? exposureByTicker.get(ticker) : null;
    if (!ticker || !feedUrl || !company?.cik) continue;
    if (registry.entries.some((entry) => entry.ticker === ticker)) continue;
    registry.entries.push({ ticker, company: company.company, cik: company.cik, investorWebsite: null, feedUrl, discoveredAt: new Date().toISOString(), lastDiscoveryAt: new Date().toISOString(), lastCheckedAt: null, lastSuccessAt: null, nextCheckAt: null, error: null });
  }
}

async function discoverOne(fetchImpl: typeof fetch, company: Pr262ExposureEntry, now: Date): Promise<RegistryEntry> {
  if (!company.cik) throw new Error("direct_feed_company_cik_missing");
  const submissionsUrl = `https://data.sec.gov/submissions/CIK${company.cik}.json`;
  const response = await fetchImpl(submissionsUrl, { headers: { Accept: "application/json", "user-agent": SEC_AGENT }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`direct_feed_sec_submissions_http_${response.status}`);
  const body = await response.json() as Record<string, unknown>;
  const investorWebsite = text(body.investorWebsite) ?? text(body.website);
  let feedUrl: string | null = null;
  let error: string | null = null;
  if (investorWebsite) {
    try {
      const page = await fetchBounded(fetchImpl, investorWebsite, "text/html,application/xhtml+xml", 8_000);
      feedUrl = discoverFeedUrl(page.body, page.finalUrl);
      if (feedUrl) await safePublicHttps(feedUrl);
    } catch (cause) {
      error = cause instanceof Error ? cause.message.slice(0, 180) : "direct_feed_discovery_failed";
    }
  }
  return {
    ticker: company.ticker,
    company: company.company,
    cik: company.cik,
    investorWebsite,
    feedUrl,
    discoveredAt: now.toISOString(),
    lastDiscoveryAt: now.toISOString(),
    lastCheckedAt: null,
    lastSuccessAt: null,
    nextCheckAt: feedUrl ? null : new Date(now.getTime() + NO_FEED_RETRY_MS).toISOString(),
    error: feedUrl ? null : error ?? "issuer_rss_feed_not_discovered",
  };
}

export async function runPr262DirectAnnouncementMonitor(input: { exposure: Pr262ExposureEntry[]; now?: Date; fetchImpl?: typeof fetch }) {
  const now = input.now ?? new Date();
  const fetchImpl = input.fetchImpl ?? fetch;
  const loaded = await loadRegistry();
  const registry = loaded.registry;
  await seedEnv(registry, input.exposure);
  const byTicker = new Map(registry.entries.map((entry) => [entry.ticker, entry]));

  const lastDiscoveryMs = registry.lastDiscoveryCycleAt ? Date.parse(registry.lastDiscoveryCycleAt) : 0;
  let discovered = 0;
  if (!Number.isFinite(lastDiscoveryMs) || now.getTime() - lastDiscoveryMs >= DISCOVERY_CADENCE_MS) {
    const candidates = input.exposure.filter((company) => company.cik).sort((left, right) => {
      const watchlistRank = (company: Pr262ExposureEntry) => {
        const price = company.currentPrice;
        if (price === null) return 2;
        if (company.strongBuyBelowPrice !== null && price <= company.strongBuyBelowPrice) return 0;
        if ((company.buyBelowPrice !== null && price <= company.buyBelowPrice)
          || (company.trimAbovePrice !== null && price >= company.trimAbovePrice)) return 1;
        return 2;
      };
      return watchlistRank(left) - watchlistRank(right)
        || right.businessQuality - left.businessQuality
        || (right.marketCap ?? 0) - (left.marketCap ?? 0);
    });
    if (candidates.length) {
      let cursor = registry.discoveryCursor % candidates.length;
      let inspected = 0;
      const discoveryTargets: Array<{ company: Pr262ExposureEntry; existing: RegistryEntry | undefined }> = [];
      while (inspected < candidates.length && discoveryTargets.length < MAX_DISCOVERIES_PER_CYCLE) {
        const company = candidates[cursor];
        cursor = (cursor + 1) % candidates.length;
        inspected += 1;
        const existing = byTicker.get(company.ticker);
        const lastAt = existing?.lastDiscoveryAt ? Date.parse(existing.lastDiscoveryAt) : 0;
        if (existing?.feedUrl || (Number.isFinite(lastAt) && now.getTime() - lastAt < NO_FEED_RETRY_MS)) continue;
        discoveryTargets.push({ company, existing });
      }
      for (let start = 0; start < discoveryTargets.length; start += DISCOVERY_CONCURRENCY) {
        await Promise.all(discoveryTargets.slice(start, start + DISCOVERY_CONCURRENCY).map(async ({ company, existing }) => {
          try {
            const next = await discoverOne(fetchImpl, company, now);
            byTicker.set(company.ticker, next);
          } catch (error) {
            byTicker.set(company.ticker, {
              ticker: company.ticker,
              company: company.company,
              cik: company.cik!,
              investorWebsite: existing?.investorWebsite ?? null,
              feedUrl: existing?.feedUrl ?? null,
              discoveredAt: existing?.discoveredAt ?? now.toISOString(),
              lastDiscoveryAt: now.toISOString(),
              lastCheckedAt: existing?.lastCheckedAt ?? null,
              lastSuccessAt: existing?.lastSuccessAt ?? null,
              nextCheckAt: new Date(now.getTime() + NO_FEED_RETRY_MS).toISOString(),
              error: error instanceof Error ? error.message.slice(0, 180) : "direct_feed_discovery_failed",
            });
          }
          discovered += 1;
        }));
      }
      registry.discoveryCursor = cursor;
      registry.lastDiscoveryCycleAt = now.toISOString();
    }
  }

  registry.entries = [...byTicker.values()];
  const due = registry.entries
    .filter((entry) => entry.feedUrl)
    .filter((entry) => {
      const next = entry.nextCheckAt ? Date.parse(entry.nextCheckAt) : 0;
      return !Number.isFinite(next) || next <= now.getTime();
    })
    .sort((left, right) => Date.parse(left.lastCheckedAt ?? "1970-01-01") - Date.parse(right.lastCheckedAt ?? "1970-01-01"))
    .slice(0, MAX_FEEDS_POLLED_PER_CYCLE);

  const events: Pr262SensorEvent[] = [];
  let feedSuccesses = 0;
  for (const entry of due) {
    try {
      const feed = await fetchBounded(fetchImpl, entry.feedUrl!, "application/rss+xml,application/atom+xml,text/xml", 8_000);
      events.push(...parseFeed(feed.body, entry, now));
      entry.lastCheckedAt = now.toISOString();
      entry.lastSuccessAt = now.toISOString();
      entry.nextCheckAt = new Date(now.getTime() + FEED_POLL_CADENCE_MS).toISOString();
      entry.error = null;
      feedSuccesses += 1;
    } catch (error) {
      entry.lastCheckedAt = now.toISOString();
      entry.nextCheckAt = new Date(now.getTime() + FEED_POLL_CADENCE_MS).toISOString();
      entry.error = error instanceof Error ? error.message.slice(0, 180) : "direct_feed_poll_failed";
    }
  }

  registry.updatedAt = now.toISOString();
  const written = await writeVersionedJsonToR2(REGISTRY_KEY, registry, loaded.etag ? { expectedEtag: loaded.etag } : { createOnly: true });
  if (written.conflict) throw new Error("pr262_direct_feed_registry_conflict");
  return {
    events,
    registeredFeeds: registry.entries.filter((entry) => entry.feedUrl).length,
    feedsPolled: due.length,
    feedSuccesses,
    discoveriesAttempted: discovered,
    registryKey: REGISTRY_KEY,
  };
}
