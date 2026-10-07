import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { meta, ref, html as envelope } from "./helpers/company-profile-financial-note-fixture.mjs";
const p = loadTsModule("@/lib/company-profile"), codec = loadTsModule("@/lib/company-profile-complete-source");
const now = new Date("2026-10-03T17:00:00.000Z"), later = new Date(now.getTime() + 60000);
const base = "research-evidence/company-profiles-v1.json";
const business = "We sell our LiDAR products primarily through direct offline sales, with only a minimal portion distributed via regional distributors and system integrators.";
const section = `<p></p><h2>Item 4. Information on the Company</h2><p>${business}</p><p>${"SOURCE_LAYOUT_PADDING ".repeat(30)}</p><h2>Item 5. Operating and Financial Review</h2>`;
// Valid annual identity, complete body, deliberately insufficient customer prose.
const html = envelope.replace('<ix:nonNumeric name="us-gaap:', section + '<ix:nonNumeric name="us-gaap:').replace(/Accounts receivable mainly consists/g, "The source gives no customer disclosure; it consists");
const goodNoteHtml = envelope.replace('<ix:nonNumeric name="us-gaap:', section + '<ix:nonNumeric name="us-gaap:');
function setup(identity = meta.identity, filing = { url: meta.sourceUrl, form: ref.form, filedAt: meta.filedAt }, document = html) {
  const objects = new Map(), calls = [], bodyFailures = [], storageOps = [];
  const key = `research-evidence/company-profile-sources/${identity.cik}/${filing.url.split("/").slice(-2).join("-")}.json`;
  const cache = loadTsModule("@/lib/opportunity-engine/company-profile-cache", {
    "@/lib/r2-warehouse": {
      readVersionedTextFromR2: async (k, options) => { storageOps.push({ operation: "read", key: k, signal: options?.signal }); return { found: objects.has(k), text: objects.has(k) ? JSON.stringify(objects.get(k)) : null, etag: objects.has(k) ? "1" : null }; },
      writeVersionedJsonToR2: async (k, v, options) => { storageOps.push({ operation: "write", key: k, signal: options?.signal }); objects.set(k, structuredClone(v)); return { written: true, conflict: false }; },
    }, "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: k => k },
  });
  const digits = filing.url.split("/").at(-2), accession = `${digits.slice(0, 10)}-${digits.slice(10, 12)}-${digits.slice(12)}`;
  const submissions = { cik: identity.cik, tickers: [identity.ticker], sicDescription: "Verified official industry", filings: { recent: { form: [filing.form], filingDate: [filing.filedAt], accessionNumber: [accession], primaryDocument: [filing.url.split("/").at(-1)] }, files: [] } };
  const native = (body = document, options = {}) => { const response = new Response(body, { status: options.status ?? 200 }); Object.defineProperty(response, "url", { value: options.url ?? filing.url }); return response; };
  let bodyResponse = () => native();
  const fetcher = async (url, init) => { calls.push(String(url)); assert.equal(init.redirect, "error"); assert.ok(init.signal); return String(url).startsWith("https://data.sec.gov/submissions/") ? Response.json(submissions) : bodyResponse(); };
  const ensure = (time = now, signal) => cache.ensureCompanyProfile(identity, fetcher, time, { signal, onResponseBodyFailure: () => bodyFailures.push(1) });
  const retry = () => { const entry = objects.get(base).entries[0]; objects.set(base, { entries: [{ ...entry, profile: null, parserRevision: p.COMPANY_PROFILE_PARSER_REVISION - 1, error: "company_profile_products_and_customers_not_extracted" }] }); };
  return { objects, calls, storageOps, key, native, ensure, retry, identity, filing, bodyFailures, response: callback => { bodyResponse = callback; } };
}
const original = console.info; console.info = () => undefined;
try {
  const signalled = setup(), roleSignal = new AbortController().signal;
  assert.equal(await signalled.ensure(now, roleSignal), null);
  const sourceStorage = signalled.storageOps.filter(row => row.key === signalled.key);
  assert.deepEqual(sourceStorage.map(row => row.operation), ["read", "write"]);
  assert.ok(sourceStorage.every(row => row.signal === roleSignal), "Complete source I/O must share the role deadline");
  const f = setup(); assert.equal(await f.ensure(), null); assert.equal(f.calls.length, 2);
  const saved = structuredClone(f.objects.get(f.key)), record = saved.completeSource;
  assert.ok(record); assert.equal(record.eof, true); assert.equal(record.status, 200); assert.equal(record.observedAt, now.toISOString());
  assert.equal(codec.readCompleteSourceRecord(record, { cik: f.identity.cik, ...f.filing }, now).html, html);
  f.retry(); f.objects.get(f.key).businessText += " Our customers include major global automotive manufacturers and multinational industrial companies.";
  assert.equal(await f.ensure(later), null, "Reparse original bytes, never altered derived prose"); assert.equal(f.calls.length, 2, "Failed parser retry makes zero additional SEC requests");
  assert.equal(f.objects.get(f.key).completeSource.observedAt, now.toISOString());
  for (const mutate of [x => { x.sha256 = "0".repeat(64); }, x => { x.eof = false; }, x => { x.status = 206; }, x => { x.binding.cik = "0001883085"; }, x => { x.binding.filedAt = "2026-04-25"; }, x => { x.binding.form = "10-K"; }, x => { x.finalUrl += "?other"; }, x => { x.sourceVersion = "unknown"; }]) {
    f.objects.set(f.key, structuredClone(saved)); mutate(f.objects.get(f.key).completeSource); f.retry(); const n = f.calls.length;
    assert.equal(await f.ensure(later), null); assert.equal(f.calls.length, n + 1, "Invalid original-byte record requires existing guarded fresh source request");
  }
  f.objects.set(f.key, { ...saved, completeSource: undefined, parserRevision: p.COMPANY_PROFILE_PARSER_REVISION - 1 }); f.retry(); const beforeLegacy = f.calls.length;
  assert.equal(await f.ensure(later), null); assert.equal(f.calls.length, beforeLegacy + 1, "Legacy excerpt is never upgraded without fresh transport EOF");
  const note = setup(meta.identity, undefined, goodNoteHtml); assert.ok(await note.ensure()); const first = note.objects.get(base).entries[0].firstVerifiedAt;
  assert.ok(note.objects.get(note.key).completeSource); note.retry(); delete note.objects.get(note.key).financialCustomerEvidence; delete note.objects.get(note.key).businessText;
  const recovered = await note.ensure(later); assert.equal(recovered?.customerType, "accounts_receivable_customer_pools"); assert.equal(note.calls.length, 2, "New note extraction can be recomputed from original bytes without source API calls");
  assert.equal(note.objects.get(base).entries[0].firstVerifiedAt, first); assert.equal(note.objects.get(base).entries[0].verificationHistoryKnown, true);
  assert.equal(note.objects.get(note.key).completeSource.observedAt, now.toISOString());
  const enrichmentEntry = note.objects.get(base).entries[0], originalVerifiedAt = enrichmentEntry.profile.verifiedAt;
  delete enrichmentEntry.profile.industry; delete enrichmentEntry.profile.industrySourceUrl;
  enrichmentEntry.parserRevision = p.COMPANY_PROFILE_PARSER_REVISION - 1;
  const nextDay = new Date(now.getTime() + 86400000), beforeEnrichment = note.calls.length;
  const enriched = await note.ensure(nextDay);
  assert.ok(enriched?.industry); assert.equal(note.calls.length, beforeEnrichment + 1, "Existing metadata enrichment makes only its submissions request");
  assert.equal(enriched.verifiedAt, originalVerifiedAt, "An already valid same-source profile cannot renew its verification clock merely because complete bytes exist");
  assert.equal(note.objects.get(base).entries[0].firstVerifiedAt, first); assert.equal(note.objects.get(note.key).completeSource.observedAt, now.toISOString());
  for (const options of [{ status: 206 }, { url: meta.sourceUrl + "?redirected" }, { url: "" }]) {
    const test = setup(); test.response(() => test.native(html, options)); assert.equal(await test.ensure(), null); assert.equal(test.objects.get(test.key)?.completeSource, undefined);
  }
  for (const bad of ["<html><body>SEC Request Rate Threshold Exceeded</body></html>", html.replace(meta.identity.cik, "0001883085"), html + "<html>Second document</html>"]) {
    const test = setup(meta.identity, undefined, bad); assert.equal(await test.ensure(), null); assert.equal(test.objects.get(test.key)?.completeSource, undefined, "200 error/mismatched/malformed source cannot become immutable annual cache");
  }
  const early = setup();
  const earlyHtml = goodNoteHtml.replace(business, business + "</p><p>Our customers include global automotive manufacturers and industrial equipment producers.").replace("</body>", " ".repeat(140000) + "</body>");
  early.response(() => early.native(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(earlyHtml)); }, cancel() {} })));
  assert.ok(await early.ensure()); assert.equal(early.objects.get(early.key)?.completeSource, undefined, "Early successful business extraction lacks EOF even when HTML appears closed");
  const failed = setup(); let reads = 0;
  failed.response(() => failed.native(new ReadableStream({ pull(c) { if (!reads++) c.enqueue(new TextEncoder().encode(html + " ".repeat(140000))); else c.error(new DOMException("stream timeout", "TimeoutError")); } })));
  assert.equal(await failed.ensure(), null); assert.equal(failed.bodyFailures.length, 1); assert.equal(failed.objects.get(failed.key), undefined);
  const oversized = setup(); oversized.response(() => oversized.native(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(12_000_001)); c.close(); } })));
  assert.equal(await oversized.ensure(), null); assert.equal(oversized.objects.get(oversized.key), undefined); assert.equal(oversized.bodyFailures.length, 0);
  if (process.env.COMPANY_PROFILE_AIF_FIXTURES) {
    const directory = "https://www.sec.gov/Archives/edgar/data/1993344/000162828026022512/";
    const cover = directory + "aaue-20251231.htm", aif = directory + "a991-alliedx2026aif.htm", index = directory + "0001628280-26-022512-index.html";
    const identity = { ticker: "AAUC", company: "Allied Gold Corp", cik: "0001993344" };
    const test = setup(identity, { url: cover, form: "40-F", filedAt: "2026-04-01" });
    // The setup's native fixture response supplies the actual requested URL.
    // This exercises root discovery plus real cover/index resolution, not a
    // fabricated 40-F binding copied directly into the source cache.
    test.response(() => { const url = test.calls.at(-1); return test.native(readFileSync(`${process.env.COMPANY_PROFILE_AIF_FIXTURES}/${url.split("/").at(-1)}`, "utf8"), { url }); });
    assert.equal(await test.ensure(), null); assert.equal(test.calls.length, 4);
    const key = `research-evidence/company-profile-sources/${identity.cik}/${aif.split("/").slice(-2).join("-")}.json`;
    const saved = test.objects.get(key); assert.ok(saved.completeSource);
    assert.equal(saved.completeSource.binding.annualFilingUrl, cover); assert.equal(saved.completeSource.binding.annualFilingIndexUrl, index);
    test.retry(); saved.parserRevision = p.COMPANY_PROFILE_PARSER_REVISION - 1;
    assert.equal(await test.ensure(later), null); assert.equal(test.calls.length, 4, "Complete AIF replay uses zero extra SEC calls and still requires customer evidence");
    assert.equal(saved.completeSource.observedAt, now.toISOString());
  }
  if (process.env.BACKGROUND_PROFILE_MANIFEST) {
    let initialRequests = 0, retryRequests = 0, cached = 0, baselineVerified = 0, failed = 0, parserRetryRequests = 0;
    for (const r of JSON.parse(readFileSync(process.env.BACKGROUND_PROFILE_MANIFEST))) {
      const test = setup(r.identity ?? r, { url: r.sourceUrl, form: r.form, filedAt: r.filedAt }, readFileSync(r.htmlPath, "utf8"));
      const expected = p.inspectCompanyProfileExtraction({ identity: r.identity ?? r, html: readFileSync(r.htmlPath, "utf8"), form: r.form, sourceUrl: r.sourceUrl, filedAt: r.filedAt, now }).profile;
      assert.equal(Boolean(await test.ensure()), Boolean(expected), `${r.ticker} source cache cannot change current parser acceptance`); initialRequests += test.calls.length;
      if (expected) { baselineVerified++; continue; }
      failed++;
      const hasComplete = Boolean(test.objects.get(test.key)?.completeSource); cached += Number(hasComplete);
      test.retry(); const count = test.calls.length; assert.equal(await test.ensure(later), null, `${r.ticker} no false verification from reuse`);
      retryRequests += test.calls.length - count; assert.equal(test.calls.length - count, 0, "Unchanged current excerpt does not trigger new read");
      // Simulate a real new parser version: full bytes remain sufficient, while
      // an old unsupported excerpt must use the existing one fresh-read path.
      test.retry(); if (test.objects.has(test.key)) test.objects.get(test.key).parserRevision = p.COMPANY_PROFILE_PARSER_REVISION - 1;
      const before = test.calls.length; assert.equal(await test.ensure(later), null); assert.equal(test.calls.length - before, hasComplete ? 0 : 1); parserRetryRequests += test.calls.length - before;
    }
    assert.equal(cached, 4); assert.equal(baselineVerified, 1); assert.equal(failed, 5); console.error(JSON.stringify({ actualFilings: 6, baselineVerified, actualFailedFilings: failed, initialRequests, sameParserRetryRequests: retryRequests, cacheableComplete: cached, newParserAnnualRequestsBefore: failed, newParserAnnualRequestsAfter: parserRetryRequests, cacheOnlyNewlyVerified: 0 }));
  }
} finally { console.info = original; }
console.log("Complete annual cache: native EOF/identity/content required; exact original bytes and dates preserved; no parser retry requests or invented verification; legacy/partial/corrupt/error/oversize sources fail closed.");
