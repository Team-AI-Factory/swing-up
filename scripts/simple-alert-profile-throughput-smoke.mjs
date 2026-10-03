import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";

const now = new Date();
const identity = (ticker, cik, extra = {}) => ({ ticker, cik: String(cik).padStart(10, "0"), company: `Issuer ${cik}`, ...extra });
const listing = row => ({ ...row, name: row.company, exchange: "Nasdaq", securityType: "common_stock", sourceNames: ["SEC company_tickers_exchange"] });
const entry = (row, at = now) => ({ ...row, profile: companyProfileFixture(row, now), updatedAt: at.toISOString(), firstVerifiedAt: at.toISOString() });
const noIo = { readVersionedTextFromR2: async () => { throw new Error("unexpected_io"); }, writeVersionedJsonToR2: async () => { throw new Error("unexpected_io"); } };
const plan = loadTsModule("@/lib/simple-alert-profile-builder", { "@/lib/r2-warehouse": noIo }).profileBatchPlan;
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
const atLimit = Array.from({ length: 500 }, (_, i) => entry(identity(`T${i}`, i + 500)));
assert.equal(plan([listing(base)], atLimit, now, 100).due.length, 0);
assert.equal(plan([listing(base)], atLimit.slice(0, 499), now, 100).due.length, 1);

const savedEnv = { ...process.env }, info = console.info;
Object.assign(process.env, { SWING_UP_SIMPLE_PILOT_ENABLED: "true", RAILWAY_GIT_BRANCH: "pilot-simple-alerts", RAILWAY_PROJECT_ID: "83d99341-d622-475f-8035-00ef3d0916d1", RAILWAY_ENVIRONMENT_ID: "87afb8d7-c4fc-4f84-92b6-5d2820a689b6", SWING_UP_PR262_STORAGE_PREFIX: "branch-labs/simple-alerts/", SWING_UP_R2_WRITE_PREFIX: "branch-labs/simple-alerts/", SWING_UP_SIMPLE_PILOT_ROLE: "profiles" });
try {
  console.info = () => {};
  for (const mode of ["parallel", "source_circuit", "worker_failure", "daily_cap"]) {
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
          if (mode === "worker_failure") {
            if (row.ticker === "ONE") { await delay(10); throw new Error("synthetic_storage_failure"); }
            await delay(50); return null;
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
    if (mode === "worker_failure") { assert.equal(result.status, "failed"); assert.equal(result.newlyVerifiedThisRun, 0); }
    if (mode === "daily_cap") { assert.equal(result.attempted, 2); assert.equal([...objects.entries()].find(([key]) => key.startsWith("pilot/profile-builder/"))[1].attemptsReserved, 2500); }
  }
  console.log("Profile throughput: unique CIK counting, actual listing eligibility, alias cooldown, fair retries, parser-repair revisit, bounded two-worker overlap, original pacing/circuit/daily caps and all-workers-settled persistence passed.");
} finally {
  console.info = info;
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
}
