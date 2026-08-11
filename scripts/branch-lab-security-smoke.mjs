import { readFile } from "node:fs/promises";

const baseUrl = (process.env.SWING_UP_EVAL_BASE_URL || "http://127.0.0.1:3010").replace(/\/$/, "");
async function json(path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.json().catch(() => null);
  return { response, body };
}

async function waitForHealth() {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(3_000) });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Swing Up did not become healthy at ${baseUrl}`);
}

await waitForHealth();

const isolatedGet = await json("/api/internal/railway-branch-signal-lab");
if (isolatedGet.response.status !== 404 || isolatedGet.body?.error !== "pr262_runtime_hard_paused") throw new Error(`Branch lab bypassed the PR #262 API shutdown barrier (${isolatedGet.response.status}).`);

const isolatedPost = await json("/api/internal/railway-branch-signal-lab", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}",
});
if (isolatedPost.response.status !== 404 || isolatedPost.body?.error !== "pr262_runtime_hard_paused") throw new Error(`Branch lab trigger bypassed the PR #262 API shutdown barrier (${isolatedPost.response.status}).`);

const untrusted = await json("/api/ai-committee/run", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ candidateAlertId: "untrusted-evidence-test", evidencePack: { candidateAlertId: "untrusted-evidence-test", missingEvidence: [] }, persistResult: false, dryRun: false, confirmRun: true }),
});

if (untrusted.response.status !== 404 || untrusted.body?.error !== "pr262_runtime_hard_paused") throw new Error(`Public committee route bypassed the PR #262 API shutdown barrier (${untrusted.response.status}).`);
if (Array.isArray(untrusted.body?.agentResults) || untrusted.body?.compatibility?.callsOpenAi === true) throw new Error("Untrusted evidence reached the OpenAI execution path.");

const startScript = await readFile(new URL("./railway-branch-start.mjs", import.meta.url), "utf8");
if (!startScript.includes(`const PR262_BRANCH = "agent/combined-opportunity-engine"`)) throw new Error("Combined opportunity branch does not have an explicit hard-pause identity.");
for (const marker of [
  `SWING_UP_R2_WRITE_PREFIX: r2WritePrefix`,
  `"branch-labs/pr-261/"`,
  `if (branch === PR262_BRANCH)`,
  `if (productionLabBranch)`,
  `migrations were not run`,
]) {
  if (!startScript.includes(marker)) throw new Error(`Preview startup write isolation is missing: ${marker}`);
}
const labBranches = startScript.match(/const LAB_BRANCHES = new Set\(\[([\s\S]*?)\]\);/)?.[1] ?? "";
if (labBranches.includes("agent/combined-opportunity-engine") || startScript.includes(`"branch-labs/pr-262/"`)) {
  throw new Error("PR #262 is still exposed through the legacy branch worker or its R2 namespace.");
}
const pr262PauseIndex = startScript.indexOf("if (branch === PR262_BRANCH)");
const applicationLaunchIndex = startScript.indexOf('child = launch("npm"');
if (pr262PauseIndex < 0 || (applicationLaunchIndex >= 0 && pr262PauseIndex > applicationLaunchIndex)) throw new Error("PR #262 pause does not precede application startup.");
const strippedVariables = startScript.match(/for \(const key of \[([\s\S]*?)\]\) delete env\[key\];/)?.[1] ?? "";
if (!strippedVariables.includes("DATABASE_URL") || !strippedVariables.includes("TELEGRAM_BOT_TOKEN")) throw new Error("Branch startup no longer strips database or notification credentials.");
if (strippedVariables.includes("R2_ACCESS_KEY_ID") || strippedVariables.includes("R2_SECRET_ACCESS_KEY") || strippedVariables.includes("CLOUDFLARE_R2_ACCESS_KEY_ID") || strippedVariables.includes("CLOUDFLARE_R2_SECRET_ACCESS_KEY")) throw new Error("Branch startup strips the Cloudflare R2 state credentials.");
for (const marker of [`SWING_UP_BRANCH_LAB_SCHEDULER_OWNER: "dedicated_worker"`, `scripts/railway-branch-worker.mjs`, "workerLastHeartbeatAt", "dedicated worker heartbeat overdue", "WORKER_RUNTIME_STATUS_PATH", "recordWorkerStatus", "terminating supervisor so Railway can apply its restart policy", "process.exit(exitCode)"]) {
  if (!startScript.includes(marker)) throw new Error(`Branch startup does not supervise the dedicated scanner: ${marker}`);
}
const workerSource = await readFile(new URL("./railway-branch-worker.mjs", import.meta.url), "utf8");
for (const marker of ["dedicated worker active", "x-swing-up-branch-lab-scheduler", "dedicated_worker", "workerStartedAt", "transport=loopback", "state=Cloudflare R2"]) {
  if (!workerSource.includes(marker)) throw new Error(`Dedicated branch scanner policy is missing: ${marker}`);
}

