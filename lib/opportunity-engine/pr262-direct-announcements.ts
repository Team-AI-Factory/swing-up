import { completePr262SecSubmissionsRoot, pr262SecAcceptanceTime } from "@/lib/opportunity-engine/pr262-sec-submissions-schema";
import net from "node:net";
import { createHash } from "node:crypto";
import pilotIssuerSources from "@/config/simple-alert-issuer-sources.json";
import { setTimeout as pause } from "node:timers/promises";
import { isSimpleAlertPilot } from "@/lib/simple-alert-pilot-runtime";
import { pilotCompanies } from "@/lib/simple-alert-pilot-scope";
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
// Non-pilot SEC-submissions discovery retains its durable 190/day ledger. Three
// sequential lookups every 30 minutes are at most 144/day, leaving 46 calls of
// rolling-window headroom and remaining far below the SEC's 10 requests/second
// fair-access ceiling. This clears transient discovery debt without bursts.
const MAX_DISCOVERIES_PER_CYCLE = 3;
const DISCOVERY_CONCURRENCY = 1;
const MAX_FEEDS_POLLED_PER_CYCLE = 20;
// Pilot exact-CIK checks are independent of optional IR discovery. Thirteen checks
// per 15-minute cycle use at most 1248/day, still guarded by the unchanged shared
// 3500/day allowance and 29-minute per-CIK floor. Work remains sequential.
const PILOT_MAX_SEC_CHECKS_PER_CYCLE = 13;
const PILOT_DIRECT_WORK_MS = 35_000;
const PILOT_SEC_WORK_MS = 28_000;
const PILOT_REGISTRY_RESERVE_MS = 5_000;
const SEC_POLL_CADENCE_MS = 29 * 60_000;
const SEC_AGENT = "SwingUp/1.0 support@swingup.app";

// Issuer-published IR roots/RSS links verified 2026-09-16 and 2026-09-18.
// See docs/operations/direct-issuer-feed-coverage.md for primary provenance.
// Each seed is bound to the SEC identity; a recycled ticker cannot inherit
// another issuer's feed.
const VERIFIED_ISSUER_SOURCES = [
  { ticker: "TG", cik: "0000850429", investorWebsite: "https://ir.tredegar.com/", feedUrl: null },
  { ticker: "NVDA", cik: "0001045810", investorWebsite: "https://investor.nvidia.com/", feedUrl: "https://nvidianews.nvidia.com/cats/press_release.xml" },
  { ticker: "AMD", cik: "0000002488", investorWebsite: "https://ir.amd.com/", feedUrl: "https://ir.amd.com/news-events/press-releases/rss" },
  { ticker: "TSM", cik: "0001046179", investorWebsite: "https://investor.tsmc.com/english", feedUrl: null },
  { ticker: "INTC", cik: "0000050863", investorWebsite: "https://www.intc.com/", feedUrl: "https://www.intc.com/news-events/press-releases/rss" },
  { ticker: "XOM", cik: "0000034088", investorWebsite: "https://investor.exxonmobil.com/", feedUrl: "https://investor.exxonmobil.com/company-information/press-releases/rss" },
  { ticker: "AAPL", cik: "0000320193", investorWebsite: "https://www.apple.com/newsroom/", feedUrl: "https://www.apple.com/newsroom/rss-feed.rss" },
  { ticker: "JPM", cik: "0000019617", investorWebsite: "https://jpmorganchaseco.gcs-web.com/", feedUrl: "https://jpmorganchaseco.gcs-web.com/rss/news-releases.xml" },
  { ticker: "KO", cik: "0000021344", investorWebsite: "https://investors.coca-colacompany.com/", feedUrl: "https://investors.coca-colacompany.com/news-events/press-releases/rss" },
];

type IssuerSecCoverage = {
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  nextCheckAt: string | null;
  error: string | null;
  sourceUrl: string;
  snapshotFetchedAt: string | null;
  snapshotOrigin: "network" | "shared_cache" | null;
};

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
  sec?: IssuerSecCoverage;
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

function scheduledSourceDeferral(error: unknown, now: Date) {
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  if (message === "direct_source_collection_deadline") return { reason: message, nextRetryAt: new Date(now.getTime() + FEED_POLL_CADENCE_MS).toISOString() };
  const match = /^pr262_sensor_budget_guard:([a-z0-9_]+):(minimum_interval|rolling_24h_budget);next_retry_at=([^;\s]+)$/.exec(message);
  const retryAt = match ? Date.parse(match[3]) : NaN;
  return match && Number.isFinite(retryAt) && retryAt > now.getTime()
    ? { reason: message, nextRetryAt: new Date(retryAt).toISOString() } : null;
}

