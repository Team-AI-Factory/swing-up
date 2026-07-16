import crypto from "node:crypto";
import { prisma } from "@/lib/db/client";

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
]);
const MAX_FETCH_MS = 5000;
const MAX_TEXT = 24000;
const MAX_SUMMARY = 1800;

type ArticleInput = {
  articleUrl?: string | null;
  title?: string | null;
  snippet?: string | null;
  source?: string | null;
  ticker?: string | null;
  company?: string | null;
  receivedAt?: Date | string | null;
  confirmRun?: boolean;
  dryRun?: boolean;
  duplicateArticleSourceId?: string | null;
};
export type ArticleMemoryResult = Record<string, unknown>;

let articleMemorySetupUnavailableReason: string | null = null;

export function safeArticleMemoryError(e: unknown) {
  return e instanceof Error
    ? e.message.replace(/[A-Za-z0-9_\-]{24,}/g, "[redacted]").slice(0, 160)
    : "article_memory_setup_failed";
}

export function articleMemoryUnavailableResult(
  input: ArticleInput,
  reason: string,
) {
  return {
    ...emptyResult(input),
    articleReaderEnabled: false,
    articleMemorySetupFailed: true,
    articleMemoryUnavailableReason: reason,
    errorCategory: "article_memory_setup_failed",
    errorMessageSafe: reason,
  };
}

function text(v: unknown, max = 1000) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
function hash(v: string) {
  return crypto.createHash("sha256").update(v).digest("hex");
}
export function normalizeArticleUrl(url: string) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const key of Array.from(parsed.searchParams.keys()))
      if (TRACKING_PARAMS.has(key.toLowerCase()))
        parsed.searchParams.delete(key);
    parsed.searchParams.sort();
    return parsed.toString();
  } catch {
    return url.trim();
  }
}
export function articleIdentity(input: ArticleInput) {
  const articleUrl = text(input.articleUrl, 3000);
  const normalizedArticleUrl = articleUrl
    ? normalizeArticleUrl(articleUrl)
    : "";
  const articleUrlHash = normalizedArticleUrl ? hash(normalizedArticleUrl) : "";
  const title = text(input.title, 1000);
  const titleHash = title ? hash(title.toLowerCase()) : "";
  return {
    articleUrl,
    normalizedArticleUrl,
    articleUrlHash,
    canonicalArticleId: articleUrlHash || titleHash,
    sourceName: text(input.source, 200),
    titleHash,
    firstSeenAt: input.receivedAt ?? new Date(),
    lastSeenAt: new Date(),
  };
}
function emptyResult(input: ArticleInput) {
  const id = articleIdentity(input);
  return {
    ...id,
    hasArticleUrl: Boolean(id.articleUrl),
    articleAlreadySeen: false,
    articleMemoryAvailable: false,
    articleMemoryUsed: false,
    reusedArticleMemoryId: null as string | null,
    articleReadAttempted: false,
    articleTextAvailable: false,
    articleTextLength: 0,
    articleTextStored: false,
    articleSummaryAvailable: false,
    articleInputMode: id.articleUrl ? "not_read" : "title_snippet_only",
    articleSummary: "",
    relevanceSummary: "",
    catalystSummary: "",
    proofSummary: "",
    riskSummary: "",
    entitiesDetected: [] as string[],
    topicsDetected: [] as string[],
    articleRelevanceScore: 0,
    articleQualityScore: 0,
    aiArticleSummaryUsed: false,
    aiArticleSummaryReason: "confirmRun=false_or_ai_not_enabled",
    errorCategory: null as string | null,
    errorMessageSafe: null as string | null,
    articleMemoryProofUsed: false,
    articleMemoryProofReason: null as string | null,
    articleMemoryRejectedReason: "not_evaluated",
    duplicateArticleInRun: false,
    duplicateArticleSourceId: input.duplicateArticleSourceId ?? null,
    duplicateArticleReuseReason: null as string | null,
  };
}

