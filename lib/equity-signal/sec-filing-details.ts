import type { EventReceipt } from "@/lib/equity-signal/types";

const SEC_USER_AGENT = "SwingUp/1.0 support@swingup.app";
const SEC_HOSTS = new Set(["sec.gov", "www.sec.gov"]);
const SUPPORTED_FORMS = new Set(["8-K", "6-K", "424B5", "424B3", "10-Q", "10-K"]);
const FORM_ROTATION = ["424B5", "8-K", "6-K", "424B3", "10-Q", "10-K"] as const;
const FORM_PRIORITY = new Map<string, number>(FORM_ROTATION.map((form, index) => [form, index]));
const FRESH_PRIORITY_FORMS = new Set(["424B5", "8-K", "6-K", "424B3"]);
const MAX_NEW_FILINGS_PER_RUN = 2;
const MAX_RECEIPT_AGE_MS = 48 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const STARVATION_AGE_MS = 15 * 60 * 1000;
const FRESH_PRIORITY_AGE_MS = 15 * 60 * 1000;
const SUCCESS_CACHE_TTL_MS = MAX_RECEIPT_AGE_MS;
const FAILURE_COOLDOWN_MS = 60 * 60 * 1000;
const MAX_SUCCESS_CACHE_ENTRIES = 300;
const MAX_FAILURE_COOLDOWN_ENTRIES = 300;
const MAX_ELIGIBLE_QUEUE_ENTRIES = 1_000;
const MAX_CACHED_DETAILS_REPLAY_PER_RUN = 24;
const PARTIAL_RETRY_DELAY_MS = 60 * 60 * 1000;
const BUDGET_RETRY_FALLBACK_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 5_000_000;

export const SEC_FILING_TEXT_MAX_CHARS = 80_000;
export const SEC_FILING_ANALYSIS_TEXT_MAX_CHARS = 12_000;
export const SEC_FILING_DETAIL_GRANT_CONTEXT = Symbol("swing_up_sec_filing_detail_grant");

export type SecFilingDetailAccessRequest = {
  filingKey: string;
  indexUrl: string;
  maximumRequests: 3;
};

export type SecFilingDetailAccessDecision = {
  allowed: boolean;
  nextRetryAt: string | null;
  reason: "reserved" | "cadence_guard" | "rolling_quota_guard";
};

export type ReserveSecFilingDetailAccessions = (
  requests: SecFilingDetailAccessRequest[],
) => Promise<SecFilingDetailAccessDecision[]>;

type SkipReason = "non_sec" | "scheduled" | "unsupported_form" | "invalid_date" | "stale" | "invalid_url" | "duplicate_accession" | "cached" | "failure_cooldown" | "retry_not_due" | "run_limit";
type DetailFailure = "index_http_error" | "index_payload_too_large" | "index_request_failed" | "primary_document_not_found" | "document_http_error" | "document_payload_too_large" | "document_request_failed" | "document_text_empty" | "event_exhibit_not_found" | "exhibit_http_error" | "exhibit_payload_too_large" | "exhibit_request_failed" | "exhibit_text_empty" | "provider_budget_not_due";

export type SecFilingDetail = {
  receipt: EventReceipt;
  form: string;
  indexUrl: string;
  primaryDocumentUrl: string;
  exhibitDocumentUrl: string | null;
  exhibitDocumentType: "EX-99.1" | "EX-99.2" | null;
  eventExhibitMissing: boolean;
  documentsFetched: 1 | 2;
  text: string;
  textLength: number;
  truncated: boolean;
  fetchedAt: string;
};

export type SecFilingDetailDiagnostic = {
  receiptId: string;
  form: string;
  indexUrl: string;
  status: "enriched" | "partial" | "cached" | "not_due" | "failed";
  primaryDocumentUrl: string | null;
  exhibitDocumentUrl: string | null;
  exhibitDocumentType: "EX-99.1" | "EX-99.2" | null;
  eventExhibitMissing: boolean;
  documentsFetched: number;
  textLength: number;
  truncated: boolean;
  errorCategory: DetailFailure | null;
};

export type SecFilingDetailsResult = {
  provider: {
    provider: "sec_filing_details";
    status: "connected" | "partial" | "failed" | "not_due";
    checkedAt: string;
    nextRetryAt: string | null;
    sourceUrls: string[];
    recordsRead: number;
    error: "selected_filings_failed" | "some_selected_filings_incomplete" | null;
    entitlementVerified: boolean;
    cached: boolean;
  };
  details: SecFilingDetail[];
  diagnostics: {
    received: number;
    currentEligible: number;
    eligible: number;
    carriedForwardEligible: number;
    selected: number;
    enriched: number;
    newlyFetched: number;
    reusedFromCache: number;
    cachedReplayOmitted: number;
    incomplete: number;
    deferred: number;
    failed: number;
    selectedReceiptIds: string[];
    cachedReceiptIds: string[];
    deferredReceiptIds: string[];
    retryDeferredReceiptIds: string[];
    failureCooldownReceiptIds: string[];
    queuedReceiptIds: string[];
    backlog: {
      count: number;
      byForm: Record<string, number>;
      oldestPublishedAt: string | null;
      oldestAgeMinutes: number | null;
      failureCooldownCount: number;
      retryDeferredCount: number;
    };
    skipped: Record<SkipReason, number>;
    items: SecFilingDetailDiagnostic[];
  };
  policy: {
    maximumFilingsPerRun: number;
    maximumNewFilingsPerRun: number;
    maximumReceiptAgeHours: number;
    successfulDetailCacheHours: number;
    failedReceiptCooldownMinutes: number;
    priorityOrder: string[];
    fairFormRotation: true;
    freshTimeSensitiveSlot: true;
    freshPriorityForms: string[];
    freshPriorityWindowMinutes: number;
    maximumQueuedFilings: number;
    maximumCachedReplayPerRun: number;
    starvationAgeMinutes: number;
    partialRetryMinutes: number;
    budgetRetryFallbackMinutes: number;
    serializedRequests: true;
    maximumRequestsPerNewAccession: 3;
    cachedReplayBehavior: "restores_one_accession_receipt_without_duplicate_evidence";
    maximumTextCharacters: number;
    factualContentOnly: true;
    directionInferencePerformed: false;
    databaseWrites: false;
    publishing: false;
    notifications: false;
  };
};