// A local budget rejection is not a network attempt. If an earlier request in
// the same discovery/redirect chain did run, retain that source-operation
// attempt even though a later step is deferred. Real transport errors count.
function observedSourceFetch(fetchImpl: typeof fetch, now: Date) {
  let attempted = false, preparationError: string | null = null;
  const observed: typeof fetch = async (request, init) => {
    try {
      const response = await fetchImpl(request, init);
      if (response.headers?.get("x-swingup-submissions-cache") !== "hit") attempted = true;
      if (response.headers?.get("x-swingup-submissions-cache-write-failed") === "true") preparationError = "sec_snapshot_cache_write_failed";
      return response;
    }
    catch (error) {
      if (!scheduledSourceDeferral(error, now)) {
        if (record(error).sourceNetworkAttempted === false) preparationError = discoveryFailureMessage(error);
        else attempted = true;
      }
      throw error;
    }
  };
  return { fetchImpl: observed, attempted: () => attempted, preparationError: () => preparationError };
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
    // Historical index rows with no primary document are valid coverage, but
    // cannot become events. Never synthesize an event time from filingDate.
    if (!indexedText(recent.primaryDocument, index)) return [];
    const observedMs = pr262SecAcceptanceTime(indexedText(recent.acceptanceDateTime, index));
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

async function withinDeadline<T>(work: Promise<T>, deadlineAtMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("direct_feed_timeout")), Math.max(1, deadlineAtMs - Date.now()));
  })]); } finally { if (timer) clearTimeout(timer); }
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

