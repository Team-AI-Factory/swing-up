import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";

const provider = loadTsModule("@/lib/ai-committee/provider");
const io = {
  "@/lib/ai-committee/evidence-pack": { buildAiCommitteeEvidencePack() { throw new Error("unexpected_read"); } },
  "@/lib/ai-committee/run-persistence": { persistAiCommitteeRun() { throw new Error("unexpected_write"); } },
};
const committee = loadTsModule("@/lib/ai-committee/orchestrator", io);
const previousCeiling = loadTsModule("@/lib/ai-committee/orchestrator", { ...io,
  "@/lib/ai-committee/provider": { ...provider, runOpenAiCommitteeProvider: options =>
    provider.runOpenAiCommitteeProvider({ ...options, maxTokens: options.responseSchema ? 900 : options.maxTokens }) },
});
const cost = loadTsModule("@/lib/opportunity-engine/pr262-ai-daily-cost", {
  "@/lib/r2-warehouse": {}, "@/lib/ai-committee/billing-audit": {},
  "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => key },
});
const section = { available: true, strength: "strong", summary: "Synthetic verified fixture", items: [] };
const pack = {
  assetClass: "public_equity", analysisKind: "valuation", candidateAlertId: "synthetic-analyst-output", rawSignalIds: [],
  ticker: "TEST", company: "Synthetic Test Corp", actionLabel: "Research", eventHeadline: "Synthetic valuation review",
  whatHappened: "Synthetic valuation inputs, not a live event or a historical AZZ replay.",
  sourceNames: ["Synthetic primary source"], sourceLinks: ["https://example.invalid/source"], sourceFreshness: [], sourceHealth: [],
  filingEvidence: section, newsEvidence: { ...section, items: [{ primarySource: true }] }, priceVolumeEvidence: section,
  fundamentalsEvidence: section, macroEvidence: section, fdaRegulatoryEvidence: section, cryptoFxEvidence: section,
  finraShortPressureEvidence: section, wikidataRippleRelationships: section, historicalPatternMatch: section,
  previousSimilarOutcomes: section, score: {}, currentRiskLabels: [], missingEvidence: [], dataFreshnessWarnings: [],
};
const input = { persistResult: false, mode: "preview", dryRun: false, confirmRun: true, reviewPolicy: "focused_v1",
  maximumPromptBytes: 60_000, maxCostUsd: cost.PR262_REVIEW_MAX_COST_USD, allowedModels: ["gpt-4.1-mini"] };
const findings = ["Company: Synthetic issuer sells test products.", "What happened: Synthetic valuation assumptions remain unconfirmed.",
  "Why it matters: Value depends on those assumptions.", "Possible outcome: Either direction remains possible.", "Risks: Missing evidence prevents approval."];
const output = agentId => ({ agentId, verdict: "needs_more_data", confidence: 70, keyFindings: agentId === "analyst_agent" ? findings : ["Synthetic review"],
  supportingEvidence: ["sourceLinks[0]"], concerns: [], missingData: ["Verified sustainable earnings"], suggestedActionLabel: "Research only", riskNotes: [], followUpChecks: [] });
