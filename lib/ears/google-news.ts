import { prisma } from "@/lib/db/client";
import { writeRawSignal } from "@/lib/raw-signal-writer";

export const GOOGLE_NEWS_RSS_SOURCE = "Google News RSS";
const GOOGLE_NEWS_RSS_URL = "https://news.google.com/rss/search";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ARTICLES_PER_QUERY = 8;

const SAFE_QUERIES = [
  'earnings guidance stock',
  'SEC investigation company stock',
  'FDA approval company stock',
  'Federal Reserve inflation stocks',
  'semiconductor AI chip stocks',
] as const;

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
  JPM: ["JPMorgan", "JP Morgan"],
  BAC: ["Bank of America"],
  XOM: ["Exxon"],
  PFE: ["Pfizer"],
  MRNA: ["Moderna"],
  AVGO: ["Broadcom"],
  ORCL: ["Oracle"],
  CRM: ["Salesforce"],
};

const CATALYST_KEYWORDS = ["earnings", "guidance", "acquisition", "merger", "bankruptcy", "lawsuit", "partnership", "upgrade", "downgrade"];
const REGULATORY_KEYWORDS = ["SEC", "FTC", "DOJ", "FDA", "regulator", "investigation", "approval", "antitrust", "recall"];
const SECTOR_KEYWORDS = ["semiconductor", "AI chip", "banks", "oil", "energy", "healthcare", "crypto", "retail", "software"];
const MARKET_KEYWORDS = ["Federal Reserve", "inflation", "CPI", "jobs report", "interest rates", "recession", "tariff", "yields", "market selloff"];

type GoogleNewsArticle = {
  title: string;
  link: string | null;
  pubDate: string | null;
  source: string | null;
  description: string | null;
  query: string;
};

type ClassifiedArticle = {
  article: GoogleNewsArticle;
  ticker: string | null;
  company: string | null;
  categories: string[];
  score: number;
  rejectedReason: string | null;
};

type SourceHealthStatus = "connected" | "degraded" | "error";

export type GoogleNewsRunResult = {
  ok: boolean;
  source: typeof GOOGLE_NEWS_RSS_SOURCE;
  dryRun: boolean;
  queriesChecked: number;
  articlesChecked: number;
  rawSignalsCreated: number;
  duplicatesSkipped: number;
  rejected: number;
  errors: string[];
  sourceHealthStatus: SourceHealthStatus;
};

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function tagValue(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? decodeXml(match[1]).slice(0, 1000) : null;
}

function parseRss(xml: string, query: string): GoogleNewsArticle[] {
  return Array.from(xml.matchAll(/<item\b[\s\S]*?<\/item>/gi))
    .slice(0, MAX_ARTICLES_PER_QUERY)
    .map(([item]) => ({
      title: tagValue(item, "title")?.slice(0, 240) ?? "",
      link: tagValue(item, "link"),
      pubDate: tagValue(item, "pubDate"),
      source: tagValue(item, "source")?.slice(0, 120) ?? null,
      description: tagValue(item, "description"),
      query,
    }))
    .filter((article) => article.title.length > 0);
}

function contains(text: string, phrase: string) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
}

function classify(article: GoogleNewsArticle): ClassifiedArticle {
  const text = [article.title, article.description, article.source].filter(Boolean).join(" ");
  const companyMatch = Object.entries(WATCHLIST).find(([, names]) => names.some((name) => contains(text, name)));
  const ticker = companyMatch?.[0] ?? null;
  const company = companyMatch?.[1].find((name) => contains(text, name)) ?? null;
  const categories = [
    ...(ticker ? ["company_news"] : []),
    ...(CATALYST_KEYWORDS.some((word) => contains(text, word)) ? ["earnings_news_catalyst"] : []),
    ...(REGULATORY_KEYWORDS.some((word) => contains(text, word)) ? ["regulatory_news"] : []),
    ...(SECTOR_KEYWORDS.some((word) => contains(text, word)) ? ["sector_news"] : []),
    ...(MARKET_KEYWORDS.some((word) => contains(text, word)) ? ["market_moving_headline"] : []),
  ];
  let score = 20 + categories.length * 15;
  if (ticker) score += 20;
  if (article.link) score += 10;
  score = Math.min(score, 95);
  return {
    article,
    ticker,
    company,
    categories,
    score,
    rejectedReason: categories.length ? null : "No company, catalyst, regulatory, sector, or market-moving keyword match.",
  };
}

