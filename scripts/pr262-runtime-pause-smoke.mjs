import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const read = (relativePath) => readFile(path.join(repositoryRoot, relativePath), "utf8");

const [railwayRaw, railwaySensorRaw, railwayRecoveryRaw, packageRaw, middleware, cronLauncher, legacySensorWorker, legacyPauseLauncher, oldSensorRoute, retiredCloudflareHandoff, deliveryTestRoute, sensorV3, historicalPolicy, watchOutAuthority, orchestrator] = await Promise.all([
  read("railway.json"),
  read("railway.sensor.json"),
  read("railway.analysis-recovery.json"),
  read("package.json"),
  read("middleware.ts"),
  read("scripts/pr262-cron-cycle.mjs"),
  read("scripts/railway-pr262-sensor-worker.mjs"),
  read("scripts/railway-pr262-cost-pause-start.mjs"),
  read("app/api/internal/combined-opportunity-engine/change-sensor/route.ts"),
  read("app/api/internal/combined-opportunity-engine/cloudflare-sensor-handoff/route.ts"),
  read("app/api/internal/combined-opportunity-engine/delivery-test/route.ts"),
  read("lib/opportunity-engine/pr262-lightweight-sensor-v3.ts"),
  read("lib/equity-signal/pilot-serious-signal-policy.ts"),
  read("lib/opportunity-engine/pr262-serious-watch-out-authority.ts"),
  read("lib/opportunity-engine/pr262-cron-orchestrator.ts"),
]);

const railway = JSON.parse(railwayRaw);
const railwaySensor = JSON.parse(railwaySensorRaw);
const railwayRecovery = JSON.parse(railwayRecoveryRaw);
const pkg = JSON.parse(packageRaw);

assert.equal(railway.build?.builder, "NIXPACKS", "The repository default must continue building the persistent website");
assert.equal(railway.deploy?.startCommand, "npx prisma migrate deploy && npm run start", "Merging PR262 must not replace the website with a cron process");
assert.equal(railway.deploy?.cronSchedule, undefined, "The persistent website must not inherit a five-minute cron schedule");
assert.equal(railway.deploy?.restartPolicyType, "ON_FAILURE", "The website must restart after an application failure");
assert.equal(railwaySensor.build?.builder, "RAILPACK", "The Railway sensor uses Railway Railpack");
assert.equal(railwaySensor.deploy?.startCommand, "npm run pr262:cron", "Railway must keep the cheap five-minute sensor active");
assert.equal(railwaySensor.deploy?.cronSchedule, "*/5 * * * *", "Railway sensing remains five-minute");
assert.equal(railwaySensor.deploy?.restartPolicyType, "NEVER", "A completed sensor cron waits for the next schedule");
assert.equal(railwayRecovery.deploy?.startCommand, "npm run pr262:analysis-cron", "Railway recovery must process the existing R2 queue without duplicating source scans");
assert.equal(railwayRecovery.deploy?.cronSchedule, "7 * * * *", "The Railway analysis cron is an hourly recovery net");
assert.equal(railwayRecovery.deploy?.restartPolicyType, "NEVER");
assert.equal(pkg.scripts?.["pr262:cron"], "node scripts/pr262-cron-cycle.mjs", "Package script must enter the bounded cron launcher");
assert.equal(pkg.scripts?.["pr262:analysis-cron"], "node scripts/pr262-cron-cycle.mjs --analysis-only", "Analysis recovery must explicitly skip local sensing");
assert.equal(pkg.scripts?.["pr262:delivery-test"], "node scripts/pr262-cron-cycle.mjs --delivery-test", "The real delivery proof must use the guarded one-cycle launcher");

assert.match(cronLauncher, /SWING_UP_PR262_CRON_RUNTIME_TOKEN/, "Cron must create or pass a short-lived internal token");
assert.match(cronLauncher, /PRODUCTION_STORAGE_PREFIX = "production\/pr262\/"/, "Production must use a clean R2 namespace");
assert.match(cronLauncher, /SWING_UP_R2_WRITE_PREFIX:\s*storagePrefix/, "Cron must fence writes to its selected PR262 namespace");
assert.match(cronLauncher, /analysisOnly \? "analysis_only" : "sensor_and_analysis"/, "The recovery service must select analysis-only mode");
assert.match(cronLauncher, /SWING_UP_PR262_SENSOR_OWNER:[\s\S]*analysisOnly \? "railway_analysis_recovery"/, "The recovery service must identify itself without claiming the source-sensor role");
assert.match(cronLauncher, /AbortSignal\.timeout\(240_000\)/, "Cron route call must have an absolute timeout shorter than the next five-minute schedule");
assert.match(cronLauncher, /SIGTERM/, "Cron must shut down the temporary web app after one cycle");
assert.match(orchestrator, /runPr262AnalysisOnlyCycle/, "The hourly Railway recovery service needs an exported analysis-only entry point");
assert.match(orchestrator, /return runPr262Cycle\("sensor_and_analysis", input\)/, "A stale Cloudflare variable must not disable the approved Railway sensor");
assert.match(orchestrator, /Pr262CycleDeadlineError/, "Railway analysis needs a hard cycle deadline");
assert.match(cronLauncher, /projectedMonthlyCostUsd > 30/, "The Railway sensor must pause when projected monthly cost exceeds $30");
assert.match(cronLauncher, /approvedPremergeRollout[\s\S]*SWING_UP_PR262_APPROVED_DELIVERY_TEST/, "The delivery proof must require the exact pre-merge production gate and a separate approval flag");
assert.match(cronLauncher, /SWING_UP_PR262_DELIVERY_TEST_RUN_ID/, "The delivery proof needs a stable run ID so an accidental second cron cannot send twice");
assert.match(cronLauncher, /delete env\.TELEGRAM_SERIOUS_SIGNAL_CHAT_ID/);
assert.match(cronLauncher, /delete env\.SWING_UP_SERIOUS_SIGNAL_WEBHOOK_URL/);

