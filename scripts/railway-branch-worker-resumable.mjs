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
const deepRunTimeoutMs = fastSmoke
  ? 2_000
  : configuredDelayMs("SWING_UP_BRANCH_LAB_EFFECTIVE_RUN_TIMEOUT_SECONDS", 390, 390_000);
const watchOutTimeoutMs = fastSmoke
  ? 2_000
  : configuredDelayMs("SWING_UP_BRANCH_LAB_WATCH_OUT_TIMEOUT_SECONDS", 120, 180_000);
const valueBatchTimeoutMs = fastSmoke
  ? 2_000
  : configuredDelayMs("SWING_UP_BRANCH_LAB_VALUE_BATCH_TIMEOUT_SECONDS", 180, 240_000);
const signalOperationsTimeoutMs = fastSmoke
  ? 2_000
  : configuredDelayMs("SWING_UP_BRANCH_LAB_SIGNAL_OPERATIONS_TIMEOUT_SECONDS", 240, 300_000);

const deepRouteUrl = `http://127.0.0.1:${port}/api/internal/railway-branch-signal-lab`;
const watchOutRouteUrl = `http://127.0.0.1:${port}/api/internal/combined-opportunity-engine/us-watch-out-scan`;
const valueBatchRouteUrl = `http://127.0.0.1:${port}/api/internal/combined-opportunity-engine/us-value-batch`;
const signalOperationsRouteUrl = `http://127.0.0.1:${port}/api/internal/combined-opportunity-engine/us-signal-operations`;
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

function schedulerHeaders() {
  return {
    "content-type": "application/json",
    "x-swing-up-branch-lab-token": runtimeToken,
    "x-swing-up-branch-lab-scheduler": "dedicated_worker",
    "x-swing-up-branch-lab-worker-started-at": workerStartedAt,
    "x-swing-up-branch-lab-worker-id": workerId,
    "x-swing-up-branch-lab-worker-sequence": String(sequence),
  };
}

async function callLane(input) {
  const startedAt = Date.now();
  tellSupervisor({ type: `${input.lane}_started`, sequence });
  const response = await fetch(input.url, {
    method: "POST",
    headers: schedulerHeaders(),
    body: "{}",
    signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(input.timeoutMs)]),
  });
  const responseText = await response.text();
  let report = null;
  try { report = JSON.parse(responseText); } catch {}
  const durationMs = Date.now() - startedAt;
  console.log(`[swing-up-${input.lane}] status=${response.status} sequence=${sequence} durationMs=${durationMs} ${responseText.slice(0, input.logLimit)}`);
  return { response, report, responseText, durationMs };
}

async function triggerWatchOutScan() {
  const result = await callLane({ lane: "watch_out_scan", url: watchOutRouteUrl, timeoutMs: watchOutTimeoutMs, logLimit: 8_000 });
  const seriousSignalCount = Number.isFinite(result.report?.seriousSignalCount) ? result.report.seriousSignalCount : 0;
  const newSeriousSignalCount = Number.isFinite(result.report?.newSeriousSignalCount) ? result.report.newSeriousSignalCount : 0;
  tellSupervisor({
    type: "watch_out_scan_finished",
    sequence,
    status: result.response.status,
    durationMs: result.durationMs,
    seriousSignalCount,
    newSeriousSignalCount,
    reportStatus: result.report?.seriousSignalFound === true ? "serious_watch_out_found" : "no_serious_watch_out",
    failureScope: result.response.ok ? null : "watch_out_scan",
    technicalFailureFingerprint: result.response.ok ? null : `watch_out_scan_http_${result.response.status}`,
  });
}

async function triggerValueBatch() {
  const result = await callLane({ lane: "value_batch", url: valueBatchRouteUrl, timeoutMs: valueBatchTimeoutMs, logLimit: 10_000 });
  const seriousSignalCount = Number.isFinite(result.report?.seriousSignalCount) ? result.report.seriousSignalCount : 0;
  const newSeriousSignalCount = Number.isFinite(result.report?.newSeriousSignalCount) ? result.report.newSeriousSignalCount : 0;
  const companiesStoredThisRun = Number.isFinite(result.report?.progress?.companiesStoredThisRun) ? result.report.progress.companiesStoredThisRun : 0;
  const coveragePercent = Number.isFinite(result.report?.progress?.coveragePercent) ? result.report.progress.coveragePercent : 0;
  tellSupervisor({
    type: "value_batch_finished",
    sequence,
    status: result.response.status,
    durationMs: result.durationMs,
    companiesStoredThisRun,
    coveragePercent,
    seriousSignalCount,
    newSeriousSignalCount,
    reportStatus: result.report?.seriousSignalFound === true ? "foundation_serious_signal_found" : "no_foundation_serious_signal",
    failureScope: result.response.ok ? null : "value_batch",
    technicalFailureFingerprint: result.response.ok ? null : `value_batch_http_${result.response.status}`,
  });
}

