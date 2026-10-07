import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";

const profileKey = "research-evidence/company-profiles-v1.json";
const identities = ["ONE", "TWO"].map((ticker, i) => ({ ticker, company: `${ticker} Software`, cik: String(i + 1).padStart(10, "0") }));
const listing = identity => ({ ...identity, name: identity.company, exchange: "Nasdaq", securityType: "common_stock", sourceNames: ["SEC company_tickers_exchange"] });
const savedRole = process.env.SWING_UP_SIMPLE_PILOT_ROLE, info = console.info, originalDateNow = Date.now, originalTimeout = AbortSignal.timeout;
let countSignal, persistenceController, activeMode;
AbortSignal.timeout = milliseconds => {
  if (milliseconds === 160_000 && activeMode === "persistence_deadline") return persistenceController.signal;
  const signal = originalTimeout(milliseconds);
  if (milliseconds === 175_000) countSignal = signal;
  return signal;
};
process.env.SWING_UP_SIMPLE_PILOT_ROLE = "profiles";
try {
  console.info = () => {};
  for (const mode of ["available", "unavailable", "missing", "malformed", "missing_verified", "native_transport", "native_timeout", "alias", "persistence_deadline", "deadline"]) {
    activeMode = mode; persistenceController = new AbortController();
    const objects = new Map(), revisions = new Map();
    let failureInjected = false, reconciliationRestored = false, requests = 0, reconciliationReads = 0;
    let resolveFirstWrite;
    const firstVerifiedWrite = new Promise(resolve => { resolveFirstWrite = resolve; });
    const now = new Date();
    const fixtures = identities.map(identity => companyProfileFixture(identity, now));
    const baselineIdentity = { ticker: "BASE", company: "BASE Software", cik: "0000000003" };
    const baselineAt = new Date(now.getTime() - 1000);
    objects.set(profileKey, { entries: [{ ...baselineIdentity, profile: companyProfileFixture(baselineIdentity, baselineAt),
      firstVerifiedAt: baselineAt.toISOString(), verificationHistoryKnown: true, updatedAt: baselineAt.toISOString(),
      nextAttemptAt: new Date(now.getTime() + 86400000).toISOString() }] });
    revisions.set(profileKey, 1);
    const storage = {
      readVersionedTextFromR2: async (key, options = {}) => {
        if (key === profileKey && failureInjected && !reconciliationRestored && options.signal === countSignal) {
          reconciliationReads++;
          if (mode === "unavailable") throw new Error("r2_state_read_http_503");
          if (mode === "missing") return { found: false, text: null, etag: null };
          if (mode === "malformed") return { found: true, text: '{"entries":"invalid"}', etag: "invalid" };
          if (mode === "missing_verified") return { found: true, text: '{"entries":[]}', etag: "omitted" };
        }
        let value = objects.get(key);
        if (key === profileKey && mode === "alias" && failureInjected && !reconciliationRestored && options.signal === countSignal) {
          value = structuredClone(value);
          for (const row of value.entries) if (row.ticker === "ONE") { row.ticker = "ONE.A"; row.profile.ticker = "ONE.A"; }
        }
        return { found: value !== undefined, text: value === undefined ? null : JSON.stringify(value), etag: value === undefined ? null : String(revisions.get(key)) };
      },
      writeVersionedJsonToR2: async (key, value, options = {}) => {
        const prior = objects.get(key), revision = revisions.get(key) ?? 0;
        if ((options.createOnly && prior !== undefined) || (options.expectedEtag && options.expectedEtag !== String(revision))) return { written: false, conflict: true };
        if (key === profileKey && !reconciliationRestored && value.entries.some(row => row.ticker === "TWO" && row.error === "company_profile_products_and_customers_not_extracted")) {
          assert.ok(prior.entries.some(row => row.ticker === "ONE" && row.profile?.status === "verified"), "The actual verified cache write must precede the persistent pending-result PUT failure");
          failureInjected = true;
          if (mode === "deadline") Date.now = () => originalDateNow() + 175_001;
          if (mode === "persistence_deadline") {
            Date.now = () => originalDateNow() + 160_001;
            persistenceController.abort(new DOMException("Persistence time window ended", "TimeoutError"));
          }
          if (mode === "native_transport" || mode === "native_timeout") throw Object.assign(new Error(mode === "native_transport" ? "fetch failed" : "The operation was aborted due to timeout"), {
            storageDomain: "r2_state", storageOperation: "write", name: mode === "native_timeout" ? "TimeoutError" : "TypeError",
          });
          throw new Error("r2_state_write_http_502");
        }
        objects.set(key, structuredClone(value)); revisions.set(key, revision + 1);
        if (key === profileKey && value.entries.some(row => row.ticker === "ONE" && row.profile?.status === "verified")) resolveFirstWrite();
        return { written: true, conflict: false, etag: String(revision + 1) };
      },
    };
    const overrides = {
      "@/lib/r2-warehouse": storage,
      "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => key },
      "@/lib/simple-alert-pilot-runtime": { isSimpleAlertPilot: () => true },
      "@/lib/simple-alert-pilot-scope": { pilotCompanies: () => [] },
      "node:timers/promises": { setTimeout: async () => {} },
      "@/lib/equity-signal/universe": { loadEquityUniverse: async () => ({ snapshot: { refreshedAt: new Date().toISOString(), entries: identities.map(listing) } }) },
      "@/lib/opportunity-engine/pr262-sensor-fetch-budget": { createPr262SensorBudgetedFetch: async input => ({ fetchImpl: input.fetchImpl, flush: async () => {} }) },
    };
    // Use the actual cache/store/extractor, not a mock that invents verified counts.
    const cache = loadTsModule("@/lib/opportunity-engine/company-profile-cache", overrides);
    const builder = loadTsModule("@/lib/simple-alert-profile-builder", { ...overrides, "@/lib/opportunity-engine/company-profile-cache": cache });
    const fetcher = async url => {
      requests++;
      const index = String(url).includes("0000000001") || String(url).includes("/data/1/") ? 0 : 1;
      const identity = identities[index], fixture = fixtures[index];
      if (String(url).includes("submissions")) return Response.json({ cik: Number(identity.cik), tickers: [identity.ticker], filings: { recent: {
        form: ["10-K"], filingDate: [fixture.sourceFiledAt], accessionNumber: [`${identity.cik}-26-000001`], primaryDocument: ["annual.htm"],
      } } });
      if (index === 1) await firstVerifiedWrite;
      return new Response(`<h2>Item 1. Business</h2><p>${fixture.business}</p><p>${"The company maintains regional facilities and provides ongoing implementation support for its software. ".repeat(8)}</p>${index === 0 ? `<h3>Customers</h3><p>${fixture.customers}</p>` : ""}<h2>Item 1A. Risk Factors</h2>`);
    };
    // Keep this reporting fixture persistently unavailable at PUT so the
    // separate bounded-retry repair exhausts safely before count reconciliation.
    const result = await builder.runSimpleAlertProfileBuilder(now, fetcher);
    assert.equal(result.ok, false);
    assert.equal(result.status, "failed");
    assert.equal(result.failure, mode === "persistence_deadline" ? "Persistence time window ended" : mode === "native_transport" ? "fetch failed" : mode === "native_timeout" ? "The operation was aborted due to timeout" : "r2_state_write_http_502");
    assert.equal(result.failureCategory, "storage");
    assert.equal(result.storageFailureObserved, true);
    assert.equal(result.verifiedThisRun, 1, "Acknowledged verified work remains visible even when the later result cannot be saved");
    assert.equal(result.attempted, 2);
    assert.equal(result.requests, 4);
    assert.equal(result.requestFailures, 0, "An R2 write failure is not fabricated as a SEC request failure");
    assert.equal(result.failureRatePercent, 0);
    assert.equal(result.failureRateBasis, "source_requests_only");
    assert.equal(reconciliationReads, mode === "deadline" ? 0 : 1, "At most one post-failure count reconciliation read is made");
    assert.equal(requests, 4, "Count reconciliation never retries external source work");
    const savedSummary = [...objects.entries()].find(([key]) => key.startsWith("pilot/profile-builder/"))[1];
    assert.equal(savedSummary.leaseUntil, null);
    assert.equal(savedSummary.attemptsReserved, 2, "The same two issuer attempts remain accounted once");
    if (["available", "native_transport", "native_timeout", "alias", "persistence_deadline"].includes(mode)) {
      assert.equal(result.newlyVerifiedThisRun, 1);
      assert.equal(result.newlyVerifiedToday, 2);
      assert.equal(result.verificationCountsStatus, "cache_reconciled");
      assert.equal(result.remaining, 498);
      assert.equal(savedSummary.totalVerified, 2);
    } else {
      assert.equal(result.newlyVerifiedThisRun, null);
      assert.equal(result.newlyVerifiedToday, null);
      assert.equal(result.remaining, null);
      assert.equal(result.verificationCountsStatus, "unreconciled");
      assert.equal(result.lastReconciledNewlyVerifiedToday, 1);
      assert.ok(result.countReconciliationFailure);
      assert.equal(savedSummary.totalVerified, 1, "The last known baseline is retained, never silently raised or reset");
    }
    Date.now = originalDateNow;
    reconciliationRestored = true; persistenceController = new AbortController();
    const firstAt = objects.get(profileKey).entries.find(row => row.ticker === "ONE").firstVerifiedAt;
    const retry = await builder.runSimpleAlertProfileBuilder(new Date(), fetcher);
    assert.equal(retry.ok, true);
    assert.equal(retry.attempted, 0, "Valid first issuer and the pending issuer's persisted backoff prevent duplicate work");
    assert.equal(retry.newlyVerifiedThisRun, 0);
    assert.equal(retry.newlyVerifiedToday, 2);
    assert.equal(retry.verificationCountsStatus, "cache_reconciled");
    assert.equal(objects.get(profileKey).entries.find(row => row.ticker === "ONE").firstVerifiedAt, firstAt);
    assert.equal(requests, 4, "Later reconciliation still makes no source retries");
  }
} finally {
  Date.now = originalDateNow;
  AbortSignal.timeout = originalTimeout;
  console.info = info;
  if (savedRole === undefined) delete process.env.SWING_UP_SIMPLE_PILOT_ROLE; else process.env.SWING_UP_SIMPLE_PILOT_ROLE = savedRole;
}
console.log("Profile storage reporting: actual verified write then pending PUT502, one count reread, truthful unknowns, missing/malformed-cache rejection, source/storage separation, and idempotent later reconciliation passed.");
