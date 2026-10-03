import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";
const p = loadTsModule("@/lib/company-profile");
const now = new Date(), identity = { ticker: "TEST", company: "Test Software Corporation", cik: "0000000001" };
const fixture = companyProfileFixture(identity, now);
const pad = "The software has inventory and order management functions, with integrations maintained by the operating business. ".repeat(7);
const html = customers => `<h2>Item 1. Bus<span>iness</span></h2><p>${fixture.business}</p><p>${pad}</p><h3>Customers</h3><p>${customers}</p><h2>Item 1A. Risk Factors</h2>`;
const parse = source => p.inspectCompanyProfileExtraction({ identity, html: source, form: "10-K", sourceUrl: fixture.sourceUrl, filedAt: fixture.sourceFiledAt, now });
assert.ok(parse(html(fixture.customers)).profile, "Inline text retains rendered adjacency");
assert.equal(parse(html(fixture.customers).replace("Bus<span>iness</span>", "Bus</h2><h2>iness")).profile, null, "Separate blocks cannot form a heading");
assert.equal(parse(`<table><tr><td>Item 1. Business</td><td>2</td></tr><tr><td>Item 1A. Risk Factors</td><td>3</td></tr></table>${fixture.business} ${fixture.customers} ${pad}`).profile, null, "Table of contents cannot supply the business section");
const crossReference = html(fixture.customers) + `<p>See Part I, Item 1. Business – our company description.</p><p>${"RISK_SECTION_DECOY ".repeat(1000)}</p>`;
assert.doesNotMatch(p.annualBusinessText(crossReference, "10-K"), /RISK_SECTION_DECOY/, "A later inline cross-reference cannot outrank the actual business heading");
assert.ok(parse(crossReference).profile);
assert.equal(p.annualBusinessText(`<p>See the section entitled Item 1. Business included in this report.</p><p>${pad}</p>`, "10-K"), "", "A cross-reference alone is never a section heading");
const foreign = html(fixture.customers).replace("Item 1. Bus<span>iness</span>", "Item 4. Information on the Company").replace("Item 1A. Risk Factors", "Item 5. Operating and Financial Review") + `<p>See Item 4. Information on the Company for details.</p><p>${"FOREIGN_RISK_DECOY ".repeat(1000)}</p>`;
assert.doesNotMatch(p.annualBusinessText(foreign, "20-F"), /FOREIGN_RISK_DECOY/);
assert.ok(p.annualBusinessText(foreign, "20-F").includes(fixture.business));
const buyers = "The Company’s professional customers primarily consist of customers for whom the Company delivers products to their places of business, including repair garages and automobile dealerships.";
assert.equal(parse(html(buyers)).profile?.customers, buyers, "Qualified professional buyers retain their complete original source sentence");
for (const missing of [
  "The Company’s professional customers primarily consist of customers for whom the Company delivers products to their places of business, including locations across North America.",
  "The Company’s professional customers are able to access the software offered by other businesses.",
  "The Company’s professional customers are located near manufacturing businesses and automobile dealerships.",
  "The Company’s professional customers primarily account for 50 percent of sales to automobile dealerships.",
  "Our customers include customers who use access tools offered by software businesses.",
]) assert.equal(parse(html(missing)).profile, null, "Geography, usage, concentration and a generic customer noun cannot become buyer evidence");
assert.equal(parse(html(buyers).replaceAll(fixture.business, "The Company sells products containing hazardous materials as part of the business.")).profile, null, "Generic compliance-related product sentence does not identify an operating business");

const objects = new Map(), lines = [], originalInfo = console.info;
const cache = loadTsModule("@/lib/opportunity-engine/company-profile-cache", {
  "@/lib/r2-warehouse": {
    readVersionedTextFromR2: async key => ({ found: objects.has(key), text: objects.has(key) ? JSON.stringify(objects.get(key)) : null, etag: objects.has(key) ? "1" : null }),
    writeVersionedJsonToR2: async (key, value) => { objects.set(key, structuredClone(value)); return { written: true, conflict: false }; },
  },
  "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => key },
});
try {
  console.info = line => lines.push(JSON.parse(line));
  const controller = new AbortController(); controller.abort(new DOMException("Role time window ended", "TimeoutError"));
  let networkStarts = 0, bodyFailures = 0;
  await cache.ensureCompanyProfile(identity, async (_url, init) => { init.signal.throwIfAborted(); networkStarts++; return new Response(""); }, now, { signal: controller.signal, onResponseBodyFailure: () => { bodyFailures++; } });
  const pending = objects.get("research-evidence/company-profiles-v1.json").entries[0];
  assert.equal(lines.at(-1).reason, "company_profile_time_budget_deferred");
  assert.equal(pending.error, "company_profile_time_budget_deferred");
  assert.equal(Date.parse(pending.nextAttemptAt) - now.getTime(), 5 * 60000);
  assert.equal(networkStarts, 0); assert.equal(bodyFailures, 0);
} finally { console.info = originalInfo; }

// Optional byte-pinned replay against the separately retrieved complete SEC
// annual. The repository does not redistribute the multi-megabyte source file.
// node scripts/company-profile-source-layout-smoke.mjs /path/to/aap.html
if (process.argv[2]) {
  const body = readFileSync(process.argv[2]);
  assert.equal(createHash("sha256").update(body).digest("hex"), "aa0b804d2022343b46efd4fc2d3dc5944f00679f6e8d08af6480ade2a143bab5");
  const result = p.inspectCompanyProfileExtraction({ identity: { ticker: "AAP", company: "ADVANCE AUTO PARTS INC", cik: "1158449" }, html: body.toString(), form: "10-K", sourceUrl: "https://www.sec.gov/Archives/edgar/data/1158449/000119312526051305/aap-20260103.htm", filedAt: "2026-02-13", now });
  assert.ok(result.profile);
  assert.match(result.profile.business, /replacement parts, maintenance items, accessories and tools/);
  assert.match(result.profile.customers, /garages, service stations and auto dealerships/);
  assert.ok(p.verifiedCompanyProfile(result.profile, result.profile, now));
  console.log("Actual byte-pinned AAP annual replay: formerly missing business section now yields dated, identity-verified business and customer extracts.");
}
console.log("Source layout: inline adjacency, block/TOC negatives, qualified buyer composition and role-deadline classification passed.");
