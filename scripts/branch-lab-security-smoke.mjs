const baseUrl = (process.env.SWING_UP_EVAL_BASE_URL || "http://127.0.0.1:3010").replace(/\/$/, "");
async function json(path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.json().catch(() => null);
  return { response, body };
}

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

console.log(JSON.stringify({ ok: true, performanceSimulationUsed: false, branchLabUnavailableOutsidePreview: true, untrustedEvidenceBlocked: true, openAiCalled: false, databaseWrites: false, publishing: false, notifications: false }, null, 2));
