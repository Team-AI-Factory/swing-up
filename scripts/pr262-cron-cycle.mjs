import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

const port = process.env.PR262_CRON_PORT || "3015";
const token = process.env.SWING_UP_PR262_SENSOR_TOKEN?.trim()
  || process.env.SWING_UP_AUTOMATION_TOKEN?.trim()
  || crypto.randomBytes(32).toString("hex");
const baseUrl = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  SWING_UP_PR262_CRON_RUNTIME_TOKEN: token,
  SWING_UP_R2_WRITE_PREFIX: "branch-labs/pr-262/",
  SWING_UP_PR262_EVENT_JOB_OPENAI_ENABLED: process.env.SWING_UP_PR262_EVENT_JOB_OPENAI_ENABLED?.trim() || "true",
  PUBLIC_LEDGER_TRACKING_ENABLED: "false",
  PUBLIC_TRACKING_ENABLED: "false",
};

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
    body: "{}",
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
