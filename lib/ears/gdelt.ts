import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";

export const GDELT_SOURCE = "GDELT";

const GDELT_DOC_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const DEFAULT_LIMIT = 5;
const MAX_FETCH_LIMIT = 10;

export const DEFAULT_GDELT_TERMS = [
  "Apple AAPL",
  "Nvidia NVDA",
  "Tesla TSLA",
  "Microsoft MSFT",
  "AMD",
  "Meta META",
  "Palantir PLTR",
  "Coinbase COIN",
  "Eli Lilly LLY",
  "Super Micro SMCI",
  "Federal Reserve",
  "inflation",
  "interest rates",
  "FDA approval",
  "clinical trial",
  "earnings guidance",
  "insider buying",
];

const TICKER_ALIASES: Array<{ ticker: string; patterns: RegExp[] }> = [
  { ticker: "AAPL", patterns: [/\bAAPL\b/i, /\bApple\b/i] },
  { ticker: "NVDA", patterns: [/\bNVDA\b/i, /\bNvidia\b/i] },
  { ticker: "TSLA", patterns: [/\bTSLA\b/i, /\bTesla\b/i] },
  { ticker: "MSFT", patterns: [/\bMSFT\b/i, /\bMicrosoft\b/i] },
  { ticker: "AMD", patterns: [/\bAMD\b/i, /\bAdvanced Micro Devices\b/i] },
  { ticker: "META", patterns: [/\bMETA\b/i, /\bMeta\b/i] },
  { ticker: "PLTR", patterns: [/\bPLTR\b/i, /\bPalantir\b/i] },
  { ticker: "COIN", patterns: [/\bCOIN\b/i, /\bCoinbase\b/i] },
  { ticker: "LLY", patterns: [/\bLLY\b/i, /\bEli Lilly\b/i] },
  { ticker: "SMCI", patterns: [/\bSMCI\b/i, /\bSuper Micro\b/i, /\bSupermicro\b/i] },
];

const HIGH_IMPORTANCE_PATTERNS = [
  /earnings guidance/i,
  /guidance/i,
  /FDA approval/i,
  /lawsuit/i,
  /bankrupt/i,
  /acquisition/i,
  /acquire[sd]?\b/i,
  /SEC investigation/i,
  /major partnership/i,
  /rate decision/i,
  /inflation shock/i,
];

const MEDIUM_IMPORTANCE_PATTERNS = [
  /product/i,
  /launch/i,
  /Federal Reserve/i,
  /inflation/i,
  /interest rates?/i,
  /clinical trial/i,
  /earnings/i,
  /partnership/i,
];

type GdeltArticle = {
  url?: string;
  url_mobile?: string;
  title?: string;
  seendate?: string;
  domain?: string;
  language?: string;
  sourcecountry?: string;
  socialimage?: string;
};

type GdeltDocResponse = {
  articles?: GdeltArticle[];
};

type GdeltCandidate = {
  term: string;
  ticker: string | null;
  title: string;
  summary: string;
  sourceUrl: string | null;
  receivedAt: Date;
  importanceHint: "high" | "medium" | "low";
  metadata: GdeltArticle & { matchedTerm: string };
};

export type GdeltRunOptions = {
  terms?: string[];
  limit?: number;
  dryRun?: boolean;
};

export type GdeltRunResult = {
  ok: boolean;
  source: typeof GDELT_SOURCE;
  termsChecked: number;
  signalsCreated: number;
  duplicatesSkipped: number;
  errors: string[];
};

function normalizeTerm(term: string) {
  return term.trim().replace(/\s+/g, " ").slice(0, 80);
}

function safeError(error: unknown) {
  if (error instanceof Error) return error.message.split("\n")[0]?.slice(0, 180) || "GDELT request failed";
  return "GDELT request failed";
}

