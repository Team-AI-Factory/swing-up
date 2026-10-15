import crypto from "node:crypto";
import { readVersionedTextFromR2, writeVersionedJsonToR2 } from "@/lib/r2-warehouse";
import { pr262StorageKey } from "@/lib/opportunity-engine/pr262-storage";
import { extractFilingFacts, FILING_FACTS_VERSION, type FilingFactExtraction } from "@/lib/equity-signal/filing-facts";

type Json = Record<string, unknown>;
const object = (v: unknown): Json => v && typeof v === "object" && !Array.isArray(v) ? v as Json : {};
const text = (v: unknown) => typeof v === "string" ? v : "";
const number = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : null;
const DAY = 86400000;
export const FINANCIAL_EVIDENCE_VERSION = 1;
type FinancialTransportProof = { version: 1; httpStatus: 200; reachedEof: true; documentKey: string };
export type FinancialDocument = { url: string; form: string; filedAt: string; accession: string;
  reportingPeriod: string; collectedAt: string; readComplete: boolean; excerpts: Array<{ topic: string; text: string }>; digest: string;
  transportProof?: FinancialTransportProof; factExtraction?: FilingFactExtraction };
export type FinancialDocuments = { version: number; cik: string; checkedAt: string; nextCheckAt: string;
  documents: FinancialDocument[]; failures: Array<{ sourceUrl: string; reason: string }>; cached: boolean };

const excerptDigest = (excerpts: unknown) => crypto.createHash("sha256").update(JSON.stringify(excerpts)).digest("hex");
const transportDocumentKey = (document: Json) => crypto.createHash("sha256")
  .update(JSON.stringify([document.url, document.accession, document.form, document.filedAt, document.reportingPeriod,
    document.digest, document.collectedAt,
    // Existing attestations retain their exact key. New fact payloads must be
    // bound to the same naturally collected response, not pasted onto old proof.
    ...(document.factExtraction === undefined ? [] : [excerptDigest(document.factExtraction)])])).digest("hex");

/** Transport/body coverage only; extracted windows never attest coverage of all notes.
 * Legacy readComplete remains a retrieval/identity flag, not HTTP/EOF proof. */
export function financialDocumentCompleteness(value: unknown): "complete" | "partial" | "unknown" {
  const document = object(value), proof = object(document.transportProof);
  if (document.transportCompleteness === "unknown") return "unknown";
  if (document.transportProof !== undefined) {
    if (proof.version !== 1 || proof.httpStatus !== 200 || proof.reachedEof !== true
      || !text(document.url) || !text(document.accession) || !text(document.form) || !text(document.filedAt)
      || typeof document.reportingPeriod !== "string" || !Number.isFinite(Date.parse(text(document.collectedAt)))
      || !Array.isArray(document.excerpts) || document.digest !== excerptDigest(document.excerpts)
      || proof.documentKey !== transportDocumentKey(document)) return "unknown";
    return document.readComplete === true ? "complete" : "unknown";
  }
  return document.readComplete === false ? "partial" : "unknown";
}

/** Outward view only. Never feed this projection into cache skip or review keys. */
export function financialDocumentsEvidenceView(value: unknown): Json | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const documents = object(value);
  return { ...documents, transportCompletenessScope: "HTTP response body only; excerpts are selected windows, not all financial notes.",
    documents: (Array.isArray(documents.documents) ? documents.documents : []).map(value => {
    const document = object(value), transportCompleteness = financialDocumentCompleteness(document);
    const extraction = object(document.factExtraction);
    return { ...document, readComplete: transportCompleteness === "complete", transportCompleteness,
      ...(document.factExtraction === undefined ? {} : {
        factExtraction: transportCompleteness === "complete" ? document.factExtraction
          : { version: 1, status: "blocked", facts: [], gaps: [{ metric: "filing_facts",
            reason: "complete_bound_transport_proof_required" }], sourceHash: extraction.sourceHash },
      }) };
  }) };
}

export function financialDocumentsReady(value: unknown) {
  const documents = object(value), rows = documents.documents;
  return Array.isArray(rows) && rows.length > 0 && rows.every(row => financialDocumentCompleteness(row) === "complete")
    && Array.isArray(documents.failures) && documents.failures.length === 0;
}

export function financialDocumentsRequired(value: unknown, eventFamily: unknown, explicitlyRequested = false) {
  return eventFamily === "valuation_gap" || explicitlyRequested || (value !== null && value !== undefined);
}

