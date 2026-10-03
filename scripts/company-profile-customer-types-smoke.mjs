import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";
const p = loadTsModule("@/lib/company-profile"), now = new Date();
const identity = { ticker: "TEST", company: "Test Company", cik: "0000000001" }, fixture = companyProfileFixture(identity, now);
const padding = "This paragraph provides neutral operating context about the company and its ongoing activities. ".repeat(8);
const html = (business, customer) => `<h2>Item 1. Business</h2><p>${business}</p><p>${padding}</p>${customer}<h2>Item 1A. Risk Factors</h2>`;
const parse = (business, customer) => p.inspectCompanyProfileExtraction({ identity, html: html(business, customer), form: "10-K", sourceUrl: fixture.sourceUrl, filedAt: fixture.sourceFiledAt, now });
for (const generic of [
  "The Company sells its products primarily to mass market and e-commerce retailers across the country.",
  "We offer customers a competitive price along with differentiated offerings and services.",
  "The Company sells products containing hazardous materials as part of the business.",
  "We operate our business so as to be excluded from regulation under the Investment Company Act.",
  "The Company provides a range of benefits to its employees and their families, including medical coverage and retirement accounts.",
]) {
  assert.equal(parse(generic, `<p>${fixture.customers}</p>`).profile, null, "A verified business must identify actual operations/products, not distribution or generic benefits");
  const cached = { ...fixture, business: generic, description: `${generic} ${fixture.customers}` };
  assert.equal(p.verifiedCompanyProfile(cached, identity, now), null, "Previously cached generic business descriptions fail current validation");
}
const legalIdentity = { ...identity, company: "Test Company Corp" };
const legalBusiness = 'Test Company Corporation, a Delaware corporation (with its subsidiaries, the "Company"), is a worldwide supplier of clinical instruments and laboratory equipment.';
const legalInput = { identity: legalIdentity, html: html(legalBusiness, `<p>${fixture.customers}</p>`), form: "10-K", sourceUrl: fixture.sourceUrl, filedAt: fixture.sourceFiledAt, now };
assert.equal(p.inspectCompanyProfileExtraction(legalInput).profile?.business, legalBusiness, "Equivalent full legal suffix and bounded parenthetical apposition preserve actual issuer identity");
assert.equal(p.inspectCompanyProfileExtraction({ ...legalInput, html: legalInput.html.replace("Test Company Corporation", "Unrelated Company Corporation") }).profile, null, "Legal suffix support never invents a shortened issuer alias");
assert.ok(parse("We also offer mortgage insurance and credit-related reinsurance through our operating subsidiaries.", `<p>${fixture.customers}</p>`).profile);
const service = "Together with our regional subsidiaries, our primary business activity is the operation of a network air carrier, providing scheduled air transportation for passengers and cargo through our connecting flight network.";
assert.ok(parse(service, `<p>${service}</p>`).profile, "Explicit commercial service recipients are sufficient without named customers");
assert.equal(parse(fixture.business, "<p>We provide service to over 300 destinations and approximately 200 million passengers boarded our flights.</p>").profile, null, "Passenger counts and destinations alone are not a buyer-population description");
assert.equal(parse(fixture.business, `<p>${service.replace("our primary business", "our supplier's primary business")}</p>`).profile, null, "Another company's service is not the issuer's customers");
const bio = "We are using our platform to develop a pipeline of drug candidates against high-value targets such as GPCRs and ion channels.";
const groups = "We have extensive experience partnering with pharmaceutical companies and emerging biotechnology companies.";
const payments = "Our partnership agreements to date have commonly included: (i) near-term payments for access, research, and intellectual property rights; and (ii) royalties on net sales of drugs.";
const positive = parse(bio, `<p>${groups}</p><p>${payments}</p>`).profile;
assert.ok(positive); assert.equal(positive.customers, `${groups} ${payments}`, "Preserve adjacent population and commercial context, with no generated claims");
assert.ok(p.verifiedCompanyProfile(positive, identity, now));
assert.equal(p.verifiedCompanyProfile({ ...positive, customers: groups, description: `${bio} ${groups}` }, identity, now), null, "A cached partner list alone is insufficient");
for (const customer of [
  `<p>${groups}</p>`,
  `<p>${groups}</p><p>Unrelated research context interrupts this passage.</p><p>${payments}</p>`,
  `<p>${groups.replace("companies and emerging biotechnology companies", "suppliers and investors")}</p><p>${payments}</p>`,
  `<p>${groups}</p><p>${payments.replace("near-term payments for access", "payments by us for access")}</p>`,
  `<p>${groups}</p><p>Our partnership agreements include academic collaboration and research grants.</p>`,
]) assert.equal(parse(bio, customer).profile, null, "Unpaid, supplier, investor or nonadjacent partnership text cannot become customer evidence");
assert.equal(parse(bio.replace("drug candidates", "assets").replace("GPCRs and ion channels", "general financial instruments"), `<p>${fixture.customers}</p>`).profile, null, "A generic asset platform is not a therapeutic business");
const afterRisk = html(bio, "") + `<p>See Item 1. Business for details.</p><p>${groups}</p><p>${payments}</p>${padding.repeat(20)}`;
assert.equal(p.inspectCompanyProfileExtraction({ identity, html: afterRisk, form: "10-K", sourceUrl: fixture.sourceUrl, filedAt: fixture.sourceFiledAt, now }).profile, null, "Commercial quote must remain within the authenticated business section");