async function fetchBounded(fetchImpl: typeof fetch, rawUrl: string, accept: string, timeoutMs = 10_000, outerDeadlineAtMs = Infinity) {
  let current = rawUrl;
  const deadlineAtMs = Math.min(Date.now() + timeoutMs, outerDeadlineAtMs);
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const remainingMs = deadlineAtMs - Date.now();
    if (remainingMs <= 0) throw new Error("direct_feed_timeout");
    const url = await withinDeadline(safePublicHttps(current), deadlineAtMs);
    if (Date.now() >= deadlineAtMs) throw new Error("direct_feed_timeout");
    const response = await fetchImpl(url, {
      headers: { Accept: accept, "user-agent": SEC_AGENT },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(Math.max(1, deadlineAtMs - Date.now())),
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
  const root = feed.replace(/^\uFEFF/, "").replace(/^\s*(?:(?:<\?[\s\S]*?\?>|<!--[\s\S]*?-->)\s*)*/, "");
  if (!/^<rss\b[^>]*>[\s\S]*<channel\b[^>]*(?:\/>|>[\s\S]*<\/channel\s*>)[\s\S]*<\/rss\s*>\s*$/i.test(root)
    && !/^<feed\b[^>]*(?:\/>|>[\s\S]*<\/feed\s*>)\s*$/i.test(root)) {
    throw new Error("direct_feed_invalid_syndication_payload");
  }
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
      id: `issuer:${entry.ticker}:${createHash("sha256").update(`${url}|${title}|${new Date(publishedMs).toISOString()}`).digest("hex").slice(0, 32)}`,
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

async function loadRegistry(signal?: AbortSignal) {
  signal?.throwIfAborted();
  const current = await readVersionedTextFromR2(REGISTRY_KEY, { signal });
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

async function seedEnv(registry: Registry, exposure: Pr262ExposureEntry[], now: Date) {
  const raw = process.env.SWING_UP_PR262_DIRECT_FEEDS_JSON?.trim();
  let rows: unknown[] = [...VERIFIED_ISSUER_SOURCES, ...(isSimpleAlertPilot() ? pilotIssuerSources.companies : [])];
  try { if (raw) { const supplied = JSON.parse(raw); if (Array.isArray(supplied)) rows = [...rows, ...supplied]; } } catch { /* Keep verified defaults. */ }
  rows = [...new Map(rows.filter(row => row && typeof row === "object" && !Array.isArray(row)).map(row => [String((row as Record<string, unknown>).ticker).toUpperCase(), row])).values()];
  const exposureByTicker = new Map(exposure.map((item) => [item.ticker, item]));
  const seededAt = now.toISOString();
  for (const value of rows) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const row = value as Record<string, unknown>;
    const ticker = text(row.ticker)?.toUpperCase();
    const feedUrl = text(row.feedUrl);
    const investorWebsite = text(row.investorWebsite);
    const company = ticker ? exposureByTicker.get(ticker) : null;
    if (!ticker || (!feedUrl && !investorWebsite) || !company?.cik || (row.cik && row.cik !== company.cik)) continue;
    const existing = registry.entries.find((entry) => entry.ticker === ticker);
    if (existing) {
      const identityChanged = existing.cik !== company.cik;
      const feedChanged = Boolean(feedUrl && existing.feedUrl !== feedUrl);
      const websiteChanged = Boolean(investorWebsite && existing.investorWebsite !== investorWebsite);
      if (!identityChanged && !feedChanged && !websiteChanged) continue;
      existing.consecutiveConfirmedNoFeedDiscoveries = 0;
      existing.company = company.company;
      existing.cik = company.cik;
      if (feedUrl || identityChanged) existing.feedUrl = feedUrl;
      if (investorWebsite || identityChanged) existing.investorWebsite = investorWebsite;
      existing.lastDiscoveryAt = feedUrl ? seededAt : new Date(0).toISOString();
      existing.lastCheckedAt = null;
      existing.lastSuccessAt = feedChanged || identityChanged ? null : existing.lastSuccessAt;
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
      lastDiscoveryAt: feedUrl ? seededAt : new Date(0).toISOString(),
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
  options: { skipSubmissions?: boolean; deadlineAtMs?: number } = {},
): Promise<{ entry: RegistryEntry; secEvents: Pr262SensorEvent[] }> {
  if (!company.cik) throw new Error("direct_feed_company_cik_missing");
  const submissionsUrl = `https://data.sec.gov/submissions/CIK${company.cik}.json`;
  let body: Record<string, unknown> = {};
  if (!options.skipSubmissions) {
    const response = await fetchImpl(submissionsUrl, { headers: { Accept: "application/json", "user-agent": SEC_AGENT }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (response.status !== 200) throw new Error(`direct_feed_sec_submissions_http_${response.status}`);
    try {
      const parsed = await response.json() as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid_shape");
      body = parsed as Record<string, unknown>;
    } catch {
      // A truncated/corrupt SEC response is an upstream transport failure, not a
      // confirmed statement that this issuer has no website or feed.
      throw new Error("direct_feed_sec_submissions_invalid_json");
    }
  }
  const secEvents = options.skipSubmissions ? [] : recentSecFilingEvents(body, company, submissionsUrl, now);
  const investorWebsite = existing?.investorWebsite ?? text(body.investorWebsite) ?? text(body.website)
    ?? VERIFIED_ISSUER_SOURCES.find(row => row.cik === company.cik && row.ticker === company.ticker)?.investorWebsite ?? null;
  let feedUrl: string | null = null;
  let error: string | null = null;
  if (investorWebsite) {
    try {
      const page = await fetchBounded(fetchImpl, investorWebsite, "text/html,application/xhtml+xml", 8_000, options.deadlineAtMs);
      feedUrl = discoverFeedUrl(page.body, page.finalUrl);
      if (feedUrl) feedUrl = (await withinDeadline(safePublicHttps(feedUrl), options.deadlineAtMs ?? Date.now() + 8_000)).toString();
      if (!feedUrl) {
        for (const candidate of discoverInvestorPages(page.body, page.finalUrl)) {
          try {
            const nested = await fetchBounded(fetchImpl, candidate, "text/html,application/xhtml+xml,application/rss+xml,application/atom+xml,text/xml", 5_000, options.deadlineAtMs);
            const directXml = /<(?:rss|feed)\b/i.test(nested.body) ? nested.finalUrl : null;
            const discovered = directXml ?? discoverFeedUrl(nested.body, nested.finalUrl);
            if (!discovered) continue;
            feedUrl = (await withinDeadline(safePublicHttps(discovered), options.deadlineAtMs ?? Date.now() + 5_000)).toString();
            break;
          } catch (cause) {
            const message = discoveryFailureMessage(cause);
            // A later genuine failure cannot be hidden behind an earlier wait.
            if (!error || (scheduledSourceDeferral(error, now) && !scheduledSourceDeferral(message, now))) error = message;
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
      sec: existing?.sec,
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

export async function runPr262DirectAnnouncementMonitor(input: { exposure: Pr262ExposureEntry[]; now?: Date; fetchImpl?: typeof fetch; deadlineAtMs?: number }) {
  const now = input.now ?? new Date();
  const pilot = isSimpleAlertPilot();
  const startedAtMs = Date.now();
  // Reserve finalization time from the actual remaining outer window, even
  // when preceding source work delays this monitor's start.
  const registryDeadlineAtMs = pilot ? Math.min(input.deadlineAtMs ?? Infinity,
    startedAtMs + PILOT_DIRECT_WORK_MS + PILOT_REGISTRY_RESERVE_MS) : Infinity;
  const deadlineAtMs = pilot ? registryDeadlineAtMs - PILOT_REGISTRY_RESERVE_MS : Infinity;
  const registrySignal = () => {
    if (!pilot) return undefined;
    const remainingMs = registryDeadlineAtMs - Date.now();
    return remainingMs <= 0 ? AbortSignal.abort(new Error("direct_registry_deadline")) : AbortSignal.timeout(remainingMs);
  };
  const preparationErrors: string[] = [];
  let sourcePreparationFailures = 0;
  type RegistryFailureStage = "load" | "write" | "conflict_winner_read";
  let registryFailureStage: RegistryFailureStage | null = null;
  let registryError: string | null = null;
  const registryFailed = (stage: RegistryFailureStage, error: unknown) => {
    registryFailureStage = stage;
    registryError = `direct_registry_${stage}:${discoveryFailureMessage(error)}`;
    sourcePreparationFailures += 1;
    preparationErrors.push(registryError);
  };
  const rawFetch = input.fetchImpl ?? fetch;
  let nextRequestAtMs = 0;
  const fetchImpl: typeof fetch = pilot ? async (request, init) => {
    const remaining = deadlineAtMs - Date.now();
    if (remaining <= 0) throw new Error("direct_source_collection_deadline");
    const signal = init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(remaining)]) : AbortSignal.timeout(remaining);
    try {
      await pause(Math.max(0, nextRequestAtMs - Date.now()), undefined, { signal });
      signal.throwIfAborted();
    } catch { throw new Error("direct_source_collection_deadline"); }
    nextRequestAtMs = Date.now() + 1000;
    return rawFetch(request, { ...init, signal });
  } : rawFetch;
  const loaded = await loadRegistry(registrySignal()).catch(error => { registryFailed("load", error); return null; });
  // An unavailable registry is not an empty durable registry. Keep work closed
  // and report unknown registry state, without source calls or a replacement PUT.
  const registry = loaded?.registry ?? emptyRegistry();
  if (loaded) await seedEnv(registry, input.exposure, now);
  const byTicker = new Map(registry.entries.map((entry) => [entry.ticker, entry]));
  const eligibleCompanies = input.exposure.filter((company) => company.cik
    && (!pilot || pilotCompanies().some(row => row.ticker === company.ticker && row.cik === company.cik)));
  if (pilot && loaded) for (const company of eligibleCompanies) {
    if (byTicker.get(company.ticker)?.cik === company.cik) continue;
    // Identity registration alone is explicitly not a source check.
    byTicker.set(company.ticker, { ticker: company.ticker, company: company.company, cik: company.cik!,
      investorWebsite: null, feedUrl: null, discoveredAt: now.toISOString(), lastDiscoveryAt: new Date(0).toISOString(),
      lastCheckedAt: null, lastSuccessAt: null, nextCheckAt: null, error: null });
  }
  const events: Pr262SensorEvent[] = [];
  let secSubmissionsChecked = 0;
  let secFilingsFound = 0;
  let secCheckAttempts = 0, secCheckSuccesses = 0, secCheckFailures = 0, secCheckDeferred = 0, secCacheHits = 0;
  let discoverySuccesses = 0;
  let discoveryFailures = 0;
  let discoveryDeferred = 0;
  let feedDeferred = 0;
  let deferredAfterSourceAttempt = 0;
  const deferrals: Array<{ reason: string; nextRetryAt: string }> = [];
  const attemptErrors: string[] = [];
  const initialCatchupEventIds = new Set<string>();
  const labelInitialCatchup = (found: Pr262SensorEvent[], firstSuccessfulRead: boolean) => {
    if (pilot && firstSuccessfulRead) for (const event of found) {
      initialCatchupEventIds.add(event.id);
      event.reason += " Initial source catch-up; the original publication time is retained and this is not a new-live-case latency observation.";
    }
    return found;
  };
  const discoverySelection = {
    total: 0,
    highPriority: 0,
    unseen: 0,
    transientRetry: 0,
    confirmedNoFeedRecheck: 0,
    otherRecheck: 0,
  };

  // Repeat SEC polling is not governed by the optional RSS retry ladder. A
  // recent shared snapshot can satisfy this check without another reservation.
  if (pilot && loaded) {
    const secDeadline = Math.min(deadlineAtMs, startedAtMs + PILOT_SEC_WORK_MS);
    const secDue = eligibleCompanies.filter(company => {
      const next = Date.parse(byTicker.get(company.ticker)?.sec?.nextCheckAt ?? "");
      return !Number.isFinite(next) || next <= now.getTime();
    }).sort((left, right) =>
      Date.parse(byTicker.get(left.ticker)?.sec?.lastCheckedAt ?? "1970-01-01")
      - Date.parse(byTicker.get(right.ticker)?.sec?.lastCheckedAt ?? "1970-01-01"));
    for (const company of secDue.slice(0, PILOT_MAX_SEC_CHECKS_PER_CYCLE)) {
      if (Date.now() >= secDeadline) break;
      const entry = byTicker.get(company.ticker)!;
      const sourceUrl = `https://data.sec.gov/submissions/CIK${company.cik}.json`;
      const observed = observedSourceFetch(fetchImpl, now);
      const prior = entry.sec;
      try {
        const response = await observed.fetchImpl(sourceUrl, { headers: { Accept: "application/json", "user-agent": SEC_AGENT },
          cache: "no-store", redirect: "error", signal: AbortSignal.timeout(Math.max(1, Math.min(10_000, secDeadline - Date.now()))) });
        if (response.status !== 200) throw new Error(`direct_feed_sec_submissions_http_${response.status}`);
        let body: Record<string, unknown>;
        try { body = record(await response.json()); } catch { throw new Error("direct_feed_sec_submissions_invalid_json"); }
        if (!completePr262SecSubmissionsRoot(body, { cik: company.cik!, ticker: company.ticker })) {
          throw new Error("direct_feed_sec_submissions_identity_or_shape_mismatch");
        }
        const cached = response.headers?.get("x-swingup-submissions-cache") === "hit";
        const fetchedAt = response.headers?.get("x-swingup-submissions-fetched-at") ?? new Date().toISOString();
        const fetchedMs = Date.parse(fetchedAt);
        if (!Number.isFinite(fetchedMs) || fetchedMs > Date.now() + 5_000
          || Date.now() - fetchedMs >= SEC_POLL_CADENCE_MS) throw new Error("direct_feed_sec_submissions_snapshot_stale");
        const found = labelInitialCatchup(recentSecFilingEvents(body, company, sourceUrl, now), !prior?.snapshotFetchedAt);
        events.push(...found); secFilingsFound += found.length; secSubmissionsChecked += 1;
        if (cached) secCacheHits += 1; else secCheckSuccesses += 1;
        if (observed.preparationError()) { sourcePreparationFailures++; preparationErrors.push(observed.preparationError()!); }
        entry.sec = { sourceUrl, lastCheckedAt: now.toISOString(), lastSuccessAt: fetchedAt,
          snapshotFetchedAt: fetchedAt, snapshotOrigin: cached ? "shared_cache" : "network",
          nextCheckAt: new Date(fetchedMs + SEC_POLL_CADENCE_MS).toISOString(), error: null };
        entry.investorWebsite ??= text(body.investorWebsite) ?? text(body.website);
      } catch (error) {
        const message = discoveryFailureMessage(error), deferral = scheduledSourceDeferral(error, now);
        entry.sec = { sourceUrl, lastCheckedAt: observed.attempted() ? now.toISOString() : prior?.lastCheckedAt ?? null,
          lastSuccessAt: prior?.lastSuccessAt ?? null, snapshotFetchedAt: prior?.snapshotFetchedAt ?? null,
          snapshotOrigin: prior?.snapshotOrigin ?? null, error: message,
          nextCheckAt: deferral?.nextRetryAt ?? new Date(now.getTime() + FEED_POLL_CADENCE_MS).toISOString() };
        if (deferral) { secCheckDeferred += 1; deferrals.push(deferral); }
        else if (observed.preparationError()) { sourcePreparationFailures++; preparationErrors.push(message); }
        else { secCheckFailures += 1; attemptErrors.push(message); }
      }
      if (observed.attempted()) secCheckAttempts += 1;
      // Do not continue rotating issuers against an explicit SEC access/rate
      // refusal. Other source families retain their own bounded work.
      if (/direct_feed_sec_submissions_http_(?:403|429)$/.test(entry.sec?.error ?? "")) break;
    }
  }

  const lastDiscoveryMs = registry.lastDiscoveryCycleAt ? Date.parse(registry.lastDiscoveryCycleAt) : 0;
  let discovered = 0;
  if (loaded && Date.now() < deadlineAtMs && (!Number.isFinite(lastDiscoveryMs) || now.getTime() - lastDiscoveryMs >= DISCOVERY_CADENCE_MS)) {
    if (eligibleCompanies.length) {
      const prioritized = eligibleCompanies
        .map((company) => {
          const existing = byTicker.get(company.ticker);
          return discoveryTarget(company, existing?.cik === company.cik ? existing : undefined, now);
        })
        .filter((target): target is DiscoveryTarget => target !== null && (!pilot || Boolean(target.existing?.investorWebsite)))
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
        if (Date.now() >= deadlineAtMs - (pilot ? 7_000 : 0)) break;
        await Promise.all(discoveryTargets.slice(start, start + DISCOVERY_CONCURRENCY).map(async ({ company, existing }) => {
          const observed = observedSourceFetch(fetchImpl, now);
          try {
            const discoveryDeadline = Math.min(deadlineAtMs - 7_000, Date.now() + 4_000);
            const discoveryFetch: typeof fetch = pilot ? (request, init) => {
              if (Date.now() >= discoveryDeadline) throw new Error("direct_source_collection_deadline");
              return observed.fetchImpl(request, { ...init,
                signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(Math.max(1, discoveryDeadline - Date.now()))]) });
            } : observed.fetchImpl;
            const result = await discoverOne(discoveryFetch, company, now, existing, { skipSubmissions: pilot, deadlineAtMs: pilot ? discoveryDeadline : undefined });
            byTicker.set(company.ticker, result.entry);
            events.push(...result.secEvents);
            if (!pilot) secSubmissionsChecked += 1;
            secFilingsFound += result.secEvents.length;
            const deferral = scheduledSourceDeferral(result.entry.error, now);
            if (deferral) {
              discoveryDeferred += 1;
              if (observed.attempted()) deferredAfterSourceAttempt += 1;
              deferrals.push(deferral);
            } else if (observed.preparationError()) {
              sourcePreparationFailures++; preparationErrors.push(observed.preparationError()!);
            } else if (!result.entry.error || confirmedNoFeedError(result.entry.error)) {
              discoverySuccesses += 1;
            } else {
              discoveryFailures += 1;
              attemptErrors.push(result.entry.error);
            }
          } catch (error) {
            const message = discoveryFailureMessage(error);
            const deferral = scheduledSourceDeferral(error, now);
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
              sec: existing?.sec,
            });
            if (deferral) {
              discoveryDeferred += 1;
              if (observed.attempted()) deferredAfterSourceAttempt += 1;
              deferrals.push(deferral);
            } else if (observed.preparationError()) {
              sourcePreparationFailures++; preparationErrors.push(message);
            } else {
              discoveryFailures += 1;
              attemptErrors.push(message);
            }
          }
          if (observed.attempted() || (!observed.preparationError() && !scheduledSourceDeferral(byTicker.get(company.ticker)?.error ?? null, now))) discovered += 1;
        }));
      }
      registry.lastDiscoveryCycleAt = now.toISOString();
    }
  }

  registry.entries = [...byTicker.values()];
  const eligibleIdentities = new Map(eligibleCompanies.map((company) => [company.ticker, company.cik]));
  const due = registry.entries
    .filter((entry) => entry.feedUrl)
    .filter((entry) => eligibleIdentities.get(entry.ticker) === entry.cik)
    .filter((entry) => {
      const next = entry.nextCheckAt ? Date.parse(entry.nextCheckAt) : 0;
      return !Number.isFinite(next) || next <= now.getTime();
    })
    .sort((left, right) => Date.parse(left.lastCheckedAt ?? "1970-01-01") - Date.parse(right.lastCheckedAt ?? "1970-01-01"))
    .slice(0, MAX_FEEDS_POLLED_PER_CYCLE);

  let feedSuccesses = 0;
  let feedFailures = 0;
  let feedsPolled = 0;
  for (const entry of due) {
    if (Date.now() >= deadlineAtMs) break;
    const observed = observedSourceFetch(fetchImpl, now);
    try {
      const feed = await fetchBounded(observed.fetchImpl, entry.feedUrl!, "application/rss+xml,application/atom+xml,text/xml", 8_000, deadlineAtMs);
      events.push(...labelInitialCatchup(parseFeed(feed.body, entry, now), !entry.lastSuccessAt));
      entry.lastCheckedAt = now.toISOString();
      entry.lastSuccessAt = now.toISOString();
      entry.nextCheckAt = new Date(now.getTime() + FEED_POLL_CADENCE_MS).toISOString();
      entry.error = null;
      entry.consecutiveFailures = 0;
      feedSuccesses += 1;
    } catch (error) {
      const message = discoveryFailureMessage(error);
      entry.error = message === "direct_feed_discovery_failed" ? "direct_feed_poll_failed" : message;
      const deferral = scheduledSourceDeferral(error, now);
      if (deferral) {
        entry.nextCheckAt = deferral.nextRetryAt;
        if (observed.attempted()) { entry.lastCheckedAt = now.toISOString(); deferredAfterSourceAttempt += 1; }
        feedDeferred += 1;
        deferrals.push(deferral);
      } else if (observed.preparationError()) {
        sourcePreparationFailures++; preparationErrors.push(entry.error);
        entry.nextCheckAt = new Date(now.getTime() + FEED_POLL_CADENCE_MS).toISOString();
      } else {
        const retry = failedFeedRetry(entry, now);
        entry.lastCheckedAt = now.toISOString();
        entry.nextCheckAt = retry.nextCheckAt;
        entry.consecutiveFailures = retry.consecutiveFailures;
        feedFailures += 1;
        attemptErrors.push(entry.error);
      }
    }
    // DNS/URL/read failures still represent a real attempted source operation.
    if (observed.attempted() || (!observed.preparationError() && !scheduledSourceDeferral(entry.error, now))) feedsPolled += 1;
  }

  registry.updatedAt = now.toISOString();
  let written = { written: false, conflict: false };
  let winner: Awaited<ReturnType<typeof loadRegistry>> | null = null;
  if (loaded) {
    let stage: RegistryFailureStage = "write";
    try {
      const signal = registrySignal();
      signal?.throwIfAborted();
      written = await writeVersionedJsonToR2(REGISTRY_KEY, registry, { ...(loaded.etag ? { expectedEtag: loaded.etag } : { createOnly: true }), signal });
      if (!written.written && !written.conflict) throw new Error("pr262_direct_feed_registry_write_unacknowledged");
      // Read a CAS winner once; never replay provider work or a stale PUT.
      stage = "conflict_winner_read";
      winner = written.conflict ? await loadRegistry(registrySignal()) : null;
      if (winner && !winner.found) throw new Error("pr262_direct_feed_registry_conflict_winner_missing");
    } catch (error) { registryFailed(stage, error); }
  }
  // Actual source observations survive failed finalization, but are explicitly
  // labelled unpersisted; only an acknowledged PUT or loaded winner is durable.
  const persistedRegistry = !registryError && winner ? winner.registry : registry;
  const registryTelemetryBasis = !loaded ? "unavailable" : registryError
    ? "unpersisted_observation" : "persisted_registry";
  const countEntries = (entries: RegistryEntry[], predicate: (entry: RegistryEntry) => unknown) =>
    loaded ? entries.filter(predicate).length : null;
  const currentEntries = persistedRegistry.entries.filter((entry) => eligibleIdentities.get(entry.ticker) === entry.cik);
  const retainedHistoricalEntries = persistedRegistry.entries.filter((entry) => eligibleIdentities.get(entry.ticker) !== entry.cik);
  const persistedByTicker = new Map(persistedRegistry.entries.map((entry) => [entry.ticker, entry]));
  return {
    events,
    // Most issuers do not publish an RSS/Atom investor-relations feed. That
    // optional count must never be mistaken for official issuer coverage:
    // each eligible CIK can map broad SEC observations, but identity mapping
    // alone does not prove fresh issuer coverage. See issuerSourceCoverage for
    // actual dated exact-CIK snapshots and independently checked IR feeds.
    officialSecIdentityMappedCompanies: eligibleCompanies.length,
    directIrRssFeeds: countEntries(currentEntries, (entry) => entry.feedUrl),
    rssIsOptionalEnrichment: true as const,
    seriousSignalCoverageDependsOnRss: false as const,
    registeredFeeds: countEntries(persistedRegistry.entries, (entry) => entry.feedUrl),
    feedsPolled,
    feedPollsSelected: due.length,
    feedSuccesses,
    feedFailures,
    discoveriesAttempted: discovered,
    discoverySuccesses,
    discoveryFailures,
    discoveryDeferred,
    feedDeferred,
    deferredCount: discoveryDeferred + feedDeferred + secCheckDeferred,
    deferredAfterSourceAttempt,
    deferredReasons: [...new Set(deferrals.map(row => row.reason))].slice(0, 8),
    nextRetryAt: deferrals.length ? deferrals.map(row => row.nextRetryAt).sort()[0] : null,
    attemptCount: feedsPolled + discovered + secCheckAttempts,
    successCount: feedSuccesses + discoverySuccesses + secCheckSuccesses,
    failureCount: feedFailures + discoveryFailures + secCheckFailures,
    attemptErrors: [...new Set(attemptErrors)].slice(0, 8),
    sourcePreparationFailures,
    preparationErrors: [...new Set(preparationErrors)].slice(0, 8),
    secSubmissionsChecked,
    secFilingsFound,
    secCheckAttempts, secCheckSuccesses, secCheckFailures, secCheckDeferred, secCacheHits,
    initialCatchupEvents: initialCatchupEventIds.size,
    initialCatchupEventIds: [...initialCatchupEventIds],
    publicationTimestampsPreserved: true as const,
    sourceCollectionDeadlineReached: pilot && Date.now() >= deadlineAtMs,
    directWorkBudgetMs: pilot ? Math.max(0, deadlineAtMs - startedAtMs) : null,
    issuerSourceCoverage: eligibleCompanies.map(company => {
      const entry = persistedByTicker.get(company.ticker);
      const sec = entry?.sec;
      const registeredSource = pilot ? pilotIssuerSources.companies.find(row => row.ticker === company.ticker
        && row.cik === company.cik && row.investorWebsite === entry?.investorWebsite) : null;
      const snapshotAgeMs = Date.now() - Date.parse(sec?.snapshotFetchedAt ?? "");
      return { ticker: company.ticker, cik: company.cik,
        sec: { sourceUrl: `https://data.sec.gov/submissions/CIK${company.cik}.json`,
          status: !loaded ? "registry_unavailable" : sec?.error ? "deferred_or_failed" : Number.isFinite(snapshotAgeMs) && snapshotAgeMs >= 0 && snapshotAgeMs < SEC_POLL_CADENCE_MS ? "current_snapshot" : sec?.snapshotFetchedAt ? "stale_snapshot" : "not_checked",
          lastCheckedAt: sec?.lastCheckedAt ?? null, snapshotFetchedAt: sec?.snapshotFetchedAt ?? null,
          snapshotOrigin: sec?.snapshotOrigin ?? null, nextCheckAt: sec?.nextCheckAt ?? null, error: sec?.error ?? null },
        ir: { investorWebsite: entry?.investorWebsite ?? null, feedUrl: entry?.feedUrl ?? null,
          seedSourcePageUrl: registeredSource?.sourcePageUrl ?? null,
          seedVerifiedAt: registeredSource?.verifiedAt ?? null,
          seedRegistrationIsSuccessfulPoll: false as const,
          status: !loaded ? "registry_unavailable" : entry?.feedUrl ? entry.error ? "poll_deferred_or_failed" : entry.lastSuccessAt ? "feed_checked" : "registered_not_checked"
            : confirmedNoFeedError(entry?.error ?? null) ? "no_feed_discovered" : entry?.investorWebsite ? "discovery_pending" : "website_unregistered",
          lastDiscoveryAt: entry?.lastDiscoveryAt && Date.parse(entry.lastDiscoveryAt) > 0 ? entry.lastDiscoveryAt : null,
          lastCheckedAt: entry?.lastCheckedAt ?? null, lastSuccessAt: entry?.lastSuccessAt ?? null,
          nextCheckAt: entry?.nextCheckAt ?? null, error: entry?.error ?? null } };
    }),
    eligibleCompanies: eligibleCompanies.length,
    companiesKnown: loaded ? persistedRegistry.entries.length : null,
    currentEligibleCompaniesKnown: loaded ? currentEntries.length : null,
    retainedHistoricalCompanies: loaded ? retainedHistoricalEntries.length : null,
    retainedHistoricalFeedlessCompanies: countEntries(retainedHistoricalEntries, (entry) => !entry.feedUrl),
    unseenCompanies: loaded ? eligibleCompanies.filter((company) => persistedByTicker.get(company.ticker)?.cik !== company.cik).length : null,
    investorWebsitesFound: countEntries(persistedRegistry.entries, (entry) => entry.investorWebsite),
    feedlessCompanies: countEntries(persistedRegistry.entries, (entry) => !entry.feedUrl),
    transientDiscoveryBacklog: countEntries(currentEntries, (entry) => !entry.feedUrl && transientDiscoveryError(entry.error)),
    transientDiscoveryDueNow: countEntries(currentEntries, (entry) => {
      if (entry.feedUrl || !transientDiscoveryError(entry.error)) return false;
      return effectiveDiscoveryRetryAt(entry) <= now.getTime();
    }),
    transientDiscoveryWaiting: countEntries(currentEntries, (entry) => {
      if (entry.feedUrl || !transientDiscoveryError(entry.error)) return false;
      return effectiveDiscoveryRetryAt(entry) > now.getTime();
    }),
    confirmedNoFeedBacklog: countEntries(currentEntries, (entry) => !entry.feedUrl && confirmedNoFeedError(entry.error)),
    confirmedNoFeedDueNow: countEntries(currentEntries, (entry) => !entry.feedUrl
      && confirmedNoFeedError(entry.error)
      && effectiveDiscoveryRetryAt(entry) <= now.getTime()),
    confirmedNoFeedWaiting: countEntries(currentEntries, (entry) => !entry.feedUrl
      && confirmedNoFeedError(entry.error)
      && effectiveDiscoveryRetryAt(entry) > now.getTime()),
    otherDiscoveryFailureBacklog: countEntries(currentEntries, (entry) => !entry.feedUrl
      && !transientDiscoveryError(entry.error)
      && !confirmedNoFeedError(entry.error)),
    otherDiscoveryFailureDueNow: countEntries(currentEntries, (entry) => !entry.feedUrl
      && !transientDiscoveryError(entry.error)
      && !confirmedNoFeedError(entry.error)
      && effectiveDiscoveryRetryAt(entry) <= now.getTime()),
    otherDiscoveryFailureWaiting: countEntries(currentEntries, (entry) => !entry.feedUrl
      && !transientDiscoveryError(entry.error)
      && !confirmedNoFeedError(entry.error)
      && effectiveDiscoveryRetryAt(entry) > now.getTime()),
    discoverySelection,
    failedFeedsInBackoff: countEntries(persistedRegistry.entries, (entry) => Boolean(entry.feedUrl && entry.error && (entry.consecutiveFailures ?? 0) > 0 && Date.parse(entry.nextCheckAt ?? "") > now.getTime())),
    discoveryErrors: loaded ? [...new Set(currentEntries.map((entry) => entry.error).filter((value): value is string => Boolean(value)))].slice(0, 8) : null,
    registryPersistence: {
      written: written.written,
      conflict: written.conflict,
      winnerLoaded: Boolean(winner?.found),
      failureStage: registryFailureStage,
      error: registryError,
      telemetryBasis: registryTelemetryBasis,
    },
    registryKey: REGISTRY_KEY,
  };
}
