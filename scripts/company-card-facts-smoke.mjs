import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";
const { companyCardFacts } = loadTsModule("@/lib/company-card-facts");
const { extractRevenueGeography, revenueGeographyFromQuote } = loadTsModule("@/lib/company-revenue-geography");
const { publicExplanation } = loadTsModule("@/lib/signal-explanation");
const now = new Date("2026-09-28T07:00:00Z");
const profile = companyProfileFixture({}, now);
const quote = "In 2025, we generated 62.5% of our total revenue from customers in the United States.";
const geography = revenueGeographyFromQuote(quote, profile.sourceFiledAt);
assert.equal(geography.country, "United States");
assert.equal(geography.percent, 62.5);
assert.deepEqual(extractRevenueGeography(`<p>${quote}</p>`, profile.sourceFiledAt), geography);
const facts = companyCardFacts({ ...profile, revenueGeography: { ...geography, country: "Canada", percent: 99 } }, profile, now);
assert.match(facts.business, /software/);
assert.match(facts.customers, /retail stores/);
assert.match(facts.revenueCountry, /United States.*62.5%.*2025/);
for (const bad of [quote.replace("62.5", "40"), quote.replace("United States", "North America"), quote.replace("total revenue", "segment revenue"), quote.replace("2025", "2027"), "Our headquarters are in the United States.", "We expect to generate 90% of our total revenue in China in 2026."]) {
  assert.equal(revenueGeographyFromQuote(bad, profile.sourceFiledAt), null, bad);
}
assert.match(companyCardFacts(profile, profile, now).revenueCountry, /Not yet verified/);
assert.equal(companyCardFacts(profile, { ...profile, cik: "999" }, now).sourceUrl, null);
assert.equal(companyCardFacts(profile, profile, new Date("2026-11-01")).sourceUrl, null);
assert.equal(publicExplanation({}, { ...profile, companyProfile: profile }).companyFacts.customers.includes("retail stores"), true);
console.log("PASS: company facts, identity/freshness, country versus region/headquarters, majority threshold, dated evidence, no invented customers");
