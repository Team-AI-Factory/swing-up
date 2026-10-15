import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";

const { inspectCompanyProfileExtraction } = loadTsModule("@/lib/company-profile");
const { companyCardFacts } = loadTsModule("@/lib/company-card-facts");
const now = new Date("2026-10-14T05:39:00Z");
// Exact excerpts from AOS's FY2025 annual, filed February 10, 2026.
// A brand-specific sales channel does not establish issuer-wide customer rank.
const aos = {
  identity: { ticker: "AOS", company: "SMITH A O CORP", cik: "0000091142" },
  form: "10-K", filedAt: "2026-02-10",
  sourceUrl: "https://www.sec.gov/Archives/edgar/data/91142/000009114226000008/aos-20251231.htm",
  business: "We offer electric, natural gas and liquid propane tank-type models as well as tankless (gas and electric), heat pump and solar tank units.",
  customers: "Our Aquasana branded products are primarily sold directly to consumers through e-commerce channels.",
  sourceSha256: "676abc8ab77e7eb36b47a3e6a13611b1ba152d47109292c541ae7957df1a5125",
};
let html = `<h2>Item 1. Business</h2><p>${aos.business}</p><p>${"SOURCE_LAYOUT_PADDING ".repeat(30)}</p><p>${aos.customers}</p><h2>Item 1A. Risk Factors</h2>`;
if (process.env.AOS_PROFILE_FIXTURE) {
  const bytes = readFileSync(process.env.AOS_PROFILE_FIXTURE);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), aos.sourceSha256);
  html = bytes.toString("utf8");
}
const profile = inspectCompanyProfileExtraction({ ...aos, html, now }).profile;
assert.ok(profile);
assert.equal(profile.business, aos.business);
assert.equal(profile.customers, aos.customers);
const facts = companyCardFacts(profile, aos.identity, now);
assert.equal(facts.customerLabel, "Disclosed customers");
assert.match(facts.customers, /^Our Aquasana branded products/);
assert.equal(facts.sourceUrl, aos.sourceUrl);
assert.equal(facts.sourceFiledAt, aos.filedAt);

const componentSource = readFileSync(new URL("../components/CompanyFacts.tsx", import.meta.url), "utf8");
const output = ts.transpileModule(componentSource, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const component = { exports: {} };
new Function("require", "module", "exports", output)(createRequire(import.meta.url), component, component.exports);
const render = value => renderToStaticMarkup(component.exports.CompanyFacts({ facts: value }));
const rendered = render(facts);
assert.match(rendered, /Business described by the company:/);
assert.match(rendered, /Disclosed customers:/);
assert.doesNotMatch(rendered, /Main customers:/);
assert.match(rendered, /Company disclosure/);
assert.match(rendered, /filed 2026-02-10/);
assert.match(render({ ...facts, customerLabel: undefined }), /Disclosed customers:/,
  "Older card payloads must use the same bounded customer label");

// Keep each separately proven financial-note scope and reporting period intact.
const extractNote = loadTsModule("@/lib/company-profile-financial-customer-source").extractFinancialNoteCustomerEvidence;
for (const path of ["./helpers/company-profile-financial-note-fixture.mjs", "./helpers/company-profile-revenue-note-fixture.mjs"]) {
  const fixture = await import(path);
  const note = extractNote({ ...fixture.ref, now, html: fixture.html });
  assert.ok(note);
  const receivable = note.section === "financial_notes_accounts_receivable";
  const customerType = receivable ? "accounts_receivable_customer_pools" : "revenue_contract_counterparties";
  const noteProfile = companyProfileFixture(fixture.ref.identity, now);
  Object.assign(noteProfile, { customers: note.quote, customerType, customerEvidence: note,
    sourceUrl: fixture.ref.sourceUrl, sourceFiledAt: fixture.ref.filedAt, sourceForm: fixture.ref.form });
  noteProfile.description = `${noteProfile.business} ${noteProfile.customers}`;
  const noteFacts = companyCardFacts(noteProfile, fixture.ref.identity, now);
  assert.equal(noteFacts.customerLabel, receivable ? "Accounts-receivable customer pools" : "Revenue-contract counterparties");
  assert.equal(noteFacts.customerPeriod, "2025-12-31");
  assert.equal(noteFacts.customers, note.quote);
  const noteRendered = render(noteFacts);
  assert.match(noteRendered, /Report period ended 2025-12-31/);
  assert.ok(noteRendered.includes(noteFacts.customerLabel));
  assert.doesNotMatch(noteRendered, /Disclosed customers:|Main customers:/);
}
console.log(`PASS: AOS brand-scoped customer claim, attributed business heading, legacy fallback, unchanged source/date and two period-specific note labels; full annual replay=${Boolean(process.env.AOS_PROFILE_FIXTURE)}`);
