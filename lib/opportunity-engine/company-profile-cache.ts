import { setTimeout as pause } from "node:timers/promises";
import { readVersionedTextFromR2, writeVersionedJsonToR2 } from "@/lib/r2-warehouse";
import { pr262StorageKey } from "@/lib/opportunity-engine/pr262-storage";
import { COMPANY_PROFILE_PARSER_REVISION, annualBusinessText, extractCompanyProfile, profileCik, sameCompanyName, verifiedCompanyProfile, type CompanyIdentity, type VerifiedCompanyProfile } from "@/lib/company-profile";
const KEY = pr262StorageKey("research-evidence/company-profiles-v1.json");
const UNIVERSE = pr262StorageKey("equity-universe/v1.json");
type Json = Record<string, unknown>;
const object = (v: unknown): Json => v && typeof v === "object" && !Array.isArray(v) ? v as Json : {};
const text = (v: unknown) => typeof v === "string" ? v.trim() : "";
type Filing = { url: string; form: string; filedAt: string; industry?: string; checkedAt?: string };
type Entry = { ticker: string; company: string; cik: string; updatedAt: string; nextAttemptAt: string; profile: VerifiedCompanyProfile | null; filing?: Filing; error?: string; parserRevision?: number; cachedParserRevision?: number };
async function load() {
  const saved = await readVersionedTextFromR2(KEY);
  const body = saved.found && saved.text ? object(JSON.parse(saved.text)) : {};
  return { saved, entries: Array.isArray(body.entries) ? body.entries as Entry[] : [] };
}
function same(entry: CompanyIdentity, identity: CompanyIdentity) {
  return entry.ticker === identity.ticker && sameCompanyName(entry.company, identity.company) && profileCik(entry.cik) === profileCik(identity.cik);
}
function retryDeferred(entry: Entry | undefined, now: Date) {
  // Revisit parsing failures once after a parser repair, using the saved exact
  // source first. Network and provider-budget failures retain their backoff.
  if (entry?.error === "company_profile_products_and_customers_not_extracted"
    && entry.parserRevision !== COMPANY_PROFILE_PARSER_REVISION) return false;
  // A successful profile's refresh date must not defer replacement after current verification rejects it.
  // Pending and failed attempts persist a null profile and still retain their retrieval backoff.
  return !entry?.profile && Date.parse(entry?.nextAttemptAt ?? "") > now.getTime();
}
async function store(entry: Entry) {
  for (let i = 0; i < 4; i++) {
    const { saved, entries } = await load();
    const result = await writeVersionedJsonToR2(KEY, { version: 1, updatedAt: entry.updatedAt,
      entries: [entry, ...entries.filter(row => row.cik !== entry.cik || row.ticker !== entry.ticker)] },
    saved.etag ? { expectedEtag: saved.etag } : { createOnly: true });
    if (!result.conflict) { if (!result.written) throw new Error("company_profile_cache_write_failed"); return; }
  }
  throw new Error("company_profile_cache_conflict");
}

/** Cache-only read. Re-check the current authoritative ticker/CIK mapping before public use. */
export async function readCompanyProfiles(identities: CompanyIdentity[], now = new Date()) {
  const result = new Map<string, VerifiedCompanyProfile>();
  const [{ entries }, universeSaved] = await Promise.all([load(), readVersionedTextFromR2(UNIVERSE)]);
  const universe = universeSaved.found && universeSaved.text ? object(JSON.parse(universeSaved.text)) : {};
  if (universe.version !== 1 || universe.scope !== "active_us_exchange_listed_common_equities_and_adrs") return result;
  const listings = Array.isArray(universe.entries) ? universe.entries.map(object) : [];
  for (const identity of identities) {
    const ticker = text(identity.ticker).toUpperCase();
    const listing = listings.find(row => row.ticker === ticker && Array.isArray(row.sourceNames) && row.sourceNames.includes("SEC company_tickers_exchange"));
    const cik = profileCik(listing?.cik);
    if (!cik || (identity.cik && profileCik(identity.cik) !== cik)) continue;
    const exact = { ticker, company: identity.company, cik };
    const cached = entries.find(entry => same(entry, exact));
    const verified = verifiedCompanyProfile(cached?.profile, exact, now);
    if (verified) result.set(ticker, verified);
  }
  return result;
}

