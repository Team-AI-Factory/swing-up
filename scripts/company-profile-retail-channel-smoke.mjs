import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";

globalThis.fetch = () => { throw new Error("This authentic-fixture regression must not make network requests"); };
const folder = new URL("./fixtures/company-profile-retail-channel/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", folder), "utf8"));
const bytes = gunzipSync(readFileSync(new URL(manifest.fixture, folder)));
const discoveryBytes = gunzipSync(readFileSync(new URL(manifest.submissionsFixture, folder)));
const sha = value => createHash("sha256").update(value).digest("hex");
assert.equal(sha(bytes), manifest.source.rawHtmlSha256);
assert.equal(bytes.length, manifest.rawBytes);
assert.equal(sha(discoveryBytes), manifest.source.discoverySha256);
const discovery = JSON.parse(discoveryBytes), source = manifest.source;
assert.equal(String(discovery.cik).padStart(10, "0"), source.cik);
assert.ok(discovery.tickers.includes(source.ticker));
assert.equal(discovery.name, source.company);
const recent = discovery.filings.recent, at = recent.accessionNumber.indexOf(source.accession);
assert.ok(at >= 0);
assert.equal(recent.form[at], source.form);
assert.equal(recent.filingDate[at], source.filedAt);
assert.equal(recent.reportDate[at], source.reportPeriod);
assert.equal(source.sourceUrl, `https://www.sec.gov/Archives/edgar/data/${Number(source.cik)}/${source.accession.replaceAll("-", "")}/${recent.primaryDocument[at]}`);
const p = loadTsModule("@/lib/company-profile"), now = new Date(manifest.asOf);
const html = bytes.toString("utf8");
assert.match(html, /<\/html>\s*$/i);
const input = { identity: source, form: source.form, sourceUrl: source.sourceUrl, filedAt: source.filedAt, now };
const section = p.annualBusinessText(html, source.form);
assert.equal(sha(section), manifest.businessSectionSha256);
assert.equal(section.indexOf(manifest.expectedCustomers), manifest.customerBusinessSectionOffset);
assert.equal(sha(manifest.expectedCustomers), manifest.customerQuoteSha256);
assert.ok(section.includes(manifest.transitionParagraph));
const result = p.inspectCompanyProfileExtraction({ ...input, html });
assert.equal(result.reason, null);
assert.equal(result.profile?.business, manifest.expectedBusiness);
assert.equal(result.profile?.customers, manifest.expectedCustomers);
assert.ok(p.verifiedCompanyProfile(result.profile, source, now));
assert.equal(result.profile.sourceFiledAt, source.filedAt);
assert.equal(result.profile.sourceUrl, source.sourceUrl);
assert.ok(!/direct.to.consumer|DTC|Ace Hardware|Home Depot|Amazon|Best Buy/.test(result.profile.customers), "The recovered quote identifies retail buyer classes, not current DTC or inferred named customers");

