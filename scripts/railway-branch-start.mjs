import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";

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
const WORKER_RUNTIME_STATUS_PATH = "/tmp/swing-up-branch-worker-runtime.json";
let child = null;
let worker = null;
let workerRestartTimer = null;
let workerLastHeartbeatAt = 0;
let workerStoppedByLab = false;
let statusWrite = Promise.resolve();

function recordWorkerStatus(stage, details = {}) {
  const status = { stage, at: new Date().toISOString(), ...details };
  statusWrite = statusWrite
    .then(() => writeFile(WORKER_RUNTIME_STATUS_PATH, JSON.stringify(status), "utf8"))
    .catch((error) => console.error(`[swing-up-branch-lab] worker_status_${error instanceof Error ? error.message : "write_failed"}`));
}

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
    SWING_UP_BRANCH_LAB_SCHEDULER_OWNER: "dedicated_worker",
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

function launch(command, args, env = process.env, stdio = "inherit") {
  return spawn(command, args, { stdio, env });
}

if (!branchLab) {
  console.log("[swing-up-start] applying normal database migrations before application start.");
  const migration = launch("npx", ["prisma", "migrate", "deploy"]);
  const [migrationCode] = await once(migration, "exit");
  if (migrationCode !== 0) process.exit(Number(migrationCode) || 1);
} else {
  console.log("[swing-up-branch-lab] database migrations skipped for isolated branch preview.");
}

const applicationEnvironment = branchLab ? isolatedBranchEnvironment() : process.env;
child = launch("npm", ["run", "start", "--", "--hostname", "0.0.0.0", "--port", port], applicationEnvironment);

function clearWorkerRestart() {
  if (workerRestartTimer) clearTimeout(workerRestartTimer);
  workerRestartTimer = null;
}

function startWorker() {
  if (!branchLab || worker || workerStoppedByLab || !child || child.killed) return;
  workerLastHeartbeatAt = Date.now();
  recordWorkerStatus("worker_starting");
  worker = launch(process.execPath, ["scripts/railway-branch-worker.mjs"], applicationEnvironment, ["ignore", "inherit", "inherit", "ipc"]);
  recordWorkerStatus("worker_spawned");
  worker.on("message", (message) => {
    workerLastHeartbeatAt = Date.now();
    if (message?.type === "stopped_by_lab") workerStoppedByLab = true;
    recordWorkerStatus(typeof message?.type === "string" ? message.type : "worker_message", {
      workerStartedAt: typeof message?.workerStartedAt === "string" ? message.workerStartedAt : null,
      sequence: Number.isFinite(message?.sequence) ? message.sequence : 0,
      httpStatus: Number.isFinite(message?.status) ? message.status : null,
    });
  });
  worker.on("error", (error) => {
    recordWorkerStatus("worker_spawn_error", { errorCategory: error instanceof Error ? error.name : "spawn_error" });
  });
  worker.on("exit", (code, signal) => {
    console.warn(`[swing-up-branch-lab] dedicated worker exited code=${code ?? "null"} signal=${signal ?? "none"}.`);
    recordWorkerStatus("worker_exited", { exitCode: code, signal: signal ?? null });
    worker = null;
    if (!workerStoppedByLab && child && !child.killed) {
      clearWorkerRestart();
      workerRestartTimer = setTimeout(startWorker, 5_000);
    }
  });
}

const workerWatchdog = branchLab ? setInterval(() => {
  if (worker && workerLastHeartbeatAt > 0 && Date.now() - workerLastHeartbeatAt > 90_000) {
    console.error("[swing-up-branch-lab] dedicated worker heartbeat overdue; restarting worker process.");
    recordWorkerStatus("worker_heartbeat_overdue");
    worker.kill("SIGKILL");
  } else if (!worker && !workerRestartTimer && !workerStoppedByLab && child && !child.killed) {
    startWorker();
  }
}, 30_000) : null;

if (branchLab) startWorker();

function stop(signal) {
  clearWorkerRestart();
  if (worker && !worker.killed) worker.kill(signal);
  if (child && !child.killed) child.kill(signal);
}
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));

if (branchLab) {
  console.log(`[swing-up-branch-lab] enabled for ${branch} in ${environment}; a supervised worker process owns the ${Math.round(normalPollMs / 1000)}s R2-backed scheduler and ${Math.round(technicalRetryMs / 1000)}s technical retry.`);
} else {
  console.log("[swing-up-branch-lab] disabled; normal application start.");
}

child.on("exit", (code, signal) => {
  clearWorkerRestart();
  if (workerWatchdog) clearInterval(workerWatchdog);
  if (worker && !worker.killed) worker.kill("SIGTERM");
  process.exitCode = code ?? (signal ? 1 : 0);
});