type EligibleReceipt = { receipt: EventReceipt; form: string; publishedAtMs: number; indexUrl: string; filingKey: string };
type SuccessfulDetailCacheEntry = { detail: SecFilingDetail; expiresAtMs: number; retryAfterMs: number | null };
type FailedDetailCooldownEntry = { errorCategory: DetailFailure; retryAfterMs: number };

const successfulDetailCache = new Map<string, SuccessfulDetailCacheEntry>();
const failedDetailCooldowns = new Map<string, FailedDetailCooldownEntry>();
const deferredDetailRetries = new Map<string, number>();
const eligibleReceiptQueue = new Map<string, EligibleReceipt>();
let nextFormRotationIndex = 0;

class FilingDetailError extends Error {
  constructor(public readonly category: DetailFailure, public readonly retryAfterMs: number | null = null) {
    super(category);
    this.name = "FilingDetailError";
  }
}

function cloneReceipt(receipt: EventReceipt): EventReceipt {
  return { ...receipt, symbolHints: [...receipt.symbolHints], companyHints: [...receipt.companyHints] };
}

function normalizedForm(value: string | null) {
  return (value ?? "").trim().toUpperCase();
}

function decodeHtml(value: string) {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
  return value.replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z]+);/gi, (entity, code: string) => {
    if (code.startsWith("#")) {
      const hexadecimal = code[1]?.toLowerCase() === "x";
      const point = Number.parseInt(code.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : " ";
    }
    return named[code.toLowerCase()] ?? " ";
  });
}

