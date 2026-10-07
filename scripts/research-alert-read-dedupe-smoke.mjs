import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";

const now = new Date("2026-10-07T00:30:00Z");
const identity = { ticker: "INOD", company: "Innodata Inc.", cik: "0000903651" };
const profile = companyProfileFixture(identity, now);
let stored = null;
let reads = 0;
let writes = 0;
let failProfiles = false;
const evidence = loadTsModule("@/lib/opportunity-engine/pr262-research-evidence", {
  "@/lib/r2-warehouse": {
    readVersionedTextFromR2: async key => {
      reads++;
      assert.equal(key, "test/research-evidence/alerts-v1.json");
      return stored === null ? { found: false, text: null } : { found: true, text: JSON.stringify(stored) };
    },
    writeVersionedJsonToR2: async () => { writes++; throw new Error("Read projection must not write storage"); },
  },
  "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => `test/${key}` },
  "@/lib/opportunity-engine/company-profile-cache": {
    readCompanyProfiles: async () => {
      if (failProfiles) throw new Error("Profile cache unavailable");
      return new Map([[identity.ticker, profile]]);
    },
  },
});
const row = (id, overrides = {}) => ({
  ...identity, id, eventId: `daily-${id}`, kind: "valuation", action: "sell",
  createdAt: "2026-10-06T05:02:36.734Z", eventObservedAt: "2026-10-06T04:30:32.611Z",
  valuationObservedAt: "2026-10-06T04:30:32.611Z", priceObservedAt: "2026-10-05T23:56:20.000Z", currentPrice: 67.05,
  reviewEvidenceFingerprint: "valuation:0000903651:downside:0123456789abcdef",
  committeeApproved: false, committeeStatus: "awaiting_review", publicationStatus: "provisional_alert",
  userAlertEligible: true, ...overrides,
});
async function read(rows) {
  stored = { version: 1, alerts: structuredClone(rows) };
  const original = structuredClone(stored);
  const result = await evidence.readResearchAlerts();
  assert.deepEqual(stored, original, "Historical rows must remain unchanged in storage");
  assert.equal(writes, 0);
  return result;
}
assert.deepEqual(await evidence.readResearchAlerts(), []);
stored = { version: 1, alerts: null };
assert.deepEqual(await evidence.readResearchAlerts(), []);

const old = row("oct-06");
const latest = row("oct-07", { createdAt: "2026-10-07T00:01:29.262Z", currentPrice: 66.45,
  eventObservedAt: "2026-10-07T00:00:55.676Z", valuationObservedAt: "2026-10-07T00:00:55.676Z",
  priceObservedAt: "2026-10-06T23:29:52.000Z" });
for (const aliases of [[old, latest], [latest, old]]) {
  const projected = await read(aliases);
  assert.equal(projected.length, 1, "Daily IDs collapse only when exact evidence identity agrees");
  assert.equal(projected[0].id, latest.id);
  assert.equal(projected[0].currentPrice, 66.45);
  assert.equal(projected[0].committeeApproved, false);
  assert.deepEqual(projected[0].companyProfile, profile, "Canonical rows retain normal profile enrichment");
}

const approved = row("approved", { committeeApproved: true, committeeStatus: "approved",
  publicationStatus: "committee_approved_alert", valuationObservedAt: "2026-10-05T00:00:00Z" });
for (const aliases of [[approved, latest], [latest, approved]]) {
  const [projected] = await read(aliases);
  assert.equal(projected.id, approved.id);
  assert.equal(projected.currentPrice, approved.currentPrice, "A provisional quote must not inherit approval");
  assert.equal(projected.valuationObservedAt, approved.valuationObservedAt);
  assert.equal(evidence.isResearchAlertCurrent(projected, now.getTime()), false, "An alias cannot refresh expired reviewed evidence");
}
const rejected = row("rejected", { committeeStatus: "rejected", userAlertEligible: false });
for (const aliases of [[approved, latest, rejected], [rejected, latest, approved]]) {
  const projected = await read(aliases);
  assert.equal(projected.length, 1);
  assert.equal(projected[0].id, rejected.id, "A terminal rejection must suppress stale approval and provisional aliases");
  assert.equal(projected[0].committeeApproved, false);
  assert.equal(projected[0].userAlertEligible, false);
}
const pending = row("pending", { committeeStatus: "approved_pending_checks" });
assert.equal((await read([latest, pending]))[0].committeeApproved, false, "Pending checks are never promoted to approval");
const malformedApproval = row("malformed", { committeeStatus: "approved", createdAt: old.createdAt });
assert.equal((await read([malformedApproval, latest]))[0].id, latest.id, "An approval label alone is not completed approval");

const distinct = row("different-evidence", { reviewEvidenceFingerprint: "valuation:0000903651:downside:fedcba9876543210" });
const otherIssuer = row("same-ticker-different-issuer", { cik: "0000903652" });
assert.equal((await read([old, latest, distinct, otherIssuer])).length, 3, "Distinct evidence and distinct issuers must survive");
assert.equal((await read([old, row("padded-cik-alias", { cik: "903651" })])).length, 1);
for (const overrides of [{ reviewEvidenceFingerprint: null }, { reviewEvidenceFingerprint: "" },
  { reviewEvidenceFingerprint: "   " }, { cik: null }, { cik: "invalid" }, { cik: "0000000000" }]) {
  assert.equal((await read([row("unproven-one", overrides), row("unproven-two", overrides)])).length, 2,
    "Ticker and display similarity cannot replace issuer/evidence identity");
}
const prefix = "e".repeat(1600);
assert.equal((await read([row("long-a", { reviewEvidenceFingerprint: `${prefix}a` }),
  row("long-b", { reviewEvidenceFingerprint: `${prefix}b` })])).length, 2, "Fingerprints must not be truncated before comparison");
assert.equal((await read([row("invalid-date", { createdAt: "invalid" }), latest]))[0].id, latest.id);
failProfiles = true;
assert.equal((await read([old, latest]))[0].id, latest.id, "Profile outages do not prevent exact-identity dedupe");
assert.equal((await read(Array.from({ length: 101 }, (_, index) => row(`history-${index}`, { reviewEvidenceFingerprint: null })))).length, 100,
  "Existing read bounds remain unchanged");
assert.ok(reads > 0);
assert.equal(writes, 0);
console.log("PASS: real readResearchAlerts selects exact issuer/evidence aliases, preserves terminal verdicts and distinct evidence, and never rewrites history.");
