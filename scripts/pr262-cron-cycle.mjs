import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import {
  isApprovedPr262PremergeProductionRollout,
} from "./pr262-premerge-production-rollout.mjs";

const PR262_BRANCH = "agent/combined-opportunity-engine";
const PREVIEW_STORAGE_PREFIX = "branch-labs/pr-262/";
const PRODUCTION_STORAGE_PREFIX = "production/pr262/";
const analysisOnly = process.argv.includes("--analysis-only");
const deliveryTest = process.argv.includes("--delivery-test")
  || process.env.SWING_UP_PR262_RUN_DELIVERY_TEST_ONCE?.trim().toLowerCase() === "true";
if (analysisOnly && deliveryTest) throw new Error("pr262_cron_mode_conflict");
const port = process.env.PR262_CRON_PORT || "3015";
const cronToken = process.env.SWING_UP_PR262_CRON_RUNTIME_TOKEN?.trim()
  || crypto.randomBytes(32).toString("hex");
const deliveryTestToken = process.env.SWING_UP_PR262_DELIVERY_TEST_RUNTIME_TOKEN?.trim()
  || crypto.randomBytes(32).toString("hex");
const deliveryTestRunId = process.env.SWING_UP_PR262_DELIVERY_TEST_RUN_ID?.trim() || "";
const baseUrl = `http://127.0.0.1:${port}`;
const branch = (process.env.RAILWAY_GIT_BRANCH || "").trim();
const railwayEnvironment = (process.env.RAILWAY_ENVIRONMENT_NAME || "").trim().toLowerCase();
const approvedPremergeRollout = isApprovedPr262PremergeProductionRollout();
if (deliveryTest && (!approvedPremergeRollout
  || process.env.SWING_UP_PR262_APPROVED_DELIVERY_TEST?.trim().toLowerCase() !== "true"
  || !/^[a-z0-9][a-z0-9-]{11,63}$/i.test(deliveryTestRunId))) {
  throw new Error("pr262_delivery_test_not_approved");
}
const production = approvedPremergeRollout || branch === "main" || railwayEnvironment === "production";
const preview = !production;
const configuredStoragePrefix = (process.env.SWING_UP_PR262_STORAGE_PREFIX || "").trim();
const storagePrefix = configuredStoragePrefix || (production ? PRODUCTION_STORAGE_PREFIX : PREVIEW_STORAGE_PREFIX);
if (storagePrefix.startsWith("/")
  || !storagePrefix.endsWith("/")
  || storagePrefix.includes("\\")
  || storagePrefix.slice(0, -1).split("/").some((part) => !part || part === "." || part === "..")) {
  throw new Error("pr262_cron_storage_prefix_invalid");
}
if (preview && storagePrefix !== PREVIEW_STORAGE_PREFIX) throw new Error("pr262_cron_preview_storage_prefix_mismatch");
if (production && storagePrefix.startsWith("branch-labs/")) throw new Error("pr262_cron_production_storage_prefix_is_branch_data");
if (production && storagePrefix !== PRODUCTION_STORAGE_PREFIX) throw new Error("pr262_cron_production_storage_prefix_mismatch");

// Railway can instantiate this config for every pull-request environment. Only
// the dedicated PR262 branch lab may run a real preview scan; all other PR
// previews must build successfully without polling providers, touching the
// queue, or retaining any path to production notifications.
if (preview && branch !== PR262_BRANCH) {
  console.log(`[pr262-cron] preview_runtime_skipped branch=${branch || "unknown"} reason=non_pr262_branch`);
  process.exit(0);
}

