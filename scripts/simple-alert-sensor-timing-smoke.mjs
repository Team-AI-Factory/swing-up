import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const worker = read("scripts/simple-alert-pilot-cycle.mjs");
const code = ts.transpileModule(worker, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runWorker = new AsyncFunction("require", "exports", "process", "fetch", "Date", "AbortSignal", "setTimeout", "clearTimeout", "console", code);
const cadenceMs = 15 * 60_000;
assert.equal(JSON.parse(read("railway.sensor.json")).deploy.cronSchedule, "*/15 * * * *");

// Execute the actual worker script with a deterministic clock and explicit
// substitutes for every process/network boundary. Nothing is spawned or sent.
async function scenario({ profile = false, healthReadyAt = 0, healthMs = 0, controlsMs = 0, responseMs = 540000 } = {}) {
  let clock = 0;
  const timers = new Set(), requests = [], exits = [], kills = [], errors = [], timeoutDurations = [];
  const schedule = (callback, duration) => {
    const timer = { at: clock + duration, callback, unref() {} };
    timers.add(timer);
    return timer;
  };
  const advance = duration => {
    const target = clock + duration;
    while (true) {
      const next = [...timers].filter(timer => timer.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      clock = next.at;
      timers.delete(next);
      next.callback();
    }
    clock = target;
  };
  const timeout = duration => {
    timeoutDurations.push(duration);
    const controller = new AbortController();
    const timer = schedule(() => controller.abort(new Error(`fixture_timeout_${duration}`)), duration);
    controller.signal.fixtureDeadline = timer.at;
    return controller.signal;
  };
  const operation = (duration, signal) => {
    advance(Math.min(duration, signal.fixtureDeadline - clock));
    signal.throwIfAborted();
  };
  const processFixture = {
    argv: profile ? ["node", "worker", "--profiles-only"] : ["node", "worker"],
    env: {
      SWING_UP_SIMPLE_PILOT_ENABLED: "true", RAILWAY_GIT_BRANCH: "pilot-simple-alerts",
      RAILWAY_PROJECT_ID: "83d99341-d622-475f-8035-00ef3d0916d1",
      RAILWAY_ENVIRONMENT_ID: "87afb8d7-c4fc-4f84-92b6-5d2820a689b6",
      SWING_UP_PR262_STORAGE_PREFIX: "branch-labs/simple-alerts/", SWING_UP_R2_WRITE_PREFIX: "branch-labs/simple-alerts/",
      SWING_UP_SIMPLE_PILOT_ROLE: profile ? "profiles" : "sensor",
      SWING_UP_PR262_PROJECTED_RAILWAY_MONTHLY_COST_USD: "1",
      RAILWAY_GIT_COMMIT_SHA: "f9f418fa95ee1984d1773efb4c020bdd195c1534",
      AI_COMMITTEE_ENABLED: "true", SWING_UP_PR262_EVENT_JOB_OPENAI_ENABLED: "true",
    },
    kill: (pid, signal) => { kills.push({ at: clock, pid, signal }); },
    exit: code => { exits.push({ at: clock, code }); throw new Error("fixture_process_exit"); },
  };
  const imports = {
    "node:crypto": { randomBytes: size => Buffer.alloc(size, 1) },
    "node:child_process": { spawn: () => ({ pid: 123, exitCode: null }) },
    "node:events": { once: () => new Promise(() => {}) },
    "node:timers/promises": { setTimeout: async duration => { advance(duration); } },
    "./helpers/simple-alert-model-policy.mjs": { applySimpleAlertModelPolicy: () => ({}) },
    "./helpers/simple-alert-cycle-summary.mjs": { simpleAlertCycleSummary: JSON.parse },
  };
  const fetchFixture = async (url, init) => {
    assert.ok(url.startsWith("http://127.0.0.1:3015/"));
    requests.push({ url, at: clock, timeoutMs: init.signal.fixtureDeadline - clock });
    if (url.endsWith("/api/health")) {
      operation(healthMs, init.signal);
      return { ok: clock >= healthReadyAt };
    }
    if (url.endsWith("/delivery-test")) {
      operation(controlsMs, init.signal);
      return { ok: true, json: async () => ({ ok: true, testOnly: true, receiptVerified: true,
        negativeControlPassed: true, duplicateSuppressed: true, seriousSignalFeedExcluded: true }) };
    }
    assert.ok(url.endsWith("/cron-v3"));
    assert.equal(JSON.parse(init.body).mode, profile ? "profiles_only" : "sensor_and_analysis");
    operation(responseMs, init.signal);
    return { ok: true, status: 200, text: async () => "{}" };
  };
  await assert.rejects(() => runWorker(name => {
    assert.ok(name in imports, `Unexpected worker dependency ${name}`);
    return imports[name];
  }, {}, processFixture, fetchFixture, { now: () => clock }, { timeout }, schedule, timer => timers.delete(timer),
  { log() {}, error: message => errors.push(message) }), /fixture_process_exit/);
  return { clock, requests, exits, kills, errors, timeoutDurations };
}

const delayed = { healthReadyAt: 45000, healthMs: 1999, controlsMs: 59999 };
const completed = await scenario(delayed);
const request = completed.requests.find(row => row.url.endsWith("/cron-v3"));
assert.equal(request.at, 106980, "A last health response can finish just after the 45s polling cutoff");
assert.equal(request.timeoutMs, 580000);
assert.deepEqual(completed.exits, [{ at: 649980, code: 0 }]);
assert.ok(completed.exits[0].at < 660000);
assert.ok(660000 < cadenceMs);

const httpBoundary = await scenario({ responseMs: 580000 });
assert.ok(httpBoundary.errors.includes("fixture_timeout_580000"));
assert.deepEqual(httpBoundary.exits, [{ at: 583000, code: 1 }]);
const beforeHttpBoundary = await scenario({ responseMs: 579999 });
assert.deepEqual(beforeHttpBoundary.exits, [{ at: 582999, code: 0 }]);

const hung = await scenario({ ...delayed, responseMs: 600000 });
assert.equal(hung.exits[0].at, 660000, "The unchanged watchdog wins if startup plus a hung HTTP response exceeds 11 minutes");
assert.equal(hung.exits[0].code, 1);
assert.ok(hung.kills.some(kill => kill.at === 660000 && kill.pid === -123 && kill.signal === "SIGKILL"));
assert.equal(cadenceMs - hung.exits[0].at, 240000);

const unhealthy = await scenario({ healthReadyAt: Infinity, healthMs: 1999 });
assert.ok(unhealthy.errors.includes("simple_pilot_health_timeout"));
assert.equal(unhealthy.requests.some(row => row.url.endsWith("/cron-v3")), false);

const profile = await scenario({ profile: true, healthReadyAt: 45000, healthMs: 1999, responseMs: 235000 });
assert.equal(profile.requests.find(row => row.url.endsWith("/cron-v3")).timeoutMs, 240000);
assert.equal(profile.requests.some(row => row.url.endsWith("/delivery-test")), false);
assert.deepEqual(profile.exits, [{ at: 284981, code: 0 }]);
const profileSource = read("lib/simple-alert-profile-builder.ts");
for (const [constant, duration] of Object.entries({ PROFILE_ADMISSION_BUDGET_MS: "100_000", PROFILE_WORK_BUDGET_MS: "140_000",
  PROFILE_PERSISTENCE_DEADLINE_MS: "160_000", PROFILE_COUNT_DEADLINE_MS: "175_000", PROFILE_SUMMARY_DEADLINE_MS: "235_000" })) {
  assert.ok(profileSource.includes(`const ${constant} = ${duration};`), `${constant} must remain independent`);
}
const eventSource = read("lib/opportunity-engine/pr262-event-job.ts");
assert.match(eventSource, /LEASE_MS = 5 \* 60_000/);
assert.match(eventSource, /LEASE_HEARTBEAT_MS = 60_000/);
assert.match(eventSource, /setInterval\(runHeartbeat, LEASE_HEARTBEAT_MS\)/);
assert.match(eventSource, /MAX_COMMITTEE_CALLS_PER_DAY = 20/);
console.log(JSON.stringify({ ok: true, sensorCycleMs: 540000, sensorHttpMs: request.timeoutMs,
  delayedStartupAndControlsMs: request.at, completeWithCleanupMs: completed.exits[0].at,
  watchdogMs: hung.exits[0].at, cadenceMs, watchdogBeforeNextCycleMs: cadenceMs - hung.exits[0].at,
  httpDeadlineBoundary: true, delayedStartupWatchdogWins: true, profileDeadlinesUnchanged: true, syntheticOnly: true }, null, 2));
