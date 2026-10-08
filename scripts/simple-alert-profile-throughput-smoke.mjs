import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";

const now = new Date();
const identity = (ticker, cik, extra = {}) => ({ ticker, cik: String(cik).padStart(10, "0"), company: `Issuer ${cik}`, ...extra });
const listing = row => ({ ...row, name: row.company, exchange: "Nasdaq", securityType: "common_stock", sourceNames: ["SEC company_tickers_exchange"] });
const entry = (row, at = now) => ({ ...row, profile: companyProfileFixture(row, now), updatedAt: at.toISOString(), firstVerifiedAt: at.toISOString() });
const noIo = { readVersionedTextFromR2: async () => { throw new Error("unexpected_io"); }, writeVersionedJsonToR2: async () => { throw new Error("unexpected_io"); } };
const profileBuilder = loadTsModule("@/lib/simple-alert-profile-builder", { "@/lib/r2-warehouse": noIo });
const profile = loadTsModule("@/lib/company-profile");
const plan = profileBuilder.profileBatchPlan;
const base = identity("AAC", 1), unit = identity("AAC-UN", 1), warrant = identity("AAC-WT", 1);
assert.equal(plan([base, unit, warrant].map(listing), [], now, 100).due.length, 1, "Three same-CIK securities are one company attempt");
assert.equal(plan([base, unit, warrant].map(listing), [], now, 100).duplicateIssuerListings, 2);
assert.equal(plan([base, unit, warrant].map(listing), [], now, 100).due[0].ticker, "AAC");
const directoryConfirmed = { ...listing(warrant), sourceNames: ["SEC company_tickers_exchange", "Nasdaq Trader nasdaqlisted"] };
assert.equal(plan([listing(base), directoryConfirmed], [], now, 100).due[0].ticker, "AAC-WT", "Authoritative listing evidence outranks a ticker heuristic");
assert.equal(plan([listing(base)], [entry(base), entry(unit), entry(warrant)], now, 100).newlyVerifiedToday, 1, "Alternate securities cannot inflate production");
const yesterday = new Date(now.getTime() - 86400000);
assert.equal(plan([listing(base)], [entry(base, yesterday), entry(unit)], now, 100).newlyVerifiedToday, 0, "Second security cannot reset an issuer's first verification");
assert.equal(plan([listing(base)], [{ ...entry(base), profile: null }], now, 100).newlyVerifiedToday, 0);
assert.equal(plan([listing(base)], [{ ...entry(base), profile: { ...entry(base).profile, customers: "Unknown" } }], now, 100).newlyVerifiedToday, 0, "Quality checks remain mandatory");
assert.equal(plan([listing(base)], [{ ...entry(base), firstVerifiedAt: undefined }], now, 100).newlyVerifiedToday, 0, "Legacy profile without first verification is never invented as new");
assert.equal(plan([listing(base)], [entry(unit)], now, 100).due.length, 0, "Already verified issuer is not profiled again under an alias");
assert.equal(plan([listing(base)], [{ ...unit, profile: null, nextAttemptAt: new Date(now.getTime() + 3600000).toISOString() }], now, 100).due.length, 0, "Shared issuer cooldown covers aliases");
for (const changed of [{ exchange: "OTC" }, { exchange: null }, { securityType: "warrant" }, { sourceNames: [] }]) {
  assert.equal(plan([{ ...listing(base), ...changed }], [], now, 100).due.length, 0, "Explicit listing eligibility is required");
}
assert.equal(plan([listing(identity("NEW", 2)), listing(identity("NEWU", 3))], [], now, 100).due.length, 2, "Similar ticker spelling never merges distinct CIKs");
const fresh = Array.from({ length: 12 }, (_, i) => listing(identity(`F${i}`, i + 10)));
const retry = identity("RETRY", 100), retryEntry = { ...retry, profile: null, updatedAt: yesterday.toISOString(), nextAttemptAt: yesterday.toISOString(), error: "source_request_failed" };
assert.equal(plan([...fresh, listing(retry)], [retryEntry], now, 100).due[3].ticker, "RETRY", "Due retry receives an early reserved slot among fresh issuers");
assert.equal(plan([...fresh, listing(retry)], [{ ...retryEntry, nextAttemptAt: new Date(now.getTime() + 3600000).toISOString() }], now, 100).due.some(row => row.ticker === "RETRY"), false, "Fairness cannot bypass source cooldown");
assert.equal(plan([listing(retry)], [{ ...retryEntry, nextAttemptAt: new Date(now.getTime() + 3600000).toISOString(), error: "company_profile_products_and_customers_not_extracted", parserRevision: -1 }], now, 100).due.length, 1, "A repaired parser can revisit exact saved sources immediately");
const olderRepair = identity("OLDREPAIR", 101), recentRepair = identity("RECENTREPAIR", 102);
const parserRepairEntry = (row, updatedAt) => ({ ...row, profile: null, updatedAt, nextAttemptAt: new Date(now.getTime() + 3600000).toISOString(),
  error: "company_profile_products_and_customers_not_extracted", parserRevision: -1 });
