import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";

export const GDELT_SOURCE = "GDELT";

const GDELT_DOC_API_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;

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

const tickerAliases: Record<string, string[]> = {
  AAPL: ["AAPL", "Apple"],
  NVDA: ["NVDA", "Nvidia", "NVIDIA"],
  TSLA: ["TSLA", "Tesla"],
  MSFT: ["MSFT", "Microsoft"],
  AMD: ["AMD", "Advanced Micro Devices"],
  META: ["META", "Meta", "Facebook"],
  PLTR: ["PLTR", "Palantir"],
  COIN: ["COIN", "Coinbase"],
  LLY: ["LLY", "Eli Lilly"],
  SMCI: ["SMCI", "Super Micro", "Supermicro"],
};

const highImportancePhrases = [
  "earnings guidance",
  "fda approval",
  "lawsuit",
  "bankruptcy",
  "acquisition",
  "sec investigation",
  "major partnership",
  "rate decision",
  "inflation shock",
];

const mediumImportancePhrases = [
  "launch",
  "product",
  "revenue",
  "sales",
  "forecast",
  "federal reserve",
  "inflation",
  "interest rates",
  "clinical trial",
  "partnership",
  "earnings",
];

type GdeltArticle = {
  url?: string;
  url_mobile?: string;
  title?: string;
  seendate?: string;
  socialimage?: string;
  domain?: string;
  language?: string;
  sourcecountry?: string;
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

function safeError(error: unknown) {
  if (error instanceof Error) {
    return error.message.split("\n")[0]?.slice(0, 180) || "GDELT request failed";
  }

  return "GDELT request failed";
}

function normalizeTerm(term: string) {
  return term.trim().replace(/\s+/g, " ").slice(0, 80);
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
  if (/^[A-Z]{2,5}$/.test(phrase)) {
    return new RegExp(`(^|[^A-Z0-9])${phrase}([^A-Z0-9]|$)`, "i").test(text);
  }

  return text.toLowerCase().includes(phrase.toLowerCase());
}

function detectTicker(title: string, term: string) {
  const haystack = `${title} ${term}`;
  for (const [ticker, aliases] of Object.entries(tickerAliases)) {
    if (aliases.some((alias) => textContains(haystack, alias))) return ticker;
  }

  return null;
}

function importanceFor(title: string, term: string): "high" | "medium" | "low" {
  const haystack = `${title} ${term}`.toLowerCase();
  if (highImportancePhrases.some((phrase) => haystack.includes(phrase))) return "high";
  if (mediumImportancePhrases.some((phrase) => haystack.includes(phrase))) return "medium";
  if (detectTicker(title, term)) return "medium";
  return "low";
}

function buildSummary(candidate: Pick<GdeltCandidate, "term" | "ticker" | "importanceHint">) {
  const subject = candidate.ticker ? `${candidate.ticker} / ${candidate.term}` : candidate.term;
  return `GDELT found a public news mention for ${subject}. Importance is marked ${candidate.importanceHint} for later filtering.`;
}

async function fetchGdeltArticles(term: string, limit: number) {
  const url = new URL(GDELT_DOC_API_URL);
  url.searchParams.set("query", term);
  url.searchParams.set("mode", "ArtList");
  url.searchParams.set("format", "json");
  url.searchParams.set("maxrecords", String(limit));
  url.searchParams.set("timespan", "1d");
  url.searchParams.set("sort", "DateDesc");

  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) throw new Error(`GDELT request failed with status ${response.status}`);

  const data = (await response.json()) as GdeltDocResponse;
  return data.articles ?? [];
}

async function rawSignalExists(candidate: GdeltCandidate) {
  const existing = await prisma.rawSignal.findFirst({
    where: {
      source: GDELT_SOURCE,
      signalType: "news_event",
      OR: [
        ...(candidate.sourceUrl ? [{ sourceUrl: candidate.sourceUrl }] : []),
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
        matchedTerm: candidate.term,
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
      usage: "Public GDELT news and event ingestion",
      notes: "Ingests public news/event mentions into the Raw Signal Store without scoring or alerts.",
    },
    update: {
      status,
      checkedAt: now,
      lastSuccessAt: status === "connected" || status === "degraded" ? now : undefined,
      responseTimeMs: Date.now() - startedAt,
      errorMessage,
      usage: "Public GDELT news and event ingestion",
      notes: "Ingests public news/event mentions into the Raw Signal Store without scoring or alerts.",
    },
  });
}

export async function runGdeltIngestion(options: GdeltRunOptions = {}): Promise<GdeltRunResult> {
  const startedAt = Date.now();
  const terms = (options.terms?.length ? options.terms : DEFAULT_GDELT_TERMS).map(normalizeTerm).filter(Boolean);
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const errors: string[] = [];
  let signalsCreated = 0;
  let duplicatesSkipped = 0;

  try {
    for (const term of terms) {
      try {
        const articles = await fetchGdeltArticles(term, limit);
        for (const article of articles) {
          const title = article.title?.trim();
          if (!title) continue;

          const ticker = detectTicker(title, term);
          const importanceHint = importanceFor(title, term);
          const candidate: GdeltCandidate = {
            term,
            ticker,
            title: title.slice(0, 240),
            summary: buildSummary({ term, ticker, importanceHint }),
            sourceUrl: article.url ?? article.url_mobile ?? null,
            receivedAt: parseGdeltDate(article.seendate),
            importanceHint,
            metadata: { ...article, matchedTerm: term },
          };

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
        usage: "Public GDELT news and event ingestion",
        notes: "GDELT has not been checked yet.",
      };
}
