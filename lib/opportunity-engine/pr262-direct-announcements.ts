import net from "node:net";
import { lookup } from "node:dns/promises";
import { readVersionedTextFromR2, writeVersionedJsonToR2 } from "@/lib/r2-warehouse";
import { pr262StorageKey } from "@/lib/opportunity-engine/pr262-storage";
import type { Pr262ExposureEntry } from "@/lib/opportunity-engine/pr262-exposure-index";
import type { Pr262SensorEvent } from "@/lib/opportunity-engine/pr262-change-sensor";

const REGISTRY_KEY = pr262StorageKey("sensor/direct-company-feeds-v1.json");
const DISCOVERY_CADENCE_MS = 30 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const OTHER_DISCOVERY_RETRY_MS = DAY_MS;
const CONFIRMED_NO_FEED_RETRY_DAYS = [30, 60, 90] as const;
const TRANSIENT_DISCOVERY_RETRY_MS = 60 * 60_000;
const FEED_POLL_CADENCE_MS = 15 * 60_000;
const MAX_FAILED_FEED_BACKOFF_MS = 6 * 60 * 60_000;
// SEC-submissions discovery has its own durable 190/day ledger. Three
// sequential lookups every 30 minutes are at most 144/day, leaving 46 calls of
// rolling-window headroom and remaining far below the SEC's 10 requests/second
// fair-access ceiling. This clears transient discovery debt without bursts.
const MAX_DISCOVERIES_PER_CYCLE = 3;
const DISCOVERY_CONCURRENCY = 1;
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
  consecutiveConfirmedNoFeedDiscoveries?: number;
  consecutiveFailures?: number;
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

function transientDiscoveryError(value: string | null) {
  return Boolean(value && /budget_guard|minimum_interval|rolling_24h_budget|timeout|temporarily_unavailable|rate[_ ]?limit|http_429|http_5\d\d|fetch failed|enetunreach|econnreset|econnrefused|etimedout|enotfound|eai_again|sec_submissions_invalid_json|und_err/i.test(value));
}

function discoveryFailureMessage(error: unknown) {
  const value = error && (typeof error === "object" || typeof error === "function")
    ? error as { code?: unknown; message?: unknown }
    : null;
  const code = typeof value?.code === "string" ? value.code.toUpperCase() : "";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return `direct_feed_network_${code.toLowerCase()}`;
  const message = typeof value?.message === "string" ? value.message : "direct_feed_discovery_failed";
  if (/\bENOTFOUND\b/i.test(message)) return "direct_feed_network_enotfound";
  if (/\bEAI_AGAIN\b/i.test(message)) return "direct_feed_network_eai_again";
  return message.slice(0, 180);
}

function confirmedNoFeedError(value: string | null) {
  return value === "issuer_rss_feed_not_discovered" || value === "issuer_website_missing_in_sec_submissions";
}

function embeddedProviderRetryAt(error: string | null) {
  const value = error?.match(/;next_retry_at=([^;\s]+)/)?.[1];
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}

function discoveryRetryAt(error: string | null, now: Date) {
  const providerRetryAt = embeddedProviderRetryAt(error);
  if (providerRetryAt !== null && providerRetryAt > now.getTime()) return new Date(providerRetryAt).toISOString();
  const delay = transientDiscoveryError(error) ? TRANSIENT_DISCOVERY_RETRY_MS : OTHER_DISCOVERY_RETRY_MS;
  return new Date(now.getTime() + delay).toISOString();
}

function confirmedNoFeedRetry(entry: RegistryEntry | undefined, now: Date) {
  const consecutiveConfirmedNoFeedDiscoveries = Math.max(
    1,
    Math.floor(Number(entry?.consecutiveConfirmedNoFeedDiscoveries) || 0) + 1,
  );
  const retryDays = CONFIRMED_NO_FEED_RETRY_DAYS[
    Math.min(CONFIRMED_NO_FEED_RETRY_DAYS.length - 1, consecutiveConfirmedNoFeedDiscoveries - 1)
  ];
  return {
    consecutiveConfirmedNoFeedDiscoveries,
    nextCheckAt: new Date(now.getTime() + retryDays * DAY_MS).toISOString(),
  };
}