export function articleReadPriority(input: ArticleInput) {
  const textBlob = [
    input.title,
    input.snippet,
    input.source,
    input.ticker,
    input.company,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const has = (patterns: RegExp[]) =>
    patterns.some((pattern) => pattern.test(textBlob));
  if (
    has([
      /\bwar\b/,
      /ceasefire/,
      /\biran\b/,
      /oil\s+spike/,
      /sanctions?/,
      /strait\s+of\s+hormuz/,
      /inflation\s+shock/,
      /bond\s+yield\s+spike/,
      /fed\s+hike\s+expectation/,
      /market\s+crash/,
      /emergency\s+government\s+action/,
    ])
  ) {
    return {
      articleReadPriorityScore: 100,
      articleReadPriorityReason: "major_macro_geopolitical_shock",
      macroShockArticle: true,
    };
  }
  if (
    has([
      /customer|contract|partnership|acquisition|merger|buyout|takeover|guidance|approval|investigation|recall|lawsuit|settlement|wins?\s+deal|strong receipt/,
    ]) &&
    Boolean(input.ticker || input.company)
  ) {
    return {
      articleReadPriorityScore: 80,
      articleReadPriorityReason: "direct_ticker_company_catalyst_with_receipt",
      macroShockArticle: false,
    };
  }
  if (
    has([/earnings|\bsec\b|8-k|10-q|10-k|form\s+4|\bfda\b|contract|customer/])
  ) {
    return {
      articleReadPriorityScore: 60,
      articleReadPriorityReason: "earnings_sec_fda_contract_customer_story",
      macroShockArticle: false,
    };
  }
  if (
    has([/analyst|rating|upgrade|downgrade|price\s+target|opinion|analysis/])
  ) {
    return {
      articleReadPriorityScore: 30,
      articleReadPriorityReason:
        "analyst_opinion_rating_or_normal_stock_article",
      macroShockArticle: false,
    };
  }
  if (
    has([
      /listicle|watchlist|portfolio|top\s+\d+|\d+\s+stocks?\s+to\s+(buy|watch)|best\s+stocks?|zacks|simply\s+wall|insider\s+monkey|motley\s+fool/,
    ])
  ) {
    return {
      articleReadPriorityScore: 10,
      articleReadPriorityReason:
        "listicle_generic_portfolio_or_syndicated_news",
      macroShockArticle: false,
    };
  }
  return {
    articleReadPriorityScore: 30,
    articleReadPriorityReason: "normal_stock_article",
    macroShockArticle: false,
  };
}

export async function runPriorityArticleReader(input: {
  signals: Array<{
    id: string;
    source?: string | null;
    ticker?: string | null;
    title?: string | null;
    summary?: string | null;
    sourceUrl?: string | null;
    receivedAt?: Date | string | null;
  }>;
  dryRun?: boolean;
  confirmRun?: boolean;
  maxArticles?: number;
  macroShockReservedReads?: number;
  normalCandidateReservedReads?: number;
}) {
  const maxArticleReadsPerRun = Math.max(
    0,
    Math.min(Number(input.maxArticles ?? 8) || 8, 20),
  );
  const macroShockReservedReads = Math.max(
    0,
    Math.min(
      Number(input.macroShockReservedReads ?? 3) || 3,
      maxArticleReadsPerRun,
    ),
  );
  const normalCandidateReservedReads = Math.max(
    0,
    Math.min(
      Number(input.normalCandidateReservedReads ?? 5) || 5,
      maxArticleReadsPerRun,
    ),
  );
  const queue = input.signals
    .map((signal, index) => {
      const articleInput: ArticleInput = {
        articleUrl: signal.sourceUrl,
        title: signal.title,
        snippet: signal.summary,
        source: signal.source,
        ticker: signal.ticker,
        receivedAt: signal.receivedAt,
        confirmRun: input.confirmRun === true,
        dryRun: input.dryRun !== false,
        duplicateArticleSourceId: signal.id,
      };
      const identity = articleIdentity(articleInput);
      const priority = articleReadPriority(articleInput);
      return {
        signal,
        articleInput,
        identity,
        ...priority,
        originalIndex: index,
      };
    })
    .filter((item) => item.identity.canonicalArticleId);
  const deduped: typeof queue = [];
  const duplicateResultsBySignal: Record<string, ArticleMemoryResult> = {};
  const seen = new Map<string, (typeof queue)[number]>();
  for (const item of queue) {
    const key = item.identity.canonicalArticleId;
    const prev = seen.get(key);
    if (prev) {
      duplicateResultsBySignal[item.signal.id] = {
        ...prev.identity,
        ...articleReadPriority(item.articleInput),
        hasArticleUrl: Boolean(item.identity.articleUrl),
        articleReadAttempted: false,
        articleInputMode: "title_snippet_only",
        articleMemoryRejectedReason: "duplicate_article_skipped_before_budget",
        duplicateArticleInRun: true,
        duplicateArticleSourceId: item.signal.id,
        duplicateArticleReuseReason:
          "same URL/title story cluster already queued before read budget",
      };
      continue;
    }
    seen.set(key, item);
    deduped.push(item);
  }
  const sorted = deduped.sort(
    (a, b) =>
      b.articleReadPriorityScore - a.articleReadPriorityScore ||
      a.originalIndex - b.originalIndex,
  );
  const hasMacro = sorted.some((item) => item.macroShockArticle);
  let totalReads = 0,
    macroReads = 0,
    normalReads = 0;
  const resultsBySignal: Record<string, ArticleMemoryResult> = {
    ...duplicateResultsBySignal,
  };
  const skipped: typeof sorted = [];
  for (const item of sorted) {
    const macro = item.macroShockArticle;
    const macroSlotsRemaining = hasMacro
      ? Math.max(0, macroShockReservedReads - macroReads)
      : 0;
    const normalLimit = hasMacro
      ? Math.min(
          normalCandidateReservedReads,
          Math.max(0, maxArticleReadsPerRun - macroShockReservedReads),
        )
      : maxArticleReadsPerRun;
    const allowed =
      totalReads < maxArticleReadsPerRun &&
      (macro ||
        !hasMacro ||
        normalReads < normalLimit ||
        macroSlotsRemaining === 0);
    if (!allowed) {
      skipped.push(item);
      resultsBySignal[item.signal.id] = {
        ...item.identity,
        articleReadPriorityScore: item.articleReadPriorityScore,
        articleReadPriorityReason: item.articleReadPriorityReason,
        macroShockArticle: macro,
        hasArticleUrl: Boolean(item.identity.articleUrl),
        articleReadAttempted: false,
        articleInputMode: "title_snippet_only",
        articleMemoryRejectedReason: "maxArticleReadsPerRun exceeded",
        errorCategory: "priority_read_budget_exceeded",
        errorMessageSafe: "maxArticleReadsPerRun exceeded",
      };
      continue;
    }
    const result = await readArticleForMemory(item.articleInput);
    if (result.articleReadAttempted === true) {
      totalReads += 1;
      if (macro) macroReads += 1;
      else normalReads += 1;
    }
    resultsBySignal[item.signal.id] = {
      ...result,
      articleReadPriorityScore: item.articleReadPriorityScore,
      articleReadPriorityReason: item.articleReadPriorityReason,
      macroShockArticle: macro,
    };
  }
  return {
    resultsBySignal,
    summary: {
      maxArticleReadsPerRun,
      macroShockReservedReads,
      normalCandidateReservedReads,
      articlesConsidered: queue.length,
      articlesReadCount: totalReads,
      articlesRead: totalReads,
      macroShockArticlesReadCount: macroReads,
      macroShockArticlesRead: macroReads,
      duplicatesSkipped: Object.keys(duplicateResultsBySignal).length,
      articlesSkippedDueToLimit: skipped.length,
      skippedDueToLimit: skipped.length,
      highestPrioritySkippedArticle: skipped[0]
        ? {
            title: skipped[0].signal.title,
            urlHash: skipped[0].identity.articleUrlHash,
            articleReadPriorityScore: skipped[0].articleReadPriorityScore,
            articleReadPriorityReason: skipped[0].articleReadPriorityReason,
          }
        : null,
      skippedReasons: skipped.length ? ["maxArticleReadsPerRun exceeded"] : [],
      nextBestFix: skipped.length
        ? "Keep Stage 1 bounded; raise maxArticles only for confirmed testing or add more cached article memory reuse."
        : "No priority-read limit skips in this run.",
      topReadArticles: sorted
        .filter(
          (item) =>
            resultsBySignal[item.signal.id]?.articleReadAttempted === true,
        )
        .slice(0, 10)
        .map((item) => ({
          title: item.signal.title,
          score: item.articleReadPriorityScore,
          reason: item.articleReadPriorityReason,
          macroShockArticle: item.macroShockArticle,
        })),
      topSkippedArticles: skipped
        .slice(0, 10)
        .map((item) => ({
          title: item.signal.title,
          score: item.articleReadPriorityScore,
          reason: item.articleReadPriorityReason,
          macroShockArticle: item.macroShockArticle,
        })),
    },
  };
}

export async function ensureArticleMemoryTable() {
  if (articleMemorySetupUnavailableReason)
    throw new Error(articleMemorySetupUnavailableReason);
  const statements = [
    `CREATE TABLE IF NOT EXISTS article_memory (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), article_url_hash text UNIQUE NOT NULL, normalized_url text NOT NULL)`,
    `ALTER TABLE article_memory ADD COLUMN IF NOT EXISTS source_name text`,
    `ALTER TABLE article_memory ADD COLUMN IF NOT EXISTS title text`,
    `ALTER TABLE article_memory ADD COLUMN IF NOT EXISTS title_hash text`,
    `ALTER TABLE article_memory ADD COLUMN IF NOT EXISTS ticker_symbols jsonb DEFAULT '[]'`,
    `ALTER TABLE article_memory ADD COLUMN IF NOT EXISTS company_names jsonb DEFAULT '[]'`,
    `ALTER TABLE article_memory ADD COLUMN IF NOT EXISTS article_text_available boolean DEFAULT false`,
    `ALTER TABLE article_memory ADD COLUMN IF NOT EXISTS article_text_read boolean DEFAULT false`,
    `ALTER TABLE article_memory ADD COLUMN IF NOT EXISTS article_text_read_at timestamptz`,
    `ALTER TABLE article_memory ADD COLUMN IF NOT EXISTS article_summary text`,
    `ALTER TABLE article_memory ADD COLUMN IF NOT EXISTS relevance_summary text`,
    `ALTER TABLE article_memory ADD COLUMN IF NOT EXISTS catalyst_summary text`,
    `ALTER TABLE article_memory ADD COLUMN IF NOT EXISTS proof_summary text`,
    `ALTER TABLE article_memory ADD COLUMN IF NOT EXISTS risk_summary text`,
    `ALTER TABLE article_memory ADD COLUMN IF NOT EXISTS entities_detected jsonb DEFAULT '[]'`,
    `ALTER TABLE article_memory ADD COLUMN IF NOT EXISTS topics_detected jsonb DEFAULT '[]'`,
    `ALTER TABLE article_memory ADD COLUMN IF NOT EXISTS article_relevance_score integer DEFAULT 0`,
    `ALTER TABLE article_memory ADD COLUMN IF NOT EXISTS article_quality_score integer DEFAULT 0`,
    `ALTER TABLE article_memory ADD COLUMN IF NOT EXISTS article_duplicate_of text`,
    `ALTER TABLE article_memory ADD COLUMN IF NOT EXISTS first_seen_at timestamptz DEFAULT now()`,
    `ALTER TABLE article_memory ADD COLUMN IF NOT EXISTS last_seen_at timestamptz DEFAULT now()`,
    `ALTER TABLE article_memory ADD COLUMN IF NOT EXISTS read_count integer DEFAULT 0`,
    `ALTER TABLE article_memory ADD COLUMN IF NOT EXISTS reused_count integer DEFAULT 0`,
    `ALTER TABLE article_memory ADD COLUMN IF NOT EXISTS raw_text_storage_ref text`,
    `ALTER TABLE article_memory ADD COLUMN IF NOT EXISTS error_category text`,
    `ALTER TABLE article_memory ADD COLUMN IF NOT EXISTS error_message_safe text`,
    `CREATE UNIQUE INDEX IF NOT EXISTS article_memory_url_hash_unique_idx ON article_memory(article_url_hash)`,
    `CREATE INDEX IF NOT EXISTS article_memory_seen_idx ON article_memory(last_seen_at DESC)`,
  ];
  try {
    for (const statement of statements)
      await prisma.$executeRawUnsafe(statement);
  } catch (e) {
    articleMemorySetupUnavailableReason = safeArticleMemoryError(e);
    throw new Error(articleMemorySetupUnavailableReason);
  }
}
async function findMemory(articleUrlHash: string) {
  await ensureArticleMemoryTable();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT * FROM article_memory WHERE article_url_hash=$1 LIMIT 1`,
    articleUrlHash,
  );
  return rows[0] ?? null;
}
async function upsertMemory(input: ArticleInput, r: Record<string, unknown>) {
  await ensureArticleMemoryTable();
  const id = articleIdentity(input);
  await prisma.$executeRawUnsafe(
    `INSERT INTO article_memory(article_url_hash,normalized_url,source_name,title,title_hash,ticker_symbols,company_names,article_text_available,article_text_read,article_text_read_at,article_summary,relevance_summary,catalyst_summary,proof_summary,risk_summary,entities_detected,topics_detected,article_relevance_score,article_quality_score,first_seen_at,last_seen_at,read_count,reused_count,error_category,error_message_safe) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,now(),$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17,$18,now(),now(),1,0,$19,$20) ON CONFLICT(article_url_hash) DO UPDATE SET last_seen_at=now(), source_name=EXCLUDED.source_name, title=EXCLUDED.title, article_summary=EXCLUDED.article_summary, relevance_summary=EXCLUDED.relevance_summary, catalyst_summary=EXCLUDED.catalyst_summary, proof_summary=EXCLUDED.proof_summary, risk_summary=EXCLUDED.risk_summary, article_text_available=EXCLUDED.article_text_available, article_text_read=EXCLUDED.article_text_read, read_count=article_memory.read_count+1, error_category=EXCLUDED.error_category, error_message_safe=EXCLUDED.error_message_safe`,
    id.articleUrlHash,
    id.normalizedArticleUrl,
    id.sourceName,
    text(input.title, 1000),
    id.titleHash,
    JSON.stringify(input.ticker ? [input.ticker] : []),
    JSON.stringify(input.company ? [input.company] : []),
    Boolean(r.articleTextAvailable),
    Boolean(r.articleReadAttempted),
    r.articleSummary ?? "",
    r.relevanceSummary ?? "",
    r.catalystSummary ?? "",
    r.proofSummary ?? "",
    r.riskSummary ?? "",
    JSON.stringify(r.entitiesDetected ?? []),
    JSON.stringify(r.topicsDetected ?? []),
    r.articleRelevanceScore ?? 0,
    r.articleQualityScore ?? 0,
    r.errorCategory ?? null,
    r.errorMessageSafe ?? null,
  );
  return findMemory(id.articleUrlHash);
}
export async function markMemoryReused(articleUrlHash: string) {
  await ensureArticleMemoryTable();
  await prisma.$executeRawUnsafe(
    `UPDATE article_memory SET reused_count=reused_count+1,last_seen_at=now() WHERE article_url_hash=$1`,
    articleUrlHash,
  );
}
function extractHtmlText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT);
}
async function fetchArticle(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MAX_FETCH_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent":
          "SwingUpArticleReader/1.0 (+internal research memory; no paywall bypass)",
      },
    });
    if (!res.ok)
      return {
        text: "",
        errorCategory: `http_${res.status}`,
        errorMessageSafe: `Article fetch returned HTTP ${res.status}`,
      };
    const ct = res.headers.get("content-type") || "";
    if (!/html|text|xml/.test(ct))
      return {
        text: "",
        errorCategory: "unsupported_content_type",
        errorMessageSafe: "Article content type is not readable text/html",
      };
    return { text: extractHtmlText(await res.text()) };
  } catch (e) {
    return {
      text: "",
      errorCategory: "fetch_failed",
      errorMessageSafe:
        e instanceof Error && e.name === "AbortError"
          ? "article_fetch_timeout"
          : "article_fetch_failed",
    };
  } finally {
    clearTimeout(timer);
  }
}
function deterministic(input: ArticleInput, fullText: string) {
  const base = [
    text(input.title, 300),
    text(input.snippet, 700),
    fullText.slice(0, 1800),
  ]
    .filter(Boolean)
    .join(" ");
  const lower = base.toLowerCase();
  const keywords = [
    "earnings",
    "guidance",
    "merger",
    "acquisition",
    "fda",
    "approval",
    "lawsuit",
    "sec",
    "contract",
    "partnership",
    "recall",
    "investigation",
    "tariff",
    "rates",
    "revenue",
    "profit",
    "forecast",
  ].filter((k) => lower.includes(k));
  const entities = [text(input.ticker, 20), text(input.company, 120)].filter(
    Boolean,
  );
  const score = Math.min(
    100,
    20 + (fullText ? 35 : 0) + keywords.length * 5 + (entities.length ? 15 : 0),
  );
  return {
    articleSummary: (
      base || "No article text was available; using title/snippet only."
    ).slice(0, MAX_SUMMARY),
    relevanceSummary: entities.length
      ? `Relevant because it mentions or is attached to ${entities.join(" / ")}.`
      : "Relevance is limited to the supplied headline, snippet, URL, and source metadata.",
    catalystSummary: keywords.length
      ? `Potential catalyst keywords detected: ${keywords.join(", ")}.`
      : "No strong deterministic catalyst keywords found.",
    proofSummary: fullText
      ? "Full article text was fetched and summarized deterministically; this can strengthen news proof but cannot create an alert alone."
      : "articleInputMode = title_snippet_only; full article text was unavailable, so proof support is limited.",
    riskSummary: /opinion|rumor|rumour|blog|analysis/.test(lower)
      ? "May be opinion or analysis; needs another clean proof type."
      : "No deterministic paywall bypass or private data used; still requires independent proof before promotion.",
    entitiesDetected: entities,
    topicsDetected: keywords,
    articleRelevanceScore: score,
    articleQualityScore: Math.min(
      100,
      (fullText.length > 1000 ? 60 : 30) + keywords.length * 4,
    ),
  };
}
export async function readArticleForMemory(
  input: ArticleInput,
): Promise<ArticleMemoryResult> {
  const base = emptyResult(input);
  if (!base.hasArticleUrl)
    return {
      ...base,
      errorCategory: "no_url",
      errorMessageSafe: "No article URL supplied",
    };
  let existing: Record<string, unknown> | null = null;
  try {
    existing = await findMemory(base.articleUrlHash);
  } catch (e) {
    return articleMemoryUnavailableResult(input, safeArticleMemoryError(e));
  }
  if (existing?.article_summary) {
    try {
      await markMemoryReused(base.articleUrlHash);
    } catch {
      /* memory reuse counters are non-blocking */
    }
    return {
      ...base,
      articleAlreadySeen: true,
      articleMemoryAvailable: true,
      articleMemoryUsed: true,
      reusedArticleMemoryId: String(existing.id),
      articleReadAttempted: false,
      articleTextAvailable: Boolean(existing.article_text_available),
      articleSummaryAvailable: true,
      articleInputMode: existing.article_text_available
        ? "memory_full_text_summary"
        : "memory_title_snippet_only",
      reusedArticleSummary: String(existing.article_summary ?? ""),
      reusedCatalystSummary: String(existing.catalyst_summary ?? ""),
      reusedRelevanceSummary: String(existing.relevance_summary ?? ""),
      reusedProofSummary: String(existing.proof_summary ?? ""),
      reusedRiskSummary: String(existing.risk_summary ?? ""),
      articleSummary: String(existing.article_summary ?? ""),
      catalystSummary: String(existing.catalyst_summary ?? ""),
      relevanceSummary: String(existing.relevance_summary ?? ""),
      proofSummary: String(existing.proof_summary ?? ""),
      riskSummary: String(existing.risk_summary ?? ""),
    };
  }
  const blocked =
    /bloomberg|wsj\.com|ft\.com|nytimes\.com\/subscription|seekingalpha/i.test(
      base.normalizedArticleUrl,
    );
  if (blocked)
    return {
      ...base,
      errorCategory: "blocked_or_paywalled",
      errorMessageSafe:
        "Source appears paywalled or blocked; no bypass attempted",
    };
  const fetched = await fetchArticle(base.normalizedArticleUrl);
  const fullText = fetched.text || "";
  const summaries = deterministic(input, fullText);
  const result = {
    ...base,
    ...summaries,
    articleReadAttempted: true,
    articleTextAvailable: fullText.length > 250,
    articleTextLength: fullText.length,
    articleTextStored: false,
    articleSummaryAvailable: true,
    articleInputMode:
      fullText.length > 250 ? "full_text" : "title_snippet_only",
    errorCategory: fetched.errorCategory ?? null,
    errorMessageSafe: fetched.errorMessageSafe ?? null,
    articleMemoryProofUsed: summaries.articleRelevanceScore >= 50,
    articleMemoryProofReason:
      summaries.articleRelevanceScore >= 50
        ? "Article summary matches ticker/company/topic and can strengthen news proof only."
        : null,
    articleMemoryRejectedReason:
      summaries.articleRelevanceScore >= 50
        ? null
        : "article_summary_not_relevant_enough",
  };
  let stored: Record<string, unknown> | null = null;
  try {
    stored = await upsertMemory(input, result);
  } catch (e) {
    return {
      ...result,
      articleReaderEnabled: false,
      articleMemorySetupFailed: true,
      articleMemoryUnavailableReason: safeArticleMemoryError(e),
      articleMemoryAvailable: false,
      errorCategory: "article_memory_setup_failed",
      errorMessageSafe: safeArticleMemoryError(e),
    };
  }
  return {
    ...result,
    articleTextStored: Boolean(stored),
    articleMemoryAvailable: Boolean(stored),
    articleReaderEnabled: true,
    articleMemorySetupFailed: false,
  };
}
export async function latestArticleSignals(limit: number) {
  return prisma.rawSignal.findMany({
    where: { sourceUrl: { not: null } },
    orderBy: [{ receivedAt: "desc" }],
    take: Math.max(1, Math.min(limit, 20)),
    select: {
      id: true,
      source: true,
      ticker: true,
      title: true,
      summary: true,
      sourceUrl: true,
      receivedAt: true,
      payload: true,
    },
  });
}
