import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";

const folder = new URL("./fixtures/company-profile-retail-channel/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", folder), "utf8"));
const bytes = gunzipSync(readFileSync(new URL(manifest.fixture, folder)));
const discovery = JSON.parse(gunzipSync(readFileSync(new URL(manifest.submissionsFixture, folder))));
const sha = value => createHash("sha256").update(value).digest("hex");
assert.equal(sha(bytes), manifest.source.rawHtmlSha256);
const p = loadTsModule("@/lib/company-profile");
const codec = loadTsModule("@/lib/company-profile-complete-source");
const annual = loadTsModule("@/lib/company-profile-financial-customer-source");
const now = new Date(manifest.asOf), source = manifest.source;
const identity = { ticker: source.ticker, company: source.company, cik: source.cik };
const binding = { cik: source.cik, form: source.form, url: source.sourceUrl, filedAt: source.filedAt };
assert.ok(annual.inspectAnnualDocumentIdentity({ identity, html: bytes.toString("utf8"), form: source.form, sourceUrl: source.sourceUrl, filedAt: source.filedAt, now }));
const base = "research-evidence/company-profiles-v1.json";
const sourceKey = `research-evidence/company-profile-sources/${source.cik}/${source.sourceUrl.split("/").slice(-2).join("-")}.json`;
const listing = { ...identity, name: identity.company, exchange: "NYSE", securityType: "common_stock", sourceNames: ["SEC company_tickers_exchange"] };
const plus = days => new Date(now.getTime() + days * 86400000);
function setup({ body = bytes, history = {}, error = "company_profile_products_and_customers_not_extracted" } = {}) {
  const complete = codec.createCompleteSourceRecord({ binding, bytes: body, requestUrl: binding.url, finalUrl: binding.url, status: 200, eof: true, observedAt: now.toISOString() }, now);
  assert.ok(complete);
  const reason = "company_profile_customers_not_extracted";
  const seed = { ...identity, filing: { url: source.sourceUrl, form: source.form, filedAt: source.filedAt, checkedAt: now.toISOString(), industry: discovery.sicDescription },
    profile: null, parserRevision: p.COMPANY_PROFILE_PARSER_REVISION - 1, error, extractionFailure: reason,
    updatedAt: plus(-1).toISOString(), nextAttemptAt: plus(1).toISOString(), ...history,
    failedExtractionInput: { version: 1, parserRevision: p.COMPANY_PROFILE_PARSER_REVISION - 1, digest: sha(JSON.stringify([identity, binding, 1, body.toString("utf8"), null])), reason } };
  const objects = new Map([[base, { version: 1, entries: [seed] }], [sourceKey, { version: 1, layoutRevision: 1, parserRevision: p.COMPANY_PROFILE_PARSER_REVISION - 1,
    url: binding.url, filedAt: binding.filedAt, businessText: "Derived text is deliberately not evidence; replay complete original bytes.", completeSource: complete }]]);
  const requests = [], writes = [], parses = [];
  let version = 1;
  const storage = {
    readVersionedTextFromR2: async key => ({ found: objects.has(key), text: objects.has(key) ? JSON.stringify(objects.get(key)) : null, etag: objects.has(key) ? String(version) : null }),
    writeVersionedJsonToR2: async (key, value) => { writes.push(key); objects.set(key, structuredClone(value)); version++; return { written: true, conflict: false }; },
  };
  const overrides = { "@/lib/r2-warehouse": storage, "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => key },
    "@/lib/company-profile": { ...p, inspectCompanyProfileExtraction: input => { parses.push(input.html); return p.inspectCompanyProfileExtraction(input); } } };
  const cache = loadTsModule("@/lib/opportunity-engine/company-profile-cache", overrides);
  const builder = loadTsModule("@/lib/simple-alert-profile-builder", overrides);
  const row = () => objects.get(base).entries[0];
  const fetcher = async url => { requests.push(String(url)); assert.equal(url, source.discoveryUrl, "Only the existing discovery boundary may make its in-memory source request"); return Response.json(discovery); };
  return { objects, requests, writes, parses, row, plan: time => builder.profileBatchPlan([listing], [row()], time ?? now, 100),
    ensure: time => cache.ensureCompanyProfile(identity, fetcher, time ?? now), count: (before, at = now) => builder.firstVerifiedCompaniesThisRun(before, [row()], at) };
}
const originalInfo = console.info; console.info = () => {};
try {
  for (const history of [{}, { verificationHistoryKnown: true }, { verificationHistoryKnown: true, firstVerifiedAt: plus(-1).toISOString() }]) {
    const s = setup({ history }), before = structuredClone([s.row()]);
    assert.equal(s.plan().due.length, 1, "The existing revision-repair lane admits an old extraction failure once");
    const profile = await s.ensure();
    assert.equal(profile?.customers, manifest.expectedCustomers);
    assert.equal(s.parses.length, 1); assert.equal(s.parses[0], bytes.toString("utf8"));
    assert.equal(s.requests.length, 0, "An already-failed authentic complete source recovers without source I/O");
    assert.equal(s.row().failedExtractionInput, undefined);
    assert.equal(s.row().parserRevision, p.COMPANY_PROFILE_PARSER_REVISION);
    assert.equal(s.objects.get(sourceKey).completeSource.observedAt, now.toISOString());
    assert.equal(s.objects.get(sourceKey).completeSource.sha256, manifest.source.rawHtmlSha256);
    assert.equal(s.count(before), history.verificationHistoryKnown ? 0 : 1);
    const writes = s.writes.length;
    assert.ok(await s.ensure()); assert.equal(s.plan().due.length, 0);
    assert.equal(s.parses.length, 1); assert.equal(s.requests.length, 0); assert.equal(s.writes.length, writes);
  }
  // The rejected review candidate stored only a retail sentence. Such a
  // cached profile cannot count or be returned without retained source proof.
  const authentic = p.inspectCompanyProfileExtraction({ identity, html: bytes.toString("utf8"), form: source.form,
    sourceUrl: source.sourceUrl, filedAt: source.filedAt, now }).profile;
  assert.ok(authentic?.retailChannelEvidence);
  const sentenceOnly = structuredClone(authentic); delete sentenceOnly.retailChannelEvidence;
  assert.equal(p.verifiedCompanyProfile(sentenceOnly, identity, now), null);
  assert.ok(p.sourcedCompanyBusiness(sentenceOnly, identity, now), "Genuine business-only evidence remains available, without a full-profile success");
  for (const qualifier of [
    "These relationships consist solely of free marketing pilots and have generated no product sales.",
    "All of these relationships were terminated before year-end and we no longer sell through this channel.",
    "All of these relationships are prospective and contingent on a future launch.",
  ]) {
    const qualifiedBytes = Buffer.from(bytes.toString("utf8").replace(manifest.expectedCustomers, `${manifest.expectedCustomers} ${qualifier}`));
    assert.notEqual(sha(qualifiedBytes), manifest.source.rawHtmlSha256, "Clearly synthetic context mutation");
    const q = setup({ body: qualifiedBytes }), before = structuredClone([q.row()]);
    assert.equal(await q.ensure(), null); assert.equal(q.parses.length, 1); assert.equal(q.requests.length, 0);
    assert.equal(q.count(before), 0); assert.equal(q.row().firstVerifiedAt, undefined);
    assert.equal(q.row().extractionFailure, "company_profile_customers_not_extracted");
    assert.equal(q.row().nextAttemptAt, plus(7).toISOString());
    const memo = structuredClone(q.row().failedExtractionInput), writes = q.writes.length;
    assert.equal(await q.ensure(), null); assert.equal(q.parses.length, 1); assert.equal(q.requests.length, 0);
    assert.equal(q.writes.length, writes); assert.deepEqual(q.row().failedExtractionInput, memo);
  }
  // Explicit synthetic mutation: a scheduling control, not authentic content.
  const failedBytes = Buffer.from(bytes.toString("utf8").replace(manifest.expectedCustomers, manifest.expectedCustomers.replace("Our retail", "Our prospective retail")));
  assert.notEqual(sha(failedBytes), manifest.source.rawHtmlSha256);
  const f = setup({ body: failedBytes });
  assert.equal(await f.ensure(), null); assert.equal(f.parses.length, 1); assert.equal(f.requests.length, 0);
  const memo = structuredClone(f.row().failedExtractionInput), writes = f.writes.length;
  assert.equal(f.row().nextAttemptAt, plus(7).toISOString());
  for (let day = 0; day < 7; day++) {
    assert.equal(f.plan(plus(day)).due.length, 0); assert.equal(await f.ensure(plus(day)), null);
  }
  assert.equal(f.parses.length, 1); assert.equal(f.writes.length, writes); assert.equal(f.requests.length, 0);
  assert.equal(f.plan(plus(7)).due.length, 1); assert.equal(await f.ensure(plus(7)), null);
  assert.equal(f.requests.length, 1, "The existing seven-day boundary checks submissions, without adding any poller");
  assert.equal(f.parses.length, 1, "The exact failed input/revision memo prevents repeated parsing");
  assert.deepEqual(f.row().failedExtractionInput, memo);
  assert.equal(f.row().firstVerifiedAt, undefined); assert.equal(f.row().nextAttemptAt, plus(14).toISOString());
  const errors = ["provider_budget_deferred;next_retry_at=" + plus(1).toISOString(), "source_timeout", "company_profile_http_503", "company_profile_time_budget_deferred", "company_profile_storage_read_failed:test"];
  for (const error of errors) {
    const s = setup({ error }), before = structuredClone(s.row());
    assert.equal(s.plan().due.length, 0); assert.equal(await s.ensure(), null);
    assert.equal(s.parses.length, 0); assert.equal(s.requests.length, 0); assert.equal(s.writes.length, 0);
    assert.deepEqual(s.row(), before, "Revision 17 never bypasses an active provider, source, role, or storage backoff");
  }
  console.info = originalInfo;
  console.log(JSON.stringify({ ok: true, authenticCompleteSourceRecoveryCases: 3, parsesPerRecovery: 1, recoverySourceRequests: 0,
    repeatedFailureParses: 1, qualifiedSourceFailuresMemoized: 3, sentenceOnlyCacheRejected: true, originalDiscoveryBoundaryPreserved: true, activeBackoffsPreserved: errors.length,
    networkRequests: 0, productionWrites: 0, newCadence: false }, null, 2));
} finally { console.info = originalInfo; }
