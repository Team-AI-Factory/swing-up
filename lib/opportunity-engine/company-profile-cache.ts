import { createCompleteSourceRecord, readCompleteSourceRecord, type CompleteSourceBinding, type CompleteSourceRecord } from "@/lib/company-profile-complete-source";
import { inspectAnnualDocumentIdentity } from "@/lib/company-profile-financial-customer-source";
import { isAnnualInformationFormDocument, resolve40FAnnualInformationForm, secAnnualFilingIndexUrl } from "@/lib/company-profile-annual-source";
import { setTimeout as pause } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import { redactSecrets } from "@/lib/redact-secrets";
import { readVersionedTextFromR2, writeVersionedJsonToR2 } from "@/lib/r2-warehouse";
import { pr262StorageKey } from "@/lib/opportunity-engine/pr262-storage";
import { COMPANY_PROFILE_PARSER_REVISION, annualBusinessText, extractCompanyProfile, inspectCompanyProfileExtraction, profileCik, sameCompanyName, verifiedCompanyProfile, type CompanyIdentity, type VerifiedCompanyProfile } from "@/lib/company-profile";
const KEY = pr262StorageKey("research-evidence/company-profiles-v1.json");
const UNIVERSE = pr262StorageKey("equity-universe/v1.json");
// Older excerpts could originate after an in-text cross-reference in Risk
// Factors. Grammar revisions may reuse only an excerpt cut by the safe layout.
const SOURCE_LAYOUT_REVISION = 1;
type Json = Record<string, unknown>;
const object = (v: unknown): Json => v && typeof v === "object" && !Array.isArray(v) ? v as Json : {};
const text = (v: unknown) => typeof v === "string" ? v.trim() : "";
type Filing = { url: string; form: string; filedAt: string; industry?: string; checkedAt?: string; annualFilingUrl?: string; annualFilingIndexUrl?: string };
type Entry = { ticker: string; company: string; cik: string; updatedAt: string; nextAttemptAt: string; profile: VerifiedCompanyProfile | null; firstVerifiedAt?: string; verificationHistoryKnown?: true; filing?: Filing; error?: string; extractionFailure?: string; parserRevision?: number; cachedParserRevision?: number };
async function load(options: { signal?: AbortSignal; forWrite?: boolean } = {}) {
  const saved = await readVersionedTextFromR2(KEY, { signal: options.signal });
  const body = saved.found && saved.text ? object(JSON.parse(saved.text)) : {};
  // Legacy objects can omit version; unknown versions and unreadable rows
  // cannot be safely rebased. Never turn them into an empty cache on retry.
  if (options.forWrite && saved.found && (!saved.etag || (body.version !== undefined && body.version !== 1) || !Array.isArray(body.entries)
    || body.entries.some(row => !row || typeof row !== "object" || Array.isArray(row)))) {
    throw new Error("company_profile_cache_state_invalid");
  }
  return { saved, entries: Array.isArray(body.entries) ? body.entries as Entry[] : [] };
}
function same(entry: CompanyIdentity, identity: CompanyIdentity) {
  return entry.ticker === identity.ticker && sameCompanyName(entry.company, identity.company) && profileCik(entry.cik) === profileCik(identity.cik);
}
function retryDeferred(entry: Entry | undefined, now: Date) {
  // Revisit parsing failures once after a parser repair, using the saved exact
  // source first. Network and provider-budget failures retain their backoff.
  if (["company_profile_products_and_customers_not_extracted", "company_profile_annual_filing_unavailable"].includes(entry?.error ?? "")
    && entry?.parserRevision !== COMPANY_PROFILE_PARSER_REVISION) return false;
  // A successful profile's refresh date must not defer replacement after current verification rejects it.
  // Pending and failed attempts persist a null profile and still retain their retrieval backoff.
  return !entry?.profile && Date.parse(entry?.nextAttemptAt ?? "") > now.getTime();
}
class ProfileCacheWriteError extends Error {
  readonly storageDomain = "r2_state";
  readonly storageOperation = "write";
  constructor(cause: unknown, readonly safeRoleDeferral = false) {
    super(cause instanceof Error ? cause.message : "company_profile_cache_write_failed", { cause });
  }
}
function causedByRoleAbort(error: unknown, signal?: AbortSignal) {
  if (!signal?.aborted) return false;
  // A coincident abort is not the cause of an HTTP/schema/conflict failure.
  // Preserve identity through native AbortError and R2 provenance wrappers;
  // names/messages cannot distinguish the store's timeout from the role's.
  const seen = new Set<unknown>();
  let cause = error;
  for (let depth = 0; depth < 16 && cause !== undefined && !seen.has(cause); depth++) {
    if (cause === signal.reason) return true;
    seen.add(cause);
    cause = object(cause).cause;
  }
  return false;
}
function transientProfileWrite(error: unknown) {
  // Only a failed profile PUT reaches here. Other stores and source fetches
  // deliberately do not acquire retries from this helper.
  return error instanceof Error && (/^r2_state_(?:write|read)_http_(?:408|500|502|503|504)$/.test(error.message)
    || error.message === "r2_state_write_missing_etag" || error.message === "r2_state_write_transport_failed" || error.name === "TimeoutError"
    || (error.name === "TypeError" && error.message === "fetch failed"));
}
function transientProfileSettlement(error: unknown, transactionDeadline: AbortSignal) {
  if (causedByRoleAbort(error, transactionDeadline) || transientProfileWrite(error)) return true;
  // The lower helper deliberately forbids replay after unavailable readback.
  // Inspect only this known wrapper's current cause, never a historical fault.
  if (!(error instanceof Error) || error.message !== "r2_state_write_reconciliation_failed") return false;
  let cause: unknown = error;
  for (let depth = 0; depth < 4 && cause instanceof Error && cause.message === "r2_state_write_reconciliation_failed"; depth++) cause = cause.cause;
  return causedByRoleAbort(cause, transactionDeadline) || transientProfileWrite(cause);
}
function profileStorageCause(error: unknown): string {
  if (!(error instanceof Error)) return "other";
  if (error.name === "TimeoutError") return "timeout";
  if (error.name === "AbortError") return "abort";
  const http = error.message.match(/^r2_state_(?:read|write)_http_(\d{3})$/)?.[1];
  if (http) return `http_${http}`;
  if (["r2_state_write_reconciliation_failed", "r2_state_write_transport_failed", "r2_state_write_missing_etag",
    "company_profile_cache_superseded", "company_profile_cache_conflict", "company_profile_cache_state_invalid"].includes(error.message)) return error.message;
  return error instanceof SyntaxError ? "invalid_json" : "other";
}
// Match the JSON representation actually persisted by the R2 encoder.
const snapshotEntry = (entry: Entry): Entry => JSON.parse(JSON.stringify(redactSecrets(entry)));
// All issuer rows share one object. Serialize local read/CAS/reconciliation
// transactions, while retaining CAS against writers in other processes.
// A cancelled waiter leaves the FIFO immediately and never inherits the lock.
const profileCacheWriteQueue: Array<() => void> = [];
let profileCacheWriteHeld = false;
function acquireProfileCacheWrite(signal: AbortSignal): Promise<() => void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const next = profileCacheWriteQueue.shift();
      if (next) next();
      else profileCacheWriteHeld = false;
    };
    const enter = () => {
      signal.removeEventListener("abort", cancel);
      resolve(release);
    };
    const cancel = () => {
      const index = profileCacheWriteQueue.indexOf(enter);
      if (index >= 0) profileCacheWriteQueue.splice(index, 1);
      reject(signal.reason);
    };
    if (profileCacheWriteHeld) {
      profileCacheWriteQueue.push(enter);
      signal.addEventListener("abort", cancel, { once: true });
    } else {
      profileCacheWriteHeld = true;
      enter();
    }
  });
}
async function store(entry: Entry, previous: Entry | undefined, roleSignal?: AbortSignal, deadlineCleanup = false, persistenceSignal?: AbortSignal, admission = false) {
  const intended = snapshotEntry(entry);
  const startedAt = Date.now();
  // A normal source-deadline deferral gets one short cleanup PUT so its
  // five-minute backoff survives. It must never start another source or retry.
  // The builder may stop source/admission work before storage finalization.
  // A healthy in-flight CAS must not be cancelled merely by that work cutoff.
  // Cleanup still has one PUT/5s and may not escape the persistence deadline.
  const parentSignal = persistenceSignal ?? (deadlineCleanup ? undefined : roleSignal);
  const transactionDeadline = AbortSignal.timeout(deadlineCleanup ? 5_000 : 15_000);
  const signal = AbortSignal.any([...(parentSignal ? [parentSignal] : []), transactionDeadline]);
  let writes = 0;
  let unresolvedPut = false;
  let phase: "queue" | "read" | "backoff" | "put" = "queue";
  let queueMs: number | null = null;
  let failure: unknown = new Error("company_profile_cache_conflict");
  let release: (() => void) | undefined;
  const observe = (error: unknown, settlement: "not_attempted" | "exact_intent" | "different_intent" | "unavailable") => {
    // Controlled operation-family diagnostics only; no contents or raw errors.
    console.warn(`[company-profile-storage] ${JSON.stringify({
      stage: admission ? "admission" : deadlineCleanup ? "deadline_cleanup" : intended.profile ? "verified" : "pending",
      phase, ticker: /^[A-Z0-9.-]{1,12}$/.test(intended.ticker) ? intended.ticker : "invalid",
      writes, queueMs, durationMs: Date.now() - startedAt, cause: profileStorageCause(error),
      transactionDeadline: transactionDeadline.aborted, workDeadline: roleSignal?.aborted === true,
      persistenceDeadline: persistenceSignal?.aborted === true, settlement,
    })}`);
  };
  try {
    // Queue time consumes the same transaction deadline. Admission also stops
    // at the work cutoff; finalization and cleanup retain their storage reserve.
    release = await acquireProfileCacheWrite(admission && roleSignal ? AbortSignal.any([signal, roleSignal]) : signal);
    queueMs = Date.now() - startedAt;
    while (true) {
      signal.throwIfAborted();
      if (admission && writes === 0) roleSignal?.throwIfAborted();
      // This read also resolves an ambiguous response from the preceding PUT.
      // Never retry from the old ETag or a guessed outcome.
      const readSignal = admission && writes === 0 && roleSignal ? AbortSignal.any([signal, roleSignal]) : signal;
      phase = "read";
      const { saved, entries } = await load({ signal: readSignal, forWrite: true });
      const targets = entries.filter(row => row.cik === intended.cik && row.ticker === intended.ticker);
      if (targets.length > 1) throw new Error("company_profile_cache_state_invalid");
      if (isDeepStrictEqual(targets[0], intended)) return intended;
      // Timestamps alone are not sufficient: a same-time concurrent change,
      // including historical metadata, must not be overwritten either.
      if (!isDeepStrictEqual(targets[0], previous)) throw new Error("company_profile_cache_superseded");
      signal.throwIfAborted();
      if (writes >= (deadlineCleanup ? 1 : 4)) throw failure;
      if (writes) { phase = "backoff"; await pause(100 * 2 ** (writes - 1), undefined, { signal }); }
      signal.throwIfAborted();
      if (admission) roleSignal?.throwIfAborted();
      try {
        phase = "put";
        writes++;
        unresolvedPut = true;
        const result = await writeVersionedJsonToR2(KEY, { version: 1, updatedAt: intended.updatedAt,
          entries: [intended, ...entries.filter(row => row.cik !== intended.cik || row.ticker !== intended.ticker)] },
        { ...(saved.etag ? { expectedEtag: saved.etag } : { createOnly: true }), signal, maxAttempts: 1 });
        if (result.conflict) { unresolvedPut = false; failure = new Error("company_profile_cache_conflict"); continue; }
        if (!result.written) throw new Error("company_profile_cache_write_failed");
        return intended;
      } catch (error) {
        if (!transientProfileWrite(error)) throw error;
        failure = error;
      }
    }
  } catch (error) {
    let settlement: "not_attempted" | "exact_intent" | "different_intent" | "unavailable" = "not_attempted";
    // A short read-only settlement may outlive this transaction's own clock,
    // but never its caller's explicit persistence reserve. It owns no PUT or
    // source allowance and cannot rescue pre-PUT/permanent/schema failures.
    // Deadline cleanup retains its original complete 1-PUT/5s bound.
    if (!deadlineCleanup && unresolvedPut && persistenceSignal && !persistenceSignal.aborted
      && transientProfileSettlement(error, transactionDeadline)) {
      settlement = "unavailable";
      const settleSignal = AbortSignal.any([persistenceSignal, AbortSignal.timeout(5_000)]);
      try {
        const { entries } = await load({ signal: settleSignal, forWrite: true });
        settleSignal.throwIfAborted();
        const targets = entries.filter(row => row.cik === intended.cik && row.ticker === intended.ticker);
        if (targets.length <= 1) {
          settlement = "different_intent";
          if (isDeepStrictEqual(targets[0], intended)) {
            observe(error, "exact_intent");
            return intended;
          }
        }
      } catch { /* Unknown stays failed; no replay, cleanup overwrite or new source. */ }
    }
    observe(error, settlement);
    // In particular, do not let ensureCompanyProfile's source-error handler
    // issue a different write after this outcome could not be established.
    throw new ProfileCacheWriteError(error, !deadlineCleanup && writes === 0 && (admission || !persistenceSignal) && causedByRoleAbort(error, roleSignal));
  } finally {
    release?.();
  }
}

