import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

const PR262_BRANCH = "agent/combined-opportunity-engine";
const PREVIEW_STORAGE_PREFIX = "branch-labs/pr-262/";
const PRODUCTION_STORAGE_PREFIX = "production/pr262/";
const analysisOnly = process.argv.includes("--analysis-only");
const port = process.env.PR262_CRON_PORT || "3015";
const token = process.env.SWING_UP_PR262_CRON_RUNTIME_TOKEN?.trim()
  || crypto.randomBytes(32).toString("hex");
const baseUrl = `http://127.0.0.1:${port}`;
const branch = (process.env.RAILWAY_GIT_BRANCH || "").trim();
const railwayEnvironment = (process.env.RAILWAY_ENVIRONMENT_NAME || "").trim().toLowerCase();
const preview = branch === PR262_BRANCH;
const production = !preview && (branch === "main" || railwayEnvironment === "production");
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
const env = {
  ...process.env,
  SWING_UP_PR262_CRON_RUNTIME_TOKEN: token,
  SWING_UP_PR262_STORAGE_PREFIX: storagePrefix,
  SWING_UP_R2_WRITE_PREFIX: storagePrefix,
  SWING_UP_PR262_SENSOR_OWNER: analysisOnly ? "cloudflare_worker" : (process.env.SWING_UP_PR262_SENSOR_OWNER?.trim() || "railway"),
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
if ((process.env.RAILWAY_GIT_BRANCH || "").trim() === PR262_BRANCH) {
  for (const key of [
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_TEST_CHAT_ID",
    "TELEGRAM_SERIOUS_SIGNAL_CHAT_ID",
    "SWING_UP_SERIOUS_SIGNAL_WEBHOOK_URL",
  ]) delete env[key];
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
  const response = await fetch(`${baseUrl}/api/internal/combined-opportunity-engine/cron-v3`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-swing-up-pr262-cron-token": token,
    },
    body: JSON.stringify({ mode: analysisOnly ? "analysis_only" : "sensor_and_analysis" }),
    signal: AbortSignal.timeout(240_000),
  });
  const body = await response.text();
  console.log(`[pr262-cron] status=${response.status} ${body.slice(0, 50_000)}`);
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