// Replacing an invalid legacy description retains its original first-verification
// timestamp and cannot inflate today's newly verified issuer count.
const objects = new Map(), previousDay = new Date(now.getTime() - 86400000).toISOString();
objects.set("research-evidence/company-profiles-v1.json", { entries: [{ ...identity, profile: { ...fixture, business: "We offer customers a competitive price along with differentiated offerings and services." }, firstVerifiedAt: previousDay, updatedAt: previousDay, nextAttemptAt: new Date(now.getTime() + 30 * 86400000).toISOString() }] });
const io = { readVersionedTextFromR2: async key => ({ found: objects.has(key), text: objects.has(key) ? JSON.stringify(objects.get(key)) : null, etag: objects.has(key) ? "1" : null }), writeVersionedJsonToR2: async (key, value) => { objects.set(key, structuredClone(value)); return { written: true, conflict: false }; } };
const cache = loadTsModule("@/lib/opportunity-engine/company-profile-cache", { "@/lib/r2-warehouse": io, "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => key } });
const refreshed = await cache.ensureCompanyProfile(identity, async url => String(url).includes("submissions") ? Response.json({ cik: 1, tickers: ["TEST"], filings: { recent: { form: ["10-K"], filingDate: [fixture.sourceFiledAt], accessionNumber: ["0000000001-26-000001"], primaryDocument: ["annual.htm"] } } }) : new Response(html(fixture.business, `<p>${fixture.customers}</p>`)), now);
assert.ok(refreshed);
const persisted = objects.get("research-evidence/company-profiles-v1.json").entries;
assert.equal(persisted[0].firstVerifiedAt, previousDay);
const planner = loadTsModule("@/lib/simple-alert-profile-builder", { "@/lib/r2-warehouse": io }).profileBatchPlan;
assert.equal(planner([{ ...identity, name: identity.company, exchange: "Nasdaq", securityType: "common_stock", sourceNames: ["SEC company_tickers_exchange"] }], persisted, now, 100).newlyVerifiedToday, 0);

// Byte-pinned optional replay of separately downloaded official annual reports.
if (process.env.COMPANY_PROFILE_CUSTOMER_FIXTURES) {
  const cases = [
    { ticker: "AAL", company: "American Airlines Group Inc.", cik: "6201", file: "aal.html", hash: "2b1112ec7bf9dee920391bfaf709272a9f3c2cb671aa96e6cffa3ceedf7ac4d9", url: "https://www.sec.gov/Archives/edgar/data/6201/000000620126000014/aal-20251231.htm", filed: "2026-02-18" },
    { ticker: "ABCL", company: "AbCellera Biologics Inc.", cik: "1703057", file: "abcl.html", hash: "f3c13e66de976177e76de20c258de859139dd40cf7e0613c54e518c7458285a3", url: "https://www.sec.gov/Archives/edgar/data/1703057/000170305726000012/abcl-20251231.htm", filed: "2026-02-24" },
  ];
  for (const row of cases) {
    const body = readFileSync(resolve(process.env.COMPANY_PROFILE_CUSTOMER_FIXTURES, row.file));
    assert.equal(createHash("sha256").update(body).digest("hex"), row.hash);
    const result = p.inspectCompanyProfileExtraction({ identity: row, html: body.toString(), form: "10-K", sourceUrl: row.url, filedAt: row.filed, now });
    assert.ok(result.profile); assert.ok(p.verifiedCompanyProfile(result.profile, row, now));
    if (row.ticker === "AAL") assert.match(result.profile.customers, /scheduled air transportation for passengers and cargo/);
    else { assert.match(result.profile.customers, /pharmaceutical companies, emerging biotechnology companies/); assert.match(result.profile.customers, /royalties on net sales/); }
    console.log(`${row.ticker} actual annual replay: source-backed business and customer type verified without invented names.`);
  }
}
console.log("Customer types: source-bound service recipients and adjacent paid-partner categories, with unrelated/supplier/usage/count negatives, passed.");
