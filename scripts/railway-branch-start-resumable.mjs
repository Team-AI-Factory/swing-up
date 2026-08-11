import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";

const PR262_BRANCH = "agent/combined-opportunity-engine";
const LAB_BRANCHES = new Set([
  "agent/live-signal-evaluation-automation",
]);
const branch = (process.env.RAILWAY_GIT_BRANCH || "").trim();
const environment = (process.env.RAILWAY_ENVIRONMENT_NAME || "").trim().toLowerCase();

if (branch === PR262_BRANCH) {
  console.log("[swing-up-cost-control] PR #262 is HARD PAUSED and cannot enter the resumable legacy supervisor. Exiting without starting a web server or worker.");
  process.exit(0);
}

const allowedLabBranch = LAB_BRANCHES.has(branch);
const productionLabBranch = allowedLabBranch && environment === "production";
const branchLab = Boolean(process.env.RAILWAY_PROJECT_ID && allowedLabBranch && environment && environment !== "production");
const r2WritePrefix =
  branch === "agent/live-signal-evaluation-automation"
    ? "branch-labs/pr-261/"
    : null;

if (productionLabBranch) {
  console.error(`[swing-up-start] refusing to start isolated branch ${branch} in the production environment; migrations were not run.`);
  process.exit(1);
}

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
let workerRuntimeSnapshot = {
  stage: "supervisor_initializing",
  at: new Date().toISOString(),
  heartbeatAt: null,
  workerStartedAt: null,
  workerId: null,
  sequence: 0,
  httpStatus: null,
  reportStatus: null,
  failureScope: null,
  technicalFailureFingerprint: null,
  errorCategory: null,
  errorMessage: null,
  durationMs: null,
  seriousSignalCount: null,
  newSeriousSignalCount: null,
  companiesStoredThisRun: null,
  coveragePercent: null,
};

function recordWorkerStatus(stage, details = {}) {
  const at = new Date().toISOString();
  workerRuntimeSnapshot = {
    ...workerRuntimeSnapshot,
    ...details,
    stage,
    at,
    ...(stage === "heartbeat" ? { heartbeatAt: at } : {}),
    ...(stage === "run_started" ? { lastRunStartedAt: at } : {}),
    ...(stage === "run_finished" ? { lastRunFinishedAt: at } : {}),
    ...(stage === "run_error" ? { lastRunErrorAt: at } : {}),
    ...(stage === "watch_out_scan_started" ? { lastWatchOutStartedAt: at } : {}),
    ...(stage === "watch_out_scan_finished" ? { lastWatchOutFinishedAt: at } : {}),
    ...(stage === "watch_out_scan_error" ? { lastWatchOutErrorAt: at } : {}),
    ...(stage === "value_batch_started" ? { lastValueBatchStartedAt: at } : {}),
    ...(stage === "value_batch_finished" ? { lastValueBatchFinishedAt: at } : {}),
    ...(stage === "value_batch_error" ? { lastValueBatchErrorAt: at } : {}),
  };
  statusWrite = statusWrite
    .then(() => writeFile(WORKER_RUNTIME_STATUS_PATH, JSON.stringify(workerRuntimeSnapshot), "utf8"))
    .catch((error) => console.error(`[swing-up-branch-lab] worker_status_${error instanceof Error ? error.message : "write_failed"}`));
}

