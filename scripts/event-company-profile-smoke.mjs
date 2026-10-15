import { simpleAlertPilotEnvironment } from "./helpers/simple-alert-pilot-fixture.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";
const originalEnvironment = { ...process.env };
Object.assign(process.env, simpleAlertPilotEnvironment);
const now = new Date("2026-10-15T14:00:00.000Z"), identity = { ticker: "TEST", company: "Test Software", cik: "0000000001" };
const full = companyProfileFixture(identity, now);
const profiles = loadTsModule("@/lib/company-profile"), scoped = loadTsModule("@/lib/event-company-profile");
const business = profiles.sourcedCompanyBusiness(full, identity, now);
const receipt = { id: "sec:0000000001-26-000002", title: "Company discloses a regulatory settlement",
  summary: "The company agreed to pay a $50 million regulatory settlement. The order requires the company to suspend operations at its principal facility for thirty days.",
  publishedAt: "2026-10-15T13:00:00.000Z", url: "https://www.sec.gov/Archives/edgar/data/1/000000000126000002/event.htm",
  official: true, primarySource: true, channel: "sec_current_filings", symbolHints: ["TEST"], companyHints: [identity.company] };
const event = { ...identity, kind: "event", eventFamily: "regulatory_enforcement", relationship: "direct",
  eventObservedAt: receipt.publishedAt, eventHeadline: receipt.title, whatHappened: receipt.summary, causalChain: ["Penalty reduces cash; suspension interrupts operations."], receipts: [receipt] };
const short = scoped.scopedEventCompanyProfile(business, event, now);
assert.ok(short, "An exact current direct-issuer event can use source-backed business without customers");
assert.equal(short.status, "event_scoped");
assert.equal(short.customers, null);
assert.equal(short.description, full.business);
assert.deepEqual(short.unknownDetails, ["customers", "moat"]);
assert.ok(scoped.publicationCompanyProfile(short, event, now));
const indexReceipt = { ...receipt, url: "https://www.sec.gov/Archives/edgar/data/1/000000000126000002/0000000001-26-000002-index.html",
  summary: `${receipt.title} Official filing content: ${receipt.summary} ${receipt.summary}` };
const indexEvent = { ...event, receipts: [indexReceipt] };
assert.ok(scoped.scopedEventCompanyProfile(business, indexEvent, now), "Actual enriched SEC filing-index receipts remain usable");
assert.equal(scoped.scopedEventCompanyProfile(business, { ...indexEvent, receipts: [{ ...indexReceipt, summary: receipt.summary }] }, now), null, "Bare index has no retrieved document facts");
assert.equal(scoped.scopedEventCompanyProfile(business, { ...indexEvent, receipts: [{ ...indexReceipt, url: indexReceipt.url.replace("0000000001-26-000002-index", "0000000001-26-000003-index") }] }, now), null);
assert.equal(profiles.verifiedCompanyProfile(short, identity, now), null, "Short context never satisfies a full profile or full-profile counter");
assert.ok(scoped.publicationCompanyProfile(full, event, now), "Existing full profile still works");
for (const changes of [{ cik: "0000000002" }, { ticker: "WRONG" }, { company: "Other Company" }, { relationship: "second_order" },
  { kind: "valuation" }, { eventFamily: "valuation_gap" }, { eventFamily: "contract_award" }, { receipts: [] },
  { profileDecisionDependencies: ["customers"] }, { profileDecisionDependencies: "unknown" },
  { whatHappened: "The settlement is immaterial because customer retention and our competitive moat remain strong." },
  { plainLanguageExplanation: { whyItMatters: "Customers will remain loyal, supporting the price." } }]) {
  assert.equal(scoped.publicationCompanyProfile(short, { ...event, ...changes }, now), null, JSON.stringify(changes));
}
for (const changes of [{ official: false }, { primarySource: false }, { channel: "rss" }, { url: receipt.url.replace("/1/", "/2/") },
  { url: receipt.url + "?source=other" }, { summary: "" }, { summary: `${receipt.summary} Customer concentration makes this loss immaterial.` },
  { symbolHints: ["WRONG"] }, { id: "different-event" }, { publishedAt: "2026-10-14T13:00:00.000Z" }]) {
  assert.equal(scoped.publicationCompanyProfile(short, { ...event, receipts: [{ ...receipt, ...changes }] }, now), null);
}
for (const changes of [{ sourceUrl: "" }, { sourceUrl: full.sourceUrl.replace("/1/", "/2/") }, { verifiedAt: "2026-09-01T00:00:00.000Z" },
  { sourceFiledAt: "2024-01-01" }, { business: "Business unknown." }, { customers: "Invented customers" }, { description: "Invented moat" }]) {
  assert.equal(scoped.publicationCompanyProfile({ ...short, ...changes }, event, now), null);
}
assert.equal(scoped.publicationCompanyProfile(short, event, new Date(now.getTime() + 49 * 3600000)), null, "Stale event context must expire");
const html = `<h2>Item 1. Business</h2><p>${full.business}</p><p>${"The company maintains operating facilities and software development programs. ".repeat(10)}</p><h2>Item 1A. Risk Factors</h2>`;
const extracted = profiles.inspectCompanyProfileExtraction({ identity, html, form: "10-K", sourceUrl: full.sourceUrl, filedAt: full.sourceFiledAt, now });
assert.equal(extracted.profile, null);
assert.equal(extracted.reason, "company_profile_customers_not_extracted");
assert.equal(extracted.businessContext.business, full.business);
const facts = loadTsModule("@/lib/company-card-facts").companyCardFacts(short, event, now);
assert.equal(facts.business, full.business);
assert.match(facts.customers, /not yet been verified/);
const outlook = loadTsModule("@/lib/signal-outlook").buildPriceOutlook({ currentPrice: 10, currency: "USD", action: "sell", conservative: 6, base: 7, optimistic: 8, basis: "valuation" });
const details = loadTsModule("@/lib/alert-details");
const publicRow = { ...event, companyProfile: short, industry: full.industry, outlook, action: "sell" };
assert.ok(details.publicAlertDetailsComplete(publicRow, now), "Publication detail guard accepts eligible event context with its unchanged price requirements");
assert.equal(details.publicAlertDetailsComplete({ ...publicRow, outlook: null }, now), false, "Short profile does not waive price/valuation gate");
const key = loadTsModule("@/lib/equity-signal/terminal-review-evidence").terminalPublicationPacketKey;
assert.notEqual(key({ ...event, companyProfile: full }), key({ ...event, companyProfile: short }), "Old full-profile approval cannot silently approve a changed short-context publication packet");
const source = readFileSync(new URL("../lib/equity-signal/runner.ts", import.meta.url), "utf8");
assert.match(source, /scopedEventCompanyProfile\(profileSource, best, now\)/);
assert.match(source, /sourced_direct_event_company_context/);
assert.match(source, /Customers and moat are unknown/);
console.log("PASS: separate sourced event profile; exact issuer, current receipts, source provenance, dependency fail-closed, unknown rendering, unchanged price and full-profile boundaries");

