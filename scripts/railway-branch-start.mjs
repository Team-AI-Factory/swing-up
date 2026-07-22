import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";

const LAB_BRANCH = "agent/live-signal-evaluation-automation";
const branch = (process.env.RAILWAY_GIT_BRANCH || "").trim();
const environment = (process.env.RAILWAY_ENVIRONMENT_NAME || "").trim().toLowerCase();
const branchLab = Boolean(process.env.RAILWAY_PROJECT_ID && branch === LAB_BRANCH && environment && environment !== "production");
const runtimeToken = crypto.randomBytes(32).toString("hex");
const port = process.env.PORT || "3000";
function intervalMs(raw, fallbackSeconds, maximumMs) {
  const seconds = Number(raw || fallbackSeconds);
  return Number.isFinite(seconds) ? Math.max(60_000, Math.min(maximumMs, seconds * 1000)) : fallbackSeconds * 1000;
}
const normalPollMs = intervalMs(process.env.SWING_UP_BRANCH_LAB_INTERVAL_SECONDS, 300, 3_600_000);
const technicalRetryMs = intervalMs(process.env.SWING_UP_BRANCH_LAB_TECHNICAL_RETRY_SECONDS, 60, normalPollMs);
let child = null;

function isolatedBranchEnvironment() {
  const env = {
    ...process.env,
    SWING_UP_BRANCH_LAB_RUNTIME_TOKEN: runtimeToken,
    SWING_UP_TEST_MODE: "true",
    AI_COMMITTEE_ENABLED: "true",
    AI_COMMITTEE_AUTONOMOUS: "true",
    AI_COMMITTEE_DRY_RUN_DEFAULT: "false",
    OPENAI_MODEL: "gpt-4.1-mini-2025-04-14",
    AI_COMMITTEE_FAST_MODEL: "gpt-4.1-mini-2025-04-14",
    AI_COMMITTEE_DEEP_MODEL: "gpt-4.1-mini-2025-04-14",
    AI_COMMITTEE_FINAL_MODEL: "gpt-4.1-mini-2025-04-14",
    AI_COMMITTEE_MODEL_ALLOWLIST: "gpt-4.1-mini-2025-04-14",
    AI_COMMITTEE_REQUEST_TIMEOUT_MS: "12000",
    PUBLIC_LEDGER_TRACKING_ENABLED: "false",
    PUBLIC_TRACKING_ENABLED: "false",
  };
  for (const key of [
    "DATABASE_URL", "DIRECT_URL", "TELEGRAM_BOT_TOKEN", "TELEGRAM_TEST_CHAT_ID",
    "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
    "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "POLYGON_API_KEY", "BENZINGA_API_KEY",
  ]) delete env[key];
  return env;
}

function launch(command, args, env = process.env) {
  return spawn(command, args, { stdio: "inherit", env });
}

if (!branchLab) {
  console.log("[swing-up-start] applying normal database migrations before application start.");
  const migration = launch("npx", ["prisma", "migrate", "deploy"]);
  const [migrationCode] = await once(migration, "exit");
  if (migrationCode !== 0) process.exit(Number(migrationCode) || 1);
} else {
  console.log("[swing-up-branch-lab] database migrations skipped for isolated branch preview.");
}

child = launch("npm", ["run", "start", "--", "--hostname", "0.0.0.0", "--port", port], branchLab ? isolatedBranchEnvironment() : process.env);

function stop(signal) {
  if (child && !child.killed) child.kill(signal);
}
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));

async function waitForHealth() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) return true;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return false;
}

async function runLab() {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/internal/railway-branch-signal-lab`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-swing-up-branch-lab-token": runtimeToken },
      body: "{}",
      signal: AbortSignal.timeout(240_000),
    });
    const text = await response.text();
    let report = null;
    try { report = JSON.parse(text); } catch {}
    console.log(`[swing-up-branch-lab] status=${response.status} ${text.slice(0, 12000)}`);
    if (response.status === 409 || report?.stopped === true) return { keepRunning: false, delayMs: normalPollMs };
    const technicalFailure = !response.ok || (report?.status === "technical_failure" && report?.repairEligible === true);
    return { keepRunning: true, delayMs: technicalFailure ? technicalRetryMs : normalPollMs };
  } catch (error) {
    console.error(`[swing-up-branch-lab] ${error instanceof Error ? error.message : "run_failed"}`);
    return { keepRunning: true, delayMs: technicalRetryMs };
  }
}

if (branchLab) {
  console.log(`[swing-up-branch-lab] enabled for ${branch} in ${environment}; live polling=${Math.round(normalPollMs / 1000)}s, technical retry=${Math.round(technicalRetryMs / 1000)}s; branch state uses isolated Cloudflare R2 while PostgreSQL, production publishing, and notifications remain disabled.`);
  void (async () => {
    if (!(await waitForHealth())) {
      console.error("[swing-up-branch-lab] app health timeout; no experiment ran.");
      return;
    }
    let next = await runLab();
    while (next.keepRunning && child && !child.killed) {
      await new Promise((resolve) => setTimeout(resolve, next.delayMs));
      next = await runLab();
    }
  })();
} else {
  console.log("[swing-up-branch-lab] disabled; normal application start.");
}

child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
