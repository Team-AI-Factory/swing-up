import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";
const now = new Date("2026-09-18T12:00:00Z");
const identity = { ticker: "TEST", company: "Test Software", cik: "0000000001" };
const profile = loadTsModule("@/lib/company-profile");
const fixture = companyProfileFixture(identity, now);
// SEC-style inline XBRL, a table of contents, separate heading spans, and
// non-business financial sections. All business claims here are synthetic.
const html = `<html><style>.hidden{display:none}</style><ix:header>Company financial taxonomy</ix:header>
<table><tr><td>Item 1.</td><td>Business</td></tr><tr><td>Item 1A.</td><td>Risk Factors</td></tr></table>
<h2><span>ITEM</span> <span>1.</span> <span>BUSINESS</span></h2>
<p>${fixture.business}</p><p>${"The company maintains regional facilities and provides ongoing implementation support for its software. ".repeat(8)}</p>
<h3>Customers</h3><p>${fixture.customers}</p><h2>Item 1A. Risk Factors</h2>
<p>Customers might cancel their contracts and no assurance of future revenues can be provided.</p></html>`;
const extracted = profile.extractCompanyProfile({ identity, html, form: "10-K", sourceUrl: fixture.sourceUrl, filedAt: fixture.sourceFiledAt, now });
assert.ok(extracted);
assert.match(extracted.business, /inventory management software/);
assert.match(extracted.customers, /retail stores, wholesalers and manufacturing/);
assert.doesNotMatch(extracted.description, /Risk Factors|might cancel|taxonomy/);
for (const changed of [{ cik: "2" }, { ticker: "OTHER" }, { company: "Different Company" }]) {
  assert.equal(profile.verifiedCompanyProfile(extracted, { ...identity, ...changed }, now), null);
}
assert.equal(profile.verifiedCompanyProfile({ ...extracted, description: "Its products and customers have not yet been verified in the available company profile." }, identity, now), null);
assert.equal(profile.verifiedCompanyProfile(extracted, identity, new Date(now.getTime() + 31 * 86400000)), null);
assert.equal(profile.extractCompanyProfile({ identity, html: html.replace(fixture.customers, "No single customer accounted for 10 percent of sales."), form: "10-K", sourceUrl: fixture.sourceUrl, filedAt: fixture.sourceFiledAt, now }), null);
assert.equal(profile.extractCompanyProfile({ identity, html, form: "10-K", sourceUrl: fixture.sourceUrl.replace("/1/", "/2/"), filedAt: fixture.sourceFiledAt, now }), null);
const twentyF = html.replaceAll("Item 1.", "Item 4. Information on the Company").replace(/<h2><span>ITEM[\s\S]*?<\/h2>/, "<h2>Item 4. Information on the Company</h2>").replaceAll("Item 1A.", "Item 5.");
assert.ok(profile.extractCompanyProfile({ identity, html: twentyF, form: "20-F", sourceUrl: fixture.sourceUrl, filedAt: fixture.sourceFiledAt, now }));

const objects = new Map(); let revision = 0;
const storage = {
  readVersionedTextFromR2: async key => objects.has(key) ? { found: true, text: JSON.stringify(objects.get(key)), etag: String(revision) } : { found: false, text: null, etag: null },
  writeVersionedJsonToR2: async (key, value) => { revision++; objects.set(key, structuredClone(value)); return { written: true, conflict: false }; },
};
const cache = loadTsModule("@/lib/opportunity-engine/company-profile-cache", { "@/lib/r2-warehouse": storage, "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: path => path } });
const submissions = { cik: 1, tickers: ["TEST"], filings: { recent: { form: ["10-K"], filingDate: [fixture.sourceFiledAt], accessionNumber: ["0000000001-26-000001"], primaryDocument: ["annual.htm"] } } };
let requests = 0, streamCancelled = false;
const fetcher = async url => {
  requests++;
  if (String(url).includes("submissions")) return Response.json(submissions);
  let sent = false;
  return new Response(new ReadableStream({ pull(controller) {
    if (sent) throw new Error("Should cancel the large filing once the business and customers are extracted");
    sent = true; controller.enqueue(new TextEncoder().encode(`${html}${" ".repeat(130000)}`));
  }, cancel() { streamCancelled = true; } }), { headers: { "content-length": "15000000" } });
};
assert.ok(await cache.ensureCompanyProfile(identity, fetcher, now));
assert.equal(requests, 2);
assert.equal(streamCancelled, true, "Business extraction stops before large financial exhibits");
assert.ok(await cache.ensureCompanyProfile(identity, fetcher, new Date(now.getTime() + 60000)));
assert.equal(requests, 2, "Verified profiles reuse the cache without provider requests");
objects.set("equity-universe/v1.json", { version: 1, scope: "active_us_exchange_listed_common_equities_and_adrs", entries: [{ ticker: "TEST", cik: "0000000001", sourceNames: ["SEC company_tickers_exchange"] }] });
assert.equal((await cache.readCompanyProfiles([identity], now)).size, 1);
objects.get("equity-universe/v1.json").entries[0].cik = "0000000002";
assert.equal((await cache.readCompanyProfiles([identity], now)).size, 0, "A recycled ticker cannot inherit the former issuer's profile");
objects.clear(); requests = 0;
const broken = async () => { requests++; return Response.json({ ...submissions, cik: 2 }); };
assert.equal(await cache.ensureCompanyProfile(identity, broken, now), null);
assert.equal(await cache.ensureCompanyProfile(identity, broken, new Date(now.getTime() + 60000)), null);
assert.equal(requests, 1, "Profile failure retries are cooled down");
assert.equal(await cache.ensureCompanyProfile(identity, broken, new Date(now.getTime() + 3600001)), null);
assert.equal(requests, 2, "Missing profiles continue retrieval after cooldown");
objects.clear(); requests = 0;
objects.set("equity-universe/v1.json", { version: 1, entries: [{ ...identity, sourceNames: ["SEC company_tickers_exchange"] }] });
objects.set("value-investing/resumable/latest/index.json", { kind: "us_value_investing_resumable_summary", seriousAlerts: { buy: [identity] } });
assert.deepEqual(await cache.warmFoundationCompanyProfiles(fetcher, now), { attempted: 1, verified: 1 });
assert.deepEqual(await cache.warmFoundationCompanyProfiles(fetcher, new Date(now.getTime() + 60000)), { attempted: 0, verified: 0 });
assert.equal(requests, 2, "Raw foundation warming is bounded by durable fifteen-minute cadence");
console.log("PASS: exact profile identity, annual business extraction, customers, provenance, bounded streams, cache reuse, retry backoff, raw-foundation warming");
