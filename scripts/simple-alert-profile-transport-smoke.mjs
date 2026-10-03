import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";
import { simpleAlertCycleSummary } from "./helpers/simple-alert-cycle-summary.mjs";

const now = new Date();
const identity = { ticker: "TEST", company: "Test Software Corporation", cik: "0000000001" };
const fixture = companyProfileFixture(identity, now);
const html = `<h2>Item 1. Business</h2><p>${fixture.business}</p><p>${"The company maintains regional facilities and supports its software installations. ".repeat(8)}</p><h3>Customers</h3><p>${fixture.customers}</p><p>${fixture.business}</p><h2>Item 1A. Risk Factors</h2>`;
const objects = new Map();
let revision = 0, flushes = 0, budgetDeferred = false;
const storage = {
  readVersionedTextFromR2: async key => objects.has(key) ? { found: true, text: JSON.stringify(objects.get(key)), etag: String(revision) } : { found: false, text: null, etag: null },
  writeVersionedJsonToR2: async (key, value) => { revision++; objects.set(key, structuredClone(value)); return { written: true, conflict: false }; },
};
const overrides = {
  "@/lib/r2-warehouse": storage,
  "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => key },
  "node:timers/promises": { setTimeout: async () => {} },
  "@/lib/equity-signal/universe": { loadEquityUniverse: async () => ({ snapshot: { refreshedAt: now.toISOString(), entries: [
    { ...identity, name: identity.company, exchange: "Nasdaq", securityType: "common_stock", sourceNames: ["SEC company_tickers_exchange"] },
  ] } }) },
  "@/lib/opportunity-engine/pr262-sensor-fetch-budget": { createPr262SensorBudgetedFetch: async input => ({
    fetchImpl: async (...args) => {
      if (budgetDeferred) throw new Error("pr262_sensor_budget_guard:sec_submissions:rolling_24h_budget; next_retry_at=2099-01-01T00:00:00Z");
      return input.fetchImpl(...args);
    },
    flush: async () => { flushes++; },
  }) },
};
const builder = loadTsModule("@/lib/simple-alert-profile-builder", overrides);
const saved = { ...process.env }, originalInfo = console.info;
const submissions = { cik: 1, tickers: ["TEST"], filings: { recent: { form: ["10-K"], filingDate: [fixture.sourceFiledAt], accessionNumber: ["0000000001-26-000001"], primaryDocument: ["annual.htm"] } } };
const failedStream = error => new Response(new ReadableStream({ start(controller) { controller.error(error); } }));
try {
  Object.assign(process.env, { SWING_UP_SIMPLE_PILOT_ENABLED: "true", RAILWAY_GIT_BRANCH: "pilot-simple-alerts",
    RAILWAY_PROJECT_ID: "83d99341-d622-475f-8035-00ef3d0916d1", RAILWAY_ENVIRONMENT_ID: "87afb8d7-c4fc-4f84-92b6-5d2820a689b6",
    SWING_UP_PR262_STORAGE_PREFIX: "branch-labs/simple-alerts/", SWING_UP_R2_WRITE_PREFIX: "branch-labs/simple-alerts/", SWING_UP_SIMPLE_PILOT_ROLE: "profiles" });
  console.info = () => {};
  for (const mode of ["body_timeout", "body_transport", "headers_503", "connect_failure", "submissions_body_timeout", "missing_customers", "verified_early_cancel", "budget_deferred"]) {
    objects.clear(); budgetDeferred = mode === "budget_deferred";
    let networkAttempts = 0, cancelled = false;
    const fetcher = async url => {
      networkAttempts++;
      if (String(url).includes("submissions")) return mode === "submissions_body_timeout"
        ? failedStream(new DOMException("Synthetic source body timeout", "TimeoutError")) : Response.json(submissions);
      if (mode === "body_timeout") return failedStream(new DOMException("Synthetic source body timeout", "TimeoutError"));
      if (mode === "body_transport") return failedStream(new TypeError("Synthetic body connection failure"));
      if (mode === "connect_failure") throw new TypeError("Synthetic connection failure");
      if (mode === "headers_503") return new Response("Synthetic unavailable response", { status: 503 });
      if (mode === "missing_customers") return new Response(html.replace(fixture.customers, "No customer segments are supplied in this synthetic source."));
      let sent = false;
      return new Response(new ReadableStream({ pull(controller) {
        if (sent) return new Promise(() => {}); // A large trailing body waits until the successful reader cancels.
        sent = true; controller.enqueue(new TextEncoder().encode(html + " ".repeat(130_000)));
      }, cancel() { cancelled = true; } }));
    };
    const result = await builder.runSimpleAlertProfileBuilder(now, fetcher);
    assert.equal(result.requests, networkAttempts, "Body errors must not invent another network attempt");
    const failed = ["body_timeout", "body_transport", "headers_503", "connect_failure", "submissions_body_timeout"].includes(mode);
    const bodyFailed = ["body_timeout", "body_transport", "submissions_body_timeout"].includes(mode);
    assert.equal(result.requestFailures, failed ? 1 : 0, `Failure counted exactly once for ${mode}`);
    assert.equal(result.responseBodyFailures, bodyFailed ? 1 : 0, `Body failures distinguished for ${mode}`);
    assert.equal(result.failureRatePercent, networkAttempts ? (failed ? 1 : 0) / networkAttempts * 100 : null);
    assert.equal(result.newlyVerifiedThisRun, mode === "verified_early_cancel" ? 1 : 0);
    assert.equal(result.unverifiedThisRun, mode === "verified_early_cancel" ? 0 : 1);
    assert.equal(result.modelCalls, 0);
    if (mode === "verified_early_cancel") assert.equal(cancelled, true, "Intentional early success cancellation is not a failed request");
    const persisted = [...objects.entries()].find(([key]) => key.startsWith("pilot/profile-builder/"))?.[1];
    assert.equal(persisted.requestFailures, result.requestFailures);
    assert.equal(persisted.responseBodyFailures, result.responseBodyFailures);
    const summary = simpleAlertCycleSummary(JSON.stringify(result));
    assert.equal(summary.profileProduction.requestFailures, result.requestFailures);
    assert.equal(summary.profileProduction.responseBodyFailures, result.responseBodyFailures);
  }
  assert.equal(flushes, 8);
  console.log("Profile transport: post-header stream timeout/transport counted once, HTTP/connect errors not doubled, missing prose/cadence/early-success cancellation excluded; persistent and bounded summaries agree.");
} finally {
  console.info = originalInfo;
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
}
