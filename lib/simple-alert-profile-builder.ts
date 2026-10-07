import crypto from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import { readVersionedTextFromR2, writeVersionedJsonToR2 } from "@/lib/r2-warehouse";
import { pr262StorageKey } from "@/lib/opportunity-engine/pr262-storage";
import { isSimpleAlertPilot } from "@/lib/simple-alert-pilot-runtime";
import { pilotCompanies } from "@/lib/simple-alert-pilot-scope";
import { ensureCompanyProfile } from "@/lib/opportunity-engine/company-profile-cache";
import { COMPANY_PROFILE_PARSER_REVISION, profileCik, verifiedCompanyProfile } from "@/lib/company-profile";
import { loadEquityUniverse } from "@/lib/equity-signal/universe";
import { createPr262SensorBudgetedFetch } from "@/lib/opportunity-engine/pr262-sensor-fetch-budget";

type Row = Record<string, unknown>;
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
export const PROFILE_DAILY_TARGET = 500;
const MAX_ATTEMPTS_PER_DAY = 2500;
const MAX_ATTEMPTS_PER_RUN = 100;
// Stop admitting a new issuer early enough that its admission record,
// provider-budget reservation, bounded source request and final cache write can
// settle before the existing source cutoff. This reduces capacity; it does not
// raise a source, storage, request or role deadline.
const PROFILE_ADMISSION_BUDGET_MS = 100_000;
// Reserve the end of the existing profile window for settled-worker counts:
// source/admission stops first; already-started storage has a separate
// bounded persistence window before the authoritative count read. Summary
// persistence must finish before the caller's 240s HTTP timeout.
const PROFILE_WORK_BUDGET_MS = 140_000;
const PROFILE_PERSISTENCE_DEADLINE_MS = 160_000;
const PROFILE_COUNT_DEADLINE_MS = 175_000;
const PROFILE_SUMMARY_DEADLINE_MS = 235_000;
const profilesKey = () => pr262StorageKey("research-evidence/company-profiles-v1.json");
async function read(key: string, signal?: AbortSignal) {
  const saved = await readVersionedTextFromR2(key, { signal });
  return { saved, value: saved.found && saved.text ? object(JSON.parse(saved.text)) : {} };
}
const dayOf = (date: Date) => new Date(date.getTime() + 7 * 3600_000).toISOString().slice(0, 10);

/** Coverage is checked against the current cohort, not broad daily production. */
export function pilotProfileCoverage(entries: Row[], now: Date) {
  const companies = pilotCompanies();
  const matching = (company: typeof companies[number]) => entries.filter(row => row.ticker === company.ticker && profileCik(row.cik) === company.cik);
  const verifiedTickers = companies.filter(company => matching(company).some(row => verifiedCompanyProfile(row.profile, company, now))).map(company => company.ticker);
  const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
  const missing = companies.filter(company => !verifiedTickers.includes(company.ticker)).map(company => {
    const row = matching(company).sort((left, right) => Date.parse(String(right.updatedAt ?? "")) - Date.parse(String(left.updatedAt ?? "")))[0];
    const filing = object(row?.filing);
    const extraction = typeof row?.extractionFailure === "string" && /^company_profile_[a-z0-9_]{1,100}$/.test(row.extractionFailure) ? row.extractionFailure : null;
    const error = typeof row?.error === "string" ? row.error : "";
    const reason = !row ? "cache_entry_missing" : extraction
      ?? (/^company_profile_time_budget_deferred\b/.test(error) ? "company_profile_time_budget_deferred" : null)
      ?? (/budget|quota|cadence/.test(error) ? "provider_budget_deferred" : error.match(/^company_profile_[a-z0-9_]{1,100}/)?.[0])
      ?? (error ? "source_request_failed" : "cached_profile_fails_current_verification");
    const url = typeof filing.url === "string" && new RegExp(`^https://www\\.sec\\.gov/Archives/edgar/data/${Number(company.cik)}/[0-9]{18}/[A-Za-z0-9._-]+\\.html?$`).test(filing.url) ? filing.url : null;
    return { ticker: company.ticker, cik: company.cik, reason, cacheEntryFound: Boolean(row),
      parserRevision: Number.isInteger(row?.parserRevision) ? row.parserRevision : null,
      currentParserRevision: COMPANY_PROFILE_PARSER_REVISION, updatedAt: date(row?.updatedAt), nextAttemptAt: date(row?.nextAttemptAt),
      sourceUrl: url, sourceKey: url ? pr262StorageKey(`research-evidence/company-profile-sources/${company.cik}/${url.split("/").slice(-2).join("-")}.json`) : null,
      filingForm: typeof filing.form === "string" && /^[A-Z0-9/-]{1,16}$/.test(filing.form) ? filing.form : null,
      filingDate: date(filing.filedAt) };
  });
  return { configuredCompanies: companies.length, verifiedCompanies: verifiedTickers.length, verifiedTickers,
    currentVerificationApplied: true, missingTickers: missing.map(row => row.ticker), missing };
}