// A synthetic shell isolates grammar. Its business is a real source quote;
// no synthetic customer mutation is promoted to an authentic filing fixture.
const pad = "NEUTRAL_OPERATING_CONTEXT ".repeat(30);
const availability = "Our core retail products are available through a broad network of retail partners across global markets.";
const wrap = (customers, business = manifest.expectedBusiness) => `Item 1. Business\n${business}\n${pad}\n${customers}\nItem 1A. Risk Factors\n`;
const parse = (customers, business) => p.inspectCompanyProfileExtraction({ ...input, html: wrap(`${customers} ${availability}`, business) });
const customer = manifest.expectedCustomers;
const negatives = [
  customer.replace("Our", "Their"), customer.replace("Our", "Our supplier's"),
  customer.replace("retail channel", "prospective retail channel"), customer.replace("retail channel", "planned retail channel"),
  customer.replace("retail channel", "former retail channel"), customer.replace("retail channel", "hypothetical retail channel"),
  customer.replace("covers", "may cover"), customer.replace("covers", "could cover"),
  customer.replace("covers", "will cover"), customer.replace("covers", "does not cover"),
  customer.replace("covers", "formerly covered"), customer.replace("covers", "used to cover"),
  customer.replace("our relationships", "their relationships"), customer.replace("our relationships", "our proposed relationships"),
  customer.replace("with brick", "with potential brick"), customer.replace("with brick", "with prospective brick"),
  customer.replace("brick-and-mortar retailers, e-commerce platforms, and multichannel retailers", "suppliers, investors, and employees"),
  customer.replace("brick-and-mortar retailers, e-commerce platforms, and multichannel retailers", "retail locations in North America"),
  customer.replace("brick-and-mortar retailers, e-commerce platforms, and multichannel retailers", "users of other companies' retail websites"),
  ...[" if our expansion succeeds", " in a hypothetical scenario", " after our planned launch", " for our own internal use", " but those relationships have terminated", " which we exited in 2025", " at no charge"].map(tail => customer.slice(0, -1) + tail + "."),
  "We have two primary sales channels: retail and DTC.",
  "We complement this retail channel with direct to consumer (“DTC”) sales through our website and Traeger app.",
  manifest.transitionParagraph,
];
for (const negative of negatives) {
  assert.equal(parse(negative).profile, null, `Extraction rejects ${negative}`);
  assert.equal(p.verifiedCompanyProfile({ ...result.profile, customers: negative, description: `${result.profile.business} ${negative}` }, source, now), null, `Cache validation rejects ${negative}`);
}
// Independent review found that sentence-only checks discarded adjacent
// qualifications. Preserve the exact probes and test them again with the real
// affirmative availability sentence, in the same and adjacent paragraphs.
const qualifiers = [
  "These relationships consist solely of free marketing pilots and have generated no product sales.",
  "All of these relationships were terminated before year-end and we no longer sell through this channel.",
  "All of these relationships are prospective and contingent on a future launch.",
  "We have not launched our retail channel.",
  "Our retail partners were terminated before year-end.",
  "These relationships may become commercial after launch.",
  "We have yet to begin selling through this channel.",
  "Our retail products generate zero revenue.",
  "We exited our retail channel while expanding our DTC business.",
];
const exactReviewerProbes = [
  `${customer} ${qualifiers[0]}`,
  `We have not launched our retail channel. ${customer} ${qualifiers[2]}`,
  `${customer} ${qualifiers[1]}`,
];
for (const probe of exactReviewerProbes) assert.equal(p.inspectCompanyProfileExtraction({ ...input, html: wrap(probe) }).profile, null);
for (const qualifier of qualifiers) {
  for (const sourceText of [`${qualifier} ${customer} ${availability}`, `${customer} ${availability} ${qualifier}`,
    `${qualifier}\n${customer} ${availability}`, `${customer} ${availability}\n${qualifier}`]) {
    assert.equal(p.inspectCompanyProfileExtraction({ ...input, html: wrap(sourceText) }).profile, null, `Retained source context rejects ${sourceText}`);
  }
  const evidence = structuredClone(result.profile.retailChannelEvidence);
  evidence.contextParagraphs[evidence.quoteParagraph - evidence.contextStartParagraph] += ` ${qualifier}`;
  assert.equal(p.verifiedCompanyProfile({ ...result.profile, retailChannelEvidence: evidence }, source, now), null, `Cached context rejects ${qualifier}`);
}
assert.equal(p.inspectCompanyProfileExtraction({ ...input, html: wrap(customer) }).profile, null, "A retail relationship list alone lacks current retail availability corroboration");
assert.equal(p.verifiedCompanyProfile({ ...result.profile, retailChannelEvidence: undefined }, source, now), null, "Sentence-only cached retail profiles fail closed");
const evidence = result.profile.retailChannelEvidence;
assert.ok(evidence.contextParagraphs.some(paragraph => paragraph.includes(manifest.transitionParagraph)), "Actual adjacent DTC transition stays in retained cache evidence");
for (const patch of [{ sourceUrl: source.sourceUrl + "?other" }, { sourceFiledAt: "2025-01-01" }, { cik: "0000000001" },
  { form: "40-F" }, { quote: customer.replace("Our", "Their") }, { contextParagraphs: [] }, { contextParagraphs: [customer] },
  { contextStartParagraph: evidence.contextStartParagraph + 1 }, { sectionParagraphCount: 0 }]) {
  assert.equal(p.verifiedCompanyProfile({ ...result.profile, retailChannelEvidence: { ...evidence, ...patch } }, source, now), null);
}
const noAvailability = structuredClone(evidence);
noAvailability.contextParagraphs = noAvailability.contextParagraphs.map(paragraph => paragraph.replace(availability, ""));
assert.equal(p.verifiedCompanyProfile({ ...result.profile, retailChannelEvidence: noAvailability }, source, now), null);
// Existing source-context and full-profile gates are unchanged.
assert.equal(parse(`${customer} ${availability}\n${manifest.transitionParagraph}`).profile?.customers, customer, "DTC exit context is retained without turning it into a current DTC customer claim");
assert.equal(p.inspectCompanyProfileExtraction({ ...input, html: wrap("") + customer }).profile, null, "Risk Factors cannot supply Business customers");
assert.equal(p.inspectCompanyProfileExtraction({ ...input, html: `Item 7. Management Discussion\n${manifest.expectedBusiness}\n${pad}\n${customer}` }).profile, null);
assert.equal(parse(customer, "We provide products to retailers throughout the country.").profile, null, "Vague business text still cannot satisfy a full profile");
assert.equal(parse(customer, "We offer our employees a total compensation package and a competitive benefit package.").profile, null);
for (const identity of [{ ...source, cik: "0000000001" }, { ...source, ticker: "OTHER" }, { ...source, company: "Unrelated Issuer" }]) {
  assert.equal(p.verifiedCompanyProfile(result.profile, identity, now), null);
}
for (const patch of [
  { sourceUrl: source.sourceUrl.replace("www.sec.gov", "example.com") },
  { sourceFiledAt: "2024-01-01" }, { sourceFiledAt: "2026-10-16" },
  { verifiedAt: "2026-10-16T00:00:00.000Z" },
  { description: `${result.profile.description} Extra unsupported words.` },
  { business: "Insufficient business text" }, { customers: "Retailers" },
]) assert.equal(p.verifiedCompanyProfile({ ...result.profile, ...patch }, source, now), null);
assert.equal(p.verifiedCompanyProfile(result.profile, source, new Date(now.getTime() + 31 * 86400000)), null);
assert.equal(parse(customer).profile?.customers, customer, "No named customers are required for an explicit retail buyer-class quote");
console.log(JSON.stringify({ ok: true, authenticFullAnnuals: 1, ticker: source.ticker, parserRevision: p.COMPANY_PROFILE_PARSER_REVISION, baselineReason: manifest.baselineReason, recovered: true, customerNegatives: negatives.length, cacheValidationNegatives: negatives.length, sourceHashVerified: true, discoveryIdentityVerified: true, transitionPreserved: true, exactIndependentReviewerProbes: exactReviewerProbes.length, contextualNegativeCases: qualifiers.length * 4, cachedContextNegatives: qualifiers.length, sentenceOnlyCacheRejected: true, namedCustomersRequired: false, networkRequests: 0, productionCacheByteIdentity: "unknown" }, null, 2));