assert.match(middleware, /\/api\/health/, "Health route must remain available");
assert.match(middleware, /INTERNAL_API_PATHS\.pr262Cron/, "The scoped V3 cron route may cross the PR262 runtime boundary");
assert.match(middleware, /approvedPremergeRollout && path === INTERNAL_API_PATHS\.pr262ProductionFoundation/, "The foundation route may cross the PR boundary only under the exact pre-merge rollout gate");
assert.match(middleware, /approvedPremergeRollout && path === INTERNAL_API_PATHS\.pr262DeliveryTest/, "The delivery test may cross the PR boundary only under the exact pre-merge rollout gate");
assert.match(middleware, /INTERNAL_API_PATHS\.seriousSignalStatus/, "The protected read-only Serious Signal feed may cross the PR262 runtime boundary");
assert.match(middleware, /internalApiScopeAuthorized/, "Every protected route must use route-scoped authorization");
assert.match(middleware, /pr262_runtime_route_blocked/, "All other API routes must remain blocked");

assert.match(legacySensorWorker, /HARD PAUSED/, "The obsolete direct sensor worker must remain disabled");
assert.match(legacyPauseLauncher, /HARD PAUSED/, "The obsolete hard-pause launcher remains inert and must not be the Railway entry point");
assert.match(oldSensorRoute, /PR262_RUNTIME_HARD_PAUSED = true/, "The old public change-sensor route must remain disabled");
assert.match(retiredCloudflareHandoff, /PR262_CLOUDFLARE_HANDOFF_RETIRED = true/, "The retired Cloudflare Worker handoff must fail closed");
assert.match(deliveryTestRoute, /pr262_serious_signal_delivery_test/);
assert.match(deliveryTestRoute, /serious-signal\/delivery-test\/outbox/);
assert.match(deliveryTestRoute, /seriousSignalFeedExcluded:\s*true/);
assert.match(deliveryTestRoute, /liveWebhookDisabled:\s*true/);
assert.match(deliveryTestRoute, /duplicateSuppressed/);

const projectedCostPause = spawnSync(process.execPath, [fileURLToPath(new URL("./pr262-cron-cycle.mjs", import.meta.url))], {
  encoding: "utf8",
  env: {
    ...process.env,
    RAILWAY_GIT_BRANCH: "agent/combined-opportunity-engine",
    RAILWAY_ENVIRONMENT_NAME: "swing-up-pr-262",
    SWING_UP_PR262_PROJECTED_RAILWAY_MONTHLY_COST_USD: "30.01",
  },
  timeout: 5_000,
});
assert.equal(projectedCostPause.status, 0, "The over-budget sensor must pause successfully without triggering restart churn.");
assert.match(`${projectedCostPause.stdout ?? ""}${projectedCostPause.stderr ?? ""}`, /sensor_paused_projected_monthly_cost_usd=30\.01/);

for (const expected of [
  /fetchOfficialFeeds/,
  /fetchGdeltDiscovery/,
  /fetchMarketauxDiscovery/,
  /fetchCommerceNews/,
  /fetchAlphaNews/,
  /fetchAlphaEarningsCalendar/,
  /fetchFederalRegister/,
  /fetchOpenFdaRecalls/,
  /fetchNasdaqTradeHalts/,
  /runPr262DirectAnnouncementMonitor/,
  /market_watch/,
  /FIVE_MINUTES_MS/,
  /FIFTEEN_MINUTES_MS/,
]) assert.match(sensorV3, expected, `V3 sensor is missing ${expected}`);

assert.match(historicalPolicy, /historicalCasesRequiredForSeriousSignal:\s*false/, "Historical cases must not gate Serious Signals");
assert.match(historicalPolicy, /passed:\s*true/, "Compatibility history gate must remain non-blocking");
assert.match(watchOutAuthority, /pr262_committee_verified_serious_watch_out/, "Serious Watch Out must have a committee-verified outbox path");
assert.match(watchOutAuthority, /committee\.agentsCompleted\s*===\s*14/, "Serious Watch Out must require all 14 committee roles");
assert.match(watchOutAuthority, /committee\.agentsFailed\s*===\s*0/, "Serious Watch Out must reject incomplete committee runs");
assert.match(watchOutAuthority, /judge\.verdict\s*===\s*"positive"/, "Serious Watch Out must require a positive Final Judge");

console.log("PR #262 runtime recovery smoke passed: website default restored, Railway owns cheap five-minute sensing, hourly Railway recovery is separated, quiet scans avoid full R2 rewrites, the production namespace is fenced, legacy scanners are blocked, and Serious Watch Out authority is protected.");