const projectedMonthlyCostUsd = Number(process.env.SWING_UP_PR262_PROJECTED_RAILWAY_MONTHLY_COST_USD);
if (!deliveryTest && Number.isFinite(projectedMonthlyCostUsd) && projectedMonthlyCostUsd > 30) {
  const pausedRole = analysisOnly ? "analysis_recovery" : "sensor";
  console.log(`[pr262-cron] ${pausedRole}_paused_projected_monthly_cost_usd=${projectedMonthlyCostUsd.toFixed(2)} hard_limit_usd=30`);
  process.exit(0);
}
const env = {
  ...process.env,
  SWING_UP_PR262_CRON_RUNTIME_TOKEN: cronToken,
  SWING_UP_PR262_DELIVERY_TEST_RUNTIME_TOKEN: deliveryTestToken,
  SWING_UP_PR262_DELIVERY_TEST_RUN_ID: deliveryTestRunId,
  SWING_UP_PR262_STORAGE_PREFIX: storagePrefix,
  SWING_UP_R2_WRITE_PREFIX: storagePrefix,
  SWING_UP_PR262_SENSOR_OWNER: deliveryTest
    ? "railway_delivery_test"
    : analysisOnly ? "railway_analysis_recovery" : "railway",
  SWING_UP_PR262_EVENT_JOB_OPENAI_ENABLED: process.env.SWING_UP_PR262_EVENT_JOB_OPENAI_ENABLED?.trim() || "true",
  PUBLIC_LEDGER_TRACKING_ENABLED: "false",
  PUBLIC_TRACKING_ENABLED: "false",
};

// The sensor never needs the production database, payments, or AWS credentials.
for (const key of [
  "DATABASE_URL",
  "DIRECT_URL",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
]) delete env[key];

// FMP's free/individual entitlement must never silently become a production
// dependency. Production use is enabled only after an explicit commercial-use
// approval flag is configured for the dedicated sensor service.
if ((env.FMP_COMMERCIAL_USE_APPROVED || "").trim().toLowerCase() !== "true") {
  delete env.FMP_API_KEY;
  delete env.FMP_BASE_URL;
}

// The isolated PR preview must never notify anyone. On production/main the
// dedicated sensor service may retain notification credentials so only a
// committee-verified outbox item can be delivered by the notification consumer.
if (preview) {
  for (const key of [
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_TEST_CHAT_ID",
    "TELEGRAM_SERIOUS_SIGNAL_CHAT_ID",
    "SWING_UP_SERIOUS_SIGNAL_WEBHOOK_URL",
  ]) delete env[key];
}

// A delivery proof may reach only the configured Telegram test chat. The live
// destination and production webhook are removed from the child process even
// though the delivery library also rejects them for a test-only outbox.
if (deliveryTest) {
  delete env.TELEGRAM_SERIOUS_SIGNAL_CHAT_ID;
  delete env.SWING_UP_SERIOUS_SIGNAL_WEBHOOK_URL;
}

function stop(child, signal = "SIGTERM") {
  if (child && !child.killed) child.kill(signal);
}

async function waitForHealth(child) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false;
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return true;
    } catch {}
    await delay(750);
  }
  return false;
}

const app = spawn("npm", ["run", "start", "--", "--hostname", "127.0.0.1", "--port", port], {
  env,
  stdio: ["ignore", "inherit", "inherit"],
});

let exitCode = 1;
try {
  if (!await waitForHealth(app)) throw new Error("pr262_cron_app_health_timeout");
  const routePath = deliveryTest
    ? "/api/internal/combined-opportunity-engine/delivery-test"
    : "/api/internal/combined-opportunity-engine/cron-v3";
  const response = await fetch(`${baseUrl}${routePath}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(deliveryTest
        ? { "x-swing-up-pr262-delivery-test-token": deliveryTestToken }
        : { "x-swing-up-pr262-cron-token": cronToken }),
    },
    body: JSON.stringify(deliveryTest
      ? { confirmDeliveryTest: true }
      : { mode: analysisOnly ? "analysis_only" : "sensor_and_analysis" }),
    signal: AbortSignal.timeout(240_000),
  });
  const body = await response.text();
  console.log(`[pr262-cron] mode=${deliveryTest ? "delivery_test" : analysisOnly ? "analysis_only" : "sensor_and_analysis"} status=${response.status} ${body.slice(0, 50_000)}`);
  if (!response.ok) throw new Error(`pr262_cron_route_http_${response.status}`);
  exitCode = 0;
} catch (error) {
  console.error(`[pr262-cron] ${error instanceof Error ? error.message : "pr262_cron_failed"}`);
} finally {
  stop(app);
  await Promise.race([once(app, "exit"), delay(5_000)]).catch(() => null);
  if (app.exitCode === null) stop(app, "SIGKILL");
}

process.exit(exitCode);
