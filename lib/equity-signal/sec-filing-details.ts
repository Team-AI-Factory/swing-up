import type { EventReceipt } from "@/lib/equity-signal/types";

const SEC_USER_AGENT = "SwingUp/1.0 support@swingup.app";
const SEC_HOSTS = new Set(["sec.gov", "www.sec.gov"]);
const SUPPORTED_FORMS = new Set(["8-K", "6-K", "424B5", "424B3", "10-Q", "10-K"]);
const MAX_FILINGS_PER_RUN = 2;
const MAX_RECEIPT_AGE_MS = 48 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 5_000_000;

export const SEC_FILING_TEXT_MAX_CHARS = 80_000;

type SkipReason = "non_sec" | "scheduled" | "unsupported_form" | "invalid_date" | "stale" | "invalid_url" | "run_limit";
type DetailFailure = "index_http_error" | "index_payload_too_large" | "index_request_failed" | "primary_document_not_found" | "document_http_error" | "document_payload_too_large" | "document_request_failed" | "document_text_empty";

export type SecFilingDetail = {
  receipt: EventReceipt;
  form: string;
  indexUrl: string;
  primaryDocumentUrl: string;
  text: string;
  textLength: number;
  truncated: boolean;
  fetchedAt: string;
};

export type SecFilingDetailDiagnostic = {
  receiptId: string;
  form: string;
  indexUrl: string;
  status: "enriched" | "failed";
  primaryDocumentUrl: string | null;
  textLength: number;
  truncated: boolean;
  errorCategory: DetailFailure | null;
};

export type SecFilingDetailsResult = {
  provider: {
    provider: "sec_filing_details";
    status: "connected" | "partial" | "failed" | "not_due";
    checkedAt: string;
    sourceUrls: string[];
    recordsRead: number;
    error: "selected_filings_failed" | null;
    entitlementVerified: boolean;
    cached: false;
  };
  details: SecFilingDetail[];
  diagnostics: {
    received: number;
    eligible: number;
    selected: number;
    enriched: number;
    failed: number;
    selectedReceiptIds: string[];
    skipped: Record<SkipReason, number>;
    items: SecFilingDetailDiagnostic[];
  };
  policy: {
    maximumFilingsPerRun: number;
    maximumReceiptAgeHours: number;
    maximumTextCharacters: number;
    factualContentOnly: true;
    directionInferencePerformed: false;
    databaseWrites: false;
    publishing: false;
    notifications: false;
  };
};

type EligibleReceipt = { receipt: EventReceipt; form: string; publishedAtMs: number; indexUrl: string };

class FilingDetailError extends Error {
  constructor(public readonly category: DetailFailure) {
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
    url.search = "";
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function resolvePrimaryDocumentHref(value: string, indexUrl: string) {
  try {
    const linked = new URL(decodeHtml(value), indexUrl);
    if (linked.protocol !== "https:" || !SEC_HOSTS.has(linked.hostname.toLowerCase())) return null;
    if (linked.pathname.toLowerCase() === "/ixviewer/doc/action") {
      return safeSecUrl(linked.searchParams.get("doc") ?? "", "https://www.sec.gov");
    }
    return safeSecUrl(linked.toString());
  } catch {
    return null;
  }
}

function primaryDocumentUrl(indexHtml: string, indexUrl: string, form: string) {
  const rows = [...indexHtml.matchAll(/<tr\b[^>]*>[^]*?<\/tr>/gi)].map((match) => match[0]);
  const candidates = rows.flatMap((row) => {
    const href = row.match(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/i)?.[1];
    if (!href) return [];
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([^]*?)<\/t[dh]>/gi)].map((match) => plainText(match[1]));
    const sequence = cells[0] ?? "";
    const description = cells[1] ?? "";
    const documentType = normalizedForm(cells[3] ?? cells.at(-1) ?? "");
    const exactType = documentType === form;
    const descriptiveMatch = normalizedForm(description).includes(form);
    if (!exactType && !(sequence === "1" && descriptiveMatch)) return [];
    const resolved = resolvePrimaryDocumentHref(href, indexUrl);
    if (!resolved || !/\.(?:html?|txt)$/i.test(resolved.pathname) || /-index\.html?$/i.test(resolved.pathname)) return [];
    const score = (exactType ? 100 : 0) + (sequence === "1" ? 20 : 0) + (/form|report|prospectus/i.test(description) ? 5 : 0);
    return [{ url: resolved.toString(), score }];
  });
  return candidates.sort((left, right) => right.score - left.score)[0]?.url ?? null;
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

async function fetchSecText(fetchImpl: typeof fetch, url: string, accept: string, stage: "index" | "document") {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: accept, "user-agent": SEC_USER_AGENT },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new FilingDetailError(stage === "index" ? "index_request_failed" : "document_request_failed");
  }
  if (!response.ok) throw new FilingDetailError(stage === "index" ? "index_http_error" : "document_http_error");
  return boundedResponseText(response, stage === "index" ? "index_payload_too_large" : "document_payload_too_large");
}

