import { setTimeout as delay } from "node:timers/promises";

const port = (process.env.PORT || "3000").trim();
const token = (process.env.SWING_UP_PR262_SENSOR_TOKEN || "").trim();
const intervalSeconds = Number(process.env.SWING_UP_PR262_SENSOR_INTERVAL_SECONDS || "60");
const intervalMs = Math.max(60_000, Math.min(5 * 60_000, Number.isFinite(intervalSeconds) ? intervalSeconds * 1000 : 60_000));
const route = `http://127.0.0.1:${port}/api/internal/combined-opportunity-engine/change-sensor`;
let stopping = false;
const abort = new AbortController();

function stop() {
  stopping = true;
  abort.abort();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

async function waitForHealth() {
  const deadline = Date.now() + 120_000;
  while (!stopping && Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) return true;
    } catch {}
    await delay(2_000, undefined, { signal: abort.signal }).catch(() => {});
  }
  return false;
}

async function cycle() {
  const started = Date.now();
  const response = await fetch(route, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-swing-up-pr262-sensor-token": token,
    },
    body: "{}",
    signal: AbortSignal.timeout(55_000),
  });
  const text = await response.text();
  let report = null;
  try { report = JSON.parse(text); } catch {}
  const newEvents = Number(report?.sensor?.newEventCount ?? 0);
  const material = Number(report?.sensor?.materialEventCount ?? 0);
  const specialist = Number(report?.specialist?.eventsConsidered ?? 0);
  console.log(`[pr262-sensor] status=${response.status} durationMs=${Date.now() - started} newEvents=${newEvents} material=${material} specialist=${specialist}`);
  if (!response.ok) throw new Error(`sensor_http_${response.status}`);
}

if (!token) {
  console.error("[pr262-sensor] missing runtime token; refusing to start.");
  process.exit(1);
}

if (!(await waitForHealth())) {
  console.error("[pr262-sensor] app health check failed; refusing to loop.");
  process.exit(1);
}

console.log(`[pr262-sensor] cheap sensor-first worker active; interval=${Math.round(intervalMs / 1000)}s. Old full-market scanner remains disabled.`);
while (!stopping) {
  try {
    await cycle();
  } catch (error) {
    console.error(`[pr262-sensor] ${error instanceof Error ? error.message : "cycle_failed"}`);
  }
  if (!stopping) await delay(intervalMs, undefined, { signal: abort.signal }).catch(() => {});
}
