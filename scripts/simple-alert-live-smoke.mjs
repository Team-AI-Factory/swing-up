import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";

const environment = {
  SWING_UP_SIMPLE_PILOT_ENABLED: "true", RAILWAY_GIT_BRANCH: "pilot-simple-alerts",
  RAILWAY_PROJECT_ID: "83d99341-d622-475f-8035-00ef3d0916d1",
  RAILWAY_ENVIRONMENT_ID: "87afb8d7-c4fc-4f84-92b6-5d2820a689b6",
  SWING_UP_PR262_STORAGE_PREFIX: "branch-labs/simple-alerts/", SWING_UP_R2_WRITE_PREFIX: "branch-labs/simple-alerts/",
};
const savedEnvironment = { ...process.env };
Object.assign(process.env, environment);
try {
  const runtime = loadTsModule("@/lib/simple-alert-pilot-runtime");
  const storage = loadTsModule("@/lib/opportunity-engine/pr262-storage");
  assert.equal(runtime.isSimpleAlertPilot(), true);
  for (const key of Object.keys(environment)) assert.equal(runtime.isSimpleAlertPilot({ ...environment, [key]: "wrong" }), false);
  assert.equal(storage.pr262StorageKey("sensor/state-v1.json"), "branch-labs/simple-alerts/sensor/state-v1.json");
  assert.equal(storage.pr262StorageKey("serious-signal/ai-cost-v1.json"), "production/pr262/serious-signal/ai-cost-v1.json");
  assert.equal(storage.pr262StorageKey("serious-signal/outbox/event-job"), "branch-labs/simple-alerts/serious-signal/outbox/event-job");
  assert.equal(storage.pr262StorageKey("value-investing/resumable/state.json"), "production/pr262/value-investing/resumable/state.json");
  const r2 = loadTsModule("@/lib/r2-warehouse", { "@/lib/db/client": { prisma: {} } });
  assert.doesNotThrow(() => r2.assertR2MutationKeyAllowed("PUT", "production/pr262/serious-signal/ai-cost-v1.json"));
  for (const key of ["production/pr262/sensor/state-v1.json", "production/pr262/value-investing/resumable/state.json", "production/pr262/serious-signal/outbox/event-job/a.json", "production/pr262/serious-signal/ai-cost-v1.json/evil"]) {
    assert.throws(() => r2.assertR2MutationKeyAllowed("PUT", key), /outside_write_prefix/);
  }
  assert.throws(() => r2.assertR2MutationKeyAllowed("DELETE", "production/pr262/serious-signal/ai-cost-v1.json"), /outside_write_prefix/);
  assert.throws(() => storage.pr262StorageKey("../production/pr262/sensor/state-v1.json"), /invalid/);
  const scope = loadTsModule("@/lib/simple-alert-pilot-scope");
  assert.equal(scope.pilotCompanies().length, 25);
  assert.equal(scope.pilotIncludes({ ticker: "AAPL", cik: "320193" }), true);
  assert.equal(scope.pilotIncludes({ ticker: "AAPL", cik: "1" }), false);
  assert.equal(scope.pilotIncludes({ ticker: "OUTSIDE" }), false);
  assert.equal(scope.pilotIncludes({ ticker: null }), false);
  assert.equal(scope.pilotSourceEnabled("sec_broad"), true);
  assert.equal(scope.pilotSourceEnabled("gdelt"), false);

  const now = new Date("2026-09-28T10:00:00Z");
  const identity = { ticker: "TEST", company: "Test Software", cik: "0000000001" };
  const fixture = companyProfileFixture(identity, now);
  const io = { readVersionedTextFromR2: async () => { throw new Error("unexpected_io"); }, writeVersionedJsonToR2: async () => { throw new Error("unexpected_io"); } };
  const builder = loadTsModule("@/lib/simple-alert-profile-builder", { "@/lib/r2-warehouse": io });
  const listing = { ...identity, name: identity.company, sourceNames: ["SEC company_tickers_exchange"] };
  const completed = { ...identity, profile: fixture, firstVerifiedAt: now.toISOString() };
  assert.equal(builder.profileBatchPlan([listing], [completed], now, 100).newlyVerifiedToday, 1);
  assert.equal(builder.profileBatchPlan([listing], [completed], now, 100).due.length, 0);
  assert.equal(builder.profileBatchPlan([listing], [{ ...completed, profile: null }], now, 100).newlyVerifiedToday, 0);
  assert.equal(builder.profileBatchPlan([listing], [{ ...completed, profile: null, nextAttemptAt: "2026-09-29T00:00:00Z" }], now, 100).due.length, 0);
  assert.equal(builder.profileBatchPlan([listing, listing], [], now, 100).due.length, 1);
  assert.equal(builder.profileBatchPlan([{ ...listing, sourceNames: [] }], [], now, 100).due.length, 0);
  const atLimit = Array.from({ length: 500 }, (_, index) => {
    const row = { ticker: `T${index}`, cik: String(index + 10).padStart(10, "0"), company: `Test Software ${index}` };
    return { ...row, profile: companyProfileFixture(row, now), firstVerifiedAt: now.toISOString() };
  });
  assert.equal(builder.profileBatchPlan([listing], atLimit, now, 100).due.length, 0);
  await assert.rejects(() => builder.runSimpleAlertProfileBuilder(now), /profile_role_required/);
  // The launcher must stop before it starts a web process on main or a PR preview.
  const launch = spawnSync(process.execPath, ["scripts/simple-alert-pilot-cycle.mjs"], {
    env: { ...process.env, RAILWAY_GIT_BRANCH: "main" }, encoding: "utf8", timeout: 5000,
  });
  assert.notEqual(launch.status, 0);
  assert.match(launch.stderr, /runtime_mismatch:RAILWAY_GIT_BRANCH/);
  const source = readFileSync("scripts/simple-alert-pilot-cycle.mjs", "utf8");
  assert.match(source, /delete env\.OPENAI_API_KEY/);
  assert.match(source, /projected > 20/);
  console.log("Simple Alerts: 25-name isolation, shared $10 ledger, main mutation denial, first-verification target, pacing/role boundary and main launcher refusal passed.");
} finally {
  for (const key of Object.keys(process.env)) if (!(key in savedEnvironment)) delete process.env[key];
  Object.assign(process.env, savedEnvironment);
}
