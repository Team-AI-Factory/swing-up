import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";

const current = loadTsModule("@/lib/company-profile");
const now = new Date("2026-10-15T12:00:00.000Z"), checkedAt = "2026-10-14T12:00:00.000Z";
const identity = { ticker: "TEST", company: "Test Software", cik: "0000000001" };
const fixture = companyProfileFixture(identity, now);
const base = "research-evidence/company-profiles-v1.json";
const sourceKey = `research-evidence/company-profile-sources/${identity.cik}/${fixture.sourceUrl.split("/").slice(-2).join("-")}.json`;
const listing = { ...identity, name: identity.company, exchange: "Nasdaq", securityType: "common_stock", sourceNames: ["SEC company_tickers_exchange"] };
const bad = "We provide enterprise software and cloud computing services. " + "Our business has operating offices and employees worldwide. ".repeat(12);
const good = `${fixture.business}\n${fixture.customers}\n${"We operate offices and support our software products. ".repeat(12)}`;
const clone = value => structuredClone(value);
function setup({ industry = true, source = true } = {}) {
  const filing = { url: fixture.sourceUrl, form: "10-K", filedAt: fixture.sourceFiledAt, checkedAt, ...(industry ? { industry: "Software" } : {}) };
  const seed = { ...identity, filing, profile: null, parserRevision: current.COMPANY_PROFILE_PARSER_REVISION,
    error: "company_profile_products_and_customers_not_extracted", updatedAt: "2026-10-13T12:00:00.000Z", nextAttemptAt: "2026-10-14T12:00:00.000Z" };
  const objects = new Map([[base, { version: 1, entries: [seed] }]]);
  if (source) objects.set(sourceKey, { version: 1, layoutRevision: 1, parserRevision: current.COMPANY_PROFILE_PARSER_REVISION,
    url: filing.url, filedAt: filing.filedAt, businessText: bad });
  const writes = [], requests = [], parses = [];
  let revision = 1, responseError, latestDocument = "annual.htm", sourceConflict = false, documentBody;
  const cache = loadTsModule("@/lib/opportunity-engine/company-profile-cache", {
    "@/lib/company-profile": { ...current, inspectCompanyProfileExtraction: input => { parses.push(input.html); return current.inspectCompanyProfileExtraction(input); } },
    "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => key },
    "@/lib/r2-warehouse": {
      readVersionedTextFromR2: async (key, opts = {}) => { opts.signal?.throwIfAborted(); return { found: objects.has(key), text: objects.has(key) ? JSON.stringify(objects.get(key)) : null, etag: objects.has(key) ? String(revision) : null }; },
      writeVersionedJsonToR2: async (key, value, opts = {}) => { opts.signal?.throwIfAborted(); writes.push(key); if (sourceConflict && key !== base) return { written: false, conflict: true }; objects.set(key, clone(value)); revision++; return { written: true, conflict: false }; },
    },
  });
  const builder = loadTsModule("@/lib/simple-alert-profile-builder", { "@/lib/r2-warehouse": { readVersionedTextFromR2: async () => { throw Error("unexpected_read"); }, writeVersionedJsonToR2: async () => { throw Error("unexpected_write"); } } });
  const row = () => objects.get(base).entries[0];
  const fetcher = async url => {
    requests.push(String(url));
    assert.ok(writes.includes(base), "No source request precedes durable admission");
    if (responseError) throw responseError;
    if (String(url).includes("submissions")) return Response.json({ cik: 1, tickers: [identity.ticker], ...(industry ? { sicDescription: "Software" } : {}), filings: { recent: {
      form: ["10-K"], filingDate: [filing.filedAt], accessionNumber: ["0000000001-26-000001"], primaryDocument: [latestDocument],
    } } });
    const response = new Response(documentBody ?? `<h2>Item 1. Business</h2>${good}<h2>Item 1A. Risk Factors</h2>`);
    Object.defineProperty(response, "url", { value: String(url) }); return response;
  };
  return { objects, row, writes, requests, parses, source: () => objects.get(sourceKey),
    ensure: at => cache.ensureCompanyProfile(identity, fetcher, at ?? now),
    plan: at => builder.profileBatchPlan([listing], [row()], at ?? now, 100),
    setBody: body => { documentBody = body; }, setSourceConflict: () => { sourceConflict = true; },
    setError: error => { responseError = error; }, setDocument: name => { latestDocument = name; } };
}
const originalInfo = console.info; console.info = () => {};
try {
  const s = setup();
  assert.equal(await s.ensure(), null); assert.equal(s.parses.length, 1); assert.equal(s.requests.length, 0);
  assert.equal(s.row().nextAttemptAt, "2026-10-21T12:00:00.000Z", "Unchanged saved failure waits until the existing anchored discovery boundary");
  assert.match(s.row().failedExtractionInput.digest, /^[a-f0-9]{64}$/);
  const writes = s.writes.length;
  for (let day = 16; day <= 20; day++) {
    const at = new Date(`2026-10-${day}T12:00:00.000Z`);
    assert.equal(s.plan(at).due.length, 0); assert.equal(await s.ensure(at), null);
  }
  assert.equal(s.writes.length, writes); assert.equal(s.parses.length, 1); assert.equal(s.requests.length, 0);
  const boundary = new Date("2026-10-21T12:00:00.000Z");
  assert.equal(s.plan(boundary).due.length, 1); assert.equal(await s.ensure(boundary), null);
  assert.equal(s.requests.length, 1, "At the boundary, rediscover the annual source before reuse");
  assert.equal(s.parses.length, 1, "Same parser and exact saved input do not parse twice");
  assert.equal(s.row().filing.checkedAt, boundary.toISOString());
  assert.equal(s.row().nextAttemptAt, "2026-10-28T12:00:00.000Z");
  assert.equal(s.row().firstVerifiedAt, undefined); assert.equal(s.plan(boundary).newlyVerifiedToday, 0);

  // Source content changes are observed at the next bounded source check,
  // not by a new poller or a claimed immediate external invalidation.
  const changed = setup(); await changed.ensure(); changed.source().businessText = good;
  assert.ok(await changed.ensure(boundary)); assert.equal(changed.parses.length, 2);
  assert.equal(changed.row().failedExtractionInput, undefined); assert.equal(changed.row().firstVerifiedAt, boundary.toISOString());
  const newFiling = setup(); await newFiling.ensure(); newFiling.setDocument("new-annual.htm");
  assert.ok(await newFiling.ensure(boundary)); assert.equal(newFiling.requests.length, 2);
  assert.ok(newFiling.row().profile.sourceUrl.endsWith("/new-annual.htm"));

  const parser = setup(); await parser.ensure(); parser.row().parserRevision--;
  parser.row().failedExtractionInput.parserRevision--;
  assert.equal(parser.plan(now).due.length, 1); assert.equal(await parser.ensure(now), null);
  assert.equal(parser.parses.length, 2, "One new parser pass is allowed before the long hold resumes");
  assert.equal(parser.requests.length, 0); assert.equal(parser.plan(now).due.length, 0);

  const noIndustry = setup({ industry: false });
  await noIndustry.ensure(); assert.equal(noIndustry.requests.length, 1, "No-industry discovery uses checkedAt, never sliding updatedAt");
  await noIndustry.ensure(new Date("2026-10-16T12:00:00.000Z"));
  await noIndustry.ensure(new Date("2026-10-17T12:00:00.000Z"));
  assert.equal(noIndustry.requests.length, 3, "Each original daily boundary remains anchored to actual discovery");
  assert.equal(noIndustry.parses.length, 1);

  const waits = setup(); await waits.ensure(); const memo = clone(waits.row().failedExtractionInput);
  waits.setError(Error("provider_budget_deferred;next_retry_at=2026-10-25T12:00:00.000Z"));
  assert.equal(await waits.ensure(boundary), null); assert.deepEqual(waits.row().failedExtractionInput, memo);
  waits.row().parserRevision--;
  assert.equal(waits.plan(new Date("2026-10-22T12:00:00.000Z")).due.length, 0, "Parser repair cannot bypass a provider wait");
  const waitWrites = waits.writes.length; await waits.ensure(new Date("2026-10-22T12:00:00.000Z")); assert.equal(waits.writes.length, waitWrites);

  waits.setError(undefined);
  await waits.ensure(new Date("2026-10-25T12:00:00.000Z"));
  assert.equal(waits.parses.length, 1, "A completed provider wait must not erase an exact negative input and trigger a duplicate parse");
  for (const industry of [true, false]) {
    for (const checked of [undefined, "invalid", "2026-12-31T12:00:00.000Z"]) {
      const legacy = setup({ industry }); legacy.row().filing.checkedAt = checked;
      await legacy.ensure(); assert.equal(legacy.requests.length, 1, "Missing, malformed and future discovery clocks force one bounded check");
      assert.equal(legacy.row().filing.checkedAt, now.toISOString());
    }
  }
  const ordinaryOld = setup(); await ordinaryOld.ensure();
  ordinaryOld.source().parserRevision--;
  ordinaryOld.row().parserRevision--;
  ordinaryOld.setBody("<html><body>No business section is available in this response.</body></html>");
  await ordinaryOld.ensure();
  assert.equal(ordinaryOld.row().nextAttemptAt, "2026-10-16T12:00:00.000Z", "An old cached section cannot lend reusable status to an uncachable new response");

  const missing = setup({ source: false }); missing.setError(Error("company_profile_http_503"));
  await missing.ensure(); assert.equal(missing.row().failedExtractionInput, undefined);
  assert.equal(missing.row().nextAttemptAt, "2026-10-15T13:00:00.000Z", "A missing source or transport failure never gets a deterministic seven-day hold");
} finally { console.info = originalInfo; }
console.log("Failed-input scheduling: exact-input memo, bounded seven-day discovery, no-industry anchored discovery, changed source/parser recovery, provider waits and truthful first verification passed.");
