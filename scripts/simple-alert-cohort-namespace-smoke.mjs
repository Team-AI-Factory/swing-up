import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
const base = "branch-labs/simple-alerts/";
const environment = {
  SWING_UP_SIMPLE_PILOT_ENABLED: "true", RAILWAY_GIT_BRANCH: "pilot-simple-alerts",
  RAILWAY_PROJECT_ID: "83d99341-d622-475f-8035-00ef3d0916d1", RAILWAY_ENVIRONMENT_ID: "87afb8d7-c4fc-4f84-92b6-5d2820a689b6",
  SWING_UP_PR262_STORAGE_PREFIX: base, SWING_UP_R2_WRITE_PREFIX: base,
};
const moduleFor = config => loadTsModule("@/lib/opportunity-engine/pr262-storage", { "@/config/simple-alert-pilot.json": config });
const legacy = moduleFor({});
const first = moduleFor({ cohortId: "ai-small-25-20261003-v1" });
const next = moduleFor({ cohortId: "ai-small-25-20261003-v2" });
for (const relative of ["sensor/state-v1.json", "sensor/cadence-v1.json", "event-job/runtime/lease-v1.json", "event-job/runs/2026-10-03/example.json", "serious-signal/delivery-v2/feed-index-v1.json", "metrics/cost-effectiveness/2026-10-03.json", "serious-signal/delivery-test/outbox/test-only.json"]) {
  assert.equal(legacy.pr262StorageKey(relative, environment), `${base}${relative}`);
  assert.equal(first.pr262StorageKey(relative, environment), `${base}cohorts/ai-small-25-20261003-v1/${relative}`);
  assert.notEqual(first.pr262StorageKey(relative, environment), next.pr262StorageKey(relative, environment));
}
for (const relative of ["serious-signal/ai-cost-v1.json", "sensor/provider-budgets-v1.json", "event-job/runtime/provider-budgets-v1.json", "research-evidence/company-profiles-v1.json", "research-evidence/company-profile-sources/0000000001/source.json", "equity-universe/v1.json", "value-investing/resumable/state.json"]) {
  for (const storage of [legacy, first, next]) assert.equal(storage.pr262StorageKey(relative, environment), `production/pr262/${relative}`);
}
for (const storage of [legacy, first, next]) {
  assert.equal(storage.pr262StorageKey("event-job/runtime/committee-budgets-v1.json", environment), `${base}event-job/runtime/committee-budgets-v1.json`, "Cohort replacement cannot reset the review-count cap or same-evidence cooldown");
  assert.equal(storage.pr262StorageKey("pilot/profile-builder/2026-10-03.json", environment), `${base}pilot/profile-builder/2026-10-03.json`, "Changing cohort must not create a fresh daily profile allowance or lease");
  assert.equal(storage.pr262StorageKey("sensor/state-v1.json", { RAILWAY_GIT_BRANCH: "main" }), "production/pr262/sensor/state-v1.json");
  assert.equal(storage.resolvePr262StoragePrefix(environment), base, "The existing narrow runtime/write-fence attestation is unchanged");
}
const ids = loadTsModule("@/lib/simple-alert-pilot-cohort");
assert.equal(ids.pilotCohortId({}), "legacy-25-20260928");
for (const cohortId of ["../outside", "has/slash", "", "bad id", 42]) assert.throws(() => ids.pilotCohortId({ cohortId }), /cohort_id_invalid/);
console.log("Cohort queues, audits, feeds and metrics isolated; shared money, sources, profiles and daily profile lease unchanged; legacy objects preserved.");
