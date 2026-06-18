import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";

export const GDELT_SOURCE = "GDELT";

const GDELT_DOC_API_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
export const DEFAULT_GDELT_MAXRECORDS = 250;
export const GDELT_MAXRECORDS_HARD_CAP = 250;
export const GDELT_FALLBACK_MAXRECORDS = 100;
export const GDELT_SECOND_FALLBACK_MAXRECORDS = 50;
export const GDELT_COOLDOWN_MS = 60 * 60_000;
export const DEFAULT_GDELT_TIMESPAN = "15min";
const REQUEST_TIMEOUT_MS = 12_000;
const RATE_LIMIT_MESSAGE =
  "GDELT rate-limited this server. Cooling down before the next pull.";

export const DEFAULT_GDELT_FIREHOSE_QUERY = `(
"earnings guidance" OR
"acquisition" OR
"merger" OR
"bankruptcy" OR
"SEC investigation" OR
"FDA approval" OR
"clinical trial" OR
"rate decision" OR
"inflation" OR
"Federal Reserve" OR
"CPI" OR
"tariff" OR
"semiconductor" OR
"AI chip"
)`;

const WATCHLIST: Record<string, string[]> = {
  AAPL: ["Apple"],
  NVDA: ["Nvidia", "NVIDIA"],
  TSLA: ["Tesla"],
  MSFT: ["Microsoft"],
  AMD: ["Advanced Micro Devices", "AMD"],
  META: ["Meta", "Facebook"],
  PLTR: ["Palantir"],
  COIN: ["Coinbase"],
  LLY: ["Eli Lilly"],
  SMCI: ["Super Micro", "Supermicro"],
  AMZN: ["Amazon"],
  GOOGL: ["Alphabet", "Google"],
  NFLX: ["Netflix"],
  JPM: ["JPMorgan", "JP Morgan"],
  BAC: ["Bank of America"],
  XOM: ["Exxon"],
  CVX: ["Chevron"],
  PFE: ["Pfizer"],
  MRNA: ["Moderna"],
  SHOP: ["Shopify"],
  AVGO: ["Broadcom"],
  ORCL: ["Oracle"],
  CRM: ["Salesforce"],
  NKE: ["Nike"],
  DIS: ["Disney"],
  UBER: ["Uber"],
  RIVN: ["Rivian"],
  SOFI: ["SoFi"],
};

const MARKET_THEMES = [
  "Federal Reserve",
  "inflation",
  "CPI",
  "jobs",
  "unemployment",
  "interest rates",
  "recession",
  "tariffs",
  "oil",
  "dollar",
  "crypto",
  "AI chips",
  "semiconductors",
  "healthcare",
  "banks",
  "bonds",
  "yields",
];
const MARKET_MOVING_KEYWORDS = [
  ...MARKET_THEMES,
  "earnings guidance",
  "raises guidance",
  "cuts guidance",
  "acquisition",
  "merger",
  "takeover",
  "partnership",
  "investment",
  "lawsuit",
  "bankruptcy",
  "FDA approval",
  "clinical trial",
  "rate decision",
  "supply chain",
];
const STRONG_CATALYSTS = [
  "acquisition",
  "merger",
  "bankruptcy",
  "FDA approval",
  "clinical trial result",
  "SEC investigation",
  "lawsuit",
  "earnings guidance",
  "raises guidance",
  "cuts guidance",
  "rate decision",
  "CPI shock",
];
const GENERIC_PHRASES = [
  "stocks mixed",
  "market update",
  "stock market today",
  "what to know",
  "roundup",
  "briefing",
];

type GdeltArticle = {
  url?: string;
  url_mobile?: string;
  title?: string;
  seendate?: string;
  domain?: string;
  language?: string;
  sourcecountry?: string;
  source?: string;
  snippet?: string;
  description?: string;
  socialimage?: string;
};
type GdeltDocResponse = { articles?: GdeltArticle[] };
export type GdeltRunMode = "firehose" | "single_query";
export type GdeltRunOptions = { q?: string; limit?: number; dryRun?: boolean };
export type GdeltRunResult = {
  ok: boolean;
  source: typeof GDELT_SOURCE;
  mode: GdeltRunMode;
  skipped: boolean;
  skipReason: string | null;
  maxrecordsTarget: number;
  maxrecordsRequested: number;
  maxrecordsUsed: number | null;
  timespan: string;
  cooldownActive: boolean;
  cooldownUntil: string | null;
  articlesChecked: number;
  articlesRejectedByRules: number;
  companyMatches: number;
  themeMatches: number;
  signalsCreated: number;
  duplicatesSkipped: number;
  futureAiCandidates: number;
  rateLimited: boolean;
  fallbackUsed: boolean;
  responseTimeMs: number;
  errors: string[];
};

