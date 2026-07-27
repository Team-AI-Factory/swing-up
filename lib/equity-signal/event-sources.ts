import crypto from "node:crypto";
import { normalizeEquitySymbol, providerFailurePolicy, selectBalancedReceipts, type BranchNewsChannel } from "@/lib/branch-signal-lab-policy";
import { enrichSecFilingDetails } from "@/lib/equity-signal/sec-filing-details";
import type { EventReceipt, ProviderResult, ProviderStatus } from "@/lib/equity-signal/types";

const SEC_AGENT = "SwingUp/1.0 support@swingup.app";
const GOOGLE_NEWS_URL = "https://news.google.com/rss/search";
const GDELT_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const MARKETAUX_URL = "https://api.marketaux.com/v1/news/all";
const COMMERCE_NEWS_API_URL = "https://api.commerce.gov/api/news";
const ALPHA_VANTAGE_URL = "https://www.alphavantage.co/query";
const FEDERAL_REGISTER_URL = "https://www.federalregister.gov/api/v1/documents.json";
const OPENFDA_URL = "https://api.fda.gov/drug/enforcement.json";
const SEC_FORMS = ["8-K", "6-K", "424B5", "424B3", "10-Q", "10-K", "S-1", "S-3", "SC 13D", "SC 13G", "4"] as const;

type OfficialFeed = { provider: string; channel: BranchNewsChannel; url: string; publisher: string };

const OFFICIAL_FEEDS: OfficialFeed[] = [
  { provider: "federal_reserve", channel: "federal_reserve", url: "https://www.federalreserve.gov/feeds/press_all.xml", publisher: "Federal Reserve" },
  { provider: "federal_reserve", channel: "federal_reserve", url: "https://www.federalreserve.gov/feeds/speeches.xml", publisher: "Federal Reserve" },
  { provider: "bls", channel: "bls", url: "https://www.bls.gov/feed/bls_latest.rss", publisher: "U.S. Bureau of Labor Statistics" },
  { provider: "bea", channel: "bea", url: "https://apps.bea.gov/rss/rss.xml", publisher: "U.S. Bureau of Economic Analysis" },
  { provider: "sec_press", channel: "sec_press_release", url: "https://www.sec.gov/news/pressreleases.rss", publisher: "U.S. Securities and Exchange Commission" },
  { provider: "white_house", channel: "white_house", url: "https://www.whitehouse.gov/news/feed/", publisher: "The White House" },
  { provider: "cisa", channel: "federal_register", url: "https://www.cisa.gov/cybersecurity-advisories/all.xml", publisher: "Cybersecurity and Infrastructure Security Agency" },
  { provider: "state_department", channel: "federal_register", url: "https://www.state.gov/rss-feed/collected-department-releases/feed/", publisher: "U.S. Department of State" },
  { provider: "defense_department", channel: "federal_register", url: "https://www.defense.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=9&Site=945&max=25", publisher: "U.S. Department of Defense" },
];

const CACHEABLE_FAILURES = new Set<ProviderStatus>(["not_due", "rate_limited", "temporarily_unavailable", "failed"]);
const DEFAULT_RECEIPT_FRESHNESS_MS = 24 * 60 * 60 * 1000;
const PROVIDER_RECEIPT_FRESHNESS_MS: Record<string, number> = {
  alpha_vantage_earnings_calendar: 8 * 24 * 60 * 60 * 1000,
  federal_register: 7 * 24 * 60 * 60 * 1000,
  openfda: 14 * 24 * 60 * 60 * 1000,
  sec_edgar_current_filings: 48 * 60 * 60 * 1000,
  federal_reserve: 7 * 24 * 60 * 60 * 1000,
  bls: 7 * 24 * 60 * 60 * 1000,
  bea: 7 * 24 * 60 * 60 * 1000,
  sec_press: 7 * 24 * 60 * 60 * 1000,
  white_house: 7 * 24 * 60 * 60 * 1000,
  commerce: 7 * 24 * 60 * 60 * 1000,
  cisa: 7 * 24 * 60 * 60 * 1000,
  state_department: 7 * 24 * 60 * 60 * 1000,
  defense_department: 7 * 24 * 60 * 60 * 1000,
};
const lastGoodProviderResults = new Map<string, ProviderResult>();

function text(value: unknown, maximum = 2_000) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maximum) : "";
}

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function xmlTag(block: string, tag: string) {
  const pattern = new RegExp(`<(?:(?:[a-z0-9_-]+):)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:(?:[a-z0-9_-]+):)?${tag}>`, "i");
  return decodeXml(block.match(pattern)?.[1] ?? "");
}

function xmlLink(block: string) {
  const href = block.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/i)?.[1];
  return decodeXml(href ?? xmlTag(block, "link"));
}

function validDate(value: unknown, now: Date, maximumAgeMs = 7 * 24 * 60 * 60 * 1000) {
  const parsed = new Date(typeof value === "string" || typeof value === "number" ? value : "");
  if (Number.isNaN(parsed.getTime())) return null;
  const age = now.getTime() - parsed.getTime();
  if (age < -24 * 60 * 60 * 1000 || age > maximumAgeMs) return null;
  return parsed.toISOString();
}