/** Cache-only read. Re-check the current authoritative ticker/CIK mapping before public use. */
export async function readCompanyProfiles(identities: CompanyIdentity[], now = new Date()) {
  const result = new Map<string, VerifiedCompanyProfile>();
  const [{ entries }, universeSaved] = await Promise.all([load(), readVersionedTextFromR2(UNIVERSE)]);
  const universe = universeSaved.found && universeSaved.text ? object(JSON.parse(universeSaved.text)) : {};
  if (universe.version !== 1 || universe.scope !== "active_us_exchange_listed_common_equities_and_adrs") return result;
  const listings = Array.isArray(universe.entries) ? universe.entries.map(object) : [];
  const listingByTicker = new Map(listings.filter(row => Array.isArray(row.sourceNames) && row.sourceNames.includes("SEC company_tickers_exchange"))
    .map(row => [row.ticker, row]));
  const entryByIssuer = new Map(entries.map(entry => [`${entry.ticker}:${entry.cik}`, entry]));
  for (const identity of identities) {
    const ticker = text(identity.ticker).toUpperCase();
    const listing = listingByTicker.get(ticker);
    const cik = profileCik(listing?.cik);
    if (!cik || (identity.cik && profileCik(identity.cik) !== cik)) continue;
    const exact = { ticker, company: identity.company, cik };
    const cached = entryByIssuer.get(`${ticker}:${cik}`);
    const verified = cached && same(cached, exact) ? verifiedCompanyProfile(cached.profile, exact, now) : null;
    if (verified) result.set(ticker, verified);
  }
  return result;
}