async function triggerSignalOperations() {
  const result = await callLane({
    lane: "signal_operations",
    url: signalOperationsRouteUrl,
    timeoutMs: signalOperationsTimeoutMs,
    logLimit: 14_000,
  });
  const seriousBuyCount = Array.isArray(result.report?.seriousSignals?.buy)
    ? result.report.seriousSignals.buy.length
    : 0;
  const seriousSellCount = Array.isArray(result.report?.seriousSignals?.sell)
    ? result.report.seriousSignals.sell.length
    : 0;
  const seriousWatchOutCount = Array.isArray(result.report?.seriousSignals?.watchOut)
    ? result.report.seriousSignals.watchOut.length
    : 0;
  const newSeriousSignalCount = Number.isFinite(result.report?.notificationDigest?.newSignalCount)
    ? result.report.notificationDigest.newSignalCount
    : 0;
  tellSupervisor({
    type: "signal_operations_finished",
    sequence,
    status: result.response.status,
    durationMs: result.durationMs,
    seriousSignalCount: seriousBuyCount + seriousSellCount + seriousWatchOutCount,
    seriousBuyCount,
    seriousSellCount,
    seriousWatchOutCount,
    newSeriousSignalCount,
    reportStatus: seriousBuyCount > 0
      ? "serious_buy_found"
      : seriousWatchOutCount > 0
        ? "serious_watch_out_found"
        : seriousSellCount > 0
          ? "serious_sell_found"
          : "no_serious_signal",
    failureScope: result.response.ok ? null : "signal_operations",
    technicalFailureFingerprint: result.response.ok ? null : `signal_operations_http_${result.response.status}`,
  });
}

async function triggerDeepRun() {
  const result = await callLane({ lane: "deep_run", url: deepRouteUrl, timeoutMs: deepRunTimeoutMs, logLimit: 12_000 });
  tellSupervisor({
    type: "run_finished",
    sequence,
    status: result.response.status,
    durationMs: result.durationMs,
    reportStatus: typeof result.report?.status === "string" ? result.report.status : null,
    failureScope: typeof result.report?.failureScope === "string" ? result.report.failureScope : null,
    technicalFailureFingerprint: typeof result.report?.technicalFailureFingerprint === "string" ? result.report.technicalFailureFingerprint : null,
  });
  if (result.response.status === 409 || result.report?.stopped === true) return { keepRunning: false, delayMs: normalPollMs };
  if ([401, 403, 404].includes(result.response.status)) throw new Error(`branch_lab_route_rejected_worker_${result.response.status}`);
  const technicalFailure = !result.response.ok || (result.report?.status === "technical_failure" && result.report?.repairEligible === true);
  return { keepRunning: true, delayMs: technicalFailure ? technicalRetryMs : normalPollMs };
}

async function runNonBlockingLane(name, work) {
  try {
    await work();
  } catch (error) {
    const errorCategory = error instanceof Error ? error.name : `${name}_failed`;
    const errorMessage = error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 300) : `${name}_failed`;
    console.error(`[swing-up-${name}] ${errorMessage}`);
    tellSupervisor({
      type: `${name}_error`,
      sequence,
      errorCategory,
      errorMessage,
      failureScope: name,
      technicalFailureFingerprint: `${name}_${errorCategory.toLowerCase()}`,
    });
  }
}

async function triggerRun() {
  sequence += 1;
  // Fast danger scanning completes first. The valuation warehouse then saves
  // resumable company batches. Buy-first signal operations compare live prices
  // with stored fair values, preserve active theses, and create a deduplicated
  // notification digest before the slower event-research lane runs.
  await runNonBlockingLane("watch_out_scan", triggerWatchOutScan);
  await runNonBlockingLane("value_batch", triggerValueBatch);
  await runNonBlockingLane("signal_operations", triggerSignalOperations);
  return triggerDeepRun();
}

async function main() {
  if (!runtimeToken) throw new Error("branch_lab_runtime_token_missing");
  if (!(await waitForHealth())) throw new Error("branch_lab_health_timeout");
  console.log(`[swing-up-branch-worker] dedicated worker active; live polling=${Math.round(normalPollMs / 1000)}s, technical retry=${Math.round(technicalRetryMs / 1000)}s, watch-out timeout=${Math.round(watchOutTimeoutMs / 1000)}s, value-batch timeout=${Math.round(valueBatchTimeoutMs / 1000)}s, signal-operations timeout=${Math.round(signalOperationsTimeoutMs / 1000)}s, deep-run timeout=${Math.round(deepRunTimeoutMs / 1000)}s, transport=loopback, state=Cloudflare R2.`);
  tellSupervisor({
    type: "ready",
    sequence,
    watchOutTimeoutSeconds: Math.round(watchOutTimeoutMs / 1000),
    valueBatchTimeoutSeconds: Math.round(valueBatchTimeoutMs / 1000),
    signalOperationsTimeoutSeconds: Math.round(signalOperationsTimeoutMs / 1000),
    runTimeoutSeconds: Math.round(deepRunTimeoutMs / 1000),
  });

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
        runTimeoutSeconds: Math.round(deepRunTimeoutMs / 1000),
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