function skipRecord(): Record<SkipReason, number> {
  return { non_sec: 0, scheduled: 0, unsupported_form: 0, invalid_date: 0, stale: 0, invalid_url: 0, run_limit: 0 };
}

function eligibleReceipts(receipts: EventReceipt[], now: Date) {
  const skipped = skipRecord();
  const eligible: EligibleReceipt[] = [];
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
    eligible.push({ receipt, form, publishedAtMs, indexUrl });
  }
  eligible.sort((left, right) => right.publishedAtMs - left.publishedAtMs || left.receipt.id.localeCompare(right.receipt.id));
  if (eligible.length > MAX_FILINGS_PER_RUN) skipped.run_limit = eligible.length - MAX_FILINGS_PER_RUN;
  return { eligible, selected: eligible.slice(0, MAX_FILINGS_PER_RUN), skipped };
}

export async function enrichSecFilingDetails(receipts: EventReceipt[], fetchImpl: typeof fetch, now: Date): Promise<SecFilingDetailsResult> {
  const selection = eligibleReceipts(receipts, now);
  const settled = await Promise.all(selection.selected.map(async (selected) => {
    let primaryUrl: string | null = null;
    try {
      const indexHtml = await fetchSecText(fetchImpl, selected.indexUrl, "text/html,application/xhtml+xml", "index");
      primaryUrl = primaryDocumentUrl(indexHtml, selected.indexUrl, selected.form);
      if (!primaryUrl) throw new FilingDetailError("primary_document_not_found");
      const documentHtml = await fetchSecText(fetchImpl, primaryUrl, "text/html,application/xhtml+xml,text/plain", "document");
      const extracted = plainText(documentHtml);
      if (!extracted) throw new FilingDetailError("document_text_empty");
      const truncated = extracted.length > SEC_FILING_TEXT_MAX_CHARS;
      const text = extracted.slice(0, SEC_FILING_TEXT_MAX_CHARS);
      const detail: SecFilingDetail = {
        receipt: cloneReceipt(selected.receipt),
        form: selected.form,
        indexUrl: selected.indexUrl,
        primaryDocumentUrl: primaryUrl,
        text,
        textLength: text.length,
        truncated,
        fetchedAt: now.toISOString(),
      };
      const diagnostic: SecFilingDetailDiagnostic = { receiptId: selected.receipt.id, form: selected.form, indexUrl: selected.indexUrl, status: "enriched", primaryDocumentUrl: primaryUrl, textLength: text.length, truncated, errorCategory: null };
      return { detail, diagnostic };
    } catch (error) {
      const category = error instanceof FilingDetailError ? error.category : "document_request_failed";
      const diagnostic: SecFilingDetailDiagnostic = { receiptId: selected.receipt.id, form: selected.form, indexUrl: selected.indexUrl, status: "failed", primaryDocumentUrl: primaryUrl, textLength: 0, truncated: false, errorCategory: category };
      return { detail: null, diagnostic };
    }
  }));
  const details = settled.flatMap((item) => item.detail ? [item.detail] : []);
  const items = settled.map((item) => item.diagnostic);
  const failures = items.filter((item) => item.status === "failed").length;
  const status = !selection.selected.length ? "not_due" : details.length === selection.selected.length ? "connected" : details.length ? "partial" : "failed";
  const sourceUrls = [...new Set(items.flatMap((item) => [item.indexUrl, item.primaryDocumentUrl].filter((value): value is string => Boolean(value))))];
  return {
    provider: {
      provider: "sec_filing_details",
      status,
      checkedAt: now.toISOString(),
      sourceUrls,
      recordsRead: details.length,
      error: selection.selected.length > 0 && !details.length ? "selected_filings_failed" : null,
      entitlementVerified: details.length > 0,
      cached: false,
    },
    details,
    diagnostics: {
      received: receipts.length,
      eligible: selection.eligible.length,
      selected: selection.selected.length,
      enriched: details.length,
      failed: failures,
      selectedReceiptIds: selection.selected.map((item) => item.receipt.id),
      skipped: selection.skipped,
      items,
    },
    policy: {
      maximumFilingsPerRun: MAX_FILINGS_PER_RUN,
      maximumReceiptAgeHours: MAX_RECEIPT_AGE_MS / 3_600_000,
      maximumTextCharacters: SEC_FILING_TEXT_MAX_CHARS,
      factualContentOnly: true,
      directionInferencePerformed: false,
      databaseWrites: false,
      publishing: false,
      notifications: false,
    },
  };
}
