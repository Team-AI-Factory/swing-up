/*
 * Swing Up PR262 cheap change sensor for Cloudflare Workers.
 *
 * This module intentionally contains no OpenAI client, database client, article
 * reader, valuation engine, Committee code, notification code, or trading code.
 * It only discovers small public-source changes, persists a bounded compatible
 * R2 queue, and wakes Railway's separately authenticated analysis-only route.
 */

const VERSION = 1;
const OWNER = "cloudflare_worker";
const PRODUCTION_PREFIX = "production/pr262/";
const SHADOW_PREFIX = "branch-labs/pr-262/cloudflare-shadow/";
const PREVIEW_REFERENCE_PREFIX = "branch-labs/pr-262/";
const DEFAULT_STATE_KEY = "production/pr262/sensor/state-v1.json";
const DEFAULT_RUN_PREFIX = "production/pr262/sensor/runs";
const DEFAULT_UNIVERSE_KEY = "production/pr262/equity-universe/v1.json";
const DEFAULT_EXPOSURE_KEY = "production/pr262/sensor/exposure-index-v1.json";
const DEFAULT_DIRECT_FEEDS_KEY = "production/pr262/sensor/direct-company-feeds-v1.json";
const HANDOFF_PATH = "/api/internal/combined-opportunity-engine/cloudflare-sensor-handoff";
const USER_AGENT = "SwingUp/1.0 support@swingup.app";
const FIVE_MINUTES_MS = 5 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const MAX_CLOCK_SKEW_MS = FIVE_MINUTES_MS;
const MAX_EVENT_AGE_MS = 14 * DAY_MS;
const REFERENCE_MAX_AGE_MS = 30 * 60 * 60_000;
const MAX_BODY_BYTES = 1_000_000;
const MAX_SEEN = 20_000;
const MAX_FRESH = 500;
const MAX_READY_PENDING = 2_000;
const MAX_UNRESOLVED_PENDING = 500;
const UNRESOLVED_TTL_MS = DAY_MS;
const MAX_NETWORK_CALLS = 16;
const MAX_CONCURRENCY = 4;
const DEFAULT_WALL_MS = 42_000;
const MIN_WALL_MS = 10_000;
const MAX_WALL_MS = 50_000;
const DEFAULT_REQUEST_MS = 8_000;
const MAX_HANDOFF_ATTEMPTS = 3;
const SOURCE_COMPLETION_RESERVE_MS = 8_000;
const MAX_DIRECT_ISSUER_TASKS = 24;
const MAX_PRIORITY_DIRECT_ISSUERS = 4;
const MAX_DIRECT_ISSUER_CALLS = 4;
const SEC_URGENT_FORMS = ["8-K", "6-K", "424B5"];
const GOOGLE_QUERIES = [
  '(earnings OR guidance OR acquisition OR merger OR "contract award" OR recall OR investigation OR offering) (NASDAQ OR NYSE OR company)',
  '("press release" OR "investor relations" OR "company announcement" OR buyback OR dividend) (NASDAQ OR NYSE)',
  '(FDA OR tariff OR sanctions OR cyberattack OR lawsuit OR bankruptcy OR "product launch") (NASDAQ OR NYSE OR stock)',
];
const OFFICIAL_FEEDS = [
  ["federal_reserve", "https://www.federalreserve.gov/feeds/press_all.xml"],
  ["federal_reserve_speeches", "https://www.federalreserve.gov/feeds/speeches.xml"],
  ["bls", "https://www.bls.gov/feed/bls_latest.rss"],
  ["bea", "https://apps.bea.gov/rss/rss.xml"],
  ["sec_press", "https://www.sec.gov/news/pressreleases.rss"],
  ["white_house", "https://www.whitehouse.gov/news/feed/"],
  ["cisa", "https://www.cisa.gov/cybersecurity-advisories/all.xml"],
  ["state_department", "https://www.state.gov/rss-feed/collected-department-releases/feed/"],
  ["defense_department", "https://www.defense.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=9&Site=945&max=25"],
  ["fda_medwatch", "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/medwatch/rss.xml"],
];

const PROVIDER_POLICIES = Object.freeze({
  sec_broad: { quotaKey: "sec_current_filings", minimumIntervalMs: 4.5 * 60_000, maximumPer24Hours: 650, priority: 100 },
  sec_urgent: { quotaKey: "sec_current_filings", minimumIntervalMs: 4.5 * 60_000, maximumPer24Hours: 650, priority: 99 },
  google_news: { quotaKey: "google_news", minimumIntervalMs: 4.5 * 60_000, maximumPer24Hours: 300, priority: 98 },
  trade_halts: { quotaKey: "trade_halts", minimumIntervalMs: 4.5 * 60_000, maximumPer24Hours: 300, priority: 97 },
  market_watch: { quotaKey: "tradingview", minimumIntervalMs: 4.5 * 60_000, maximumPer24Hours: 300, priority: 96 },
  gdelt: { quotaKey: "gdelt", minimumIntervalMs: 14 * 60_000, maximumPer24Hours: 100, priority: 80 },
  marketaux: { quotaKey: "marketaux", minimumIntervalMs: 14 * 60_000, maximumPer24Hours: 96, priority: 79 },
  commerce: { quotaKey: "commerce", minimumIntervalMs: 29 * 60_000, maximumPer24Hours: 52, priority: 65 },
  federal_register: { quotaKey: "federal_register", minimumIntervalMs: 29 * 60_000, maximumPer24Hours: 52, priority: 64 },
  alpha_news: { quotaKey: "alpha_vantage", minimumIntervalMs: 74 * 60_000, maximumPer24Hours: 20, priority: 55 },
  alpha_earnings: { quotaKey: "alpha_vantage", minimumIntervalMs: 23 * 60 * 60_000, maximumPer24Hours: 20, priority: 45 },
  fmp_news: { quotaKey: "fmp", minimumIntervalMs: 119 * 60_000, maximumPer24Hours: 10, priority: 44 },
  openfda: { quotaKey: "openfda", minimumIntervalMs: 23 * 60 * 60_000, maximumPer24Hours: 2, priority: 43 },
  fred: { quotaKey: "fred", minimumIntervalMs: 11.5 * 60 * 60_000, maximumPer24Hours: 6, priority: 42 },
  frankfurter: { quotaKey: "frankfurter", minimumIntervalMs: 11.5 * 60 * 60_000, maximumPer24Hours: 2, priority: 41 },
  official: { quotaKey: "official", minimumIntervalMs: 14 * 60_000, maximumPer24Hours: 1_200, priority: 70 },
  direct_discovery: { quotaKey: "sec_submissions", minimumIntervalMs: 29 * 60_000, maximumPer24Hours: 48, priority: 61 },
  direct_issuer: { quotaKey: "direct_issuer", minimumIntervalMs: 59 * 60_000, maximumPer24Hours: 480, priority: 60 },
});

function int(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.floor(parsed))) : fallback;
}

