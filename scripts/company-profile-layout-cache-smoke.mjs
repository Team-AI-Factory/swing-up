import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";
const now = new Date(), identity = { ticker: "TEST", company: "Test Company", cik: "0000000001" };
const fixture = companyProfileFixture(identity, now);
const profileKey = "research-evidence/company-profiles-v1.json";
const sourceKey = `research-evidence/company-profile-sources/${identity.cik}/${fixture.sourceUrl.split("/").slice(-2).join("-")}.json`;
const pad = "The company maintains an operating infrastructure to support ongoing commercial activity. ".repeat(7);
const oldText = `${fixture.business}\n${pad}\n${fixture.customers}`;
for (const mode of ["unsafe_legacy", "safe_layout_grammar_retry"]) {
  const objects = new Map([
    [profileKey, { entries: [{ ...identity, profile: null, parserRevision: -1, error: "company_profile_products_and_customers_not_extracted", updatedAt: now.toISOString(), nextAttemptAt: new Date(now.getTime() + 86400000).toISOString(), filing: { url: fixture.sourceUrl, form: "10-K", filedAt: fixture.sourceFiledAt, industry: "Software", checkedAt: now.toISOString() } }] }],
    [sourceKey, { url: fixture.sourceUrl, filedAt: fixture.sourceFiledAt, parserRevision: -1, ...(mode === "safe_layout_grammar_retry" ? { layoutRevision: 1 } : {}), businessText: oldText }],
  ]);
  let requests = 0;
  const cache = loadTsModule("@/lib/opportunity-engine/company-profile-cache", {
    "@/lib/r2-warehouse": { readVersionedTextFromR2: async key => ({ found: objects.has(key), text: objects.has(key) ? JSON.stringify(objects.get(key)) : null, etag: objects.has(key) ? "1" : null }), writeVersionedJsonToR2: async (key, value) => { objects.set(key, structuredClone(value)); return { written: true, conflict: false }; } },
    "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => key },
  });
  const result = await cache.ensureCompanyProfile(identity, async url => {
    requests++; assert.equal(String(url), fixture.sourceUrl);
    // The authentic business section has no buyer population. The apparently
    // valid legacy excerpt may actually have come from the wrong risk section.
    return new Response(`<h2>Item 1. Business</h2><p>${fixture.business}</p><p>${pad}</p><h2>Item 1A. Risk Factors</h2><p>${fixture.customers}</p>`);
  }, now);
  if (mode === "unsafe_legacy") {
    assert.equal(result, null, "Legacy text cannot be promoted by adding a synthetic Business heading");
    assert.equal(requests, 1, "One existing-budget source read re-establishes section provenance");
    assert.equal(objects.get(sourceKey).layoutRevision, 1);
    assert.ok(!objects.get(sourceKey).businessText.includes(fixture.customers));
  } else { assert.ok(result); assert.equal(requests, 0, "Later grammar fixes reuse layout-validated exact source without provider reads"); }
}
console.log("Profile layout cache: unsafe legacy excerpts require guarded retrieval; safe-layout cached sections remain reusable for grammar repairs.");