type ScoredArticle = {
  article: GdeltArticle;
  title: string;
  sourceUrl: string | null;
  receivedAt: Date;
  detectedTickers: string[];
  detectedCompanyNames: string[];
  detectedThemes: string[];
  score: number;
  includeReason?: string;
  rejectReason?: string;
  duplicateLooking: boolean;
  futureAiCandidate: boolean;
};

function capLimit(limit?: number) {
  return Math.min(
    Math.max(limit ?? DEFAULT_GDELT_MAXRECORDS, 1),
    GDELT_MAXRECORDS_HARD_CAP,
  );
}
function safeError(error: unknown) {
  return error instanceof Error
    ? error.message.split("\n")[0]?.slice(0, 180) || "GDELT request failed"
    : "GDELT request failed";
}
function isRateLimitErrorMessage(message: string) {
  const lower = message.toLowerCase();
  return (
    message === RATE_LIMIT_MESSAGE ||
    lower.includes("429") ||
    lower.includes("rate limit") ||
    lower.includes("fetch failed")
  );
}
function buildGdeltNotes(
  message: string,
  cooldownUntil?: Date | null,
  currentTarget = DEFAULT_GDELT_MAXRECORDS,
) {
  const parts = [message, `current_target=${currentTarget}`];
  if (cooldownUntil)
    parts.push(`cooldown_until=${cooldownUntil.toISOString()}`);
  return parts.join(" ");
}
function parseCooldownUntil(
  notes?: string | null,
  errorMessage?: string | null,
) {
  const text = `${notes ?? ""} ${errorMessage ?? ""}`;
  const match = text.match(/cooldown_until=([^\s]+)/);
  if (!match) return null;
  const date = new Date(match[1]);
  return Number.isNaN(date.getTime()) ? null : date;
}
function activeCooldown(
  row: { notes: string | null; errorMessage: string | null } | null,
  now = new Date(),
) {
  const cooldownUntil = parseCooldownUntil(row?.notes, row?.errorMessage);
  return cooldownUntil && cooldownUntil.getTime() > now.getTime()
    ? cooldownUntil
    : null;
}
function parseGdeltDate(value?: string) {
  if (!value) return new Date();
  const compact = value.match(
    /^(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?(\d{2})?Z?$/,
  );
  if (compact) {
    const [, y, m, d, h = "00", min = "00", s = "00"] = compact;
    const date = new Date(`${y}-${m}-${d}T${h}:${min}:${s}Z`);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}
function textContains(text: string, phrase: string) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
}
function articleText(article: GdeltArticle) {
  return [
    article.title,
    article.snippet,
    article.description,
    article.source,
    article.domain,
    article.url,
    article.url_mobile,
  ]
    .filter(Boolean)
    .join(" ");
}
function dedupeKey(article: GdeltArticle) {
  return `${article.url || article.url_mobile || ""}|${(article.title || "").trim().toLowerCase()}|${article.seendate || ""}`;
}
function importance(score: number): "high" | "medium" | "low" {
  if (score >= 75) return "high";
  if (score >= 45) return "medium";
  return "low";
}

async function fetchGdeltArticles(
  query: string,
  maxrecords: number,
  signal: AbortSignal,
) {
  const url = new URL(GDELT_DOC_API_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("mode", "artlist");
  url.searchParams.set("format", "json");
  url.searchParams.set("sort", "datedesc");
  url.searchParams.set("timespan", DEFAULT_GDELT_TIMESPAN);
  url.searchParams.set("maxrecords", String(capLimit(maxrecords)));
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal,
  });
  if (response.status === 429) throw new Error(RATE_LIMIT_MESSAGE);
  if (!response.ok)
    throw new Error(`GDELT request failed with status ${response.status}`);
  const data = (await response.json()) as GdeltDocResponse;
  return data.articles ?? [];
}