const repairOrder = plan([listing(olderRepair), listing(recentRepair)], [
  parserRepairEntry(olderRepair, new Date(now.getTime() - 86400000).toISOString()),
  parserRepairEntry(recentRepair, new Date(now.getTime() - 60000).toISOString()),
], now, 100).due;
assert.deepEqual(repairOrder.map(row => row.ticker), ["RECENTREPAIR", "OLDREPAIR"],
  "A new parser revision verifies the newest motivating exact-source failures before the ordinary retry backlog");
assert.equal(plan([listing(recentRepair)], [{ ...parserRepairEntry(recentRepair, now.toISOString()), parserRevision: profile.COMPANY_PROFILE_PARSER_REVISION }], now, 100).due.length, 0,
  "Same-revision extraction failures retain their persisted backoff");
const invalidLegacy = { ...entry(base, yesterday), parserRevision: 6, nextAttemptAt: new Date(now.getTime() + 30 * 86400000).toISOString(),
  profile: { ...entry(base, yesterday).profile, business: "We sell our products to customers around the world through many different distribution channels.", description: "invalid legacy generic product description" } };
assert.equal(plan([listing(base)], [invalidLegacy], now, 100).due.length, 1, "A rejected cached profile's old30-day refresh date cannot freeze repair");
assert.equal(plan([listing(base)], [invalidLegacy], now, 100).newlyVerifiedToday, 0, "An invalid old profile is not newly verified");
for (const error of ["pr262_sensor_budget_guard:sec_edgar:minimum_interval;next_retry_at=" + invalidLegacy.nextAttemptAt, "company_profile_http_429", "source_request_failed"]) {
  assert.equal(plan([listing(base)], [{ ...invalidLegacy, error }], now, 100).due.length, 0, "An active same-row source error still controls its future retry boundary");
}

const repairPending = { ...invalidLegacy, profile: null, updatedAt: now.toISOString(), nextAttemptAt: new Date(now.getTime() + 3600000).toISOString(), parserRevision: 9 };
assert.equal(plan([listing(base)], [repairPending], now, 100).due.length, 0, "The first ordinary attempt's persisted backoff prevents a retry loop");
assert.equal(plan([listing(base)], [invalidLegacy, { ...unit, profile: null, error: "provider_budget_deferred", nextAttemptAt: repairPending.nextAttemptAt }], now, 100).due.length, 0, "An active same-issuer source cooldown still wins");
const repairedLegacy = { ...entry(base), firstVerifiedAt: yesterday.toISOString() };
assert.equal(plan([listing(base)], [repairedLegacy], now, 100).newlyVerifiedToday, 0, "Repair cannot reset a company's earliest verification date");
assert.equal(profileBuilder.firstVerifiedCompaniesThisRun([invalidLegacy], [repairedLegacy], now), 0, "Restoring an old invalid cache is not a first-time company");
assert.equal(profileBuilder.firstVerifiedCompaniesThisRun([entry(unit)], [entry(base)], now), 0, "Earlier verification under another ticker prevents a new-company claim");
assert.equal(profileBuilder.firstVerifiedCompaniesThisRun([], [entry(base, yesterday)], now), 0, "Imported prior-day verification cannot be claimed as new this run");
assert.equal(profileBuilder.firstVerifiedCompaniesThisRun([], [entry(base), entry(unit)], now), 1, "New aliases count once by CIK");
assert.equal(profileBuilder.firstVerifiedCompaniesThisRun([], [invalidLegacy], now), 0, "Invalid profiles cannot count as first-time verification");
const legacyUnknownHistory = { ...unit, profile: null, verificationHistoryKnown: true };
assert.equal(profileBuilder.firstVerifiedCompaniesThisRun([legacyUnknownHistory], [legacyUnknownHistory, entry(base)], now), 0,
  "An unknown historical date under another ticker still prevents a first-time issuer claim");
assert.equal(plan([listing(base)], [legacyUnknownHistory, entry(base)], now, 100).newlyVerifiedToday, 0,
  "A new alias cannot invent today's first verification for an issuer with unknown prior history");
assert.equal(plan([listing(base)], [{ ...entry(base), verificationHistoryKnown: true }], now, 100).newlyVerifiedToday, 1,
  "The history flag with a genuinely known first date today preserves daily production");
assert.equal(plan([listing(base)], [{ ...entry(base, yesterday), verificationHistoryKnown: true }, entry(unit)], now, 100).newlyVerifiedToday, 0,
  "Known older history still governs a newly verified alias");
const atLimit = Array.from({ length: 500 }, (_, i) => entry(identity(`T${i}`, i + 500)));
assert.equal(plan([listing(base)], atLimit, now, 100).due.length, 0);
assert.equal(plan([listing(base)], atLimit.slice(0, 499), now, 100).due.length, 1);

