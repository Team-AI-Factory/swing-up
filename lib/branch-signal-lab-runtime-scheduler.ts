const LAB_BRANCH = "agent/live-signal-evaluation-automation";
const HEALTH_TIMEOUT_MS = 120_000;
const WATCHDOG_INTERVAL_MS = 60_000;
const WATCHDOG_OVERDUE_GRACE_MS = 30_000;

type LabReport = {
  stopped?: boolean;
  status?: string;
  repairEligible?: boolean;
};

type SchedulerState = {
  started: boolean;
  inFlight: boolean;
  stopped: boolean;
  nextRunAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  watchdog: ReturnType<typeof setInterval> | null;
};

const schedulerGlobal = globalThis as typeof globalThis & {
  __swingUpBranchLabScheduler?: SchedulerState;
};

function secondsFromEnvironment(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 60 ? parsed : fallback;
}

function branchSchedulerAllowed() {
  const branch = process.env.RAILWAY_GIT_BRANCH?.trim();
  const environment = process.env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase();
  return Boolean(
    process.env.RAILWAY_PROJECT_ID
    && branch === LAB_BRANCH
    && environment
    && environment !== "production"
    && process.env.SWING_UP_BRANCH_LAB_SCHEDULER_OWNER === "next_server"
    && process.env.SWING_UP_BRANCH_LAB_RUNTIME_TOKEN?.trim(),
  );
}

function schedulerState() {
  return schedulerGlobal.__swingUpBranchLabScheduler ??= {
    started: false,
    inFlight: false,
    stopped: false,
    nextRunAt: 0,
    timer: null,
    watchdog: null,
  };
}

function localUrl(path: string) {
  const port = process.env.PORT?.trim() || "3000";
  return `http://127.0.0.1:${port}${path}`;
}

async function waitForHealth() {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(localUrl("/api/health"), { signal: AbortSignal.timeout(5_000) });
      if (response.ok) return true;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return false;
}

async function runLab(normalPollMs: number, technicalRetryMs: number) {
  try {
    const response = await fetch(localUrl("/api/internal/railway-branch-signal-lab"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-swing-up-branch-lab-token": process.env.SWING_UP_BRANCH_LAB_RUNTIME_TOKEN?.trim() || "",
      },
      body: "{}",
      signal: AbortSignal.timeout(240_000),
    });
    const text = await response.text();
    let report: LabReport | null = null;
    try { report = JSON.parse(text) as LabReport; } catch {}
    console.log(`[swing-up-branch-lab] status=${response.status} ${text.slice(0, 12000)}`);
    if (response.status === 409 || report?.stopped === true) return { keepRunning: false, delayMs: normalPollMs };
    const technicalFailure = !response.ok || (report?.status === "technical_failure" && report.repairEligible === true);
    return { keepRunning: true, delayMs: technicalFailure ? technicalRetryMs : normalPollMs };
  } catch (error) {
    console.error(`[swing-up-branch-lab] ${error instanceof Error ? error.message : "run_failed"}`);
    return { keepRunning: true, delayMs: technicalRetryMs };
  }
}

export function startBranchSignalLabRuntimeScheduler() {
  if (!branchSchedulerAllowed()) return false;
  const state = schedulerState();
  if (state.started) return true;
  state.started = true;
  const normalPollMs = secondsFromEnvironment("SWING_UP_BRANCH_LAB_EFFECTIVE_INTERVAL_SECONDS", 300) * 1000;
  const technicalRetryMs = Math.min(normalPollMs, secondsFromEnvironment("SWING_UP_BRANCH_LAB_EFFECTIVE_TECHNICAL_RETRY_SECONDS", 60) * 1000);

  const clearTimers = () => {
    if (state.timer) clearTimeout(state.timer);
    if (state.watchdog) clearInterval(state.watchdog);
    state.timer = null;
    state.watchdog = null;
  };

  const schedule = (delayMs: number) => {
    if (state.stopped) return;
    const safeDelayMs = Math.max(0, delayMs);
    state.nextRunAt = Date.now() + safeDelayMs;
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => void execute(), safeDelayMs);
  };

  const execute = async () => {
    if (state.stopped || state.inFlight) return;
    state.inFlight = true;
    try {
      const next = await runLab(normalPollMs, technicalRetryMs);
      if (!next.keepRunning) {
        state.stopped = true;
        clearTimers();
        return;
      }
      schedule(next.delayMs);
    } finally {
      state.inFlight = false;
    }
  };

  void (async () => {
    if (!(await waitForHealth())) {
      state.started = false;
      console.error("[swing-up-branch-lab] Next.js server health timeout; scheduler did not start.");
      return;
    }
    console.log(`[swing-up-branch-lab] Next.js runtime scheduler active; live polling=${Math.round(normalPollMs / 1000)}s, technical retry=${Math.round(technicalRetryMs / 1000)}s, state=Cloudflare R2.`);
    schedule(0);
    state.watchdog = setInterval(() => {
      if (!state.stopped && !state.inFlight && state.nextRunAt > 0 && Date.now() > state.nextRunAt + WATCHDOG_OVERDUE_GRACE_MS) {
        console.warn("[swing-up-branch-lab] Next.js watchdog recovered an overdue scan.");
        schedule(0);
      }
    }, WATCHDOG_INTERVAL_MS);
  })().catch((error) => {
    state.started = false;
    console.error(`[swing-up-branch-lab] scheduler_start_${error instanceof Error ? error.name.toLowerCase() : "failed"}`);
  });
  return true;
}