const saved = { ...process.env }, fetchBefore = globalThis.fetch, infoBefore = console.info;
let scenario = "near_limit", calls = [], capturedSchema;
try {
  Object.assign(process.env, { OPENAI_API_KEY: "synthetic-no-network", OPENAI_MODEL: "gpt-4.1-mini", AI_COMMITTEE_ENABLED: "true", AI_COMMITTEE_DRY_RUN_DEFAULT: "false" });
  for (const key of ["AI_COMMITTEE_MODEL_ALLOWLIST", "AI_COMMITTEE_FINAL_MODEL", "AI_COMMITTEE_DEEP_MODEL", "AI_COMMITTEE_FAST_MODEL"]) delete process.env[key];
  console.info = () => {};
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/chat/completions");
    const request = JSON.parse(options.body), payload = JSON.parse(request.messages[1].content), id = payload.agent.id;
    calls.push(id);
    assert.ok(request.max_tokens <= cost.PR262_REVIEW_MAX_OUTPUT_TOKENS);
    const analyst = id === "analyst_agent";
    if (analyst) {
      assert.equal(request.response_format.type, "json_schema");
      assert.equal(request.response_format.json_schema.strict, true);
      capturedSchema = request.response_format.json_schema;
      const schema = capturedSchema.schema;
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual(schema.required.slice().sort(), Object.keys(schema.properties).sort());
      assert.deepEqual(schema.properties.agentId.enum, ["analyst_agent"]);
      assert.equal(schema.properties.keyFindings.minItems, 5);
      assert.equal(schema.properties.keyFindings.maxItems, 5);
      for (const key of ["supportingEvidence", "concerns", "missingData", "riskNotes", "followUpChecks"]) assert.equal(schema.properties[key].maxItems, 2);
      assert.match(request.messages[0].content, /Aim for 450 tokens/);
      assert.match(request.messages[0].content, /Keep every material blocker explicit/);
      assert.equal(payload.evidencePack.sourceLinks[0], pack.sourceLinks[0], "Compact output references must retain their original source links in the prompt");
      assert.ok(Buffer.byteLength(JSON.stringify(request.messages) + JSON.stringify(request.response_format)) <= 60_000);
    } else assert.deepEqual(request.response_format, { type: "json_object" });
    if (analyst && scenario === "schema_rejected") return Response.json({ error: { code: "invalid_request_error" } }, { status: 400 });
    const result = output(id);
    if (scenario !== "near_limit") Object.assign(result, { verdict: "positive", confidence: 95, missingData: [] });
    let content = JSON.stringify(result), finish_reason = "stop";
    // This is a deterministic representative response budget, not a claimed
    // tokenization or reconstruction of the unavailable live AZZ response.
    const completion_tokens = analyst ? Math.min(930, request.max_tokens) : 80;
    if (analyst && scenario === "near_limit" && request.max_tokens < 930) { content = content.slice(0, -8); finish_reason = "length"; }
    if (analyst && scenario === "length_valid_json") finish_reason = "length";
    if (analyst && scenario === "length_partial_json") { finish_reason = "length"; content = '{"verdict":"positive",'; }
    if (analyst && scenario === "content_filter") finish_reason = "content_filter";
    if (analyst && scenario === "refusal") content = null;
    return Response.json({ choices: [{ message: { content }, finish_reason }],
      usage: { prompt_tokens: 100, completion_tokens, total_tokens: 100 + completion_tokens } });
  };
  const run = module => module.runAiCommittee({ ...input, [module.TRUSTED_IN_MEMORY_EVIDENCE]: pack });
  const baseline = await run(previousCeiling);
  assert.equal(calls.length, 4);
  assert.equal(baseline.agentResults[0].error, "truncated_json_response");
  assert.equal(baseline.ok, false);
  calls = [];
  const corrected = await run(committee);
  assert.equal(calls.length, 4, "No hidden retry or additional paid role may be introduced");
  assert.equal(corrected.ok, true);
  assert.equal(corrected.agentResults[0].tokenUsage.completionTokens, 930);
  assert.equal(corrected.committeeOutput.overallRecommendation, "needs_more_data");
  assert.equal(corrected.committeeOutput.modelUsageSummary.actualOpenAiUsage.responsesWithUsage, 4);
  assert.equal(corrected.compatibility.publishes, false);
  assert.equal(corrected.compatibility.sendsTelegram, false);
  assert.equal(cost.PR262_REVIEW_MAX_COST_USD, 0.156, "Use existing reservation, do not raise the daily or per-review cap");

  for (scenario of ["length_valid_json", "length_partial_json", "content_filter", "refusal"]) {
    calls = [];
    const failed = await run(committee);
    assert.equal(calls.length, 4);
    assert.equal(failed.ok, false);
    assert.equal(failed.agentResults[0].status, "failed");
    assert.equal(failed.committeeOutput.modelUsageSummary.consensus.finalJudgePositive, true, "Even a positive final judge cannot override a failed analyst");
    assert.equal(failed.committeeOutput.overallRecommendation, "needs_more_data");
    assert.equal(failed.committeeOutput.modelUsageSummary.actualOpenAiUsage.responsesWithUsage, 4);
    assert.equal(failed.committeeOutput.modelUsageSummary.actualOpenAiUsage.tokens.completionTokens, 1170, "Failed output must retain its reported cost");
    if (scenario.startsWith("length")) assert.equal(failed.agentResults[0].error, "truncated_json_response");
  }
  scenario = "schema_rejected"; calls = [];
  const rejected = await run(committee);
  assert.equal(calls.length, 1, "Schema rejection fails closed without fallback or retry");
  assert.equal(rejected.ok, false);
  assert.equal(rejected.agentResults.filter(result => result.status === "blocked").length, 3);

  calls = [];
  const blockedCost = await committee.runAiCommittee({ ...input, maxCostUsd: 0.10, [committee.TRUSTED_IN_MEMORY_EVIDENCE]: pack });
  assert.equal(blockedCost.status, "cost_limit_exceeded");
  assert.equal(calls.length, 0);
  const schema = { name: capturedSchema.name, schema: capturedSchema.schema };
  const blockedInput = await provider.runOpenAiCommitteeProvider({ tier: "fast", confirmRun: true, dryRun: false,
    messages: [{ role: "user", content: "x".repeat(100) }], maxTokens: 1000, responseSchema: schema, maximumPromptBytes: 1000 });
  assert.equal(blockedInput.status, "prompt_too_large", "Schema input bytes must be charged against the same enforced byte limit");
  assert.equal(calls.length, 0);
  console.log(JSON.stringify({ syntheticOnly: true, exactLiveReplay: false, analystOutputTokens: 1000, previousLimitReproduced: true,
    strictSchema: true, schemaInputCounted: true, partialJsonStillBlocked: true, failedUsagePreserved: true, reservationUsd: cost.PR262_REVIEW_MAX_COST_USD,
    extraCalls: 0, liveValidationRequired: true }));
} finally {
  globalThis.fetch = fetchBefore; console.info = infoBefore;
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
}
