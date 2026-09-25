import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
const { planPr262QueueAdmissions: plan, unavailablePr262QueueAdmissionPlan } = loadTsModule("@/lib/opportunity-engine/pr262-queue-readiness", {
  "@/lib/opportunity-engine/company-profile-cache": { readCompanyProfiles: async () => new Map() },
});
const now = new Date("2026-09-23T04:00:00Z");
const event = (id, fields = {}) => ({ id, ticker: id, company: `${id} Company`, source: "official", priority: 90,
  mappingStatus: "mapped", observedAt: "2026-09-23T03:55:00Z", queueAttempts: 0, queueNextAttemptAt: null, queueLastAttemptAt: null, queueLastError: null, ...fields });
const missing = Array.from({ length: 400 }, (_, i) => event(`BLOCK${i}`, { queueAttempts: 25, queueLastAttemptAt: "2026-09-23T03:30:00Z" }));
const incoming = Array.from({ length: 7 }, (_, i) => event(`NEW${i}`));
const old = event("RETRY", { queueAttempts: 10, observedAt: "2026-09-22T08:00:00Z" });
const rows = [...missing, old, ...incoming];
const original = JSON.stringify(rows);
const result = plan(rows, new Set([...incoming.map(row => row.ticker), old.ticker]), now);
assert.equal(result.profileBlockedCount, 400);
assert.equal(result.profileReadyCount, 8);
assert.equal(result.excludedEventIds.length, 400, "Already examined issuers cannot repeatedly occupy expensive analysis slots.");
assert.deepEqual(result.preferredEventIds.slice(0, 4), ["NEW0", "NEW1", "NEW2", "RETRY"], "New events must pass the retry backlog while retained evidence still gets a turn.");
assert.equal(result.discoveryAllowance, 0);
assert.equal(result.profileBlockedCompanyCount, 400);
assert.equal(result.parkedProfileEventCount, 400);
assert.equal(JSON.stringify(rows), original, "Scheduling preserves every retained event and its attempt history.");
assert.equal(result.eventsDeleted, 0);
const discovery = event("FIRST");
const repeatIssuer = event("ANOTHER", { ticker: "BLOCK0" });
const withDiscovery = plan([...rows, discovery, repeatIssuer], new Set(incoming.map(row => row.ticker)), now);
assert.equal(withDiscovery.preferredEventIds.at(-1), "FIRST", "A truly unexamined issuer still gets one discovery slot");
assert.ok(withDiscovery.excludedEventIds.includes("ANOTHER"), "A new event cannot bypass an existing issuer's missing-profile hold");
assert.equal(withDiscovery.profileBlockedCompanyCount, 402, "Multiple events for the same issuer count as one company");
assert.equal(withDiscovery.discoveryAllowance, 1);
const unavailable = unavailablePr262QueueAdmissionPlan(rows);
assert.deepEqual(unavailable.preferredEventIds, [], "A failed readiness read must not admit the entire backlog");
assert.equal(unavailable.excludedEventIds.length, rows.length);
assert.equal(unavailable.eventsDeleted, 0);
const waiting = event("RECOVERED", { queueAttempts: 5, queueLastError: "pr262_event_report_retry:candidate_company_profile_pending", queueNextAttemptAt: "2026-09-24T04:00:00Z" });
assert.deepEqual(plan([waiting], new Set(["RECOVERED"]), now).readyProfileEventIds, ["RECOVERED"], "An actually recovered profile can wake its waiting event immediately.");
assert.equal(plan([waiting], new Set(), now).preferredEventIds.length, 0, "Unresolved profiles cannot bypass backoff.");
const costWait = { ...waiting, queueLastError: "pr262_event_report_retry:qualified_signal_openai_reservation_denied" };
assert.deepEqual(plan([costWait], new Set(["RECOVERED"]), now).readyProfileEventIds, [], "Profile recovery cannot bypass a paid-budget hold.");
assert.equal(plan([costWait], new Set(["RECOVERED"]), now).blockerCounts.reservation_unclassified, 1,
  "A legacy generic denial is not evidence that the dollar budget was exhausted");
const { pr262EvidenceBlocker, pr262EvidenceRetryAt, pr262ReservationBlocker } = loadTsModule("@/lib/opportunity-engine/pr262-review-blockers");
const reasons = { candidate_already_recorded: "same_evidence", candidate_already_reserved: "same_evidence",
  paid_evidence_cooldown: "same_evidence", daily_cost_fuse: "ai_budget", daily_review_limit: "review_capacity",
  provider_cooldown: "ai_provider", accounting_unavailable: "accounting_unavailable", lease_unavailable: "reservation_unclassified" };
for (const [reason, category] of Object.entries(reasons)) assert.equal(pr262ReservationBlocker(reason), category);
assert.equal(pr262EvidenceBlocker("candidate_alert_details_pending", { priceScenarios: false, industry: true }), "missing_price_scenarios");
assert.equal(pr262EvidenceBlocker("candidate_alert_details_pending", { priceScenarios: true, industry: false }), "missing_industry");
assert.equal(pr262EvidenceRetryAt("missing_price_scenarios", now), "2026-09-24T04:00:00.000Z",
  "Unchanged daily valuation inputs must not consume a worker slot every 15 minutes");
