import crypto from "node:crypto";
import { applySimpleAlertModelPolicy } from "./helpers/simple-alert-model-policy.mjs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { simpleAlertCycleSummary } from "./helpers/simple-alert-cycle-summary.mjs";

const profileOnly = process.argv.includes("--profiles-only");
const prefix = "branch-labs/simple-alerts/";
const required = {
  SWING_UP_SIMPLE_PILOT_ENABLED: "true",
  RAILWAY_GIT_BRANCH: "pilot-simple-alerts",
  RAILWAY_PROJECT_ID: "83d99341-d622-475f-8035-00ef3d0916d1",
  RAILWAY_ENVIRONMENT_ID: "87afb8d7-c4fc-4f84-92b6-5d2820a689b6",
  SWING_UP_PR262_STORAGE_PREFIX: prefix,
  SWING_UP_R2_WRITE_PREFIX: prefix,
  SWING_UP_SIMPLE_PILOT_ROLE: profileOnly ? "profiles" : "sensor",
};
for (const [key, value] of Object.entries(required)) {
  if (process.env[key] !== value) throw new Error(`simple_pilot_runtime_mismatch:${key}`);
}
const projected = Number(process.env.SWING_UP_PR262_PROJECTED_RAILWAY_MONTHLY_COST_USD);
if (!Number.isFinite(projected) || projected <= 0 || projected > 20) throw new Error("simple_pilot_infrastructure_forecast_missing_or_above_20");
const port = "3015", token = crypto.randomBytes(32).toString("hex");
const env = { ...process.env, SWING_UP_PR262_CRON_RUNTIME_TOKEN: token,
  SWING_UP_PR262_AI_DAILY_LIMIT_USD: "10", SWING_UP_PR262_AI_DAILY_WARNING_USD: "6",
  PUBLIC_TRACKING_ENABLED: "false", PUBLIC_LEDGER_TRACKING_ENABLED: "false",
  SWING_UP_PR262_EXTERNAL_NOTIFICATIONS_ENABLED: "false", SWING_UP_PR262_DELIVERY_TEST_EXTERNAL_ENABLED: "false",
};
for (const key of ["DATABASE_URL", "DIRECT_URL", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
  "TELEGRAM_BOT_TOKEN", "TELEGRAM_TEST_CHAT_ID", "TELEGRAM_SERIOUS_SIGNAL_CHAT_ID", "SWING_UP_SERIOUS_SIGNAL_WEBHOOK_URL"]) delete env[key];
if (env.FMP_COMMERCIAL_USE_APPROVED !== "true") delete env.FMP_API_KEY;
if (profileOnly) {
  delete env.OPENAI_API_KEY;
  delete env.OPENAI_ADMIN_KEY;
  env.AI_COMMITTEE_ENABLED = "false";
  env.SWING_UP_PR262_EVENT_JOB_OPENAI_ENABLED = "false";
} else if (env.AI_COMMITTEE_ENABLED !== "true" || env.SWING_UP_PR262_EVENT_JOB_OPENAI_ENABLED !== "true") {
  throw new Error("simple_pilot_committee_must_be_enabled");
} else {
  Object.assign(env, applySimpleAlertModelPolicy(env));
}
// These credentials exist only inside this loopback-bound worker process.
// Tests have a stable commit-scoped identity and are excluded from live feeds.
const deliveryTestToken = crypto.randomBytes(32).toString("hex");
if (!profileOnly) {
  const commit = process.env.RAILWAY_GIT_COMMIT_SHA ?? "";
  if (!/^[a-f0-9]{40}$/i.test(commit)) throw new Error("simple_pilot_delivery_control_commit_missing");
  env.SWING_UP_PR262_APPROVED_DELIVERY_TEST = "true";
  env.SWING_UP_PR262_DELIVERY_TEST_RUNTIME_TOKEN = deliveryTestToken;
  env.SWING_UP_PR262_DELIVERY_TEST_RUN_ID = `pilot-${commit.toLowerCase()}`;
}
const app = spawn("npm", ["run", "start", "--", "--hostname", "127.0.0.1", "--port", port], { env, stdio: "inherit", detached: true });
const base = `http://127.0.0.1:${port}`;
// Hard-stop the entire worker well before its next 15-minute schedule. This
// bounds exceptional cleanup hangs without changing source or paid-AI limits.
const watchdog = setTimeout(() => {
  console.error("simple_pilot_worker_deadline_exceeded");
  try { process.kill(-app.pid, "SIGKILL"); } catch {}
  process.exit(1);
}, profileOnly ? 300_000 : 660_000);
watchdog.unref();
let code = 1;
try {
  let ready = false;
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline && app.exitCode === null) {
    try { ready = (await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) })).ok; } catch {}
    if (ready) break;
    await delay(500);
  }
  if (!ready) throw new Error("simple_pilot_health_timeout");
  if (!profileOnly) {
    const control = await fetch(`${base}/api/internal/combined-opportunity-engine/delivery-test`, {
      method: "POST", headers: { "content-type": "application/json", "x-swing-up-pr262-delivery-test-token": deliveryTestToken },
      body: JSON.stringify({ confirmDeliveryTest: true }), signal: AbortSignal.timeout(60_000),
    });
    const result = await control.json();
    console.log(`[simple-alerts-delivery-controls] ${JSON.stringify(result)}`);
    if (!control.ok || result.ok !== true || result.testOnly !== true || result.receiptVerified !== true
      || result.negativeControlPassed !== true || result.duplicateSuppressed !== true || result.seriousSignalFeedExcluded !== true) {
      throw new Error("simple_pilot_delivery_controls_failed");
    }
  }
  const response = await fetch(`${base}/api/internal/combined-opportunity-engine/cron-v3`, {
    method: "POST", headers: { "content-type": "application/json", "x-swing-up-pr262-cron-token": token },
    body: JSON.stringify({ mode: profileOnly ? "profiles_only" : "sensor_and_analysis" }), signal: AbortSignal.timeout(profileOnly ? 240_000 : 520_000),
  });
  const body = await response.text();
  console.log(`[simple-alerts-summary] ${JSON.stringify(simpleAlertCycleSummary(body))}`);
  console.log(`[simple-alerts] role=${profileOnly ? "profiles" : "sensor"} http=${response.status} ${body.slice(0, 80000)}`);
  if (!response.ok) throw new Error(`simple_pilot_cycle_http_${response.status}`);
  code = 0;
} catch (error) { console.error(error instanceof Error ? error.message : "simple_pilot_failed"); }
finally {
  clearTimeout(watchdog);
  try { process.kill(-app.pid, "SIGTERM"); } catch {}
  await Promise.race([once(app, "exit"), delay(3000)]).catch(() => null);
  try { process.kill(-app.pid, "SIGKILL"); } catch {}
}
process.exit(code);
