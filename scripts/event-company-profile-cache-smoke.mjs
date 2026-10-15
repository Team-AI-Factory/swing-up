import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { inSimpleAlertPilot } from "./helpers/simple-alert-pilot-fixture.mjs";
import { meta, html as envelope, expected } from "./helpers/company-profile-financial-note-fixture.mjs";
const now = new Date("2026-10-15T14:00:00.000Z"), identity = meta.identity;
const business = "We sell our LiDAR products primarily through direct offline sales, with only a minimal portion distributed via regional distributors and system integrators.";
const section = `<p></p><h2>Item 4. Information on the Company</h2><p>${business}</p><p>${"SOURCE_LAYOUT_PADDING ".repeat(30)}</p><h2>Item 5. Operating and Financial Review</h2>`;
const html = envelope.replace('<ix:nonNumeric name="us-gaap:', section + '<ix:nonNumeric name="us-gaap:').replace(expected, "No customer population was extracted.");
const binding = { cik: identity.cik, form: meta.form, url: meta.sourceUrl, filedAt: meta.filedAt };
const codec = loadTsModule("@/lib/company-profile-complete-source"), profile = loadTsModule("@/lib/company-profile");
const complete = observedAt => codec.createCompleteSourceRecord({ binding, bytes: new TextEncoder().encode(html), requestUrl: meta.sourceUrl,
  finalUrl: meta.sourceUrl, status: 200, eof: true, observedAt }, now);
const sourceKey = `research-evidence/company-profile-sources/${identity.cik}/${meta.sourceUrl.split("/").slice(-2).join("-")}.json`;
const cacheKey = "research-evidence/company-profiles-v1.json";
const objects = new Map([
  [cacheKey, { version: 1, entries: [{ ...identity, profile: null, updatedAt: now.toISOString(), nextAttemptAt: new Date(now.getTime() + 3600000).toISOString(),
    parserRevision: profile.COMPANY_PROFILE_PARSER_REVISION, error: "company_profile_products_and_customers_not_extracted", filing: { ...binding, industry: "Semiconductors" } }] }],
  ["equity-universe/v1.json", { version: 1, scope: "active_us_exchange_listed_common_equities_and_adrs", entries: [{ ...identity, sourceNames: ["SEC company_tickers_exchange"] }] }],
  [sourceKey, { version: 1, url: meta.sourceUrl, filedAt: meta.filedAt, collectedAt: now.toISOString(), completeSource: complete("2026-10-14T14:00:00.000Z") }],
]);
let reads = 0;
const storage = { readVersionedTextFromR2: async key => { reads++; return { found: objects.has(key), text: objects.has(key) ? JSON.stringify(objects.get(key)) : null, etag: "fixture" }; },
  writeVersionedJsonToR2: async () => assert.fail("Business-context fallback must not mutate profile cache or counters") };
const cache = loadTsModule("@/lib/opportunity-engine/company-profile-cache", { "@/lib/r2-warehouse": storage, "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => key } });
const before = JSON.stringify([...objects]);
assert.equal((await cache.readCompanyBusinessContexts([identity], now)).size, 0);
assert.equal(reads, 0, "Nonpilot runtime adds no business-context R2 reads");
await inSimpleAlertPilot(async () => {
  const read = () => cache.readCompanyBusinessContexts([identity], now);
  const cancelled = new AbortController(); cancelled.abort();
  const beforeCancelled = reads;
  assert.equal((await cache.readCompanyBusinessContexts([identity], now, { signal: cancelled.signal })).size, 0);
  assert.equal(reads, beforeCancelled, "Cancelled role cannot start short-context fallback reads");
  assert.equal((await read()).get(identity.ticker).business, business);
  assert.equal((await read()).get(identity.ticker).verifiedAt, "2026-10-14T14:00:00.000Z", "Freshness follows original verified transport, not reread time");
  assert.equal((await cache.readCompanyProfiles([identity], now)).size, 0, "Business-only source never becomes a full cached profile");
  assert.equal((await cache.ensureEventCompanyProfile(identity, async () => assert.fail("Saved source must not trigger network"), now)).status, "sourced_business");
  assert.equal(JSON.stringify([...objects]), before, "No full-profile or firstVerifiedAt write");
  const saved = structuredClone(objects.get(sourceKey));
  objects.set(sourceKey, structuredClone(saved));
  objects.get(sourceKey).completeSource.sha256 = "0".repeat(64);
  assert.equal((await read()).size, 0, "Corrupted original bytes fail closed");
  objects.set(sourceKey, structuredClone(saved)); delete objects.get(sourceKey).completeSource;
  objects.get(sourceKey).businessText = business.repeat(5);
  assert.equal((await read()).size, 0, "A legacy excerpt cannot mint new scoped source context");
  objects.set(sourceKey, { ...saved, completeSource: complete("2026-09-01T00:00:00.000Z"), collectedAt: now.toISOString() });
  assert.equal((await read()).size, 0, "Updated cache metadata cannot renew stale source context");
  objects.set(sourceKey, structuredClone(saved));
  assert.equal((await cache.readCompanyBusinessContexts([{ ...identity, cik: "0000000002" }], now)).size, 0);
  assert.equal((await cache.readCompanyBusinessContexts([{ ...identity, company: "Different Issuer" }], now)).size, 0);
  const admission = loadTsModule("@/lib/opportunity-engine/pr262-queue-readiness", { "@/lib/opportunity-engine/company-profile-cache": cache });
  const event = { ...identity, id: "sec:current", source: "sec", sourceProvider: "sec_broad", priority: 90, mappingStatus: "mapped",
    identityMethod: "official_sec_archive_link", accession: "0001861737-26-000003", canonicalSecIndexUrl: "https://www.sec.gov/Archives/edgar/data/1861737/000186173726000003/0001861737-26-000003-index.html",
    observedAt: now.toISOString(), queueAttempts: 2, queueNextAttemptAt: new Date(now.getTime() + 3600000).toISOString(), queueLastError: "pr262_event_report_retry:candidate_company_profile_pending" };
  const ready = await admission.readPr262QueueAdmissionPlan([event], now);
  assert.deepEqual(ready.readyProfileEventIds, [event.id]);
  assert.equal(ready.fullProfileReadyCount, 0);
  assert.equal(ready.eventBusinessContextReadyCount, 1);
  assert.equal(ready.eventsDeleted, 0);
  const rejected = { ...event, queueLastError: event.queueLastError + ":event_business_context_rejected" };
  assert.deepEqual((await admission.readPr262QueueAdmissionPlan([rejected], now)).preferredEventIds, [], "Rejected short context cannot create endless unchanged retries");
  assert.deepEqual(admission.planPr262QueueAdmissions([rejected], new Set([identity.ticker]), now).readyProfileEventIds, [event.id], "Recovered full profile can still release the hold");
});
console.log("PASS: pilot-only read-only complete-source fallback; original freshness, wrong issuer, corrupt/missing source, no full-profile counter changes, scoped readiness and unchanged-case parking");