const savedEnv = { ...process.env }, info = console.info;
Object.assign(process.env, { SWING_UP_SIMPLE_PILOT_ENABLED: "true", RAILWAY_GIT_BRANCH: "pilot-simple-alerts", RAILWAY_PROJECT_ID: "83d99341-d622-475f-8035-00ef3d0916d1", RAILWAY_ENVIRONMENT_ID: "87afb8d7-c4fc-4f84-92b6-5d2820a689b6", SWING_UP_PR262_STORAGE_PREFIX: "branch-labs/simple-alerts/", SWING_UP_R2_WRITE_PREFIX: "branch-labs/simple-alerts/", SWING_UP_SIMPLE_PILOT_ROLE: "profiles" });
try {
  console.info = () => {};
  for (const mode of ["parallel", "source_circuit", "worker_failure", "worker_partial", "daily_cap"]) {
    const objects = new Map(), starts = [], rows = [identity("ONE", 11), identity("TWO", 12), identity("THREE", 13)];
    let active = 0, maxActive = 0, lastFinished = 0, summaryWritten = 0;
    const storage = {
      readVersionedTextFromR2: async key => {
        const value = objects.get(key) ?? (mode === "daily_cap" && key.startsWith("pilot/profile-builder/") ? { attemptsReserved: 2498 } : null);
        return { found: Boolean(value), text: value ? JSON.stringify(value) : null, etag: value ? "1" : null };
      },
      writeVersionedJsonToR2: async (key, value) => { objects.set(key, structuredClone(value)); if (key.startsWith("pilot/profile-builder/") && value.leaseUntil === null) summaryWritten = Date.now(); return { written: true, conflict: false }; },
    };
    const builder = loadTsModule("@/lib/simple-alert-profile-builder", {
      "@/lib/r2-warehouse": storage,
      "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => key },
      "@/lib/equity-signal/universe": { loadEquityUniverse: async () => ({ snapshot: { refreshedAt: now.toISOString(), entries: rows.map(listing) } }) },
      "@/lib/opportunity-engine/pr262-sensor-fetch-budget": { createPr262SensorBudgetedFetch: async input => ({ fetchImpl: input.fetchImpl, flush: async () => {} }) },
      "@/lib/opportunity-engine/company-profile-cache": { ensureCompanyProfile: async (row, fetcher) => {
        active++; maxActive = Math.max(maxActive, active);
        try {
          if (mode === "worker_failure" || mode === "worker_partial") {
            if (row.ticker === "ONE") { await delay(10); throw new Error("synthetic_storage_failure"); }
            await delay(50);
            if (mode === "worker_partial") {
              objects.set("research-evidence/company-profiles-v1.json", { entries: [entry(row, new Date())] });
              return companyProfileFixture(row, new Date());
            }
            return null;
          }
          try { const response = await fetcher(`https://example.test/${row.cik}`); if (!response.ok) return null; }
          catch { return null; }
          await delay(30);
          const key = "research-evidence/company-profiles-v1.json";
          const prior = objects.get(key)?.entries ?? [];
          objects.set(key, { entries: [...prior, entry(row, new Date())] });
          return companyProfileFixture(row, new Date());
        } finally { active--; lastFinished = Date.now(); }
      } },
    });
    const result = await builder.runSimpleAlertProfileBuilder(now, async () => { starts.push(Date.now()); return new Response("ok", { status: mode === "source_circuit" ? 429 : 200 }); });
    assert.ok(maxActive <= 2);
    assert.equal(maxActive, 2, "Independent company work overlaps");
    assert.ok(summaryWritten >= lastFinished, "Summary and lease settle after every worker finishes");
    for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 990, "Parallel workers keep the original 1 request/second pacing");
    assert.equal(result.modelCalls, 0);
    if (mode === "parallel") { assert.equal(result.newlyVerifiedThisRun, 3); assert.equal(result.attempted, 3); }
    if (mode === "source_circuit") { assert.equal(starts.length, 1); assert.equal(result.status, "source_cooldown"); assert.equal(result.newlyVerifiedThisRun, 0); }
    if (mode === "worker_failure") {
      assert.equal(result.status, "failed");
      assert.equal(result.newlyVerifiedThisRun, null, "A failed worker with no authoritative cache reread cannot prove zero new profiles");
      assert.equal(result.verificationCountsStatus, "unreconciled");
    }
    if (mode === "worker_partial") {
      assert.equal(result.status, "failed"); assert.equal(result.ok, false);
      assert.equal(result.failure, "synthetic_storage_failure");
      assert.equal(result.newlyVerifiedThisRun, 1, "Persisted partial work is reconciled even when its peer fails");
      assert.equal(result.newlyVerifiedToday, 1);
      assert.equal(result.remaining, 499);
      assert.equal(result.attempted, 2, "No new companies start after a storage failure");
    }
    if (mode === "daily_cap") { assert.equal(result.attempted, 2); assert.equal([...objects.entries()].find(([key]) => key.startsWith("pilot/profile-builder/"))[1].attemptsReserved, 2500); }
  }
  console.log("Profile throughput: unique CIK counting, actual listing eligibility, alias cooldown, fair retries, parser-repair revisit, bounded two-worker overlap, original pacing/circuit/daily caps and all-workers-settled persistence passed.");
} finally {
  console.info = info;
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
}
