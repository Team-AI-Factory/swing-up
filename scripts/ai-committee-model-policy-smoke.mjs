import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
const policy = loadTsModule("@/lib/ai-committee/model-policy");
const provider = loadTsModule("@/lib/ai-committee/provider");
let ledgerState = null, ledgerRevision = 0;
const ledger = loadTsModule("@/lib/opportunity-engine/pr262-ai-daily-cost", {
  "@/lib/ai-committee/billing-audit": {},
  "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => `synthetic/${key}` },
  "@/lib/r2-warehouse": {
    readVersionedTextFromR2: async () => ledgerState ? { found: true, text: JSON.stringify(ledgerState), etag: String(ledgerRevision) } : { found: false, text: null, etag: null },
    writeVersionedJsonToR2: async (_key, value) => { ledgerState = structuredClone(value); return { written: true, conflict: false, etag: String(++ledgerRevision) }; },
  },
});
async function accounted(run, id) {
  ledgerState = null;
  await ledger.reservePr262AiCommitteeBudget({ candidateFingerprint: id, ticker: "TEST", direction: "upside" });
  return ledger.recordPr262AiCommitteeCost({ openAiCalled: true, candidateFingerprint: id, selectedCandidate: { ticker: "TEST" },
    committee: { output: run.committeeOutput } });
}
const committee = loadTsModule("@/lib/ai-committee/orchestrator", {
  "@/lib/ai-committee/provider": provider,
  "@/lib/ai-committee/evidence-pack": { buildAiCommitteeEvidencePack() { throw new Error("unexpected_read"); } },
  "@/lib/ai-committee/run-persistence": { persistAiCommitteeRun() { throw new Error("unexpected_write"); } },
});
const section = { available: true, strength: "strong", summary: "Synthetic source", items: [] };
const pack = { assetClass: "public_equity", analysisKind: "valuation", candidateAlertId: "synthetic-model-migration", rawSignalIds: [],
  ticker: "TEST", company: "Synthetic Test", actionLabel: "Research", eventHeadline: "Synthetic valuation", whatHappened: "Synthetic test only.",
  sourceNames: ["Synthetic SEC"], sourceLinks: ["https://example.invalid/filing"], sourceFreshness: [], sourceHealth: [],
  filingEvidence: section, newsEvidence: { ...section, items: [{ primarySource: true }] }, priceVolumeEvidence: section,
  fundamentalsEvidence: section, macroEvidence: section, fdaRegulatoryEvidence: section, cryptoFxEvidence: section,
  finraShortPressureEvidence: section, wikidataRippleRelationships: section, historicalPatternMatch: section,
  previousSimilarOutcomes: section, score: {}, currentRiskLabels: [], missingEvidence: [], dataFreshnessWarnings: [] };
const saved = { ...process.env }, fetchBefore = globalThis.fetch, infoBefore = console.info;
let requests = [], reads = 0, scenario = "healthy", logs = [];
const input = { [committee.TRUSTED_IN_MEMORY_EVIDENCE]: pack, persistResult: false, confirmRun: true, dryRun: false,
  mode: "preview", reviewPolicy: "focused_v1", maxCostUsd: policy.AI_COMMITTEE_REVIEW_MAX_COST_USD,
  maximumPromptBytes: 60_000, allowedModels: Object.values(policy.AI_COMMITTEE_ROLE_MODELS) };