/** A repair or ticker alias cannot create another first-time company. */
export function firstVerifiedCompaniesThisRun(before: Row[], after: Row[], now: Date, startedAt = now.getTime()) {
  const knownRows = before.filter(row => {
    const firstAt = row.firstVerifiedAt ?? object(row.profile).verifiedAt;
    return row.verificationHistoryKnown === true || Number.isFinite(Date.parse(String(firstAt ?? "")));
  });
  const priorIssuers = new Set(knownRows.map(row => profileCik(row.cik)));
  return new Set(after.filter(row => typeof row.firstVerifiedAt === "string" && Number.isFinite(Date.parse(row.firstVerifiedAt))
    && Date.parse(row.firstVerifiedAt) >= startedAt && Date.parse(row.firstVerifiedAt) <= now.getTime()
    && !priorIssuers.has(profileCik(row.cik)) && verifiedCompanyProfile(row.profile, row, now))
    .map(row => profileCik(row.cik))).size;
}

/** One source-verified company (CIK), never a second share class or refresh. */
export function profileBatchPlan(listings: Row[], entries: Row[], now: Date, limit: number) {
  const day = dayOf(now);
  const valid = entries.filter(row => verifiedCompanyProfile(row.profile, row, now));
  const validIssuers = new Set(valid.map(row => profileCik(row.cik)));
  // Keep the earliest known verification across every alias, including expired
  // profiles. A newly profiled second listing must not reset a company's age.
  const firstByIssuer = new Map<string, number>();
  // A historical success without its first date cannot become new-today via
  // another ticker. Known first dates remain countable after later refreshes.
  const unknownFirstDateIssuers = new Set<string>();
  for (const row of entries) {
    const cik = profileCik(row.cik);
    const at = Date.parse(String(row.firstVerifiedAt ?? object(row.profile).verifiedAt ?? ""));
    if (cik && row.verificationHistoryKnown === true && !Number.isFinite(Date.parse(String(row.firstVerifiedAt ?? "")))) unknownFirstDateIssuers.add(cik);
    if (cik && Number.isFinite(at) && at <= now.getTime()) firstByIssuer.set(cik, Math.min(firstByIssuer.get(cik) ?? Infinity, at));
  }
  const newlyVerifiedToday = [...validIssuers].filter(cik => cik && !unknownFirstDateIssuers.has(cik) && firstByIssuer.has(cik)
    && dayOf(new Date(firstByIssuer.get(cik)!)) === day
    && valid.some(row => profileCik(row.cik) === cik && typeof row.firstVerifiedAt === "string")).length;
  const cohort = new Set(pilotCompanies().map(row => row.ticker));
  const stored = new Map<string, Row[]>();
  for (const row of entries) {
    const cik = profileCik(row.cik);
    if (cik) stored.set(cik, [...(stored.get(cik) ?? []), row]);
  }
  let ineligibleListings = 0, duplicateIssuerListings = 0;
  const issuers = new Map<string, { ticker: string; cik: string; company: string; directoryConfirmed: boolean }>();
  for (const row of listings) {
    const ticker = String(row.ticker ?? ""), cik = profileCik(row.cik), company = String(row.name ?? row.company ?? "");
    // The declared universe scope is not enough: SEC's file also has OTC rows.
    // Require explicit exchange and common/ADR evidence from this listing.
    if (!cik || !company || !/^[A-Z0-9.-]{1,12}$/.test(ticker)
      || !["common_stock", "adr"].includes(String(row.securityType))
      || !/^(?:NASDAQ|NYSE(?: American| Arca)?|Cboe BZX|IEXG)$/i.test(String(row.exchange ?? ""))
      || !Array.isArray(row.sourceNames) || !row.sourceNames.includes("SEC company_tickers_exchange")) {
      ineligibleListings++; continue;
    }
    const candidate = { ticker, cik, company, directoryConfirmed: row.sourceNames.some(source => String(source).startsWith("Nasdaq Trader")) };
    const prior = issuers.get(cik);
    if (prior) duplicateIssuerListings++;
    // CIK, not ticker spelling, establishes shared issuer identity. Prefer the
    // fixed pilot or a security-directory-confirmed listing as representative.
    // Shorter aliases break ties only; no security type is inferred from suffix.
    const rank = (value: typeof candidate) => Number(cohort.has(value.ticker)) * 2 + Number(value.directoryConfirmed);
    if (!prior || rank(candidate) > rank(prior)
      || (rank(candidate) === rank(prior) && (candidate.ticker.length < prior.ticker.length
        || (candidate.ticker.length === prior.ticker.length && candidate.ticker.localeCompare(prior.ticker) < 0)))) issuers.set(cik, candidate);
  }
  const due = [...issuers.values()].flatMap(identity => {
    if (validIssuers.has(identity.cik)) return [];
    const previous = stored.get(identity.cik) ?? [];
    const deferred = previous.some(row => {
      const parserRepair = ["company_profile_products_and_customers_not_extracted", "company_profile_annual_filing_unavailable"].includes(String(row.error))
        && row.parserRevision !== COMPANY_PROFILE_PARSER_REVISION;
      // A formerly verified profile can become invalid under current quality
      // checks. Its old refresh date must not prevent one normal guarded retry.
      // ensureCompanyProfile persists a null-profile backoff before source I/O.
      const invalidCachedProfile = Boolean(row.profile) && !row.error && !verifiedCompanyProfile(row.profile, row, now);
      return !parserRepair && !invalidCachedProfile && Date.parse(String(row.nextAttemptAt ?? "")) > now.getTime();
    });
    if (deferred) return [];
    return [{ ...identity, lastAttempt: Math.max(0, ...previous.map(row => Date.parse(String(row.updatedAt ?? "")) || 0)) }];
  }).sort((a, b) => a.lastAttempt - b.lastAttempt || a.ticker.localeCompare(b.ticker));
  const pilot = due.filter(row => cohort.has(row.ticker));
  const fresh = due.filter(row => !cohort.has(row.ticker) && !row.lastAttempt);
  const retries = due.filter(row => !cohort.has(row.ticker) && row.lastAttempt);
  const ordered = [...pilot];
  // An endless supply of untouched issuers cannot starve due retries. Reserve
  // each fourth background slot for the oldest retry, without ignoring backoff.
  let freshCursor = 0, retryCursor = 0, slot = 0;
  while (freshCursor < fresh.length || retryCursor < retries.length) {
    const retryTurn = slot++ % 4 === 3 || freshCursor >= fresh.length;
    ordered.push(retryTurn && retryCursor < retries.length ? retries[retryCursor++]
      : freshCursor < fresh.length ? fresh[freshCursor++] : retries[retryCursor++]);
  }
  return { newlyVerifiedToday, due: ordered.slice(0, Math.max(0, Math.min(limit, PROFILE_DAILY_TARGET - newlyVerifiedToday))),
    eligible: due.length, ineligibleListings, duplicateIssuerListings, dueRetries: due.filter(row => row.lastAttempt > 0).length };
}

