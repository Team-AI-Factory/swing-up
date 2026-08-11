import { spawn } from "node:child_process";

const branch = (process.env.RAILWAY_GIT_BRANCH || "").trim();
const environment = (process.env.RAILWAY_ENVIRONMENT_NAME || "").trim().toLowerCase();
function launch(command, args, env = process.env) {
  return spawn(command, args, { stdio: "inherit", env });
}

if (branch === "agent/combined-opportunity-engine") {
  console.log("[swing-up-cost-control] PR #262 Railway compute and every scanner are HARD PAUSED during consolidation. Exiting successfully without starting a web server or worker.");
  process.exit(0);
} else {
  console.log(`[swing-up-cost-control] branch=${branch || "unknown"} environment=${environment || "unknown"}; delegating to normal Railway startup.`);
  const supervisor = launch(process.execPath, ["scripts/railway-branch-start-resumable.mjs"]);
  supervisor.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}
