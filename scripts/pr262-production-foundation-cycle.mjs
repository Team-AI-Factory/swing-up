import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { isApprovedPr262PremergeProductionRollout } from "./pr262-premerge-production-rollout.mjs";

const PR262_BRANCH = "agent/combined-opportunity-engine";
const PRODUCTION_STORAGE_PREFIX = "production/pr262/";
const MAX_BATCH_ROUNDS = 10;
const port = process.env.PR262_FOUNDATION_PORT || "3016";
const token = process.env.SWING_UP_PR262_FOUNDATION_RUNTIME_TOKEN?.trim()
  || crypto.randomBytes(32).toString("hex");
const baseUrl = `http://127.0.0.1:${port}`;
const branch = process.env.RAILWAY_GIT_BRANCH?.trim() || "";
const railwayEnvironment = process.env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase() || "";
const approvedPremergeRollout = isApprovedPr262PremergeProductionRollout();
if ((branch === PR262_BRANCH && !approvedPremergeRollout)
  || (branch !== PR262_BRANCH && branch !== "main" && railwayEnvironment !== "production")) {
  throw new Error("pr262_production_foundation_runtime_required");
}

const configuredStoragePrefix = process.env.SWING_UP_PR262_STORAGE_PREFIX?.trim() || PRODUCTION_STORAGE_PREFIX;
if (configuredStoragePrefix !== PRODUCTION_STORAGE_PREFIX) {
  throw new Error("pr262_production_foundation_storage_prefix_mismatch");
}

const env = {
  ...process.env,
  SWING_UP_PR262_FOUNDATION_RUNTIME_TOKEN: token,
  SWING_UP_PR262_PRODUCTION_FOUNDATION_ENABLED: "true",
  SWING_UP_PR262_STORAGE_PREFIX: PRODUCTION_STORAGE_PREFIX,
  SWING_UP_R2_WRITE_PREFIX: PRODUCTION_STORAGE_PREFIX,
  PUBLIC_LEDGER_TRACKING_ENABLED: "false",
  PUBLIC_TRACKING_ENABLED: "false",
};

// This isolated baseline job needs public market data and R2 only. It cannot
// access the application database, AI, payments, publishing, or notifications.
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
  if (!await waitForHealth(app)) throw new Error("pr262_foundation_app_health_timeout");
  for (let round = 1; round <= MAX_BATCH_ROUNDS; round += 1) {
    const response = await fetch(`${baseUrl}/api/internal/combined-opportunity-engine/production-foundation`, {
      method: "POST",
      headers: { "x-swing-up-pr262-foundation-token": token },
      signal: AbortSignal.timeout(240_000),
    });
    const raw = await response.text();
    let body;
    try { body = JSON.parse(raw); } catch { body = { raw: raw.slice(0, 2_000) }; }
    console.log(`[pr262-foundation] round=${round} status=${response.status} ${JSON.stringify(body).slice(0, 50_000)}`);
    if (!response.ok) throw new Error(`pr262_foundation_route_http_${response.status}`);
    if (body.status === "complete" || body.skipped === true) {
      exitCode = 0;
      break;
    }
  }
  if (exitCode !== 0) throw new Error("pr262_foundation_max_batch_rounds_exceeded");
} catch (error) {
  console.error(`[pr262-foundation] ${error instanceof Error ? error.message : "pr262_foundation_failed"}`);
} finally {
  stop(app);
  await Promise.race([once(app, "exit"), delay(5_000)]).catch(() => null);
  if (app.exitCode === null) stop(app, "SIGKILL");
}

process.exit(exitCode);
