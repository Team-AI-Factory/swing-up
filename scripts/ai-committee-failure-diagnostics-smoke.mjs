import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

function load(path, dependencies = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (name in dependencies) return dependencies[name];
    if (["@/lib/ai-committee/review-policy", "@/lib/equity-signal/us-market-calendar"].includes(name)) return loadTsModule(name);
    throw new Error(`Unexpected import: ${name}`);
  }, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
const agents = load("lib/ai-committee/agents.ts");
const provider = load("lib/ai-committee/provider.ts");
const committee = load("lib/ai-committee/orchestrator.ts", {
  "@/lib/ai-committee/agents": agents,
  "@/lib/ai-committee/provider": provider,
  "@/lib/ai-committee/evidence-pack": { buildAiCommitteeEvidencePack: () => { throw new Error("Unexpected persistence read"); } },
  "@/lib/ai-committee/run-persistence": { persistAiCommitteeRun: () => { throw new Error("Unexpected persistence write"); } },
});
const section = { available: true, strength: "strong", summary: "Verified input", items: [] };
const pack = {
  assetClass: "public_equity", candidateAlertId: "provider-diagnostic-regression", rawSignalIds: [], ticker: "EXM", company: "Example Corp",
  actionLabel: "Research", eventHeadline: "Verified event", whatHappened: "Source-backed change", sourceNames: ["SEC"], sourceLinks: ["https://www.sec.gov/example"], sourceFreshness: [], sourceHealth: [],
  filingEvidence: section, newsEvidence: { ...section, items: [{ primarySource: true }] }, priceVolumeEvidence: section, fundamentalsEvidence: section,
  macroEvidence: section, fdaRegulatoryEvidence: section, cryptoFxEvidence: section, finraShortPressureEvidence: section,
  wikidataRippleRelationships: section, historicalPatternMatch: section, previousSimilarOutcomes: section,
  score: {}, currentRiskLabels: [], missingEvidence: [], dataFreshnessWarnings: [],
};
const input = { [committee.TRUSTED_IN_MEMORY_EVIDENCE]: pack, persistResult: false, mode: "preview", dryRun: false, confirmRun: true, maxAgents: 13, maxCostUsd: 0.75 };
const keys = ["OPENAI_API_KEY", "OPENAI_MODEL", "AI_COMMITTEE_ENABLED", "AI_COMMITTEE_DRY_RUN_DEFAULT", "AI_COMMITTEE_FAST_MODEL", "AI_COMMITTEE_DEEP_MODEL", "AI_COMMITTEE_FINAL_MODEL", "AI_COMMITTEE_MODEL_ALLOWLIST"];
const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
const originalInfo = console.info;
const usage = { prompt_tokens: 123, completion_tokens: 37, total_tokens: 160 };
function completed() {
  return Response.json({ choices: [{ message: { content: JSON.stringify({ verdict: "positive", confidence: 95, keyFindings: ["Supported"], supportingEvidence: [], concerns: [], missingData: [], riskNotes: [], followUpChecks: [] }) }, finish_reason: "stop" }], usage });
}
try {
  process.env.OPENAI_API_KEY = "test-secret-must-not-leak";
  process.env.OPENAI_MODEL = "gpt-4.1-mini";
  process.env.AI_COMMITTEE_ENABLED = "true";
  process.env.AI_COMMITTEE_DRY_RUN_DEFAULT = "false";
  for (const key of keys.filter(key => /_MODEL$|MODEL_ALLOWLIST/.test(key) && key !== "OPENAI_MODEL")) delete process.env[key];
  console.info = () => {};

  for (const [httpStatus, code, category] of [[401, "invalid_api_key", "authentication"], [403, "permission_denied", "permission"], [429, "insufficient_quota", "quota"], [429, "credit_balance_exhausted", "quota"], [429, "project_spend_limit_exceeded", "quota"], [429, "rate_limit_exceeded", "rate_limit"], [400, "unsupported_parameter", "invalid_request"], [503, "service_unavailable", "unavailable"]]) {
    let requests = 0;
    globalThis.fetch = async () => {
      requests++;
      return Response.json({ error: { code, message: "test-secret-must-not-leak private prompt text" } }, { status: httpStatus, headers: { "x-request-id": "req_safe_correlation_123", "retry-after": "30" } });
    };
    const failed = await committee.runAiCommittee(input);
    assert.equal(requests, 1, "A shared provider failure must not trigger fourteen doomed requests");
    assert.equal(failed.ok, false);
    assert.equal(failed.status, "agent_failures");
    assert.equal(failed.plannedAgents.length, 14);
    assert.equal(failed.agentResults.filter(result => result.status === "blocked").length, 13);
    assert.equal(failed.agentResults[0].providerFailure.category, category);
    assert.equal(failed.agentResults[0].providerFailure.httpStatus, httpStatus);
    assert.equal(failed.agentResults[0].providerFailure.code, code);
    assert.equal(failed.agentResults[0].providerFailure.requestId, "req_safe_correlation_123");
    assert.equal(failed.committeeOutput.overallRecommendation, "needs_more_data");
    assert.equal(failed.committeeOutput.modelUsageSummary.actualOpenAiUsage.responsesWithUsage, 0);
    assert.equal(failed.committeeOutput.modelUsageSummary.roleDiagnostics.length, 14);
    assert.doesNotMatch(JSON.stringify(failed), /test-secret-must-not-leak|private prompt text/);
  }

  let requests = 0;
  globalThis.fetch = async () => ++requests === 1 ? completed() : Response.json({ error: { code: "insufficient_quota" } }, { status: 429 });
  const partial = await committee.runAiCommittee(input);
  assert.equal(requests, 2);
  assert.equal(partial.ok, false);
  assert.equal(partial.agentResults.filter(result => result.status === "completed").length, 1);
  assert.equal(partial.committeeOutput.modelUsageSummary.actualOpenAiUsage.responsesWithUsage, 1);
  assert.equal(partial.committeeOutput.modelUsageSummary.actualOpenAiUsage.tokens.totalTokens, 160, "Known partial usage must survive a later refusal");

  requests = 0;
  const abort = new AbortController();
  globalThis.fetch = async () => {
    if (++requests === 1) return completed();
    return { ok: true, json: async () => { abort.abort(new Error("cycle_deadline")); throw abort.signal.reason; } };
  };
  const cancelled = await committee.runAiCommittee({ ...input, signal: abort.signal });
  assert.equal(requests, 2);
  assert.equal(cancelled.ok, false);
  assert.equal(cancelled.agentResults[1].providerFailure.category, "cancelled");
  assert.equal(cancelled.committeeOutput.modelUsageSummary.actualOpenAiUsage.tokens.totalTokens, 160, "Body cancellation must preserve earlier roles' usage");

  globalThis.fetch = async () => Response.json({ error: { code: "secret-value-that-is-not-a-known-code", message: "test-secret-must-not-leak" } }, { status: 400, headers: { "x-request-id": "not safe identifier" } });
  const redacted = await committee.runAiCommittee(input);
  assert.equal(redacted.agentResults[0].providerFailure.code, undefined);
  assert.equal(redacted.agentResults[0].providerFailure.requestId, undefined);

  requests = 0;
  globalThis.fetch = async (_url, options) => {
    requests++;
    const body = JSON.parse(options.body);
    assert.deepEqual(body.response_format, { type: "json_object" }, "JSON must be enforced by the provider contract, not just prose");
    assert.ok(body.max_tokens <= 800, "Reliable formatting must preserve the existing token-cost bound");
    assert.match(body.messages[0].content, /entire response must fit \d+ output tokens/);
    assert.match(body.messages[0].content, /at most two short items/);
    return completed();
  };
  const success = await committee.runAiCommittee(input);
  assert.equal(requests, 14, "A healthy provider must still complete every specialist and the Final Judge");
  assert.equal(success.ok, true);
  assert.equal(success.status, "completed");
  assert.equal(success.committeeOutput.overallRecommendation, "approve");
  assert.equal(success.committeeOutput.modelUsageSummary.actualOpenAiUsage.tokens.totalTokens, 14 * 160);
  for (const finishReason of ["length", "stop"]) {
    requests = 0;
    globalThis.fetch = async () => { requests++; return Response.json({ choices: [{ message: { content: '{"verdict":"positive",' }, finish_reason: finishReason }], usage }); };
    const unusable = await committee.runAiCommittee(input);
    assert.equal(requests, 14);
    assert.equal(unusable.ok, false);
    assert.equal(unusable.status, "agent_failures");
    assert.equal(unusable.agentResults.filter(result => result.status === "completed").length, 0);
    assert.equal(unusable.committeeOutput.modelUsageSummary.actualOpenAiUsage.responsesWithUsage, 14, "Paid malformed outputs retain all actual token accounting");
    assert.equal(unusable.committeeOutput.modelUsageSummary.roleDiagnostics[0].finishReason, finishReason);
    assert.equal(unusable.agentResults[0].error, finishReason === "length" ? "truncated_json_response" : "invalid_json_response");
    assert.equal(unusable.committeeOutput.overallRecommendation, "needs_more_data");
  }
  globalThis.fetch = async () => Response.json({ choices: [{ message: { content: {} }, finish_reason: "private-unexpected-value" }], usage: {} });
  const malformed = await committee.runAiCommittee(input);
  assert.equal(malformed.ok, false);
  assert.equal(malformed.committeeOutput.modelUsageSummary.actualOpenAiUsage.responsesWithUsage, 0, "Missing usage fields must not count as verified zero-cost responses");
  assert.equal(malformed.agentResults[0].error, "invalid_json_response");
  assert.equal(malformed.agentResults[0].finishReason, undefined, "Only known API finish reasons may enter diagnostics");
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/models");
    assert.equal(options.method, "GET");
    assert.equal(options.body, undefined, "The access probe must never generate billable model output");
    return Response.json({ data: [{ id: "gpt-4.1-mini" }, { id: "unrelated-private-model" }] });
  };
  const access = await provider.probeOpenAiCommitteeProviderAccess();
  assert.equal(access.status, "completed");
  assert.equal(access.modelAvailable.final, true);
  assert.equal(access.callsPaidModel, false);
  assert.equal(access.billingQuotaVerified, false, "Model access does not certify the completion billing quota");
  assert.doesNotMatch(JSON.stringify(access), /unrelated-private-model|test-secret/);
  globalThis.fetch = async () => Response.json({ error: { code: "invalid_api_key", message: "test-secret-must-not-leak" } }, { status: 401 });
  const accessDenied = await provider.probeOpenAiCommitteeProviderAccess();
  assert.equal(accessDenied.failure.category, "authentication");
  assert.equal(accessDenied.failure.httpStatus, 401);
  assert.doesNotMatch(JSON.stringify(accessDenied), /test-secret/);
  console.log("Committee failures: safe diagnostics, stop shared failure cascade, distinguish technical failures, preserve partial usage, focused 3–5 reviewer plans, specialist selection, negative votes and legacy approval.");
  globalThis.fetch = async () => Response.json({ error: {} }, { status: 429 });
  const ambiguous429 = await provider.runOpenAiCommitteeProvider({ tier: "fast", confirmRun: true, dryRun: false, messages: [] });
  assert.equal(ambiguous429.failure.category, "rate_or_quota", "Unrecognized 429 responses must not be labelled a proven rate limit.");

  const policy = loadTsModule("@/lib/ai-committee/review-policy");
  for (const [headline, kind, count, specialist] of [["New verified product", "event", 3, null], ["Earnings guidance raised", "event", 4, "accountant_agent"], ["FDA approval", "event", 4, "industry_agent"], ["Valuation research", "valuation", 4, "valuation_dcf_agent"], ["FDA approval changes revenue guidance", "event", 5, "industry_agent"]]) {
    requests = 0;
    globalThis.fetch = async (_url, options) => {
      requests++;
      const request = JSON.parse(options.body);
      assert.ok(request.max_tokens <= 1000);
      const payload = JSON.parse(request.messages[1].content);
      if (payload.agent.id === "analyst_agent") assert.match(request.messages[0].content, /What happened:/);
      if (payload.agent.id === "final_judge") assert.ok(!payload.agent.requiredInputs.includes("compliance result"));
      return completed();
    };
    const focused = await committee.runAiCommittee({ ...input, reviewPolicy: "focused_v1", maximumPromptBytes: 60000, maxCostUsd: 0.156,
      [committee.TRUSTED_IN_MEMORY_EVIDENCE]: { ...pack, analysisKind: kind, eventHeadline: headline } });
    assert.equal(requests, count);
    assert.equal(focused.ok, true);
    assert.equal(focused.committeeOutput.overallRecommendation, "approve");
    if (specialist) assert.ok(focused.plannedAgents.includes(specialist));
    const proof = { ok: focused.ok, agentsCompleted: count, agentsFailed: 0, output: focused.committeeOutput };
    assert.equal(policy.completeCommitteeReview(proof), true);
    const missingSceptic = structuredClone(proof);
    missingSceptic.output.modelUsageSummary.roleDiagnostics = missingSceptic.output.modelUsageSummary.roleDiagnostics.filter(role => role.agentId !== "skeptic_agent");
    assert.equal(policy.completeCommitteeReview(missingSceptic), false);
    const negative = focused.agentResults.map(role => role.agentId === "skeptic_agent" ? { ...role, verdict: "negative", concerns: ["Verified adverse fact"] } : role);
    assert.equal(committee.committeeConsensusDecision(negative, { reviewPolicy: "focused_v1" }).overallRecommendation, "reject");
  }
  globalThis.fetch = async () => Response.json({ usage });
  const malformedWithUsage = await provider.runOpenAiCommitteeProvider({ tier: "fast", confirmRun: true, dryRun: false, messages: [] });
  assert.equal(malformedWithUsage.ok, false);
  assert.equal(malformedWithUsage.tokenUsage.totalTokens, 160, "A malformed output must preserve real reported usage.");
} finally {
  globalThis.fetch = originalFetch;
  console.info = originalInfo;
  for (const key of keys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}
