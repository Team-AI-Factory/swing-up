import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";
const p = loadTsModule("@/lib/company-profile"), now = new Date("2026-10-06T12:00:00Z");
const identity = { ticker: "TEST", company: "Test Company", cik: "0000000001" }, fixture = companyProfileFixture(identity, now);
const wrap = (business, customers) => `<h2>Item 1. Business</h2><p>${business}</p><p>${"NEUTRAL_OPERATING_CONTEXT ".repeat(30)}</p><p>${customers}</p><h2>Item 1A. Risk Factors</h2>`;
const parse = (business, customers) => p.extractCompanyProfile({ identity, html: wrap(business, customers), form: "10-K", sourceUrl: fixture.sourceUrl, filedAt: fixture.sourceFiledAt, now });
const aos = "Our Aquasana branded products are primarily sold directly to consumers through e-commerce channels.";
const aort = "In the US and Canada, we market our products and preservation services primarily to physicians and sell our products through our approximately 50-person direct sales team to hospitals and other healthcare facilities.";
for (const good of [aos, aos.replace("primarily", "mainly"), aos.replace("primarily sold directly", "sold directly"), aort]) {
  const result = parse(fixture.business, good); assert.ok(result, good); assert.equal(result.customers, good); assert.ok(p.verifiedCompanyProfile(result, identity, now));
}
const badCustomers = [
  aos.replace("are primarily sold", "may be primarily sold"), aos.replace("are primarily sold", "are not primarily sold"), aos.replace("are primarily sold", "were formerly sold"),
  aos.replace("sold", "marketed"), aos.replace("to consumers", "to potential consumers"), aos.replace("to consumers", "to prospective consumers"),
  aos.replace("to consumers", "to study healthcare companies"), aos.replace("to consumers", "from suppliers"), aos.replace("to consumers", "to shareholders"),
  aos.replace("Our Aquasana", "Their Aquasana"), aos.replace("to consumers", "to us for internal use"),
  ...["in our forecast", "in this illustrative scenario", "in our proposed business model", "as we expect after launch", "in a projection", "subject to future approval"].map(tail => aos.replace("through e-commerce channels.", `${tail}.`)),
  aos.replace("Aquasana branded", "planned Aquasana"),
  ...["simulated", "projected", "forecasted", "imagined", "fictional", "proposed branded", "simulated branded", "future Aquasana branded"].map(modifier => aos.replace("Aquasana branded", modifier)),
  "Our products are marketed to potential consumers.",
  "Our products are sold to prospective consumers.",
  aort.replace("and sell our products", "and may sell our products"), aort.replace("and sell our products", "and do not sell our products"),
  aort.replace(" and sell our products through our approximately 50-person direct sales team to hospitals and other healthcare facilities", ""),
  aort.replace("we market our products", "our supplier markets its products"), aort.replace("to hospitals and other healthcare facilities", "to investors and prospective partners"),
];
for (const bad of badCustomers) {
  assert.equal(parse(fixture.business, bad), null, bad);
  assert.equal(p.verifiedCompanyProfile({ ...fixture, customers: bad, description: `${fixture.business} ${bad}` }, identity, now), null, `Cached ${bad}`);
}
for (const benefits of [
  "We offer a comprehensive total rewards program aimed at promoting overall well-being in support of the varying health, home-life and financial needs of our global associates.",
  "The Company also offers defined contribution retirement plans to its eligible employees, and a non-mandatory central provident fund scheme to eligible employees in Macau which includes contributions from employees and the employer.",
  "The Company also provides employee paid supplemental life and accident insurance plans.",
  "In addition, we provide our employees in Macau with numerous professional development and training opportunities to elevate core and leadership skills.",
]) {
  assert.equal(parse(benefits, fixture.customers), null, benefits);
  assert.equal(p.verifiedCompanyProfile({ ...fixture, business: benefits, description: `${benefits} ${fixture.customers}` }, identity, now), null, `Cached ${benefits}`);
}
assert.ok(parse("We provide retirement plans and employee benefits insurance to corporate customers and small businesses.", fixture.customers), "Selling benefits to outside business customers is not the issuer's own staff compensation");
if (process.env.PROFILE_SALES_FIXTURES) {
  const folder = process.env.PROFILE_SALES_FIXTURES;
  const report = JSON.parse(readFileSync(`${folder}/replay-report.json`));
  const results = [];
  for (const row of report.results) {
    const bytes = readFileSync(`${folder}/${row.ticker}.html`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), row.rawHtmlSha256);
    const result = p.inspectCompanyProfileExtraction({ identity: row, html: bytes.toString("utf8"), form: row.form, sourceUrl: row.sourceUrl, filedAt: row.sourceFiledAt, now });
    const expected = ["ACR", "AORT", "AOS"].includes(row.ticker);
    assert.equal(Boolean(result.profile), expected, row.ticker);
    if (result.profile) { assert.ok(p.verifiedCompanyProfile(result.profile, row, now)); assert.equal(result.profile.sourceUrl, row.sourceUrl); assert.equal(result.profile.sourceFiledAt, row.sourceFiledAt); }
    if (row.ticker === "AORT") assert.equal(result.profile?.customers, aort);
    if (row.ticker === "AOS") assert.equal(result.profile?.customers, aos);
    results.push({ ticker: row.ticker, baselineVerified: row.variants.frozen.verified, currentVerified: Boolean(result.profile), reason: result.reason });
  }
  console.log(JSON.stringify({ actualSourceReplay: results, note: "Fresh latest SEC annuals for four current failure tickers; production cached source URLs were not available. Six historical sources matched their original normalized text." }));
}
console.log("Sales grammar: exact AOS/AORT buyers, preserved sale direction and qualifiers; tested forecast, marketing-only, supplier/investor and employee-business negatives rejected in extraction and cache validation.");