function receiptId(channel: string, url: string, title: string, publishedAt: string) {
  return crypto.createHash("sha256").update(`${channel}|${url}|${title}|${publishedAt}`).digest("hex").slice(0, 24);
}

function makeReceipt(input: Omit<EventReceipt, "id">): EventReceipt {
  return { ...input, id: receiptId(input.channel, input.url, input.title, input.publishedAt) };
}

function safeUrl(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function parseRss(xml: string, input: { channel: BranchNewsChannel; publisher: string; official: boolean; now: Date; scheduled?: boolean }) {
  const blocks = [...xml.matchAll(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi)].map((match) => match[0]);
  return blocks.flatMap((block): EventReceipt[] => {
    const title = xmlTag(block, "title").slice(0, 280);
    const summary = (xmlTag(block, "description") || xmlTag(block, "summary") || xmlTag(block, "content")).slice(0, 900) || null;
    const url = safeUrl(xmlLink(block));
    const publishedAt = validDate(xmlTag(block, "pubDate") || xmlTag(block, "published") || xmlTag(block, "updated") || xmlTag(block, "date"), input.now);
    const publisher = xmlTag(block, "source") || input.publisher;
    if (!title || !url || !publishedAt) return [];
    return [makeReceipt({ title, summary, url, publisher, publishedAt, channel: input.channel, official: input.official, primarySource: input.official, scheduled: input.scheduled ?? false, symbolHints: [], companyHints: [], rawEventType: null })];
  });
}

function errorCategory(error: unknown) {
  const message = error instanceof Error ? error.message : "request_failed";
  if (/cadence_guard|rolling_quota_guard/.test(message)) return { status: "not_due" as ProviderStatus, error: null };
  if (/rate.?limit|http_429/i.test(message)) return { status: "rate_limited" as ProviderStatus, error: "rate_limited" };
  if (/http_(?:401|402|403)|not_entitled/i.test(message)) return { status: "not_entitled" as ProviderStatus, error: "not_entitled" };
  return { status: "temporarily_unavailable" as ProviderStatus, error: message.slice(0, 160) };
}

function marketauxErrorCategory(error: unknown) {
  const message = error instanceof Error ? error.message : "request_failed";
  if (/http_401/i.test(message)) return { status: "not_entitled" as ProviderStatus, error: "invalid_api_token" };
  if (/http_402/i.test(message)) return { status: "rate_limited" as ProviderStatus, error: "usage_limit_reached" };
  if (/http_403/i.test(message)) return { status: "not_entitled" as ProviderStatus, error: "endpoint_access_restricted" };
  if (/http_400/i.test(message)) return { status: "failed" as ProviderStatus, error: "malformed_parameters" };
  return errorCategory(error);
}

function publicFeedErrorCategory(error: unknown) {
  const failure = errorCategory(error);
  return failure.status === "not_entitled"
    ? { status: "temporarily_unavailable" as ProviderStatus, error: "public_feed_access_denied" }
    : failure;
}

function result(input: Partial<ProviderResult> & Pick<ProviderResult, "provider" | "status">): ProviderResult {
  return {
    provider: input.provider,
    status: input.status,
    checkedAt: input.checkedAt ?? null,
    nextRetryAt: input.nextRetryAt ?? null,
    sourceUrls: input.sourceUrls ?? [],
    receipts: input.receipts ?? [],
    recordsRead: input.recordsRead ?? input.receipts?.length ?? 0,
    error: input.error ?? null,
    entitlementVerified: input.entitlementVerified ?? input.status === "connected",
    cached: input.cached ?? false,
  };
}

function providerStatus(rows: ProviderResult[]): ProviderStatus {
  if (rows.some((row) => row.status === "connected")) return "connected";
  if (rows.every((row) => row.status === "not_due")) return "not_due";
  const priority: ProviderStatus[] = ["rate_limited", "temporarily_unavailable", "failed", "not_entitled", "not_configured", "not_due"];
  return priority.find((status) => rows.some((row) => row.status === status)) ?? "failed";
}

function aggregateProviderRows(rows: ProviderResult[]) {
  const grouped = new Map<string, ProviderResult[]>();
  for (const row of rows) grouped.set(row.provider, [...(grouped.get(row.provider) ?? []), row]);
  return [...grouped.entries()].map(([provider, providerRows]) => {
    if (providerRows.length === 1) return providerRows[0];
    const status = providerStatus(providerRows);
    const connectedRows = providerRows.filter((row) => row.status === "connected");
    const failures = providerRows
      .filter((row) => row.status !== "connected" && row.status !== "not_due")
      .map((row) => `${row.status}${row.error ? `:${row.error}` : ""}`);
    const checkedAt = connectedRows
      .map((row) => row.checkedAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;
    return result({
      provider,
      status,
      checkedAt,
      nextRetryAt: providerRows.map((row) => row.nextRetryAt).filter((value): value is string => Boolean(value)).sort()[0] ?? null,
      sourceUrls: [...new Set(providerRows.flatMap((row) => row.sourceUrls))],
      receipts: selectBalancedReceipts(providerRows.flatMap((row) => row.receipts), 300),
      recordsRead: providerRows.reduce((sum, row) => sum + row.recordsRead, 0),
      error: failures.length ? `${connectedRows.length ? "partial_source_failure" : "source_failure"}:${[...new Set(failures)].join("|")}` : null,
      entitlementVerified: connectedRows.some((row) => row.entitlementVerified),
      cached: providerRows.some((row) => row.cached),
    });
  });
}

function cloneProviderResult(provider: ProviderResult): ProviderResult {
  return {
    ...provider,
    sourceUrls: [...provider.sourceUrls],
    receipts: provider.receipts.map((receipt) => ({
      ...receipt,
      symbolHints: [...receipt.symbolHints],
      companyHints: [...receipt.companyHints],
    })),
  };
}

function cachedReceiptsStillFresh(provider: string, receipts: EventReceipt[], now: Date) {
  const maximumAgeMs = PROVIDER_RECEIPT_FRESHNESS_MS[provider] ?? DEFAULT_RECEIPT_FRESHNESS_MS;
  return receipts.filter((receipt) => {
    const publishedAt = Date.parse(receipt.publishedAt);
    if (!Number.isFinite(publishedAt)) return false;
    const ageMs = now.getTime() - publishedAt;
    const maximumFutureMs = receipt.scheduled ? 8 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    return ageMs >= -maximumFutureMs && ageMs <= maximumAgeMs;
  });
}

function withLastGoodCache(current: ProviderResult, now: Date): ProviderResult {
  if (current.status === "connected") {
    if (current.receipts.length > 0) lastGoodProviderResults.set(current.provider, cloneProviderResult(current));
    return current;
  }
  if (!CACHEABLE_FAILURES.has(current.status)) return current;
  const previous = lastGoodProviderResults.get(current.provider);
  if (!previous) return current;
  const receipts = cachedReceiptsStillFresh(current.provider, previous.receipts, now).map((receipt) => ({
    ...receipt,
    symbolHints: [...receipt.symbolHints],
    companyHints: [...receipt.companyHints],
  }));
  if (!receipts.length) {
    lastGoodProviderResults.delete(current.provider);
    return current;
  }
  return result({
    ...current,
    status: current.status,
    checkedAt: previous.checkedAt,
    sourceUrls: [...new Set([...current.sourceUrls, ...previous.sourceUrls])],
    receipts,
    recordsRead: receipts.length,
    entitlementVerified: current.entitlementVerified || previous.entitlementVerified,
    cached: true,
  });
}

function isSyndicationFeed(body: string) {
  return /<(?:rss|feed|(?:[a-z0-9_-]+:)?RDF)\b/i.test(body);
}

async function fetchText(fetchImpl: typeof fetch, url: URL | string, accept: string, timeoutMs = 20_000) {
  const response = await fetchImpl(url, { headers: { Accept: accept, "user-agent": SEC_AGENT }, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  const body = await response.text();
  if (!response.ok) {
    const policy = providerFailurePolicy({ httpStatus: response.status, bodyText: body });
    throw new Error(`${policy.status}_http_${response.status}`);
  }
  return { response, body };
}

function secFeedReceipt(block: string, form: string, now: Date) {
  const title = xmlTag(block, "title").slice(0, 280);
  const url = safeUrl(xmlLink(block));
  const publishedAt = validDate(xmlTag(block, "updated") || xmlTag(block, "filing-date"), now, 48 * 60 * 60 * 1000);
  const cik = (xmlTag(block, "cik-number") || title.match(/\((\d{7,10})\)/)?.[1] || "").replace(/\D/g, "").padStart(10, "0");
  const company = xmlTag(block, "company-name") || title.replace(/^.*? - /, "").replace(/\s*\(\d{7,10}\).*$/, "").trim();
  if (!title || !url || !publishedAt) return null;
  return makeReceipt({
    title,
    summary: `Official SEC ${form} filing${company ? ` by ${company}` : ""}.`,
    url,
    publisher: "U.S. Securities and Exchange Commission",
    publishedAt,
    channel: "sec_current_filings",
    official: true,
    primarySource: true,
    scheduled: false,
    symbolHints: [],
    companyHints: [company, cik ? `CIK${cik}` : ""].filter(Boolean),
    rawEventType: form,
  });
}

export async function fetchSecCurrentFilings(fetchImpl: typeof fetch, now: Date): Promise<ProviderResult> {
  const fetchForm = async (form: typeof SEC_FORMS[number]) => {
    const url = new URL("https://www.sec.gov/cgi-bin/browse-edgar");
    url.searchParams.set("action", "getcurrent");
    url.searchParams.set("output", "atom");
    url.searchParams.set("owner", "include");
    url.searchParams.set("count", "100");
    url.searchParams.set("type", form);
    const { body } = await fetchText(fetchImpl, url, "application/atom+xml,text/xml");
    const receipts = [...body.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].flatMap((match) => secFeedReceipt(match[0], form, now) ?? []);
    return { url: url.toString(), receipts };
  };
  const settled: PromiseSettledResult<{ url: string; receipts: EventReceipt[] }>[] = [];
  for (let index = 0; index < SEC_FORMS.length; index += 5) {
    settled.push(...await Promise.allSettled(SEC_FORMS.slice(index, index + 5).map(fetchForm)));
  }
  const successes = settled.filter((item): item is PromiseFulfilledResult<{ url: string; receipts: EventReceipt[] }> => item.status === "fulfilled");
  const errors = settled.filter((item): item is PromiseRejectedResult => item.status === "rejected").map((item) => errorCategory(item.reason));
  const onlyNotDue = !successes.length && errors.length > 0 && errors.every((item) => item.status === "not_due");
  return result({
    provider: "sec_edgar_current_filings",
    status: successes.length ? "connected" : onlyNotDue ? "not_due" : errors[0]?.status ?? "temporarily_unavailable",
    checkedAt: successes.length ? now.toISOString() : null,
    sourceUrls: successes.map((item) => item.value.url),
    receipts: selectBalancedReceipts(successes.flatMap((item) => item.value.receipts), 300),
    recordsRead: successes.reduce((sum, item) => sum + item.value.receipts.length, 0),
    error: successes.length ? null : errors[0]?.error ?? null,
    entitlementVerified: successes.length > 0,
  });
}

function compositeGoogleQuery(now: Date) {
  const buckets = [
    '(earnings OR guidance OR "product launch" OR acquisition OR merger OR "contract award" OR recall OR investigation OR offering) (company OR stock)',
    '("AI breakthrough" OR "technology breakthrough" OR semiconductor OR "clinical trial" OR keynote OR "investor day" OR "live conference") (company OR stocks)',
    '(Federal Reserve OR inflation OR jobs OR tariff OR sanctions OR war OR cyberattack OR oil OR Treasury OR "White House") (market OR stocks OR economy)',
  ];
  return `${buckets[Math.floor(now.getTime() / (5 * 60_000)) % buckets.length]} when:1h`;
}

export async function fetchGoogleDiscovery(fetchImpl: typeof fetch, now: Date): Promise<ProviderResult> {
  const url = new URL(GOOGLE_NEWS_URL);
  url.searchParams.set("q", compositeGoogleQuery(now));
  url.searchParams.set("hl", "en-US");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");
  try {
    const { body } = await fetchText(fetchImpl, url, "application/rss+xml,text/xml", 15_000);
    const receipts = parseRss(body, { channel: "google_news_rss", publisher: "Google News discovery", official: false, now });
    return result({ provider: "google_news_rss", status: "connected", checkedAt: now.toISOString(), sourceUrls: [url.toString()], receipts, recordsRead: receipts.length, entitlementVerified: false });
  } catch (error) {
    const failure = errorCategory(error);
    return result({ provider: "google_news_rss", status: failure.status, sourceUrls: [url.toString()], error: failure.error, entitlementVerified: false });
  }
}

export async function fetchGdeltDiscovery(fetchImpl: typeof fetch, now: Date): Promise<ProviderResult> {
  const url = new URL(GDELT_URL);
  const queryBuckets = [
    '(earnings OR guidance OR acquisition OR merger OR "product launch" OR "contract award" OR recall OR investigation OR offering) sourcelang:english',
    '("AI breakthrough" OR "technology breakthrough" OR semiconductor OR cyberattack OR "clinical trial" OR "FDA approval") sourcelang:english',
    '(sanctions OR tariff OR "military strike" OR invasion OR oil OR "supply chain" OR "Federal Reserve" OR inflation OR jobs OR Treasury) sourcelang:english',
  ];
  url.searchParams.set("query", queryBuckets[Math.floor(now.getTime() / (15 * 60_000)) % queryBuckets.length]);
  url.searchParams.set("mode", "ArtList");
  url.searchParams.set("format", "json");
  url.searchParams.set("timespan", "2h");
  url.searchParams.set("maxrecords", "75");
  url.searchParams.set("sort", "DateDesc");
  try {
    const { body } = await fetchText(fetchImpl, url, "application/json", 25_000);
    const json = JSON.parse(body) as { articles?: Array<Record<string, unknown>> };
    if (!Array.isArray(json.articles)) throw new Error("invalid_gdelt_payload");
    const receipts = json.articles.flatMap((article): EventReceipt[] => {
      const title = text(article.title, 280);
      const articleUrl = safeUrl(text(article.url));
      const domain = text(article.domain, 120).replace(/^www\./, "");
      const seen = text(article.seendate);
      const normalized = /^\d{8}T\d{6}Z$/.test(seen) ? `${seen.slice(0, 4)}-${seen.slice(4, 6)}-${seen.slice(6, 8)}T${seen.slice(9, 11)}:${seen.slice(11, 13)}:${seen.slice(13, 15)}Z` : seen;
      const publishedAt = validDate(normalized, now, 24 * 60 * 60 * 1000);
      if (!title || !articleUrl || !publishedAt) return [];
      return [makeReceipt({ title, summary: null, url: articleUrl, publisher: domain || "GDELT source", publishedAt, channel: "gdelt", official: false, primarySource: false, scheduled: false, symbolHints: [], companyHints: [], rawEventType: null })];
    });
    return result({ provider: "gdelt", status: "connected", checkedAt: now.toISOString(), sourceUrls: [url.toString()], receipts: selectBalancedReceipts(receipts, 200), recordsRead: receipts.length, entitlementVerified: true });
  } catch (error) {
    const failure = errorCategory(error);
    return result({ provider: "gdelt", status: failure.status, sourceUrls: [url.toString()], error: failure.error });
  }
}

export async function fetchMarketauxDiscovery(fetchImpl: typeof fetch, now: Date): Promise<ProviderResult> {
  const key = process.env.MARKETAUX_API_KEY?.trim();
  if (!key) return result({ provider: "marketaux", status: "not_configured", sourceUrls: [MARKETAUX_URL] });
  const url = new URL(MARKETAUX_URL);
  url.searchParams.set("api_token", key);
  url.searchParams.set("countries", "us");
  url.searchParams.set("entity_types", "equity");
  url.searchParams.set("must_have_entities", "true");
  url.searchParams.set("filter_entities", "true");
  url.searchParams.set("group_similar", "true");
  url.searchParams.set("language", "en");
  url.searchParams.set("published_after", new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString().slice(0, 19));
  url.searchParams.set("limit", "3");
  try {
    const { body } = await fetchText(fetchImpl, url, "application/json");
    const json = JSON.parse(body) as { data?: Array<Record<string, unknown>> };
    if (!Array.isArray(json.data)) throw new Error("invalid_marketaux_payload");
    const receipts = json.data.flatMap((article): EventReceipt[] => {
      const title = text(article.title, 280);
      const articleUrl = safeUrl(text(article.url));
      const publishedAt = validDate(article.published_at, now, 24 * 60 * 60 * 1000);
      const source = typeof article.source === "string" ? article.source : article.source && typeof article.source === "object" ? text((article.source as Record<string, unknown>).name) : "Marketaux source";
      const entities = Array.isArray(article.entities) ? article.entities.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value)) : [];
      const symbolHints = [...new Set(entities.map((entity) => normalizeEquitySymbol(entity.symbol)).filter((value): value is string => Boolean(value)))];
      const companyHints = [...new Set(entities.map((entity) => text(entity.name, 180)).filter(Boolean))];
      if (!title || !articleUrl || !publishedAt) return [];
      return [makeReceipt({ title, summary: text(article.description ?? article.snippet, 900) || null, url: articleUrl, publisher: source || "Marketaux source", publishedAt, channel: "marketaux", official: false, primarySource: false, scheduled: false, symbolHints, companyHints, rawEventType: null })];
    });
    return result({ provider: "marketaux", status: "connected", checkedAt: now.toISOString(), sourceUrls: [`${MARKETAUX_URL}?countries=us&entity_types=equity&limit=3`], receipts, recordsRead: receipts.length, entitlementVerified: true });
  } catch (error) {
    const failure = marketauxErrorCategory(error);
    return result({ provider: "marketaux", status: failure.status, sourceUrls: [MARKETAUX_URL], error: failure.error, entitlementVerified: failure.status !== "not_entitled" });
  }
}

export async function fetchCommerceNews(fetchImpl: typeof fetch, now: Date): Promise<ProviderResult> {
  const url = new URL(COMMERCE_NEWS_API_URL);
  url.searchParams.set("page[limit]", "25");
  url.searchParams.set("api_key", "DEMO_KEY");
  try {
    const { body } = await fetchText(fetchImpl, url, "application/json", 20_000);
    const json = JSON.parse(body) as { data?: Array<Record<string, unknown>> };
    if (!Array.isArray(json.data)) throw new Error("invalid_commerce_payload");
    const rows = json.data;
    const receipts = rows.flatMap((row): EventReceipt[] => {
      const attributes = row.attributes && typeof row.attributes === "object" && !Array.isArray(row.attributes)
        ? row.attributes as Record<string, unknown>
        : {};
      const fields = { ...row, ...attributes };
      const title = text(fields.label ?? fields.title, 280);
      const articleUrl = safeUrl(text(fields.href ?? fields.self));
      const timestamp = typeof fields.post_date === "number" ? fields.post_date * 1_000 : fields.post_date_formatted ?? fields.post_date;
      const publishedAt = validDate(timestamp, now, 7 * 24 * 60 * 60 * 1000);
      const newsTypes = Array.isArray(fields.news_type)
        ? fields.news_type.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value))
        : [];
      const rawEventType = newsTypes.map((value) => text(value.label, 120)).filter(Boolean).join(", ") || null;
      if (!title || !articleUrl || !publishedAt) return [];
      return [makeReceipt({
        title,
        summary: decodeXml(text(fields.body ?? fields.subtitle, 2_000)).slice(0, 900) || null,
        url: articleUrl,
        publisher: "U.S. Department of Commerce",
        publishedAt,
        channel: "federal_register",
        official: true,
        primarySource: true,
        scheduled: false,
        symbolHints: [],
        companyHints: [],
        rawEventType,
      })];
    });
    return result({
      provider: "commerce",
      status: "connected",
      checkedAt: now.toISOString(),
      sourceUrls: [COMMERCE_NEWS_API_URL],
      receipts,
      recordsRead: rows.length,
      entitlementVerified: true,
    });
  } catch (error) {
    const failure = publicFeedErrorCategory(error);
    return result({ provider: "commerce", status: failure.status, sourceUrls: [COMMERCE_NEWS_API_URL], error: failure.error });
  }
}

