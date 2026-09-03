import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

const PRODUCTION_PREFIX = "production/pr262/";
const CONFIRMATION = "REMOVE_STALE_OR_LOW_VALUE_COMPANY_NEWS_KEEP_AUTHORITY_V1";
const port = process.env.PR262_QUEUE_RESET_PORT || "3017";
const token = crypto.randomBytes(32).toString("hex");
const baseUrl = `http://127.0.0.1:${port}`;

if (process.env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase() !== "production"
  || process.env.SWING_UP_PR262_STORAGE_PREFIX?.trim() !== PRODUCTION_PREFIX
  || process.env.SWING_UP_R2_WRITE_PREFIX?.trim() !== PRODUCTION_PREFIX) {
  throw new Error("pr262_queue_reset_production_scope_required");
}

const env = {
  ...process.env,
  SWING_UP_AUTOMATION_TOKEN: token,
  SWING_UP_PR262_QUEUE_RESET_ENABLED: "true",
  SWING_UP_PR262_STORAGE_PREFIX: PRODUCTION_PREFIX,
  SWING_UP_R2_WRITE_PREFIX: PRODUCTION_PREFIX,
  PUBLIC_LEDGER_TRACKING_ENABLED: "false",
  PUBLIC_TRACKING_ENABLED: "false",
};

for (const key of [
  "DATABASE_URL",
  "DIRECT_URL",
  "OPENAI_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_TEST_CHAT_ID",
  "TELEGRAM_SERIOUS_SIGNAL_CHAT_ID",
  "SWING_UP_SERIOUS_SIGNAL_WEBHOOK_URL",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
]) delete env[key];

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
  if (!await waitForHealth(app)) throw new Error("pr262_queue_reset_app_health_timeout");
  const response = await fetch(`${baseUrl}/api/internal/combined-opportunity-engine/queue-reset`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-swing-up-automation-token": token,
    },
    body: JSON.stringify({ confirmation: CONFIRMATION }),
    signal: AbortSignal.timeout(120_000),
  });
  const raw = await response.text();
  let body;
  try { body = JSON.parse(raw); } catch { body = { raw: raw.slice(0, 2_000) }; }
  console.log(`[pr262-queue-reset] status=${response.status} ${JSON.stringify(body).slice(0, 20_000)}`);
  const countsReconcile = Number.isInteger(body.originalPendingCount)
    && Number.isInteger(body.removedCount)
    && Number.isInteger(body.retainedCount)
    && body.originalPendingCount === body.removedCount + body.retainedCount
    && body.pendingCount === body.retainedCount;
  if (!response.ok
    || body.ok !== true
    || body.mode !== "pr262_selective_pending_queue_cleanup"
    || !countsReconcile
    || body.preservedSeen !== true
    || body.preservedDiscovery !== true
    || body.preservedAllOtherState !== true
    || body.removedOnlyDisposableCompanyNews !== true
    || body.authoritativeAndDirectIssuerEventsAlwaysRetained !== true) {
    throw new Error(`pr262_queue_reset_route_http_${response.status}`);
  }
  exitCode = 0;
} catch (error) {
  console.error(`[pr262-queue-reset] ${error instanceof Error ? error.message : "pr262_queue_reset_failed"}`);
} finally {
  stop(app);
  await Promise.race([once(app, "exit"), delay(5_000)]).catch(() => null);
  if (app.exitCode === null) stop(app, "SIGKILL");
}

process.exit(exitCode);