/** Current publication only; this never changes historical Committee validity. */
export function financialCandidatePublicationGap(value: unknown): string | null {
  const candidate = object(value);
  if (candidate.financialDocumentsRequirementKnown === false
    || typeof candidate.financialDocumentsRequired !== "boolean") {
    return "The original whole-text completeness requirement is unknown; the historical approval remains recorded but current publication is held.";
  }
  const required = financialDocumentsRequired(candidate.financialDocuments, candidate.eventFamily, candidate.financialDocumentsRequired);
  return required ? financialDocumentsPublicationGap(candidate.financialDocuments) : null;
}

/** A missing attestation says nothing about whether historical text was partial. */
export function financialDocumentsPublicationGap(value: unknown): string | null {
  const documents = object(value), rows = Array.isArray(documents.documents) ? documents.documents : [];
  if (!rows.length || rows.some(row => financialDocumentCompleteness(row) === "unknown")) {
    return "Whole-text transport completeness is unknown; matching HTTP 200 and EOF provenance is unavailable. Retained excerpts remain usable.";
  }
  if (rows.some(row => financialDocumentCompleteness(row) === "partial")) {
    return "The response body was not read through EOF. Retained excerpts do not establish whole-text transport completeness.";
  }
  return financialDocumentsReady(value) ? null : "Current response collection has unresolved failures; retained excerpts do not establish complete current coverage.";
}