function alphaDate(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  const normalized = /^\d{8}T\d{6}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(9, 11)}:${raw.slice(11, 13)}:${raw.slice(13, 15)}Z` : raw;
  return normalized;
}

export async function fetchAlphaNews(fetchImpl: typeof fetch, now: Date): Promise<ProviderResult> {
  const key = process.env.ALPHA_VANTAGE_API_KEY?.trim();
  if (!key) return result({ provider: "alpha_vantage_news", status: "not_configured", sourceUrls: [ALPHA_VANTAGE_URL] });
  const url = new URL(ALPHA_VANTAGE_URL);
  url.searchParams.set("function", "NEWS_SENTIMENT");
  url.searchParams.set("topics", ["technology", "earnings", "economy_macro", "financial_markets", "mergers_and_acquisitions"][Math.floor(now.getTime() / (70 * 60_000)) % 5]);
  url.searchParams.set("time_from", new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString().replace(/[-:]/g, "").slice(0, 13));
  url.searchParams.set("sort", "LATEST");
  url.searchParams.set("limit", "1000");
  url.searchParams.set("apikey", key);
  try {
    const { body } = await fetchText(fetchImpl, url, "application/json");
    const json = JSON.parse(body) as Record<string, unknown>;
    const message = text(json.Note ?? json.Information ?? json["Error Message"]);
    if (message) throw new Error(/limit|frequency|quota/i.test(message) ? "rate_limited" : "provider_error");
    const feed = Array.isArray(json.feed) ? json.feed.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value)) : [];
    const receipts = feed.flatMap((article): EventReceipt[] => {
      const title = text(article.title, 280);
      const articleUrl = safeUrl(text(article.url));
      const publishedAt = validDate(alphaDate(article.time_published), now, 24 * 60 * 60 * 1000);
      const tickerSentiment = Array.isArray(article.ticker_sentiment) ? article.ticker_sentiment.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value)) : [];
      const symbolHints = [...new Set(tickerSentiment.map((entry) => normalizeEquitySymbol(entry.ticker)).filter((value): value is string => Boolean(value)))];
      if (!title || !articleUrl || !publishedAt) return [];
      return [makeReceipt({ title, summary: text(article.summary, 900) || null, url: articleUrl, publisher: text(article.source, 120) || "Alpha Vantage source", publishedAt, channel: "alpha_vantage", official: false, primarySource: false, scheduled: false, symbolHints, companyHints: [], rawEventType: null })];
    });
    return result({ provider: "alpha_vantage_news", status: "connected", checkedAt: now.toISOString(), sourceUrls: [`${ALPHA_VANTAGE_URL}?function=NEWS_SENTIMENT`], receipts: selectBalancedReceipts(receipts, 200), recordsRead: receipts.length, entitlementVerified: true });
  } catch (error) {
    const failure = errorCategory(error);
    return result({ provider: "alpha_vantage_news", status: failure.status, sourceUrls: [`${ALPHA_VANTAGE_URL}?function=NEWS_SENTIMENT`], error: failure.error });
  }
}

export async function fetchAlphaEarningsCalendar(fetchImpl: typeof fetch, now: Date): Promise<ProviderResult> {
  const key = process.env.ALPHA_VANTAGE_API_KEY?.trim();
  if (!key) return result({ provider: "alpha_vantage_earnings_calendar", status: "not_configured", sourceUrls: [ALPHA_VANTAGE_URL] });
  const url = new URL(ALPHA_VANTAGE_URL);
  url.searchParams.set("function", "EARNINGS_CALENDAR");
  url.searchParams.set("horizon", "3month");
  url.searchParams.set("apikey", key);
  try {
    const { body } = await fetchText(fetchImpl, url, "text/csv");
    const lines = body.trim().split(/\r?\n/);
    const headers = (lines.shift() ?? "").split(",").map((value) => value.trim());
    const at = (values: string[], name: string) => text(values[headers.indexOf(name)]);
    const today = now.toISOString().slice(0, 10);
    const near = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const receipts = lines.flatMap((line): EventReceipt[] => {
      const values = line.split(",");
      const reportDate = at(values, "reportDate");
      const ticker = normalizeEquitySymbol(at(values, "symbol"));
      const company = at(values, "name");
      if (!ticker || !reportDate || reportDate < today || reportDate > near) return [];
      const publishedAt = `${reportDate}T12:00:00.000Z`;
      return [makeReceipt({ title: `${ticker} scheduled earnings report ${reportDate}`, summary: `${company || ticker} is present in Alpha Vantage's estimated earnings calendar. Confirm timing with issuer IR or an SEC filing.`, url: "https://www.alphavantage.co/documentation/#earnings-calendar", publisher: "Alpha Vantage earnings calendar", publishedAt, channel: "alpha_vantage", official: false, primarySource: false, scheduled: true, symbolHints: [ticker], companyHints: company ? [company] : [], rawEventType: "earnings_calendar" })];
    });
    return result({ provider: "alpha_vantage_earnings_calendar", status: "connected", checkedAt: now.toISOString(), sourceUrls: [`${ALPHA_VANTAGE_URL}?function=EARNINGS_CALENDAR&horizon=3month`], receipts, recordsRead: Math.max(0, lines.length), entitlementVerified: true });
  } catch (error) {
    const failure = errorCategory(error);
    return result({ provider: "alpha_vantage_earnings_calendar", status: failure.status, sourceUrls: [`${ALPHA_VANTAGE_URL}?function=EARNINGS_CALENDAR`], error: failure.error });
  }
}