async function boundedText(response: Response, complete?: (text: string) => boolean) {
  const maximumBytes = complete ? 12_000_000 : 2_000_000;
  if (!response.ok) throw new Error(`company_profile_http_${response.status}`);
  if (!complete && Number(response.headers.get("content-length") ?? 0) > maximumBytes) throw new Error("company_profile_document_too_large");
  if (!response.body) throw new Error("company_profile_empty_response");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0, body = "", lastChecked = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return body + decoder.decode();
      size += chunk.value.byteLength;
      if (size > maximumBytes) throw new Error("company_profile_document_too_large");
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
function annualFiling(body: Json, identity: CompanyIdentity, now: Date): Filing | null {
  if (profileCik(body.cik) !== profileCik(identity.cik) || !Array.isArray(body.tickers)
    || !body.tickers.includes(text(identity.ticker).toUpperCase())) throw new Error("company_profile_issuer_mismatch");
  const recent = object(object(body.filings).recent);
  const forms = Array.isArray(recent.form) ? recent.form : [];
  for (let i = 0; i < forms.length; i++) {
    if (!["10-K", "20-F"].includes(String(forms[i]))) continue;
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

/** Exact issuer metadata, at most two named historical indexes, and one annual filing. */
export async function ensureCompanyProfile(identity: CompanyIdentity, fetchImpl: typeof fetch, now = new Date(), options: { signal?: AbortSignal } = {}) {
  const exact = { ticker: text(identity.ticker).toUpperCase(), company: text(identity.company), cik: profileCik(identity.cik) };
  if (!exact.cik || !exact.company || !/^[A-Z0-9.-]{1,12}$/.test(exact.ticker)) return null;
  const { entries } = await load();
  const prior = entries.find(entry => same(entry, exact));
  const cached = verifiedCompanyProfile(prior?.profile, exact, now);
  if (cached && (cached.industry || (prior?.parserRevision === COMPANY_PROFILE_PARSER_REVISION && Date.parse(prior.nextAttemptAt) > now.getTime()))) return cached;
  if (retryDeferred(prior, now)) return null;
  const entry: Entry = { ...exact, cik: exact.cik, updatedAt: now.toISOString(), nextAttemptAt: new Date(now.getTime() + 60 * 60000).toISOString(), profile: cached,
    filing: prior?.filing, cachedParserRevision: prior?.cachedParserRevision, parserRevision: COMPANY_PROFILE_PARSER_REVISION };
  // Persist backoff before network; budget wrappers still make their own durable reservations.
  await store(entry);
  const request = async (url: string, complete?: (text: string) => boolean) => boundedText(await fetchImpl(url, { headers: { Accept: "text/html,application/json", "User-Agent": "SwingUp/1.0 support@swingup.app" }, cache: "no-store", redirect: "error", signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000) }), complete);
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
    if (filing.url !== prior?.filing?.url) entry.cachedParserRevision = undefined;
    entry.filing = filing;
    phase = "annual_filing";
    await store(entry);
    const extract = (html: string) => extractCompanyProfile({ identity: exact, html, form: filing.form, sourceUrl: filing.url, filedAt: filing.filedAt, now });
    // Reuse the exact annual business section across parser retries. It is
    // issuer/accession-specific and never substitutes another company's text.
    const sourceKey = pr262StorageKey(`research-evidence/company-profile-sources/${exact.cik}/${filing.url.split("/").slice(-2).join("-")}.json`);
    const sourceSaved = await readVersionedTextFromR2(sourceKey);
    const source = sourceSaved.found && sourceSaved.text ? object(JSON.parse(sourceSaved.text)) : {};
    const cachedSection = source.url === filing.url && source.filedAt === filing.filedAt ? text(source.businessText) : "";
    const sectionHeading = filing.form === "20-F" ? "Item 4. Information on the Company" : "Item 1. Business";
    let profile = cached?.sourceUrl === filing.url ? cached : cachedSection ? extract(`${sectionHeading}\n${String(source.businessText)}`) : null;
    // Earlier parsers could stop the stream at an incomplete list introduction.
    // If that old excerpt no longer verifies, permit one longer source read.
    if (!profile && (!cachedSection || source.parserRevision !== COMPANY_PROFILE_PARSER_REVISION)) {
      const html = await request(filing.url, body => Boolean(extract(body)));
      const businessText = annualBusinessText(html, filing.form);
      if (businessText) await writeVersionedJsonToR2(sourceKey, { version: 1, parserRevision: COMPANY_PROFILE_PARSER_REVISION, url: filing.url, filedAt: filing.filedAt, businessText, collectedAt: now.toISOString() }, sourceSaved.etag ? { expectedEtag: sourceSaved.etag } : { createOnly: true });
      profile = extract(html);
    }
    if (!profile) throw new Error("company_profile_products_and_customers_not_extracted");
    if (filing.industry) profile = { ...profile, industry: filing.industry, industrySourceUrl: `https://data.sec.gov/submissions/CIK${exact.cik}.json` };
    entry.profile = profile;
    entry.nextAttemptAt = new Date(now.getTime() + 30 * 86400000).toISOString();
    await store(entry);
    console.info(JSON.stringify({ kind: "pr262_company_profile_result", ticker: exact.ticker, status: "verified", sourceFiledAt: filing.filedAt }));
    return profile;
  } catch (error) {
    entry.error = error instanceof Error ? error.message.slice(0, 200) : "company_profile_fetch_failed";
    if (/products_and_customers_not_extracted|annual_filing_unavailable/.test(entry.error)) entry.nextAttemptAt = new Date(now.getTime() + 86400000).toISOString();
    const reason = entry.error.match(/^company_profile_[a-z0-9_]+/i)?.[0]
      ?? (/budget|quota|cadence/i.test(entry.error) ? "provider_budget_deferred" : error instanceof Error && error.name === "TimeoutError" ? "source_timeout" : "source_request_failed");
    console.info(JSON.stringify({ kind: "pr262_company_profile_result", ticker: exact.ticker, status: "pending", phase, reason }));
    const providerRetry = entry.error.match(/next_retry_at=([^;\s]+)/)?.[1];
    if (providerRetry && Date.parse(providerRetry) > Date.parse(entry.nextAttemptAt)) entry.nextAttemptAt = providerRetry;
    await store(entry);
    return cached;
  }
}

/** Re-read saved source text after a parser repair without spending SEC calls. */
async function recoverCachedProfiles(entries: Entry[], listings: Json[], now: Date) {
  const eligible = entries.filter(entry => entry.filing && !entry.profile && entry.cachedParserRevision !== COMPANY_PROFILE_PARSER_REVISION
    && listings.some(row => row.ticker === entry.ticker && profileCik(row.cik) === entry.cik
      && Array.isArray(row.sourceNames) && row.sourceNames.includes("SEC company_tickers_exchange"))).slice(0, 20);
  const recovered: Entry[] = [];
  const checked: Entry[] = [];
  for (let start = 0; start < eligible.length; start += 4) {
    const results = await Promise.allSettled(eligible.slice(start, start + 4).map(async entry => {
      const filing = entry.filing!;
      const key = pr262StorageKey(`research-evidence/company-profile-sources/${entry.cik}/${filing.url.split("/").slice(-2).join("-")}.json`);
      const saved = await readVersionedTextFromR2(key);
      const source = saved.found && saved.text ? object(JSON.parse(saved.text)) : {};
      checked.push({ ...entry, cachedParserRevision: COMPANY_PROFILE_PARSER_REVISION });
      if (source.url !== filing.url || source.filedAt !== filing.filedAt || !text(source.businessText)) return;
      const heading = filing.form === "20-F" ? "Item 4. Information on the Company" : "Item 1. Business";
      const profile = extractCompanyProfile({ identity: entry, html: `${heading}\n${String(source.businessText)}`,
        form: filing.form, sourceUrl: filing.url, filedAt: filing.filedAt, now });
      if (!profile) return;
      if (filing.industry) Object.assign(profile, { industry: filing.industry, industrySourceUrl: `https://data.sec.gov/submissions/CIK${entry.cik}.json` });
      recovered.push({ ...entry, profile, error: undefined, parserRevision: COMPANY_PROFILE_PARSER_REVISION,
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
  let verified = 0, industry = 0;
  for (const row of listings) {
    const entry = entries.find(item => item.ticker === row.ticker && item.cik === profileCik(row.cik));
    const profile = entry && verifiedCompanyProfile(entry.profile, entry, now);
    if (profile) { verified++; if (profile.industry) industry++; }
    else if (entry?.error) {
      const reason = entry.error.match(/^company_profile_[a-z0-9_]+/i)?.[0]
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
  const last = cadence.found && cadence.text ? Date.parse(text(object(JSON.parse(cadence.text)).checkedAt)) : NaN;
  if (Number.isFinite(last) && now.getTime() - last < 15 * 60000) return { attempted: 0, verified: 0 };
  const reservation = await writeVersionedJsonToR2(cadenceKey, { version: 1, checkedAt: now.toISOString() },
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
  const recoveredFromSavedSources = await recoverCachedProfiles(cached.entries, universeRows, now);
  const entries = recoveredFromSavedSources ? (await load()).entries : cached.entries;
  const groups = object(snapshot.seriousAlerts);
  const sensorState = sensor.found && sensor.text ? object(JSON.parse(sensor.text)) : {};
  const pending = Array.isArray(sensorState.pending) ? sensorState.pending.map(object).filter(event => now.getTime() - Date.parse(text(event.observedAt)) < 3 * 86400000) : [];
  const queuedTickers = new Set(pending.map(row => row.ticker));
  const exposureRows = exposure.found && exposure.text ? object(JSON.parse(exposure.text)).entries : [];
  const opportunities = [groups.buy, groups.sell, groups.watchOut, snapshot.qualityPriceWatchlist].flatMap(group => Array.isArray(group) ? group.map(object) : []);
  const priorityTickers = new Set([...pending, ...opportunities].map(row => row.ticker));
  const valuationTickers = new Set(opportunities.map(row => row.ticker));
  const freshQueuedTickers = new Set(pending.filter(row => now.getTime() - Date.parse(text(row.observedAt)) <= 86400000).map(row => row.ticker));
  const freshOfficialTickers = new Set(pending.filter(row => now.getTime() - Date.parse(text(row.observedAt)) <= 86400000
    && (row.source === "sec" || row.source === "official" || /^(issuer_ir_|issuer_sec_)/.test(text(row.sourceProvider)))).map(row => row.ticker));
  const candidates: Json[] = [...pending, ...opportunities, ...(Array.isArray(exposureRows) ? exposureRows.map(object) : []),
    ...universeRows.map(row => ({ ...row, company: row.company || row.name }))];
  const due = candidates.flatMap(candidate => {
    const listing = universeRows.find(row => row.ticker === candidate.ticker && Array.isArray(row.sourceNames) && row.sourceNames.includes("SEC company_tickers_exchange"));
    const cik = profileCik(listing?.cik);
    if (!cik) return [];
    if (candidate.cik && profileCik(candidate.cik) !== cik) return [];
    const identity = { ticker: candidate.ticker, company: candidate.company || listing?.company || listing?.name, cik };
    const saved = entries.find(entry => same(entry, identity));
    const verified = verifiedCompanyProfile(saved?.profile, identity, now);
    if ((verified && (verified.industry || (saved?.parserRevision === COMPANY_PROFILE_PARSER_REVISION && Date.parse(saved.nextAttemptAt) > now.getTime()))) || retryDeferred(saved, now)) return [];
    return [{ identity, priority: freshOfficialTickers.has(candidate.ticker) ? 5 : freshQueuedTickers.has(candidate.ticker) ? 4 : valuationTickers.has(candidate.ticker) ? 3
      : queuedTickers.has(candidate.ticker) ? 2 : priorityTickers.has(candidate.ticker) ? 1 : 0, lastAttempt: Date.parse(saved?.updatedAt ?? "") || 0 }];
  }).filter((row, index, all) => all.findIndex(other => other.identity.ticker === row.identity.ticker) === index)
    .sort((a, b) => b.priority - a.priority || a.lastAttempt - b.lastAttempt);
  // Expand useful work inside the same time window and provider allowances.
  // One background issuer retains progress beyond today's event queue.
  const selected = due.slice(0, 11);
  const background = due.find(row => row.priority === 0 && !selected.includes(row));
  const backgroundSlot = background ?? due.find(row => !selected.includes(row));
  if (backgroundSlot) selected.push(backgroundSlot);
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
  return { attempted, verified, eligibleCompanies: due.length, maximumCompaniesPerPass: 12, deadlineReached: options.signal?.aborted === true,
    ...(recoveredFromSavedSources ? { recoveredFromSavedSources } : {}) };
}