try {
  Object.assign(process.env, { OPENAI_API_KEY: "synthetic-key-must-never-leak", AI_COMMITTEE_ENABLED: "true", AI_COMMITTEE_DRY_RUN_DEFAULT: "false",
    SWING_UP_SIMPLE_PILOT_ENABLED: "true", RAILWAY_GIT_BRANCH: "pilot-simple-alerts", RAILWAY_PROJECT_ID: "83d99341-d622-475f-8035-00ef3d0916d1",
    RAILWAY_ENVIRONMENT_ID: "87afb8d7-c4fc-4f84-92b6-5d2820a689b6", SWING_UP_PR262_STORAGE_PREFIX: "branch-labs/simple-alerts/",
    SWING_UP_R2_WRITE_PREFIX: "branch-labs/simple-alerts/", AI_COMMITTEE_FAST_MODEL: "gpt-6-luna", AI_COMMITTEE_DEEP_MODEL: "gpt-6.1-sol",
    AI_COMMITTEE_FINAL_MODEL: "gpt-6-astra", AI_COMMITTEE_MODEL_ALLOWLIST: "gpt-6-luna,gpt-6.1-sol,gpt-6-astra" });
  console.info = (...args) => logs.push(args);
  globalThis.fetch = async (url, init) => {
    if (url === "https://api.openai.com/v1/models") {
      reads++; assert.equal(init.method, "GET"); assert.equal(init.body, undefined);
      return Response.json({ error: { code: "permission_denied", message: "synthetic-key-must-never-leak" } }, { status: 403 });
    }
    assert.equal(url, "https://api.openai.com/v1/chat/completions");
    const request = JSON.parse(init.body); requests.push(request);
    assert.ok(init.signal instanceof AbortSignal);
    assert.equal(request.service_tier, "default"); assert.equal(request.n, 1);
    assert.equal(request.max_completion_tokens, 4096); assert.equal(request.max_tokens, undefined);
    assert.equal(request.reasoning_effort, "low"); assert.equal(request.verbosity, "low");
    assert.equal(request.temperature, undefined); assert.equal(request.tools, undefined);
    assert.equal(request.messages[0].role, "developer", "Reasoning-model instructions use the current developer role");
    if (scenario === "schema_error") return Response.json({ error: { code: "invalid_request_error", message: "private prompt not for logs" } }, { status: 400 });
    const agent = JSON.parse(request.messages[1].content).agent.id;
    if (agent === "analyst_agent") assert.equal(request.response_format.json_schema.strict, true);
    const output = { agentId: agent, verdict: "needs_more_data", confidence: 70,
      keyFindings: ["Company: Synthetic", "What happened: Synthetic", "Why it matters: Synthetic", "Possible outcome: Unknown", "Risks: Missing evidence"],
      supportingEvidence: ["sourceLinks[0]"], concerns: [], missingData: ["Verified sustainable earnings"], suggestedActionLabel: "Research only", riskNotes: [], followUpChecks: [] };
    const details = { cached_tokens: 500, cache_write_tokens: 1000 };
    if (scenario === "missing_cache") delete details.cache_write_tokens;
    if (scenario === "missing_cache_read") delete details.cached_tokens;
    if (scenario === "invalid_cache") details.cache_write_tokens = 3000;
    return Response.json({ model: scenario === "unknown_model" ? "unrecognized-model-private-text" : request.model,
      service_tier: scenario === "wrong_tier" ? "priority" : "default",
      choices: [{ message: { content: JSON.stringify(output) }, finish_reason: scenario === "truncated" && agent === "analyst_agent" ? "length" : "stop" }],
      usage: { prompt_tokens: 3000, completion_tokens: 1500, total_tokens: 4500,
        prompt_tokens_details: details, completion_tokens_details: { reasoning_tokens: 1000 } } });
  };
  assert.equal(provider.getAiCommitteeProviderStatus().requestTimeoutMs, 60_000);
  assert.equal(policy.AI_COMMITTEE_REVIEW_MAX_COST_USD, 1.9346);
  const completed = await committee.runAiCommittee(input);
  assert.equal(completed.ok, true);
  assert.equal(reads, 1, "Models Read403 must not be mistaken for completion403");
  assert.deepEqual(requests.map(row => row.model), ["gpt-6.1-sol", "gpt-6.1-sol", "gpt-6.1-sol", "gpt-6-astra"]);
  assert.equal(completed.committeeOutput.overallRecommendation, "needs_more_data");
  const usage = completed.committeeOutput.modelUsageSummary.actualOpenAiUsage;
  assert.equal(usage.byModel["gpt-6.1-sol"].cacheWritePromptTokens, 3000);
  assert.equal(usage.byModel["gpt-6-astra"].cacheWritePromptTokens, 1000);
  assert.equal(usage.tokens.completionTokens, 6000, "Reasoning is already included and must not be added twice");
  assert.equal(usage.tokens.reasoningTokens, 4000);
  assert.equal(usage.byModel["gpt-6.1-sol"].pricingVerified, true);
  assert.equal((await accounted(completed, "complete")).entry.costUsd, 0.16465, "Real provider/orchestrator receipts must reach model-specific ledger pricing");
  scenario = "missing_cache"; requests = [];
  const missingCache = await committee.runAiCommittee(input);
  assert.equal(missingCache.ok, true); assert.equal(requests.length, 4);
  assert.equal(missingCache.committeeOutput.modelUsageSummary.actualOpenAiUsage.byModel["gpt-6.1-sol"].pricingVerified, true);
  assert.equal(missingCache.committeeOutput.modelUsageSummary.actualOpenAiUsage.byModel["gpt-6.1-sol"].cacheWritePromptTokens, undefined);
  assert.equal(missingCache.committeeOutput.modelUsageSummary.actualOpenAiUsage.tokens.cacheWritePromptTokens, undefined);
  const cachePending = await accounted(missingCache, "missing-write");
  assert.equal(cachePending.entry.costUsd, 0.12065);
  assert.equal(cachePending.entry.pendingUpperBoundUsd, 0.05);
  scenario = "missing_cache_read"; requests = [];
  const missingCacheRead = await committee.runAiCommittee(input);
  assert.equal(missingCacheRead.ok, true);
  assert.equal(missingCacheRead.committeeOutput.modelUsageSummary.actualOpenAiUsage.byModel["gpt-6.1-sol"].cacheReadUsageReported, false);
  assert.equal(missingCacheRead.committeeOutput.modelUsageSummary.actualOpenAiUsage.byModel["gpt-6.1-sol"].cacheWritePromptTokens, undefined);
  const readPending = await accounted(missingCacheRead, "missing-read");
  assert.equal(readPending.entry.costUsd, 0.12);
  assert.equal(readPending.entry.pendingUpperBoundUsd, 0.06);
  for (scenario of ["invalid_cache", "unknown_model", "wrong_tier", "schema_error"]) {
    requests = [];
    const failed = await committee.runAiCommittee(input);
    assert.equal(requests.length, 1, "Unverified pricing or schema errors must stop later paid roles");
    assert.equal(failed.ok, false); assert.equal(failed.committeeOutput.overallRecommendation, "needs_more_data");
    if (scenario !== "schema_error") assert.equal(failed.committeeOutput.modelUsageSummary.actualOpenAiUsage.byModel["gpt-6.1-sol"].pricingVerified, false);
  }
  scenario = "truncated"; requests = [];
  const truncated = await committee.runAiCommittee(input);
  assert.equal(truncated.ok, false); assert.equal(requests.length, 4);
  assert.equal(truncated.agentResults[0].error, "truncated_json_response");
  assert.equal(truncated.committeeOutput.modelUsageSummary.actualOpenAiUsage.responsesWithUsage, 4);
  assert.equal(reads, 1, "Compatibility read is bounded to one per worker");
  requests = [];
  process.env.AI_COMMITTEE_DEEP_MODEL = "gpt-6-astra";
  const mismatch = await provider.runOpenAiCommitteeProvider({ tier: "deep", confirmRun: true, dryRun: false, messages: [] });
  assert.equal(mismatch.status, "model_not_allowed"); assert.equal(requests.length, 0);
  process.env.AI_COMMITTEE_DEEP_MODEL = "synthetic-key-must-never-leak";
  process.env.AI_COMMITTEE_MODEL_ALLOWLIST += ",synthetic-key-must-never-leak";
  await provider.runOpenAiCommitteeProvider({ tier: "deep", confirmRun: true, dryRun: false, messages: [] });
  assert.doesNotMatch(JSON.stringify(logs), /synthetic-key-must-never-leak|private prompt|unrecognized-model-private-text/);
  console.log("GPT-6 exact routing, bounded parameters, read403 independence, per-model usage, pricing uncertainty and sanitized diagnostics passed; no real calls.");
} finally {
  globalThis.fetch = fetchBefore; console.info = infoBefore;
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
}
