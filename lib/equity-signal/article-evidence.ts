type Json = Record<string, unknown>;

type Receipt = {
  title: string;
  summary: string | null;
  url: string;
  publisher: string;
  primarySource: boolean;
  official: boolean;
};

export type CandidateArticleEvidence = {
  key: string;
  ticker: string;
  company: string;
  eventFamily: string;
  relationship: string;
  decisionGrade: boolean;
  basis: "full_article" | "official_structured_content" | "headline_only_blocked";
  fullArticlesRead: number;
  supportedArticles: number;
  officialStructuredReceipts: number;
  failedUrls: string[];
  sourceUrls: string[];
  excerpts: Array<{ url: string; publisher: string; excerpt: string; issuerMatched: boolean; eventMatched: boolean }>;
  blockers: string[];
};

export type ArticleEvidenceReport = {
  policyVersion: 1;
  maximumFullArticlesPerScan: number;
  maximumBytesPerArticle: number;
  headlineAloneCanPromoteSeriousSignal: false;
  candidates: Record<string, CandidateArticleEvidence>;
  diagnostics: {
    candidatesConsidered: number;
    urlsSelected: number;
    urlsFetched: number;
    urlsSupported: number;
    urlsFailed: number;
    officialStructuredCandidates: number;
  };
};

const MATERIAL_TERMS: Record<string, string[]> = {
  earnings_guidance: ["guidance", "revenue", "earnings", "margin", "profit", "cash flow", "outlook"],
  financing_dilution: ["offering", "dilution", "shares", "convertible", "warrant", "financing", "bankruptcy"],
  regulatory_approval: ["approval", "approved", "clearance", "authorized", "phase 3", "phase iii"],
  regulatory_enforcement: ["enforcement", "charges", "investigation", "subpoena", "recall", "clinical hold", "rejected"],
  cyber_incident: ["cyberattack", "ransomware", "data breach", "outage", "security incident", "network intrusion"],
  merger_acquisition: ["merger", "acquisition", "transaction", "financing", "terminated", "blocked"],
  leadership_change: ["chief executive", "ceo", "chief financial officer", "cfo", "resigned", "board"],
  supply_chain: ["supplier", "customer", "contract", "production", "shipment", "supply chain"],
  geopolitical_conflict: ["conflict", "strike", "war", "shipping", "sanctions", "route"],
  sanctions_trade: ["sanctions", "tariff", "export controls", "trade restriction", "import ban"],
  trading_halt: ["trading halt", "trading suspension", "resumption", "halted"],
};

const BLOCKED_HOSTS = new Set([
  "news.google.com",
  "www.alphavantage.co",
]);

const MAX_ARTICLES = 12;
const MAX_BYTES = 300_000;
const MIN_ARTICLE_CHARS = 450;
const MAX_EXCERPT_CHARS = 1_200;
let scanCache = new Map<string, { fetchedAt: number; text: string; contentType: string }>();

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function text(value: unknown, maximum = 30_000) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maximum) : "";
}

function candidateKey(value: unknown) {
  const candidate = object(value);
  return [text(candidate.ticker).toUpperCase(), text(candidate.eventFamily), text(candidate.eventObservedAt)].join("|");
}

export function articleEvidenceKey(value: unknown) {
  return candidateKey(value);
}

function receipts(value: unknown): Receipt[] {
  const candidate = object(value);
  return (Array.isArray(candidate.receipts) ? candidate.receipts : []).flatMap((raw): Receipt[] => {
    const receipt = object(raw);
    const url = text(receipt.url, 2_000);
    const title = text(receipt.title, 500);
    if (!url || !title) return [];
    return [{
      title,
      summary: text(receipt.summary, 30_000) || null,
      url,
      publisher: text(receipt.publisher, 300) || "Unknown publisher",
      primarySource: receipt.primarySource === true,
      official: receipt.official === true,
    }];
  });
}

function safeHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    if (BLOCKED_HOSTS.has(parsed.hostname.toLowerCase())) return null;
    return parsed;
  } catch {
    return null;
  }
}

function decodeEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
  };
  return value
    .replace(/&([a-z]+);/gi, (_, name: string) => named[name.toLowerCase()] ?? " ")
    .replace(/&#(\d+);/g, (_, value: string) => String.fromCodePoint(Number(value)))
    .replace(/&#x([0-9a-f]+);/gi, (_, value: string) => String.fromCodePoint(Number.parseInt(value, 16)));
}

function stripHtml(value: string) {
  return decodeEntities(value
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|nav|header|footer|form|aside)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function jsonStrings(value: unknown, depth = 0): string[] {
  if (depth > 5) return [];
  if (typeof value === "string") return value.length >= 80 ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((item) => jsonStrings(item, depth + 1));
  if (!value || typeof value !== "object") return [];
  const record = value as Json;
  const preferred = ["articleBody", "body", "content", "description", "abstract", "summary", "text"];
  const preferredStrings = preferred.flatMap((key) => key in record ? jsonStrings(record[key], depth + 1) : []);
  return preferredStrings.length ? preferredStrings : Object.values(record).flatMap((item) => jsonStrings(item, depth + 1));
}

function extractArticleText(raw: string, contentType: string) {
  if (/json/i.test(contentType) || /^[\s\r\n]*[\[{]/.test(raw)) {
    try {
      return text(jsonStrings(JSON.parse(raw) as unknown).join(" "), 25_000);
    } catch {
      return "";
    }
  }
  const jsonLdBodies = [...raw.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .flatMap((match) => {
      try { return jsonStrings(JSON.parse(match[1]) as unknown); } catch { return []; }
    });
  if (jsonLdBodies.length) {
    const parsed = text(jsonLdBodies.join(" "), 25_000);
    if (parsed.length >= MIN_ARTICLE_CHARS) return parsed;
  }
  const article = raw.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1]
    ?? raw.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1]
    ?? raw;
  const paragraphs = [...article.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((match) => stripHtml(match[1])).filter((value) => value.length >= 35);
  const parsed = text(paragraphs.length >= 3 ? paragraphs.join(" ") : stripHtml(article), 25_000);
  return parsed.length >= MIN_ARTICLE_CHARS ? parsed : "";
}

function normalized(value: string) {
  return value.toLowerCase().replace(/\b(?:incorporated|inc|corporation|corp|company|co|limited|ltd|plc|holdings?|group|class [a-z])\b/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function meaningfulTokens(value: string) {
  const stop = new Set(["about", "after", "also", "announces", "company", "from", "have", "into", "more", "that", "their", "this", "with", "will"]);
  return [...new Set(normalized(value).split(" ").filter((token) => token.length >= 4 && !stop.has(token)))];
}

function bodySupport(candidateValue: unknown, body: string) {
  const candidate = object(candidateValue);
  const ticker = text(candidate.ticker).toLowerCase();
  const company = normalized(text(candidate.company));
  const relationship = text(candidate.relationship);
  const family = text(candidate.eventFamily);
  const sourceText = [candidate.eventHeadline, candidate.whatHappened, ...(Array.isArray(candidate.causalChain) ? candidate.causalChain : [])].map((item) => text(item)).join(" ");
  const lowerBody = body.toLowerCase();
  const companyTokens = meaningfulTokens(company).slice(0, 3);
  const tickerMatched = ticker.length >= 2 && new RegExp(`\\b${ticker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(body);
  const companyMatched = companyTokens.length > 0 && companyTokens.filter((token) => lowerBody.includes(token)).length >= Math.min(2, companyTokens.length);
  const issuerMatched = relationship !== "direct" || tickerMatched || companyMatched;
  const familyTerms = MATERIAL_TERMS[family] ?? [];
  const keywordHits = familyTerms.filter((term) => lowerBody.includes(term)).length;
  const overlap = meaningfulTokens(sourceText).filter((token) => lowerBody.includes(token)).length;
  const eventMatched = keywordHits >= 1 || overlap >= 3;
  const correction = /\b(?:denies?|denied|false|incorrect|no evidence|did not occur|not planning|hoax|withdrawn report)\b/i.test(body);
  return { issuerMatched, eventMatched, contradicted: correction && eventMatched };
}

async function fetchArticle(url: URL, fetchImpl: typeof fetch) {
  const cacheKey = url.toString();
  const cached = scanCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < 6 * 60 * 60 * 1000) return cached;
  const response = await fetchImpl(url, {
    redirect: "follow",
    cache: "no-store",
    headers: {
      accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.1",
      range: `bytes=0-${MAX_BYTES - 1}`,
      "user-agent": "Mozilla/5.0 (compatible; SwingUpEvidenceReader/1.0)",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`article_http_${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  const raw = (await response.text()).slice(0, MAX_BYTES);
  const articleText = extractArticleText(raw, contentType);
  if (!articleText) throw new Error("article_text_unavailable");
  const value = { fetchedAt: Date.now(), text: articleText, contentType };
  scanCache.set(cacheKey, value);
  if (scanCache.size > 200) scanCache = new Map([...scanCache.entries()].slice(-100));
  return value;
}

function structuredOfficialEvidence(candidateValue: unknown) {
  return receipts(candidateValue).filter((receipt) => receipt.primarySource && receipt.official && (receipt.summary?.length ?? 0) >= 600);
}

export async function buildArticleEvidenceReport(input: {
  candidates: unknown[];
  selectedCandidate?: unknown;
  fetchImpl?: typeof fetch;
  maximumArticles?: number;
+}) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const maximumArticles = Math.max(1, Math.min(input.maximumArticles ?? MAX_ARTICLES, 20));
  const orderedCandidates = [input.selectedCandidate, ...input.candidates].filter(Boolean);
  const uniqueCandidates = [...new Map(orderedCandidates.map((candidate) => [candidateKey(candidate), candidate])).values()].filter((candidate) => candidateKey(candidate).split("|")[0]);
  const reports = new Map<string, CandidateArticleEvidence>();
  let budget = maximumArticles;
  let urlsSelected = 0;
  let urlsFetched = 0;
  let urlsSupported = 0;
  let urlsFailed = 0;
  let officialStructuredCandidates = 0;

  for (const candidate of uniqueCandidates) {
    const value = object(candidate);
    const key = candidateKey(candidate);
    const ticker = text(value.ticker).toUpperCase();
    const company = text(value.company) || ticker;
    const eventFamily = text(value.eventFamily) || "unknown";
    const relationship = text(value.relationship) || "direct";
    const structured = structuredOfficialEvidence(candidate);
    if (structured.length) officialStructuredCandidates += 1;
    const candidatesUrls = receipts(candidate)
      .filter((receipt) => safeHttpUrl(receipt.url))
      .sort((left, right) => Number(right.primarySource) - Number(left.primarySource) || Number(right.official) - Number(left.official))
      .slice(0, 2);
    const excerpts: CandidateArticleEvidence["excerpts"] = [];
    const failedUrls: string[] = [];
    const sourceUrls: string[] = [];
    for (const receipt of candidatesUrls) {
      if (budget <= 0) break;
      const url = safeHttpUrl(receipt.url);
      if (!url) continue;
      budget -= 1;
      urlsSelected += 1;
      sourceUrls.push(url.toString());
      try {
        const article = await fetchArticle(url, fetchImpl);
        urlsFetched += 1;
        const support = bodySupport(candidate, article.text);
        if (support.issuerMatched && support.eventMatched && !support.contradicted) {
          urlsSupported += 1;
          excerpts.push({ url: url.toString(), publisher: receipt.publisher, excerpt: article.text.slice(0, MAX_EXCERPT_CHARS), issuerMatched: support.issuerMatched, eventMatched: support.eventMatched });
        } else {
          failedUrls.push(`${url.toString()}:${support.contradicted ? "article_contradicts_event" : !support.issuerMatched ? "issuer_not_confirmed_in_article" : "event_not_confirmed_in_article"}`);
        }
      } catch (error) {
        urlsFailed += 1;
        failedUrls.push(`${url.toString()}:${error instanceof Error ? error.message : "article_fetch_failed"}`);
      }
    }
    const fullArticleSupported = excerpts.length > 0;
    const structuredSupported = structured.length > 0;
    const decisionGrade = fullArticleSupported || structuredSupported;
    reports.set(key, {
      key,
      ticker,
      company,
      eventFamily,
      relationship,
      decisionGrade,
      basis: fullArticleSupported ? "full_article" : structuredSupported ? "official_structured_content" : "headline_only_blocked",
      fullArticlesRead: candidatesUrls.length - failedUrls.length,
      supportedArticles: excerpts.length,
      officialStructuredReceipts: structured.length,
      failedUrls,
      sourceUrls: [...new Set([...sourceUrls, ...structured.map((receipt) => receipt.url)])],
      excerpts,
      blockers: decisionGrade ? [] : ["The headline or short feed summary was not enough. No full article or sufficiently detailed official source confirmed the event."],
    });
  }

  return {
    policyVersion: 1 as const,
    maximumFullArticlesPerScan: maximumArticles,
    maximumBytesPerArticle: MAX_BYTES,
    headlineAloneCanPromoteSeriousSignal: false as const,
    candidates: Object.fromEntries(reports),
    diagnostics: {
      candidatesConsidered: uniqueCandidates.length,
      urlsSelected,
      urlsFetched,
      urlsSupported,
      urlsFailed,
      officialStructuredCandidates,
    },
  } satisfies ArticleEvidenceReport;
}

export function articleEvidenceForCandidate(report: ArticleEvidenceReport, candidate: unknown) {
  return report.candidates[candidateKey(candidate)] ?? null;
}