export function financialExcerpt(html: string) {
  // Source text is data, never instructions. Keep table-cell boundaries and units.
  const clean = html.replace(/<(script|style|ix:header)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(?:td|th|tr|p|div|h[1-6])\s*>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&#160;|&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/[ \t]+/g, " ").replace(/\n\s*\n/g, "\n");
  const topics: Record<string, RegExp> = { segments: /\b(?:reportable|operating) segments?\b/gi,
    customers: /\b(?:customer concentration|major customers?|significant customers?|customers? accounted for)\b/gi,
    margins: /\b(?:gross margin|operating margin|results of operations)\b/gi,
    cash_and_debt: /\b(?:liquidity and capital resources|cash flows from operating|debt maturities)\b/gi };
  return Object.entries(topics).flatMap(([topic, pattern]) => {
    const matches = [...clean.matchAll(pattern)].filter(m => (m.index ?? 0) > 2000).slice(-2);
    return matches.map(m => ({ topic, text: clean.slice(Math.max(0, (m.index ?? 0) - 200), (m.index ?? 0) + 1400).trim() }));
  });
}

async function readBounded(response: Response, maximum: number) {
  if (!response.body) throw new Error("empty_body");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let size = 0, body = "", complete = false;
  try {
    while (size < maximum) {
      const part = await reader.read();
      if (part.done) { complete = true; break; }
      const remaining = maximum - size; size += part.value.byteLength;
      body += decoder.decode(part.value.subarray(0, remaining), { stream: true });
    }
    body += decoder.decode();
  } finally { await reader.cancel().catch(() => undefined); }
  return { body, complete };
}

/** At most one SEC issuer index and two dated financial filings; existing fetch budgets apply. */
export async function collectFinancialDocuments(cik: string, fetchImpl: typeof fetch, now: Date, signal?: AbortSignal): Promise<FinancialDocuments> {
  if (!/^\d{10}$/.test(cik)) throw new Error("financial_evidence_invalid_cik");
  const key = pr262StorageKey(`research-evidence/financial-documents/${cik}.json`);
  const saved = await readVersionedTextFromR2(key);
  const prior = saved.found && saved.text ? JSON.parse(saved.text) as FinancialDocuments : null;
  const usable = prior?.version === FINANCIAL_EVIDENCE_VERSION && prior.cik === cik
    && Date.parse(prior.checkedAt) <= now.getTime() && now.getTime() - Date.parse(prior.checkedAt) < DAY;
  if (usable && Date.parse(prior.nextCheckAt) > now.getTime()) return { ...prior, cached: true };
  const documents = usable ? [...prior.documents] : [];
  const failures: FinancialDocuments["failures"] = [];
  const indexUrl = `https://data.sec.gov/submissions/CIK${cik}.json`;
  const request = async (url: string, maximum: number) => {
    const response = await fetchImpl(url, { headers: { "User-Agent": "SwingUp/1.0 support@swingup.app", Accept: "application/json,text/html" },
      cache: "no-store", redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
    if (response.status !== 200) throw new Error(`http_${response.status}`);
    return readBounded(response, maximum);
  };
  try {
    const index = await request(indexUrl, 4000000);
    if (!index.complete) throw new Error("issuer_index_too_large");
    const body = object(JSON.parse(index.body));
    if (String(body.cik).replace(/^0+/, "") !== cik.replace(/^0+/, "")) throw new Error("issuer_mismatch");
    const recent = object(object(body.filings).recent);
    const forms = Array.isArray(recent.form) ? recent.form : [];
    const candidates = forms.flatMap((form, i) => {
      if (!["10-K", "10-Q", "20-F", "40-F"].includes(text(form))) return [];
      const value = (key: string) => text((recent[key] as unknown[])?.[i]);
      const filedAt = value("filingDate"), accession = value("accessionNumber"), document = value("primaryDocument");
      const age = now.getTime() - Date.parse(filedAt);
      if (!Number.isFinite(age) || age < 0 || age > 550 * DAY || !/^\d{10}-\d{2}-\d{6}$/.test(accession)
        || !/^[A-Za-z0-9._-]+\.html?$/.test(document)) return [];
      return [{ form: text(form), filedAt, accession, reportingPeriod: value("reportDate"),
        url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}/${document}` }];
    }).sort((a, b) => b.filedAt.localeCompare(a.filedAt));
    const selected = [candidates.find(d => d.form !== "10-Q"), candidates.find(d => d.form === "10-Q")].filter(d => d !== undefined);
    if (!selected.length) throw new Error("financial_filing_not_found");
    for (const filing of selected) {
      const previous = documents.find(d => d.url === filing.url);
      const typedExtractionEligible = ["0001647639", "0000903651"].includes(cik) && filing.form === "10-Q";
      // A parser-version repair is eligible only at this normal due collection.
      // No cache sweep, forced refresh, extra slot, or paid-review reset.
      const typedExtractionCurrent = previous?.factExtraction?.version === FILING_FACTS_VERSION
        && previous.factExtraction.status === "extracted" && financialDocumentCompleteness(previous) === "complete";
      if (previous?.readComplete && (!typedExtractionEligible || typedExtractionCurrent)) continue;
      try {
        const result = await request(filing.url, 5000000);
        const excerpts = financialExcerpt(result.body);
        if (!excerpts.length) throw new Error("financial_sections_not_extracted");
        const document: FinancialDocument = { ...filing, collectedAt: now.toISOString(), readComplete: result.complete, excerpts,
          digest: excerptDigest(excerpts) };
        // Natural version repair reuses the selected quarterly request slot.
        // No immediate invalidation/backfill, extra request ceiling or byte increase.
        // Capped/legacy responses cannot acquire numeric or completeness proof.
        if (typedExtractionEligible) {
          document.factExtraction = extractFilingFacts(result.body, { ...filing, cik }, result.complete);
          if (document.factExtraction.status !== "extracted") throw new Error("typed_filing_refresh_unproved");
        }
        // Only this naturally requested, exact-200 read can mint proof. Cache
        // hits, skipped legacy rows and capped/interrupted reads cannot.
        if (result.complete) document.transportProof = { version: 1, httpStatus: 200, reachedEof: true,
          documentKey: transportDocumentKey(document) };
        const old = documents.findIndex(d => d.url === filing.url);
        if (old >= 0) documents[old] = document; else documents.push(document);
      } catch (error) { failures.push({ sourceUrl: filing.url, reason: error instanceof Error && /^http_\d+$|financial_sections_not_extracted$/.test(error.message) ? error.message : "document_unavailable_or_budget_deferred" }); }
    }
    // A newer filing's retrieval failure cannot silently substitute an old filing.
    const urls = new Set(selected.map(d => d.url));
    documents.splice(0, documents.length, ...documents.filter(d => urls.has(d.url)).slice(0, 2));
  } catch (error) { failures.push({ sourceUrl: indexUrl, reason: error instanceof Error && /^(?:http_\d+|issuer_mismatch|financial_filing_not_found|issuer_index_too_large)$/.test(error.message) ? error.message : "index_unavailable_or_budget_deferred" }); }
  const result: FinancialDocuments = { version: FINANCIAL_EVIDENCE_VERSION, cik, checkedAt: now.toISOString(),
    nextCheckAt: new Date(now.getTime() + (failures.length ? 60 * 60000 : 6 * 3600000)).toISOString(), documents, failures, cached: false };
  await writeVersionedJsonToR2(key, result, saved.etag ? { expectedEtag: saved.etag } : { createOnly: true });
  return result;
}

/** A source list alone cannot prove a provider's model inputs. Report the reconciliation explicitly. */
export function valuationEvidenceAudit(analysisValue: unknown, fundamentalsValue: unknown, price: number | null, now: Date) {
  const analysis = object(analysisValue), fundamentals = object(fundamentalsValue);
  const items = (Array.isArray(fundamentals.items) ? fundamentals.items : []).map(object);
  const sourceUrl = text(fundamentals.sourceUrl);
  const provider = object(analysis.fundamentals), fair = object(analysis.fairValue);
  const mappings = { revenue: "revenue", netIncome: "net_income", dilutedEpsTtm: "diluted_eps", freeCashFlow: "operating_cash_flow" };
  const inputReconciliation = Object.entries(mappings).map(([field, metric]) => ({ field, providerValue: number(provider[field]),
    verification: "period_and_definition_reconciliation_required", // TTM is not a single quarter or an annual number.
    primaryFacts: items.filter(item => item.metric === metric || item.metric === `${metric}_annual` || (field === "freeCashFlow" && /^capital_expenditure/.test(text(item.metric))))
      .map(item => ({ ...item, sourceUrl, verifiedNumericSource: true })),
  }));
  const methodRows = (Array.isArray(fair.methods) ? fair.methods : []).map(object);
  const methodNames = methodRows.map(method => text(method.method)).join(" ");
  // Required inputs follow the valuation method; a bank is not forced through an industrial FCF model.
  const required = [...new Set(["shares_outstanding", "equity",
    ...(/earnings|graham|pe_|p_e/i.test(methodNames) ? ["net_income", "diluted_eps"] : []),
    ...(/fcf|cash_flow/i.test(methodNames) ? ["operating_cash_flow", "capital_expenditure"] : []),
    ...(/sales|revenue/i.test(methodNames) ? ["revenue"] : []),
  ])];
  const missing = required.filter(metric => !items.some(item => item.metric === metric && number(item.value) !== null
    && Date.parse(text(item.periodEnd)) <= now.getTime() && now.getTime() - Date.parse(text(item.periodEnd)) <= 550 * DAY));
  const fact = (metric: string) => items.find(item => item.metric === metric);
  const methods = methodRows.map(method => {
    const value = number(method.value);
    const name = text(method.method), assumption = text(method.assumption);
    const shares = number(fact("shares_outstanding")?.value);
    const annualEps = number(fact("diluted_eps_annual")?.value);
    const cash = fact("operating_cash_flow_annual"), capex = fact("capital_expenditure_annual");
    const sameCashPeriod = cash && capex && cash.periodStart === capex.periodStart && cash.periodEnd === capex.periodEnd;
    const multiple = Number(assumption.match(/([\d.]+)x\b/)?.[1]);
    const yieldPercent = Number(assumption.match(/([\d.]+)%/)?.[1]);
    const annualCrossCheck = name === "earnings_power" && annualEps !== null && multiple > 0 ? annualEps * multiple
      : name === "owner_earnings_fcf" && sameCashPeriod && shares && shares > 0 && yieldPercent > 0
        && number(cash.value) !== null && number(capex.value) !== null
        ? (Number(cash.value) - Number(capex.value)) / shares / (yieldPercent / 100)
        : null;
    return { method: method.method, value, assumption: method.assumption, inputVerification: "committee_must_reconcile_primary_facts",
      annualCrossCheck: annualCrossCheck !== null && Number.isFinite(annualCrossCheck) ? { value: annualCrossCheck,
        sourceUrl, basis: "Latest reported annual facts with the model's stated multiple/yield; not a substitute for TTM reconciliation",
        assumptionsReused: assumption, shareCountFact: fact("shares_outstanding") ?? null,
        inputFacts: name === "earnings_power" ? [fact("diluted_eps_annual")] : [cash, capex] } : null,
      sensitivity: value && value > 0 ? { label: "Mechanical sensitivity to a 20% lower or higher method value; not a forecast or probability",
        lowerValue: value * 0.8, higherValue: value * 1.2,
        lowerGapPercent: price && price > 0 ? (value * 0.8 / price - 1) * 100 : null,
        higherGapPercent: price && price > 0 ? (value * 1.2 / price - 1) * 100 : null } : null };
  });
  return { source: "valuation_input_audit", modelObservedAt: analysis.observedAt, currency: analysis.currency,
    sourceUrl, inputReconciliation, methods, missingEssentialFacts: missing,
    instructions: "Reconcile reporting periods, units, share count, debt and cash before accepting a method. Provider TTM numbers and model values are estimates until reconciled. A large gap is not proof. Explain sensitivity and contradictions. Do not demand a new headline for this valuation." };
}
