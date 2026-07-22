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
    SWING_UP_BRANCH_LAB_SCHEDULER_OWNER: "next_server",
    SWING_UP_BRANCH_LAB_EFFECTIVE_INTERVAL_SECONDS: `${Math.round(normalPollMs / 1000)}`,
    SWING_UP_BRANCH_LAB_EFFECTIVE_TECHNICAL_RETRY_SECONDS: `${Math.round(technicalRetryMs / 1000)}`,
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

if (branchLab) {
  console.log(`[swing-up-branch-lab] enabled for ${branch} in ${environment}; the healthy Next.js server owns the ${Math.round(normalPollMs / 1000)}s R2-backed scheduler and ${Math.round(technicalRetryMs / 1000)}s technical retry.`);
} else {
  console.log("[swing-up-branch-lab] disabled; normal application start.");
}

child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