function effectiveDiscoveryRetryAt(entry: RegistryEntry) {
  if (transientDiscoveryError(entry.error)) {
    const providerRetryAt = embeddedProviderRetryAt(entry.error);
    if (providerRetryAt !== null) return providerRetryAt;
    const lastDiscoveryAt = Date.parse(entry.lastDiscoveryAt);
    return Number.isFinite(lastDiscoveryAt) ? lastDiscoveryAt + TRANSIENT_DISCOVERY_RETRY_MS : Number.NEGATIVE_INFINITY;
  }
  const nextCheckAt = Date.parse(entry.nextCheckAt ?? "");
  return Number.isFinite(nextCheckAt) ? nextCheckAt : Number.NEGATIVE_INFINITY;
}

function normalizeLegacyConfirmedNoFeed(entry: RegistryEntry) {
  if (entry.feedUrl || !confirmedNoFeedError(entry.error)) return entry;
  // Version-one rows used a daily retry and have no miss counter. Upgrade them
  // in place during the ordinary CAS write, without spending a network call.
  const consecutiveConfirmedNoFeedDiscoveries = Math.max(
    1,
    Math.floor(Number(entry.consecutiveConfirmedNoFeedDiscoveries) || 0),
  );
  const lastDiscoveryAt = Date.parse(entry.lastDiscoveryAt);
  const existingNextCheckAt = Date.parse(entry.nextCheckAt ?? "");
  const retryDays = CONFIRMED_NO_FEED_RETRY_DAYS[
    Math.min(CONFIRMED_NO_FEED_RETRY_DAYS.length - 1, consecutiveConfirmedNoFeedDiscoveries - 1)
  ];
  const minimumNextCheckAt = Number.isFinite(lastDiscoveryAt)
    ? lastDiscoveryAt + retryDays * DAY_MS
    : Number.NEGATIVE_INFINITY;
  return {
    ...entry,
    consecutiveConfirmedNoFeedDiscoveries,
    nextCheckAt: Number.isFinite(minimumNextCheckAt)
      ? new Date(Math.max(minimumNextCheckAt, Number.isFinite(existingNextCheckAt) ? existingNextCheckAt : minimumNextCheckAt)).toISOString()
      : entry.nextCheckAt,
  };
}