function parseGdeltDate(value?: string) {
  if (!value) return new Date();
  if (/^\d{14}$/.test(value)) {
    const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}Z`;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function detectTicker(text: string) {
  return TICKER_ALIASES.find((entry) => entry.patterns.some((pattern) => pattern.test(text)))?.ticker ?? null;
}

function importanceFor(text: string): "high" | "medium" | "low" {
  if (HIGH_IMPORTANCE_PATTERNS.some((pattern) => pattern.test(text))) return "high";
  if (MEDIUM_IMPORTANCE_PATTERNS.some((pattern) => pattern.test(text)) || detectTicker(text)) return "medium";
  return "low";
}

function buildSummary(article: GdeltArticle, term: string) {
  const domain = article.domain ? ` from ${article.domain}` : "";
  return `GDELT found a public news mention for "${term}"${domain}. This is a raw news/event signal only.`;
}

async function fetchGdeltArticles(term: string, limit: number) {
  const params = new URLSearchParams({
    query: `"${term.replace(/"/g, "")}"`,
    mode: "ArtList",
    format: "json",
    timespan: "24h",
    sort: "HybridRel",
    maxrecords: String(limit),
  });

  const response = await fetch(`${GDELT_DOC_URL}?${params.toString()}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) throw new Error(`GDELT request failed with status ${response.status}`);
  return ((await response.json()) as GdeltDocResponse).articles ?? [];
}

function toCandidate(article: GdeltArticle, term: string): GdeltCandidate | null {
  const title = article.title?.trim();
  if (!title) return null;

  const sourceUrl = article.url?.trim() || article.url_mobile?.trim() || null;
  const text = `${title} ${term}`;

  return {
    term,
    ticker: detectTicker(text),
    title: title.slice(0, 240),
    summary: buildSummary(article, term).slice(0, 500),
    sourceUrl,
    receivedAt: parseGdeltDate(article.seendate),
    importanceHint: importanceFor(text),
    metadata: { ...article, matchedTerm: term },
  };
}

async function rawSignalExists(candidate: GdeltCandidate) {
  const existing = await prisma.rawSignal.findFirst({
    where: {
      source: GDELT_SOURCE,
      signalType: "news_event",
      OR: [{ sourceUrl: candidate.sourceUrl }, { title: candidate.title }].filter((item) => Object.values(item)[0]) as Array<{ sourceUrl: string } | { title: string }>,
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
        gdeltEndpoint: "DOC 2.0 ArtList",
        matchedTerm: candidate.term,
        domain: candidate.metadata.domain ?? null,
        language: candidate.metadata.language ?? null,
        sourceCountry: candidate.metadata.sourcecountry ?? null,
        seendate: candidate.metadata.seendate ?? null,
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
      usage: "Public GDELT news/event ingestion",
      notes: "Ingests public GDELT news/event mentions into the Raw Signal Store without scoring or final alerts.",
    },
    update: {
      status,
      checkedAt: now,
      lastSuccessAt: status === "connected" || status === "degraded" ? now : undefined,
      responseTimeMs: Date.now() - startedAt,
      errorMessage,
      usage: "Public GDELT news/event ingestion",
      notes: "Ingests public GDELT news/event mentions into the Raw Signal Store without scoring or final alerts.",
    },
  });
}

export async function runGdeltIngestion(options: GdeltRunOptions = {}): Promise<GdeltRunResult> {
  const startedAt = Date.now();
  const terms = (options.terms?.length ? options.terms : DEFAULT_GDELT_TERMS).map(normalizeTerm).filter(Boolean);
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_FETCH_LIMIT);
  const errors: string[] = [];
  let signalsCreated = 0;
  let duplicatesSkipped = 0;

  try {
    for (const term of terms) {
      try {
        const articles = await fetchGdeltArticles(term, limit);
        for (const article of articles) {
          const candidate = toCandidate(article, term);
          if (!candidate) continue;
          const result = await createRawSignal(candidate, Boolean(options.dryRun));
          if (result === "duplicate") duplicatesSkipped += 1;
          if (result === "created") signalsCreated += 1;
        }
      } catch (error) {
        errors.push(`${term}: ${safeError(error)}`);
      }
    }

    await updateGdeltSourceHealth(errors.length ? "degraded" : "connected", startedAt, errors[0] ?? null);
    return { ok: true, source: GDELT_SOURCE, termsChecked: terms.length, signalsCreated, duplicatesSkipped, errors };
  } catch (error) {
    const safe = safeError(error);
    await updateGdeltSourceHealth("error", startedAt, safe);
    return { ok: false, source: GDELT_SOURCE, termsChecked: terms.length, signalsCreated, duplicatesSkipped, errors: [safe] };
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
        usage: "Public GDELT news/event ingestion",
        notes: "GDELT has not been checked yet.",
      };
}
