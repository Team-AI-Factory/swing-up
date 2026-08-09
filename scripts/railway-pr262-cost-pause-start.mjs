import { spawn } from "node:child_process";

const branch = (process.env.RAILWAY_GIT_BRANCH || "").trim();
const environment = (process.env.RAILWAY_ENVIRONMENT_NAME || "").trim().toLowerCase();
const port = process.env.PORT || "3000";

function launch(command, args, env = process.env) {
  return spawn(command, args, { stdio: "inherit", env });
}

if (branch === "agent/combined-opportunity-engine") {
  const env = {
    ...process.env,
    SWING_UP_PR262_CONTINUOUS_SCANNING_ENABLED: "false",
    SWING_UP_BRANCH_LAB_SCHEDULER_OWNER: "paused_cost_control",
  };

  console.log("[swing-up-cost-control] PR #262 continuous Railway scanning is HARD PAUSED. Starting web preview only; no scanner worker is spawned.");
  const app = launch("npm", ["run", "start", "--", "--hostname", "0.0.0.0", "--port", port], env);

  const stop = (signal) => {
    if (!app.killed) app.kill(signal);
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));

  app.on("exit", (code, signal) => {
    const exitCode = code ?? (signal ? 1 : 0);
    console.error(`[swing-up-cost-control] web preview exited code=${exitCode}`);
    process.exit(exitCode);
  });
} else {
  console.log(`[swing-up-cost-control] branch=${branch || "unknown"} environment=${environment || "unknown"}; delegating to normal Railway startup.`);
  const supervisor = launch(process.execPath, ["scripts/railway-branch-start-resumable.mjs"]);
  supervisor.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}
