import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { meta, expected, ref, html as envelope } from "./helpers/company-profile-financial-note-fixture.mjs";
const p = loadTsModule("@/lib/company-profile"), now = ref.now, identity = meta.identity;
const business = "We sell our LiDAR products primarily through direct offline sales, with only a minimal portion distributed via regional distributors and system integrators.";
const section = `<p></p><h2>Item 4. Information on the Company</h2><p>${business}</p><p>${"SOURCE_LAYOUT_PADDING ".repeat(30)}</p><h2>Item 5. Operating and Financial Review</h2>`;
const html = envelope.replace('<ix:nonNumeric name="us-gaap:', section + '<ix:nonNumeric name="us-gaap:');
const full = p.inspectCompanyProfileExtraction({ ...ref, html });
assert.ok(full.profile); assert.equal(full.profile.customerType, "accounts_receivable_customer_pools");
assert.equal(full.profile.customers, expected); assert.equal(full.profile.customerEvidence.reportPeriod, "2025-12-31");
assert.equal(full.profile.customerEvidence.section, "financial_notes_accounts_receivable");
assert.equal(full.profile.revenueGeography, undefined, "Receivables pools do not prove geographic revenue");
assert.equal(p.inspectCompanyProfileExtraction({ ...ref, html: section + `<p>${expected}</p>` }).profile, null, "An arbitrary paragraph outside Business is not authenticated financial-note evidence");
assert.equal(p.inspectCompanyProfileExtraction({ ...ref, html: `<h2>Item 4. Information on the Company</h2><p>${business}</p><p>${expected}</p><p>${"SOURCE_LAYOUT_PADDING ".repeat(30)}</p><h2>Item 5.</h2>` }).profile, null, "The note cannot be relabeled as an unproved Business customer statement");
for (const mutate of [
  x => { delete x.customerEvidence; }, x => { delete x.customerType; }, x => { x.customerType = "revenue_contract_counterparties"; },
  x => { x.customerEvidence.cik = "0001883085"; }, x => { x.customerEvidence.sourceFiledAt = "2026-04-25"; },
  x => { x.customerEvidence.sourceUrl += "?other"; }, x => { x.customerEvidence.section = "business"; },
  x => { x.customers += " These are current revenue percentages."; x.description = `${x.business} ${x.customers}`; },
]) {
  const value = structuredClone(full.profile); mutate(value);
  assert.equal(p.verifiedCompanyProfile(value, identity, now), null);
}
assert.equal(p.verifiedCompanyProfile(full.profile, identity, new Date(now.getTime() + 31 * 86400000)), null, "Dated proof does not extend the profile freshness window");
const facts = loadTsModule("@/lib/company-card-facts").companyCardFacts(full.profile, identity, now);
assert.equal(facts.customers, expected, "Financial-note words remain exact in the display model");
assert.equal(facts.customerType, "accounts_receivable_customer_pools");
assert.equal(facts.customerLabel, "Accounts-receivable customer pools");
assert.equal(facts.customerPeriod, "2025-12-31");
assert.doesNotMatch(facts.customerLabel, /Main customers/);
assert.match(facts.revenueCountry, /Not yet verified/);
const base = "research-evidence/company-profiles-v1.json", key = `research-evidence/company-profile-sources/${identity.cik}/${meta.sourceUrl.split("/").slice(-2).join("-")}.json`;
const objects = new Map(), calls = [], logs = [], original = console.info;
const cache = loadTsModule("@/lib/opportunity-engine/company-profile-cache", {
  "@/lib/r2-warehouse": {
    readVersionedTextFromR2: async key => ({ found: objects.has(key), text: objects.has(key) ? JSON.stringify(objects.get(key)) : null, etag: objects.has(key) ? "1" : null }),
    writeVersionedJsonToR2: async (key, value) => { objects.set(key, structuredClone(value)); return { written: true, conflict: false }; },
  },
  "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => key },
});
const submissions = { cik: identity.cik, tickers: [identity.ticker], sicDescription: "Measuring Instruments", filings: { recent: { form: ["20-F"], filingDate: [meta.filedAt], accessionNumber: ["0001104659-26-048025"], primaryDocument: ["hsai-20251231x20f.htm"] }, files: [] } };
const fetcher = async (url, init) => {
  calls.push(String(url)); assert.equal(init.redirect, "error"); assert.ok(init.signal);
  if (String(url).startsWith("https://data.sec.gov/submissions/")) return Response.json(submissions);
  assert.equal(String(url), meta.sourceUrl); return new Response(html);
};
try {
  console.info = line => logs.push(JSON.parse(line));
  const result = await cache.ensureCompanyProfile(identity, fetcher, now);
  assert.ok(result); assert.equal(calls.length, 2, "Same provider-controlled submissions and annual requests; no new source API");
  assert.equal(result.customerEvidence.sourceUrl, meta.sourceUrl); assert.equal(result.customerEvidence.sourceFiledAt, meta.filedAt);
  const stored = objects.get(key);
  assert.equal(stored.layoutRevision, 1); assert.ok(stored.businessText.startsWith(business));
  assert.equal(stored.businessText.includes(expected), false, "Financial note is not injected into Business source cache");
  assert.deepEqual(stored.financialCustomerEvidence, result.customerEvidence);
  const firstVerifiedAt = objects.get(base).entries[0].firstVerifiedAt;
  const later = new Date(now.getTime() + 60000);
  assert.ok(await cache.ensureCompanyProfile(identity, fetcher, later)); assert.equal(calls.length, 2, "Valid profile cache is read-only");
  const entry = objects.get(base).entries[0];
  objects.set(base, { entries: [{ ...entry, profile: null, parserRevision: p.COMPANY_PROFILE_PARSER_REVISION - 1, error: "company_profile_products_and_customers_not_extracted" }] });
  assert.ok(await cache.ensureCompanyProfile(identity, fetcher, later)); assert.equal(calls.length, 2, "Parser recovery reuses separately validated private source proof without network");
  assert.equal(objects.get(base).entries[0].firstVerifiedAt, firstVerifiedAt, "Cache recovery never invents a new first verification");
  assert.equal(objects.get(base).entries[0].profile.customerEvidence.reportPeriod, "2025-12-31");
  objects.set(base, { entries: [{ ...entry, profile: null, parserRevision: p.COMPANY_PROFILE_PARSER_REVISION - 1, error: "company_profile_products_and_customers_not_extracted" }] });
  objects.set(key, { ...stored, financialCustomerEvidence: { ...stored.financialCustomerEvidence, cik: "0001883085" } });
  assert.equal(await cache.ensureCompanyProfile(identity, fetcher, later), null, "Another issuer's note cannot recover this company");
  assert.equal(objects.get(base).entries[0].extractionFailure, "company_profile_customers_not_extracted");
  // A complete-looking XML document in an early chunk is not transport EOF.
  // Later trailing bytes or stream failures must not be hidden by cancellation.
  const chunk = new TextEncoder().encode(html.replace("</body>", " ".repeat(140000) + "</body>"));
  for (const failure of ["timeout", "trailing_document"]) {
    objects.clear(); let reads = 0, bodyFailures = 0;
    const streamed = async url => {
      if (String(url).startsWith("https://data.sec.gov/submissions/")) return Response.json(submissions);
      return new Response(new ReadableStream({ pull(controller) {
        if (reads++ === 0) { controller.enqueue(chunk); return; }
        if (failure === "timeout") controller.error(new DOMException("body timed out", "TimeoutError"));
        else { controller.enqueue(new TextEncoder().encode("<html><body>Unrelated second document</body></html>")); controller.close(); }
      } }));
    };
    assert.equal(await cache.ensureCompanyProfile(identity, streamed, now, { onResponseBodyFailure: () => { bodyFailures++; } }), null);
    assert.equal(bodyFailures, failure === "timeout" ? 1 : 0, "Body transport failure counts exactly once; invalid source is not a network failure");
    assert.equal(objects.get(base).entries[0].profile, null);
  }
} finally { console.info = original; }
console.log("Financial-note integration: separate dated customer proof, no Business/revenue relabeling, two guarded requests, cache-only recovery and first-verification retention passed.");
