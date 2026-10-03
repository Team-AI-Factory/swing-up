import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";
const parser = loadTsModule("@/lib/company-profile");
const now = new Date("2026-10-03T15:00:00Z");
// Exact excerpts from the dated SEC annuals; headings and neutral padding below
// model the layout only. An optional complete-file replay checks pinned bytes.
const cases = JSON.parse(readFileSync(new URL("./fixtures/company-profile-cohort-extracts.json", import.meta.url)));
const pad = "SOURCE_LAYOUT_PADDING ".repeat(30);
const wrap = (business, customers) => `<h2>Item 1. Business</h2><p>${business}</p><p>${pad}</p>${customers.map(c => `<p>${c}</p>`).join("")}<h2>Item 1A. Risk Factors</h2>`;
for (const c of cases) {
  const result = parser.inspectCompanyProfileExtraction({ ...c, html: wrap(c.business, c.customerParagraphs), now });
  assert.ok(result.profile, `${c.identity.ticker}: ${result.reason}`);
  assert.equal(result.profile.business, c.business, c.identity.ticker);
  assert.equal(result.profile.customers, c.customers, c.identity.ticker);
  assert.equal(result.profile.sourceUrl, c.sourceUrl); assert.equal(result.profile.sourceFiledAt, c.filedAt);
  assert.equal(result.profile.cik, c.identity.cik); assert.equal(result.profile.sourceType, "sec_annual_filing");
  assert.ok(parser.verifiedCompanyProfile(result.profile, c.identity, now));
}
const identity = { ticker: "TEST", company: "Test Company", cik: "0000000001" }, fixture = companyProfileFixture(identity, now);
const parse = (business, customers) => parser.inspectCompanyProfileExtraction({ identity, html: wrap(business, [customers]), form: "10-K", sourceUrl: fixture.sourceUrl, filedAt: fixture.sourceFiledAt, now }).profile;
const negatives = [
  "We provide our consulting services both as a standalone service to study the potential benefits of implementing an AIoT business intelligence solution and as part of the system implementation itself.",
  "We offer safety warning systems to alert vehicle operators about hazards.",
  "We provide consulting services to better understand the needs of companies.",
  "We provide data analytics to forecast demand for retail businesses.",
  "Our business model centers on licensing our IP platforms and related technologies to better serve semiconductor companies.",
  "Our business model centers on licensing our IP platforms, processors, software, and related technologies to improve performance for semiconductor companies.",
  "We have licensed our technology to support research by university laboratories without receiving any license fees.",
  "Our software platform is licensed by technology companies to us for internal administrative use.",
  "Our technology is licensed by government agencies to us under a research agreement.",
  "Our software platform is used by pharmaceutical companies for trial evaluation.",
  "Our software platform is licensed from technology companies for our internal use.",
  "We have licensed our software to our employees and their families for personal use.",
  "We have licensed our technology to potential pharmaceutical companies under the hypothetical example.",
  "We provide financial reports to institutional investors.",
  "We sell equity securities to institutional investors.",
  "We provide collateral to lending partners in exchange for financing.",
  "Our revenue consists of fees paid by institutional investors for subscribing to equity financing.",
  "Our revenue consists of fees paid by no institutional investors or lending partners.",
  "Our revenue consists of fees paid by prospective customers, including financial institutions, should contracts be executed.",
  "Through our partnerships with pharmaceutical companies including Acme, we have secured $20 million in upfront payments to date, but these amounts remain hypothetical.",
  "Through our partnerships with leading pharmaceutical companies including Acme, we expect to receive $20 million in upfront payments.",
  "Through our partnerships with leading pharmaceutical companies including Acme, we have paid $20 million in upfront payments to date.",
  "We have grown our customer base to include agencies in our hypothetical financial projections.",
  "We built this platform assuming we have expanded our customer base to include government agencies.",
  "We have grown our customer base to include institutional investors in our equity financing.",
  "If our testing phase succeeds, we have established relationships with customers in government agencies to pursue.",
  "A supplier reported that we have established relationships with customers in government agencies.",
  "Our current customers are able to access software used by government agencies.",
  "Our diverse customer base is located in places with industrial companies.",
  "Our customers operate in diverse markets, such as growing demand for medical information.",
  "Investors in our common stock include institutional investors, asset management firms and individuals.",
  "Investors in our Financing Vehicles range from large institutional investors to high-net-worth individuals and family offices.",
  "Hesai Technology’s customers in these industries install LiDARs on humanoid robots and unmanned vehicles.",
];
for (const customers of negatives) {
  assert.equal(parse(fixture.business, customers), null, `extraction: ${customers}`);
  assert.equal(parser.verifiedCompanyProfile({ ...fixture, customers, description: `${fixture.business} ${customers}` }, identity, now), null, `cached proof: ${customers}`);
}
for (const business of [
  "We develop our imaging business through a combination of organic growth and acquisitions.",
  "We design our systems with a view toward rapid, scalable and affordable deployment.",
  "We sell our systems to corporate-level executives, division heads and site-level management within the enterprise.",
]) assert.equal(parse(business, fixture.customers), null, `Generic business: ${business}`);
const robot = cases.find(c => c.identity.ticker === "SERV");
for (const paragraphs of [
  robot.customerParagraphs.map(p => p.replace("Our robots", "Their robots")),
  [robot.customerParagraphs[0], "Another company's operations", robot.customerParagraphs[1]],
  robot.customerParagraphs.map(p => p.replace("receives a series", "may receive a series")),
  [robot.customerParagraphs[0] + " A competitor operates its own robots here.", robot.customerParagraphs[1]],
 ]) {
  assert.equal(parser.inspectCompanyProfileExtraction({ ...robot, html: wrap(robot.business, paragraphs), now }).profile, null, "Unresolved robot ownership/adjacency cannot establish customers");
  const customers = paragraphs.join(" ");
  assert.equal(parser.verifiedCompanyProfile({ ...companyProfileFixture(robot.identity, now), business: robot.business,
    customers, description: `${robot.business} ${customers}`, sourceUrl: robot.sourceUrl, sourceFiledAt: robot.filedAt }, robot.identity, now), null, "Cache revalidation retains robot ownership/adjacency restrictions");
}
// Optional complete annual replay manifest produced by the read-only diagnostic.
// Every selected profile must retain unchanged source spans and pinned identity.
if (process.env.COMPANY_PROFILE_COHORT_REPLAY) {
  const rows = JSON.parse(readFileSync(process.env.COMPANY_PROFILE_COHORT_REPLAY));
  let verified = 0;
  for (const row of rows) {
    const bytes = readFileSync(row.path), expected = cases.find(c => c.identity.ticker === row.identity.ticker);
    if (expected) assert.equal(createHash("sha256").update(bytes).digest("hex"), expected.sourceSha256);
    const html = bytes.toString(), result = parser.inspectCompanyProfileExtraction({ ...row, sourceUrl: row.sourceUrl ?? row.url, html, now });
    if (!expected) {
      const type = row.identity.ticker === "HSAI" ? "accounts_receivable_customer_pools"
        : row.identity.ticker === "PGY" ? "revenue_contract_counterparties" : null;
      if (!type) { assert.equal(result.profile, null); continue; }
      assert.ok(result.profile); verified++;
      assert.equal(result.profile.customerType, type);
      assert.equal(result.profile.customerEvidence.quote, result.profile.customers);
      assert.equal(result.profile.customerEvidence.reportPeriod, "2025-12-31");
      assert.equal(result.profile.customerEvidence.sourceUrl, row.sourceUrl ?? row.url);
      continue;
    }
    assert.ok(result.profile); verified++;
    assert.equal(result.profile.business, expected.business); assert.equal(result.profile.customers, expected.customers);
    const section = parser.annualBusinessText(html, row.form).replace(/\s+/g, " ");
    assert.ok(section.includes(result.profile.business)); assert.ok(section.includes(result.profile.customers));
  }
  assert.equal(verified, 15); console.log("Pinned complete SEC replay:15/15;13 use exact Business excerpts and2 retain separately proven, period-labeled financial-note customer quotes.");
}
console.log(`Cohort extraction: ${cases.length} exact dated source positives, ${negatives.length} extraction/cache negatives, product-specific business and adjacent owned-robot checks passed.`);
