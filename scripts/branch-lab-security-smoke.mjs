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
if (isolatedGet.response.status !== 404 || isolatedGet.body?.error !== "not_found") throw new Error(`Branch lab was exposed outside an authenticated Railway branch preview (${isolatedGet.response.status}).`);

const isolatedPost = await json("/api/internal/railway-branch-signal-lab", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}",
});
if (isolatedPost.response.status !== 404 || isolatedPost.body?.error !== "not_found") throw new Error(`Branch lab accepted a trigger outside Railway preview (${isolatedPost.response.status}).`);

const untrusted = await json("/api/ai-committee/run", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ candidateAlertId: "untrusted-evidence-test", evidencePack: { candidateAlertId: "untrusted-evidence-test", missingEvidence: [] }, persistResult: false, dryRun: false, confirmRun: true }),
});

if (untrusted.response.ok || untrusted.body?.status !== "evidence_pack_unavailable") throw new Error(`Public committee route accepted untrusted in-memory evidence (${untrusted.response.status}, ${untrusted.body?.status}).`);
if (Array.isArray(untrusted.body?.agentResults) || untrusted.body?.compatibility?.callsOpenAi === true) throw new Error("Untrusted evidence reached the OpenAI execution path.");

const startScript = await readFile(new URL("./railway-branch-start.mjs", import.meta.url), "utf8");
const strippedVariables = startScript.match(/for \(const key of \[([\s\S]*?)\]\) delete env\[key\];/)?.[1] ?? "";
if (!strippedVariables.includes("DATABASE_URL") || !strippedVariables.includes("TELEGRAM_BOT_TOKEN")) throw new Error("Branch startup no longer strips database or notification credentials.");
if (strippedVariables.includes("R2_ACCESS_KEY_ID") || strippedVariables.includes("R2_SECRET_ACCESS_KEY") || strippedVariables.includes("CLOUDFLARE_R2_ACCESS_KEY_ID") || strippedVariables.includes("CLOUDFLARE_R2_SECRET_ACCESS_KEY")) throw new Error("Branch startup strips the Cloudflare R2 state credentials.");
for (const marker of [`SWING_UP_BRANCH_LAB_SCHEDULER_OWNER: "next_server"`, "SWING_UP_BRANCH_LAB_EFFECTIVE_INTERVAL_SECONDS"]) {
  if (!startScript.includes(marker)) throw new Error(`Branch startup does not delegate scanning to the healthy Next.js server: ${marker}`);
}
const instrumentationSource = await readFile(new URL("../instrumentation.ts", import.meta.url), "utf8");
if (!instrumentationSource.includes("startBranchSignalLabRuntimeScheduler")) throw new Error("Next.js instrumentation does not start the branch scanner.");
const schedulerSource = await readFile(new URL("../lib/branch-signal-lab-runtime-scheduler.ts", import.meta.url), "utf8");
for (const marker of ["state.inFlight", "Next.js watchdog recovered an overdue scan", "SWING_UP_BRANCH_LAB_RUNTIME_TOKEN", "RAILWAY_PUBLIC_DOMAIN", "state=Cloudflare R2"]) {
  if (!schedulerSource.includes(marker)) throw new Error(`Next.js branch scanner watchdog policy is missing: ${marker}`);
}

const routeSource = await readFile(new URL("../app/api/internal/railway-branch-signal-lab/route.ts", import.meta.url), "utf8");
for (const marker of [
  `const R2_STATE_KEY = "branch-labs/pr-261/serious-signal/state.json"`,
  `backend: "cloudflare_r2"`,
  `primary: "cloudflare_r2"`,
  `postgresUsed: false`,
  `railwayVolumeUsedAsPrimary: false`,
  `writeVersionedJsonToR2`,
]) {
  if (!routeSource.includes(marker)) throw new Error(`Cloudflare R2 branch-state policy is missing: ${marker}`);
}
const r2Source = await readFile(new URL("../lib/r2-warehouse.ts", import.meta.url), "utf8");
for (const marker of [`"if-match"`, `"if-none-match"`, `res.status === 412`, `readVersionedTextFromR2`, `writeVersionedJsonToR2`]) {
  if (!r2Source.includes(marker)) throw new Error(`Cloudflare R2 conditional-write guard is missing: ${marker}`);
}

console.log(JSON.stringify({ ok: true, performanceSimulationUsed: false, branchLabUnavailableOutsidePreview: true, untrustedEvidenceBlocked: true, cloudflareR2PrimaryState: true, railwayVolumePrimaryState: false, overdueScanWatchdog: true, openAiCalled: false, databaseWrites: false, publishing: false, notifications: false }, null, 2));