function isolatedBranchEnvironment() {
  if (!r2WritePrefix) throw new Error("branch_lab_r2_write_prefix_unavailable");
  const env = {
    ...process.env,
    SWING_UP_BRANCH_LAB_RUNTIME_TOKEN: runtimeToken,
    SWING_UP_R2_WRITE_PREFIX: r2WritePrefix,
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

if (!branchLab && environment === "production") {
  console.log("[swing-up-start] applying normal database migrations before application start.");
  const migration = launch("npx", ["prisma", "migrate", "deploy"]);
  const [migrationCode] = await once(migration, "exit");
  if (migrationCode !== 0) process.exit(Number(migrationCode) || 1);
} else if (!branchLab) {
  console.log("[swing-up-start] non-production application start; database migrations skipped.");
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
  worker = launch(process.execPath, ["scripts/railway-branch-worker-resumable.mjs"], applicationEnvironment, ["ignore", "inherit", "inherit", "ipc"]);
  recordWorkerStatus("worker_spawned");
  worker.on("message", (message) => {
    workerLastHeartbeatAt = Date.now();
    if (message?.type === "stopped_by_lab") workerStoppedByLab = true;
    recordWorkerStatus(typeof message?.type === "string" ? message.type : "worker_message", {
      workerStartedAt: typeof message?.workerStartedAt === "string" ? message.workerStartedAt : workerRuntimeSnapshot.workerStartedAt,
      workerId: typeof message?.workerId === "string" ? message.workerId : workerRuntimeSnapshot.workerId,
      sequence: Number.isFinite(message?.sequence) ? message.sequence : workerRuntimeSnapshot.sequence,
      httpStatus: Number.isFinite(message?.status) ? message.status : workerRuntimeSnapshot.httpStatus,
      reportStatus: typeof message?.reportStatus === "string" ? message.reportStatus : workerRuntimeSnapshot.reportStatus,
      failureScope: typeof message?.failureScope === "string" ? message.failureScope : workerRuntimeSnapshot.failureScope,
      technicalFailureFingerprint: typeof message?.technicalFailureFingerprint === "string" ? message.technicalFailureFingerprint : workerRuntimeSnapshot.technicalFailureFingerprint,
      errorCategory: typeof message?.errorCategory === "string" ? message.errorCategory : workerRuntimeSnapshot.errorCategory,
      errorMessage: typeof message?.errorMessage === "string" ? message.errorMessage : workerRuntimeSnapshot.errorMessage,
      durationMs: Number.isFinite(message?.durationMs) ? message.durationMs : workerRuntimeSnapshot.durationMs,
      seriousSignalCount: Number.isFinite(message?.seriousSignalCount) ? message.seriousSignalCount : workerRuntimeSnapshot.seriousSignalCount,
      newSeriousSignalCount: Number.isFinite(message?.newSeriousSignalCount) ? message.newSeriousSignalCount : workerRuntimeSnapshot.newSeriousSignalCount,
      companiesStoredThisRun: Number.isFinite(message?.companiesStoredThisRun) ? message.companiesStoredThisRun : workerRuntimeSnapshot.companiesStoredThisRun,
      coveragePercent: Number.isFinite(message?.coveragePercent) ? message.coveragePercent : workerRuntimeSnapshot.coveragePercent,
      runTimeoutSeconds: Number.isFinite(message?.runTimeoutSeconds) ? message.runTimeoutSeconds : workerRuntimeSnapshot.runTimeoutSeconds,
      watchOutTimeoutSeconds: Number.isFinite(message?.watchOutTimeoutSeconds) ? message.watchOutTimeoutSeconds : workerRuntimeSnapshot.watchOutTimeoutSeconds,
      valueBatchTimeoutSeconds: Number.isFinite(message?.valueBatchTimeoutSeconds) ? message.valueBatchTimeoutSeconds : workerRuntimeSnapshot.valueBatchTimeoutSeconds,
    });
  });
  worker.on("error", (error) => {
    recordWorkerStatus("worker_spawn_error", {
      errorCategory: error instanceof Error ? error.name : "spawn_error",
      errorMessage: error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 300) : "spawn_error",
    });
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
  console.log(`[swing-up-branch-lab] enabled for ${branch} in ${environment}; independent Watch Out, resumable valuation, and deep research lanes run on the ${Math.round(normalPollMs / 1000)}s R2-backed scheduler.`);
} else {
  console.log("[swing-up-branch-lab] disabled; normal application start.");
}

child.on("exit", (code, signal) => {
  clearWorkerRestart();
  if (workerWatchdog) clearInterval(workerWatchdog);
  if (worker && !worker.killed) worker.kill("SIGTERM");
  const exitCode = code ?? (signal ? 1 : 0);
  console.error(`[swing-up-start] application child exited code=${exitCode}; terminating supervisor so Railway can apply its restart policy.`);
  process.exit(exitCode);
});
