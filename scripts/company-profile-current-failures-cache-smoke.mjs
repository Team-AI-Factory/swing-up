import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/company-profile-current-failures-oct8.json", import.meta.url), "utf8"));
const now = new Date(fixture.asOf), yesterday = new Date(now.getTime() - 86400000).toISOString();
const p = loadTsModule("@/lib/company-profile");
const key = "research-evidence/company-profiles-v1.json";
function setup(row, history = {}, error = "company_profile_products_and_customers_not_extracted") {
  const filing = { url: row.sourceUrl, form: row.form, filedAt: row.sourceFiledAt, checkedAt: now.toISOString(), industry: "Manufacturing" };
  const entry = { ticker: row.ticker, company: row.company, cik: row.cik, profile: null, filing, error,
    extractionFailure: row.baselineReason, parserRevision: p.COMPANY_PROFILE_PARSER_REVISION - 1,
    updatedAt: yesterday, nextAttemptAt: new Date(now.getTime() + 86400000).toISOString(), ...history };
  const objects = new Map([[key, { version: 1, entries: [entry] }]]);
  const sourceKey = `research-evidence/company-profile-sources/${row.cik}/${row.sourceUrl.split("/").slice(-2).join("-")}.json`;
  objects.set(sourceKey, { version: 1, layoutRevision: 1, parserRevision: p.COMPANY_PROFILE_PARSER_REVISION - 1,
    url: row.sourceUrl, filedAt: row.sourceFiledAt, businessText: row.passages.map(passage => passage.quote).join("\n") });
  let revision = 1, writes = 0, network = 0;
  const storage = {
    readVersionedTextFromR2: async path => ({ found: objects.has(path), text: objects.has(path) ? JSON.stringify(objects.get(path)) : null, etag: objects.has(path) ? String(revision) : null }),
    writeVersionedJsonToR2: async (path, value) => { objects.set(path, structuredClone(value)); revision++; writes++; return { written: true, conflict: false }; },
  };
  const overrides = { "@/lib/r2-warehouse": storage, "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: path => path } };
  const cache = loadTsModule("@/lib/opportunity-engine/company-profile-cache", overrides);
  const builder = loadTsModule("@/lib/simple-alert-profile-builder", overrides);
  const listing = { ticker: row.ticker, name: row.company, cik: row.cik, exchange: "Nasdaq", securityType: "common_stock", sourceNames: ["SEC company_tickers_exchange"] };
  return { entry, objects, cache, builder, listing,
    entries: () => objects.get(key).entries,
    writes: () => writes,
    network: () => network,
    fetcher: async () => { network++; throw Error("unexpected_provider_request"); },
  };
}
let recovered = 0, preservedWaits = 0;
for (const row of fixture.sources.filter(row => row.expectedVerified)) {
  for (const history of [{}, { verificationHistoryKnown: true }, { verificationHistoryKnown: true, firstVerifiedAt: yesterday }]) {
    const s = setup(row, history), before = structuredClone(s.entries());
    assert.equal(s.builder.profileBatchPlan([s.listing], s.entries(), now, 100).due.length, 1, "Prior parser extraction failures are due once after revision");
    const profile = await s.cache.ensureCompanyProfile(row, s.fetcher, now);
    assert.ok(profile, row.ticker);
    assert.equal(profile.business, row.expected.business);
    assert.equal(profile.customers, row.expected.customers);
    assert.equal(s.network(), 0, "The same issuer/accession source recovers without a SEC request");
    const expectedNew = !history.verificationHistoryKnown;
    assert.equal(s.entries()[0].firstVerifiedAt, history.firstVerifiedAt ?? (expectedNew ? now.toISOString() : undefined));
    assert.equal(s.entries()[0].verificationHistoryKnown, true);
    assert.equal(s.entries()[0].parserRevision, p.COMPANY_PROFILE_PARSER_REVISION);
    assert.equal(s.builder.firstVerifiedCompaniesThisRun(before, s.entries(), now), Number(expectedNew));
    assert.equal(s.builder.profileBatchPlan([s.listing], s.entries(), now, 100).newlyVerifiedToday, Number(expectedNew));
    assert.equal(s.builder.profileBatchPlan([s.listing], s.entries(), now, 100).due.length, 0);
    const writes = s.writes();
    assert.deepEqual(await s.cache.ensureCompanyProfile(row, s.fetcher, now), JSON.parse(JSON.stringify(profile)));
    assert.equal(s.writes(), writes, "Recovered profiles resume normal no-write cache reuse");
    recovered++;
  }
  for (const error of ["provider_budget_deferred; next_retry_at=2026-10-09T05:17:00.000Z", "source_timeout", "company_profile_time_budget_deferred", "company_profile_storage_read_failed:test"]) {
    const s = setup(row, {}, error), before = structuredClone(s.entries());
    assert.equal(s.builder.profileBatchPlan([s.listing], s.entries(), now, 100).due.length, 0, "Parser revision cannot override active provider/error waits");
    assert.equal(await s.cache.ensureCompanyProfile(row, s.fetcher, now), null);
    assert.equal(s.network(), 0);
    assert.equal(s.writes(), 0);
    assert.deepEqual(s.entries(), before);
    preservedWaits++;
  }
  const current = setup(row);
  current.entry.parserRevision = p.COMPANY_PROFILE_PARSER_REVISION;
  assert.equal(current.builder.profileBatchPlan([current.listing], current.entries(), now, 100).due.length, 0);
  assert.equal(await current.cache.ensureCompanyProfile(row, current.fetcher, now), null, "The same revision does not repeatedly retry a still-pending extract");
  assert.equal(current.network(), 0);
  assert.equal(current.writes(), 0);
}
console.log(JSON.stringify({ actualSourceHistoryCasesRecovered: recovered, activeProviderAndErrorWaitCasesPreserved: preservedWaits, networkRequests: 0, productionWrites: 0 }));
