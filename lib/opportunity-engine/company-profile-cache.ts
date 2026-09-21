import { readVersionedTextFromR2, writeVersionedJsonToR2 } from "@/lib/r2-warehouse";
import { pr262StorageKey } from "@/lib/opportunity-engine/pr262-storage";
import { annualBusinessText, extractCompanyProfile, profileCik, verifiedCompanyProfile, type CompanyIdentity, type VerifiedCompanyProfile } from "@/lib/company-profile";
const KEY = pr262StorageKey("research-evidence/company-profiles-v1.json");
const UNIVERSE = pr262StorageKey("equity-universe/v1.json");
type Json = Record<string, unknown>;
const object = (v: unknown): Json => v && typeof v === "object" && !Array.isArray(v) ? v as Json : {};
const text = (v: unknown) => typeof v === "string" ? v.trim() : "";
type Filing = { url: string; form: string; filedAt: string };
type Entry = { ticker: string; company: string; cik: string; updatedAt: string; nextAttemptAt: string; profile: VerifiedCompanyProfile | null; filing?: Filing; error?: string };
async function load() {
  const saved = await readVersionedTextFromR2(KEY);
  const body = saved.found && saved.text ? object(JSON.parse(saved.text)) : {};
  return { saved, entries: Array.isArray(body.entries) ? body.entries as Entry[] : [] };
}
function same(entry: CompanyIdentity, identity: CompanyIdentity) {
  return entry.ticker === identity.ticker && entry.company === identity.company && profileCik(entry.cik) === profileCik(identity.cik);
}
function retryDeferred(entry: Entry | undefined, now: Date) {
  // A successful profile's refresh date must not defer replacement after current verification rejects it.
  // Pending and failed attempts persist a null profile and still retain their retrieval backoff.
  return !entry?.profile && Date.parse(entry?.nextAttemptAt ?? "") > now.getTime();
}
async function store(entry: Entry) {
  for (let i = 0; i < 4; i++) {
    const { saved, entries } = await load();
    const result = await writeVersionedJsonToR2(KEY, { version: 1, updatedAt: entry.updatedAt,
      entries: [entry, ...entries.filter(row => row.cik !== entry.cik || row.ticker !== entry.ticker)].slice(0, 1000) },
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
    return { url: `https://www.sec.gov/Archives/edgar/data/${Number(identity.cik)}/${accession.replace(/-/g, "")}/${document}`, form: String(forms[i]), filedAt };
  }
  return null;
}

/** At most one SEC submissions request and one annual filing; caller supplies the existing budgeted fetch. */
export async function ensureCompanyProfile(identity: CompanyIdentity, fetchImpl: typeof fetch, now = new Date()) {
  const exact = { ticker: text(identity.ticker).toUpperCase(), company: text(identity.company), cik: profileCik(identity.cik) };
  if (!exact.cik || !exact.company || !/^[A-Z0-9.-]{1,12}$/.test(exact.ticker)) return null;
  const { entries } = await load();
  const prior = entries.find(entry => same(entry, exact));
  const cached = verifiedCompanyProfile(prior?.profile, exact, now);
  if (cached) return cached;
  if (retryDeferred(prior, now)) return null;
  const entry: Entry = { ...exact, cik: exact.cik, updatedAt: now.toISOString(), nextAttemptAt: new Date(now.getTime() + 60 * 60000).toISOString(), profile: null };
  // Persist backoff before network; budget wrappers still make their own durable reservations.
  await store(entry);
  const request = async (url: string, complete?: (text: string) => boolean) => boundedText(await fetchImpl(url, { headers: { Accept: "text/html,application/json", "User-Agent": "SwingUp/1.0 support@swingup.app" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12000) }), complete);
  try {
    const priorFilingAge = now.getTime() - Date.parse(prior?.filing?.filedAt ?? "");
    const filing = !prior?.profile && prior?.filing && now.getTime() - Date.parse(prior.updatedAt) <= 86400000 && priorFilingAge >= 0 && priorFilingAge <= 550 * 86400000
      ? prior.filing : annualFiling(object(JSON.parse(await request(`https://data.sec.gov/submissions/CIK${exact.cik}.json`))), exact, now);
    if (!filing) throw new Error("company_profile_annual_filing_unavailable");
    if (!new RegExp(`^https://www\\.sec\\.gov/Archives/edgar/data/${Number(exact.cik)}/\\d{18}/[A-Za-z0-9._-]+\\.html?$`).test(filing.url)) throw new Error("company_profile_filing_identity_mismatch");
    entry.filing = filing;
    await store(entry);
    const extract = (html: string) => extractCompanyProfile({ identity: exact, html, form: filing.form, sourceUrl: filing.url, filedAt: filing.filedAt, now });
    // Reuse the exact annual business section across parser retries. It is
    // issuer/accession-specific and never substitutes another company's text.
    const sourceKey = pr262StorageKey(`research-evidence/company-profile-sources/${exact.cik}/${filing.url.split("/").slice(-2).join("-")}.json`);
    const sourceSaved = await readVersionedTextFromR2(sourceKey);
    const source = sourceSaved.found && sourceSaved.text ? object(JSON.parse(sourceSaved.text)) : {};
    const cachedSection = source.url === filing.url && source.filedAt === filing.filedAt ? text(source.businessText) : "";
    const sectionHeading = filing.form === "20-F" ? "Item 4. Information on the Company" : "Item 1. Business";
    let profile = cachedSection ? extract(`${sectionHeading}\n${String(source.businessText)}`) : null;
    if (!cachedSection) {
      const html = await request(filing.url, body => Boolean(extract(body)));
      const businessText = annualBusinessText(html, filing.form);
      if (businessText) await writeVersionedJsonToR2(sourceKey, { version: 1, url: filing.url, filedAt: filing.filedAt, businessText, collectedAt: now.toISOString() }, sourceSaved.etag ? { expectedEtag: sourceSaved.etag } : { createOnly: true });
      profile = extract(html);
    }
    if (!profile) throw new Error("company_profile_products_and_customers_not_extracted");
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
    console.info(JSON.stringify({ kind: "pr262_company_profile_result", ticker: exact.ticker, status: "pending", phase: entry.filing ? "annual_filing" : "issuer_submissions", reason }));
    const providerRetry = entry.error.match(/next_retry_at=([^;\s]+)/)?.[1];
    if (providerRetry && Date.parse(providerRetry) > Date.parse(entry.nextAttemptAt)) entry.nextAttemptAt = providerRetry;
    await store(entry);
    return null;
  }
}

/** The maintenance input is the raw foundation, never the profile-filtered public feed. */
export async function warmFoundationCompanyProfiles(fetchImpl: typeof fetch, now = new Date()) {
  const cadenceKey = pr262StorageKey("research-evidence/company-profile-maintenance-v1.json");
  const cadence = await readVersionedTextFromR2(cadenceKey);
  const last = cadence.found && cadence.text ? Date.parse(text(object(JSON.parse(cadence.text)).checkedAt)) : NaN;
  if (Number.isFinite(last) && now.getTime() - last < 15 * 60000) return { attempted: 0, verified: 0 };
  const reservation = await writeVersionedJsonToR2(cadenceKey, { version: 1, checkedAt: now.toISOString() },
    cadence.etag ? { expectedEtag: cadence.etag } : { createOnly: true });
  if (!reservation.written || reservation.conflict) return { attempted: 0, verified: 0 };
  const [foundation, universe, { entries }, sensor] = await Promise.all([
    readVersionedTextFromR2(pr262StorageKey("value-investing/resumable/latest/index.json")),
    readVersionedTextFromR2(UNIVERSE), load(), readVersionedTextFromR2(pr262StorageKey("sensor/state-v1.json")),
  ]);
  const snapshot = foundation.found && foundation.text ? object(JSON.parse(foundation.text)) : {};
  const listed = universe.found && universe.text ? object(JSON.parse(universe.text)) : {};
  if (listed.version !== 1) return { attempted: 0, verified: 0 };
  const universeRows = Array.isArray(listed.entries) ? listed.entries.map(object) : [];
  const groups = object(snapshot.seriousAlerts);
  const sensorState = sensor.found && sensor.text ? object(JSON.parse(sensor.text)) : {};
  const pending = Array.isArray(sensorState.pending) ? sensorState.pending.map(object).filter(event => now.getTime() - Date.parse(text(event.observedAt)) < 3 * 86400000) : [];
  const queuedTickers = new Set(pending.map(row => row.ticker));
  const candidates = [...pending, ...[groups.buy, groups.sell, groups.watchOut].flatMap(group => Array.isArray(group) ? group.map(object) : [])];
  const due = candidates.flatMap(candidate => {
    const listing = universeRows.find(row => row.ticker === candidate.ticker && Array.isArray(row.sourceNames) && row.sourceNames.includes("SEC company_tickers_exchange"));
    const cik = profileCik(listing?.cik);
    if (!cik) return [];
    if (candidate.cik && profileCik(candidate.cik) !== cik) return [];
    const identity = { ticker: candidate.ticker, company: candidate.company || listing?.company || listing?.name, cik };
    const saved = entries.find(entry => same(entry, identity));
    if (verifiedCompanyProfile(saved?.profile, identity, now) || retryDeferred(saved, now)) return [];
    return [{ identity, priority: queuedTickers.has(candidate.ticker) ? 1 : 0, lastAttempt: Date.parse(saved?.updatedAt ?? "") || 0 }];
  }).filter((row, index, all) => all.findIndex(other => other.identity.ticker === row.identity.ticker) === index)
    .sort((a, b) => b.priority - a.priority || a.lastAttempt - b.lastAttempt).slice(0, 2);
  // Two independent issuers fit the existing worker window; provider quotas still apply to every request.
  const results = await Promise.allSettled(due.map(candidate => ensureCompanyProfile(candidate.identity, fetchImpl, now)));
  return { attempted: due.length, verified: results.filter(result => result.status === "fulfilled" && result.value).length };
}
