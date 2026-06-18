import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";

export const GDELT_SOURCE = "GDELT";

const GDELT_DOC_API_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;
const DEFAULT_TIMESPAN = "15min";

export const DEFAULT_GDELT_FIREHOSE_QUERY = [
  "earnings",
  "guidance",
  "acquisition",
  "merger",
  "lawsuit",
  "bankruptcy",
  "FDA",
  "clinical trial",
  "rate decision",
  "inflation",
  "SEC investigation",
  "partnership",
].join(" OR ");

const WATCHLIST: Record<string, string[]> = {
  AAPL: ["Apple"],
  NVDA: ["Nvidia", "NVIDIA"],
  TSLA: ["Tesla"],
  MSFT: ["Microsoft"],
  AMD: ["AMD", "Advanced Micro Devices"],
  META: ["Meta", "Facebook"],
  PLTR: ["Palantir"],
  COIN: ["Coinbase"],
  LLY: ["Eli Lilly"],
  SMCI: ["Super Micro", "Supermicro"],
  AMZN: ["Amazon"],
  GOOGL: ["Alphabet", "Google"],
  NFLX: ["Netflix"],
  JPM: ["JPMorgan", "JP Morgan", "JPMorgan Chase"],
  BAC: ["Bank of America"],
  XOM: ["Exxon", "ExxonMobil"],
  CVX: ["Chevron"],
  PFE: ["Pfizer"],
  MRNA: ["Moderna"],
  SHOP: ["Shopify"],
};

const highImportancePhrases = [
  "acquisition",
  "bankruptcy",
  "fda approval",
  "lawsuit",
  "sec investigation",
  "guidance",
  "rate decision",
  "inflation shock",
  "merger",
];

const mediumImportancePhrases = [
  "company",
  "product",
  "macro",
  "earnings",
  "clinical trial",
  "partnership",
  "inflation",
  "federal reserve",
  "interest rates",
  "revenue",
  "sales",
  "forecast",
];

const marketWidePhrases = ["rate decision", "inflation", "inflation shock", "federal reserve", "interest rates", "market", "stocks", "wall street"];

type GdeltArticle = {
  url?: string;
  url_mobile?: string;
  title?: string;
  seendate?: string;
  socialimage?: string;
  domain?: string;
  language?: string;
  sourcecountry?: string;
  source?: string;
  snippet?: string;
  description?: string;
};

type GdeltDocResponse = { articles?: GdeltArticle[] };

type GdeltCandidate = {
  query: string;
  ticker: string | null;
  matchedNames: string[];
  title: string;
  summary: string;
  sourceUrl: string | null;
  receivedAt: Date;
  importanceHint: "high" | "medium" | "low";
  metadata: GdeltArticle & { matchedTickers: string[]; mode: GdeltRunMode };
};

export type GdeltRunMode = "firehose" | "single_query";

export type GdeltRunOptions = {
  q?: string;
  limit?: number;
  dryRun?: boolean;
};

export type GdeltRunResult = {
  ok: boolean;
  source: typeof GDELT_SOURCE;
  mode: GdeltRunMode;
  articlesChecked: number;
  companyMatches: number;
  macroSignals: number;
  signalsCreated: number;
  duplicatesSkipped: number;
  rateLimited: boolean;
  errors: string[];
};

function safeError(error: unknown) {
  if (error instanceof Error) return error.message.split("\n")[0]?.slice(0, 180) || "GDELT request failed";
  return "GDELT request failed";
}