// The persisted terminal authority must retain a post-review context hold.
const saved = new Map();
const journal = loadTsModule("@/lib/opportunity-engine/pr262-terminal-reviews", {
  "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => `fixture/${key}` },
  "@/lib/r2-warehouse": {
    readVersionedTextFromR2: async key => ({ found: saved.has(key), text: saved.has(key) ? JSON.stringify(saved.get(key)) : null, etag: saved.has(key) ? "fixture" : null }),
    writeVersionedJsonToR2: async (key, value) => { saved.set(key, structuredClone(value)); return { written: true, conflict: false }; },
  },
});
const terminal = loadTsModule("@/lib/equity-signal/terminal-review-evidence").terminalReviewEvidence({ ...identity, scope: "event", price: 10,
  evidence: { source: [receipt], companyProfile: short, sourceComplete: true, priceReady: true, haltKnown: true, halted: false } });
const terminalQuery = { ...identity, fingerprint: "event-fixture", evidence: terminal };
assert.equal(await journal.reserveTerminalReview({ ...terminalQuery, direction: "downside", eventId: "event-fixture", attemptId: "attempt-fixture", now }), true);
const roles = ["analyst_agent", "skeptic_agent", "final_judge"];
const reviewedCandidate = { ...event, companyProfile: short, direction: "downside", gatePassed: true, terminalEvidence: terminal,
  plainLanguageExplanation: { whyItMatters: "Our customer retention and competitive moat make this immaterial." } };
const decision = await journal.finishTerminalReviewAttempt({ ...identity, eventId: "event-fixture", attemptId: "attempt-fixture", now,
  report: { openAiCalled: true, candidateFingerprint: "event-fixture", selectedCandidate: reviewedCandidate,
    committee: { ok: true, agentsCompleted: 3, agentsFailed: 0, output: { overallRecommendation: "approve",
      modelUsageSummary: { reviewPlan: { policy: "focused_v1", agentIds: roles }, roleDiagnostics: roles.map(agentId => ({ agentId, status: "completed" })) } } } } });
assert.equal(decision.outcome, "approved", "Retain the actual completed Committee recommendation as history");
assert.equal(decision.publicationGatePassed, false, "Customer-dependent scoped context cannot save publication authority");
assert.equal((await journal.checkTerminalReview(terminalQuery)).decision.publicationGatePassed, false);
assert.notEqual(decision.publicationPacketKey, key({ ...reviewedCandidate, plainLanguageExplanation: null }));
console.log("PASS: post-review customer dependency saves a durable publication hold; resetting prose cannot revive approval");

delete process.env.SWING_UP_SIMPLE_PILOT_ENABLED;
assert.equal(scoped.scopedEventCompanyProfile(business, event, now), null, "Nonpilot runtime cannot create relaxed company context");
assert.equal(scoped.publicationCompanyProfile(short, event, now), null, "Nonpilot publication stays full-profile only");
assert.ok(scoped.publicationCompanyProfile(full, event, now));
for (const name of Object.keys(process.env)) if (!(name in originalEnvironment)) delete process.env[name];
Object.assign(process.env, originalEnvironment);