async function boundedText(response: Response, complete?: (text: string) => boolean, onResponseBodyFailure?: () => void, onEof?: (bytes: Uint8Array) => void) {
  const maximumBytes = complete ? 12_000_000 : 2_000_000;
  if (!response.ok) throw new Error(`company_profile_http_${response.status}`);
  if (!complete && Number(response.headers.get("content-length") ?? 0) > maximumBytes) throw new Error("company_profile_document_too_large");
  if (!response.body) throw new Error("company_profile_empty_response");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0, body = "", lastChecked = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      let chunk: Awaited<ReturnType<typeof reader.read>>;
      try { chunk = await reader.read(); }
      catch (error) {
        // Fetch has already returned successful headers. A later stream
        // timeout/transport error is still a failed request, not missing prose.
        onResponseBodyFailure?.();
        throw error;
      }
      if (chunk.done) {
        // Only the native reader's done flag attests transport completion. An
        // early business match or a closing HTML tag must never mint this cache.
        if (onEof) onEof(Buffer.concat(chunks, size));
        return body + decoder.decode();
      }
      size += chunk.value.byteLength;
      if (size > maximumBytes) throw new Error("company_profile_document_too_large");
      if (onEof) chunks.push(chunk.value.slice()); // retain the original bytes, not re-encoded text
      body += decoder.decode(chunk.value, { stream: true });
      // Annual reports may have large financial exhibits after the business section.
      // Cancel the stream as soon as enough exact source text is verified.
      if (complete && size - lastChecked >= 128_000) {
        lastChecked = size;
        if (complete(body)) return body;
      }
    }
  } finally { await reader.cancel().catch(() => undefined); }
}
function completeSourceBinding(filing: Filing, cik: string): CompleteSourceBinding {
  return { cik, form: filing.form as CompleteSourceBinding["form"], url: filing.url, filedAt: filing.filedAt,
    ...(filing.annualFilingUrl ? { annualFilingUrl: filing.annualFilingUrl } : {}),
    ...(filing.annualFilingIndexUrl ? { annualFilingIndexUrl: filing.annualFilingIndexUrl } : {}) };
}
function completeAnnualDocument(html: string, filing: Filing, identity: CompanyIdentity, now: Date) {
  // A 40-F AIF has already been resolved against its authenticated cover and
  // same-accession index above. Regular annuals must carry matching strict DEI.
  return filing.form === "40-F" ? isAnnualInformationFormDocument(html)
    : Boolean(inspectAnnualDocumentIdentity({ html, identity: { cik: String(identity.cik) }, form: filing.form,
      sourceUrl: filing.url, filedAt: filing.filedAt, now }));
}
function completeSource(source: Json, filing: Filing, identity: CompanyIdentity, now: Date) {
  const decoded = readCompleteSourceRecord(source.completeSource, completeSourceBinding(filing, String(identity.cik)), now);
  if (decoded.status === "valid" && !completeAnnualDocument(decoded.html, filing, identity, now)) return { status: "invalid" as const };
  return decoded;
}
function annualFiling(body: Json, identity: CompanyIdentity, now: Date): Filing | null {
  if (profileCik(body.cik) !== profileCik(identity.cik) || !Array.isArray(body.tickers)
    || !body.tickers.includes(text(identity.ticker).toUpperCase())) throw new Error("company_profile_issuer_mismatch");
  const recent = object(object(body.filings).recent);
  const forms = Array.isArray(recent.form) ? recent.form : [];
  for (let i = 0; i < forms.length; i++) {
    if (!["10-K", "20-F", "40-F"].includes(String(forms[i]))) continue;
    const filedAt = text((recent.filingDate as unknown[])?.[i]);
    const accession = text((recent.accessionNumber as unknown[])?.[i]);
    const document = text((recent.primaryDocument as unknown[])?.[i]);
    const age = now.getTime() - Date.parse(filedAt);
    if (!Number.isFinite(age) || age < 0 || age > 550 * 86400000 || !/^\d{10}-\d{2}-\d{6}$/.test(accession)
      || !/^[A-Za-z0-9._-]+\.html?$/.test(document)) continue;
    return { url: `https://www.sec.gov/Archives/edgar/data/${Number(identity.cik)}/${accession.replace(/-/g, "")}/${document}`, form: String(forms[i]), filedAt,
      industry: text(body.sicDescription).slice(0, 160) || undefined, checkedAt: now.toISOString() };
  }
  return null;
}

