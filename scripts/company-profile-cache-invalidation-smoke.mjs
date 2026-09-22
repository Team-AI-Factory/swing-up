import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";

const now = new Date("2026-09-18T12:00:00Z");
const identity = { ticker: "TEST", company: "Test Software", cik: "0000000001" };
const fixture = companyProfileFixture(identity, now);
const profiles = loadTsModule("@/lib/company-profile");
const incidentalCustomers = "Our customers are able to access their content across multiple devices and personal computers.";
const invalidProfile = { ...fixture, customers: incidentalCustomers, description: `${fixture.business} ${incidentalCustomers}` };
assert.ok(profiles.verifiedCompanyProfile(fixture, identity, now));
assert.equal(profiles.verifiedCompanyProfile(invalidProfile, identity, now), null);

const key = "research-evidence/company-profiles-v1.json";
const objects = new Map();
let revision = 0, writes = 0, requests = 0;
const storage = {
  readVersionedTextFromR2: async path => objects.has(path)
    ? { found: true, text: JSON.stringify(objects.get(path)), etag: String(revision) }
    : { found: false, text: null, etag: null },
  writeVersionedJsonToR2: async (path, value) => {
    revision++; writes++;
    objects.set(path, structuredClone(value));
    return { written: true, conflict: false };
  },
};
const cache = loadTsModule("@/lib/opportunity-engine/company-profile-cache", {
  "@/lib/r2-warehouse": storage,
  "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: path => path },
});
const currentEntry = () => objects.get(key).entries[0];
function seed(profile, nextAttemptAt = new Date(now.getTime() + 30 * 86400000).toISOString()) {
  objects.clear(); writes = 0; requests = 0;
  objects.set(key, { version: 1, entries: [{ ...identity, profile, updatedAt: new Date(now.getTime() - 60000).toISOString(), nextAttemptAt }] });
  objects.set("equity-universe/v1.json", { version: 1, scope: "active_us_exchange_listed_common_equities_and_adrs", entries: [{ ...identity, sourceNames: ["SEC company_tickers_exchange"] }] });
  objects.set("value-investing/resumable/latest/index.json", { kind: "us_value_investing_resumable_summary", seriousAlerts: { buy: [identity] } });
}
const submissions = { cik: 1, tickers: ["TEST"], filings: { recent: {
  form: ["10-K"], filingDate: [fixture.sourceFiledAt], accessionNumber: ["0000000001-26-000001"], primaryDocument: ["annual.htm"],
} } };
const html = `<h2>Item 1. Business</h2><p>${fixture.business}</p><p>${"The company maintains regional facilities and provides ongoing implementation support for its software. ".repeat(8)}</p><h3>Customers</h3><p>${fixture.customers}</p><h2>Item 1A. Risk Factors</h2>`;
const fetcher = async url => {
  requests++;
  assert.equal(currentEntry().profile, null, "Every new attempt durably clears the invalid profile before retrieval");
  assert.ok(Date.parse(currentEntry().nextAttemptAt) > Date.parse(currentEntry().updatedAt), "The attempt retains durable backoff before retrieval");
  return String(url).includes("submissions") ? Response.json(submissions) : new Response(html);
};

seed(fixture);
assert.deepEqual(await cache.ensureCompanyProfile(identity, fetcher, now), fixture);
assert.equal(requests, 0, "Valid cached profiles are reused without provider requests");
assert.equal(writes, 0, "Valid cache reuse does not write storage");
assert.equal((await cache.readCompanyProfiles([identity], now)).size, 1);
assert.deepEqual(await cache.warmFoundationCompanyProfiles(fetcher, now), { attempted: 0, verified: 0 });
assert.equal(requests, 0, "The warmer also skips valid profiles");

seed(invalidProfile);
assert.equal((await cache.readCompanyProfiles([identity], now)).size, 0, "Public reads reject previously cached incidental customer text");
assert.equal(requests, 0, "Public reads remain cache-only");
assert.ok(await cache.ensureCompanyProfile(identity, fetcher, now), "An invalid prior success refreshes before its thirty-day refresh date");
assert.equal(requests, 2);
assert.equal(currentEntry().profile.customers, fixture.customers);
assert.equal((await cache.readCompanyProfiles([identity], now)).size, 1);
assert.ok(await cache.ensureCompanyProfile(identity, fetcher, new Date(now.getTime() + 60000)));
assert.equal(requests, 2, "The replacement profile is reused");

seed(invalidProfile);
assert.deepEqual(await cache.warmFoundationCompanyProfiles(fetcher, now), { attempted: 1, verified: 1 }, "Maintenance selects invalid prior successes despite their future refresh dates");
assert.equal(requests, 2);
assert.deepEqual(await cache.warmFoundationCompanyProfiles(fetcher, new Date(now.getTime() + 60000)), { attempted: 0, verified: 0 });
assert.equal(requests, 2, "The fifteen-minute maintenance cadence still applies");

seed(invalidProfile);
const broken = async () => { requests++; throw new Error("synthetic_source_failure"); };
assert.equal(await cache.ensureCompanyProfile(identity, broken, now), null);
assert.equal(requests, 1, "The invalid prior success is attempted immediately even when retrieval fails");
assert.equal(currentEntry().profile, null);
assert.equal(currentEntry().nextAttemptAt, new Date(now.getTime() + 3600000).toISOString());
assert.equal(await cache.ensureCompanyProfile(identity, broken, new Date(now.getTime() + 60000)), null);
assert.deepEqual(await cache.warmFoundationCompanyProfiles(broken, new Date(now.getTime() + 15 * 60000)), { attempted: 0, verified: 0 });
assert.equal(requests, 1, "Both direct retrieval and maintenance honor a real failure's backoff");
assert.ok(await cache.ensureCompanyProfile(identity, fetcher, new Date(now.getTime() + 3600000)));
assert.equal(requests, 3, "Retrieval resumes when the failure backoff expires");