function failedFeedRetry(entry: RegistryEntry, now: Date) {
  const consecutiveFailures = Math.max(1, Math.floor(Number(entry.consecutiveFailures) || 0) + 1);
  const delayMs = Math.min(MAX_FAILED_FEED_BACKOFF_MS, FEED_POLL_CADENCE_MS * (2 ** Math.min(5, consecutiveFailures - 1)));
  return { consecutiveFailures, nextCheckAt: new Date(now.getTime() + delayMs).toISOString() };
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

const DECISION_GRADE_SEC_FORMS = new Set([
  "8-K", "6-K", "10-Q", "10-K", "20-F", "40-F",
  "424B5", "S-1", "S-3", "SC 13D", "SC 13G", "DEF 14A", "DEFA14A",
]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function indexedText(value: unknown, index: number) {
  return Array.isArray(value) ? text(value[index]) : null;
}

function secObservedAt(acceptance: string | null, filingDate: string | null) {
  const compact = acceptance?.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  const candidate = compact
    ? `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}.000Z`
    : acceptance ?? (filingDate ? `${filingDate}T12:00:00.000Z` : "");
  const milliseconds = Date.parse(candidate);
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function secFormPriority(form: string) {
  if (/^(?:8-K|6-K|424B5)$/.test(form)) return 98;
  if (/^(?:S-1|S-3)$/.test(form)) return 95;
  if (/^(?:10-Q|10-K|20-F|40-F)$/.test(form)) return 93;
  if (/^SC 13[DG]$/.test(form)) return 90;
  return 84;
}

function recentSecFilingEvents(
  body: Record<string, unknown>,
  company: Pr262ExposureEntry,
  submissionsUrl: string,
  now: Date,
): Pr262SensorEvent[] {
  const recent = record(record(body.filings).recent);
  const accessions = Array.isArray(recent.accessionNumber) ? recent.accessionNumber : [];
  const cik = company.cik?.replace(/^0+/, "") || "0";
  return accessions.slice(0, 40).flatMap((_, index): Pr262SensorEvent[] => {
    const accession = indexedText(recent.accessionNumber, index);
    const rawForm = indexedText(recent.form, index);
    if (!accession || !/^\d{10}-\d{2}-\d{6}$/.test(accession) || !rawForm) return [];
    const form = rawForm.toUpperCase().replace(/\s+/g, " ").trim();
    const normalizedForm = form.replace(/\/A$/, "");
    if (!DECISION_GRADE_SEC_FORMS.has(normalizedForm)) return [];
    const observedMs = secObservedAt(
      indexedText(recent.acceptanceDateTime, index),
      indexedText(recent.filingDate, index),
    );
    if (observedMs === null || observedMs > now.getTime() + 5 * 60_000 || now.getTime() - observedMs > 48 * 60 * 60_000) return [];
    const accessionCompact = accession.replace(/-/g, "");
    const canonicalSecIndexUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionCompact}/${accession}-index.html`;
    const items = indexedText(recent.items, index)?.replace(/\s+/g, " ").slice(0, 120);
    const description = indexedText(recent.primaryDocDescription, index)?.replace(/\s+/g, " ").slice(0, 120);
    const detail = items ? ` (items ${items})` : description ? `: ${description}` : "";
    return [{
      id: `sec:${accession}`,
      source: "sec",
      sourceProvider: `issuer_sec_${company.ticker.toLowerCase()}`,
      sourceHealthStatus: "connected",
      observedAt: new Date(observedMs).toISOString(),
      title: `${company.company} filed Form ${form}${detail}`.slice(0, 300),
      url: canonicalSecIndexUrl,
      sourceUrl: submissionsUrl,
      ticker: company.ticker,
      company: company.company,
      kind: "issuer_sec_filing",
      priority: secFormPriority(normalizedForm),
      reason: "A current decision-grade filing was detected from the issuer's official SEC submissions record.",
      cik: company.cik,
      form,
      accession,
      canonicalSecIndexUrl,
      identityMethod: "official_sec_archive_link",
      mappingStatus: "mapped",
      mappingMethod: "direct_issuer_sec_cik",
      mappingReason: "The official SEC submissions record is keyed by the stored issuer CIK.",
      queueAttempts: 0,
      queueNextAttemptAt: null,
      queueLastAttemptAt: null,
      queueLastError: null,
    }];
  });
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
  const trimmed = raw.trim();
  const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  // SEC company profiles sometimes retain an old http:// website even when the
  // same issuer endpoint supports HTTPS. Upgrade before enforcing the public
  // origin policy; a host that does not support HTTPS will still fail closed.
  if (url.protocol === "http:") {
    url.protocol = "https:";
    url.port = "";
  }
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

function discoverInvestorPages(html: string, base: string) {
  const pages = new Map<string, number>();
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = match[1];
    const label = cleanXml(match[2]);
    const combined = `${href} ${label}`.toLowerCase();
    if (!/(?:investor|press|news|media|release|announcement|financial-results)/.test(combined)) continue;
    try {
      const url = new URL(href, base);
      if (!/^https?:$/.test(url.protocol)) continue;
      const rank = /(?:rss|atom|feed)/.test(combined) ? 0
        : /(?:investor|press-release|news-release|announcement)/.test(combined) ? 1
          : 2;
      const prior = pages.get(url.toString());
      if (prior === undefined || rank < prior) pages.set(url.toString(), rank);
    } catch {}
  }
  return [...pages.entries()]
    .sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]))
    .map(([url]) => url)
    .slice(0, 2);
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
  if (!current.found || !current.text) return { registry: emptyRegistry(), etag: current.etag, found: false };
  let parsed: Partial<Registry>;
  try {
    parsed = JSON.parse(current.text) as Partial<Registry>;
  } catch {
    throw new Error("pr262_direct_feed_registry_invalid_json");
  }
  const registry: Registry = {
    version: 1,
    updatedAt: text(parsed.updatedAt) ?? new Date(0).toISOString(),
    discoveryCursor: Math.max(0, Number(parsed.discoveryCursor) || 0),
    lastDiscoveryCycleAt: text(parsed.lastDiscoveryCycleAt),
    entries: Array.isArray(parsed.entries)
      ? parsed.entries
        .filter((entry): entry is RegistryEntry => Boolean(entry && typeof entry.ticker === "string" && typeof entry.cik === "string"))
        .map(normalizeLegacyConfirmedNoFeed)
      : [],
  };
  return { registry, etag: current.etag, found: true };
}

async function seedEnv(registry: Registry, exposure: Pr262ExposureEntry[]) {
  const raw = process.env.SWING_UP_PR262_DIRECT_FEEDS_JSON?.trim();
  if (!raw) return;
  let rows: unknown[] = [];
  try { rows = JSON.parse(raw) as unknown[]; } catch { return; }
  const exposureByTicker = new Map(exposure.map((item) => [item.ticker, item]));
  const seededAt = new Date().toISOString();
  for (const value of rows) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const row = value as Record<string, unknown>;
    const ticker = text(row.ticker)?.toUpperCase();
    const feedUrl = text(row.feedUrl);
    const investorWebsite = text(row.investorWebsite);
    const company = ticker ? exposureByTicker.get(ticker) : null;
    if (!ticker || !feedUrl || !company?.cik) continue;
    const existing = registry.entries.find((entry) => entry.ticker === ticker);
    if (existing) {
      const feedChanged = existing.feedUrl !== feedUrl;
      const websiteChanged = Boolean(investorWebsite && existing.investorWebsite !== investorWebsite);
      existing.consecutiveConfirmedNoFeedDiscoveries = 0;
      if (!feedChanged && !websiteChanged) continue;
      existing.company = company.company;
      existing.cik = company.cik;
      existing.feedUrl = feedUrl;
      if (investorWebsite) existing.investorWebsite = investorWebsite;
      existing.lastDiscoveryAt = seededAt;
      existing.lastCheckedAt = null;
      existing.lastSuccessAt = feedChanged ? null : existing.lastSuccessAt;
      existing.nextCheckAt = null;
      existing.error = null;
      existing.consecutiveFailures = 0;
      continue;
    }
    registry.entries.push({
      ticker,
      company: company.company,
      cik: company.cik,
      investorWebsite,
      feedUrl,
      discoveredAt: seededAt,
      lastDiscoveryAt: seededAt,
      lastCheckedAt: null,
      lastSuccessAt: null,
      nextCheckAt: null,
      error: null,
      consecutiveConfirmedNoFeedDiscoveries: 0,
      consecutiveFailures: 0,
    });
  }
}

async function discoverOne(
  fetchImpl: typeof fetch,
  company: Pr262ExposureEntry,
  now: Date,
  existing?: RegistryEntry,
): Promise<{ entry: RegistryEntry; secEvents: Pr262SensorEvent[] }> {
  if (!company.cik) throw new Error("direct_feed_company_cik_missing");
  const submissionsUrl = `https://data.sec.gov/submissions/CIK${company.cik}.json`;
  const response = await fetchImpl(submissionsUrl, { headers: { Accept: "application/json", "user-agent": SEC_AGENT }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`direct_feed_sec_submissions_http_${response.status}`);
  let body: Record<string, unknown>;
  try {
    const parsed = await response.json() as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid_shape");
    body = parsed as Record<string, unknown>;
  } catch {
    // A truncated/corrupt SEC response is an upstream transport failure, not a
    // confirmed statement that this issuer has no website or feed.
    throw new Error("direct_feed_sec_submissions_invalid_json");
  }
  const secEvents = recentSecFilingEvents(body, company, submissionsUrl, now);
  const investorWebsite = text(body.investorWebsite) ?? text(body.website);
  let feedUrl: string | null = null;
  let error: string | null = null;
  if (investorWebsite) {
    try {
      const page = await fetchBounded(fetchImpl, investorWebsite, "text/html,application/xhtml+xml", 8_000);
      feedUrl = discoverFeedUrl(page.body, page.finalUrl);
      if (feedUrl) feedUrl = (await safePublicHttps(feedUrl)).toString();
      if (!feedUrl) {
        for (const candidate of discoverInvestorPages(page.body, page.finalUrl)) {
          try {
            const nested = await fetchBounded(fetchImpl, candidate, "text/html,application/xhtml+xml,application/rss+xml,application/atom+xml,text/xml", 5_000);
            const directXml = /<(?:rss|feed)\b/i.test(nested.body) ? nested.finalUrl : null;
            const discovered = directXml ?? discoverFeedUrl(nested.body, nested.finalUrl);
            if (!discovered) continue;
            feedUrl = (await safePublicHttps(discovered)).toString();
            break;
          } catch (cause) {
            if (!error) error = discoveryFailureMessage(cause);
          }
        }
      }
    } catch (cause) {
      error = discoveryFailureMessage(cause);
    }
  }
  const missingFeedReason = investorWebsite
    ? "issuer_rss_feed_not_discovered"
    : "issuer_website_missing_in_sec_submissions";
  const finalError = feedUrl ? null : error ?? missingFeedReason;
  const confirmedRetry = confirmedNoFeedError(finalError) ? confirmedNoFeedRetry(existing, now) : null;
  return {
    entry: {
      ticker: company.ticker,
      company: company.company,
      cik: company.cik,
      investorWebsite,
      feedUrl,
      discoveredAt: existing?.discoveredAt ?? now.toISOString(),
      lastDiscoveryAt: now.toISOString(),
      lastCheckedAt: existing?.lastCheckedAt ?? null,
      lastSuccessAt: existing?.lastSuccessAt ?? null,
      nextCheckAt: feedUrl ? null : confirmedRetry?.nextCheckAt ?? discoveryRetryAt(finalError, now),
      error: finalError,
      consecutiveConfirmedNoFeedDiscoveries: feedUrl
        ? 0
        : confirmedRetry?.consecutiveConfirmedNoFeedDiscoveries
          ?? existing?.consecutiveConfirmedNoFeedDiscoveries
          ?? 0,
      consecutiveFailures: existing?.consecutiveFailures ?? 0,
    },
    secEvents,
  };
}

type DiscoveryWorkClass = "unseen" | "transient_retry" | "confirmed_no_feed_recheck" | "other_recheck";

type DiscoveryTarget = {
  company: Pr262ExposureEntry;
  existing: RegistryEntry | undefined;
  workClass: DiscoveryWorkClass;
  watchlistRank: number;
};

function companyWatchlistRank(company: Pr262ExposureEntry) {
  const price = company.currentPrice;
  if (price === null) return 2;
  if (company.strongBuyBelowPrice !== null && price <= company.strongBuyBelowPrice) return 0;
  if ((company.buyBelowPrice !== null && price <= company.buyBelowPrice)
    || (company.trimAbovePrice !== null && price >= company.trimAbovePrice)) return 1;
  return 2;
}

function discoveryTarget(company: Pr262ExposureEntry, existing: RegistryEntry | undefined, now: Date): DiscoveryTarget | null {
  if (existing?.feedUrl) return null;
  const watchlistRank = companyWatchlistRank(company);
  if (!existing) return { company, existing, workClass: "unseen", watchlistRank };
  if (effectiveDiscoveryRetryAt(existing) > now.getTime()) return null;
  const workClass: DiscoveryWorkClass = transientDiscoveryError(existing.error)
    ? "transient_retry"
    : confirmedNoFeedError(existing.error)
      ? "confirmed_no_feed_recheck"
      : "other_recheck";
  return { company, existing, workClass, watchlistRank };
}

function discoveryTier(target: DiscoveryTarget) {
  // A confirmed absence is cheap to remember and expensive to rediscover.
  // Every unresolved/new/transient row must run before every confirmed miss,
  // even when that confirmed miss is on the valuation watchlist.
  if (target.workClass !== "confirmed_no_feed_recheck" && target.watchlistRank < 2) return 0;
  if (target.workClass === "transient_retry") return 1;
  if (target.workClass === "unseen") return 2;
  if (target.workClass === "other_recheck") return 3;
  return 4;
}

function compareDiscoveryTargets(left: DiscoveryTarget, right: DiscoveryTarget) {
  const tierDifference = discoveryTier(left) - discoveryTier(right);
  if (tierDifference) return tierDifference;
  const leftRetryAt = left.existing ? effectiveDiscoveryRetryAt(left.existing) : Number.POSITIVE_INFINITY;
  const rightRetryAt = right.existing ? effectiveDiscoveryRetryAt(right.existing) : Number.POSITIVE_INFINITY;
  return left.watchlistRank - right.watchlistRank
    || leftRetryAt - rightRetryAt
    || right.company.businessQuality - left.company.businessQuality
    || (right.company.marketCap ?? 0) - (left.company.marketCap ?? 0)
    || left.company.ticker.localeCompare(right.company.ticker);
}

export async function runPr262DirectAnnouncementMonitor(input: { exposure: Pr262ExposureEntry[]; now?: Date; fetchImpl?: typeof fetch }) {
  const now = input.now ?? new Date();
  const fetchImpl = input.fetchImpl ?? fetch;
  const loaded = await loadRegistry();
  const registry = loaded.registry;
  await seedEnv(registry, input.exposure);
  const byTicker = new Map(registry.entries.map((entry) => [entry.ticker, entry]));
  const eligibleCompanies = input.exposure.filter((company) => company.cik);
  const events: Pr262SensorEvent[] = [];
  let secSubmissionsChecked = 0;
  let secFilingsFound = 0;
  let discoverySuccesses = 0;
  let discoveryFailures = 0;
  const attemptErrors: string[] = [];
  const discoverySelection = {
    total: 0,
    highPriority: 0,
    unseen: 0,
    transientRetry: 0,
    confirmedNoFeedRecheck: 0,
    otherRecheck: 0,
  };

  const lastDiscoveryMs = registry.lastDiscoveryCycleAt ? Date.parse(registry.lastDiscoveryCycleAt) : 0;
  let discovered = 0;
  if (!Number.isFinite(lastDiscoveryMs) || now.getTime() - lastDiscoveryMs >= DISCOVERY_CADENCE_MS) {
    if (eligibleCompanies.length) {
      const prioritized = eligibleCompanies
        .map((company) => discoveryTarget(company, byTicker.get(company.ticker), now))
        .filter((target): target is DiscoveryTarget => target !== null)
        .sort(compareDiscoveryTargets);
      const discoveryTargets: DiscoveryTarget[] = [];
      const selectedCiks = new Set<string>();
      for (const target of prioritized) {
        if (discoveryTargets.length >= MAX_DISCOVERIES_PER_CYCLE) break;
        if (!target.company.cik || selectedCiks.has(target.company.cik)) continue;
        selectedCiks.add(target.company.cik);
        discoveryTargets.push(target);
      }
      // discoveryCursor remains in the version-one document for backward
      // compatibility. Selection now scans all eligible work before taking
      // three, so a cursor cannot strand transient rows behind unseen ones.
      discoverySelection.total = discoveryTargets.length;
      discoverySelection.highPriority = discoveryTargets.filter((target) => target.watchlistRank < 2).length;
      discoverySelection.unseen = discoveryTargets.filter((target) => target.workClass === "unseen").length;
      discoverySelection.transientRetry = discoveryTargets.filter((target) => target.workClass === "transient_retry").length;
      discoverySelection.confirmedNoFeedRecheck = discoveryTargets.filter((target) => target.workClass === "confirmed_no_feed_recheck").length;
      discoverySelection.otherRecheck = discoveryTargets.filter((target) => target.workClass === "other_recheck").length;
      for (let start = 0; start < discoveryTargets.length; start += DISCOVERY_CONCURRENCY) {
        await Promise.all(discoveryTargets.slice(start, start + DISCOVERY_CONCURRENCY).map(async ({ company, existing }) => {
          try {
            const result = await discoverOne(fetchImpl, company, now, existing);
            byTicker.set(company.ticker, result.entry);
            events.push(...result.secEvents);
            secSubmissionsChecked += 1;
            secFilingsFound += result.secEvents.length;
            if (!result.entry.error || confirmedNoFeedError(result.entry.error)) {
              discoverySuccesses += 1;
            } else {
              discoveryFailures += 1;
              attemptErrors.push(result.entry.error);
            }
          } catch (error) {
            const message = discoveryFailureMessage(error);
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
              nextCheckAt: discoveryRetryAt(message, now),
              error: message,
              consecutiveConfirmedNoFeedDiscoveries: existing?.consecutiveConfirmedNoFeedDiscoveries ?? 0,
              consecutiveFailures: existing?.consecutiveFailures ?? 0,
            });
            discoveryFailures += 1;
            attemptErrors.push(message);
          }
          discovered += 1;
        }));
      }
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

  let feedSuccesses = 0;
  let feedFailures = 0;
  for (const entry of due) {
    try {
      const feed = await fetchBounded(fetchImpl, entry.feedUrl!, "application/rss+xml,application/atom+xml,text/xml", 8_000);
      events.push(...parseFeed(feed.body, entry, now));
      entry.lastCheckedAt = now.toISOString();
      entry.lastSuccessAt = now.toISOString();
      entry.nextCheckAt = new Date(now.getTime() + FEED_POLL_CADENCE_MS).toISOString();
      entry.error = null;
      entry.consecutiveFailures = 0;
      feedSuccesses += 1;
    } catch (error) {
      const retry = failedFeedRetry(entry, now);
      const message = discoveryFailureMessage(error);
      entry.lastCheckedAt = now.toISOString();
      entry.nextCheckAt = retry.nextCheckAt;
      entry.error = message === "direct_feed_discovery_failed" ? "direct_feed_poll_failed" : message;
      entry.consecutiveFailures = retry.consecutiveFailures;
      feedFailures += 1;
      attemptErrors.push(entry.error);
    }
  }

  registry.updatedAt = now.toISOString();
  const written = await writeVersionedJsonToR2(REGISTRY_KEY, registry, loaded.etag ? { expectedEtag: loaded.etag } : { createOnly: true });
  // Another monitor may finish first. Re-read its committed winner exactly once
  // for truthful registry/backlog telemetry; never repeat provider work or issue
  // a second write from the stale loser.
  const winner = written.conflict ? await loadRegistry() : null;
  if (winner && !winner.found) throw new Error("pr262_direct_feed_registry_conflict_winner_missing");
  const persistedRegistry = winner?.registry ?? registry;
  const eligibleTickers = new Set(eligibleCompanies.map((company) => company.ticker));
  const currentEntries = persistedRegistry.entries.filter((entry) => eligibleTickers.has(entry.ticker));
  const retainedHistoricalEntries = persistedRegistry.entries.filter((entry) => !eligibleTickers.has(entry.ticker));
  const persistedByTicker = new Map(persistedRegistry.entries.map((entry) => [entry.ticker, entry]));
  return {
    events,
    // Most issuers do not publish an RSS/Atom investor-relations feed. That
    // optional count must never be mistaken for official issuer coverage:
    // every eligible CIK remains covered by the broad SEC feed and can also be
    // checked through its exact SEC submissions endpoint in this rotation.
    officialSecIdentityMappedCompanies: eligibleCompanies.length,
    directIrRssFeeds: currentEntries.filter((entry) => entry.feedUrl).length,
    rssIsOptionalEnrichment: true as const,
    seriousSignalCoverageDependsOnRss: false as const,
    registeredFeeds: persistedRegistry.entries.filter((entry) => entry.feedUrl).length,
    feedsPolled: due.length,
    feedSuccesses,
    feedFailures,
    discoveriesAttempted: discovered,
    discoverySuccesses,
    discoveryFailures,
    attemptCount: due.length + discovered,
    successCount: feedSuccesses + discoverySuccesses,
    failureCount: feedFailures + discoveryFailures,
    attemptErrors: [...new Set(attemptErrors)].slice(0, 8),
    secSubmissionsChecked,
    secFilingsFound,
    eligibleCompanies: eligibleCompanies.length,
    companiesKnown: persistedRegistry.entries.length,
    currentEligibleCompaniesKnown: currentEntries.length,
    retainedHistoricalCompanies: retainedHistoricalEntries.length,
    retainedHistoricalFeedlessCompanies: retainedHistoricalEntries.filter((entry) => !entry.feedUrl).length,
    unseenCompanies: eligibleCompanies.filter((company) => !persistedByTicker.has(company.ticker)).length,
    investorWebsitesFound: persistedRegistry.entries.filter((entry) => entry.investorWebsite).length,
    feedlessCompanies: persistedRegistry.entries.filter((entry) => !entry.feedUrl).length,
    transientDiscoveryBacklog: currentEntries.filter((entry) => !entry.feedUrl && transientDiscoveryError(entry.error)).length,
    transientDiscoveryDueNow: currentEntries.filter((entry) => {
      if (entry.feedUrl || !transientDiscoveryError(entry.error)) return false;
      return effectiveDiscoveryRetryAt(entry) <= now.getTime();
    }).length,
    transientDiscoveryWaiting: currentEntries.filter((entry) => {
      if (entry.feedUrl || !transientDiscoveryError(entry.error)) return false;
      return effectiveDiscoveryRetryAt(entry) > now.getTime();
    }).length,
    confirmedNoFeedBacklog: currentEntries.filter((entry) => !entry.feedUrl && confirmedNoFeedError(entry.error)).length,
    confirmedNoFeedDueNow: currentEntries.filter((entry) => !entry.feedUrl
      && confirmedNoFeedError(entry.error)
      && effectiveDiscoveryRetryAt(entry) <= now.getTime()).length,
    confirmedNoFeedWaiting: currentEntries.filter((entry) => !entry.feedUrl
      && confirmedNoFeedError(entry.error)
      && effectiveDiscoveryRetryAt(entry) > now.getTime()).length,
    otherDiscoveryFailureBacklog: currentEntries.filter((entry) => !entry.feedUrl
      && !transientDiscoveryError(entry.error)
      && !confirmedNoFeedError(entry.error)).length,
    otherDiscoveryFailureDueNow: currentEntries.filter((entry) => !entry.feedUrl
      && !transientDiscoveryError(entry.error)
      && !confirmedNoFeedError(entry.error)
      && effectiveDiscoveryRetryAt(entry) <= now.getTime()).length,
    otherDiscoveryFailureWaiting: currentEntries.filter((entry) => !entry.feedUrl
      && !transientDiscoveryError(entry.error)
      && !confirmedNoFeedError(entry.error)
      && effectiveDiscoveryRetryAt(entry) > now.getTime()).length,
    discoverySelection,
    failedFeedsInBackoff: persistedRegistry.entries.filter((entry) => Boolean(entry.feedUrl && entry.error && (entry.consecutiveFailures ?? 0) > 0 && Date.parse(entry.nextCheckAt ?? "") > now.getTime())).length,
    discoveryErrors: [...new Set(currentEntries.map((entry) => entry.error).filter((value): value is string => Boolean(value)))].slice(0, 8),
    registryPersistence: {
      written: written.written,
      conflict: written.conflict,
      winnerLoaded: Boolean(winner),
    },
    registryKey: REGISTRY_KEY,
  };
}