/** Exact issuer metadata, at most two historical indexes, and an annual filing.
 * A 40-F additionally requires its same-accession index and declared AIF exhibit. */
export async function ensureCompanyProfile(identity: CompanyIdentity, fetchImpl: typeof fetch, now = new Date(), options: { signal?: AbortSignal; persistenceSignal?: AbortSignal; onResponseBodyFailure?: () => void } = {}) {
  const exact = { ticker: text(identity.ticker).toUpperCase(), company: text(identity.company), cik: profileCik(identity.cik) };
  if (!exact.cik || !exact.company || !/^[A-Z0-9.-]{1,12}$/.test(exact.ticker)) return null;
  if (options.signal?.aborted) return null;
  const loaded = await load({ signal: options.signal }).catch(error => {
    if (causedByRoleAbort(error, options.signal)) return null;
    console.warn(`[company-profile-storage] ${JSON.stringify({ stage: "initial", phase: "read", ticker: exact.ticker,
      writes: 0, cause: profileStorageCause(error), workDeadline: options.signal?.aborted === true,
      persistenceDeadline: options.persistenceSignal?.aborted === true, settlement: "not_attempted" })}`);
    throw error;
  });
  if (!loaded || options.signal?.aborted) return null;
  const { entries } = loaded;
  const prior = entries.find(entry => same(entry, exact));
  const cached = verifiedCompanyProfile(prior?.profile, exact, now);
  if (cached && (cached.industry || (prior?.parserRevision === COMPANY_PROFILE_PARSER_REVISION && Date.parse(prior.nextAttemptAt) > now.getTime()))) return cached;
  if (retryDeferred(prior, now)) return null;
  const entry: Entry = { ...exact, cik: exact.cik, updatedAt: now.toISOString(), nextAttemptAt: new Date(now.getTime() + 60 * 60000).toISOString(), profile: cached,
    firstVerifiedAt: prior?.firstVerifiedAt,
    // Retain historical success even when a legacy row has no first date and
    // this refresh must clear its now-invalid profile before source I/O.
    verificationHistoryKnown: prior?.verificationHistoryKnown === true || Boolean(prior?.profile) || Boolean(prior?.firstVerifiedAt) ? true : undefined,
    filing: prior?.filing, cachedParserRevision: prior?.cachedParserRevision, parserRevision: COMPANY_PROFILE_PARSER_REVISION };
  let acknowledged = prior ? snapshotEntry(prior) : undefined;
  const persistEntry = async (deadlineCleanup = false, admission = false) => { acknowledged = await store(entry, acknowledged, options.signal, deadlineCleanup, options.persistenceSignal, admission); };
  // Persist backoff before network; budget wrappers still make their own durable reservations.
  try { await persistEntry(false, true); }
  catch (error) {
    if (error instanceof ProfileCacheWriteError && error.safeRoleDeferral) return cached;
    throw error;
  }
  const request = async (url: string, complete?: (text: string) => boolean, onEof?: (bytes: Uint8Array, response: Response) => void) => {
    const response = await fetchImpl(url, { headers: { Accept: "text/html,application/json", "User-Agent": "SwingUp/1.0 support@swingup.app" }, cache: "no-store", redirect: "error", signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000) });
    return boundedText(response, complete, options.onResponseBodyFailure, onEof ? bytes => onEof(bytes, response) : undefined);
  };
  let phase = "issuer_submissions";
  try {
    const priorFilingAge = now.getTime() - Date.parse(prior?.filing?.filedAt ?? "");
    let filing = !prior?.profile && prior?.filing && priorFilingAge >= 0 && priorFilingAge <= 550 * 86400000
      && ((prior.filing.industry && now.getTime() - Date.parse(prior.filing.checkedAt ?? prior.updatedAt) <= 7 * 86400000)
        || (prior.parserRevision === COMPANY_PROFILE_PARSER_REVISION && now.getTime() - Date.parse(prior.updatedAt) <= 86400000))
      ? prior.filing : null;
    if (!filing) {
      const submissions = object(JSON.parse(await request(`https://data.sec.gov/submissions/CIK${exact.cik}.json`)));
      filing = annualFiling(submissions, exact, now); // validates root issuer before following archive references
      if (!filing) {
        const files = object(submissions.filings).files;
        const archives = (Array.isArray(files) ? files.map(object) : []).filter(file =>
          new RegExp(`^CIK${exact.cik}-submissions-\\d{3}\\.json$`).test(text(file.name))
          && Date.parse(text(file.filingTo)) >= now.getTime() - 550 * 86400000
          && Date.parse(text(file.filingFrom)) <= now.getTime())
          .sort((a, b) => text(b.filingTo).localeCompare(text(a.filingTo))).slice(0, 2);
        for (const archive of archives) {
          const recent = object(JSON.parse(await request(`https://data.sec.gov/submissions/${text(archive.name)}`)));
          if (recent.cik != null && profileCik(recent.cik) !== exact.cik) throw new Error("company_profile_issuer_mismatch");
          filing = annualFiling({ ...submissions, filings: { recent } }, exact, now);
          if (filing) break;
        }
      }
    }
    if (!filing) throw new Error("company_profile_annual_filing_unavailable");
    if (!new RegExp(`^https://www\\.sec\\.gov/Archives/edgar/data/${Number(exact.cik)}/\\d{18}/[A-Za-z0-9._-]+\\.html?$`).test(filing.url)) throw new Error("company_profile_filing_identity_mismatch");
    if (filing.form === "40-F" && !filing.annualFilingUrl) {
      phase = "annual_40f_source_resolution";
      const indexUrl = secAnnualFilingIndexUrl(filing.url, exact.cik);
      if (!indexUrl) throw new Error("company_profile_40f_identity_invalid");
      const annualHtml = await request(filing.url);
      const indexHtml = await request(indexUrl);
      const resolved = resolve40FAnnualInformationForm({ cik: exact.cik, filing, annualHtml, indexHtml });
      if (!resolved) throw new Error("company_profile_40f_aif_unverified");
      filing = { ...filing, ...resolved };
    }
    if (filing.form === "40-F" && (!filing.annualFilingUrl || filing.url === filing.annualFilingUrl
      || secAnnualFilingIndexUrl(filing.url, exact.cik) !== filing.annualFilingIndexUrl
      || secAnnualFilingIndexUrl(filing.annualFilingUrl, exact.cik) !== filing.annualFilingIndexUrl)) {
      throw new Error("company_profile_40f_identity_invalid");
    }
    if (filing.url !== prior?.filing?.url) entry.cachedParserRevision = undefined;
    entry.filing = filing;
    phase = "annual_filing";
    // Admission/backoff is already durable. Save selected filing metadata with
    // the final outcome, avoiding a redundant full-cache read/PUT here. A crash
    // may rediscover metadata on the next guarded retry; it cannot verify a row.
    const extract = (html: string, customerEvidence?: unknown) => {
      const result = inspectCompanyProfileExtraction({ identity: exact, html, form: filing.form, sourceUrl: filing.url, filedAt: filing.filedAt, now, customerEvidence, annualFilingUrl: filing.annualFilingUrl, annualFilingIndexUrl: filing.annualFilingIndexUrl });
      entry.extractionFailure = result.reason ?? undefined;
      return result.profile;
    };
    // Reuse the exact annual business section across parser retries. It is
    // issuer/accession-specific and never substitutes another company's text.
    const sourceKey = pr262StorageKey(`research-evidence/company-profile-sources/${exact.cik}/${filing.url.split("/").slice(-2).join("-")}.json`);
    const sourceSaved = await readVersionedTextFromR2(sourceKey, { signal: options.signal });
    const source = sourceSaved.found && sourceSaved.text ? object(JSON.parse(sourceSaved.text)) : {};
    const completeSaved = completeSource(source, filing, exact, now);
    const cachedSection = completeSaved.status !== "invalid" && source.layoutRevision === SOURCE_LAYOUT_REVISION && source.url === filing.url && source.filedAt === filing.filedAt ? text(source.businessText) : "";
    const sectionHeading = filing.form === "40-F" ? "DESCRIPTION OF THE BUSINESS" : filing.form === "20-F" ? "Item 4. Information on the Company" : "Item 1. Business";
    // Complete original bytes can be re-parsed after grammar or note-extraction
    // changes without another SEC request. Their original observation never moves.
    let profile = cached?.sourceUrl === filing.url ? cached : completeSaved.status === "valid" ? extract(completeSaved.html)
      : cachedSection ? extract(`${sectionHeading}\n${String(source.businessText)}`, source.financialCustomerEvidence) : null;
    // Legacy excerpts still allow positive recovery, but never claim EOF. A
    // failed old excerpt gets at most the existing one read after a parser repair.
    if (!profile && completeSaved.status !== "valid" && (!cachedSection || source.parserRevision !== COMPANY_PROFILE_PARSER_REVISION)) {
      let receipt: { bytes: Uint8Array; response: Response } | undefined;
      const html = await request(filing.url, body => {
        if (filing.form === "40-F" && !isAnnualInformationFormDocument(body)) return false;
        const candidate = extract(body);
        // Financial-note proof requires EOF, not merely a closing HTML tag in
        // an early chunk. A later body failure must still fail this request.
        return Boolean(candidate && !candidate.customerEvidence);
      }, (bytes, response) => { receipt = { bytes, response }; });
      if (filing.form === "40-F" && !isAnnualInformationFormDocument(html)) throw new Error("company_profile_aif_document_unverified");
      const extracted = extract(html);
      const businessText = annualBusinessText(html, filing.form);
      let completeRecord: CompleteSourceRecord | null = null;
      if (receipt && completeAnnualDocument(html, filing, exact, now)) {
        completeRecord = createCompleteSourceRecord({ binding: completeSourceBinding(filing, exact.cik), bytes: receipt.bytes,
          requestUrl: filing.url, finalUrl: receipt.response.url, status: receipt.response.status, eof: true, observedAt: now.toISOString() }, now);
      }
      if (businessText || completeRecord) await writeVersionedJsonToR2(sourceKey, { version: 1, layoutRevision: SOURCE_LAYOUT_REVISION, parserRevision: COMPANY_PROFILE_PARSER_REVISION, url: filing.url, filedAt: filing.filedAt, businessText, financialCustomerEvidence: extracted?.customerEvidence,
        ...(completeRecord ? { completeSource: completeRecord } : {}), collectedAt: now.toISOString() }, { ...(sourceSaved.etag ? { expectedEtag: sourceSaved.etag } : { createOnly: true }), signal: options.persistenceSignal ?? options.signal });
      profile = extracted;
    }
    if (!profile) throw new Error("company_profile_products_and_customers_not_extracted");
    if (filing.industry) profile = { ...profile, industry: filing.industry, industrySourceUrl: `https://data.sec.gov/submissions/CIK${exact.cik}.json` };
    entry.profile = profile;
    if (!entry.verificationHistoryKnown && !entry.firstVerifiedAt) entry.firstVerifiedAt = now.toISOString();
    entry.verificationHistoryKnown = true;
    entry.nextAttemptAt = new Date(now.getTime() + 30 * 86400000).toISOString();
    await persistEntry();
    console.info(JSON.stringify({ kind: "pr262_company_profile_result", ticker: exact.ticker, status: "verified", sourceFiledAt: filing.filedAt }));
    return profile;
  } catch (error) {
    if (error instanceof ProfileCacheWriteError) {
      if (error.safeRoleDeferral) return cached;
      throw error;
    }
    entry.error = options.signal?.aborted ? "company_profile_time_budget_deferred"
      : error instanceof Error ? error.message.slice(0, 200) : "company_profile_fetch_failed";
    const deadlineCleanup = entry.error === "company_profile_time_budget_deferred";
    // The role's shared deadline is not a provider outage. Retry in the next
    // scheduled pass; the durable source guard still enforces its own cadence.
    if (entry.error === "company_profile_time_budget_deferred") entry.nextAttemptAt = new Date(now.getTime() + 5 * 60000).toISOString();
    if (entry.error !== "company_profile_products_and_customers_not_extracted") delete entry.extractionFailure;
    if (/products_and_customers_not_extracted|annual_filing_unavailable/.test(entry.error)) entry.nextAttemptAt = new Date(now.getTime() + 86400000).toISOString();
    const providerRetry = entry.error.match(/next_retry_at=([^;\s]+)/)?.[1];
    if (providerRetry && Date.parse(providerRetry) > Date.parse(entry.nextAttemptAt)) entry.nextAttemptAt = providerRetry;
    // A source-cache (or source-budget) R2 fault is not a failed SEC request.
    // Preserve the existing durable backoff, but retain storage provenance in
    // saved/logged reasons and rethrow the original cause after that store.
    const taggedStorageOperation = object(error).storageDomain === "r2_state"
      ? object(error).storageOperation === "read" ? "read" : "write" : null;
    // Exact caller cancellation of a read has no ambiguous mutation. Let the
    // normal bounded deadline cleanup persist backoff. Independent storage
    // faults and every uncertain cancelled PUT must still fail truthfully.
    const storageOperation = taggedStorageOperation === "read" && causedByRoleAbort(error, options.signal)
      ? null : taggedStorageOperation;
    if (storageOperation) entry.error = `company_profile_storage_${storageOperation}_failed:${error instanceof Error ? error.message : "r2_state_storage_failed"}`.slice(0, 200);
    const reason = entry.extractionFailure ?? entry.error.match(/^company_profile_[a-z0-9_]+/i)?.[0]
      ?? (/budget|quota|cadence/i.test(entry.error) ? "provider_budget_deferred" : error instanceof Error && error.name === "TimeoutError" ? "source_timeout" : "source_request_failed");
    const storageContext = ["provider_budget_reservation", "submissions_snapshot"].includes(String(object(error).storageContext))
      ? String(object(error).storageContext) : null;
    console.info(JSON.stringify({ kind: "pr262_company_profile_result", ticker: exact.ticker, status: "pending", phase, reason,
      ...(storageOperation && storageContext ? { storageContext } : {}) }));
    await persistEntry(deadlineCleanup);
    if (storageOperation) throw error;
    return cached;
  }
}