export async function fetchOfficialFeeds(fetchImpl: typeof fetch, now: Date): Promise<ProviderResult[]> {
  const settled = await Promise.allSettled(OFFICIAL_FEEDS.map(async (feed) => {
    const { body } = await fetchText(fetchImpl, feed.url, "application/rss+xml,application/atom+xml,text/xml", 15_000);
    if (!isSyndicationFeed(body)) throw new Error("invalid_feed_payload");
    const receipts = parseRss(body, { channel: feed.channel, publisher: feed.publisher, official: true, now });
    return result({ provider: feed.provider, status: "connected", checkedAt: now.toISOString(), sourceUrls: [feed.url], receipts, recordsRead: receipts.length, entitlementVerified: true });
  }));
  const rows = settled.map((item, index) => {
    if (item.status === "fulfilled") return item.value;
    const failure = publicFeedErrorCategory(item.reason);
    return result({ provider: OFFICIAL_FEEDS[index].provider, status: failure.status, sourceUrls: [OFFICIAL_FEEDS[index].url], error: failure.error });
  });
  return aggregateProviderRows(rows);
}

export async function fetchFederalRegister(fetchImpl: typeof fetch, now: Date): Promise<ProviderResult> {
  const url = new URL(FEDERAL_REGISTER_URL);
  url.searchParams.set("per_page", "100");
  url.searchParams.set("order", "newest");
  url.searchParams.set("conditions[publication_date][gte]", new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  url.searchParams.append("fields[]", "title");
  url.searchParams.append("fields[]", "abstract");
  url.searchParams.append("fields[]", "html_url");
  url.searchParams.append("fields[]", "publication_date");
  url.searchParams.append("fields[]", "agencies");
  url.searchParams.append("fields[]", "type");
  try {
    const { body } = await fetchText(fetchImpl, url, "application/json");
    const json = JSON.parse(body) as { results?: Array<Record<string, unknown>> };
    const receipts = (Array.isArray(json.results) ? json.results : []).flatMap((document): EventReceipt[] => {
      const title = text(document.title, 280);
      const documentUrl = safeUrl(text(document.html_url));
      const publishedAt = validDate(`${text(document.publication_date)}T05:00:00Z`, now, 7 * 24 * 60 * 60 * 1000);
      const agencies = Array.isArray(document.agencies) ? document.agencies.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object").map((agency) => text(agency.name, 160)).filter(Boolean) : [];
      if (!title || !documentUrl || !publishedAt) return [];
      return [makeReceipt({ title, summary: text(document.abstract, 900) || null, url: documentUrl, publisher: agencies.join(", ") || "Federal Register", publishedAt, channel: "federal_register", official: true, primarySource: true, scheduled: false, symbolHints: [], companyHints: [], rawEventType: text(document.type, 80) || null })];
    });
    return result({ provider: "federal_register", status: "connected", checkedAt: now.toISOString(), sourceUrls: [url.toString()], receipts, recordsRead: receipts.length, entitlementVerified: true });
  } catch (error) {
    const failure = errorCategory(error);
    return result({ provider: "federal_register", status: failure.status, sourceUrls: [url.toString()], error: failure.error });
  }
}

export async function fetchOpenFdaRecalls(fetchImpl: typeof fetch, now: Date): Promise<ProviderResult> {
  const url = new URL(OPENFDA_URL);
  url.searchParams.set("limit", "100");
  url.searchParams.set("sort", "report_date:desc");
  const key = process.env.OPENFDA_API_KEY?.trim();
  if (key) url.searchParams.set("api_key", key);
  try {
    const { body } = await fetchText(fetchImpl, url, "application/json", 25_000);
    const json = JSON.parse(body) as { results?: Array<Record<string, unknown>> };
    const receipts = (Array.isArray(json.results) ? json.results : []).flatMap((row): EventReceipt[] => {
      const reportDate = text(row.report_date);
      const publishedAt = validDate(/^\d{8}$/.test(reportDate) ? `${reportDate.slice(0, 4)}-${reportDate.slice(4, 6)}-${reportDate.slice(6, 8)}T12:00:00Z` : reportDate, now, 14 * 24 * 60 * 60 * 1000);
      const company = text(row.recalling_firm, 180);
      const reason = text(row.reason_for_recall, 700);
      if (!company || !publishedAt || !reason) return [];
      const recallId = text(row.event_id || row.recall_number, 120);
      const sourceUrl = `https://api.fda.gov/drug/enforcement.json?search=event_id:${encodeURIComponent(recallId)}`;
      return [makeReceipt({ title: `${company} FDA recall: ${reason.slice(0, 160)}`, summary: reason, url: sourceUrl, publisher: "U.S. Food and Drug Administration", publishedAt, channel: "openfda", official: true, primarySource: true, scheduled: false, symbolHints: [], companyHints: [company], rawEventType: "drug_recall" })];
    });
    return result({ provider: "openfda", status: "connected", checkedAt: now.toISOString(), sourceUrls: [OPENFDA_URL], receipts, recordsRead: receipts.length, entitlementVerified: true });
  } catch (error) {
    const failure = errorCategory(error);
    return result({ provider: "openfda", status: failure.status, sourceUrls: [OPENFDA_URL], error: failure.error });
  }
}

export async function collectEventSources(fetchImpl: typeof fetch, now: Date) {
  const tasks: Array<{ provider: string; sourceUrls: string[]; run: () => Promise<ProviderResult> }> = [
    { provider: "sec_edgar_current_filings", sourceUrls: ["https://www.sec.gov/cgi-bin/browse-edgar"], run: () => fetchSecCurrentFilings(fetchImpl, now) },
    { provider: "google_news_rss", sourceUrls: [GOOGLE_NEWS_URL], run: () => fetchGoogleDiscovery(fetchImpl, now) },
    { provider: "gdelt", sourceUrls: [GDELT_URL], run: () => fetchGdeltDiscovery(fetchImpl, now) },
    { provider: "marketaux", sourceUrls: [MARKETAUX_URL], run: () => fetchMarketauxDiscovery(fetchImpl, now) },
    { provider: "commerce", sourceUrls: [COMMERCE_NEWS_API_URL], run: () => fetchCommerceNews(fetchImpl, now) },
    { provider: "alpha_vantage_news", sourceUrls: [ALPHA_VANTAGE_URL], run: () => fetchAlphaNews(fetchImpl, now) },
    { provider: "alpha_vantage_earnings_calendar", sourceUrls: [ALPHA_VANTAGE_URL], run: () => fetchAlphaEarningsCalendar(fetchImpl, now) },
    { provider: "federal_register", sourceUrls: [FEDERAL_REGISTER_URL], run: () => fetchFederalRegister(fetchImpl, now) },
    { provider: "openfda", sourceUrls: [OPENFDA_URL], run: () => fetchOpenFdaRecalls(fetchImpl, now) },
  ];
  const [taskResults, officialFeedResult] = await Promise.all([
    Promise.allSettled(tasks.map((task) => task.run())),
    fetchOfficialFeeds(fetchImpl, now).catch((error) => {
      const failure = publicFeedErrorCategory(error);
      return aggregateProviderRows(OFFICIAL_FEEDS.map((feed) => result({ provider: feed.provider, status: failure.status, sourceUrls: [feed.url], error: failure.error })));
    }),
  ]);
  const isolatedResults = taskResults.map((item, index) => {
    if (item.status === "fulfilled") return item.value;
    const failure = errorCategory(item.reason);
    return result({ provider: tasks[index].provider, status: failure.status, sourceUrls: tasks[index].sourceUrls, error: failure.error });
  });
  const baseProviders = aggregateProviderRows([...isolatedResults, ...officialFeedResult]).map((provider) => withLastGoodCache(provider, now));
  const baseReceipts = selectBalancedReceipts(baseProviders.flatMap((provider) => provider.receipts), 500);
  const detailRunDue = Math.floor(now.getTime() / (5 * 60_000)) % 12 === 0;
  const detailResult = detailRunDue ? await enrichSecFilingDetails(baseReceipts, fetchImpl, now) : null;
  const detailProvider = detailResult
    ? result({ ...detailResult.provider, status: detailResult.provider.status === "partial" ? "connected" : detailResult.provider.status, error: detailResult.provider.status === "partial" ? "some_selected_filings_failed" : detailResult.provider.error, receipts: [] })
    : result({ provider: "sec_filing_details", status: "not_due", checkedAt: null, sourceUrls: [], receipts: [], recordsRead: 0, error: null, entitlementVerified: true });
  const detailByReceipt = new Map(detailResult?.details.map((detail) => [detail.receipt.id, detail]) ?? []);
  const receipts = selectBalancedReceipts(baseReceipts.map((receipt) => {
    const detail = detailByReceipt.get(receipt.id);
    if (!detail) return receipt;
    return { ...receipt, summary: `${receipt.summary ?? receipt.title} Official filing content: ${detail.text.slice(0, 12_000)}` };
  }), 500);
  return { providers: [...baseProviders, detailProvider], receipts, secFilingDetails: detailResult?.diagnostics ?? { selected: 0, enriched: 0, failed: 0, scheduledForThisRun: false } };
}