async function fetchQuery(query: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const url = new URL(GOOGLE_NEWS_RSS_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("hl", "en-US");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");
  try {
    const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/rss+xml, application/xml, text/xml" }, signal: controller.signal });
    if (!response.ok) throw new Error(`Google News RSS returned ${response.status}`);
    return parseRss(await response.text(), query);
  } finally {
    clearTimeout(timeout);
  }
}

function isRateLimitError(message: string) {
  return /\b(429|rate limit|too many requests)\b/i.test(message);
}

async function updateSourceHealth(status: SourceHealthStatus, startedAt: number, errorMessage: string | null, notes: string): Promise<SourceHealthStatus> {
  if (!process.env.DATABASE_URL) return status;
  const now = new Date();
  await prisma.sourceHealth.upsert({
    where: { source: GOOGLE_NEWS_RSS_SOURCE },
    create: { source: GOOGLE_NEWS_RSS_SOURCE, status, checkedAt: now, lastSuccessAt: status === "error" ? null : now, responseTimeMs: Date.now() - startedAt, errorMessage, usage: "Public Google News RSS backup catalyst headlines", notes },
    update: { status, checkedAt: now, lastSuccessAt: status === "error" ? undefined : now, responseTimeMs: Date.now() - startedAt, errorMessage, usage: "Public Google News RSS backup catalyst headlines", notes },
  });
  return status;
}

export async function runGoogleNewsRssIngestion(options: { dryRun?: boolean } = {}): Promise<GoogleNewsRunResult> {
  const startedAt = Date.now();
  const dryRun = options.dryRun ?? true;
  const errors: string[] = [];
  const seen = new Set<string>();
  let articlesChecked = 0;
  let rawSignalsCreated = 0;
  let duplicatesSkipped = 0;
  let rejected = 0;

  for (const query of SAFE_QUERIES) {
    try {
      const articles = await fetchQuery(query);
      articlesChecked += articles.length;
      for (const article of articles) {
        const duplicateKey = `${GOOGLE_NEWS_RSS_SOURCE}|${(article.link ?? article.title).toLowerCase()}`;
        if (seen.has(duplicateKey)) {
          duplicatesSkipped += 1;
          continue;
        }
        seen.add(duplicateKey);
        const classified = classify(article);
        if (classified.rejectedReason) {
          rejected += 1;
          continue;
        }
        const result = await writeRawSignal({
          sourceName: GOOGLE_NEWS_RSS_SOURCE,
          sourceType: classified.categories.includes("regulatory_news") ? "regulatory" : "news",
          ticker: classified.ticker,
          company: classified.company,
          eventType: classified.categories[0] ?? "news_event",
          title: article.title,
          summary: `Google News RSS matched ${classified.categories.join(", ")} from query: ${query}.`,
          url: article.link,
          detectedAt: article.pubDate,
          duplicateKey,
          qualityHints: { importanceHint: classified.score >= 75 ? "high" : "medium", confidence: classified.score / 100, sourceQuality: "medium", useful: true, reasons: classified.categories },
          rawPayload: { googleNewsRss: article, categories: classified.categories, rule_score: classified.score },
          dryRun,
        });
        if (result.status === "saved") rawSignalsCreated += 1;
        else if (result.status === "skipped" && result.reason === "duplicate") duplicatesSkipped += 1;
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message.slice(0, 180) : "Google News RSS request failed");
    }
  }

  const allRequestsFailed = errors.length === SAFE_QUERIES.length;
  const allFailuresWereRateLimits = allRequestsFailed && errors.every(isRateLimitError);
  const sourceHealthStatus: SourceHealthStatus = allRequestsFailed && !allFailuresWereRateLimits ? "error" : errors.length || articlesChecked === 0 ? "degraded" : "connected";
  const status = await updateSourceHealth(sourceHealthStatus, startedAt, errors[0] ?? null, `Checked ${SAFE_QUERIES.length} safe RSS queries; dryRun=${dryRun}.`);
  return { ok: status !== "error", source: GOOGLE_NEWS_RSS_SOURCE, dryRun, queriesChecked: SAFE_QUERIES.length, articlesChecked, rawSignalsCreated, duplicatesSkipped, rejected, errors, sourceHealthStatus: status };
}