/** Re-read saved source text after a parser repair without spending SEC calls. */
async function recoverCachedProfiles(entries: Entry[], listings: Json[], now: Date, queuedTickers: ReadonlySet<unknown> = new Set()) {
  const listedIssuers = new Set(listings.filter(row => Array.isArray(row.sourceNames) && row.sourceNames.includes("SEC company_tickers_exchange"))
    .map(row => `${row.ticker}:${profileCik(row.cik)}`));
  const eligible = entries.filter(entry => entry.filing && !entry.profile && entry.cachedParserRevision !== COMPANY_PROFILE_PARSER_REVISION
    && listedIssuers.has(`${entry.ticker}:${entry.cik}`))
    .sort((a, b) => Number(queuedTickers.has(b.ticker)) - Number(queuedTickers.has(a.ticker))
      || Date.parse(a.updatedAt) - Date.parse(b.updatedAt)).slice(0, 20);
  const recovered: Entry[] = [];
  const checked: Entry[] = [];
  for (let start = 0; start < eligible.length; start += 4) {
    const results = await Promise.allSettled(eligible.slice(start, start + 4).map(async entry => {
      const filing = entry.filing!;
      const key = pr262StorageKey(`research-evidence/company-profile-sources/${entry.cik}/${filing.url.split("/").slice(-2).join("-")}.json`);
      const saved = await readVersionedTextFromR2(key);
      const source = saved.found && saved.text ? object(JSON.parse(saved.text)) : {};
      checked.push({ ...entry, cachedParserRevision: COMPANY_PROFILE_PARSER_REVISION });
      const completeSaved = completeSource(source, filing, entry, now);
      if (completeSaved.status === "invalid") return;
      if (completeSaved.status !== "valid" && (source.layoutRevision !== SOURCE_LAYOUT_REVISION || source.url !== filing.url || source.filedAt !== filing.filedAt || !text(source.businessText))) return;
      const heading = filing.form === "40-F" ? "DESCRIPTION OF THE BUSINESS" : filing.form === "20-F" ? "Item 4. Information on the Company" : "Item 1. Business";
      const profile = extractCompanyProfile({ identity: entry, html: completeSaved.status === "valid" ? completeSaved.html : `${heading}\n${String(source.businessText)}`,
        form: filing.form, sourceUrl: filing.url, filedAt: filing.filedAt, now, customerEvidence: completeSaved.status === "valid" ? undefined : source.financialCustomerEvidence, annualFilingUrl: filing.annualFilingUrl, annualFilingIndexUrl: filing.annualFilingIndexUrl });
      if (!profile) return;
      if (filing.industry) Object.assign(profile, { industry: filing.industry, industrySourceUrl: `https://data.sec.gov/submissions/CIK${entry.cik}.json` });
      recovered.push({ ...entry, profile, verificationHistoryKnown: true, error: undefined, parserRevision: COMPANY_PROFILE_PARSER_REVISION,
        updatedAt: now.toISOString(), nextAttemptAt: new Date(now.getTime() + 30 * 86400000).toISOString() });
    }));
    for (const result of results) if (result.status === "rejected") {
      // Leave the failed read eligible next cycle; one source must not prevent
      // other saved reports from being recovered.
      console.warn(JSON.stringify({ kind: "pr262_company_profile_saved_source_retry", reason: "saved_source_read_failed" }));
    }
  }
  if (checked.length) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const current = await load();
      const updates = [...recovered, ...checked];
      const merged = current.entries.map(entry => updates.find(row => same(row, entry)
        && Date.parse(entry.updatedAt) <= Date.parse(row.updatedAt)) ?? entry);
      const result = await writeVersionedJsonToR2(KEY, { version: 1, updatedAt: now.toISOString(), entries: merged },
        current.saved.etag ? { expectedEtag: current.saved.etag } : { createOnly: true });
      if (!result.conflict) { if (!result.written) throw new Error("company_profile_cache_write_failed"); return recovered.length; }
    }
    throw new Error("company_profile_cache_conflict");
  }
  return 0;
}