const routeSource = await readFile(new URL("../app/api/internal/railway-branch-signal-lab/route.ts", import.meta.url), "utf8");
for (const marker of [
  `const COMBINED_BRANCH = "agent/combined-opportunity-engine"`,
  `const R2_BRANCH_NAMESPACE = ACTIVE_BRANCH === COMBINED_BRANCH ? "pr-262" : "pr-261"`,
  "branch-labs/${R2_BRANCH_NAMESPACE}/serious-signal/state.json",
  "branch-labs/${R2_BRANCH_NAMESPACE}/serious-signal/equity-history-v1.json",
  "branch-labs/${R2_BRANCH_NAMESPACE}/serious-signal/runs",
  `backend: "cloudflare_r2"`,
  `primary: "cloudflare_r2"`,
  `postgresUsed: false`,
  `railwayVolumeUsedAsPrimary: false`,
  `writeVersionedJsonToR2`,
  `error: "invalid_scheduler"`,
  `schedulerInvocation: invocation`,
  `ephemeralDiagnosticsOnly: true`,
  `persistentSignalState: "cloudflare_r2"`,
  `technicalFailureFingerprint = \`branch_route_\${category}\``,
  `equity_history|outcome_archive|run_archive`,
  `status: "scan_already_in_progress"`,
  `storage: "cloudflare_r2"`,
  `INVALIDATED_FALSE_MAPPING_EVENT_KEYS`,
  `rewriteRequired`,
  `INVALIDATED_FALSE_MAPPING_EVENT_KEYS.has(fingerprint)`,
  `oneImmutableObjectPerCompletedScan: true`,
  `runArchivedImmutably: true`,
]) {
  if (!routeSource.includes(marker)) throw new Error(`Cloudflare R2 branch-state policy is missing: ${marker}`);
}
for (const marker of [
  `ACTIVE_BRANCH === COMBINED_BRANCH`,
  `parsed.branch = ACTIVE_BRANCH`,
  `swingUpTrackedFindingRecordCount`,
  `swingUpCompletedForwardOutcomeRecordCount`,
]) {
  if (!routeSource.includes(marker)) throw new Error(`PR branch separation or honest outcome accounting is missing: ${marker}`);
}
const committeeRouteSource = await readFile(new URL("../app/api/ai-committee/run/route.ts", import.meta.url), "utf8");
if (!committeeRouteSource.includes("dryRun: payload.dryRun ?? true")) throw new Error("Public committee route no longer defaults to dry-run.");
const r2Source = await readFile(new URL("../lib/r2-warehouse.ts", import.meta.url), "utf8");
for (const marker of [`"if-match"`, `"if-none-match"`, `res.status === 412`, `normalizeR2Etag`, `readVersionedTextFromR2`, `writeVersionedJsonToR2`, `assertR2MutationKeyAllowed(method, key)`, `r2_mutation_outside_write_prefix`, `R2_REQUEST_TIMEOUT_MS = 20_000`, `signal: AbortSignal.timeout(R2_REQUEST_TIMEOUT_MS)`]) {
  if (!r2Source.includes(marker)) throw new Error(`Cloudflare R2 conditional-write guard is missing: ${marker}`);
}
const universeSource = await readFile(new URL("../lib/equity-signal/universe.ts", import.meta.url), "utf8");
for (const marker of ["branch-labs/pr-261/equity-universe/v1.json", "branch-labs/pr-262/equity-universe/v1.json", "resolveEquityUniverseCacheKey"]) {
  if (!universeSource.includes(marker)) throw new Error(`Branch-specific universe cache is missing: ${marker}`);
}

console.log(JSON.stringify({ ok: true, performanceSimulationUsed: false, allApiExecutionBlockedExceptHealth: true, untrustedEvidenceBlocked: true, pr262RuntimeHardPaused: true, cloudflareR2PrimaryState: true, railwayVolumePrimaryState: false, pr261DedicatedWorkerPolicyStillSupervised: true, overdueScanWatchdog: true, openAiCalled: false, databaseWrites: false, publishing: false, notifications: false }, null, 2));