function text(value, maximum = 2_000) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maximum) : "";
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function finite(value) {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function safeError(error, fallback = "request_failed") {
  const value = error instanceof Error ? error.message : fallback;
  return text(value.replace(/(?:api[_-]?key|token|secret|authorization)=[^&\s]+/gi, "credential=[redacted]"), 180) || fallback;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeXml(value) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function xmlTag(block, name) {
  const pattern = new RegExp(`<(?:(?:[a-z0-9_-]+):)?${escapeRegex(name)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:(?:[a-z0-9_-]+):)?${escapeRegex(name)}>`, "i");
  return decodeXml(block.match(pattern)?.[1] ?? "");
}

function xmlLink(block) {
  const candidates = [...block.matchAll(/<link\b[^>]*>/gi)].map((match) => match[0]);
  const preferred = candidates.find((tag) => /\brel=["']alternate["']/i.test(tag)) ?? candidates[0] ?? "";
  const href = preferred.match(/\bhref=["']([^"']+)["']/i)?.[1];
  return decodeXml(href ?? xmlTag(block, "link"));
}

function safeHttpUrl(value, base) {
  try {
    const url = new URL(value, base);
    if (!new Set(["https:", "http:"]).has(url.protocol) || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function safeDirectHttpsUrl(value, base = undefined) {
  try {
    const url = new URL(value, base);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
    if (!host || host === "localhost" || host.includes(":") || /\.(?:local|internal|home|lan)$/.test(host)) return null;
    const octets = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) ? host.split(".").map(Number) : null;
    if (octets && (octets.some((part) => part < 0 || part > 255)
      || octets[0] === 0
      || octets[0] === 10
      || octets[0] === 127
      || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127)
      || (octets[0] === 169 && octets[1] === 254)
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 0 && [0, 2].includes(octets[2]))
      || (octets[0] === 192 && octets[1] === 88 && octets[2] === 99)
      || (octets[0] === 192 && octets[1] === 168)
      || (octets[0] === 198 && (octets[1] === 18 || octets[1] === 19))
      || (octets[0] === 198 && octets[1] === 51 && octets[2] === 100)
      || (octets[0] === 203 && octets[1] === 0 && octets[2] === 113)
      || octets[0] >= 224)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function deploymentMode(env) {
  const mode = text(env.SENSOR_DEPLOYMENT_MODE, 32).toLowerCase();
  if (mode !== "production" && mode !== "shadow") throw new Error("cloudflare_sensor_deployment_mode_invalid");
  return mode;
}

function sensorKey(env, value, productionFallback, kind = "object") {
  const mode = deploymentMode(env);
  const prefix = mode === "production" ? PRODUCTION_PREFIX : SHADOW_PREFIX;
  const fallback = mode === "production"
    ? productionFallback
    : `${SHADOW_PREFIX}${productionFallback.slice(PRODUCTION_PREFIX.length)}`;
  const key = text(value, 500) || fallback;
  if (!key.startsWith(prefix) || key.startsWith("/") || key.includes("\\") || key.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`cloudflare_sensor_${kind}_key_invalid`);
  }
  return key;
}

function sensorReferenceKey(env, value, productionFallback, kind) {
  const mode = deploymentMode(env);
  if (mode === "production") return sensorKey(env, value, productionFallback, kind);
  const isolatedFallback = `${SHADOW_PREFIX}${productionFallback.slice(PRODUCTION_PREFIX.length)}`;
  const sharedPreviewKey = `${PREVIEW_REFERENCE_PREFIX}${productionFallback.slice(PRODUCTION_PREFIX.length)}`;
  const key = text(value, 500) || isolatedFallback;
  if ((key !== sharedPreviewKey && !key.startsWith(SHADOW_PREFIX))
    || key.startsWith("/")
    || key.includes("\\")
    || key.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`cloudflare_sensor_${kind}_reference_key_invalid`);
  }
  return key;
}

function referenceR2Reader(env) {
  const mode = deploymentMode(env);
  const bucket = mode === "shadow" ? env.REFERENCE_R2 : env.SENSOR_R2;
  if (!bucket || typeof bucket.get !== "function") {
    throw new Error(mode === "shadow"
      ? "cloudflare_shadow_reference_bucket_missing"
      : "cloudflare_sensor_bucket_missing");
  }
  // Expose only GET to the scan path. Shadow state is written through
  // SENSOR_R2, while the existing PR reference bucket is read-only in code.
  return Object.freeze({ get: (...args) => bucket.get(...args) });
}

function validTimestamp(value, now, maximumAgeMs = MAX_EVENT_AGE_MS) {
  const raw = String(value ?? "").trim();
  const normalized = /^\d{8}$/.test(raw)
    ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T00:00:00.000Z`
    : /^\d{8}T\d{6}$/.test(raw)
      ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(9, 11)}:${raw.slice(11, 13)}:${raw.slice(13, 15)}.000Z`
      : raw;
  const ms = Date.parse(normalized);
  if (!Number.isFinite(ms)) return null;
  const age = now.getTime() - ms;
  if (age < -MAX_CLOCK_SKEW_MS || age > maximumAgeMs) return null;
  return new Date(ms).toISOString();
}

function normalizeCik(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits && digits.length <= 10 && !/^0+$/.test(digits) ? digits.padStart(10, "0") : null;
}

function normalizeTicker(value) {
  const candidate = String(value ?? "").trim().toUpperCase().replace(/\//g, ".");
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(candidate) ? candidate : null;
}

function referenceTimestampIsFresh(value, now) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed)
    && parsed <= now.getTime() + MAX_CLOCK_SKEW_MS
    && now.getTime() - parsed <= REFERENCE_MAX_AGE_MS;
}

export function validUniverseReference(value, now = new Date()) {
  const universe = object(value);
  const entries = Array.isArray(universe.entries) ? universe.entries : [];
  const coverage = object(universe.coverage);
  const tickers = new Set();
  let cikMapped = 0;
  return universe.version === 1
    && universe.scope === "active_us_exchange_listed_common_equities_and_adrs"
    && universe.constructionMode === "nasdaq_plus_sec"
    && referenceTimestampIsFresh(universe.refreshedAt, now)
    && entries.length > 0
    && Number.isInteger(coverage.eligibleEquities)
    && Number(coverage.eligibleEquities) === entries.length
    && entries.every((raw) => {
      const entry = object(raw);
      const ticker = normalizeTicker(entry.ticker);
      const cik = entry.cik === null ? null : normalizeCik(entry.cik);
      const valid = Boolean(ticker)
        && entry.ticker === ticker
        && Boolean(text(entry.name, 300))
        && Boolean(text(entry.exchange, 100))
        && (entry.securityType === "common_stock" || entry.securityType === "adr")
        && Array.isArray(entry.sourceNames)
        && entry.sourceNames.length > 0
        && !tickers.has(ticker)
        && (entry.cik === null || cik !== null);
      if (valid) {
        tickers.add(ticker);
        if (cik) cikMapped += 1;
      }
      return valid;
    })
    && Number.isInteger(coverage.cikMapped)
    && Number(coverage.cikMapped) === cikMapped;
}

export function validExposureReference(value, now = new Date()) {
  const exposure = object(value);
  const entries = Array.isArray(exposure.entries) ? exposure.entries : [];
  const coverage = object(exposure.valueCoverage);
  const totalCompanies = Number(coverage.totalCompanies);
  const companiesStored = Number(coverage.companiesStored);
  const completedBatches = Number(coverage.completedBatches);
  const totalBatches = Number(coverage.totalBatches);
  const tickers = new Set();
  return exposure.version === 2
    && Boolean(text(exposure.valueCycleId, 200))
    && referenceTimestampIsFresh(exposure.builtAt, now)
    && coverage.complete === true
    && Number.isInteger(totalCompanies)
    && totalCompanies > 0
    && Number.isInteger(companiesStored)
    && companiesStored === totalCompanies
    && Number.isInteger(completedBatches)
    && completedBatches > 0
    && Number.isInteger(totalBatches)
    && totalBatches === completedBatches
    && entries.length === totalCompanies
    && entries.every((raw) => {
      const entry = object(raw);
      const ticker = normalizeTicker(entry.ticker);
      const valid = Boolean(ticker)
        && entry.ticker === ticker
        && Boolean(text(entry.company, 300))
        && Boolean(text(entry.tradingViewSymbol, 100))
        && !tickers.has(ticker)
        && (entry.cik === null || entry.cik === undefined || normalizeCik(entry.cik) !== null);
      if (valid) tickers.add(ticker);
      return valid;
    });
}

function priorityFor(value, official = false) {
  const lower = value.toLowerCase();
  if (/bankrupt|going concern|restat|trading halt|clinical hold|fda.{0,30}(reject|recall)|deal blocked|cyberattack|data breach|sanction|tariff|war|military strike|sec charges|doj charges|fraud/.test(lower)) return 100;
  if (/earnings|guidance|acquisition|merger|contract|offering|buyback|dividend|investigation|ceo|cfo|fomc|interest rate|inflation|cpi|jobs|payroll/.test(lower)) return 90;
  return official ? 75 : 65;
}

async function sha256Hex(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

async function shortHash(value) {
  return (await sha256Hex(value)).slice(0, 24);
}

function baseState() {
  return {
    version: 2,
    updatedAt: new Date(0).toISOString(),
    seen: [],
    pending: [],
    lastMarketWatchAt: null,
    cursors: { secUrgentFormIndex: 0, newsQueryIndex: 0, officialFeedIndex: 0, directIssuerFeedIndex: 0 },
    sourceHealth: {},
    sensorReadiness: { version: 1, checkedAt: new Date(0).toISOString(), universeReady: false, universeEntries: 0, exposureReady: false, exposureEntries: 0 },
    cloudflareSensor: { version: VERSION, owner: OWNER, lastScanId: null, lastRunKey: null },
  };
}

function normalizeState(value) {
  const item = object(value);
  const cursors = object(item.cursors);
  const readiness = object(item.sensorReadiness);
  return {
    version: 2,
    updatedAt: validTimestamp(item.updatedAt, new Date(), 365 * DAY_MS) ?? new Date(0).toISOString(),
    seen: Array.isArray(item.seen) ? item.seen.filter((entry) => typeof entry === "string").slice(-MAX_SEEN) : [],
    pending: Array.isArray(item.pending) ? item.pending.filter((entry) => entry && typeof entry === "object") : [],
    lastMarketWatchAt: typeof item.lastMarketWatchAt === "string" ? item.lastMarketWatchAt : null,
    cursors: {
      secUrgentFormIndex: Math.max(0, Number(cursors.secUrgentFormIndex) || 0),
      newsQueryIndex: Math.max(0, Number(cursors.newsQueryIndex) || 0),
      officialFeedIndex: Math.max(0, Number(cursors.officialFeedIndex) || 0),
      directIssuerFeedIndex: Math.max(0, Number(cursors.directIssuerFeedIndex) || 0),
    },
    sourceHealth: object(item.sourceHealth),
    sensorReadiness: {
      version: 1,
      checkedAt: validTimestamp(readiness.checkedAt, new Date(), 365 * DAY_MS) ?? new Date(0).toISOString(),
      universeReady: readiness.universeReady === true,
      universeEntries: Math.max(0, Number(readiness.universeEntries) || 0),
      exposureReady: readiness.exposureReady === true,
      exposureEntries: Math.max(0, Number(readiness.exposureEntries) || 0),
    },
    cloudflareSensor: object(item.cloudflareSensor),
  };
}

function processingReady(event) {
  return Number(event.priority) >= 80
    && Boolean(event.ticker)
    && event.mappingStatus === "mapped"
    && (event.source !== "sec" || (
      event.identityMethod === "official_sec_archive_link"
      && Boolean(event.cik)
      && Boolean(event.accession)
      && Boolean(event.canonicalSecIndexUrl)
    ));
}

export function shouldInvokeAnalysisHandoff(enabled, pendingEvents) {
  return enabled === true && Number.isInteger(pendingEvents) && pendingEvents > 0;
}

export function countDueAnalysisEvents(events, now = new Date()) {
  const nowMs = now.getTime();
  return events.filter((raw) => {
    const event = object(raw);
    const retryAt = Date.parse(String(event.queueNextAttemptAt ?? ""));
    return processingReady(event) && (!Number.isFinite(retryAt) || retryAt <= nowMs);
  }).length;
}

export function partitionPendingEvents(events, now = new Date()) {
  const byId = new Map();
  for (const raw of events) {
    const event = object(raw);
    if (typeof event.id !== "string" || !event.id) continue;
    const current = byId.get(event.id);
    if (!current || Number(event.priority) > Number(current.priority) || Number(event.queueAttempts) > Number(current.queueAttempts)) byId.set(event.id, event);
  }
  const nowMs = now.getTime();
  const retryRank = (event) => {
    const retryAt = Date.parse(event.queueNextAttemptAt ?? "");
    if (Number(event.queueAttempts) > 0 && (!Number.isFinite(retryAt) || retryAt <= nowMs)) return 0;
    return Number(event.queueAttempts) > 0 ? 1 : 2;
  };
  const order = (left, right) => retryRank(left) - retryRank(right)
    || Number(right.priority) - Number(left.priority)
    || (retryRank(left) === 2
      ? String(right.observedAt).localeCompare(String(left.observedAt))
      : String(left.observedAt).localeCompare(String(right.observedAt)));
  const ready = [...byId.values()].filter(processingReady).sort(order).slice(0, MAX_READY_PENDING);
  const unresolved = [...byId.values()].filter((event) => !processingReady(event)).filter((event) => {
    const observedAt = Date.parse(event.observedAt ?? "");
    return Number.isFinite(observedAt) && nowMs - observedAt <= UNRESOLVED_TTL_MS;
  }).sort((left, right) => Number(right.priority) - Number(left.priority) || String(right.observedAt).localeCompare(String(left.observedAt))).slice(0, MAX_UNRESOLVED_PENDING);
  return [...ready, ...unresolved];
}

function createResolver(universe, exposure) {
  const rows = Array.isArray(object(universe).entries) ? object(universe).entries.map(object) : [];
  const exposures = Array.isArray(object(exposure).entries) ? object(exposure).entries.map(object) : [];
  const byTicker = new Map();
  const byCik = new Map();
  for (const row of [...rows, ...exposures]) {
    const ticker = normalizeTicker(row.ticker);
    const company = text(row.name ?? row.company, 300);
    if (!ticker || !company) continue;
    const entry = { ticker, company, cik: normalizeCik(row.cik), tradingViewSymbol: text(row.tradingViewSymbol, 80) || null };
    if (!byTicker.has(ticker) || (!byTicker.get(ticker).cik && entry.cik)) byTicker.set(ticker, entry);
    if (entry.cik) {
      const current = byCik.get(entry.cik);
      if (!current) byCik.set(entry.cik, entry);
      else if (current.ticker !== ticker) byCik.set(entry.cik, null);
    }
  }
  return {
    byTicker,
    byCik,
    resolve({ ticker, cik, source }) {
      const normalizedCik = normalizeCik(cik);
      if (source === "sec" && normalizedCik) {
        const match = byCik.get(normalizedCik);
        return match ? { ...match, method: "official_sec_cik_exact" } : null;
      }
      if (source === "sec") return null;
      const normalizedTicker = normalizeTicker(ticker);
      if (normalizedTicker && byTicker.has(normalizedTicker)) return { ...byTicker.get(normalizedTicker), method: "structured_ticker_exact" };
      return null;
    },
  };
}

export function refreshQueuedMapping(eventValue, resolver) {
  const event = object(eventValue);
  if (event.mappingStatus === "mapped") return event;
  const source = text(event.source, 40);
  const resolved = resolver.resolve({ ticker: event.ticker, cik: event.cik, source });
  const completeSecIdentity = source !== "sec" || (
    event.identityMethod === "official_sec_archive_link"
    && Boolean(normalizeCik(event.cik))
    && Boolean(text(event.accession, 40))
    && Boolean(safeHttpUrl(event.canonicalSecIndexUrl))
  );
  if (!resolved || !completeSecIdentity) return event;
  return {
    ...event,
    ticker: resolved.ticker,
    company: resolved.company,
    cik: normalizeCik(event.cik) ?? resolved.cik ?? null,
    mappingStatus: "mapped",
    mappingMethod: resolved.method,
    mappingReason: "Cloudflare rechecked the queued structured identity against fresh authoritative reference data.",
    ...(resolved.tradingViewSymbol ? { tradingViewSymbol: resolved.tradingViewSymbol } : {}),
  };
}

async function makeEvent(input, resolver, now) {
  const observedAt = validTimestamp(input.observedAt, now, input.maximumAgeMs ?? MAX_EVENT_AGE_MS);
  const url = safeHttpUrl(input.url);
  if (!observedAt || !url || !text(input.title, 300)) return null;
  const source = input.source ?? (input.official ? "official" : "company_news");
  const candidateResolution = resolver.resolve({ ticker: input.ticker, cik: input.cik, source });
  const resolved = source !== "sec" || (input.accession && input.canonicalSecIndexUrl)
    ? candidateResolution
    : null;
  const cik = normalizeCik(input.cik) ?? resolved?.cik ?? null;
  const ticker = resolved?.ticker ?? normalizeTicker(input.ticker);
  const identity = `${input.provider}|${input.identity ?? url}|${observedAt}|${ticker ?? cik ?? "unmapped"}`;
  const event = {
    id: `${input.idPrefix ?? "cf"}:${await shortHash(identity)}`,
    source,
    sourceProvider: input.provider,
    sourceHealthStatus: "connected",
    observedAt,
    title: text(input.title, 300),
    url,
    sourceUrl: safeHttpUrl(input.sourceUrl) ?? url,
    ticker: ticker ?? null,
    company: resolved?.company ?? (text(input.company, 300) || null),
    kind: text(input.kind, 100) || "news",
    priority: int(input.priority, priorityFor(`${input.title} ${input.summary ?? ""}`, Boolean(input.official)), 0, 100),
    reason: text(input.reason, 500) || "A low-cost source change was detected. Railway must verify evidence, causality, valuation, and risk before any Serious Signal.",
    cik,
    form: text(input.form, 30) || null,
    accession: text(input.accession, 30) || null,
    canonicalSecIndexUrl: safeHttpUrl(input.canonicalSecIndexUrl) ?? null,
    identityMethod: source === "sec" && cik && input.accession && input.canonicalSecIndexUrl ? "official_sec_archive_link" : source === "sec" ? "sec_identity_unavailable" : "not_applicable",
    ...(resolved ? {
      mappingStatus: "mapped",
      mappingMethod: resolved.method,
      mappingReason: "Cloudflare used an exact cached universe identity. Railway repeats fail-closed mapping before analysis.",
      ...(resolved.tradingViewSymbol ? { tradingViewSymbol: resolved.tradingViewSymbol } : {}),
    } : {
      mappingStatus: "unmapped",
      mappingMethod: source === "sec" ? "cloudflare_sec_cik_mapping_deferred" : "cloudflare_structured_ticker_mapping_deferred",
      mappingReason: source === "sec"
        ? "No complete filing identity and exact cached CIK mapping was available. Railway must retain this event as unresolved."
        : "No explicit structured ticker matched the cached universe. Company names and headline mentions are never used as issuer identity.",
    }),
    queueAttempts: 0,
    queueNextAttemptAt: null,
    queueLastAttemptAt: null,
    queueLastError: null,
  };
  return event;
}

function accessionFrom(value) {
  const dashed = String(value ?? "").match(/\b(\d{10}-\d{2}-\d{6})\b/)?.[1];
  if (dashed) return dashed;
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length === 18 ? `${digits.slice(0, 10)}-${digits.slice(10, 12)}-${digits.slice(12)}` : null;
}

export async function parseSecAtom(xml, context) {
  if (!/<feed\b/i.test(xml) || !/<\/feed>/i.test(xml)) {
    throw new Error("sec_feed_contract_invalid");
  }
  const blocks = [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((match) => match[0]).slice(0, 100);
  const events = [];
  let invalidIdentityCount = 0;
  let invalidTimestampCount = 0;
  let invalidRecordCount = 0;
  for (const block of blocks) {
    const title = xmlTag(block, "title");
    const rawUrl = xmlLink(block);
    const observedAt = xmlTag(block, "updated") || xmlTag(block, "published");
    const summary = xmlTag(block, "summary");
    if (!title || !safeHttpUrl(rawUrl)) {
      invalidRecordCount += 1;
      continue;
    }
    if (!validTimestamp(observedAt, context.now, 365 * DAY_MS)) {
      invalidTimestampCount += 1;
      continue;
    }
    const form = block.match(/<category\b[^>]*\bterm=["']([^"']+)["']/i)?.[1] ?? context.form ?? null;
    let target = rawUrl;
    try {
      const parsed = new URL(rawUrl);
      target = parsed.pathname.toLowerCase() === "/ix" ? decodeURIComponent(parsed.searchParams.get("doc") ?? parsed.pathname) : parsed.pathname;
    } catch {}
    const cik = normalizeCik(target.match(/\/archives\/edgar\/data\/(\d+)\//i)?.[1] ?? xmlTag(block, "cik-number"));
    const accession = accessionFrom(target) ?? accessionFrom(summary);
    const accessionDigits = accession?.replace(/-/g, "") ?? null;
    const canonicalSecIndexUrl = cik && accession && accessionDigits
      ? `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionDigits}/${accession}-index.html`
      : null;
    if (!cik || !accession || !canonicalSecIndexUrl) invalidIdentityCount += 1;
    const event = await makeEvent({
      provider: context.provider,
      idPrefix: "cf-sec",
      identity: accession ?? rawUrl,
      source: "sec",
      official: true,
      observedAt,
      title,
      summary,
      url: canonicalSecIndexUrl ?? rawUrl,
      sourceUrl: context.sourceUrl,
      cik,
      form,
      accession,
      canonicalSecIndexUrl,
      kind: `sec_${String(form ?? "filing").toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
      priority: priorityFor(`${form ?? ""} ${title} ${summary}`, true),
      reason: "A new official SEC filing was detected. The filing identity is retained; Railway must read and verify the filing before a signal.",
      maximumAgeMs: 48 * 60 * 60_000,
    }, context.resolver, context.now);
    if (event) events.push(event);
  }
  const invalid = invalidIdentityCount + invalidTimestampCount + invalidRecordCount;
  return {
    recordsRead: blocks.length,
    events,
    status: invalid > 0 ? "partial" : "connected",
    error: invalid > 0
      ? `invalid_sec_records:identity=${invalidIdentityCount},timestamp=${invalidTimestampCount},record=${invalidRecordCount}`
      : null,
  };
}

function structuredTicker(value) {
  return normalizeTicker(String(value ?? "").match(/(?:\$|NASDAQ:\s*|NYSE:\s*|AMEX:\s*)([A-Z][A-Z0-9.-]{0,9})\b/i)?.[1]);
}

export async function parseRss(xml, context) {
  const validContainer = /<(?:rss|feed|rdf:RDF)\b/i.test(xml)
    && /<\/(?:rss|feed|rdf:RDF)>/i.test(xml);
  if (!validContainer) throw new Error("rss_feed_contract_invalid");
  const blocks = [...xml.matchAll(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi)].map((match) => match[0]).slice(0, context.limit ?? 100);
  const events = [];
  let invalidTimestampCount = 0;
  let invalidRecordCount = 0;
  for (const block of blocks) {
    const title = xmlTag(block, "title");
    const summary = xmlTag(block, "description") || xmlTag(block, "summary") || xmlTag(block, "content");
    const url = safeHttpUrl(xmlLink(block), context.sourceUrl);
    const observedAt = xmlTag(block, "pubDate") || xmlTag(block, "published") || xmlTag(block, "updated") || xmlTag(block, "date");
    if (!title || !url) {
      invalidRecordCount += 1;
      continue;
    }
    if (!validTimestamp(observedAt, context.now, 365 * DAY_MS)) {
      invalidTimestampCount += 1;
      continue;
    }
    const event = await makeEvent({
      provider: context.provider,
      idPrefix: context.idPrefix ?? "cf-rss",
      identity: url ?? `${title}|${observedAt}`,
      source: context.official ? "official" : "company_news",
      official: context.official,
      observedAt,
      title,
      summary,
      url,
      sourceUrl: context.sourceUrl,
      ticker: context.ticker ?? structuredTicker(`${title} ${summary}`),
      company: context.company,
      cik: context.cik,
      kind: context.kind ?? "news",
      reason: context.reason,
      maximumAgeMs: context.maximumAgeMs,
    }, context.resolver, context.now);
    if (event) events.push(event);
  }
  const invalid = invalidTimestampCount + invalidRecordCount;
  return {
    recordsRead: blocks.length,
    events,
    status: invalid > 0 ? "partial" : "connected",
    error: invalid > 0 ? `invalid_feed_records:timestamp=${invalidTimestampCount},record=${invalidRecordCount}` : null,
  };
}

function secUrl(form = null) {
  const url = new URL("https://www.sec.gov/cgi-bin/browse-edgar");
  url.searchParams.set("action", "getcurrent");
  url.searchParams.set("output", "atom");
  url.searchParams.set("owner", "include");
  url.searchParams.set("count", "100");
  if (form) url.searchParams.set("type", form);
  return url.toString();
}

function googleUrl(query) {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", `${query} when:1h`);
  url.searchParams.set("hl", "en-US");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");
  return url.toString();
}

function sourceHealth(provider, result, now, prior) {
  const connected = result.status === "connected" || result.status === "partial";
  const failures = connected ? 0 : Number(prior?.consecutiveFailures ?? 0) + 1;
  const retryMs = result.status === "rate_limited" ? 30 * 60_000 : Math.min(30 * 60_000, 60_000 * (2 ** Math.min(5, Math.max(0, failures - 1))));
  return {
    provider,
    status: result.status,
    checkedAt: result.attempted ? now.toISOString() : prior?.checkedAt ?? null,
    lastSuccessAt: connected ? now.toISOString() : prior?.lastSuccessAt ?? null,
    lastSuccessStatus: connected ? result.status : prior?.lastSuccessStatus ?? null,
    nextRetryAt: connected || !result.attempted ? null : new Date(now.getTime() + retryMs).toISOString(),
    consecutiveFailures: failures,
    recordsRead: result.recordsRead ?? 0,
    error: result.error ?? null,
    sourceUrls: result.urls ?? [],
    attemptedThisCycle: result.attempted,
    skipReason: result.attempted ? null : result.skipReason ?? "not_scheduled",
  };
}

function bucketHour(ms) {
  return new Date(Math.floor(ms / 3_600_000) * 3_600_000).toISOString().slice(0, 13);
}

function pruneBudget(ledger, nowMs) {
  const oldest = Math.floor((nowMs - DAY_MS) / 3_600_000) * 3_600_000;
  for (const [quotaKey, buckets] of Object.entries(object(ledger.hourlyCounts))) {
    for (const key of Object.keys(object(buckets))) {
      const parsed = Date.parse(`${key}:00:00.000Z`);
      if (!Number.isFinite(parsed) || parsed < oldest) delete buckets[key];
    }
    if (!Object.keys(buckets).length) delete ledger.hourlyCounts[quotaKey];
  }
  for (const [provider, value] of Object.entries(object(ledger.lastAttemptAt))) {
    const parsed = Date.parse(String(value));
    if (!Number.isFinite(parsed) || nowMs - parsed > 2 * DAY_MS) delete ledger.lastAttemptAt[provider];
  }
  ledger.updatedAt = new Date(nowMs).toISOString();
}

function budgetCount(ledger, quotaKey) {
  return Object.values(object(ledger.hourlyCounts?.[quotaKey])).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
}

function normalizeBudget(raw) {
  const item = object(raw);
  return {
    version: 1,
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : new Date(0).toISOString(),
    hourlyCounts: object(item.hourlyCounts),
    lastAttemptAt: object(item.lastAttemptAt),
  };
}

export async function reserveProvider(storage, provider, atMs, cadenceKey = provider, minimumIntervalMs = null) {
  const policy = PROVIDER_POLICIES[provider];
  if (!policy) throw new Error(`unknown_provider_policy:${provider}`);
  return storage.transaction(async (transaction) => {
    const ledger = normalizeBudget(await transaction.get("providerBudget"));
    pruneBudget(ledger, atMs);
    const used = budgetCount(ledger, policy.quotaKey);
    if (used >= policy.maximumPer24Hours) return { allowed: false, reason: "rolling_24h_budget", used, maximum: policy.maximumPer24Hours };
    const cadence = text(cadenceKey, 300);
    if (!cadence) throw new Error(`provider_cadence_key_invalid:${provider}`);
    const intervalMs = int(minimumIntervalMs, policy.minimumIntervalMs, FIVE_MINUTES_MS, DAY_MS);
    const last = Date.parse(String(ledger.lastAttemptAt[cadence] ?? ""));
    if (Number.isFinite(last) && atMs - last < intervalMs) {
      return { allowed: false, reason: "minimum_interval", nextEligibleAt: new Date(last + intervalMs).toISOString(), used, maximum: policy.maximumPer24Hours };
    }
    const key = bucketHour(atMs);
    const buckets = ledger.hourlyCounts[policy.quotaKey] ??= {};
    buckets[key] = Math.max(0, Number(buckets[key]) || 0) + 1;
    ledger.lastAttemptAt[cadence] = new Date(atMs).toISOString();
    await transaction.put("providerBudget", ledger);
    return { allowed: true, reason: null, used: used + 1, maximum: policy.maximumPer24Hours };
  });
}

async function readJsonFromR2(bucket, key, fallback = null) {
  const item = await bucket.get(key);
  if (!item || !item.body) return { value: fallback, etag: item?.etag ?? null, invalid: false };
  try { return { value: await item.json(), etag: item.etag, invalid: false }; }
  catch { return { value: fallback, etag: item.etag, invalid: true }; }
}

async function fetchBounded(url, init, deadlineMs, maximumBytes = MAX_BODY_BYTES) {
  if (Date.now() + 500 >= deadlineMs) throw new Error("sensor_wall_deadline");
  const timeoutMs = Math.max(500, Math.min(DEFAULT_REQUEST_MS, deadlineMs - Date.now() - 250));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("source_timeout"), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      headers: { Accept: "application/json,application/rss+xml,application/atom+xml,text/xml,text/plain", "user-agent": USER_AGENT, ...(init?.headers ?? {}) },
      redirect: init?.redirect ?? "follow",
      signal: controller.signal,
    });
    if (init?.redirect === "manual" && response.status >= 300 && response.status < 400) {
      return {
        status: response.status,
        body: new ArrayBuffer(0),
        text: "",
        contentType: response.headers.get("content-type") ?? "",
        finalUrl: response.url || url,
        redirectLocation: response.headers.get("location") ?? "",
      };
    }
    if (!response.ok) {
      const error = new Error(`http_${response.status}`);
      error.status = response.status;
      throw error;
    }
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maximumBytes) throw new Error("source_body_too_large");
    const body = await response.arrayBuffer();
    if (body.byteLength > maximumBytes) throw new Error("source_body_too_large");
    return { status: response.status, body, text: new TextDecoder().decode(body), contentType: response.headers.get("content-type") ?? "", finalUrl: response.url || url, redirectLocation: null };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchDirectBounded(url, init, deadlineMs, maximumBytes = MAX_BODY_BYTES) {
  let current = safeDirectHttpsUrl(url);
  if (!current) throw new Error("direct_source_url_invalid");
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const response = await fetchBounded(current, { ...init, redirect: "manual" }, deadlineMs, maximumBytes);
    if (response.status < 300 || response.status >= 400) return response;
    const next = safeDirectHttpsUrl(response.redirectLocation, current);
    if (!next) throw new Error("direct_source_redirect_invalid");
    current = next;
  }
  throw new Error("direct_source_redirect_limit");
}

function sourceFailure(error) {
  const message = safeError(error);
  if (/http_429|rate.?limit/i.test(message)) return { status: "rate_limited", error: "rate_limited" };
  if (/http_(?:401|402|403)/i.test(message)) return { status: "temporarily_unavailable", error: "source_access_denied" };
  if (/sensor_wall_deadline/.test(message)) return { status: "not_due", error: null };
  return { status: "temporarily_unavailable", error: message };
}

export async function parseJsonRows(payload, context) {
  const body = object(payload);
  const recognized = Array.isArray(payload)
    || Array.isArray(body.data)
    || Array.isArray(body.results)
    || Array.isArray(body.articles)
    || Array.isArray(body.feed);
  if (!recognized) throw new Error("json_feed_contract_invalid");
  const rows = Array.isArray(payload) ? payload
    : Array.isArray(body.data) ? body.data
      : Array.isArray(body.results) ? body.results
        : Array.isArray(body.articles) ? body.articles
          : body.feed;
  const events = [];
  let invalidRecordCount = 0;
  let invalidTimestampCount = 0;
  for (const raw of rows.slice(0, context.limit ?? 100)) {
    const row = object(raw);
    const symbols = Array.isArray(row.symbols) ? row.symbols.map((value) => normalizeTicker(object(value).symbol ?? value)).filter(Boolean) : [];
    const sentiments = Array.isArray(row.ticker_sentiment) ? row.ticker_sentiment.map((value) => normalizeTicker(object(value).ticker)).filter(Boolean) : [];
    const ticker = normalizeTicker(row.symbol ?? row.ticker) ?? symbols[0] ?? sentiments[0] ?? structuredTicker(`${row.title ?? ""} ${row.description ?? row.summary ?? ""}`);
    const title = text(row.title ?? row.headline ?? row.name ?? row.reason_for_recall ?? row.type, 300);
    const summary = text(row.description ?? row.summary ?? row.text ?? row.reason_for_recall ?? row.abstract, 900);
    const url = safeHttpUrl(String(row.url ?? row.link ?? row.html_url ?? row.sourceUrl ?? context.sourceUrl), context.sourceUrl);
    const observedAt = row.published_at ?? row.publishedDate ?? row.time_published ?? row.seendate ?? row.publication_date ?? row.date ?? row.recall_initiation_date;
    const company = text(row.company ?? row.recalling_firm ?? row.entity, 300) || null;
    if (!title || !url) {
      invalidRecordCount += 1;
      continue;
    }
    if (!validTimestamp(observedAt, context.now, 365 * DAY_MS)) {
      invalidTimestampCount += 1;
      continue;
    }
    const event = await makeEvent({
      provider: context.provider,
      idPrefix: `cf-${context.provider}`,
      identity: row.uuid ?? row.id ?? row.recall_number ?? url ?? `${title}|${observedAt}`,
      source: context.official ? "official" : "company_news",
      official: context.official,
      observedAt,
      title,
      summary,
      url,
      sourceUrl: context.sourceUrl,
      ticker,
      company,
      kind: context.kind,
      maximumAgeMs: context.maximumAgeMs,
      reason: context.reason,
    }, context.resolver, context.now);
    if (event) events.push(event);
  }
  const invalid = invalidRecordCount + invalidTimestampCount;
  return {
    recordsRead: rows.length,
    events,
    status: invalid > 0 ? "partial" : "connected",
    error: invalid > 0 ? `invalid_json_records:timestamp=${invalidTimestampCount},record=${invalidRecordCount}` : null,
  };
}

async function parseTradeHalts(payload, context) {
  const json = (() => { try { return JSON.parse(payload); } catch { return null; } })();
  if (!json) return parseRss(payload, { ...context, official: true, kind: "trading_halt", maximumAgeMs: 30 * 60_000 });
  const root = object(json);
  const recognized = Array.isArray(json) || Array.isArray(root.data) || Array.isArray(root.results);
  if (!recognized) throw new Error("trade_halt_feed_contract_invalid");
  const rows = Array.isArray(json) ? json : Array.isArray(root.data) ? root.data : root.results;
  const events = [];
  let invalidRecordCount = 0;
  for (const raw of rows.slice(0, 200)) {
    const row = object(raw);
    const ticker = normalizeTicker(row.symbol ?? row.ticker ?? row.issueSymbol);
    const observedAt = row.haltTime ?? row.halt_time ?? row.date ?? row.timestamp;
    if (!ticker || !validTimestamp(observedAt, context.now, 7 * DAY_MS)) {
      invalidRecordCount += 1;
      continue;
    }
    const title = `${ticker ?? "Market"} trading halt ${text(row.reason ?? row.reasonCode ?? row.haltReason, 120)}`.trim();
    const event = await makeEvent({ provider: context.provider, idPrefix: "cf-halt", identity: `${ticker}|${observedAt}|${title}`, source: "official", official: true, observedAt, title, summary: title, url: context.sourceUrl, sourceUrl: context.sourceUrl, ticker, kind: "trading_halt", priority: 100, maximumAgeMs: 30 * 60_000, reason: "An official exchange halt record changed. Railway must confirm the current halt status before any signal." }, context.resolver, context.now);
    if (event) events.push(event);
  }
  return {
    recordsRead: rows.length,
    events,
    status: invalidRecordCount > 0 ? "partial" : "connected",
    error: invalidRecordCount > 0 ? `invalid_trade_halt_records:${invalidRecordCount}` : null,
  };
}

async function marketWatch(context) {
  const rows = Array.isArray(object(context.exposure).entries) ? object(context.exposure).entries.map(object) : [];
  const watch = rows.filter((row) => text(row.tradingViewSymbol, 80) && (finite(row.buyBelowPrice) !== null || finite(row.strongBuyBelowPrice) !== null || finite(row.trimAbovePrice) !== null || (finite(row.businessQuality) ?? 0) >= 70))
    .sort((left, right) => (finite(right.businessQuality) ?? 0) - (finite(left.businessQuality) ?? 0) || (finite(right.marketCap) ?? 0) - (finite(left.marketCap) ?? 0)).slice(0, 500);
  if (!watch.length) return { recordsRead: 0, events: [] };
  const sourceUrl = "https://scanner.tradingview.com/america/scan";
  const response = await fetchBounded(sourceUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ symbols: { tickers: watch.map((row) => row.tradingViewSymbol), query: { types: [] } }, columns: ["name", "description", "close", "change", "volume", "relative_volume_10d_calc"] }),
  }, context.deadlineMs);
  const payload = JSON.parse(response.text);
  if (!Array.isArray(object(payload).data)) throw new Error("tradingview_scan_contract_invalid");
  const byTicker = new Map(watch.map((row) => [normalizeTicker(row.ticker), row]));
  const events = [];
  for (const raw of (Array.isArray(object(payload).data) ? object(payload).data : [])) {
    const row = object(raw);
    const data = Array.isArray(row.d) ? row.d : [];
    const ticker = normalizeTicker(data[0]);
    const price = finite(data[2]);
    const change = finite(data[3]) ?? 0;
    const relativeVolume = finite(data[5]) ?? 0;
    const item = byTicker.get(ticker);
    if (!item || price === null || price <= 0) continue;
    const strong = finite(item.strongBuyBelowPrice);
    const buy = finite(item.buyBelowPrice);
    const trim = finite(item.trimAbovePrice);
    const threshold = strong !== null && price <= strong ? "strong_buy_price_crossed" : buy !== null && price <= buy ? "buy_price_crossed" : trim !== null && price >= trim ? "trim_price_crossed" : null;
    if (!threshold && Math.abs(change) < 5 && relativeVolume < 3) continue;
    const kind = threshold ?? "unusual_price_or_volume";
    const event = await makeEvent({ provider: "market_watch", idPrefix: "cf-market", identity: `${ticker}|${kind}|${Math.round(price * 100) / 100}|${context.now.toISOString().slice(0, 16)}`, source: "market_price", official: false, observedAt: context.now.toISOString(), title: `${ticker} ${kind} at ${price}`, summary: `${change.toFixed(1)}% price change and ${relativeVolume.toFixed(1)}x relative volume`, url: `https://www.tradingview.com/symbols/${encodeURIComponent(text(row.s, 80) || ticker)}/`, sourceUrl, ticker, company: item.company, cik: item.cik, kind, priority: threshold === "strong_buy_price_crossed" ? 100 : threshold ? 92 : 80, reason: threshold ? "A stored valuation threshold crossed; Railway must refresh the quote and re-check the thesis." : "A large price or volume change was detected; Railway must determine whether it has a material fundamental cause." }, context.resolver, context.now);
    if (event) events.push(event);
  }
  return { recordsRead: watch.length, events };
}

function parseCsv(textBody) {
  const lines = textBody.split(/\r?\n/).filter(Boolean);
  const headers = (lines.shift() ?? "").split(",").map((value) => value.trim());
  return lines.map((line) => {
    // The small official feeds used here do not contain quoted commas in the
    // selected fields. Reject malformed rows instead of guessing.
    const values = line.split(",");
    if (values.length !== headers.length) return null;
    return Object.fromEntries(values.map((value, index) => [headers[index], value.trim()]));
  }).filter(Boolean);
}

async function fredMacro(context) {
  const sourceUrl = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFF,CPIAUCSL,UNRATE";
  const response = await fetchBounded(sourceUrl, {}, context.deadlineMs);
  const rows = parseCsv(response.text);
  if (!rows.length) throw new Error("fred_feed_contract_invalid");
  const latestBySeries = {};
  for (const series of ["DFF", "CPIAUCSL", "UNRATE"]) {
    const values = rows.map((row) => ({ date: row.observation_date ?? row.DATE, value: finite(row[series]) })).filter((row) => row.date && row.value !== null);
    latestBySeries[series] = values.at(-1) ?? null;
  }
  if (!Object.values(latestBySeries).some((value) => value && finite(value.value) !== null)) {
    throw new Error("fred_feed_contract_invalid");
  }
  const previous = object(await context.storage.get("macro:fred:last"));
  await context.storage.put("macro:fred:last", latestBySeries);
  const changes = [];
  const priorDff = finite(object(previous.DFF).value);
  const dffChange = latestBySeries.DFF?.value !== null && latestBySeries.DFF?.value !== undefined && priorDff !== null
    ? latestBySeries.DFF.value - priorDff
    : null;
  const cpiPrevious = finite(object(previous.CPIAUCSL).value);
  const cpiChange = cpiPrevious ? ((latestBySeries.CPIAUCSL?.value - cpiPrevious) / cpiPrevious) * 100 : null;
  const priorUnemployment = finite(object(previous.UNRATE).value);
  const unemploymentChange = latestBySeries.UNRATE?.value !== null && latestBySeries.UNRATE?.value !== undefined && priorUnemployment !== null
    ? latestBySeries.UNRATE.value - priorUnemployment
    : null;
  if (Number.isFinite(dffChange) && Math.abs(dffChange) >= 0.24) changes.push(`effective federal funds rate changed ${dffChange.toFixed(2)} points`);
  if (Number.isFinite(cpiChange) && Math.abs(cpiChange) >= 0.7) changes.push(`CPI changed ${cpiChange.toFixed(2)}% from the prior stored release`);
  if (Number.isFinite(unemploymentChange) && Math.abs(unemploymentChange) >= 0.2) changes.push(`unemployment changed ${unemploymentChange.toFixed(1)} points`);
  if (!changes.length) return { recordsRead: rows.length, events: [] };
  const observedAt = [latestBySeries.DFF?.date, latestBySeries.CPIAUCSL?.date, latestBySeries.UNRATE?.date].filter(Boolean).sort().at(-1);
  const title = `Official U.S. macro change: ${changes.join("; ")}`;
  const event = await makeEvent({ provider: "fred", idPrefix: "cf-fred", identity: `${observedAt}|${changes.join("|")}`, source: "official", official: true, observedAt: `${observedAt}T00:00:00.000Z`, title, summary: title, url: sourceUrl, sourceUrl, kind: "macro_regime_change", priority: 88, maximumAgeMs: 40 * DAY_MS, reason: "A material change was detected in an official stored macro series. Railway must test the causal sector and issuer effects." }, context.resolver, context.now);
  return { recordsRead: rows.length, events: event ? [event] : [] };
}

async function frankfurterMacro(context) {
  const sourceUrl = "https://api.frankfurter.app/latest?from=USD&to=EUR,GBP,JPY,CNY";
  const payload = JSON.parse((await fetchBounded(sourceUrl, {}, context.deadlineMs)).text);
  const rates = object(payload.rates);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payload.date ?? ""))
    || !["EUR", "GBP", "JPY", "CNY"].every((currency) => finite(rates[currency]) !== null)) {
    throw new Error("frankfurter_feed_contract_invalid");
  }
  const previous = object(await context.storage.get("macro:fx:last"));
  await context.storage.put("macro:fx:last", { date: payload.date, rates });
  const moves = Object.entries(rates).flatMap(([currency, raw]) => {
    const current = finite(raw);
    const prior = finite(object(previous.rates)[currency]);
    if (current === null || prior === null || prior === 0) return [];
    const change = ((current - prior) / prior) * 100;
    return Math.abs(change) >= 2 ? [`${currency} ${change.toFixed(2)}%`] : [];
  });
  if (!moves.length) return { recordsRead: Object.keys(rates).length, events: [] };
  const observedAt = `${payload.date}T00:00:00.000Z`;
  const title = `Material official FX move versus USD: ${moves.join(", ")}`;
  const event = await makeEvent({ provider: "frankfurter", idPrefix: "cf-fx", identity: `${payload.date}|${moves.join("|")}`, source: "official", official: true, observedAt, title, summary: title, url: sourceUrl, sourceUrl, kind: "macro_fx_change", priority: 88, maximumAgeMs: 2 * DAY_MS, reason: "A material currency move was detected from the official ECB reference-rate feed. Railway must test company-specific exposure." }, context.resolver, context.now);
  return { recordsRead: Object.keys(rates).length, events: event ? [event] : [] };
}

function sectorTargets(value) {
  const lower = value.toLowerCase();
  const targets = new Set();
  if (/federal reserve|fomc|interest rate|treasury yield|inflation|cpi/.test(lower)) ["financial", "real estate", "consumer cyclical"].forEach((item) => targets.add(item));
  if (/tariff|trade war|export control|sanction|customs|import duty/.test(lower)) ["technology", "industrials", "basic materials", "consumer cyclical", "energy"].forEach((item) => targets.add(item));
  if (/oil|opec|crude|natural gas|lng/.test(lower)) ["energy", "industrials", "consumer cyclical"].forEach((item) => targets.add(item));
  if (/cyber|ransomware|security vulnerability|data breach/.test(lower)) ["technology", "financial"].forEach((item) => targets.add(item));
  if (/war|military|defense|missile|invasion|geopolitical/.test(lower)) ["industrials", "technology", "energy"].forEach((item) => targets.add(item));
  if (/fda|drug|clinical|biotech|medical device/.test(lower)) targets.add("health");
  if (/jobs|payroll|unemployment|labor market/.test(lower)) ["consumer cyclical", "industrials", "financial"].forEach((item) => targets.add(item));
  if (/currency|\bfx\b|usd|eur|gbp|jpy|cny/.test(lower)) ["technology", "industrials", "consumer cyclical", "basic materials"].forEach((item) => targets.add(item));
  return [...targets];
}

function fanOutEvents(events, exposure) {
  const rows = Array.isArray(object(exposure).entries) ? object(exposure).entries.map(object) : [];
  return events.flatMap((event) => {
    if (event.ticker || event.source !== "official" || Number(event.priority) < 85) return [];
    const targets = sectorTargets(`${event.title} ${event.reason}`);
    if (!targets.length) return [];
    return rows.filter((row) => {
      const value = `${row.sector ?? ""} ${row.industry ?? ""}`.toLowerCase();
      return targets.some((target) => value.includes(target));
    }).sort((left, right) => (finite(right.marketCap) ?? 0) - (finite(left.marketCap) ?? 0) || (finite(right.businessQuality) ?? 0) - (finite(left.businessQuality) ?? 0)).slice(0, 30).flatMap((row) => {
      const ticker = normalizeTicker(row.ticker);
      if (!ticker) return [];
      return [{ ...event, id: `${event.id}:fanout:${ticker}`, ticker, company: text(row.company, 300) || ticker, cik: normalizeCik(row.cik), priority: Math.max(82, Number(event.priority) - 3), reason: `${event.reason} Deterministic sector fan-out mapped the event to ${ticker}; Railway must prove issuer-specific transmission.`, mappingStatus: "mapped", mappingMethod: "deterministic_sector_fanout", mappingReason: "The cached exposure index linked this issuer to a materially affected sector.", ...(text(row.tradingViewSymbol, 80) ? { tradingViewSymbol: text(row.tradingViewSymbol, 80) } : {}) }];
    });
  });
}

function discoverFeedUrl(html, base) {
  for (const tag of [...html.matchAll(/<link\b[^>]*>/gi)].map((match) => match[0])) {
    if (!/(?:application\/rss\+xml|application\/atom\+xml)/i.test(tag)) continue;
    const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1];
    const url = href ? safeHttpUrl(href, base) : null;
    if (url && safeDirectHttpsUrl(url)) return url;
  }
  for (const href of [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)].map((match) => match[1])) {
    if (!/(?:rss|atom|feed)(?:\.|\/|\?|$)/i.test(href)) continue;
    const url = safeHttpUrl(href, base);
    if (url && safeDirectHttpsUrl(url)) return url;
  }
  return null;
}

async function upsertDirectRegistry(bucket, key, nextEntry, now) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const loaded = await readJsonFromR2(bucket, key, { version: 1, updatedAt: new Date(0).toISOString(), discoveryCursor: 0, lastDiscoveryCycleAt: null, entries: [] });
    if (loaded.invalid) throw new Error("direct_feed_registry_invalid");
    const current = object(loaded.value);
    const entries = Array.isArray(current.entries) ? current.entries.map(object) : [];
    const byTicker = new Map(entries.map((entry) => [normalizeTicker(entry.ticker), entry]).filter(([ticker]) => ticker));
    byTicker.set(nextEntry.ticker, { ...byTicker.get(nextEntry.ticker), ...nextEntry });
    const payload = { version: 1, updatedAt: now.toISOString(), discoveryCursor: Math.max(0, Number(current.discoveryCursor) || 0) + 1, lastDiscoveryCycleAt: now.toISOString(), entries: [...byTicker.values()].sort((left, right) => String(left.ticker).localeCompare(String(right.ticker))) };
    const options = { httpMetadata: { contentType: "application/json" }, customMetadata: { owner: OWNER, purpose: "direct-feed-registry" } };
    options.onlyIf = loaded.etag ? { etagMatches: loaded.etag } : new Headers({ "if-none-match": "*" });
    const written = await bucket.put(key, JSON.stringify(payload), options);
    if (written) return;
  }
  throw new Error("direct_feed_registry_conflict");
}

async function discoverDirectFeed(context, registry) {
  const exposureRows = Array.isArray(object(context.exposure).entries) ? object(context.exposure).entries.map(object) : [];
  const entries = Array.isArray(object(registry).entries) ? object(registry).entries.map(object) : [];
  const existing = new Map(entries.map((entry) => [normalizeTicker(entry.ticker), entry]));
  const candidates = exposureRows.filter((row) => normalizeTicker(row.ticker) && normalizeCik(row.cik)).sort((left, right) => (finite(right.businessQuality) ?? 0) - (finite(left.businessQuality) ?? 0) || (finite(right.marketCap) ?? 0) - (finite(left.marketCap) ?? 0));
  const candidate = candidates.find((row) => {
    const prior = existing.get(normalizeTicker(row.ticker));
    if (!prior) return true;
    if (safeDirectHttpsUrl(prior.feedUrl)) return false;
    const last = Date.parse(String(prior.lastDiscoveryAt ?? ""));
    return !Number.isFinite(last) || context.now.getTime() - last >= 30 * DAY_MS;
  });
  if (!candidate) return { recordsRead: 0, events: [] };
  const ticker = normalizeTicker(candidate.ticker);
  const cik = normalizeCik(candidate.cik);
  const company = text(candidate.company, 300) || ticker;
  const submissionsUrl = `https://data.sec.gov/submissions/CIK${cik}.json`;
  let investorWebsite = null;
  let feedUrl = null;
  let error = null;
  try {
    const submissions = JSON.parse((await fetchBounded(submissionsUrl, { headers: { Accept: "application/json" } }, context.deadlineMs)).text);
    if (normalizeCik(submissions.cik) !== cik && !text(submissions.name, 300)) throw new Error("sec_submissions_contract_invalid");
    investorWebsite = safeDirectHttpsUrl(text(submissions.investorWebsite ?? submissions.website, 1_000));
    if (investorWebsite) {
      const page = await fetchDirectBounded(investorWebsite, { headers: { Accept: "text/html,application/xhtml+xml" } }, context.deadlineMs);
      feedUrl = discoverFeedUrl(page.text, page.finalUrl);
    }
    if (!feedUrl) error = "issuer_rss_feed_not_discovered";
  } catch (cause) {
    error = safeError(cause, "direct_feed_discovery_failed");
  }
  await upsertDirectRegistry(context.env.SENSOR_R2, context.directKey, {
    ticker,
    company,
    cik,
    investorWebsite,
    feedUrl,
    discoveredAt: existing.get(ticker)?.discoveredAt ?? context.now.toISOString(),
    lastDiscoveryAt: context.now.toISOString(),
    lastCheckedAt: existing.get(ticker)?.lastCheckedAt ?? null,
    lastSuccessAt: existing.get(ticker)?.lastSuccessAt ?? null,
    nextCheckAt: feedUrl ? null : new Date(context.now.getTime() + 30 * DAY_MS).toISOString(),
    error,
  }, context.now);
  return { recordsRead: 1, events: [] };
}

function buildSourceTasks(context, state, directRegistry) {
  const urgentForm = SEC_URGENT_FORMS[state.cursors.secUrgentFormIndex % SEC_URGENT_FORMS.length];
  const query = GOOGLE_QUERIES[state.cursors.newsQueryIndex % GOOGLE_QUERIES.length];
  const tasks = [
    { provider: "sec_broad", urls: [secUrl()], run: async () => { const value = await parseSecAtom((await fetchBounded(secUrl(), {}, context.deadlineMs)).text, { ...context, provider: "cloudflare_sec_broad", sourceUrl: secUrl(), form: null }); if (!value.recordsRead) throw new Error("sec_broad_feed_empty"); return value; } },
    { provider: "sec_urgent", urls: [secUrl(urgentForm)], run: async () => { const value = await parseSecAtom((await fetchBounded(secUrl(urgentForm), {}, context.deadlineMs)).text, { ...context, provider: `cloudflare_sec_${urgentForm.toLowerCase()}`, sourceUrl: secUrl(urgentForm), form: urgentForm }); if (!value.recordsRead) throw new Error("sec_urgent_feed_empty"); return value; } },
    { provider: "google_news", urls: [googleUrl(query)], run: async () => { const value = await parseRss((await fetchBounded(googleUrl(query), {}, context.deadlineMs)).text, { ...context, provider: "cloudflare_google_news", sourceUrl: googleUrl(query), official: false, kind: "news", maximumAgeMs: 2 * 60 * 60_000 }); if (!value.recordsRead) throw new Error("google_news_feed_empty"); return value; } },
    { provider: "trade_halts", urls: ["https://www.nyse.com/api/trade-halts/current"], run: async () => { const sourceUrl = "https://www.nyse.com/api/trade-halts/current"; return parseTradeHalts((await fetchBounded(sourceUrl, {}, context.deadlineMs)).text, { ...context, provider: "cloudflare_nyse_halts", sourceUrl }); } },
    { provider: "market_watch", urls: ["https://scanner.tradingview.com/america/scan"], run: async () => marketWatch(context) },
    { provider: "gdelt", urls: ["https://api.gdeltproject.org/api/v2/doc/doc"], run: async () => { const sourceUrl = "https://api.gdeltproject.org/api/v2/doc/doc?query=(earnings%20OR%20guidance%20OR%20merger%20OR%20acquisition%20OR%20recall%20OR%20bankruptcy)%20sourcecountry:US&mode=ArtList&maxrecords=100&format=json&sort=HybridRel"; return parseJsonRows(JSON.parse((await fetchBounded(sourceUrl, {}, context.deadlineMs)).text), { ...context, provider: "gdelt", sourceUrl, kind: "news" }); } },
    { provider: "federal_register", urls: ["https://www.federalregister.gov/api/v1/documents.json"], run: async () => { const sourceUrl = "https://www.federalregister.gov/api/v1/documents.json?per_page=100&order=newest"; return parseJsonRows(JSON.parse((await fetchBounded(sourceUrl, {}, context.deadlineMs)).text), { ...context, provider: "federal_register", sourceUrl, official: true, kind: "federal_register", maximumAgeMs: 7 * DAY_MS }); } },
    { provider: "openfda", urls: ["https://api.fda.gov/drug/enforcement.json"], run: async () => { const sourceUrl = "https://api.fda.gov/drug/enforcement.json?limit=100&sort=report_date:desc"; return parseJsonRows(JSON.parse((await fetchBounded(sourceUrl, {}, context.deadlineMs)).text), { ...context, provider: "openfda", sourceUrl, official: true, kind: "fda_recall", maximumAgeMs: 14 * DAY_MS }); } },
    { provider: "fred", urls: ["https://fred.stlouisfed.org/graph/fredgraph.csv"], run: async () => fredMacro(context) },
    { provider: "frankfurter", urls: ["https://api.frankfurter.app/latest?from=USD"], run: async () => frankfurterMacro(context) },
    { provider: "commerce", urls: ["https://api.commerce.gov/api/news"], run: async () => { const sourceUrl = "https://api.commerce.gov/api/news?size=100"; return parseJsonRows(JSON.parse((await fetchBounded(sourceUrl, {}, context.deadlineMs)).text), { ...context, provider: "commerce", sourceUrl, official: true, kind: "commerce_policy", maximumAgeMs: 7 * DAY_MS }); } },
  ];

  if (text(context.env.MARKETAUX_API_TOKEN, 500)) tasks.push({ provider: "marketaux", urls: ["https://api.marketaux.com/v1/news/all"], run: async () => { const sourceUrl = `https://api.marketaux.com/v1/news/all?countries=us&filter_entities=true&language=en&limit=100&api_token=${encodeURIComponent(context.env.MARKETAUX_API_TOKEN)}`; return parseJsonRows(JSON.parse((await fetchBounded(sourceUrl, {}, context.deadlineMs)).text), { ...context, provider: "marketaux", sourceUrl: "https://api.marketaux.com/v1/news/all", kind: "news" }); } });
  if (text(context.env.ALPHA_VANTAGE_API_KEY, 500)) {
    tasks.push({ provider: "alpha_news", urls: ["https://www.alphavantage.co/query"], run: async () => { const sourceUrl = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&topics=earnings,mergers_and_acquisitions,financial_markets&sort=LATEST&limit=100&apikey=${encodeURIComponent(context.env.ALPHA_VANTAGE_API_KEY)}`; return parseJsonRows(JSON.parse((await fetchBounded(sourceUrl, {}, context.deadlineMs)).text), { ...context, provider: "alpha_news", sourceUrl: "https://www.alphavantage.co/query", kind: "alpha_news" }); } });
    tasks.push({ provider: "alpha_earnings", urls: ["https://www.alphavantage.co/query"], run: async () => { const sourceUrl = `https://www.alphavantage.co/query?function=EARNINGS_CALENDAR&horizon=3month&apikey=${encodeURIComponent(context.env.ALPHA_VANTAGE_API_KEY)}`; const result = await fetchBounded(sourceUrl, {}, context.deadlineMs); const header = result.text.split(/\r?\n/, 1)[0]?.split(",").map((value) => value.trim()) ?? []; if (!header.includes("symbol") || !header.includes("reportDate")) throw new Error("alpha_earnings_feed_contract_invalid"); const rows = parseCsv(result.text).filter((row) => row.reportDate === context.now.toISOString().slice(0, 10)).slice(0, 300); return parseJsonRows(rows.map((row) => ({ ...row, id: `${row.symbol}|${row.reportDate}`, title: `${row.symbol} earnings expected ${row.reportDate}`, url: "https://www.alphavantage.co/", published_at: `${row.reportDate}T00:00:00.000Z`, ticker: row.symbol })), { ...context, provider: "alpha_earnings", sourceUrl: "https://www.alphavantage.co/query", kind: "scheduled_earnings", maximumAgeMs: 2 * DAY_MS }); } });
  }
  if (text(context.env.FMP_API_KEY, 500) && String(context.env.FMP_COMMERCIAL_USE_APPROVED).toLowerCase() === "true") tasks.push({ provider: "fmp_news", urls: ["https://financialmodelingprep.com/stable/news/stock"], run: async () => { const leaders = (Array.isArray(object(context.exposure).entries) ? object(context.exposure).entries : []).slice(0, 120); const symbols = leaders.slice((Math.floor(context.now.getTime() / 7_200_000) * 3) % Math.max(1, leaders.length), ((Math.floor(context.now.getTime() / 7_200_000) * 3) % Math.max(1, leaders.length)) + 3).map((row) => row.ticker).filter(Boolean); const sourceUrl = `https://financialmodelingprep.com/stable/news/stock?symbols=${encodeURIComponent(symbols.join(","))}&limit=20&apikey=${encodeURIComponent(context.env.FMP_API_KEY)}`; return parseJsonRows(JSON.parse((await fetchBounded(sourceUrl, { headers: { apikey: context.env.FMP_API_KEY } }, context.deadlineMs)).text), { ...context, provider: "fmp_news", sourceUrl: "https://financialmodelingprep.com/stable/news/stock", kind: "fmp_stock_news" }); } });

  const officialStart = state.cursors.officialFeedIndex % OFFICIAL_FEEDS.length;
  for (let offset = 0; offset < OFFICIAL_FEEDS.length; offset += 1) {
    const [name, sourceUrl] = OFFICIAL_FEEDS[(officialStart + offset) % OFFICIAL_FEEDS.length];
    tasks.push({ provider: "official", reservationKey: `official:${name}`, urls: [sourceUrl], sourceName: name, run: async () => parseRss((await fetchBounded(sourceUrl, {}, context.deadlineMs)).text, { ...context, provider: `cloudflare_${name}`, sourceUrl, official: true, kind: name, maximumAgeMs: 7 * DAY_MS }) });
  }

  const entries = Array.isArray(object(directRegistry).entries) ? object(directRegistry).entries.map(object) : [];
  tasks.push({ provider: "direct_discovery", networkCost: 2, urls: ["https://data.sec.gov/submissions/", "registered issuer investor website"], run: async () => discoverDirectFeed(context, directRegistry) });
  const exposureByTicker = new Map((Array.isArray(object(context.exposure).entries) ? object(context.exposure).entries : [])
    .map((row) => [normalizeTicker(object(row).ticker), object(row)])
    .filter(([ticker]) => ticker));
  const dueFeeds = entries.filter((entry) => safeDirectHttpsUrl(entry.feedUrl)).filter((entry) => {
    const next = Date.parse(String(entry.nextCheckAt ?? ""));
    return !Number.isFinite(next) || next <= context.now.getTime();
  });
  const rankedFeeds = dueFeeds.sort((left, right) => {
    const leftExposure = exposureByTicker.get(normalizeTicker(left.ticker)) ?? {};
    const rightExposure = exposureByTicker.get(normalizeTicker(right.ticker)) ?? {};
    return (finite(rightExposure.businessQuality) ?? 0) - (finite(leftExposure.businessQuality) ?? 0)
      || (finite(rightExposure.marketCap) ?? 0) - (finite(leftExposure.marketCap) ?? 0)
      || String(left.ticker).localeCompare(String(right.ticker));
  });
  const priorityFeeds = rankedFeeds.slice(0, MAX_PRIORITY_DIRECT_ISSUERS);
  const ordinaryFeeds = rankedFeeds.slice(MAX_PRIORITY_DIRECT_ISSUERS);
  const ordinaryStart = ordinaryFeeds.length ? state.cursors.directIssuerFeedIndex % ordinaryFeeds.length : 0;
  const rotatingFeeds = ordinaryFeeds.length
    ? [...ordinaryFeeds.slice(ordinaryStart), ...ordinaryFeeds.slice(0, ordinaryStart)].slice(0, Math.max(0, MAX_DIRECT_ISSUER_TASKS - priorityFeeds.length))
    : [];
  for (const entry of [...priorityFeeds, ...rotatingFeeds]) {
    const sourceUrl = safeDirectHttpsUrl(entry.feedUrl);
    const priority = priorityFeeds.includes(entry);
    tasks.push({ provider: "direct_issuer", reservationKey: `direct_issuer:${normalizeTicker(entry.ticker) ?? "unknown"}`, minimumIntervalMs: priority ? 14 * 60_000 : 59 * 60_000, urls: [sourceUrl], sourceName: normalizeTicker(entry.ticker), run: async () => parseRss((await fetchDirectBounded(sourceUrl, {}, context.deadlineMs)).text, { ...context, provider: `issuer_ir_${String(entry.ticker).toLowerCase()}`, sourceUrl, official: true, ticker: normalizeTicker(entry.ticker), company: text(entry.company, 300), cik: normalizeCik(entry.cik), kind: "issuer_announcement", maximumAgeMs: 48 * 60 * 60_000, reason: "A new announcement was detected directly from a registered issuer investor-relations feed." }) });
  }
  return tasks;
}

async function executeTasks(tasks, context, storage) {
  const results = [];
  let cursor = 0;
  let calls = 0;
  let directIssuerCalls = 0;
  const sorted = [...tasks].sort((left, right) => (PROVIDER_POLICIES[right.provider]?.priority ?? 0) - (PROVIDER_POLICIES[left.provider]?.priority ?? 0));
  async function worker() {
    while (cursor < sorted.length && calls < MAX_NETWORK_CALLS && Date.now() + 1_000 < context.deadlineMs) {
      const task = sorted[cursor++];
      const reservationProvider = task.reservationKey ?? task.provider;
      const policyProvider = task.provider;
      const policy = PROVIDER_POLICIES[policyProvider];
      if (!policy) continue;
      const networkCost = int(task.networkCost, 1, 1, 3);
      // Claim the in-run network slot before persisting the provider spend.
      // This avoids consuming a durable quota reservation for a request that
      // the cycle cap would never allow to leave the Worker.
      if (calls + networkCost > MAX_NETWORK_CALLS) {
        results.push({ provider: task.sourceName ? `${task.provider}:${task.sourceName}` : task.provider, attempted: false, status: "not_due", recordsRead: 0, events: [], error: null, urls: task.urls, skipReason: "cycle_network_cap" });
        continue;
      }
      if (task.provider === "direct_issuer" && directIssuerCalls >= MAX_DIRECT_ISSUER_CALLS) {
        results.push({ provider: task.sourceName ? `${task.provider}:${task.sourceName}` : task.provider, attempted: false, status: "not_due", recordsRead: 0, events: [], error: null, urls: task.urls, skipReason: "cycle_direct_issuer_cap" });
        continue;
      }
      calls += networkCost;
      if (task.provider === "direct_issuer") directIssuerCalls += 1;
      const budget = await reserveProvider(storage, policyProvider, Date.now(), reservationProvider, task.minimumIntervalMs ?? null);
      if (!budget.allowed) {
        calls -= networkCost;
        if (task.provider === "direct_issuer") directIssuerCalls -= 1;
        results.push({ provider: task.sourceName ? `${task.provider}:${task.sourceName}` : task.provider, attempted: false, status: "not_due", recordsRead: 0, events: [], error: null, urls: task.urls, skipReason: budget.reason });
        continue;
      }
      try {
        const value = await task.run();
        results.push({ provider: task.sourceName ? `${task.provider}:${task.sourceName}` : task.provider, attempted: true, status: value.status ?? "connected", recordsRead: value.recordsRead ?? 0, events: value.events ?? [], error: value.error ?? null, urls: task.urls });
      } catch (error) {
        const failure = sourceFailure(error);
        results.push({ provider: task.sourceName ? `${task.provider}:${task.sourceName}` : task.provider, attempted: true, ...failure, recordsRead: 0, events: [], urls: task.urls });
      }
    }
  }
  await Promise.all(Array.from({ length: MAX_CONCURRENCY }, () => worker()));
  return { results, calls };
}

async function persistStateWithMerge(bucket, key, candidateEvents, runMeta, now, sourceResults) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const loaded = await readJsonFromR2(bucket, key, baseState());
    if (loaded.invalid) throw new Error("cloudflare_sensor_state_invalid");
    const state = normalizeState(loaded.value);
    const existingPending = state.pending.map((event) => refreshQueuedMapping(event, runMeta.resolver));
    const known = new Set([...state.seen, ...existingPending.map((event) => event.id)]);
    const deduped = [...candidateEvents.reduce((map, event) => { const current = map.get(event.id); if (!current || event.priority > current.priority) map.set(event.id, event); return map; }, new Map()).values()];
    const fresh = deduped.filter((event) => !known.has(event.id)).sort((left, right) => right.priority - left.priority || right.observedAt.localeCompare(left.observedAt)).slice(0, MAX_FRESH);
    const pending = partitionPendingEvents([...existingPending, ...fresh], now);
    const retained = new Set(pending.map((event) => event.id));
    for (const event of fresh) if (retained.has(event.id)) known.add(event.id);
    for (const result of sourceResults) state.sourceHealth[`cf_${result.provider}`] = sourceHealth(`cf_${result.provider}`, result, now, state.sourceHealth[`cf_${result.provider}`]);
    const next = {
      ...state,
      updatedAt: now.toISOString(),
      seen: [...known].slice(-MAX_SEEN),
      pending,
      lastMarketWatchAt: sourceResults.some((item) => item.provider === "market_watch" && item.status === "connected") ? now.toISOString() : state.lastMarketWatchAt,
      cursors: {
        secUrgentFormIndex: (state.cursors.secUrgentFormIndex + 1) % SEC_URGENT_FORMS.length,
        newsQueryIndex: (state.cursors.newsQueryIndex + 1) % GOOGLE_QUERIES.length,
        officialFeedIndex: (state.cursors.officialFeedIndex + Math.max(1, sourceResults.filter((item) => item.provider.startsWith("official:") && item.attempted).length)) % OFFICIAL_FEEDS.length,
        directIssuerFeedIndex: state.cursors.directIssuerFeedIndex
          + Math.max(1, sourceResults.filter((item) => item.provider.startsWith("direct_issuer:")).length),
      },
      sensorReadiness: runMeta.sensorReadiness,
      cloudflareSensor: { version: VERSION, owner: OWNER, lastScanId: runMeta.scanId, lastRunKey: runMeta.runKey, checkedAt: now.toISOString() },
    };
    const options = { httpMetadata: { contentType: "application/json" }, customMetadata: { owner: OWNER, scanId: runMeta.scanId } };
    if (loaded.etag) options.onlyIf = { etagMatches: loaded.etag };
    else options.onlyIf = new Headers({ "if-none-match": "*" });
    const written = await bucket.put(key, JSON.stringify(next), options);
    if (written) return { state: next, etag: written.etag, fresh };
  }
  throw new Error("cloudflare_sensor_state_conflict");
}

function canonicalRunKey(prefix, checkedAt, scanId) {
  return `${prefix.replace(/\/$/, "")}/${checkedAt.slice(0, 10)}/${checkedAt.replace(/[^0-9]/g, "").slice(0, 17)}-${scanId}.json`;
}

async function persistImmutableRun(bucket, key, payload) {
  const written = await bucket.put(key, JSON.stringify(payload), {
    onlyIf: new Headers({ "if-none-match": "*" }),
    httpMetadata: { contentType: "application/json" },
    customMetadata: { owner: OWNER, scanId: payload.scanId },
  });
  if (!written) throw new Error("cloudflare_sensor_run_conflict");
  return written;
}

function hmacInput(timestamp, nonce, bodyHash) {
  return `v1\n${timestamp}\n${nonce}\nPOST\n${HANDOFF_PATH}\n${bodyHash}`;
}

async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

export async function buildHandoffRequest(env, payload, now = new Date()) {
  const endpoint = new URL(text(env.RAILWAY_HANDOFF_URL, 1_000));
  if (endpoint.protocol !== "https:" || endpoint.pathname !== HANDOFF_PATH || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error("railway_handoff_url_invalid");
  const allowedHosts = text(env.RAILWAY_HANDOFF_HOST_ALLOWLIST, 2_000).split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (!allowedHosts.length || !allowedHosts.includes(endpoint.hostname.toLowerCase())) throw new Error("railway_handoff_host_not_allowed");
  const sensorToken = text(env.RAILWAY_SENSOR_TOKEN, 1_000);
  const secret = text(env.RAILWAY_HANDOFF_SECRET, 1_000);
  if (sensorToken.length < 32 || secret.length < 32) throw new Error("railway_handoff_secrets_missing_or_weak");
  const body = JSON.stringify(payload);
  const bodyHash = await sha256Hex(body);
  const timestamp = String(Math.floor(now.getTime() / 1_000));
  const nonce = payload.scanId;
  const signature = await hmacHex(secret, hmacInput(timestamp, nonce, bodyHash));
  return {
    url: endpoint.toString(),
    init: {
      method: "POST",
      redirect: "error",
      headers: {
        "content-type": "application/json",
        "x-swing-up-pr262-sensor-token": sensorToken,
        "x-swing-up-sensor-timestamp": timestamp,
        "x-swing-up-sensor-nonce": nonce,
        "x-swing-up-sensor-signature": `v1=${signature}`,
      },
      body,
    },
  };
}

async function handoffToRailway(env, payload, deadlineMs) {
  let lastError = "railway_handoff_failed";
  for (let attempt = 1; attempt <= MAX_HANDOFF_ATTEMPTS && Date.now() + 750 < deadlineMs; attempt += 1) {
    try {
      const request = await buildHandoffRequest(env, payload);
      const response = await fetchBounded(request.url, request.init, deadlineMs, 200_000);
      const body = (() => { try { return JSON.parse(response.text); } catch { return {}; } })();
      if (body.ok !== true || body.accepted !== true || body.scanId !== payload.scanId) {
        throw new Error("railway_handoff_response_invalid");
      }
      return { ok: true, attempt, status: response.status, response: object(body) };
    } catch (error) {
      lastError = safeError(error, "railway_handoff_failed");
      if (/http_(?:400|401|403|404)/.test(lastError)) break;
      if (attempt < MAX_HANDOFF_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, Math.min(1_000, 200 * (2 ** attempt))));
    }
  }
  return { ok: false, attempt: MAX_HANDOFF_ATTEMPTS, status: null, error: lastError };
}

async function runSensor(env, storage, now = new Date()) {
  if (env.SENSOR_OWNER !== OWNER) throw new Error("cloudflare_sensor_owner_not_enabled");
  const mode = deploymentMode(env);
  const analysisHandoffEnabled = String(env.ANALYSIS_HANDOFF_ENABLED ?? "").trim().toLowerCase() === "true";
  if (mode === "shadow" && analysisHandoffEnabled) throw new Error("cloudflare_shadow_analysis_handoff_forbidden");
  const wallMs = int(env.SENSOR_WALL_MS, DEFAULT_WALL_MS, MIN_WALL_MS, MAX_WALL_MS);
  const startedAtMs = Date.now();
  const deadlineMs = startedAtMs + wallMs;
  const sourceDeadlineMs = deadlineMs - SOURCE_COMPLETION_RESERVE_MS;
  const scanId = crypto.randomUUID();
  const stateKey = sensorKey(env, env.SENSOR_STATE_KEY, DEFAULT_STATE_KEY, "state");
  const runPrefix = sensorKey(env, env.SENSOR_RUN_PREFIX, DEFAULT_RUN_PREFIX, "run_prefix");
  const runKey = canonicalRunKey(runPrefix, now.toISOString(), scanId);
  const directKey = sensorKey(env, env.DIRECT_FEEDS_KEY, DEFAULT_DIRECT_FEEDS_KEY, "direct_feeds");
  const referenceReader = referenceR2Reader(env);
  const [stateLoaded, universeLoaded, exposureLoaded, directLoaded] = await Promise.all([
    readJsonFromR2(env.SENSOR_R2, stateKey, baseState()),
    readJsonFromR2(referenceReader, sensorReferenceKey(env, env.EQUITY_UNIVERSE_KEY, DEFAULT_UNIVERSE_KEY, "universe"), { entries: [] }),
    readJsonFromR2(referenceReader, sensorReferenceKey(env, env.EXPOSURE_INDEX_KEY, DEFAULT_EXPOSURE_KEY, "exposure"), { entries: [] }),
    readJsonFromR2(env.SENSOR_R2, directKey, { entries: [] }),
  ]);
  if (stateLoaded.invalid) throw new Error("cloudflare_sensor_state_invalid");
  if (directLoaded.invalid) throw new Error("direct_feed_registry_invalid");
  const state = normalizeState(stateLoaded.value);
  const universeEntries = Array.isArray(object(universeLoaded.value).entries) ? object(universeLoaded.value).entries.length : 0;
  const exposureEntries = Array.isArray(object(exposureLoaded.value).entries) ? object(exposureLoaded.value).entries.length : 0;
  const universeRefreshedAt = Date.parse(String(object(universeLoaded.value).refreshedAt ?? ""));
  const universeContractValid = !universeLoaded.invalid && validUniverseReference(universeLoaded.value, now);
  const universeComplete = universeContractValid;
  const exposureBuiltAt = Date.parse(String(object(exposureLoaded.value).builtAt ?? ""));
  const exposureContractValid = !exposureLoaded.invalid && validExposureReference(exposureLoaded.value, now);
  const exposureComplete = exposureContractValid;
  const usableUniverse = universeComplete ? universeLoaded.value : { entries: [] };
  const usableExposure = exposureComplete ? exposureLoaded.value : { entries: [] };
  const resolver = createResolver(usableUniverse, usableExposure);
  const context = { env, now, deadlineMs: sourceDeadlineMs, resolver, exposure: usableExposure, storage, directKey };
  const tasks = buildSourceTasks(context, state, directLoaded.value);
  const executed = await executeTasks(tasks, context, storage);
  const directEvents = executed.results.flatMap((item) => item.events);
  const events = [...directEvents, ...fanOutEvents(directEvents, usableExposure)];
  const runAudit = {
    version: VERSION,
    kind: "pr262_cloudflare_cheap_sensor_run",
    owner: OWNER,
    scanId,
    checkedAt: now.toISOString(),
    stateKey,
    runKey,
    sourceCalls: executed.calls,
    sourceResults: executed.results.map((item) => ({ provider: item.provider, attempted: item.attempted, status: item.status, recordsRead: item.recordsRead, events: item.events.length, error: item.error, urls: item.urls })),
    retainedCandidates: events.slice(0, MAX_FRESH),
    referenceData: {
      universeReady: universeComplete,
      universeEntries,
      universeRefreshedAt: Number.isFinite(universeRefreshedAt) ? new Date(universeRefreshedAt).toISOString() : null,
      exposureReady: exposureComplete,
      exposureEntries,
      exposureBuiltAt: Number.isFinite(exposureBuiltAt) ? new Date(exposureBuiltAt).toISOString() : null,
      universeObjectValid: !universeLoaded.invalid,
      exposureObjectValid: !exposureLoaded.invalid,
      universeContractValid,
      exposureContractValid,
    },
    deploymentMode: mode,
    safety: { aiCalls: 0, articleReads: 0, deepAnalysis: false, committee: false, notifications: false, trades: false, databaseWrites: false, analysisHandoffEnabled },
  };
  const runJson = JSON.stringify(runAudit);
  const runDigest = await sha256Hex(runJson);
  await persistImmutableRun(env.SENSOR_R2, runKey, runAudit);
  const sensorReadiness = {
    version: 1,
    checkedAt: now.toISOString(),
    universeReady: universeComplete,
    universeEntries,
    exposureReady: exposureComplete,
    exposureEntries,
  };
  const persisted = await persistStateWithMerge(env.SENSOR_R2, stateKey, events, { scanId, runKey, sensorReadiness, resolver }, now, executed.results);
  const analysisReadyEvents = countDueAnalysisEvents(persisted.state.pending, now);
  const handoffPayload = {
    version: 1,
    kind: "pr262_cloudflare_sensor_handoff",
    owner: OWNER,
    scanId,
    checkedAt: now.toISOString(),
    stateKey,
    stateEtag: persisted.etag,
    runKey,
    runDigest,
    newEvents: persisted.fresh.length,
    pendingEvents: persisted.state.pending.length,
  };
  const handoffRequired = shouldInvokeAnalysisHandoff(analysisHandoffEnabled, analysisReadyEvents);
  const handoff = handoffRequired
    ? await handoffToRailway(env, handoffPayload, deadlineMs)
    : {
        ok: true,
        enabled: analysisHandoffEnabled,
        invoked: false,
        attempt: 0,
        status: null,
        reason: analysisHandoffEnabled ? "quiet_scan_no_due_mapped_events" : "shadow_scan_only",
      };
  const report = {
    ok: handoff.ok,
    mode: mode === "production" ? "pr262_cloudflare_cheap_sensor" : "pr262_cloudflare_cheap_sensor_shadow",
    deploymentMode: mode,
    owner: OWNER,
    scanId,
    checkedAt: now.toISOString(),
    durationMs: Date.now() - startedAtMs,
    stateKey,
    runKey,
    sourcesAttempted: executed.results.filter((item) => item.attempted).length,
    sourceCalls: executed.calls,
    newEvents: persisted.fresh.length,
    pendingEvents: persisted.state.pending.length,
    analysisReadyEvents,
    referenceData: runAudit.referenceData,
    analysisHandoffRequired: handoffRequired,
    handoff,
    safety: runAudit.safety,
  };
  await storage.put("lastReport", report);
  if (analysisHandoffEnabled && !handoff.ok) throw new Error(`railway_handoff_failed:${handoff.error ?? "unknown"}`);
  return report;
}

export class SensorCoordinatorCore {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/status") {
      const report = await this.state.storage.get("lastReport");
      return Response.json({ ok: true, owner: OWNER, lastReport: report ?? null }, { headers: { "cache-control": "no-store" } });
    }
    if (request.method !== "POST" || url.pathname !== "/run") return new Response("Not found", { status: 404 });
    const leaseId = crypto.randomUUID();
    const leaseResult = await this.state.storage.transaction(async (transaction) => {
      const nowMs = Date.now();
      const lease = object(await transaction.get("lease"));
      const leaseExpires = Date.parse(String(lease.expiresAt ?? ""));
      if (Number.isFinite(leaseExpires) && leaseExpires > nowMs) return { acquired: false, retryAfterMs: leaseExpires - nowMs };
      await transaction.put("lease", { leaseId, acquiredAt: new Date(nowMs).toISOString(), expiresAt: new Date(nowMs + MAX_WALL_MS + 10_000).toISOString() });
      return { acquired: true, retryAfterMs: 0 };
    });
    if (!leaseResult.acquired) return Response.json({ ok: false, busy: true, owner: OWNER, retryAfterMs: leaseResult.retryAfterMs }, { status: 409 });
    const releaseLease = async () => {
      const current = object(await this.state.storage.get("lease"));
      if (current.leaseId === leaseId) await this.state.storage.delete("lease");
    };
    const work = runSensor(this.env, this.state.storage).then(
      (result) => ({ completed: true, ok: true, result }),
      async (error) => {
        const report = { ok: false, mode: "pr262_cloudflare_cheap_sensor", owner: OWNER, checkedAt: new Date().toISOString(), error: safeError(error) };
        await this.state.storage.put("lastReport", report);
        return { completed: true, ok: false, result: report };
      },
    ).finally(releaseLease);
    // If an unexpected native-binding stall outlives the cooperative deadline,
    // return failure but keep the lease until the underlying work settles.
    // This prevents a timeout from accidentally creating a second owner.
    const wallMs = int(this.env.SENSOR_WALL_MS, DEFAULT_WALL_MS, MIN_WALL_MS, MAX_WALL_MS);
    let timeoutId;
    const outcome = await Promise.race([
      work,
      new Promise((resolve) => { timeoutId = setTimeout(() => resolve({ completed: false, ok: false, result: { ok: false, mode: "pr262_cloudflare_cheap_sensor", owner: OWNER, checkedAt: new Date().toISOString(), error: "sensor_wall_deadline" } }), wallMs + 1_000); }),
    ]);
    if (timeoutId) clearTimeout(timeoutId);
    if (!outcome.completed) {
      void work.catch(() => null);
      return Response.json(outcome.result, { status: 503, headers: { "cache-control": "no-store" } });
    }
    return Response.json(outcome.result, { status: outcome.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
  }
}

function coordinator(env) {
  const mode = deploymentMode(env);
  const id = env.SENSOR_COORDINATOR.idFromName(`pr262-${mode}-cheap-sensor`);
  return env.SENSOR_COORDINATOR.get(id);
}

const pr262CloudflareSensorWorker = {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(coordinator(env).fetch("https://sensor.internal/run", { method: "POST" }).then(async (response) => {
      if (!response.ok && response.status !== 409) throw new Error(`cloudflare_sensor_coordinator_${response.status}:${(await response.text()).slice(0, 300)}`);
    }));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      const mode = (() => { try { return deploymentMode(env); } catch { return "invalid"; } })();
      return Response.json({
        ok: mode !== "invalid",
        service: "pr262-cloudflare-cheap-sensor",
        owner: env.SENSOR_OWNER,
        deploymentMode: mode,
        scheduled: true,
        analysisHandoffEnabled: String(env.ANALYSIS_HANDOFF_ENABLED ?? "").trim().toLowerCase() === "true",
        deepAnalysis: false,
      }, { status: mode === "invalid" ? 503 : 200, headers: { "cache-control": "no-store" } });
    }
    if (request.method === "GET" && url.pathname === "/status") {
      const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
      if (!env.STATUS_READ_TOKEN || supplied !== env.STATUS_READ_TOKEN) return new Response("Not found", { status: 404 });
      return coordinator(env).fetch("https://sensor.internal/status");
    }
    return new Response("Not found", { status: 404 });
  },
};

export default pr262CloudflareSensorWorker;

export const PR262_CLOUDFLARE_SENSOR_CONTRACT = Object.freeze({
  owner: OWNER,
  handoffPath: HANDOFF_PATH,
  stateKey: DEFAULT_STATE_KEY,
  runPrefix: DEFAULT_RUN_PREFIX,
  maxNetworkCalls: MAX_NETWORK_CALLS,
  maxConcurrentCalls: MAX_CONCURRENCY,
  maximumDirectIssuerCalls: MAX_DIRECT_ISSUER_CALLS,
  maximumWallMs: MAX_WALL_MS,
  maximumFreshEvents: MAX_FRESH,
  quietScansWakeRailway: false,
  aiCalls: 0,
  deepAnalysis: false,
  productionPrefix: PRODUCTION_PREFIX,
  shadowPrefix: SHADOW_PREFIX,
  shadowReferenceBindingUsesGetOnlyAdapter: true,
  directIssuerUrlsRevalidatedAcrossRedirects: true,
  completeReferenceContractsRequired: true,
});