seed(invalidProfile);
const providerRetry = new Date(now.getTime() + 3 * 3600000).toISOString();
const budgetDeferred = async () => { requests++; throw new Error(`provider_budget_deferred; next_retry_at=${providerRetry}`); };
assert.equal(await cache.ensureCompanyProfile(identity, budgetDeferred, now), null);
assert.equal(currentEntry().nextAttemptAt, providerRetry);
assert.equal(await cache.ensureCompanyProfile(identity, fetcher, new Date(now.getTime() + 2 * 3600000)), null);
assert.deepEqual(await cache.warmFoundationCompanyProfiles(fetcher, new Date(now.getTime() + 2 * 3600000)), { attempted: 0, verified: 0 });
assert.equal(requests, 1, "An extended provider-budget backoff remains authoritative after invalidation");

// Old parser failures can recover immediately using a fuller exact source,
// rather than waiting out yesterday's extraction backoff or reusing a prefix.
seed(null);
const filing = { url: fixture.sourceUrl, form: "10-K", filedAt: fixture.sourceFiledAt };
Object.assign(currentEntry(), { error: "company_profile_products_and_customers_not_extracted", filing, parserRevision: 1 });
const sourceKey = `research-evidence/company-profile-sources/${identity.cik}/${filing.url.split("/").slice(-2).join("-")}.json`;
objects.set(sourceKey, { version: 1, url: filing.url, filedAt: filing.filedAt, businessText: profiles.annualBusinessText(html.replace(fixture.business, "Our company provides products for the following lines of business:"), "10-K") });
assert.ok(await cache.ensureCompanyProfile(identity, fetcher, now));
assert.equal(requests, 2, "Refresh SEC industry metadata once and fetch a fuller old excerpt once");
assert.equal(currentEntry().parserRevision, profiles.COMPANY_PROFILE_PARSER_REVISION);
assert.equal(objects.get(sourceKey).parserRevision, profiles.COMPANY_PROFILE_PARSER_REVISION);
assert.ok(await cache.ensureCompanyProfile(identity, fetcher, new Date(now.getTime() + 60000)));
assert.equal(requests, 2, "A recovered profile returns to ordinary cache reuse");
seed(null);
Object.assign(currentEntry(), { error: "company_profile_products_and_customers_not_extracted", filing, parserRevision: profiles.COMPANY_PROFILE_PARSER_REVISION });
assert.equal(await cache.ensureCompanyProfile(identity, fetcher, now), null);
assert.equal(requests, 0, "An unchanged current parser must not bypass failed-extraction backoff");

// A quota failure before refreshed metadata arrives must retain the exact
// report reference. Its saved text can recover without another provider call.
seed(null, now.toISOString());
Object.assign(currentEntry(), { error: "company_profile_products_and_customers_not_extracted", filing, parserRevision: 1 });
objects.set(sourceKey, { version: 1, url: filing.url, filedAt: filing.filedAt, businessText: profiles.annualBusinessText(html, "10-K") });
assert.equal(await cache.ensureCompanyProfile(identity, budgetDeferred, now), null);
assert.deepEqual(currentEntry().filing, filing, "Network failure cannot erase the saved source's filing metadata");
assert.equal(currentEntry().nextAttemptAt, providerRetry);
const recoveredDuringBackoff = await cache.warmFoundationCompanyProfiles(budgetDeferred, now);
assert.equal(recoveredDuringBackoff.recoveredFromSavedSources, 1, "A provider pause must not block verification from an existing exact report");
assert.equal(currentEntry().profile.customers, fixture.customers);
assert.equal(requests, 1, "Saved-source recovery makes no second provider request during backoff");

console.log("PASS: valid cache reuse, invalid-success immediate refresh, parser-revision recovery, cache-only read validation, maintenance selection, durable failed-attempt and provider backoff");

// Cache retention cannot erase the rest of a 4,958-company universe.
seed(null, now.toISOString());
objects.get(key).entries.push(...Array.from({ length: 1001 }, (_, index) => ({ ticker: `X${index}`, company: `Company ${index}`, cik: String(index + 2).padStart(10, "0"), profile: null, updatedAt: now.toISOString(), nextAttemptAt: now.toISOString() })));
assert.ok(await cache.ensureCompanyProfile(identity, fetcher, now));
assert.equal(objects.get(key).entries.length, 1002);
// An older valid business description can acquire SEC industry without another filing download.
seed({ ...fixture, industry: undefined, industrySourceUrl: undefined });
const industryProfile = await cache.ensureCompanyProfile(identity, async url => {
  requests++; assert.match(String(url), /submissions/);
  return Response.json({ ...submissions, sicDescription: "Services-Prepackaged Software" });
}, now);
assert.equal(requests, 1);
assert.equal(industryProfile.industry, "Services-Prepackaged Software");
assert.equal(industryProfile.verifiedAt, fixture.verifiedAt, "Metadata enrichment does not renew the description's evidence age");