assert.equal(pr262EvidenceRetryAt("missing_profile", now), null, "Profile recovery keeps its immediate cache-driven wake-up path");
const scenarioWait = event("SCENARIO", { queueAttempts: 9,
  queueLastError: "pr262_event_report_retry:candidate_alert_details_pending:blocker=missing_price_scenarios",
  queueNextAttemptAt: "2026-09-24T04:00:00Z" });
const scenarioPlan = plan([scenarioWait], new Set(["SCENARIO"]), now);
assert.equal(scenarioPlan.profileReadyCount, 0);
assert.equal(scenarioPlan.blockerCounts.missing_price_scenarios, 1, "The parked scenario gap must remain separately auditable");
const locked = ["same_evidence", "ai_budget", "review_capacity", "ai_provider", "accounting_unavailable"].map(category => event(category, {
  queueAttempts: 2, queueLastError: `pr262_event_report_retry:qualified_signal_openai_reservation_denied:blocker=${category}`,
  queueNextAttemptAt: "2026-09-23T05:00:00Z",
}));
const lockPlan = plan([...locked, ...incoming, ...missing], new Set([...locked, ...incoming].map(row => row.ticker)), now);
for (const row of locked) assert.equal(lockPlan.blockerCounts[row.id], 1);
assert.equal(lockPlan.blockerCounts.missing_profile, 400);
assert.equal(lockPlan.profileReadyCount, 7, "Future review locks are not counted as ready work");
const heldReview = event("HELD", { queueAttempts: 2, queueLastError: "pr262_event_report_retry:configuration_blocker:blocker=committee_disabled" });
const legacyHeldReview = event("LEGACY", { queueAttempts: 2, queueLastError: "pr262_event_report_retry:configuration_blocker" });
const pausedPlan = plan([heldReview, legacyHeldReview, ...incoming], new Set(["HELD", "LEGACY", ...incoming.map(row => row.ticker)]), now, { committeePaused: true });
assert.equal(pausedPlan.committeeHeldCount, 2);
assert.equal(pausedPlan.blockerCounts.committee_disabled, 2);
assert.equal(pausedPlan.profileReadyCount, incoming.length, "Paused final review does not repeatedly consume source-analysis work");
assert.ok(!pausedPlan.preferredEventIds.includes("HELD"));
assert.ok(plan([heldReview], new Set(["HELD"]), now, { committeePaused: false }).preferredEventIds.includes("HELD"), "A lifted hold makes the retained event eligible again without any deletion");
const exactAge = event("AGE", { firstQueuedAt: "2026-09-23T03:40:00Z", observedAt: "2026-09-22T04:00:00Z" });
const agePlan = plan([exactAge, incoming[0]], new Set(["AGE", incoming[0].ticker]), now);
assert.equal(agePlan.oldestProfileReadyQueueWaitMinutes, 20, "Publication age must not be reported as actual queue wait");
assert.equal(agePlan.profileReadyQueueAgeUnknownCount, 1);
const freshSec = event("NEWSEC", { source: "sec", priority: 90, cik: "0000001234", accession: "0000001234-26-000001",
  identityMethod: "official_sec_archive_link", canonicalSecIndexUrl: "https://www.sec.gov/Archives/edgar/data/1234/000000123426000001/0000001234-26-000001-index.html" });
const freshValuation = event("VALUE", { source: "market_price", priority: 100 });
assert.equal(plan([freshValuation, old, freshSec, ...missing], new Set(["NEWSEC", "VALUE", "RETRY"]), now).preferredEventIds[0], "NEWSEC",
  "Fresh SEC evidence goes ahead of valuation refreshes and old blocked events");

const { reviewEvidenceRevision: revision } = loadTsModule("@/lib/equity-signal/review-evidence-revision");
const evidence = { source: [{ id: "valuation:one", rawEventType: "valuation_review", summary: "price=10 checkedAt=01:00" }],
  facts: [{ metric: "revenue", value: 100, unit: "USD", periodEnd: "2026-06-30", filedAt: "2026-08-01", checkedAt: "01:00" }],
  valuation: { base: 20, currentPriceSupportsValuation: true }, priceReady: true };
const unchanged = structuredClone(evidence);
unchanged.source[0].summary = "price=10.01 checkedAt=02:00";
unchanged.facts[0].checkedAt = "02:00";
assert.equal(revision(evidence), revision(unchanged), "A quote tick and another fetch must not unlock another paid review.");
unchanged.facts[0].value = 120;
assert.notEqual(revision(evidence), revision(unchanged), "New financial facts can unlock a review.");
unchanged.facts[0].value = 100;
unchanged.valuation.currentPriceSupportsValuation = false;
assert.notEqual(revision(evidence), revision(unchanged), "Crossing the valuation condition remains material.");
assert.notEqual(revision({ source: [{ id: "filing", summary: "original" }] }), revision({ source: [{ id: "filing", summary: "corrected" }] }), "A corrected issuer document remains new evidence.");
console.log("PASS: 400 blocked events preserve fresh admissions, retained-event fairness, profile wake-up, cost holds, no deletion and stable paid-review evidence.");