function parseGdeltDate(value?: string) {
  if (!value) return new Date();
  const compact = value.match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?(\d{2})?Z?$/);
  if (compact) {
    const [, year, month, day, hour = "00", minute = "00", second = "00"] = compact;
    const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function textContains(text: string, phrase: string) {
  if (/^[A-Z]{2,5}$/.test(phrase)) return new RegExp(`(^|[^A-Z0-9])${phrase}([^A-Z0-9]|$)`, "i").test(text);
  return text.toLowerCase().includes(phrase.toLowerCase());
}

function articleText(article: GdeltArticle) {
  return [article.title, article.snippet, article.description, article.source, article.domain, article.url, article.url_mobile]
    .filter(Boolean)
    .join(" ");
}

function detectWatchedCompanies(text: string) {
  const matches: Array<{ ticker: string; name: string }> = [];
  for (const [ticker, names] of Object.entries(WATCHLIST)) {
    const aliases = [ticker, ...names];
    const matchedAlias = aliases.find((alias) => textContains(text, alias));
    if (matchedAlias) matches.push({ ticker, name: matchedAlias });
  }
  return matches;
}

function isMarketWide(text: string) {
  return marketWidePhrases.some((phrase) => textContains(text, phrase));
}

function importanceFor(text: string): "high" | "medium" | "low" {
  const lower = text.toLowerCase();
  if (highImportancePhrases.some((phrase) => lower.includes(phrase))) return "high";
  if (mediumImportancePhrases.some((phrase) => lower.includes(phrase))) return "medium";
  return "low";
}

function buildSummary(candidate: Pick<GdeltCandidate, "ticker" | "matchedNames" | "importanceHint">) {
  if (candidate.ticker) {
    return `GDELT market-wide firehose found public news for ${candidate.ticker} (${candidate.matchedNames.join(", ")}). Importance is ${candidate.importanceHint}.`;
  }
  return `GDELT market-wide firehose found a broad market news item. Importance is ${candidate.importanceHint}.`;
}

async function fetchGdeltArticles(query: string, limit: number) {
  const url = new URL(GDELT_DOC_API_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("mode", "ArtList");
  url.searchParams.set("format", "json");
  url.searchParams.set("maxrecords", String(Math.min(Math.max(limit, 1), MAX_LIMIT)));
  url.searchParams.set("timespan", DEFAULT_TIMESPAN);
  url.searchParams.set("sort", "DateDesc");

  const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
  if (response.status === 429) throw new Error("GDELT rate limited request with status 429");
  if (!response.ok) throw new Error(`GDELT request failed with status ${response.status}`);

  const data = (await response.json()) as GdeltDocResponse;
  return data.articles ?? [];
}

async function rawSignalExists(candidate: GdeltCandidate) {
  const existing = await prisma.rawSignal.findFirst({
    where: {
      source: GDELT_SOURCE,
      OR: [
        ...(candidate.sourceUrl ? [{ sourceUrl: candidate.sourceUrl }] : []),
        { title: candidate.title, receivedAt: candidate.receivedAt },
        { title: candidate.title },
      ],
    },
    select: { id: true },
  });
  return Boolean(existing);
}

async function createRawSignal(candidate: GdeltCandidate, dryRun: boolean) {
  if (await rawSignalExists(candidate)) return "duplicate" as const;
  if (dryRun) return "dry_run" as const;
  await prisma.rawSignal.create({
    data: {
      source: GDELT_SOURCE,
      ticker: candidate.ticker,
      signalType: "news_event",
      title: candidate.title,
      summary: candidate.summary,
      sourceUrl: candidate.sourceUrl,
      receivedAt: candidate.receivedAt,
      processedStatus: "new",
      importanceHint: candidate.importanceHint,
      payload: {
        gdeltEndpoint: "DOC 2.1 ArtList",
        query: candidate.query,
        matchedTickers: candidate.metadata.matchedTickers,
        matchedNames: candidate.matchedNames,
        mode: candidate.metadata.mode,
        rawMetadata: candidate.metadata,
      } satisfies Prisma.InputJsonValue,
    },
  });
  return "created" as const;
}

async function updateGdeltSourceHealth(status: "connected" | "degraded" | "error", startedAt: number, errorMessage: string | null) {
  const now = new Date();
  await prisma.sourceHealth.upsert({
    where: { source: GDELT_SOURCE },
    create: {
      source: GDELT_SOURCE,
      status,
      checkedAt: now,
      lastSuccessAt: status === "connected" || status === "degraded" ? now : null,
      responseTimeMs: Date.now() - startedAt,
      errorMessage,
      usage: "Public GDELT market-wide news firehose",
      notes: "Runs one broad GDELT request, detects watched companies locally, and writes matching public news into Raw Signal Store.",
    },
    update: {
      status,
      checkedAt: now,
      lastSuccessAt: status === "connected" || status === "degraded" ? now : undefined,
      responseTimeMs: Date.now() - startedAt,
      errorMessage,
      usage: "Public GDELT market-wide news firehose",
      notes: "Runs one broad GDELT request, detects watched companies locally, and writes matching public news into Raw Signal Store.",
    },
  });
}

export async function runGdeltIngestion(options: GdeltRunOptions = {}): Promise<GdeltRunResult> {
  const startedAt = Date.now();
  const query = options.q?.trim() || DEFAULT_GDELT_FIREHOSE_QUERY;
  const mode: GdeltRunMode = options.q?.trim() ? "single_query" : "firehose";
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const errors: string[] = [];
  let articlesChecked = 0;
  let companyMatches = 0;
  let macroSignals = 0;
  let signalsCreated = 0;
  let duplicatesSkipped = 0;
  let rateLimited = false;

  try {
    const articles = await fetchGdeltArticles(query, limit);
    articlesChecked = articles.length;
    for (const article of articles) {
      const title = article.title?.trim();
      if (!title) continue;
      const haystack = articleText(article);
      const matches = detectWatchedCompanies(haystack);
      const marketWide = isMarketWide(haystack);
      if (!matches.length && !marketWide) continue;

      const primaryMatch = matches[0];
      if (primaryMatch) companyMatches += 1;
      else macroSignals += 1;

      const importanceHint = importanceFor(haystack);
      const candidate: GdeltCandidate = {
        query,
        ticker: primaryMatch?.ticker ?? null,
        matchedNames: matches.map((match) => match.name),
        title: title.slice(0, 240),
        summary: buildSummary({ ticker: primaryMatch?.ticker ?? null, matchedNames: matches.map((match) => match.name), importanceHint }),
        sourceUrl: article.url ?? article.url_mobile ?? null,
        receivedAt: parseGdeltDate(article.seendate),
        importanceHint,
        metadata: { ...article, matchedTickers: matches.map((match) => match.ticker), mode },
      };

      const result = await createRawSignal(candidate, Boolean(options.dryRun));
      if (result === "duplicate") duplicatesSkipped += 1;
      if (result === "created") signalsCreated += 1;
    }

    await updateGdeltSourceHealth("connected", startedAt, null);
    return { ok: true, source: GDELT_SOURCE, mode, articlesChecked, companyMatches, macroSignals, signalsCreated, duplicatesSkipped, rateLimited, errors };
  } catch (error) {
    const safe = safeError(error);
    rateLimited = safe.includes("429") || safe.toLowerCase().includes("rate limited");
    errors.push(safe);
    await updateGdeltSourceHealth(rateLimited ? "degraded" : "error", startedAt, safe);
    return { ok: false, source: GDELT_SOURCE, mode, articlesChecked, companyMatches, macroSignals, signalsCreated, duplicatesSkipped, rateLimited, errors };
  }
}

export async function getGdeltSourceHealth() {
  const row = await prisma.sourceHealth.findUnique({ where: { source: GDELT_SOURCE } });
  return row
    ? {
        source: row.source,
        status: row.status,
        lastChecked: row.checkedAt.toISOString(),
        lastSuccess: row.lastSuccessAt?.toISOString() ?? null,
        responseTimeMs: row.responseTimeMs,
        lastError: row.errorMessage ? row.errorMessage.slice(0, 240) : null,
        usage: row.usage,
        notes: row.notes,
      }
    : {
        source: GDELT_SOURCE,
        status: "stubbed",
        lastChecked: null,
        lastSuccess: null,
        responseTimeMs: null,
        lastError: null,
        usage: "Public GDELT market-wide news firehose",
        notes: "GDELT has not been checked yet.",
      };
}
