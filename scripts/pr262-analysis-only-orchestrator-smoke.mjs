import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/opportunity-engine/pr262-cron-orchestrator.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

let sensorCalls = 0;
let mappingCalls = 0;
let eventCalls = 0;
let deliveryRecoveryCalls = 0;
let mappingHealthy = true;
let deliveryHealthy = true;
const state = {
  pending: [{
    id: "cloudflare:queued-1",
    priority: 95,
    ticker: "SAFE",
    source: "company_news",
    queueNextAttemptAt: null,
  }],
};
const stubs = {
  "@/lib/notifications/serious-signal-delivery": {
    deliverSeriousSignalOutbox: async () => ({ ok: true }),
    processPendingSeriousSignalDeliveries: async () => {
      deliveryRecoveryCalls += 1;
      return { ok: deliveryHealthy, jobsAttempted: 0, ...(deliveryHealthy ? {} : { error: "delivery_queue_unhealthy" }) };
    },
  },
  "@/lib/opportunity-engine/pr262-ai-daily-cost": {
    getPr262AiDailyBudgetStatus: async () => ({ allowed: true, spentUsd: 0, reservedUsd: 0, exposureUsd: 0, remainingUsd: 10, limitUsd: 10, warningUsd: 6, warning: false, hardFuseTripped: false, nextReviewReservationUsd: 0.75, reservationCheckedBeforePaidCommittee: true, activeReservations: 0, reviewsRecorded: 0, unknownUsageReviews: 0 }),
    reservePr262AiCommitteeBudget: async () => ({ allowed: true, reason: "reserved" }),
    releasePr262AiCommitteeBudgetReservation: async () => ({ released: true }),
    recordPr262AiCommitteeCostFromResultKey: async () => ({ recorded: true }),
  },
  "@/lib/opportunity-engine/pr262-company-directory": {
    enrichPr262SensorCompanyMappings: async () => {
      mappingCalls += 1;
      return mappingHealthy
        ? { mapped: 1, directoryCompanies: 1, directoryUpdatedAt: new Date().toISOString() }
        : { mapped: 0, directoryCompanies: 0, directoryUpdatedAt: null, error: "directory_unavailable" };
    },
  },
  "@/lib/opportunity-engine/pr262-change-sensor": { readPr262ChangeSensorState: async () => structuredClone(state) },
  "@/lib/opportunity-engine/pr262-event-job": {
    runPr262EventJob: async (input) => {
      eventCalls += 1;
      assert.ok(input.signal instanceof AbortSignal);
      assert.ok(input.deadlineAtMs > Date.now());
      assert.equal(typeof input.beforeOpenAiCall, "function", "Railway must pass the durable dollar reservation hook before paid analysis.");
      return { ok: true, status: "idle", eventsProcessed: 0 };
    },
  },
  "@/lib/opportunity-engine/pr262-lightweight-sensor-v3": {
    runPr262LightweightSensorV3: async () => {
      sensorCalls += 1;
      throw new Error("analysis_only_must_not_scan_sources");
    },
  },
  "@/lib/opportunity-engine/pr262-sensor-fetch-budget": {
    createPr262SensorBudgetedFetch: async () => {
      sensorCalls += 1;
      throw new Error("analysis_only_must_not_create_sensor_budget");
    },
  },
  "@/lib/opportunity-engine/pr262-serious-watch-out-authority": { promotePr262SeriousWatchOut: async () => ({ promoted: false, outboxKey: null }) },
  "@/lib/opportunity-engine/pr262-cost-effectiveness": { recordPr262CostEffectiveness: async () => ({ persisted: true }) },
};
const loaded = { exports: {} };
new Function("require", "module", "exports", output)((name) => {
  if (name in stubs) return stubs[name];
  throw new Error(`Unexpected analysis-only orchestrator import: ${name}`);
}, loaded, loaded.exports);

const result = await loaded.exports.runPr262AnalysisOnlyCycle({ maxCycleMs: 90_000 });
assert.equal(result.ok, true);
assert.equal(result.mode, "pr262_cloudflare_handoff_analysis");
assert.equal(result.sensor.skipped, true);
assert.equal(result.sensor.owner, "cloudflare_worker");
assert.equal(sensorCalls, 0);
assert.equal(mappingCalls, 1);
assert.equal(eventCalls, 1);
assert.equal(deliveryRecoveryCalls, 1);

mappingHealthy = false;
const degraded = await loaded.exports.runPr262AnalysisOnlyCycle({ maxCycleMs: 90_000 });
assert.equal(degraded.ok, false, "A failed final issuer-mapping pass must not be acknowledged as a successful analysis cycle.");
mappingHealthy = true;

deliveryHealthy = false;
const degradedDelivery = await loaded.exports.runPr262AnalysisOnlyCycle({ maxCycleMs: 90_000 });
assert.equal(degradedDelivery.ok, false, "A failed durable delivery recovery must make the analysis cycle visibly unhealthy.");
assert.equal(degradedDelivery.notifications.healthy, false);
deliveryHealthy = true;

const priorOwner = process.env.SWING_UP_PR262_SENSOR_OWNER;
process.env.SWING_UP_PR262_SENSOR_OWNER = "cloudflare_worker";
const guardedDefault = await loaded.exports.runPr262CronCycle({ maxCycleMs: 90_000 });
if (priorOwner === undefined) delete process.env.SWING_UP_PR262_SENSOR_OWNER;
else process.env.SWING_UP_PR262_SENSOR_OWNER = priorOwner;
assert.equal(guardedDefault.mode, "pr262_cloudflare_handoff_analysis");
assert.equal(sensorCalls, 0, "Cloudflare ownership must prevent duplicate Railway source scans");

console.log(JSON.stringify({
  ok: true,
  cloudflareQueueAnalyzedByRailway: true,
  localSourceSensingSkipped: true,
  finalIssuerMappingStillRuns: true,
  durableDeliveryRecoveryRunsOnIdleCycle: true,
  dualSensorOwnershipPrevented: true,
  degradedAnalysisCannotReportSuccess: true,
  degradedDeliveryCannotReportSuccess: true,
}, null, 2));