export async function readCompanyProfileCoverage(now = new Date()) {
  const [{ entries }, saved] = await Promise.all([load(), readVersionedTextFromR2(UNIVERSE)]);
  const universe = saved.found && saved.text ? object(JSON.parse(saved.text)) : {};
  const listings = (Array.isArray(universe.entries) ? universe.entries.map(object) : [])
    .filter(row => profileCik(row.cik) && Array.isArray(row.sourceNames) && row.sourceNames.includes("SEC company_tickers_exchange"));
  const errors: Record<string, number> = {};
  const entryByIssuer = new Map(entries.map(entry => [`${entry.ticker}:${entry.cik}`, entry]));
  let verified = 0, industry = 0;
  for (const row of listings) {
    const entry = entryByIssuer.get(`${row.ticker}:${profileCik(row.cik)}`);
    const profile = entry && verifiedCompanyProfile(entry.profile, entry, now);
    if (profile) { verified++; if (profile.industry) industry++; }
    else if (entry?.error) {
      const reason = entry.extractionFailure ?? entry.error.match(/^company_profile_[a-z0-9_]+/i)?.[0]
        ?? (/quota|budget|cadence/i.test(entry.error) ? "provider_budget_deferred" : "source_request_failed");
      errors[reason] = (errors[reason] ?? 0) + 1;
    }
  }
  return { checkedAt: now.toISOString(), totalCompanies: listings.length, verifiedProfiles: verified,
    profilesWithIndustry: industry, missingProfiles: listings.length - verified, pendingReasons: errors };
}

