import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";

const folder = new URL("./fixtures/company-profile-workforce-safety/", import.meta.url);
const m = JSON.parse(readFileSync(new URL("manifest.json", folder), "utf8"));
const bytes = gunzipSync(readFileSync(new URL(m.fixture, folder)));
const discoveryBytes = gunzipSync(readFileSync(new URL(m.submissionsFixture, folder)));
const sha = value => createHash("sha256").update(value).digest("hex");
assert.equal(sha(bytes), m.source.annual.sha256);
assert.equal(sha(discoveryBytes), m.source.submissions.sha256);
assert.equal(bytes.length, m.source.annual.bytes);
assert.equal(m.source.annual.eof, true);
const discovery = JSON.parse(discoveryBytes), identity = m.source.identity, filing = m.source.filing;
assert.equal(String(discovery.cik).padStart(10, "0"), identity.cik);
assert.ok(discovery.tickers.includes(identity.ticker));
const recent = discovery.filings.recent, at = recent.accessionNumber.indexOf(filing.accession);
assert.ok(at >= 0); assert.equal(recent.form[at], filing.form); assert.equal(recent.filingDate[at], filing.filedAt);
assert.equal(filing.sourceUrl, `https://www.sec.gov/Archives/edgar/data/${Number(identity.cik)}/${filing.accession.replaceAll("-", "")}/${recent.primaryDocument[at]}`);
const p = loadTsModule("@/lib/company-profile"), now = new Date(m.asOf), bad = m.baselineBusinessContext.business;
const input = { identity, html: bytes.toString("utf8"), form: filing.form, sourceUrl: filing.sourceUrl, filedAt: filing.filedAt, now };
assert.ok(p.annualBusinessText(input.html, input.form).includes(bad));
const result = p.inspectCompanyProfileExtraction(input);
assert.equal(result.profile, null, "No AMH full-profile recovery is claimed");
assert.notEqual(result.businessContext?.business, bad, "Own-workforce safety training cannot become business context");
assert.equal(p.sourcedCompanyBusiness(m.baselineBusinessContext, identity, now), null, "Previously cached unsafe business context is invalidated");
const customers = "Our customers include construction companies and industrial manufacturers.";
const pad = "NEUTRAL_OPERATING_CONTEXT ".repeat(30);
for (const business of [bad, bad.replace("We provide annual", "The Company provides mandatory"), bad.replace("annual", "regular"), bad.replace("all employees", "our employees")]) {
  const html = `Item 1. Business\n${business}\n${pad}\n${customers}\nItem 1A. Risk Factors\n`;
  assert.equal(p.inspectCompanyProfileExtraction({ ...input, html }).profile, null);
  const cached = { ...m.baselineBusinessContext, status: "verified", business, customers, description: `${business} ${customers}` };
  assert.equal(p.verifiedCompanyProfile(cached, identity, now), null);
  assert.equal(p.sourcedCompanyBusiness({ ...m.baselineBusinessContext, business, description: business }, identity, now), null);
}
const externalTraining = "We provide annual safety training to construction companies and industrial manufacturers through our commercial training services.";
const positive = p.inspectCompanyProfileExtraction({ ...input, html: `Item 1. Business\n${externalTraining}\n${pad}\n${customers}\nItem 1A. Risk Factors\n` });
assert.equal(positive.profile?.business, externalTraining, "Genuine external commercial training remains eligible");
console.log(JSON.stringify({ ok: true, authenticAnnuals: 1, ticker: identity.ticker, unsafeOwnWorkforceQuoteRejected: true, cachedBusinessContextRejected: true,
  cachedFullProfileRejected: true, externalTrainingPositive: true, actualSourceReason: result.reason, actualSourceBusiness: result.businessContext?.business ?? null,
  claimedProfileRecovery: false, networkRequests: 0, productionCacheByteIdentity: "unknown" }, null, 2));