export async function runSimpleAlertProfileBuilder(now = new Date(), fetchImpl: typeof fetch = fetch) {
  if (!isSimpleAlertPilot() || process.env.SWING_UP_SIMPLE_PILOT_ROLE !== "profiles") throw new Error("simple_pilot_profile_role_required");
  const startedAt = Date.now();
  const admissionSignal = AbortSignal.timeout(PROFILE_ADMISSION_BUDGET_MS);
  const signal = AbortSignal.timeout(PROFILE_WORK_BUDGET_MS);
  const persistenceSignal = AbortSignal.timeout(PROFILE_PERSISTENCE_DEADLINE_MS);
  const countSignal = AbortSignal.timeout(PROFILE_COUNT_DEADLINE_MS);
  const summarySignal = AbortSignal.timeout(PROFILE_SUMMARY_DEADLINE_MS);
  const day = dayOf(now), key = pr262StorageKey(`pilot/profile-builder/${day}.json`), owner = crypto.randomUUID();
  const loaded = await read(key, signal);
  if (Date.parse(String(loaded.value.leaseUntil ?? "")) > now.getTime()) return { ok: true, status: "busy", target: PROFILE_DAILY_TARGET };
  const alreadyReserved = Number(loaded.value.attemptsReserved) || 0;
  const count = Math.max(0, Math.min(MAX_ATTEMPTS_PER_RUN, MAX_ATTEMPTS_PER_DAY - alreadyReserved));
  if (!count) return { ok: true, status: "daily_attempt_limit", target: PROFILE_DAILY_TARGET, attemptsReserved: alreadyReserved };
  const state: Row = { ...loaded.value, version: 1, day, owner, leaseUntil: new Date(now.getTime() + 5 * 60000).toISOString(),
    attemptsReserved: alreadyReserved + count, target: PROFILE_DAILY_TARGET, updatedAt: now.toISOString() };
  const claim = await writeVersionedJsonToR2(key, state, { ...(loaded.saved.etag ? { expectedEtag: loaded.saved.etag } : { createOnly: true }), signal });
  if (!claim.written || claim.conflict) return { ok: true, status: "busy", target: PROFILE_DAILY_TARGET };
  let nextRequest = 0, requests = 0, requestFailures = 0, responseBodyFailures = 0, circuitOpen = false;
  let pacingTail: Promise<void> = Promise.resolve();
  const paced: typeof fetch = async (request, init) => {
    const requestSignal = init?.signal ? AbortSignal.any([signal, init.signal]) : signal;
    const ready = pacingTail.then(async () => {
      requestSignal.throwIfAborted();
      if (circuitOpen) throw new Error("simple_profile_source_cooldown");
      await pause(Math.max(0, nextRequest - Date.now()), undefined, { signal: requestSignal });
      requestSignal.throwIfAborted();
      if (circuitOpen) throw new Error("simple_profile_source_cooldown");
      nextRequest = Date.now() + 1000;
    });
    pacingTail = ready.catch(() => undefined);
    await ready;
    requests++;
    try {
      const response = await fetchImpl(request, { ...init, signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal });
      if (!response.ok) requestFailures++;
      if ([403, 429].includes(response.status)) circuitOpen = true;
      return response;
    } catch (error) { requestFailures++; throw error; }
  };
  let attempted = 0, verified = 0, status = "completed", failure: string | null = null;
  type OperationFamily = "provider_initialization" | "universe" | "profile_plan" | "profile_workers" | "count_reconciliation" | "provider_flush";
  let operationFamily: OperationFamily = "provider_initialization";
  let failureOperationFamily: OperationFamily | null = null;
  let before: number | null = null, after: number | null = null, firstVerifiedThisRun: number | null = null;
  let failureCategory: "storage" | "source" | "runtime" | null = null;
  let storageFailureObserved = false, countReconciliationFailure: string | null = null;
  let reconcileCounts: (() => Promise<void>) | null = null;
  const isStorageFailure = (error: unknown) => object(error).storageDomain === "r2_state"
    || /^(?:r2_|R2 |company_profile_cache_|simple_profile_(?:lease_lost|summary_not_saved))/.test(error instanceof Error ? error.message : String(error));
  const readProfileCache = async (readSignal = signal) => {
    try { return await read(profilesKey(), readSignal); }
    catch (error) { storageFailureObserved = true; throw error; }
  };
  let eligibility: Row = {}, retryAttempts = 0;
  let cohortProfiles: ReturnType<typeof pilotProfileCoverage> | null = null;
  const pendingReasons: Record<string, number> = {};
  const attemptedIssuers = new Set<string>(), acknowledgedVerifiedIssuers = new Set<string>();
  try {
    const provider = await createPr262SensorBudgetedFetch({ now, fetchImpl: paced, signal, persistenceSignal });
    operationFamily = "universe";
    const universe = await loadEquityUniverse(provider.fetchImpl, now);
    if (now.getTime() - Date.parse(universe.snapshot.refreshedAt) > 86400_000) throw new Error("simple_profile_universe_stale");
    operationFamily = "profile_plan";
    const cache = await readProfileCache();
    const entries = Array.isArray(cache.value.entries) ? cache.value.entries.map(object) : [];
    const plan = profileBatchPlan(universe.snapshot.entries, entries, now, count);
    before = plan.newlyVerifiedToday;
    // Counts describe durable cache rows, never merely completed attempts.
    // Keep this read reusable after workers settle with a storage error.
    reconcileCounts = async () => {
      if (countSignal.aborted || Date.now() - startedAt >= PROFILE_COUNT_DEADLINE_MS) throw new Error("profile_count_reconciliation_deadline");
      // Count reconciliation cannot inherit the already-aborted work signal.
      // This is read-only: an uncertain PUT still fails the run, even when
      // the authoritative cache later establishes truthful production counts.
      const fresh = await readProfileCache(countSignal);
      if ((!fresh.saved.found && (entries.length > 0 || verified > 0 || status === "failed"))
        || (fresh.saved.found && !Array.isArray(fresh.value.entries))) throw new Error("r2_profile_reconciliation_cache_unavailable");
      const freshEntries = Array.isArray(fresh.value.entries) ? fresh.value.entries.map(object) : [];
      const validIssuers = new Set(freshEntries.filter(row => verifiedCompanyProfile(row.profile, row, new Date())).map(row => profileCik(row.cik)));
      if ([...acknowledgedVerifiedIssuers].some(cik => !validIssuers.has(cik))) throw new Error("r2_profile_reconciliation_verified_rows_missing");
      after = profileBatchPlan(universe.snapshot.entries, freshEntries, new Date(), 0).newlyVerifiedToday;
      cohortProfiles = pilotProfileCoverage(freshEntries, new Date());
      firstVerifiedThisRun = firstVerifiedCompaniesThisRun(entries, freshEntries, new Date(), startedAt);
      for (const row of freshEntries) {
        const cik = profileCik(row.cik);
        if (!cik || !attemptedIssuers.has(cik) || Date.parse(String(row.updatedAt ?? "")) < startedAt
          || verifiedCompanyProfile(row.profile, row, new Date())) continue;
        const error = String(row.error ?? "");
        const reason = typeof row.extractionFailure === "string" ? row.extractionFailure
          : /^company_profile_time_budget_deferred\b/i.test(error) ? "company_profile_time_budget_deferred"
          : /budget|quota|cadence/i.test(error) ? "provider_budget_deferred"
          : error.match(/^company_profile_[a-z0-9_]+/i)?.[0] ?? "source_request_failed";
        pendingReasons[reason] = (pendingReasons[reason] ?? 0) + 1;
      }
    };
    eligibility = { eligibleCompanies: plan.eligible, ineligibleListings: plan.ineligibleListings,
      duplicateIssuerListings: plan.duplicateIssuerListings, dueRetries: plan.dueRetries };
    status = before >= PROFILE_DAILY_TARGET ? "target_reached" : plan.due.length ? "completed" : "no_due_profiles";
    let cursor = 0, workerFailed = false;
    const worker = async () => {
      while (cursor < plan.due.length && !admissionSignal.aborted && !signal.aborted && !circuitOpen && !workerFailed) {
        const identity = plan.due[cursor++];
        attempted++; attemptedIssuers.add(identity.cik);
        if (identity.lastAttempt) retryAttempts++;
        try {
          if (await ensureCompanyProfile(identity, provider.fetchImpl, new Date(), { signal, persistenceSignal,
            // Headers/connect errors are counted by paced fetch; body failures
            // belong to that same request, not an invented additional attempt.
            onResponseBodyFailure: () => { requestFailures++; responseBodyFailures++; },
          })) { verified++; acknowledgedVerifiedIssuers.add(identity.cik); }
        } catch (error) { workerFailed = true; throw error; }
      }
    };
    // Overlap only independent issuer work. Provider reservations and network
    // starts stay serialized; global quotas and 1 request/second are unchanged.
    operationFamily = "profile_workers";
    const results = await Promise.allSettled([worker(), worker()]);
    const rejected = results.find(result => result.status === "rejected");
    if (rejected?.status === "rejected") throw rejected.reason;
    operationFamily = "count_reconciliation";
    await reconcileCounts();
    if (circuitOpen) status = "source_cooldown";
    else if (admissionSignal.aborted || signal.aborted) status = "time_budget_reached";
    else if (after !== null && after >= PROFILE_DAILY_TARGET) status = "target_reached";
    operationFamily = "provider_flush";
    await provider.flush();
  } catch (error) {
    status = "failed"; failure = error instanceof Error ? error.message.slice(0, 250) : "profile_builder_failed";
    failureOperationFamily = operationFamily;
    failureCategory = storageFailureObserved || isStorageFailure(error) ? "storage"
      : /^(?:official_equity_universe_|simple_profile_universe_stale)/.test(failure) ? "source" : "runtime";
    storageFailureObserved = failureCategory === "storage";
  }
  if (firstVerifiedThisRun === null && reconcileCounts) {
    // One ordinary bounded R2 read, not a source/write retry. A transient PUT
    // failure cannot turn already saved profiles into zero reported production.
    // The failed run stays failed even if its durable counts can be reconciled.
    // Both successful and failed workers share the reserved count deadline.
    if (countSignal.aborted || Date.now() - startedAt >= PROFILE_COUNT_DEADLINE_MS) countReconciliationFailure = "profile_count_reconciliation_deadline";
    else try { await reconcileCounts(); }
    catch (error) {
      after = null; firstVerifiedThisRun = null;
      countReconciliationFailure = error instanceof Error ? error.message.slice(0, 250) : "profile_count_reconciliation_failed";
      storageFailureObserved ||= isStorageFailure(error);
    }
  }
  const summary = { ok: status !== "failed", checkedAt: new Date().toISOString(), status, target: PROFILE_DAILY_TARGET,
    attempted, unverifiedThisRun: attempted - verified, verificationYieldPercent: attempted ? verified / attempted * 100 : null, verifiedThisRun: verified, newlyVerifiedThisRun: firstVerifiedThisRun, newlyVerifiedToday: after, remaining: after === null ? null : Math.max(0, PROFILE_DAILY_TARGET - after),
    verificationCountsStatus: firstVerifiedThisRun === null ? "unreconciled" : "cache_reconciled",
    lastReconciledNewlyVerifiedToday: after ?? before, countReconciliationFailure,
    failureCategory, failureOperationFamily, storageFailureObserved, failureRateBasis: "source_requests_only",
    requests, requestFailures, responseBodyFailures, failureRatePercent: requests ? requestFailures / requests * 100 : null,
    ...eligibility, cohortProfiles, retryAttempts, pendingReasons, durationMs: Date.now() - startedAt, concurrency: 2,
    modelCalls: 0, failure, guarantees500: false };
  const current = await read(key, summarySignal);
  if (current.value.owner !== owner) throw new Error("simple_profile_lease_lost");
  const saved = await writeVersionedJsonToR2(key, { ...state, ...summary, leaseUntil: null,
    // Unused reserved slots can be safely returned once this process settles.
    attemptsReserved: alreadyReserved + attempted, totalAttempts: (Number(state.totalAttempts) || 0) + attempted,
    // Preserve the last known count when this run could not reconcile it.
    // Admission still uses a fresh issuer-level cache plan on the next run.
    totalVerified: after ?? before ?? state.totalVerified ?? null }, { expectedEtag: current.saved.etag!, signal: summarySignal });
  if (!saved.written || saved.conflict) throw new Error("simple_profile_summary_not_saved");
  console.info(`[simple-profile-builder] ${JSON.stringify(summary)}`);
  return summary;
}
