const baseUrl = (process.env.SWING_UP_EVAL_BASE_URL || "http://127.0.0.1:3010").replace(/\/$/, "");
const token = process.env.SWING_UP_BRANCH_LAB_RUNTIME_TOKEN || "ci-branch-lab-token";

async function json(path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.json().catch(() => null);
  return { response, body };
}

const fixture = await json("/api/internal/railway-branch-signal-lab", {
  method: "POST",
  headers: { "content-type": "application/json", "x-swing-up-branch-lab-token": token },
  body: "{}",
});

if (!fixture.response.ok || fixture.body?.mode !== "railway_branch_fixture_read_only") throw new Error(`Branch fixture route failed (${fixture.response.status}).`);
if (fixture.body?.status !== "qualified_signal_openai_not_requested") throw new Error(`Fixture did not reach the expected prequalified state: ${fixture.body?.status}`);
if (fixture.body?.openAiCalled !== false || fixture.body?.databaseWrites !== false || fixture.body?.publishing !== false || fixture.body?.notifications !== false) throw new Error("Fixture safety side-effect contract failed.");

const untrusted = await json("/api/ai-committee/run", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ candidateAlertId: "untrusted-evidence-test", evidencePack: { candidateAlertId: "untrusted-evidence-test", missingEvidence: [] }, persistResult: false, dryRun: false, confirmRun: true }),
});

if (untrusted.response.ok || untrusted.body?.status !== "evidence_pack_unavailable") throw new Error(`Public committee route accepted untrusted in-memory evidence (${untrusted.response.status}, ${untrusted.body?.status}).`);
if (Array.isArray(untrusted.body?.agentResults) || untrusted.body?.compatibility?.callsOpenAi === true) throw new Error("Untrusted evidence reached the OpenAI execution path.");

console.log(JSON.stringify({ ok: true, fixturePrequalification: fixture.body.status, inputCompleteness: fixture.body.selectedCandidate?.score?.inputCompleteness, liveDataReady: fixture.body.selectedCandidate?.score?.liveDataReady, untrustedEvidenceBlocked: true, openAiCalled: false, databaseWrites: false, publishing: false, notifications: false }, null, 2));
