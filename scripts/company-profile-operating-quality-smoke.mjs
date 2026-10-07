import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";
const p = loadTsModule("@/lib/company-profile"), now = new Date("2026-10-03T16:00:00Z");
const identity = { ticker: "TEST", company: "Test Company", cik: "0000000001" }, good = companyProfileFixture(identity, now);
const wrap = (business, customers) => `<h2>Item 1. Business</h2><p>${business}</p><p>${"SOURCE_LAYOUT_PADDING ".repeat(30)}</p><p>${customers}</p><h2>Item 1A. Risk Factors</h2>`;
const parse = (business, customers) => p.inspectCompanyProfileExtraction({ identity, html: wrap(business, customers), form: "10-K", sourceUrl: good.sourceUrl, filedAt: good.sourceFiledAt, now }).profile;
const loan = "We predominantly originate floating-rate first mortgage loans, or whole loans, directly to borrowers.";
assert.equal(parse(loan, "")?.business, loan); assert.equal(parse(loan, "")?.customers, loan);
for (const bad of [loan.replace("originate", "expect to originate"), loan.replace("to borrowers", "from lenders"), loan.replace("to borrowers", "to shareholders"), loan.replace("We predominantly originate", "Our outside manager predominantly originates"), loan.replace("directly to borrowers", "for investors in our common stock")]) {
  assert.equal(parse(good.business, bad), null, bad);
  assert.equal(p.verifiedCompanyProfile({ ...good, customers: bad, description: `${good.business} ${bad}` }, identity, now), null, bad);
}
const payroll = "We offer non-executive officer employees a total compensation package consisting of base salary, cash target bonus, a comprehensive benefit package, including medical, dental and vision health care coverage, a 401(k) plan with an employer match, tax-advantaged savings accounts and equity compensation for every employee, which includes stock options and restricted stock units.";
const workOrders = "We currently operate under work order programs for sabirnetug with master services agreements in place that include specific supply timelines, volume and quality specifications.";
for (const business of [payroll, "We offer 25 paid days of time off and 13 days of paid holidays, in addition to a company closure during the last week of December.", "We also provide eligible employees the opportunity to participate in our employee stock purchase plan.", "We provide paid parental leave to both birth and adoptive parents.", workOrders]) {
  assert.equal(parse(business, good.customers), null, business);
  assert.equal(p.verifiedCompanyProfile({ ...good, business, description: `${business} ${good.customers}` }, identity, now), null, business);
}
const clinical = "We are a clinical-stage biopharmaceutical company developing a novel disease-modifying approach targeting what we believe to be a key underlying cause of Alzheimer’s disease, or AD.";
assert.equal(parse(clinical, good.customers)?.business, clinical, "Preserve the issuer's scientific qualification without asserting the mechanism as proven");
assert.equal(parse(clinical + `</p><p>${workOrders}`, good.customers)?.business, clinical);
for (const bad of [clinical.replace("cause of Alzheimer’s disease, or AD", "cause of commercial success in Alzheimer’s disease"), clinical.replace("what we believe to be", "what we expect will be"), clinical.replace("what we believe to be", "what we intend to be"), clinical.replace(", or AD.", ", and we believe earnings will rise."), clinical.replace(", or AD.", ", with earnings to double."), clinical.replace(", or AD.", ", generating cash flow next year."), clinical.replace(", or AD.", ", with no assurance of success."), clinical.replace(", or AD.", ", which may not respond to treatment.")]) {
  assert.equal(parse(bad, good.customers), null, bad);
  assert.equal(p.verifiedCompanyProfile({ ...good, business: bad, description: `${bad} ${good.customers}` }, identity, now), null, `Cached forecast: ${bad}`);
}
// Literal source attribution and CIK remain independent of the new syntax.
assert.equal(p.verifiedCompanyProfile(parse(loan, ""), { ...identity, cik: "2" }, now), null);
if (process.env.BACKGROUND_PROFILE_MANIFEST) {
  const rows = JSON.parse(readFileSync(process.env.BACKGROUND_PROFILE_MANIFEST));
  for (const row of rows) {
    const html = readFileSync(row.path ?? row.htmlPath ?? row.sourceFile, "utf8");
    const annualIdentity = row.identity ?? row;
    const result = p.inspectCompanyProfileExtraction({ ...row, identity: annualIdentity, sourceUrl: row.sourceUrl ?? row.url, html, now });
    assert.equal(Boolean(result.profile), annualIdentity.ticker === "ACR", annualIdentity.ticker);
    if (result.profile) { assert.equal(result.profile.business, loan); assert.equal(result.profile.customers, loan); }
  }
}
console.log("Operating quality: explicit lender-to-borrower direction, no payroll/procurement business, retained scientific qualification and unsupported financial forecasts rejected.");
