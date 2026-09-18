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
assert.equal(extracted.business, fixture.business);
assert.equal(extracted.customers, fixture.customers, "Section headings are excluded from factual sentences");
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

// Real source sentences from Apple's FY2025 Item 1:
// https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm
const appleBusiness = "The Company designs, manufactures and markets smartphones, personal computers, tablets, wearables and accessories, and sells a variety of related services.";
const appleCloud = "The Company’s cloud services store and keep customers’ content up-to-date and available across multiple Apple devices and Windows personal computers.";
const appleCustomers = "The Company’s customers are primarily in the consumer, small and mid-sized business, education, enterprise and government markets.";
const appleInput = { identity: { ticker: "AAPL", company: "Apple Inc.", cik: "0000320193" }, form: "10-K", sourceUrl: "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm", filedAt: "2025-10-31", now };
// Repeat a source paragraph only to retain the extractor's minimum section
// length when removing the customer description in the negative fixture.
const appleHtml = `<h2>Item 1. Business</h2><div>Company Background</div><p>${appleBusiness}</p><div>Cloud Services</div>${`<p>${appleCloud}</p>`.repeat(3)}<h3>Markets and Distribution</h3><p>${appleCustomers.replace("customers", "<span>customers</span>")}</p><h2>Item 1A. Risk Factors</h2>`;
const apple = profile.extractCompanyProfile({ ...appleInput, html: appleHtml });
assert.ok(apple);
assert.equal(apple.business, appleBusiness);
assert.equal(apple.customers, appleCustomers, "Actual customer markets outrank an earlier product-use mention");
assert.equal(profile.extractCompanyProfile({ ...appleInput, html: appleHtml.replace("The Company’s <span>customers</span>", "The Company’s\n<span>customers</span>") })?.customers, appleCustomers, "HTML formatting whitespace cannot truncate a factual sentence");
const appleWithoutCustomers = appleHtml.replace(appleCustomers.replace("customers", "<span>customers</span>"), "");
assert.equal(profile.extractCompanyProfile({ ...appleInput, html: appleWithoutCustomers }), null, "A customer mention alone cannot verify a profile");
const incidentalUsage = "Our customers are able to access their content across multiple devices and personal computers.";
assert.equal(profile.extractCompanyProfile({ ...appleInput, html: appleWithoutCustomers.replace("</p>", `</p><p>${incidentalUsage}</p>`) }), null, "An explicit customer subject with a usage predicate is not a customer segment");
assert.equal(profile.extractCompanyProfile({ ...appleInput, html: appleWithoutCustomers.replace("</p>", "</p><p>Our markets are highly competitive and characterized by rapid technological advances.</p>") }), null, "Competitive conditions do not identify customer markets");
assert.equal(profile.verifiedCompanyProfile({ ...apple, customers: appleCloud, description: `${apple.business} ${appleCloud}` }, appleInput.identity, now), null, "Previously cached incidental descriptions fail current verification");
const namedGroups = "We sell enterprise networking products to telecommunications service providers and government agencies.";
const directGroups = profile.extractCompanyProfile({ identity, html: html.replace(fixture.customers, namedGroups), form: "10-K", sourceUrl: fixture.sourceUrl, filedAt: fixture.sourceFiledAt, now });
assert.equal(directGroups?.customers, namedGroups, "Named buyers do not need the literal word customers");
assert.ok(profile.verifiedCompanyProfile(directGroups, identity, now));
const healthcareGroups = "The Company serves hospitals, outpatient clinics and independent medical laboratories throughout the United States.";
assert.equal(profile.extractCompanyProfile({ identity, html: html.replace(fixture.customers, healthcareGroups), form: "10-K", sourceUrl: fixture.sourceUrl, filedAt: fixture.sourceFiledAt, now })?.customers, healthcareGroups);
const preferred = profile.extractCompanyProfile({ identity, html: html.replace("<h3>Customers</h3>", `<p>${namedGroups}</p><h3>Customers</h3>`), form: "10-K", sourceUrl: fixture.sourceUrl, filedAt: fixture.sourceFiledAt, now });
assert.equal(preferred?.customers, fixture.customers, "Explicit customer composition wins over an earlier individual sales channel");