function plainText(html: string) {
  return decodeHtml(html
    .replace(/<!--[^]*?-->/g, " ")
    .replace(/<(?:script|style|noscript|template|svg|math)\b[^>]*>[^]*?<\/(?:script|style|noscript|template|svg|math)>/gi, " ")
    .replace(/<(?:br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/(?:p|div|section|article|header|footer|h[1-6]|li|tr|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function safeSecUrl(value: string, base?: string) {
  try {
    const url = new URL(value, base);
    if (url.protocol !== "https:" || !SEC_HOSTS.has(url.hostname.toLowerCase())) return null;
    if (!/^\/Archives\/edgar\/data\//i.test(url.pathname)) return null;
    // Use one metered transport host for every accepted archive URL. Bare
    // sec.gov links are valid public links, but sending them unchanged would
    // bypass the branch wrapper's archive-detail quota rule.
    url.hostname = "www.sec.gov";
    url.search = "";
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function filingKey(indexUrl: string) {
  const url = new URL(indexUrl);
  const pathname = url.pathname.toLowerCase();
  const accession = pathname.match(/^\/archives\/edgar\/data\/\d+\/([^/]+)\/[^/]+-index\.html?$/)?.[1]
    ?? pathname.match(/^\/archives\/edgar\/data\/\d+\/([^/]+)-index\.html?$/)?.[1];
  return accession
    ? `accession:${accession.replace(/-/g, "")}`
    : url.pathname.toLowerCase();
}

function compareEligible(left: EligibleReceipt, right: EligibleReceipt) {
  return (FORM_PRIORITY.get(left.form) ?? Number.MAX_SAFE_INTEGER) - (FORM_PRIORITY.get(right.form) ?? Number.MAX_SAFE_INTEGER)
    || right.publishedAtMs - left.publishedAtMs
    || left.receipt.id.localeCompare(right.receipt.id);
}

function compareByRecency(left: EligibleReceipt, right: EligibleReceipt) {
  return right.publishedAtMs - left.publishedAtMs
    || (FORM_PRIORITY.get(left.form) ?? Number.MAX_SAFE_INTEGER) - (FORM_PRIORITY.get(right.form) ?? Number.MAX_SAFE_INTEGER)
    || left.receipt.id.localeCompare(right.receipt.id);
}

function boundEligibleQueue(items: EligibleReceipt[]) {
  if (items.length <= MAX_ELIGIBLE_QUEUE_ENTRIES) return [...items].sort(compareEligible);
  const reservedPerForm = Math.floor(MAX_ELIGIBLE_QUEUE_ENTRIES / FORM_ROTATION.length);
  const retained: EligibleReceipt[] = [];
  const overflow: EligibleReceipt[] = [];
  for (const form of FORM_ROTATION) {
    const formItems = items.filter((item) => item.form === form).sort(compareByRecency);
    retained.push(...formItems.slice(0, reservedPerForm));
    overflow.push(...formItems.slice(reservedPerForm));
  }
  retained.push(...overflow.sort(compareByRecency).slice(0, MAX_ELIGIBLE_QUEUE_ENTRIES - retained.length));
  return retained.sort(compareEligible);
}

function compareWithinForm(left: EligibleReceipt, right: EligibleReceipt, nowMs: number) {
  const leftAged = nowMs - left.publishedAtMs >= STARVATION_AGE_MS;
  const rightAged = nowMs - right.publishedAtMs >= STARVATION_AGE_MS;
  if (leftAged !== rightAged) return leftAged ? -1 : 1;
  if (leftAged && rightAged) {
    return left.publishedAtMs - right.publishedAtMs
      || left.receipt.id.localeCompare(right.receipt.id);
  }
  return compareByRecency(left, right);
}

function selectNextCandidate(candidates: EligibleReceipt[], nowMs: number) {
  if (!candidates.length) return null;
  for (let offset = 0; offset < FORM_ROTATION.length; offset += 1) {
    const formIndex = (nextFormRotationIndex + offset) % FORM_ROTATION.length;
    const form = FORM_ROTATION[formIndex];
    const candidate = candidates.filter((item) => item.form === form).sort((left, right) => compareWithinForm(left, right, nowMs))[0];
    if (!candidate) continue;
    nextFormRotationIndex = (formIndex + 1) % FORM_ROTATION.length;
    return candidate;
  }
  return [...candidates].sort((left, right) => compareWithinForm(left, right, nowMs))[0] ?? null;
}

function selectNextCandidates(candidates: EligibleReceipt[], nowMs: number) {
  const remaining = [...candidates];
  const selected: EligibleReceipt[] = [];
  // Reserve one slot for a newly published, time-sensitive filing before
  // draining the aged fairness queue. Without this lane, a continuous backlog
  // of old 8-K or 6-K rows can delay a just-filed market-moving event for hours.
  const fresh = remaining
    .filter((item) => FRESH_PRIORITY_FORMS.has(item.form)
      && nowMs - item.publishedAtMs >= -MAX_FUTURE_SKEW_MS
      && nowMs - item.publishedAtMs < FRESH_PRIORITY_AGE_MS)
    .sort(compareByRecency)[0] ?? null;
  if (fresh) {
    selected.push(fresh);
    remaining.splice(remaining.findIndex((item) => item.filingKey === fresh.filingKey), 1);
  }
  while (selected.length < MAX_NEW_FILINGS_PER_RUN && remaining.length) {
    const candidate = selectNextCandidate(remaining, nowMs);
    if (!candidate) break;
    selected.push(candidate);
    remaining.splice(remaining.findIndex((item) => item.filingKey === candidate.filingKey), 1);
  }
  return selected;
}

function resolvePrimaryDocumentHref(value: string, indexUrl: string) {
  try {
    const linked = new URL(decodeHtml(value), indexUrl);
    if (linked.protocol !== "https:" || !SEC_HOSTS.has(linked.hostname.toLowerCase())) return null;
    if (["/ixviewer/doc/action", "/ix"].includes(linked.pathname.toLowerCase())) {
      return safeSecUrl(linked.searchParams.get("doc") ?? "", "https://www.sec.gov");
    }
    return safeSecUrl(linked.toString());
  } catch {
    return null;
  }
}

type FilingDocument = {
  url: string;
  sequence: string;
  description: string;
  documentType: string;
};

function filingDocuments(indexHtml: string, indexUrl: string) {
  const rows = [...indexHtml.matchAll(/<tr\b[^>]*>[^]*?<\/tr>/gi)].map((match) => match[0]);
  return rows.flatMap((row): FilingDocument[] => {
    const href = row.match(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/i)?.[1];
    if (!href) return [];
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([^]*?)<\/t[dh]>/gi)].map((match) => plainText(match[1]));
    const sequence = cells[0] ?? "";
    const description = cells[1] ?? "";
    const documentType = normalizedForm(cells[3] ?? cells.at(-1) ?? "");
    const resolved = resolvePrimaryDocumentHref(href, indexUrl);
    if (!resolved || !/\.(?:html?|txt)$/i.test(resolved.pathname) || /-index\.html?$/i.test(resolved.pathname)) return [];
    return [{ url: resolved.toString(), sequence, description, documentType }];
  });
}

function primaryDocumentUrl(documents: FilingDocument[], form: string) {
  return documents
    .flatMap((document) => {
      const exactType = document.documentType === form;
      const descriptiveMatch = normalizedForm(document.description).includes(form);
      if (!exactType && !(document.sequence === "1" && descriptiveMatch)) return [];
      const score = (exactType ? 100 : 0) + (document.sequence === "1" ? 20 : 0) + (/form|report|prospectus/i.test(document.description) ? 5 : 0);
      return [{ ...document, score }];
    })
    .sort((left, right) => right.score - left.score || left.url.localeCompare(right.url))[0]?.url ?? null;
}

function referencedEventExhibitType(text: string) {
  const matches = [...text.matchAll(/\bexhibit\s+99\.([12])\b/gi)];
  const contextual = matches.find((match) => {
    const index = match.index ?? 0;
    const nearby = text.slice(Math.max(0, index - 180), Math.min(text.length, index + match[0].length + 180));
    return /incorporat(?:e|ed|es|ing)\s+by\s+reference|furnish(?:ed|es|ing)?|attach(?:ed|es|ing)?/i.test(nearby);
  }) ?? matches[0];
  return contextual ? `EX-99.${contextual[1]}` as "EX-99.1" | "EX-99.2" : null;
}

function eventExhibit(documents: FilingDocument[], preferredType: "EX-99.1" | "EX-99.2" | null) {
  return documents
    .flatMap((document) => {
      const normalizedType = normalizedForm(document.documentType || document.description).replace(/\s+/g, "");
      const match = normalizedType.match(/^(?:EX-?)?99\.([12])$/);
      if (!match) return [];
      const documentType = `EX-99.${match[1]}` as "EX-99.1" | "EX-99.2";
      if (preferredType && documentType !== preferredType) return [];
      return [{ ...document, documentType, priority: match[1] === "1" ? 0 : 1 }];
    })
    .sort((left, right) => left.priority - right.priority
      || (Number.parseInt(left.sequence, 10) || Number.MAX_SAFE_INTEGER) - (Number.parseInt(right.sequence, 10) || Number.MAX_SAFE_INTEGER)
      || left.url.localeCompare(right.url))[0] ?? null;
}

function primaryNeedsEventExhibit(form: string, text: string) {
  if (form !== "8-K" && form !== "6-K") return false;
  const merelyReferencesExhibit = /(?:incorporat(?:e|ed|es|ing)\s+by\s+reference|furnish(?:ed|es|ing)?|attach(?:ed|es|ing)?)\b[\s\S]{0,180}\bexhibit\s+99\.[12]\b/i.test(text)
    || /\bexhibit\s+99\.[12]\b[\s\S]{0,180}(?:incorporat(?:e|ed|es|ing)\s+by\s+reference|furnish(?:ed|es|ing)?|attach(?:ed|es|ing)?)/i.test(text);
  const containsSubstantiveEventFact = /\b(?:entered into|completed|acquired|disposed|terminated|appointed|resigned|departure of|results of operations|financial condition|material definitive agreement|bankruptcy|delisting|regulation fd disclosure|public offering|priced at|guidance|revenue|earnings)\b/i.test(text);
  return merelyReferencesExhibit || (text.length < 1_200 && !containsSubstantiveEventFact);
}

function composeFilingText(primaryText: string, exhibitText: string | null, exhibitType: "EX-99.1" | "EX-99.2" | null) {
  if (!exhibitText || !exhibitType) {
    return {
      text: primaryText.slice(0, SEC_FILING_TEXT_MAX_CHARS),
      truncated: primaryText.length > SEC_FILING_TEXT_MAX_CHARS,
    };
  }
  // Event exhibits contain the time-sensitive facts the scanner is trying to
  // recover. Put the exhibit first so the separate 12k classifier window can
  // never be consumed by a long 8-K shell or inline-XBRL boilerplate.
  const exhibitHeader = `Official SEC ${exhibitType} event exhibit:\n`;
  const primaryHeader = "\n\nPrimary SEC filing context:\n";
  const exhibitBudget = 60_000;
  const exhibitSection = `${exhibitHeader}${exhibitText.slice(0, exhibitBudget)}`;
  const primaryBudget = Math.max(0, SEC_FILING_TEXT_MAX_CHARS - exhibitSection.length - primaryHeader.length);
  const text = `${exhibitSection}${primaryHeader}${primaryText.slice(0, primaryBudget)}`.slice(0, SEC_FILING_TEXT_MAX_CHARS);
  return {
    text,
    truncated: exhibitText.length > exhibitBudget || primaryText.length > primaryBudget,
  };
}

async function boundedResponseText(response: Response, category: DetailFailure) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) throw new FilingDetailError(category);
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new FilingDetailError(category);
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let output = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new FilingDetailError(category);
    }
    output += decoder.decode(chunk.value, { stream: true });
  }
  return output + decoder.decode();
}

async function fetchSecText(
  fetchImpl: typeof fetch,
  url: string,
  accept: string,
  stage: "index" | "document" | "exhibit",
  grantKey?: string,
) {
  const requestFailure = stage === "index" ? "index_request_failed" : stage === "document" ? "document_request_failed" : "exhibit_request_failed";
  const httpFailure = stage === "index" ? "index_http_error" : stage === "document" ? "document_http_error" : "exhibit_http_error";
  const payloadFailure = stage === "index" ? "index_payload_too_large" : stage === "document" ? "document_payload_too_large" : "exhibit_payload_too_large";
  let response: Response;
  try {
    const requestInit: RequestInit & { [SEC_FILING_DETAIL_GRANT_CONTEXT]?: string } = {
      headers: { Accept: accept, "user-agent": SEC_USER_AGENT },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    };
    if (grantKey) requestInit[SEC_FILING_DETAIL_GRANT_CONTEXT] = grantKey;
    response = await fetchImpl(url, requestInit);
  } catch (error) {
    if (error instanceof Error
      && (error.name === "ProviderBudgetError" || /(?:cadence_guard|rolling_quota_guard)/i.test(error.message))) {
      const nextRetryAt = (error as Error & { nextRetryAt?: unknown }).nextRetryAt;
      const retryAfterMs = typeof nextRetryAt === "string" ? Date.parse(nextRetryAt) : Number.NaN;
      throw new FilingDetailError(
        "provider_budget_not_due",
        Number.isFinite(retryAfterMs) ? retryAfterMs : null,
      );
    }
    throw new FilingDetailError(requestFailure);
  }
  if (!response.ok) throw new FilingDetailError(httpFailure);
  return boundedResponseText(response, payloadFailure);
}

function skipRecord(): Record<SkipReason, number> {
  return { non_sec: 0, scheduled: 0, unsupported_form: 0, invalid_date: 0, stale: 0, invalid_url: 0, duplicate_accession: 0, cached: 0, failure_cooldown: 0, retry_not_due: 0, run_limit: 0 };
}

function pruneState(nowMs: number) {
  for (const [key, entry] of successfulDetailCache) {
    if (entry.expiresAtMs <= nowMs) successfulDetailCache.delete(key);
  }
  for (const [key, entry] of failedDetailCooldowns) {
    if (entry.retryAfterMs <= nowMs) failedDetailCooldowns.delete(key);
  }
  for (const [key, retryAfterMs] of deferredDetailRetries) {
    if (retryAfterMs <= nowMs) deferredDetailRetries.delete(key);
  }
  for (const [key, entry] of eligibleReceiptQueue) {
    const ageMs = nowMs - entry.publishedAtMs;
    if (ageMs < -MAX_FUTURE_SKEW_MS || ageMs > MAX_RECEIPT_AGE_MS) eligibleReceiptQueue.delete(key);
  }
  while (successfulDetailCache.size > MAX_SUCCESS_CACHE_ENTRIES) {
    const oldest = successfulDetailCache.keys().next().value as string | undefined;
    if (!oldest) break;
    successfulDetailCache.delete(oldest);
  }
  while (failedDetailCooldowns.size > MAX_FAILURE_COOLDOWN_ENTRIES) {
    const oldest = failedDetailCooldowns.keys().next().value as string | undefined;
    if (!oldest) break;
    failedDetailCooldowns.delete(oldest);
  }
  while (deferredDetailRetries.size > MAX_ELIGIBLE_QUEUE_ENTRIES) {
    const oldest = deferredDetailRetries.keys().next().value as string | undefined;
    if (!oldest) break;
    deferredDetailRetries.delete(oldest);
  }
}

function cacheDetail(indexUrl: string, detail: SecFilingDetail, nowMs: number) {
  const key = filingKey(indexUrl);
  successfulDetailCache.delete(key);
  successfulDetailCache.set(key, {
    detail,
    expiresAtMs: nowMs + SUCCESS_CACHE_TTL_MS,
    retryAfterMs: detail.eventExhibitMissing ? nowMs + PARTIAL_RETRY_DELAY_MS : null,
  });
  failedDetailCooldowns.delete(key);
  deferredDetailRetries.delete(key);
  pruneState(nowMs);
}

function cacheFailure(indexUrl: string, errorCategory: DetailFailure, nowMs: number) {
  const key = filingKey(indexUrl);
  failedDetailCooldowns.delete(key);
  failedDetailCooldowns.set(key, { errorCategory, retryAfterMs: nowMs + FAILURE_COOLDOWN_MS });
  deferredDetailRetries.delete(key);
  pruneState(nowMs);
}

function deferDetailRetry(indexUrl: string, requestedRetryAfterMs: number | null, nowMs: number) {
  const key = filingKey(indexUrl);
  const retryAfterMs = requestedRetryAfterMs && requestedRetryAfterMs > nowMs
    ? requestedRetryAfterMs
    : nowMs + BUDGET_RETRY_FALLBACK_MS;
  deferredDetailRetries.delete(key);
  deferredDetailRetries.set(key, retryAfterMs);
  pruneState(nowMs);
}

function eligibleReceipts(receipts: EventReceipt[], now: Date) {
  const skipped = skipRecord();
  const eligibleByFiling = new Map<string, EligibleReceipt>();
  for (const receipt of receipts) {
    if (receipt.channel !== "sec_current_filings" || !receipt.official) {
      skipped.non_sec += 1;
      continue;
    }
    if (receipt.scheduled) {
      skipped.scheduled += 1;
      continue;
    }
    const form = normalizedForm(receipt.rawEventType);
    if (!SUPPORTED_FORMS.has(form)) {
      skipped.unsupported_form += 1;
      continue;
    }
    const publishedAtMs = Date.parse(receipt.publishedAt);
    if (!Number.isFinite(publishedAtMs)) {
      skipped.invalid_date += 1;
      continue;
    }
    const ageMs = now.getTime() - publishedAtMs;
    if (ageMs < -MAX_FUTURE_SKEW_MS || ageMs > MAX_RECEIPT_AGE_MS) {
      skipped.stale += 1;
      continue;
    }
    const indexUrl = safeSecUrl(receipt.url)?.toString();
    if (!indexUrl || !/-index\.html?$/i.test(new URL(indexUrl).pathname)) {
      skipped.invalid_url += 1;
      continue;
    }
    const key = filingKey(indexUrl);
    const item = { receipt, form, publishedAtMs, indexUrl, filingKey: key };
    const existing = eligibleByFiling.get(key);
    if (existing) {
      skipped.duplicate_accession += 1;
      if (compareEligible(item, existing) < 0) eligibleByFiling.set(key, item);
      continue;
    }
    eligibleByFiling.set(key, item);
  }
  const eligible = [...eligibleByFiling.values()];
  eligible.sort(compareEligible);
  return { eligible, skipped };
}

export async function enrichSecFilingDetails(
  receipts: EventReceipt[],
  fetchImpl: typeof fetch,
  now: Date,
  reserveAccessions?: ReserveSecFilingDetailAccessions,
): Promise<SecFilingDetailsResult> {
  pruneState(now.getTime());
  const selection = eligibleReceipts(receipts, now);
  const currentFilingKeys = new Set(selection.eligible.map((eligible) => eligible.filingKey));
  for (const eligible of selection.eligible) {
    const queued = eligibleReceiptQueue.get(eligible.filingKey);
    if (!queued || compareEligible(eligible, queued) < 0) eligibleReceiptQueue.set(eligible.filingKey, eligible);
  }
  const boundedUnionEligible = boundEligibleQueue([...eligibleReceiptQueue.values()]);
  const retainedFilingKeys = new Set(boundedUnionEligible.map((eligible) => eligible.filingKey));
  for (const eligible of eligibleReceiptQueue.values()) {
    if (!retainedFilingKeys.has(eligible.filingKey)) eligibleReceiptQueue.delete(eligible.filingKey);
  }
  const cachedEligible: Array<{ eligible: EligibleReceipt; detail: SecFilingDetail }> = [];
  const failureCooldownReceiptIds: string[] = [];
  const retryDeferredReceiptIds: string[] = [];
  const fetchCandidates: EligibleReceipt[] = [];
  for (const eligible of boundedUnionEligible) {
    const cached = successfulDetailCache.get(eligible.filingKey);
    if (cached) {
      const detail = { ...cached.detail, receipt: cloneReceipt(eligible.receipt) };
      cachedEligible.push({ eligible, detail });
      selection.skipped.cached += 1;
      // A missing referenced exhibit is useful partial context, not a completed
      // accession. Replay the primary text while keeping the accession eligible
      // for a later retry after the exact-path cadence guard clears.
      if (!detail.eventExhibitMissing) continue;
    }
    const retryAfterMs = Math.max(
      cached?.retryAfterMs ?? 0,
      deferredDetailRetries.get(eligible.filingKey) ?? 0,
    );
    if (retryAfterMs > now.getTime()) {
      retryDeferredReceiptIds.push(eligible.receipt.id);
      selection.skipped.retry_not_due += 1;
      continue;
    }
    if (failedDetailCooldowns.has(eligible.filingKey)) {
      failureCooldownReceiptIds.push(eligible.receipt.id);
      selection.skipped.failure_cooldown += 1;
      continue;
    }
    fetchCandidates.push(eligible);
  }
  const replayedCached = cachedEligible
    .sort((left, right) => Number(currentFilingKeys.has(right.eligible.filingKey)) - Number(currentFilingKeys.has(left.eligible.filingKey))
      || compareByRecency(left.eligible, right.eligible))
    .slice(0, MAX_CACHED_DETAILS_REPLAY_PER_RUN);
  const cachedDetails = replayedCached.map(({ detail }) => detail);
  const cachedDiagnostics: SecFilingDetailDiagnostic[] = replayedCached.map(({ eligible, detail }) => ({
    receiptId: eligible.receipt.id,
    form: eligible.form,
    indexUrl: eligible.indexUrl,
    status: detail.eventExhibitMissing ? "partial" : "cached",
    primaryDocumentUrl: detail.primaryDocumentUrl,
    exhibitDocumentUrl: detail.exhibitDocumentUrl,
    exhibitDocumentType: detail.exhibitDocumentType,
    eventExhibitMissing: detail.eventExhibitMissing,
    documentsFetched: detail.documentsFetched,
    textLength: detail.textLength,
    truncated: detail.truncated,
    errorCategory: detail.eventExhibitMissing ? "event_exhibit_not_found" : null,
  }));
  const selected = selectNextCandidates(fetchCandidates, now.getTime());
  selection.skipped.run_limit = Math.max(0, fetchCandidates.length - selected.length);
  const fetchedDetails: SecFilingDetail[] = [];
  const fetchedDiagnostics: SecFilingDetailDiagnostic[] = [];
  const grantedFilingKeys = new Set<string>();
  let selectedForFetch = selected;
  if (reserveAccessions && selected.length) {
    const decisions = await reserveAccessions(selected.map((item) => ({
      filingKey: item.filingKey,
      indexUrl: item.indexUrl,
      maximumRequests: 3,
    })));
    if (decisions.length !== selected.length) throw new Error("sec_filing_detail_grant_decision_mismatch");
    selectedForFetch = [];
    decisions.forEach((decision, index) => {
      const selectedReceipt = selected[index];
      if (decision.allowed) {
        grantedFilingKeys.add(selectedReceipt.filingKey);
        selectedForFetch.push(selectedReceipt);
        return;
      }
      const parsedRetryAfterMs = decision.nextRetryAt ? Date.parse(decision.nextRetryAt) : Number.NaN;
      deferDetailRetry(
        selectedReceipt.indexUrl,
        Number.isFinite(parsedRetryAfterMs) ? parsedRetryAfterMs : null,
        now.getTime(),
      );
      fetchedDiagnostics.push({
        receiptId: selectedReceipt.receipt.id,
        form: selectedReceipt.form,
        indexUrl: selectedReceipt.indexUrl,
        status: "not_due",
        primaryDocumentUrl: null,
        exhibitDocumentUrl: null,
        exhibitDocumentType: null,
        eventExhibitMissing: false,
        documentsFetched: 0,
        textLength: 0,
        truncated: false,
        errorCategory: "provider_budget_not_due",
      });
    });
  }
  // Keep SEC requests serialized. Each selected filing makes at most one index
  // request, one primary-document request, and one referenced event-exhibit request.
  for (const selectedReceipt of selectedForFetch) {
    const grantKey = grantedFilingKeys.has(selectedReceipt.filingKey)
      ? selectedReceipt.filingKey
      : undefined;
    let primaryUrl: string | null = null;
    let exhibitUrl: string | null = null;
    let exhibitType: "EX-99.1" | "EX-99.2" | null = null;
    let documentsFetched = 0;
    let incompleteCategory: DetailFailure | null = null;
    try {
      const indexHtml = await fetchSecText(fetchImpl, selectedReceipt.indexUrl, "text/html,application/xhtml+xml", "index", grantKey);
      const documents = filingDocuments(indexHtml, selectedReceipt.indexUrl);
      primaryUrl = primaryDocumentUrl(documents, selectedReceipt.form);
      if (!primaryUrl) throw new FilingDetailError("primary_document_not_found");
      const documentHtml = await fetchSecText(fetchImpl, primaryUrl, "text/html,application/xhtml+xml,text/plain", "document", grantKey);
      const primaryText = plainText(documentHtml);
      if (!primaryText) throw new FilingDetailError("document_text_empty");
      documentsFetched = 1;
      let exhibitText: string | null = null;
      if (primaryNeedsEventExhibit(selectedReceipt.form, primaryText)) {
        const preferredType = referencedEventExhibitType(primaryText);
        const exhibit = eventExhibit(documents, preferredType);
        if (!exhibit) {
          // Keep factual primary text available as incomplete evidence rather
          // than discarding it, but surface the missing exhibit as a partial
          // provider result. The committee can see the gap and cannot mistake
          // this for a fully recovered filing.
          incompleteCategory = "event_exhibit_not_found";
        } else {
          exhibitUrl = exhibit.url;
          exhibitType = exhibit.documentType;
          const exhibitHtml = await fetchSecText(fetchImpl, exhibitUrl, "text/html,application/xhtml+xml,text/plain", "exhibit", grantKey);
          exhibitText = plainText(exhibitHtml);
          if (!exhibitText) throw new FilingDetailError("exhibit_text_empty");
          documentsFetched = 2;
        }
      }
      const composed = composeFilingText(primaryText, exhibitText, exhibitType);
      const { text, truncated } = composed;
      const detail: SecFilingDetail = {
        receipt: cloneReceipt(selectedReceipt.receipt),
        form: selectedReceipt.form,
        indexUrl: selectedReceipt.indexUrl,
        primaryDocumentUrl: primaryUrl,
        exhibitDocumentUrl: exhibitUrl,
        exhibitDocumentType: exhibitType,
        eventExhibitMissing: incompleteCategory === "event_exhibit_not_found",
        documentsFetched: documentsFetched as 1 | 2,
        text,
        textLength: text.length,
        truncated,
        fetchedAt: now.toISOString(),
      };
      cacheDetail(selectedReceipt.indexUrl, detail, now.getTime());
      fetchedDetails.push(detail);
      fetchedDiagnostics.push({ receiptId: selectedReceipt.receipt.id, form: selectedReceipt.form, indexUrl: selectedReceipt.indexUrl, status: incompleteCategory ? "partial" : "enriched", primaryDocumentUrl: primaryUrl, exhibitDocumentUrl: exhibitUrl, exhibitDocumentType: exhibitType, eventExhibitMissing: incompleteCategory === "event_exhibit_not_found", documentsFetched, textLength: text.length, truncated, errorCategory: incompleteCategory });
    } catch (error) {
      const category = error instanceof FilingDetailError ? error.category : "document_request_failed";
      const deferred = category === "provider_budget_not_due";
      if (deferred) {
        deferDetailRetry(
          selectedReceipt.indexUrl,
          error instanceof FilingDetailError ? error.retryAfterMs : null,
          now.getTime(),
        );
      } else {
        cacheFailure(selectedReceipt.indexUrl, category, now.getTime());
      }
      fetchedDiagnostics.push({ receiptId: selectedReceipt.receipt.id, form: selectedReceipt.form, indexUrl: selectedReceipt.indexUrl, status: deferred ? "not_due" : "failed", primaryDocumentUrl: primaryUrl, exhibitDocumentUrl: exhibitUrl, exhibitDocumentType: exhibitType, eventExhibitMissing: false, documentsFetched, textLength: 0, truncated: false, errorCategory: category });
    }
  }
  const detailByFiling = new Map<string, SecFilingDetail>();
  for (const detail of [...cachedDetails, ...fetchedDetails]) detailByFiling.set(filingKey(detail.indexUrl), detail);
  const details = [...detailByFiling.values()];
  const items = [...cachedDiagnostics, ...fetchedDiagnostics];
  const failures = fetchedDiagnostics.filter((item) => item.status === "failed").length;
  const incomplete = details.filter((detail) => detail.eventExhibitMissing).length;
  const newlyDeferredReceiptIds = fetchedDiagnostics
    .filter((item) => item.status === "not_due")
    .map((item) => item.receiptId);
  const allDeferredReceiptIds = [...new Set([...newlyDeferredReceiptIds, ...retryDeferredReceiptIds])];
  const deferred = allDeferredReceiptIds.length;
  const coolingDownFailures = failureCooldownReceiptIds.length;
  const backlogReceipts = boundedUnionEligible.filter((eligible) => {
    const cached = successfulDetailCache.get(eligible.filingKey);
    return !cached || cached.detail.eventExhibitMissing;
  });
  const backlogByForm = Object.fromEntries([...new Set([...FORM_PRIORITY.keys(), ...backlogReceipts.map((eligible) => eligible.form)])]
    .map((form) => [form, backlogReceipts.filter((eligible) => eligible.form === form).length]));
  const oldestBacklog = [...backlogReceipts].sort((left, right) => left.publishedAtMs - right.publishedAtMs)[0] ?? null;
  const nextRetryAtMs = backlogReceipts
    .map((eligible) => Math.max(
      successfulDetailCache.get(eligible.filingKey)?.retryAfterMs ?? 0,
      deferredDetailRetries.get(eligible.filingKey) ?? 0,
      failedDetailCooldowns.get(eligible.filingKey)?.retryAfterMs ?? 0,
    ))
    .filter((retryAfterMs) => retryAfterMs > now.getTime())
    .sort((left, right) => left - right)[0] ?? null;
  const status = failures > 0
    ? details.length > 0 ? "partial" : "failed"
    : incomplete > 0 || deferred > 0 || coolingDownFailures > 0
      ? details.length > 0 || coolingDownFailures > 0 ? "partial" : "not_due"
      : selected.length === 0
        ? details.length > 0 ? "connected" : "not_due"
        : fetchedDetails.length === selected.length ? "connected" : "failed";
  const providerError = failures > 0 && details.length === 0
    ? "selected_filings_failed"
    : failures > 0 || incomplete > 0 || deferred > 0 || coolingDownFailures > 0
      ? "some_selected_filings_incomplete"
      : null;
  const sourceUrls = [...new Set(items.flatMap((item) => [item.indexUrl, item.primaryDocumentUrl, item.exhibitDocumentUrl].filter((value): value is string => Boolean(value))))];
  return {
    provider: {
      provider: "sec_filing_details",
      status,
      checkedAt: now.toISOString(),
      nextRetryAt: nextRetryAtMs ? new Date(nextRetryAtMs).toISOString() : null,
      sourceUrls,
      recordsRead: details.length,
      error: providerError,
      entitlementVerified: details.length > 0,
      cached: cachedDetails.length > 0,
    },
    details,
    diagnostics: {
      received: receipts.length,
      currentEligible: selection.eligible.length,
      eligible: boundedUnionEligible.length,
      carriedForwardEligible: boundedUnionEligible.filter((eligible) => !currentFilingKeys.has(eligible.filingKey)).length,
      selected: selected.length,
      enriched: details.length,
      newlyFetched: fetchedDetails.length,
      reusedFromCache: cachedDetails.length,
      cachedReplayOmitted: Math.max(0, cachedEligible.length - replayedCached.length),
      incomplete,
      deferred,
      failed: failures,
      selectedReceiptIds: selected.map((item) => item.receipt.id),
      cachedReceiptIds: cachedDetails.map((item) => item.receipt.id),
      deferredReceiptIds: newlyDeferredReceiptIds,
      retryDeferredReceiptIds,
      failureCooldownReceiptIds,
      queuedReceiptIds: boundedUnionEligible.map((item) => item.receipt.id),
      backlog: {
        count: backlogReceipts.length,
        byForm: backlogByForm,
        oldestPublishedAt: oldestBacklog?.receipt.publishedAt ?? null,
        oldestAgeMinutes: oldestBacklog ? Math.max(0, Math.round((now.getTime() - oldestBacklog.publishedAtMs) / 60_000)) : null,
        failureCooldownCount: backlogReceipts.filter((eligible) => failedDetailCooldowns.has(eligible.filingKey)).length,
        retryDeferredCount: backlogReceipts.filter((eligible) => {
          const cached = successfulDetailCache.get(eligible.filingKey);
          const retryAfterMs = Math.max(
            cached?.retryAfterMs ?? 0,
            deferredDetailRetries.get(eligible.filingKey) ?? 0,
          );
          return retryAfterMs > now.getTime();
        }).length,
      },
      skipped: selection.skipped,
      items,
    },
    policy: {
      maximumFilingsPerRun: MAX_NEW_FILINGS_PER_RUN,
      maximumNewFilingsPerRun: MAX_NEW_FILINGS_PER_RUN,
      maximumReceiptAgeHours: MAX_RECEIPT_AGE_MS / 3_600_000,
      successfulDetailCacheHours: SUCCESS_CACHE_TTL_MS / 3_600_000,
      failedReceiptCooldownMinutes: FAILURE_COOLDOWN_MS / 60_000,
      priorityOrder: [...FORM_ROTATION],
      fairFormRotation: true,
      freshTimeSensitiveSlot: true,
      freshPriorityForms: [...FRESH_PRIORITY_FORMS],
      freshPriorityWindowMinutes: FRESH_PRIORITY_AGE_MS / 60_000,
      maximumQueuedFilings: MAX_ELIGIBLE_QUEUE_ENTRIES,
      maximumCachedReplayPerRun: MAX_CACHED_DETAILS_REPLAY_PER_RUN,
      starvationAgeMinutes: STARVATION_AGE_MS / 60_000,
      partialRetryMinutes: PARTIAL_RETRY_DELAY_MS / 60_000,
      budgetRetryFallbackMinutes: BUDGET_RETRY_FALLBACK_MS / 60_000,
      serializedRequests: true,
      maximumRequestsPerNewAccession: 3,
      cachedReplayBehavior: "restores_one_accession_receipt_without_duplicate_evidence",
      maximumTextCharacters: SEC_FILING_TEXT_MAX_CHARS,
      factualContentOnly: true,
      directionInferencePerformed: false,
      databaseWrites: false,
      publishing: false,
      notifications: false,
    },
  };
}

export function resetSecFilingDetailStateForTest() {
  successfulDetailCache.clear();
  failedDetailCooldowns.clear();
  deferredDetailRetries.clear();
  eligibleReceiptQueue.clear();
  nextFormRotationIndex = 0;
}
