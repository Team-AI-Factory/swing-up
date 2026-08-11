import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const pr262Branch = "agent/combined-opportunity-engine";
const pauseEntryPoints = [
  "scripts/railway-pr262-cost-pause-start.mjs",
  "scripts/railway-branch-start-resumable.mjs",
  "scripts/railway-branch-start.mjs",
  "scripts/railway-pr262-sensor-worker.mjs",
];
const legacyLaunchers = pauseEntryPoints.slice(1, 3);

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "swing-up-pr262-pause-"));
const fakeNpmPath = path.join(temporaryDirectory, "npm");

try {
  await writeFile(
    fakeNpmPath,
    "#!/bin/sh\nprintf 'spawned\\n' >> \"${PR262_SPAWN_SENTINEL}\"\nexit 97\n",
    "utf8",
  );
  await chmod(fakeNpmPath, 0o755);

  for (const relativeEntryPoint of pauseEntryPoints) {
    const sentinelPath = path.join(temporaryDirectory, `${path.basename(relativeEntryPoint)}.spawned`);
    const { stdout } = await execFileAsync(process.execPath, [relativeEntryPoint], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        PATH: `${temporaryDirectory}${path.delimiter}${process.env.PATH || ""}`,
        PR262_SPAWN_SENTINEL: sentinelPath,
        RAILWAY_GIT_BRANCH: `  ${pr262Branch}  `,
        RAILWAY_ENVIRONMENT_NAME: "preview",
        RAILWAY_PROJECT_ID: "pr262-runtime-pause-smoke",
      },
      timeout: 3_000,
    });

    assert.match(stdout, /HARD PAUSED/, `${relativeEntryPoint} did not report the binding PR #262 pause`);
    assert.equal(
      await exists(sentinelPath),
      false,
      `${relativeEntryPoint} attempted to launch npm while PR #262 was paused`,
    );
  }

  for (const branchValue of ["", "main", "unexpected-branch"]) {
    const sentinelPath = path.join(temporaryDirectory, `cost-pause-${branchValue || "missing"}.spawned`);
    const { stdout } = await execFileAsync(process.execPath, [pauseEntryPoints[0]], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        PATH: `${temporaryDirectory}${path.delimiter}${process.env.PATH || ""}`,
        PR262_SPAWN_SENTINEL: sentinelPath,
        RAILWAY_GIT_BRANCH: branchValue,
        RAILWAY_ENVIRONMENT_NAME: "preview",
        RAILWAY_PROJECT_ID: "pr262-runtime-pause-smoke",
      },
      timeout: 3_000,
    });
    assert.match(stdout, /HARD PAUSED/, "The Railway-configured PR #262 launcher must pause even when branch metadata is missing or wrong");
    assert.equal(await exists(sentinelPath), false, "The Railway-configured PR #262 launcher must never delegate to npm");
  }

  const railwayConfiguration = JSON.parse(await readFile(path.join(repositoryRoot, "railway.json"), "utf8"));
  assert.equal(
    railwayConfiguration.deploy?.startCommand,
    "node scripts/railway-pr262-cost-pause-start.mjs",
    "Railway must enter through the PR #262 hard-pause launcher",
  );
  assert.equal(
    railwayConfiguration.deploy?.restartPolicyType,
    "ON_FAILURE",
    "Railway must not restart the successful hard-pause exit",
  );

  for (const relativeEntryPoint of legacyLaunchers) {
    const source = await readFile(path.join(repositoryRoot, relativeEntryPoint), "utf8");
    const labBranches = source.match(/const LAB_BRANCHES = new Set\(\[([\s\S]*?)\]\);/)?.[1] || "";
    const pauseGuardIndex = source.indexOf("if (branch === PR262_BRANCH)");
    const applicationLaunchIndex = source.indexOf('child = launch("npm"');
    const workerLaunchIndex = source.indexOf("worker = launch(process.execPath");

    assert.equal(
      labBranches.includes(pr262Branch),
      false,
      `${relativeEntryPoint} still registers PR #262 as a legacy lab branch`,
    );
    assert.equal(
      source.includes("branch-labs/pr-262/"),
      false,
      `${relativeEntryPoint} still exposes the legacy PR #262 R2 worker namespace`,
    );
    assert.ok(pauseGuardIndex >= 0, `${relativeEntryPoint} is missing the explicit PR #262 rejection guard`);
    assert.ok(
      applicationLaunchIndex < 0 || pauseGuardIndex < applicationLaunchIndex,
      `${relativeEntryPoint} can launch the web application before rejecting PR #262`,
    );
    assert.ok(
      workerLaunchIndex < 0 || pauseGuardIndex < workerLaunchIndex,
      `${relativeEntryPoint} can launch a worker before rejecting PR #262`,
    );
  }

  const middlewareSource = await readFile(path.join(repositoryRoot, "middleware.ts"), "utf8");
  assert.match(middlewareSource, /matcher:\s*\["\/api\/:path\*"\]/, "The hard-pause middleware must cover every API route");
  assert.match(middlewareSource, /pr262_runtime_hard_paused/, "The API barrier must return the PR #262 hard-pause marker");
  assert.match(middlewareSource, /request\.nextUrl\.pathname === "\/api\/health" && request\.method === "GET"/, "Only the read-only health endpoint may bypass the API barrier");

  const sensorRouteSource = await readFile(
    path.join(repositoryRoot, "app/api/internal/combined-opportunity-engine/change-sensor/route.ts"),
    "utf8",
  );
  const hardPauseIndex = sensorRouteSource.indexOf("if (PR262_RUNTIME_HARD_PAUSED) return false");
  const localBypassIndex = sensorRouteSource.indexOf("SWING_UP_COMBINED_ENGINE_ALLOW_LOCAL");
  assert.ok(hardPauseIndex >= 0 && hardPauseIndex < localBypassIndex, "The change-sensor route must reject PR #262 before any local bypass");

  const legacyRouteSource = await readFile(
    path.join(repositoryRoot, "app/api/internal/railway-branch-signal-lab/route.ts"),
    "utf8",
  );
  const pr262RouteRejection = legacyRouteSource.indexOf("if (branch === COMBINED_BRANCH) return false");
  const legacyLocalBypass = legacyRouteSource.indexOf("SWING_UP_BRANCH_LAB_ALLOW_LOCAL");
  assert.ok(pr262RouteRejection >= 0 && pr262RouteRejection < legacyLocalBypass, "The legacy branch route must reject PR #262 before any local bypass");

  const workflowDirectory = path.join(repositoryRoot, ".github", "workflows");
  const workflowNames = (await readdir(workflowDirectory)).filter((name) => name.endsWith(".yml"));
  const liveExecutionMarkers = [
    "swing-up-swing-up-pr-262.up.railway.app",
    "COMBINED_ENGINE_RAILWAY_URL:",
    "branch-preview-smoke.mjs",
    "smoke:combined-opportunity-engine-live",
    "build:combined-opportunity-engine-calibration-dataset",
    "build:technical-risk-calibration-dataset",
  ];

  for (const workflowName of workflowNames) {
    const workflow = await readFile(path.join(workflowDirectory, workflowName), "utf8");
    const triggerBlock = workflow.match(/^on:\n([\s\S]*?)(?=^[a-zA-Z])/m)?.[1] || "";
    const manualOnly =
      triggerBlock.includes("workflow_dispatch:") &&
      !/^  (?:push|pull_request|schedule):/m.test(triggerBlock);

    if (manualOnly) continue;

    const steps = workflow.split(/\n(?=      - name:)/);
    for (const step of steps) {
      if (!liveExecutionMarkers.some((marker) => step.includes(marker))) continue;
      assert.match(
        step,
        /\n        if: (?:\$\{\{ )?github\.event_name == 'workflow_dispatch'/,
        `${workflowName} has an automatic step that can contact a live preview or market-data provider`,
      );
    }
  }

  console.log("PR #262 runtime pause smoke passed: no web/worker launch, all API routes blocked except health, and no automatic live-preview or live-provider workflow step.");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
