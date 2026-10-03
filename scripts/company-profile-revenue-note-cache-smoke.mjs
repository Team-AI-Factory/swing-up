import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { ref, html as envelope, data } from "./helpers/company-profile-revenue-note-fixture.mjs";
const p = loadTsModule("@/lib/company-profile"), identity = ref.identity, now = ref.now;
const business = "We are a product-focused technology company that deploys sophisticated data science and proprietary, AI-powered technology to enable better outcomes for financial institutions, their existing and potential customers, and institutional or sophisticated investors.";
const section = `<p></p><h2>Item 1. Business</h2><p>${business}</p><p>${"SOURCE_LAYOUT_PADDING ".repeat(30)}</p><h2>Item 1A. Risk Factors</h2>`;
const html = envelope.replace('<div>NOTE 4 - ', section + '<div>NOTE 4 - ');
const profile = p.inspectCompanyProfileExtraction({ ...ref, html }).profile;
assert.ok(profile); assert.equal(profile.business, business); assert.equal(profile.customers, data.quotes.directPayment);
assert.equal(profile.customerType, "revenue_contract_counterparties");
assert.equal(profile.customerEvidence.section, "financial_notes_revenue_contracts");
assert.equal(profile.customerEvidence.reportPeriod, "2025-12-31");
assert.match(profile.customers, /payment is received monthly from the Financing Vehicles/);
assert.match(profile.customers, /does not include acting as a loan servicer/);
assert.match(profile.customers, /net basis/);
assert.doesNotMatch(profile.customers, /institutional investors/);
assert.equal(profile.revenueGeography, undefined);
const facts = loadTsModule("@/lib/company-card-facts").companyCardFacts(profile, identity, now);
assert.equal(facts.customerLabel, "Revenue-contract counterparties"); assert.equal(facts.customerPeriod, "2025-12-31");
assert.equal(facts.customers, data.quotes.directPayment); assert.equal(facts.customerType, profile.customerType);
for (const changed of [
  { ...profile, customerEvidence: undefined },
  { ...profile, customerType: "accounts_receivable_customer_pools" },
  { ...profile, customerEvidence: { ...profile.customerEvidence, cik: "0001861737" } },
  { ...profile, customerEvidence: { ...profile.customerEvidence, reportPeriod: "2026-12-31" } },
]) assert.equal(p.verifiedCompanyProfile(changed, identity, now), null);
const investor = "Investors in our Financing Vehicles range from large institutional investors, such as pension funds, sovereign wealth funds, and asset management firms, to high-net-worth individuals and family offices.";
assert.equal(p.verifiedCompanyProfile({ ...profile, customers: investor, description: `${business} ${investor}` }, identity, now), null);
const objects = new Map(), calls = [], original = console.info;
const cache = loadTsModule("@/lib/opportunity-engine/company-profile-cache", {
  "@/lib/r2-warehouse": {
    readVersionedTextFromR2: async key => ({ found: objects.has(key), text: objects.has(key) ? JSON.stringify(objects.get(key)) : null, etag: objects.has(key) ? "1" : null }),
    writeVersionedJsonToR2: async (key, value) => { objects.set(key, structuredClone(value)); return { written: true, conflict: false }; },
  }, "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => key },
});
try {
  console.info = () => {};
  const fetcher = async (url, init) => {
    calls.push(String(url)); assert.equal(init.redirect, "error"); assert.ok(init.signal);
    if (String(url).startsWith("https://data.sec.gov/submissions/")) return Response.json({ cik: identity.cik, tickers: [identity.ticker], sicDescription: "Financial Services", filings: { recent: { form: ["10-K"], filingDate: [ref.filedAt], accessionNumber: ["0001883085-26-000018"], primaryDocument: ["pgy-20251231.htm"] }, files: [] } });
    assert.equal(String(url), ref.sourceUrl); return new Response(html);
  };
  const result = await cache.ensureCompanyProfile(identity, fetcher, now);
  assert.ok(result); assert.equal(calls.length, 2); assert.equal(result.customerType, "revenue_contract_counterparties");
  assert.deepEqual(result.customerEvidence, profile.customerEvidence);
  const source = [...objects.entries()].find(([key]) => key.includes("company-profile-sources/"))[1];
  assert.equal(source.businessText.includes(data.quotes.directPayment), false);
  assert.deepEqual(source.financialCustomerEvidence, profile.customerEvidence);
  assert.ok(await cache.ensureCompanyProfile(identity, fetcher, new Date(now.getTime() + 60000)));
  assert.equal(calls.length, 2);
} finally { console.info = original; }
console.log("Revenue-note profile: actual service-fee counterparties, full agent/net qualifications, dated source scope, exact display label, two guarded reads and cache reuse passed.");
