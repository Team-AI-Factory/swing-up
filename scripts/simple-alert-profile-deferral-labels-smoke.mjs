import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";

// Synthetic cache rows only. Never make a source/model call or touch live R2.
const now = new Date();
const identities = Array.from({ length: 7 }, (_, i) => ({
  ticker: `TEST${i}`, cik: String(i + 1).padStart(10, "0"), company: `Synthetic issuer ${i}`,
}));
const reasons = [
  "company_profile_time_budget_deferred",
  "company_profile_time_budget_deferred: deadline reached",
  "pr262_sensor_budget_guard:sec_edgar:minimum_interval",
  "provider_quota_exhausted",
  "source_timeout",
  "company_profile_customers_not_extracted",
];
let roleAllowed = true, attempts = 0, writes = 0;
const objects = new Map();
const overrides = {
  "@/lib/r2-warehouse": {
    readVersionedTextFromR2: async key => {
      const value = objects.get(key);
      return { found: Boolean(value), text: value ? JSON.stringify(value) : null, etag: value ? "fixture-etag" : null };
    },
    writeVersionedJsonToR2: async (key, value, condition) => {
      assert.ok(key.startsWith("pilot/profile-builder/") || key === "research-evidence/company-profiles-v1.json");
      assert.ok(condition.createOnly === true || condition.expectedEtag === "fixture-etag");
      writes++; objects.set(key, structuredClone(value)); return { written: true, conflict: false };
    },
  },
  "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => key },
  "@/lib/simple-alert-pilot-runtime": { isSimpleAlertPilot: () => roleAllowed },
  "@/lib/simple-alert-pilot-scope": { pilotCompanies: () => identities },
  "@/lib/company-profile": {
    COMPANY_PROFILE_PARSER_REVISION: 99,
    profileCik: value => String(value ?? "").padStart(10, "0"),
    verifiedCompanyProfile: profile => profile?.syntheticVerified === true ? profile : null,
  },
  "@/lib/equity-signal/universe": { loadEquityUniverse: async () => ({ snapshot: {
    refreshedAt: now.toISOString(), entries: identities.map(row => ({ ...row, name: row.company,
      exchange: "Nasdaq", securityType: "common_stock", sourceNames: ["SEC company_tickers_exchange"] })),
  } }) },
  "@/lib/opportunity-engine/pr262-sensor-fetch-budget": { createPr262SensorBudgetedFetch: async () => ({
    fetchImpl: async () => { throw new Error("unexpected_network"); }, flush: async () => {},
  }) },
  "@/lib/opportunity-engine/company-profile-cache": { ensureCompanyProfile: async identity => {
    attempts++;
    const index = identities.findIndex(row => row.cik === identity.cik);
    const at = new Date().toISOString();
    const profile = index === 6 ? { syntheticVerified: true, verifiedAt: at } : null;
    const row = { ...identity, profile, updatedAt: at, ...(profile ? { firstVerifiedAt: at } : { error: reasons[index] }) };
    const key = "research-evidence/company-profiles-v1.json";
    objects.set(key, { entries: [...(objects.get(key)?.entries ?? []), row] });
    return profile;
  } },
};
const builder = loadTsModule("@/lib/simple-alert-profile-builder", overrides);
const savedRole = process.env.SWING_UP_SIMPLE_PILOT_ROLE;
const savedInfo = console.info;
process.env.SWING_UP_SIMPLE_PILOT_ROLE = "profiles";
console.info = () => {};
try {
  const result = await builder.runSimpleAlertProfileBuilder(now, async () => { throw new Error("unexpected_network"); });
  assert.deepEqual(result.pendingReasons, {
    company_profile_time_budget_deferred: 2,
    provider_budget_deferred: 2,
    source_request_failed: 1,
    company_profile_customers_not_extracted: 1,
  }, "Execution deadlines must not inflate the provider quota denominator");
  const coverage = builder.pilotProfileCoverage(objects.get("research-evidence/company-profiles-v1.json").entries, new Date());
  assert.deepEqual(coverage.missing.map(row => row.reason), [
    "company_profile_time_budget_deferred", "company_profile_time_budget_deferred",
    "provider_budget_deferred", "provider_budget_deferred", "source_request_failed",
    "company_profile_customers_not_extracted",
  ]);
  assert.equal(coverage.verifiedCompanies, 1);
  assert.equal(result.attempted, 7);
  assert.equal(result.verifiedThisRun, 1);
  assert.equal(result.newlyVerifiedThisRun, 1);
  assert.equal(result.newlyVerifiedToday, 1);
  assert.equal(result.remaining, 499);
  assert.equal(result.unverifiedThisRun, 6);
  assert.equal(result.modelCalls, 0);
  assert.equal(result.requests, 0);
  assert.equal(result.requestFailures, 0, "Deferrals are not invented failed network requests");
  const ledgerKey = [...objects.keys()].find(key => key.startsWith("pilot/profile-builder/"));
  const ledger = objects.get(ledgerKey);
  assert.equal(ledger.leaseUntil, null);
  assert.equal(ledger.attemptsReserved, 7);
  assert.equal(ledger.totalVerified, 1);

  const before = { attempts, writes };
  objects.set(ledgerKey, { ...ledger, attemptsReserved: 2500 });
  assert.equal((await builder.runSimpleAlertProfileBuilder(now)).status, "daily_attempt_limit");
  assert.deepEqual({ attempts, writes }, before);
  objects.set(ledgerKey, { ...ledger, leaseUntil: new Date(now.getTime() + 60000).toISOString() });
  assert.equal((await builder.runSimpleAlertProfileBuilder(now)).status, "busy");
  assert.deepEqual({ attempts, writes }, before);
  roleAllowed = false;
  await assert.rejects(builder.runSimpleAlertProfileBuilder(now), /simple_pilot_profile_role_required/);
  assert.deepEqual({ attempts, writes }, before);
} finally {
  console.info = savedInfo;
  if (savedRole === undefined) delete process.env.SWING_UP_SIMPLE_PILOT_ROLE;
  else process.env.SWING_UP_SIMPLE_PILOT_ROLE = savedRole;
}
console.log("Profile deferral labels: time, quota, transport and extraction separated; verification counts, leases, role fence and attempt cap preserved. Synthetic only.");
