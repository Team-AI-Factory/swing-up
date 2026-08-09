import crypto from "node:crypto";
import { spawn } from "node:child_process";

const branch = (process.env.RAILWAY_GIT_BRANCH || "").trim();
const environment = (process.env.RAILWAY_ENVIRONMENT_NAME || "").trim().toLowerCase();
const port = process.env.PORT || "3000";

function launch(command, args, env = process.env) {
  return spawn(command, args, { stdio: "inherit", env });
}

if (branch === "agent/combined-opportunity-engine") {
  const sensorToken = crypto.randomBytes(32).toString("hex");
  const env = {
    ...process.env,
    SWING_UP_PR262_CONTINUOUS_SCANNING_ENABLED: "false",
    SWING_UP_BRANCH_LAB_SCHEDULER_OWNER: "sensor_first_only",
    SWING_UP_PR262_SENSOR_TOKEN: sensorToken,
    SWING_UP_PR262_SENSOR_INTERVAL_SECONDS: process.env.SWING_UP_PR262_SENSOR_INTERVAL_SECONDS || "60",
    SWING_UP_R2_WRITE_PREFIX: "branch-labs/pr-262/",
  };

  console.log("[swing-up-cost-control] OLD PR #262 1-minute/5-minute deep scanners remain HARD PAUSED.");
  console.log("[swing-up-cost-control] Starting web preview plus cheap sensor-first worker only.");
  const app = launch("npm", ["run", "start", "--", "--hostname", "0.0.0.0", "--port", port], env);
  let sensor = launch(process.execPath, ["scripts/railway-pr262-sensor-worker.mjs"], env);

  const stop = (signal) => {
    if (sensor && !sensor.killed) sensor.kill(signal);
    if (!app.killed) app.kill(signal);
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));

  sensor.on("exit", (code, signal) => {
    console.error(`[swing-up-cost-control] sensor worker exited code=${code ?? "null"} signal=${signal ?? "none"}; restarting cheap sensor only.`);
    if (!app.killed) sensor = launch(process.execPath, ["scripts/railway-pr262-sensor-worker.mjs"], env);
  });

  app.on("exit", (code, signal) => {
    if (sensor && !sensor.killed) sensor.kill("SIGTERM");
    const exitCode = code ?? (signal ? 1 : 0);
    console.error(`[swing-up-cost-control] web preview exited code=${exitCode}`);
    process.exit(exitCode);
  });
} else {
  console.log(`[swing-up-cost-control] branch=${branch || "unknown"} environment=${environment || "unknown"}; delegating to normal Railway startup.`);
  const supervisor = launch(process.execPath, ["scripts/railway-branch-start-resumable.mjs"]);
  supervisor.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}
