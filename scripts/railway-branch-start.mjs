import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";

const LAB_BRANCH = "agent/live-signal-evaluation-automation";
const branch = (process.env.RAILWAY_GIT_BRANCH || "").trim();
const environment = (process.env.RAILWAY_ENVIRONMENT_NAME || "").trim().toLowerCase();
const branchLab = Boolean(process.env.RAILWAY_PROJECT_ID && branch === LAB_BRANCH && environment && environment !== "production");
const runtimeToken = crypto.randomBytes(32).toString("hex");
const port = process.env.PORT || "3000";
let child = null;

function isolatedBranchEnvironment() {
  const env = {
    ...process.env,
    SWING_UP_BRANCH_LAB_RUNTIME_TOKEN: runtimeToken,
    SWING_UP_TEST_MODE: "true",
    AI_COMMITTEE_ENABLED: "true",
    AI_COMMITTEE_AUTONOMOUS: "true",
    AI_COMMITTEE_DRY_RUN_DEFAULT: "false",
    PUBLIC_LEDGER_TRACKING_ENABLED: "false",
    PUBLIC_TRACKING_ENABLED: "false",
  };
  for (const key of [
    "DATABASE_URL", "DIRECT_URL", "TELEGRAM_BOT_TOKEN", "TELEGRAM_TEST_CHAT_ID",
    "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
    "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "POLYGON_API_KEY", "FMP_API_KEY",
    "BENZINGA_API_KEY", "MARKETAUX_API_KEY", "ALPHA_VANTAGE_API_KEY",
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
    console.log(`[swing-up-branch-lab] status=${response.status} ${text.slice(0, 12000)}`);
    return response.status !== 409;
  } catch (error) {
    console.error(`[swing-up-branch-lab] ${error instanceof Error ? error.message : "run_failed"}`);
    return true;
  }
}

if (branchLab) {
  console.log(`[swing-up-branch-lab] enabled for ${branch} in ${environment}; production publishing and notifications remain disabled.`);
  void (async () => {
    if (!(await waitForHealth())) {
      console.error("[swing-up-branch-lab] app health timeout; no experiment ran.");
      return;
    }
    let keepRunning = await runLab();
    while (keepRunning && child && !child.killed) {
      await new Promise((resolve) => setTimeout(resolve, 60 * 60 * 1000));
      keepRunning = await runLab();
    }
  })();
} else {
  console.log("[swing-up-branch-lab] disabled; normal application start.");
}

child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