// Synthetic analogues of the production filing decoys preserve the problematic
// grammar without treating legal history, geography or product usage as buyers.
const extractSentences = (business, customers, exactIdentity = identity) => profile.extractCompanyProfile({
  identity: exactIdentity, html: html.replace(fixture.business, business).replace(fixture.customers, customers),
  form: "10-K", sourceUrl: fixture.sourceUrl, filedAt: fixture.sourceFiledAt, now,
});
const businessDecoys = [
  "On March 12, the Company filed a registration statement on Form F-1 relating to a proposed public offering of Ordinary Shares.",
  "The Company offers ordinary shares under a registration statement filed with the Securities and Exchange Commission.",
  "Star Shipping Corp. was incorporated in 2006 and commenced operations by taking delivery of its first vessel.",
  ", a Utah corporation, develops diagnostic instruments and related molecular testing products for laboratories.",
];
for (const business of businessDecoys) {
  assert.equal(extractSentences(business, fixture.customers), null, `Not an operating description: ${business}`);
  assert.equal(profile.verifiedCompanyProfile({ ...fixture, business, description: `${business} ${fixture.customers}` }, identity, now), null, "Previously cached business boilerplate must invalidate");
  assert.equal(extractSentences(`${business} ${fixture.business}`, fixture.customers)?.business, fixture.business, "Selection continues to a genuine operating sentence after boilerplate");
}
const customerDecoys = [
  "Although our clients are primarily from China, none of our business operations are conducted in mainland China.",
  "Our clients are primarily from China, with the remainder based in other countries and territories.",
  "Our diagnostic test is a gene expression assay that assesses whether a patient is likely to have a slow growing tumor.",
  "Workplace Management solutions offered to clients range from mobile engineering to building maintenance services.",
  "Our markets are growing rapidly as demand for digital services increases.",
];
for (const customers of customerDecoys) {
  assert.equal(extractSentences(fixture.business, customers), null, `Not a buyer description: ${customers}`);
  assert.equal(profile.verifiedCompanyProfile({ ...fixture, customers, description: `${fixture.business} ${customers}` }, identity, now), null, "Previously cached incidental/geographic customer statements must invalidate");
  assert.equal(extractSentences(fixture.business, `${customers} ${fixture.customers}`)?.customers, fixture.customers, "Incidental clauses cannot outrank later actual buyer groups");
}
const validOperatingProfiles = [
  ["We are the largest publicly traded water and wastewater utility in the United States.", "A customer is defined as a person, business, municipality or any other entity that purchases our water or wastewater services."],
  ["We provide residential solar energy systems, electricity leases and related maintenance services.", "Our primary customers are homeowners who lease solar electricity systems and receive ongoing maintenance services."],
  ["We provide residential solar energy systems, electricity leases and related maintenance services.", "Our primary customers are homeowners."],
  ["We operated 290 banking offices across 12 states in the United States.", "We provide a wide range of trust, employee benefit, investment management, insurance, agency, and custodial services to individuals, businesses, and nonprofit organizations."],
  ["We operate ocean-going dry bulk vessels that transport commodities and agricultural products worldwide.", "We have well-established relationships with major dry bulk charterers, which we serve by carrying a variety of cargoes over a multitude of routes around the globe."],
];
for (const [business, customers] of validOperatingProfiles) {
  const valid = extractSentences(business, customers);
  assert.equal(valid?.business, business);
  assert.equal(valid?.customers, customers);
  assert.ok(profile.verifiedCompanyProfile(valid, identity, now));
}
for (const suffix of ["Inc.", "Corp.", "Co."]) {
  const exactIdentity = { ...identity, company: `Diagnostic Products ${suffix}` };
  const business = `${exactIdentity.company}, a Utah corporation, develops diagnostic testing products and related laboratory instruments.`;
  assert.equal(extractSentences(business, fixture.customers, exactIdentity)?.business, business, "Company abbreviation periods must not produce orphaned sentence fragments");
}
const namedIdentity = { ...identity, company: "Diagnostic Products, Inc." };
const encodedBusiness = 'Diagnostic Products, Inc. (&#8220;the Company&#8221;), a Utah corporation, develops diagnostic instruments&#8212;including TestKit&#174; products for laboratories.';
const decodedBusiness = 'Diagnostic Products, Inc. (“the Company”), a Utah corporation, develops diagnostic instruments—including TestKit® products for laboratories.';
assert.equal(extractSentences(encodedBusiness, fixture.customers, namedIdentity)?.business, decodedBusiness, "Numeric HTML entities decode while the complete issuer subject is preserved");
assert.equal(extractSentences(encodedBusiness.replaceAll("&#8220;", "&#x201C;").replaceAll("&#8221;", "&#x201D;"), fixture.customers, namedIdentity)?.business, decodedBusiness);
const encodedCachedProfile = { ...fixture, company: namedIdentity.company, business: encodedBusiness, description: `${encodedBusiness} ${fixture.customers}` };
const normalizedCache = profile.verifiedCompanyProfile(encodedCachedProfile, namedIdentity, now);
assert.equal(normalizedCache?.business, decodedBusiness, "Formatting-only cached entities decode without requiring SEC retrieval");
assert.equal(normalizedCache?.description, `${decodedBusiness} ${fixture.customers}`);
assert.equal(normalizedCache?.verifiedAt, encodedCachedProfile.verifiedAt, "Normalization never refreshes the verification date");
assert.equal(profile.verifiedCompanyProfile({ ...encodedCachedProfile, description: `${encodedBusiness} Different customers were claimed.` }, namedIdentity, now), null, "Entity decoding cannot repair mismatched factual descriptions");
assert.equal(profile.verifiedCompanyProfile(encodedCachedProfile, namedIdentity, new Date(now.getTime() + 31 * 86400000)), null);
assert.equal(profile.verifiedCompanyProfile({ ...encodedCachedProfile, sourceUrl: fixture.sourceUrl.replace("/1/", "/2/") }, namedIdentity, now), null);

