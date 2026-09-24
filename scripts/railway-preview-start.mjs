// Validate isolation before loading anything that can start the application.
const environmentName = (process.env.RAILWAY_ENVIRONMENT_NAME ?? "").trim();
const branch = (process.env.RAILWAY_GIT_BRANCH ?? "").trim();
const preview = /^swing-up-pr-([1-9]\d*)$/.exec(environmentName);

if (!preview || !branch || branch.toLowerCase() === "main") {
  console.error("railway_preview_requires_pull_request_environment");
  process.exit(1);
}

const webServiceId = "d02bf6e1-4140-418f-aa5c-b67dcc2d8d15";
if (process.argv.includes("--workers-disabled") || process.env.RAILWAY_SERVICE_ID !== webServiceId) {
  // No application module, network request, storage client or job is loaded.
  // Inert workers do not need live credentials or a writable preview prefix.
  console.log(`[railway-preview] workers_disabled environment=${environmentName} mode=ui_build_only`);
  process.exit(0);
}

const expectedPrefix = `branch-labs/pr-${preview[1]}/`;
if (process.env.SWING_UP_PR262_STORAGE_PREFIX !== expectedPrefix
  || process.env.SWING_UP_R2_WRITE_PREFIX !== expectedPrefix) {
  console.error("railway_preview_storage_prefix_mismatch");
  process.exit(1);
}

const { spawn } = await import("node:child_process");
console.log(`[railway-preview] web_start environment=${environmentName} mode=ui_build_only`);
const child = spawn("npm", ["run", "start"], { stdio: "inherit", env: process.env });
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => child.kill(signal));
}
child.once("error", () => {
  console.error("railway_preview_web_start_failed");
  process.exitCode = 1;
});
child.once("exit", (code) => process.exit(code ?? 1));
