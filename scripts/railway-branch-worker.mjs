import crypto from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const port = (process.env.PORT || "3000").trim();
const runtimeToken = (process.env.SWING_UP_BRANCH_LAB_RUNTIME_TOKEN || "").trim();
const workerStartedAt = new Date().toISOString();
const workerId = crypto.randomUUID();
const fastSmoke = process.env.SWING_UP_BRANCH_LAB_WORKER_SMOKE === "true";
const minimumDelayMs = fastSmoke ? 50 : 60_000;

function configuredDelayMs(name, fallbackSeconds, maximumMs) {
  const seconds = Number(process.env[name] || fallbackSeconds);
  return Number.isFinite(seconds)
    ? Math.max(minimumDelayMs, Math.min(maximumMs, seconds * 1000))
    : fallbackSeconds * 1000;
}

const normalPollMs = configuredDelayMs("SWING_UP_BRANCH_LAB_EFFECTIVE_INTERVAL_SECONDS", 300, 3_600_000);
const technicalRetryMs = Math.min(
  normalPollMs,
  configuredDelayMs("SWING_UP_BRANCH_LAB_EFFECTIVE_TECHNICAL_RETRY_SECONDS", 60, normalPollMs),
);
// The company-first scan now includes the full U.S. valuation warehouse, R2 shards,
// article confirmation, and bounded SEC diligence. Four minutes was shorter than a
// valid worst-case cycle. Keep the request below the route's seven-minute R2 lease,
// but long enough for one complete isolated scan to finish and release that lease.
const liveRunTimeoutMs = fastSmoke
  ? 2_000
  : configuredDelayMs("SWING_UP_BRANCH_LAB_EFFECTIVE_RUN_TIMEOUT_SECONDS", 390, 390_000);
const routeUrl = `http://127.0.0.1:${port}/api/internal/railway-branch-signal-lab`;
let sequence = 0;
let stopping = false;
const shutdown = new AbortController();

function tellSupervisor(message) {
  if (typeof process.send !== "function") return;
  try { process.send({ at: new Date().toISOString(), workerId, workerStartedAt, ...message }); } catch {}
}

function stop() {
  stopping = true;
  shutdown.abort();
}

process.on("SIGTERM", stop);
process.on("SIGINT", stop);

const heartbeat = setInterval(() => {
  tellSupervisor({ type: "heartbeat", sequence });
}, fastSmoke ? 50 : 30_000);

async function waitForHealth() {
  const deadline = Date.now() + (fastSmoke ? 5_000 : 120_000);
  const healthUrl = `http://127.0.0.1:${port}/api/health`;
  while (!stopping && Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(fastSmoke ? 500 : 5_000) });
      if (response.ok) return true;
    } catch {}
    await delay(fastSmoke ? 50 : 2_000, undefined, { signal: shutdown.signal }).catch(() => {});
  }
  return false;
}

async function triggerRun() {
  sequence += 1;
  const startedAt = Date.now();
  tellSupervisor({ type: "run_started", sequence, runTimeoutSeconds: Math.round(liveRunTimeoutMs / 1000) });
  const response = await fetch(routeUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-swing-up-branch-lab-token": runtimeToken,
      "x-swing-up-branch-lab-scheduler": "dedicated_worker",
      "x-swing-up-branch-lab-worker-started-at": workerStartedAt,
      "x-swing-up-branch-lab-worker-id": workerId,
      "x-swing-up-branch-lab-worker-sequence": String(sequence),
    },
    body: "{}",
    signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(liveRunTimeoutMs)]),
  });
  const responseText = await response.text();
  let report = null;
  try { report = JSON.parse(responseText); } catch {}
  const durationMs = Date.now() - startedAt;
  console.log(`[swing-up-branch-worker] status=${response.status} sequence=${sequence} durationMs=${durationMs} ${responseText.slice(0, 12000)}`);
  tellSupervisor({
    type: "run_finished",
    sequence,
    status: response.status,
    durationMs,
    reportStatus: typeof report?.status === "string" ? report.status : null,
    failureScope: typeof report?.failureScope === "string" ? report.failureScope : null,
    technicalFailureFingerprint: typeof report?.technicalFailureFingerprint === "string" ? report.technicalFailureFingerprint : null,
  });

  if (response.status === 409 || report?.stopped === true) return { keepRunning: false, delayMs: normalPollMs };
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    throw new Error(`branch_lab_route_rejected_worker_${response.status}`);
  }
  const technicalFailure = !response.ok || (report?.status === "technical_failure" && report?.repairEligible === true);
  return { keepRunning: true, delayMs: technicalFailure ? technicalRetryMs : normalPollMs };
}

async function main() {
  if (!runtimeToken) throw new Error("branch_lab_runtime_token_missing");
  if (!(await waitForHealth())) throw new Error("branch_lab_health_timeout");
  console.log(`[swing-up-branch-worker] dedicated worker active; live polling=${Math.round(normalPollMs / 1000)}s, technical retry=${Math.round(technicalRetryMs / 1000)}s, run timeout=${Math.round(liveRunTimeoutMs / 1000)}s, transport=loopback, state=Cloudflare R2.`);
  tellSupervisor({ type: "ready", sequence, runTimeoutSeconds: Math.round(liveRunTimeoutMs / 1000) });

  while (!stopping) {
    let next;
    try {
      next = await triggerRun();
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("branch_lab_route_rejected_worker_")) throw error;
      if (stopping) break;
      const errorCategory = error instanceof Error ? error.name : "run_failed";
      const errorMessage = error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 300) : "run_failed";
      console.error(`[swing-up-branch-worker] ${errorMessage}`);
      tellSupervisor({
        type: "run_error",
        sequence,
        errorCategory,
        errorMessage,
        runTimeoutSeconds: Math.round(liveRunTimeoutMs / 1000),
      });
      next = { keepRunning: true, delayMs: technicalRetryMs };
    }
    if (!next.keepRunning) {
      tellSupervisor({ type: "stopped_by_lab", sequence });
      break;
    }
    if (!stopping) await delay(next.delayMs, undefined, { signal: shutdown.signal }).catch(() => {});
  }
}

try {
  await main();
  clearInterval(heartbeat);
  process.exit(0);
} catch (error) {
  clearInterval(heartbeat);
  console.error(`[swing-up-branch-worker] fatal_${error instanceof Error ? error.message : "worker_failed"}`);
  process.exit(1);
}