// Exact valid source grammar observed on the live AWK and FIBK cards.
const awkIdentity = { ...identity, company: "American Water Works Company, Inc." };
const awkBusiness = "With a history dating back to 1886, American Water is the largest and most geographically diverse, publicly-traded water and wastewater utility company in the United States, as measured by both operating revenues and population served.";
const fibkIdentity = { ...identity, company: "First Interstate BancSystem, Inc." };
const fibkBusiness = "As of February 20, 2026, we operated 290 banking offices, including branches and detached drive-up facilities, in communities across 12 states— Colorado, Idaho, Iowa, Minnesota, Missouri, Montana, Nebraska, North Dakota, Oregon, South Dakota, Washington, and Wyoming.";
for (const [exactIdentity, business] of [[awkIdentity, awkBusiness], [fibkIdentity, fibkBusiness]]) {
  const valid = extractSentences(business, fixture.customers, exactIdentity);
  assert.equal(valid?.business, business, "Matching contextual introductions retains every word of the source sentence");
  assert.ok(profile.verifiedCompanyProfile({ ...fixture, company: exactIdentity.company, business, description: `${business} ${fixture.customers}` }, exactIdentity, now));
}
for (const business of [
  awkBusiness.replace("American Water is", "American Electric is"),
  awkBusiness.replace("American Water is", "American is"),
  awkBusiness.replace("American Water is", "American Waters is"),
  awkBusiness.replace("American Water is", "American Water Holdings is"),
  "As of February 20, 2026, the Company filed a registration statement for its proposed public offering of Ordinary Shares.",
]) assert.equal(extractSentences(business, fixture.customers, awkIdentity), null, "A contextual introduction cannot admit unrelated issuers or filing boilerplate");

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
const profileCacheKey = "research-evidence/company-profiles-v1.json";
const savedCache = structuredClone(objects.get(profileCacheKey));
objects.set(profileCacheKey, { version: 1, entries: [{ ...namedIdentity, profile: encodedCachedProfile, updatedAt: now.toISOString(), nextAttemptAt: new Date(now.getTime() + 30 * 86400000).toISOString() }] });
assert.equal((await cache.ensureCompanyProfile(namedIdentity, fetcher, now))?.business, decodedBusiness);
assert.equal(requests, 2, "Verified formatting-only cache repairs do not make provider requests");
objects.set(profileCacheKey, savedCache);
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
// Keep cache migration coverage in both existing CI entry points for this smoke.
await import("./company-profile-cache-invalidation-smoke.mjs");
console.log("PASS: exact profile identity, annual business extraction, customers, provenance, bounded streams, cache reuse, retry backoff, raw-foundation warming");
