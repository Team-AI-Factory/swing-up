import { runPr262LightweightSensorV2 } from "@/lib/opportunity-engine/pr262-lightweight-sensor-v2";
import { enrichPr262SensorCompanyMappings } from "@/lib/opportunity-engine/pr262-company-directory";
import { readPr262ChangeSensorState } from "@/lib/opportunity-engine/pr262-change-sensor";
import { runPr262EventJob } from "@/lib/opportunity-engine/pr262-event-job";
import { promotePr262SeriousWatchOut } from "@/lib/opportunity-engine/pr262-serious-watch-out-authority";
import { recordPr262CostEffectiveness } from "@/lib/opportunity-engine/pr262-cost-effectiveness";

const MAX_CYCLE_MS = 210_000;
const startedAt = Date.now();
const checkedAt = new Date().toISOString();

process.env.SWING_UP_R2_WRITE_PREFIX = "branch-labs/pr-262/";
process.env.SWING_UP_PR262_EVENT_JOB_OPENAI_ENABLED = process.env.SWING_UP_PR262_EVENT_JOB_OPENAI_ENABLED?.trim() || "true";
process.env.PUBLIC_LEDGER_TRACKING_ENABLED = "false";
process.env.PUBLIC_TRACKING_ENABLED = "false";

function dueReadyCount(state: Awaited<ReturnType<typeof readPr262ChangeSensorState>>) {
  const now = Date.now();
  return state.pending.filter((event) => {
    const retryAt = event.queueNextAttemptAt ? Date.parse(event.queueNextAttemptAt) : Number.NaN;
    return event.priority >= 80 && Boolean(event.ticker) && (!Number.isFinite(retryAt) || retryAt <= now);
  }).length;
}

function capacityForQueue(ready: number) {
  if (ready >= 100) return 12;
  if (ready >= 30) return 8;
  return 4;
}

async function main() {
  const sensor = await runPr262LightweightSensorV2();
  const mapping = await enrichPr262SensorCompanyMappings().catch((error) => ({
    mapped: 0,
    directoryCompanies: 0,
    directoryUpdatedAt: null,
    error: error instanceof Error ? error.message : "mapping_failed",
  }));
  let state = await readPr262ChangeSensorState();
  const readyAtStart = dueReadyCount(state);
  const capacity = capacityForQueue(readyAtStart);
  const eventResults: Array<Record<string, unknown>> = [];
  let eventFailures = 0;
  let aiCalls = 0;
  let seriousBuys = 0;
  let seriousSells = 0;
  let seriousWatchOuts = 0;

  for (let index = 0; index < capacity && Date.now() - startedAt < MAX_CYCLE_MS; index += 1) {
    try {
      const result = await runPr262EventJob({ allowOpenAi: true });
      eventResults.push(result as Record<string, unknown>);
      if (result.status === "idle" || result.status === "busy") break;
      if (result.openAiCalled === true) aiCalls += 1;
      if (result.seriousSignalFound === true && result.alertType === "buy") seriousBuys += 1;
      if (result.seriousSignalFound === true && result.alertType === "sell") seriousSells += 1;
      const watchOut = await promotePr262SeriousWatchOut(typeof result.resultKey === "string" ? result.resultKey : null).catch(() => ({ promoted: false }));
      if (watchOut.promoted) seriousWatchOuts += 1;
    } catch (error) {
      eventFailures += 1;
      eventResults.push({ status: "event_job_error", error: error instanceof Error ? error.message.slice(0, 260) : "event_job_failed" });
    }
  }

  state = await readPr262ChangeSensorState();
  const supplemental = sensor.supplementalSources;
  const sourceAttempts = supplemental.filter((item) => item.attempted).length
    + (Array.isArray(sensor.core.sourceHealth) ? sensor.core.sourceHealth.filter((item) => item.attemptedThisCycle).length : 0);
  const sourceFailures = supplemental.filter((item) => item.attempted && !["connected", "partial", "not_due", "not_configured"].includes(item.status)).length
    + (Array.isArray(sensor.core.sourceHealth) ? sensor.core.sourceHealth.filter((item) => item.attemptedThisCycle && !["connected", "partial", "not_due"].includes(item.status)).length : 0);
  const eventsProcessed = eventResults.filter((item) => Number(item.eventsProcessed) > 0).length;
  const durationMs = Date.now() - startedAt;

  const cost = await recordPr262CostEffectiveness({
    checkedAt,
    durationMs,
    sourceAttempts,
    sourceFailures,
    newEvents: Number(sensor.core.newEventCount ?? 0) + sensor.newSupplementalEvents,
    sectorFanoutEvents: sensor.sectorFanoutEvents,
    pendingEvents: state.pending.length,
    eventsProcessed,
    eventFailures,
    aiCalls,
    seriousBuys,
    seriousSells,
    seriousWatchOuts,
  }).catch((error) => ({ error: error instanceof Error ? error.message : "cost_metrics_failed" }));

  console.log(JSON.stringify({
    ok: true,
    mode: "pr262_five_minute_cron_v2",
    checkedAt,
    durationMs,
    sensor: {
      newCoreEvents: sensor.core.newEventCount,
      newSupplementalEvents: sensor.newSupplementalEvents,
      sectorFanoutEvents: sensor.sectorFanoutEvents,
      pendingEvents: state.pending.length,
    },
    mapping,
    processing: {
      readyAtStart,
      capacity,
      eventsProcessed,
      eventFailures,
      aiCalls,
      seriousBuys,
      seriousSells,
      seriousWatchOuts,
      deadlineMs: MAX_CYCLE_MS,
    },
    cost,
    safety: { publishing: false, notifications: false, trades: false, databaseWrites: false },
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, mode: "pr262_five_minute_cron_v2", checkedAt, error: error instanceof Error ? error.message : "cron_cycle_failed" }));
  process.exitCode = 1;
});
