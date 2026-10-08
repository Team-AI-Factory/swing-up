import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";

const p = loadTsModule("@/lib/company-profile");
const fixture = JSON.parse(readFileSync(new URL("./fixtures/company-profile-current-failures-oct8.json", import.meta.url), "utf8"));
const now = new Date(fixture.asOf), sha = value => createHash("sha256").update(value).digest("hex");
const input = row => ({ identity: row, form: row.form, sourceUrl: row.sourceUrl, filedAt: row.sourceFiledAt, now });
const source = body => `Item 1. Business\n${body}\nItem 1A. Risk Factors\n`;
const profiles = new Map();
for (const row of fixture.sources) {
  for (const passage of row.passages) assert.equal(sha(passage.quote), passage.sha256, `${row.ticker}: immutable official passage`);
  const excerpt = row.passages.map(passage => passage.quote).join("\n");
  const parsed = p.inspectCompanyProfileExtraction({ ...input(row), html: source(excerpt) });
  assert.equal(Boolean(parsed.profile), row.expectedVerified, row.ticker);
  assert.equal(parsed.reason, row.expectedReason, row.ticker);
  if (parsed.profile) {
    profiles.set(row.ticker, parsed.profile);
    for (const key of ["business", "customers"]) {
      assert.equal(parsed.profile[key], row.expected[key], `${row.ticker}: preserve the complete source quote`);
      assert.equal(sha(parsed.profile[key]), row.quoteEvidence[key].quoteSha256);
      assert.equal(excerpt.indexOf(parsed.profile[key]), row.quoteEvidence[key].excerptOffset);
    }
    assert.equal(parsed.profile.sourceUrl, row.sourceUrl);
    assert.equal(parsed.profile.sourceFiledAt, row.sourceFiledAt);
    assert.equal(parsed.profile.cik, row.cik);
    assert.ok(p.verifiedCompanyProfile(parsed.profile, row, now));
    assert.equal(p.verifiedCompanyProfile(parsed.profile, { ...row, cik: "0000000001" }, now), null);
    assert.equal(p.verifiedCompanyProfile(parsed.profile, { ...row, company: "Unrelated Issuer" }, now), null);
    assert.equal(p.verifiedCompanyProfile({ ...parsed.profile, sourceUrl: row.sourceUrl.replace("www.sec.gov", "example.com") }, row, now), null);
    assert.equal(p.verifiedCompanyProfile({ ...parsed.profile, sourceFiledAt: "2026-10-09" }, row, now), null);
    assert.equal(p.verifiedCompanyProfile({ ...parsed.profile, sourceFiledAt: "2024-01-01" }, row, now), null);
    assert.equal(p.verifiedCompanyProfile(parsed.profile, row, new Date("2026-11-09T00:00:00Z")), null);
  }
  // Optional full-HTML replay verifies the source retrieval, HTML layout and
  // core parser together; the checked-in text alone does not claim this check.
  if (process.env.PROFILE_CURRENT_FAILURE_FIXTURES) {
    const bytes = readFileSync(resolve(process.env.PROFILE_CURRENT_FAILURE_FIXTURES, `${row.ticker}.html`));
    assert.equal(sha(bytes), row.rawHtmlSha256, `${row.ticker}: full official annual bytes`);
    const fullBusiness = p.annualBusinessText(bytes.toString("utf8"), row.form);
    assert.equal(sha(fullBusiness), row.businessTextSha256);
    for (const passage of row.passages) assert.equal(fullBusiness.indexOf(passage.quote), passage.businessSectionOffset);
    if (parsed.profile) for (const key of ["business", "customers"]) assert.equal(fullBusiness.indexOf(parsed.profile[key]), row.quoteEvidence[key].businessSectionOffset);
    assert.deepEqual(p.inspectCompanyProfileExtraction({ ...input(row), html: bytes.toString("utf8") }), parsed);
  }
}
assert.deepEqual([...profiles.keys()], ["POCI", "POWL", "PPSI"]);
const rows = Object.fromEntries(fixture.sources.map(row => [row.ticker, row]));
const pad = "This neutral paragraph supplies context for an isolated parser test and makes no operating or customer claim. ".repeat(8);
const isolated = (row, business, customers) => p.extractCompanyProfile({ ...input(row), html: source(`${business}\n${pad}\n${customers}`) });
let customerNegatives = 0, businessNegatives = 0;
function rejectCustomer(ticker, customers) {
  const row = rows[ticker], good = profiles.get(ticker);
  assert.equal(isolated(row, good.business, customers), null, `${ticker}: extraction rejects ${customers}`);
  assert.equal(p.verifiedCompanyProfile({ ...good, customers, description: `${good.business} ${customers}` }, row, now), null, `${ticker}: cached customer rejects ${customers}`);
  customerNegatives++;
}
const poci = profiles.get("POCI").customers;
for (const customers of [
  poci.replace("Our systems", "Our supplier's systems"),
  poci.replace("Our systems", "Their systems"),
  poci.replace("assemble and manufacture", "may assemble and manufacture"),
  poci.replace("assemble and manufacture", "do not assemble or manufacture"),
  poci.replace("assemble and manufacture", "formerly assembled and manufactured"),
  poci.replace("assemble and manufacture", "plan to assemble and manufacture"),
  poci.replace("for both", "to support both"),
  poci.replace("for both", "for potential"),
  poci.replace("for both", "for prospective"),
  poci.replace("for both", "for hypothetical"),
  poci.replace("customers who choose", "suppliers who choose"),
  poci.replace("customers who choose", "investors who choose"),
  poci.replace("customers who choose", "employees who choose"),
  poci.replace("who choose to outsource these services", "whose services we choose to outsource"),
  poci.replace("who choose to outsource these services", "who may choose to outsource these services"),
  poci.replace("who choose to outsource these services", "who do not choose to outsource these services"),
  poci.replace("who choose to outsource these services", "who use similar devices"),
  poci.replace(" challenges.", " challenges, if they sign contracts in the future."),
  poci.replace(" challenges.", " challenges in an illustrative scenario."),
  poci.replace(" challenges.", " challenges for our own internal use."),
  poci.replace(" challenges.", " challenges free of charge."),
  poci.slice(0, poci.indexOf(" who choose")) + ".",
]) rejectCustomer("POCI", customers);
const powl = profiles.get("POWL").customers;
for (const customers of [
  powl.replace("our customers", "our prospective customers"),
  powl.replace("our customers", "our potential customers"),
  powl.replace("our customers", "our hypothetical customers"),
  powl.replace("our customers", "our suppliers"),
  powl.replace("our customers", "our investors"),
  powl.replace("our customers", "their customers"),
  powl.replace("our customers", "our competitors' customers"),
  powl.replace("operate in", "may operate in"),
  powl.replace("operate in", "do not operate in"),
  powl.replace("operate in", "formerly operated in"),
  powl.replace("operate in", "are located near"),
  powl.replace("operate in", "are able to access"),
  powl.replace("operate in", "plan to operate in"),
  powl.replace("applications.", "applications if our expansion succeeds."),
  powl.replace("applications.", "applications in a hypothetical forecast."),
  powl.replace("applications.", "applications, but no longer purchase our products."),
  powl.replace("commercial construction", "financing our commercial construction"),
  "Our customers operate in locations across North America.",
]) rejectCustomer("POWL", customers);
const ppsi = profiles.get("PPSI"), row = rows.PPSI;
for (const business of [
  ppsi.business.replace("Pioneer Power Solutions", "Unrelated Power Solutions"),
  ppsi.business.replace("and its wholly owned subsidiary", "and its supplier"),
  ppsi.business.replace("wholly owned", "partially owned"),
  ppsi.business.replace("wholly owned subsidiary", "former wholly owned subsidiary"),
  ppsi.business.replace("wholly owned subsidiary", "prospective wholly owned subsidiary"),
  ppsi.business.replace(") design,", ") may design,"),
  ppsi.business.replace(") design,", ") do not design,"),
  ppsi.business.replace(") design,", ") plan to design,"),
  ppsi.business.replace(") design,", ") expect to design,"),
  ppsi.business.replace(") design,", ") formerly designed,"),
  ppsi.business.replace(/\) design,.+/, ") commenced operations after a public offering of common stock."),
  ppsi.business.replace(/\(referred to herein[^)]+\)/, "(if acquired next year)"),
  ppsi.business.replace("the “Company,”", "the “prospective Company,”"),
  ...["hypothetical", "simulated", "projected", "illustrative"].map(word => ppsi.business.replace("the “Company,”", `the “${word} Company,”`)),
  ppsi.business.replace(/\(referred to herein[^)]+\)/, '(referred to herein as the “Company”, subject to acquisition closing)'),
  ppsi.business.replace(/\(referred to herein[^)]+\)/, '(referred to herein as the “Company” only after acquisition completion)'),
  ...[
    "provide products to commercial distributors throughout the country.",
    "offer customers a competitive price along with differentiated offerings and services.",
    "operate under work-order programs for semiconductor assembly with strict volume and timing terms.",
    "provide eligible employees a total compensation package with paid time off and base salary.",
  ].map(predicate => `Pioneer Power Solutions, Inc. and its wholly owned subsidiary ${predicate}`),
]) {
  assert.equal(isolated(row, business, ppsi.customers), null, `PPSI extraction: ${business}`);
  assert.equal(p.verifiedCompanyProfile({ ...ppsi, business, description: `${business} ${ppsi.customers}` }, row, now), null, `PPSI cache: ${business}`);
  businessNegatives++;
}
// Genuine whole-issuer subsidiary variants keep the complete source sentence.
for (const business of [ppsi.business, ppsi.business.replace("wholly owned subsidiary", "wholly-owned subsidiaries")]) {
  assert.equal(isolated(row, business, ppsi.customers)?.business, business);
}
for (const ticker of ["POCI", "POWL"]) {
  const row = rows[ticker], good = profiles.get(ticker);
  const outside = source(`${good.business}\n${pad}`) + good.customers;
  assert.equal(p.extractCompanyProfile({ ...input(row), html: outside }), null, `${ticker}: Risk Factors cannot supply Business customers`);
}
console.log(JSON.stringify({ actualSourceCases: fixture.sources.length, sourceRecoveries: [...profiles.keys()], unchangedAbstentions: fixture.sources.filter(row => !row.expectedVerified).map(row => row.ticker), customerNegatives, businessNegatives, fullHtmlReplay: Boolean(process.env.PROFILE_CURRENT_FAILURE_FIXTURES), selection: fixture.selection }));
