import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";
const p = loadTsModule("@/lib/company-profile"), now = new Date();
const identity = { ticker: "TEST", company: "Test Example Holdings Inc.", cik: "0000000001" }, fixture = companyProfileFixture(identity, now);
const pad = "The business maintains its operational infrastructure and provides ongoing support for its offerings. ".repeat(7);
const parse = customer => p.inspectCompanyProfileExtraction({ identity, html: `<h2>Item 1. Business</h2><p>${fixture.business}</p><p>${pad}</p><p>${customer}</p><h2>Item 1A. Risk Factors</h2>`, form: "10-K", sourceUrl: fixture.sourceUrl, filedAt: fixture.sourceFiledAt, now });
for (const customer of [
  "We offer data services for our dealer and commercial partners that support their vehicle inventory decisions.",
  "Test Example provides capital solutions for asset and wealth management firms through its operating subsidiary.",
  "We provide inventory management software for small and medium businesses that manage wholesale operations.",
]) assert.equal(parse(customer).profile?.customers, customer, "Concrete service recipients can follow for without named customer lists");
for (const customer of [
  "We provide data services for use by dealers to manage their vehicle inventory.",
  "We offer a software platform for wholesale vehicle transactions and data analysis used by commercial dealers.",
  "We provide training courses for our employees and their families at regional schools and institutions.",
  "We offer capital solutions for increased access to banks and businesses across the country.",
  "We offer data services for our own business using banks and commercial dealers.",
  "Other Entity provides capital solutions for asset and wealth management firms through its subsidiary.",
]) assert.equal(parse(customer).profile, null, "Usage, geography, internal beneficiaries and unrelated issuers cannot become direct recipient evidence");
if (process.env.COMPANY_PROFILE_SAMPLE_FIXTURES) {
  const dir = process.env.COMPANY_PROFILE_SAMPLE_FIXTURES;
  const manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, "utf8"));
  for (const row of manifest.filter(row => ["WTM", "ACVA"].includes(row.ticker))) {
    const html = readFileSync(`${dir}/${row.ticker}.html`, "utf8");
    const result = p.inspectCompanyProfileExtraction({ identity: row, html, form: row.form, sourceUrl: row.sourceUrl, filedAt: row.filedAt, now });
    assert.ok(result.profile); assert.ok(p.verifiedCompanyProfile(result.profile, row, now));
    const source = p.annualBusinessText(html, row.form).replace(/\s+/g, " ");
    assert.ok(source.includes(result.profile.business)); assert.ok(source.includes(result.profile.customers));
    if (row.ticker === "WTM") assert.match(result.profile.customers, /for asset and wealth management firms/);
    else assert.match(result.profile.customers, /for our dealer and commercial partners/);
    console.log(`${row.ticker}: actual source preserves explicit service-recipient population.`);
  }
}
console.log("Service recipients: bounded issuer-verified for-populations and usage/internal/unrelated negatives passed.");