/** The maintenance input is the raw foundation, never the profile-filtered public feed. */
export async function warmFoundationCompanyProfiles(fetchImpl: typeof fetch, now = new Date(), options: { signal?: AbortSignal } = {}) {
  const cadenceKey = pr262StorageKey("research-evidence/company-profile-maintenance-v1.json");
  const cadence = await readVersionedTextFromR2(cadenceKey);
  const previousPass = cadence.found && cadence.text ? object(JSON.parse(cadence.text)) : {};
  const last = Date.parse(text(previousPass.checkedAt));
  if (Number.isFinite(last) && now.getTime() - last < 15 * 60000) return { attempted: 0, verified: 0 };
  const turn = ((Number(previousPass.turn) || 0) + 1) % 4;
  const reservation = await writeVersionedJsonToR2(cadenceKey, { version: 1, checkedAt: now.toISOString(), turn },
    cadence.etag ? { expectedEtag: cadence.etag } : { createOnly: true });
  if (!reservation.written || reservation.conflict) return { attempted: 0, verified: 0 };
  const [foundation, universe, cached, sensor, exposure] = await Promise.all([
    readVersionedTextFromR2(pr262StorageKey("value-investing/resumable/latest/index.json")),
    readVersionedTextFromR2(UNIVERSE), load(), readVersionedTextFromR2(pr262StorageKey("sensor/state-v1.json")),
    readVersionedTextFromR2(pr262StorageKey("sensor/exposure-index-v1.json")),
  ]);
  const snapshot = foundation.found && foundation.text ? object(JSON.parse(foundation.text)) : {};
  const listed = universe.found && universe.text ? object(JSON.parse(universe.text)) : {};
  if (listed.version !== 1) return { attempted: 0, verified: 0 };
  const universeRows = Array.isArray(listed.entries) ? listed.entries.map(object) : [];
  const groups = object(snapshot.seriousAlerts);
  const sensorState = sensor.found && sensor.text ? object(JSON.parse(sensor.text)) : {};
  const pending = Array.isArray(sensorState.pending) ? sensorState.pending.map(object).filter(event => now.getTime() - Date.parse(text(event.observedAt)) < 3 * 86400000) : [];
  const queuedTickers = new Set(pending.map(row => row.ticker));
  const recoveredFromSavedSources = await recoverCachedProfiles(cached.entries, universeRows, now, queuedTickers);
  const entries = recoveredFromSavedSources ? (await load()).entries : cached.entries;
  const exposureRows = exposure.found && exposure.text ? object(JSON.parse(exposure.text)).entries : [];
  const opportunities = [groups.buy, groups.sell, groups.watchOut, snapshot.qualityPriceWatchlist].flatMap(group => Array.isArray(group) ? group.map(object) : []);
  const priorityTickers = new Set([...pending, ...opportunities].map(row => row.ticker));
  const valuationTickers = new Set(opportunities.map(row => row.ticker));
  const freshQueuedTickers = new Set(pending.filter(row => now.getTime() - Date.parse(text(row.observedAt)) <= 86400000).map(row => row.ticker));
  const freshOfficialTickers = new Set(pending.filter(row => now.getTime() - Date.parse(text(row.observedAt)) <= 86400000
    && (row.source === "sec" || row.source === "official" || /^(issuer_ir_|issuer_sec_)/.test(text(row.sourceProvider)))).map(row => row.ticker));
  const queuedEventIds = new Map<unknown, Set<string>>();
  for (const event of pending) {
    const ids = queuedEventIds.get(event.ticker) ?? new Set<string>();
    ids.add(text(event.id) || `${event.ticker}:${event.observedAt}`);
    queuedEventIds.set(event.ticker, ids);
  }
  const listingByTicker = new Map(universeRows.filter(row => Array.isArray(row.sourceNames) && row.sourceNames.includes("SEC company_tickers_exchange"))
    .map(row => [row.ticker, row]));
  const entryByIssuer = new Map(entries.map(entry => [`${entry.ticker}:${entry.cik}`, entry]));
  const selectedTickers = new Set<unknown>();
  const candidates: Json[] = [...pending, ...opportunities, ...(Array.isArray(exposureRows) ? exposureRows.map(object) : []),
    ...universeRows.map(row => ({ ...row, company: row.company || row.name }))];
  const due = candidates.flatMap(candidate => {
    if (selectedTickers.has(candidate.ticker)) return [];
    const listing = listingByTicker.get(candidate.ticker);
    const cik = profileCik(listing?.cik);
    if (!cik) return [];
    if (candidate.cik && profileCik(candidate.cik) !== cik) return [];
    const identity = { ticker: candidate.ticker, company: candidate.company || listing?.company || listing?.name, cik };
    const stored = entryByIssuer.get(`${candidate.ticker}:${cik}`);
    const saved = stored && same(stored, identity) ? stored : undefined;
    const verified = verifiedCompanyProfile(saved?.profile, identity, now);
    if ((verified && (verified.industry || (saved?.parserRevision === COMPANY_PROFILE_PARSER_REVISION && Date.parse(saved.nextAttemptAt) > now.getTime()))) || retryDeferred(saved, now)) return [];
    selectedTickers.add(candidate.ticker);
    return [{ identity, priority: freshOfficialTickers.has(candidate.ticker) ? 5 : freshQueuedTickers.has(candidate.ticker) ? 4 : queuedTickers.has(candidate.ticker) ? 3
      : valuationTickers.has(candidate.ticker) ? 2 : priorityTickers.has(candidate.ticker) ? 1 : 0,
      blockedEvents: queuedEventIds.get(candidate.ticker)?.size ?? 0, lastAttempt: Date.parse(saved?.updatedAt ?? "") || 0 }];
  }).sort((a, b) => b.priority - a.priority || a.lastAttempt - b.lastAttempt || b.blockedEvents - a.blockedEvents);
  // Keep the same two slots. Most serve queued issuers; every fourth pass
  // retains one background turn, and every second turn serves the oldest
  // previously attempted queued issuer so new arrivals cannot starve retries.
  const selected = due.slice(0, 1);
  const background = turn === 0 ? due.find(row => row.priority === 0 && !selected.includes(row)) : undefined;
  const retained = turn === 2 ? due.filter(row => row.blockedEvents > 0 && row.lastAttempt > 0 && !selected.includes(row))
    .sort((a, b) => a.lastAttempt - b.lastAttempt)[0] : undefined;
  const secondSlot = background ?? retained ?? due.find(row => !selected.includes(row));
  if (secondSlot) selected.push(secondSlot);
  let attempted = 0, verified = 0;
  let nextRequestAt = 0;
  let pacingTail: Promise<void> = Promise.resolve();
  const pacedFetch: typeof fetch = async (request, init) => {
    const ready = pacingTail.then(async () => {
      await pause(Math.max(0, nextRequestAt - Date.now()), undefined, { signal: init?.signal ?? options.signal });
      nextRequestAt = Date.now() + 250;
    });
    pacingTail = ready.catch(() => undefined);
    await ready;
    return fetchImpl(request, init);
  };
  let cursor = 0;
  const worker = async () => {
    while (cursor < selected.length && !options.signal?.aborted) {
      const candidate = selected[cursor++];
      attempted++;
      // Keep both slots useful: a slow issuer must not hold the other slot idle.
      const profile = await ensureCompanyProfile(candidate.identity, pacedFetch, now, options).catch(() => null);
      if (profile) verified++;
    }
  };
  await Promise.all([worker(), worker()]);
  return { attempted, verified, eligibleCompanies: due.length, maximumCompaniesPerPass: 2, deadlineReached: options.signal?.aborted === true,
    queuedCompaniesSelected: selected.filter(row => row.blockedEvents > 0).length,
    queuedEventsCoveredBySelection: selected.reduce((total, row) => total + row.blockedEvents, 0),
    backgroundTurn: Boolean(background),
    ...(recoveredFromSavedSources ? { recoveredFromSavedSources } : {}) };
}