async function fetchWithTimeout(query: string, maxrecords: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetchGdeltArticles(query, maxrecords, controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

function scoreArticles(articles: GdeltArticle[]) {
  const seen = new Set<string>();
  const scored = articles.map((article) => {
    const title = article.title?.trim().slice(0, 240) || "";
    const text = articleText(article);
    const sourceUrl = article.url ?? article.url_mobile ?? null;
    const receivedAt = parseGdeltDate(article.seendate);
    const companyMatches = Object.entries(WATCHLIST).flatMap(
      ([ticker, names]) =>
        [ticker, ...names].some((name) => textContains(text, name))
          ? [
              {
                ticker,
                name: names.find((n) => textContains(text, n)) ?? ticker,
              },
            ]
          : [],
    );
    const themes = MARKET_THEMES.filter((theme) => textContains(text, theme));
    const moving = MARKET_MOVING_KEYWORDS.some((k) => textContains(text, k));
    const catalyst = STRONG_CATALYSTS.some((k) => textContains(text, k));
    const generic = GENERIC_PHRASES.some((k) => textContains(text, k));
    const key = dedupeKey(article);
    const duplicateLooking = seen.has(key);
    seen.add(key);
    let score = 0;
    if (companyMatches.length) score += 35;
    if (moving) score += 25;
    if (catalyst) score += 20;
    if (Date.now() - receivedAt.getTime() <= 30 * 60_000) score += 10;
    if (sourceUrl) score += 10;
    if (companyMatches.length > 1 || themes.length > 1) score += 10;
    if (duplicateLooking) score -= 40;
    if (generic || (!moving && !catalyst)) score -= 30;
    if (!sourceUrl || title.length < 18) score -= 20;
    if (!companyMatches.length && !themes.length) score -= 20;
    score = Math.max(0, Math.min(100, score));
    const includeReason =
      score > 0 && (companyMatches.length || themes.length || catalyst)
        ? `Captured by local rules: ${companyMatches.map((m) => m.ticker).join(", ") || themes.join(", ")}; rule score ${score}.`
        : undefined;
    const rejectReason = includeReason
      ? undefined
      : "Rejected by local rules: no watched company, market theme, or strong event.";
    const scoredArticle: ScoredArticle = {
      article,
      title,
      sourceUrl,
      receivedAt,
      detectedTickers: companyMatches.map((m) => m.ticker),
      detectedCompanyNames: companyMatches.map((m) => m.name),
      detectedThemes: themes,
      score,
      includeReason,
      rejectReason,
      duplicateLooking,
      futureAiCandidate: false,
    };
    return scoredArticle;
  });
  const included = scored
    .filter((item) => item.includeReason && item.score > 0)
    .sort((a, b) => b.score - a.score);
  const topCount = Math.min(included.length, Math.ceil(articles.length * 0.05));
  included.slice(0, topCount).forEach((item) => {
    item.futureAiCandidate = true;
  });
  return scored;
}

async function rawSignalExists(item: ScoredArticle) {
  const existing = await prisma.rawSignal.findFirst({
    where: {
      source: GDELT_SOURCE,
      OR: [
        ...(item.sourceUrl ? [{ sourceUrl: item.sourceUrl }] : []),
        { title: item.title, receivedAt: item.receivedAt },
        { title: item.title },
      ],
    },
    select: { id: true },
  });
  return Boolean(existing);
}
async function createRawSignal(
  item: ScoredArticle,
  query: string,
  maxrecordsRequested: number,
  maxrecordsUsed: number,
  mode: GdeltRunMode,
  dryRun: boolean,
) {
  if (await rawSignalExists(item)) return "duplicate" as const;
  if (dryRun) return "dry_run" as const;
  await prisma.rawSignal.create({
    data: {
      source: GDELT_SOURCE,
      ticker: item.detectedTickers[0] ?? null,
      signalType: "news_event",
      title: item.title,
      summary:
        item.includeReason ?? "GDELT article matched local firehose rules.",
      sourceUrl: item.sourceUrl,
      receivedAt: item.receivedAt,
      processedStatus: "new",
      importanceHint: importance(item.score),
      payload: {
        gdelt: item.article,
        detectedTickers: item.detectedTickers,
        detectedCompanyNames: item.detectedCompanyNames,
        detectedThemes: item.detectedThemes,
        rule_score: item.score,
        future_ai_candidate: item.futureAiCandidate,
        include_reason: item.includeReason,
        reject_reason: item.rejectReason,
        broad_query_used: mode === "firehose" ? query : null,
        manual_query_used: mode === "single_query" ? query : null,
        maxrecords_requested: maxrecordsRequested,
        maxrecords_used: maxrecordsUsed,
        timespan_used: DEFAULT_GDELT_TIMESPAN,
        mode: "firehose",
      } satisfies Prisma.InputJsonValue,
    },
  });
  return "created" as const;
}

async function getExistingGdeltHealth() {
  return prisma.sourceHealth.findUnique({
    where: { source: GDELT_SOURCE },
    select: { notes: true, errorMessage: true },
  });
}

async function updateGdeltSourceHealth(
  status: "connected" | "degraded" | "error",
  startedAt: number,
  errorMessage: string | null,
  notes: string,
) {
  const now = new Date();
  await prisma.sourceHealth.upsert({
    where: { source: GDELT_SOURCE },
    create: {
      source: GDELT_SOURCE,
      status,
      checkedAt: now,
      lastSuccessAt:
        status === "connected" || status === "degraded" ? now : null,
      responseTimeMs: Date.now() - startedAt,
      errorMessage,
      usage: "Public GDELT market-wide news firehose",
      notes,
    },
    update: {
      status,
      checkedAt: now,
      lastSuccessAt:
        status === "connected" || status === "degraded" ? now : undefined,
      responseTimeMs: Date.now() - startedAt,
      errorMessage,
      usage: "Public GDELT market-wide news firehose",
      notes,
    },
  });
}

export async function runGdeltIngestion(
  options: GdeltRunOptions = {},
): Promise<GdeltRunResult> {
  const startedAt = Date.now();
  const query = options.q?.trim() || DEFAULT_GDELT_FIREHOSE_QUERY;
  const mode: GdeltRunMode = options.q?.trim() ? "single_query" : "firehose";
  const target = capLimit(options.limit);
  const errors: string[] = [];
  let used: number | null = null;
  let rateLimited = false;
  let fallbackUsed = false;
  let articles: GdeltArticle[] = [];

  const existingHealth = await getExistingGdeltHealth();
  const cooldownUntil = activeCooldown(existingHealth);
  if (cooldownUntil) {
    await updateGdeltSourceHealth(
      "degraded",
      startedAt,
      RATE_LIMIT_MESSAGE,
      buildGdeltNotes(
        "GDELT cooldown is active; no public request was made.",
        cooldownUntil,
        target,
      ),
    );
    return {
      ok: true,
      source: GDELT_SOURCE,
      mode,
      skipped: true,
      skipReason: "cooldown_active",
      maxrecordsTarget: target,
      maxrecordsRequested: target,
      maxrecordsUsed: null,
      timespan: DEFAULT_GDELT_TIMESPAN,
      cooldownActive: true,
      cooldownUntil: cooldownUntil.toISOString(),
      articlesChecked: 0,
      articlesRejectedByRules: 0,
      companyMatches: 0,
      themeMatches: 0,
      signalsCreated: 0,
      duplicatesSkipped: 0,
      futureAiCandidates: 0,
      rateLimited: true,
      fallbackUsed: false,
      responseTimeMs: Date.now() - startedAt,
      errors: [],
    };
  }

  const attempts = [
    target,
    GDELT_FALLBACK_MAXRECORDS,
    GDELT_SECOND_FALLBACK_MAXRECORDS,
  ].filter(
    (value, index, list) => value <= target && list.indexOf(value) === index,
  );

  for (const attemptLimit of attempts) {
    used = attemptLimit;
    fallbackUsed = attemptLimit !== target;
    try {
      articles = await fetchWithTimeout(query, attemptLimit);
      break;
    } catch (error) {
      const safe = safeError(error);
      const attemptRateLimited = isRateLimitErrorMessage(safe);
      rateLimited = rateLimited || attemptRateLimited;
      errors.push(attemptRateLimited ? RATE_LIMIT_MESSAGE : safe);
      articles = [];
    }
  }

  const scored = scoreArticles(articles);
  const included = scored.filter(
    (item) => item.includeReason && item.score > 0,
  );
  let signalsCreated = 0;
  let duplicatesSkipped = 0;
  for (const item of included) {
    const result = await createRawSignal(
      item,
      query,
      target,
      used ?? target,
      mode,
      Boolean(options.dryRun),
    );
    if (result === "created") signalsCreated += 1;
    if (result === "duplicate") duplicatesSkipped += 1;
  }

  const failed = articles.length === 0 && errors.length > 0;
  const cooldownAfterRateLimit = rateLimited
    ? new Date(Date.now() + GDELT_COOLDOWN_MS)
    : null;
  const allNonRateFailures = failed && !rateLimited;
  const status = allNonRateFailures
    ? "error"
    : rateLimited || fallbackUsed
      ? "degraded"
      : "connected";
  const errorMessage = rateLimited ? RATE_LIMIT_MESSAGE : (errors[0] ?? null);
  const notes =
    status === "connected"
      ? buildGdeltNotes(
          "GDELT max firehose working with adaptive maxrecords=250.",
          null,
          DEFAULT_GDELT_MAXRECORDS,
        )
      : fallbackUsed && articles.length > 0
        ? buildGdeltNotes(
            `GDELT fallback is active; maxrecords=${used} succeeded after reducing load.`,
            cooldownAfterRateLimit,
            used ?? GDELT_SECOND_FALLBACK_MAXRECORDS,
          )
        : buildGdeltNotes(
            "GDELT public endpoint is cooling down after rate limiting or blocking.",
            cooldownAfterRateLimit,
            used ?? target,
          );
  await updateGdeltSourceHealth(
    status,
    startedAt,
    status === "connected" || (fallbackUsed && articles.length > 0)
      ? null
      : errorMessage,
    notes,
  );

  return {
    ok: !allNonRateFailures,
    source: GDELT_SOURCE,
    mode,
    skipped: false,
    skipReason: null,
    maxrecordsTarget: target,
    maxrecordsRequested: target,
    maxrecordsUsed: used,
    timespan: DEFAULT_GDELT_TIMESPAN,
    cooldownActive: Boolean(cooldownAfterRateLimit),
    cooldownUntil: cooldownAfterRateLimit?.toISOString() ?? null,
    articlesChecked: articles.length,
    articlesRejectedByRules: scored.length - included.length,
    companyMatches: included.filter((i) => i.detectedTickers.length).length,
    themeMatches: included.filter((i) => i.detectedThemes.length).length,
    signalsCreated,
    duplicatesSkipped,
    futureAiCandidates: included.filter((i) => i.futureAiCandidate).length,
    rateLimited,
    fallbackUsed,
    responseTimeMs: Date.now() - startedAt,
    errors,
  };
}

export async function getGdeltSourceHealth() {
  if (!process.env.DATABASE_URL) {
    return {
      source: GDELT_SOURCE,
      status: "not_configured",
      lastChecked: null,
      lastSuccess: null,
      responseTimeMs: null,
      lastError: null,
      usage: "Public GDELT market-wide news firehose",
      notes: "DATABASE_URL is not configured, so GDELT source health cannot be persisted in this environment.",
      cooldownActive: false,
      cooldownUntil: null,
      currentTarget: DEFAULT_GDELT_MAXRECORDS,
    };
  }
  const row = await prisma.sourceHealth.findUnique({
    where: { source: GDELT_SOURCE },
  });
  if (!row) {
    return {
      source: GDELT_SOURCE,
      status: "stubbed",
      lastChecked: null,
      lastSuccess: null,
      responseTimeMs: null,
      lastError: null,
      usage: "Public GDELT market-wide news firehose",
      notes:
        "GDELT has not been checked yet. It will use adaptive maxrecords 250/100/50 with timespan=15min.",
      cooldownActive: false,
      cooldownUntil: null,
      currentTarget: DEFAULT_GDELT_MAXRECORDS,
    };
  }

  const cooldownUntil = activeCooldown(row);
  const targetMatch = row.notes?.match(/current_target=(\d+)/);
  return {
    source: row.source,
    status: row.status,
    lastChecked: row.checkedAt.toISOString(),
    lastSuccess: row.lastSuccessAt?.toISOString() ?? null,
    responseTimeMs: row.responseTimeMs,
    lastError: row.errorMessage ? row.errorMessage.slice(0, 240) : null,
    usage: row.usage,
    notes: row.notes,
    cooldownActive: Boolean(cooldownUntil),
    cooldownUntil: cooldownUntil?.toISOString() ?? null,
    currentTarget: targetMatch
      ? Number(targetMatch[1])
      : DEFAULT_GDELT_MAXRECORDS,
  };
}
