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
  maximumConcurrentArticleReads: number;
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

const BLOCKED_HOSTS = new Set(["news.google.com", "www.alphavantage.co"]);
const SEC_HOSTS = new Set(["sec.gov", "www.sec.gov"]);
const MAX_ARTICLES = 12;
const MAX_BYTES = 300_000;
const MAX_SEC_DOCUMENT_BYTES = 800_000;
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
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…" };
  return value
    .replace(/&([a-z]+);/gi, (_, name: string) => named[name.toLowerCase()] ?? " ")
    .replace(/&#(\d+);/g, (_, item: string) => String.fromCodePoint(Number(item)))
    .replace(/&#x([0-9a-f]+);/gi, (_, item: string) => String.fromCodePoint(Number.parseInt(item, 16)));
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
    try { return text(jsonStrings(JSON.parse(raw) as unknown).join(" "), 25_000); } catch { return ""; }
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
  const paragraphs = [...article.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((match) => stripHtml(match[1])).filter((item) => item.length >= 35);
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
  const escapedTicker = ticker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tickerMatched = ticker.length >= 2 && new RegExp(`\\b${escapedTicker}\\b`, "i").test(body);
  const companyMatched = companyTokens.length > 0 && companyTokens.filter((token) => lowerBody.includes(token)).length >= Math.min(2, companyTokens.length);
  const issuerMatched = relationship !== "direct" || tickerMatched || companyMatched;
  const familyTerms = MATERIAL_TERMS[family] ?? [];
  const keywordHits = familyTerms.filter((term) => lowerBody.includes(term)).length;
  const overlap = meaningfulTokens(sourceText).filter((token) => lowerBody.includes(token)).length;
  const eventMatched = keywordHits >= 1 || overlap >= 3;
  const correction = /\b(?:denies?|denied|false|incorrect|no evidence|did not occur|not planning|hoax|withdrawn report)\b/i.test(body);
  return { issuerMatched, eventMatched, contradicted: correction && eventMatched };
}

function isSecFilingIndex(url: URL) {
  return SEC_HOSTS.has(url.hostname.toLowerCase())
    && /^\/Archives\/edgar\/data\//i.test(url.pathname)
    && /-index\.html?$/i.test(url.pathname);
}

function safeSecDocumentUrl(value: string, base: string) {
  try {
    const url = new URL(decodeEntities(value), base);
    if (url.protocol !== "https:" || !SEC_HOSTS.has(url.hostname.toLowerCase())) return null;
    if (!/^\/Archives\/edgar\/data\//i.test(url.pathname)) return null;
    if (!/\.(?:html?|txt)$/i.test(url.pathname) || /-index\.html?$/i.test(url.pathname)) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function secDocumentLinks(indexHtml: string, indexUrl: URL) {
  const rows = [...indexHtml.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].map((match) => match[0]);
  const candidates = rows.flatMap((row) => {
    const href = row.match(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/i)?.[1];
    if (!href) return [];
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) => stripHtml(match[1]));
    const sequence = cells[0] ?? "";
    const description = cells[1] ?? "";
    const type = (cells[3] ?? cells.at(-1) ?? "").toUpperCase();
    const url = safeSecDocumentUrl(href, indexUrl.toString());
    if (!url) return [];
    const earningsExhibit = /(?:EX[-_.]?99|99[-_.]?1|EXHIBIT\s+99|EARNINGS|PRESS RELEASE|FINANCIAL RESULTS)/i.test(`${type} ${description} ${url.pathname}`);
    const primary = sequence === "1" || /\b(?:8-K|6-K|10-Q|10-K)\b/i.test(type);
    if (!earningsExhibit && !primary) return [];
    return [{ url, score: (earningsExhibit ? 200 : 0) + (primary ? 100 : 0) + (sequence === "1" ? 20 : 0) }];
  });
  return [...new Map(candidates.sort((left, right) => right.score - left.score).map((item) => [item.url.toString(), item])).values()]
    .slice(0, 3)
    .map((item) => item.url);
}

async function fetchRawPage(url: URL, maximumBytes: number) {
  const response = await fetch(url, {
    redirect: "follow",
    cache: "no-store",
    headers: {
      accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.1",
      range: `bytes=0-${maximumBytes - 1}`,
      "user-agent": "Mozilla/5.0 (compatible; SwingUpEvidenceReader/1.0)",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`article_http_${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  const raw = (await response.text()).slice(0, maximumBytes);
  return { raw, contentType };
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
      range: `bytes=0-${(isSecFilingIndex(url) ? MAX_SEC_DOCUMENT_BYTES : MAX_BYTES) - 1}`,
      "user-agent": "Mozilla/5.0 (compatible; SwingUpEvidenceReader/1.0)",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`article_http_${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  const raw = (await response.text()).slice(0, isSecFilingIndex(url) ? MAX_SEC_DOCUMENT_BYTES : MAX_BYTES);

  let articleText = "";
  if (isSecFilingIndex(url)) {
    const documents = secDocumentLinks(raw, url);
    const contents = await mapWithConcurrency(documents, 3, async (documentUrl) => {
      try {
        const documentResponse = await fetchImpl(documentUrl, {
          redirect: "follow",
          cache: "no-store",
          headers: {
            accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
            range: `bytes=0-${MAX_SEC_DOCUMENT_BYTES - 1}`,
            "user-agent": "Mozilla/5.0 (compatible; SwingUpEvidenceReader/1.0)",
          },
          signal: AbortSignal.timeout(10_000),
        });
        if (!documentResponse.ok) return "";
        const documentType = documentResponse.headers.get("content-type") ?? "";
        const documentRaw = (await documentResponse.text()).slice(0, MAX_SEC_DOCUMENT_BYTES);
        return extractArticleText(documentRaw, documentType) || text(stripHtml(documentRaw), 25_000);
      } catch {
        return "";
      }
    });
    articleText = text(contents.filter(Boolean).join(" "), 25_000);
    if (articleText.length < MIN_ARTICLE_CHARS) articleText = extractArticleText(raw, contentType);
  } else {
    articleText = extractArticleText(raw, contentType);
  }

  if (!articleText) throw new Error("article_text_unavailable");
  const result = { fetchedAt: Date.now(), text: articleText, contentType };
  scanCache.set(cacheKey, result);
  if (scanCache.size > 200) scanCache = new Map([...scanCache.entries()].slice(-100));
  return result;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
) {
  const output = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from(
    { length: Math.min(concurrency, Math.max(1, items.length)) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        output[index] = await worker(items[index]);
      }
    },
  ));
  return output;
}

function structuredOfficialEvidence(candidateValue: unknown) {
  return receipts(candidateValue).filter((receipt) => receipt.primarySource && receipt.official && (receipt.summary?.length ?? 0) >= 600);
}

export async function buildArticleEvidenceReport(input: {
  candidates: unknown[];
  selectedCandidate?: unknown;
  fetchImpl?: typeof fetch;
  maximumArticles?: number;
}) {
  const fetchImpl = input.fetchImpl ?? fetch;
  // General scans still default to 12. A dedicated high-priority lane may request
  // up to 40 decision-relevant pages after cheap broad discovery has ranked them.
  const maximumArticles = Math.max(1, Math.min(input.maximumArticles ?? MAX_ARTICLES, 40));
  const orderedCandidates = [input.selectedCandidate, ...input.candidates].filter(Boolean);
  const uniqueCandidates = [...new Map(orderedCandidates.map((candidate) => [candidateKey(candidate), candidate])).values()].filter((candidate) => candidateKey(candidate).split("|")[0]);
  const reports = new Map<string, CandidateArticleEvidence>();
  const prepared = uniqueCandidates.map((candidate) => {
    const value = object(candidate);
    const key = candidateKey(candidate);
    const ticker = text(value.ticker).toUpperCase();
    const company = text(value.company) || ticker;
    const eventFamily = text(value.eventFamily) || "unknown";
    const relationship = text(value.relationship) || "direct";
    const structured = structuredOfficialEvidence(candidate);
    const candidateUrls = receipts(candidate)
      .filter((receipt) => safeHttpUrl(receipt.url))
      .sort((left, right) => Number(right.primarySource) - Number(left.primarySource) || Number(right.official) - Number(left.official))
      .slice(0, 2);
    return { candidate, key, ticker, company, eventFamily, relationship, structured, candidateUrls };
  });
  const selectedTasks: Array<{ key: string; candidate: unknown; receipt: ReturnType<typeof receipts>[number]; url: URL }> = [];
  for (const item of prepared) {
    for (const receipt of item.candidateUrls) {
      if (selectedTasks.length >= maximumArticles) break;
      const url = safeHttpUrl(receipt.url);
      if (url) selectedTasks.push({ key: item.key, candidate: item.candidate, receipt, url });
    }
  }
  const fetched = await mapWithConcurrency(selectedTasks, 4, async (task) => {
    try {
      const article = await fetchArticle(task.url, fetchImpl);
      return { ...task, article, error: null as string | null };
    } catch (error) {
      return { ...task, article: null, error: error instanceof Error ? error.message : "article_fetch_failed" };
    }
  });
  const fetchedByCandidate = new Map<string, typeof fetched>();
  for (const item of fetched) {
    const current = fetchedByCandidate.get(item.key) ?? [];
    current.push(item);
    fetchedByCandidate.set(item.key, current);
  }
  let urlsFetched = 0;
  let urlsSupported = 0;
  let urlsFailed = 0;

  for (const item of prepared) {
    const { candidate, key, ticker, company, eventFamily, relationship, structured } = item;
    const excerpts: CandidateArticleEvidence["excerpts"] = [];
    const failedUrls: string[] = [];
    const sourceUrls: string[] = [];
    let fetchedForCandidate = 0;
    for (const result of fetchedByCandidate.get(key) ?? []) {
      sourceUrls.push(result.url.toString());
      if (!result.article) {
        urlsFailed += 1;
        failedUrls.push(`${result.url.toString()}:${result.error}`);
        continue;
      }
      fetchedForCandidate += 1;
      urlsFetched += 1;
      const support = bodySupport(candidate, result.article.text);
      if (support.issuerMatched && support.eventMatched && !support.contradicted) {
        urlsSupported += 1;
        excerpts.push({ url: result.url.toString(), publisher: result.receipt.publisher, excerpt: result.article.text.slice(0, MAX_EXCERPT_CHARS), issuerMatched: support.issuerMatched, eventMatched: support.eventMatched });
      } else {
        failedUrls.push(`${result.url.toString()}:${support.contradicted ? "article_contradicts_event" : !support.issuerMatched ? "issuer_not_confirmed_in_article" : "event_not_confirmed_in_article"}`);
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
      fullArticlesRead: fetchedForCandidate,
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
    maximumConcurrentArticleReads: 4,
    maximumBytesPerArticle: MAX_BYTES,
    headlineAloneCanPromoteSeriousSignal: false as const,
    candidates: Object.fromEntries(reports),
    diagnostics: {
      candidatesConsidered: uniqueCandidates.length,
      urlsSelected: selectedTasks.length,
      urlsFetched,
      urlsSupported,
      urlsFailed,
      officialStructuredCandidates: prepared.filter((item) => item.structured.length > 0).length,
    },
  } satisfies ArticleEvidenceReport;
}

export function articleEvidenceForCandidate(report: ArticleEvidenceReport, candidate: unknown) {
  return report.candidates[candidateKey(candidate)] ?? null;
}
