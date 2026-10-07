import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { inSimpleAlertPilot } from "./helpers/simple-alert-pilot-fixture.mjs";

// These SEC-derived inputs were reconstructed after the incident. The original
// paid prompt was not persisted, so this is expressly not a historical replay.
const pack = JSON.parse(readFileSync(new URL("./fixtures/committee-serv-reconstructed-2026-10-07/evidence-pack.json", import.meta.url), "utf8"));
const original = structuredClone(pack);
const textModule = loadTsModule("@/lib/ai-committee/evidence-text-references");
const provider = loadTsModule("@/lib/ai-committee/provider");
const promptInput = loadTsModule("@/lib/ai-committee/prompt-input");
const policy = loadTsModule("@/lib/ai-committee/model-policy");
const oldInstructions = textModule.SHARED_EVIDENCE_TEXT_INSTRUCTIONS;
function restore(value, dictionary, embeddedOnly = false) {
  if (Array.isArray(value)) return value.map(item => restore(item, dictionary, embeddedOnly));
  if (value && typeof value === "object") {
    if (Object.keys(value).length === 1 && Array.isArray(value.verbatimTextParts)) {
      return value.verbatimTextParts.map(part => restore(part, dictionary)).join("");
    }
    if (!embeddedOnly && Object.keys(value).length === 1 && typeof value.verbatimTextRef === "string") {
      assert.ok(Object.hasOwn(dictionary, value.verbatimTextRef));
      return dictionary[value.verbatimTextRef];
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, restore(item, dictionary, embeddedOnly)]));
  }
  return value;
}
// Restore only the new embedded representation to reproduce the previous
// exact-whole-field encoding while retaining its dictionary and instructions.
const oldModule = { ...textModule, SHARED_EVIDENCE_TEXT_INSTRUCTIONS: oldInstructions,
  referenceRepeatedEvidenceText: value => {
    const encoded = textModule.referenceRepeatedEvidenceText(value);
    return { ...encoded, embeddedReferences: 0, evidencePack: restore(encoded.evidencePack, encoded.sharedEvidenceTexts, true) };
  } };
let captured = [], transport = [], fetchCalls = 0;
function committee(module) {
  return loadTsModule("@/lib/ai-committee/orchestrator", {
    "@/lib/ai-committee/evidence-text-references": module,
    "@/lib/ai-committee/prompt-input": { ...promptInput, committeePromptPreflight: options => {
      const failure = promptInput.committeePromptPreflight(options);
      // Whole-review preflight now stops oversized base prompts before the
      // provider wrapper is invoked. Capture that exact pure-gate input.
      if (failure && !captured.length) captured.push(structuredClone(options));
      return failure;
    } },
    "@/lib/ai-committee/evidence-pack": { buildAiCommitteeEvidencePack() { throw Error("unexpected_read"); } },
    "@/lib/ai-committee/run-persistence": { persistAiCommitteeRun() { throw Error("unexpected_write"); } },
    "@/lib/ai-committee/provider": { ...provider, runOpenAiCommitteeProvider: async options => {
      assert.equal(options.maximumPromptBytes, 60_000);
      captured.push(structuredClone(options));
      return provider.runOpenAiCommitteeProvider(options);
    } },
  });
}
const saved = { ...process.env }, oldFetch = globalThis.fetch, oldInfo = console.info;
const reply = { verdict: "needs_more_data", confidence: 60,
  keyFindings: ["Company: This fixture reconstructs public SEC evidence.", "What happened: Source values retain original reporting dates.",
    "Why it matters: Historical production inputs are unavailable.", "Possible outcome: No investment conclusion follows from this regression.",
    "Risks: Current executable market quote remains absent."],
  supportingEvidence: ["sourceLinks[0]"], concerns: [], missingData: ["A current executable quote is absent from this reconstruction."],
  riskNotes: [], followUpChecks: [], suggestedActionLabel: "Research only" };
const bytes = request => provider.committeePromptInputBytes(request.messages.map(message => ({ ...message, role: message.role === "system" ? "developer" : message.role })),
  request.responseSchema ? { type: "json_schema", json_schema: { ...request.responseSchema, strict: true } } : undefined);
try {
  Object.assign(process.env, { OPENAI_API_KEY: "synthetic-no-network", AI_COMMITTEE_ENABLED: "true", AI_COMMITTEE_DRY_RUN_DEFAULT: "false",
    AI_COMMITTEE_DEEP_MODEL: "gpt-6.1-sol", AI_COMMITTEE_FINAL_MODEL: "gpt-6-astra", AI_COMMITTEE_FAST_MODEL: "gpt-6-luna",
    AI_COMMITTEE_MODEL_ALLOWLIST: "gpt-6.1-sol,gpt-6-astra,gpt-6-luna" });
  console.info = () => {};
  globalThis.fetch = async (url, init) => {
    fetchCalls++;
    if (url.endsWith("/models")) return Response.json({ data: [{ id: "gpt-6.1-sol" }, { id: "gpt-6-astra" }] });
    assert.equal(url, "https://api.openai.com/v1/chat/completions");
    const request = JSON.parse(init.body);
    assert.ok(provider.committeePromptInputBytes(request.messages, request.response_format.type === "json_schema" ? request.response_format : undefined) <= 60_000);
    transport.push(request);
    return Response.json({ model: request.model, service_tier: "default", choices: [{ message: { content: JSON.stringify(reply) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } });
  };
  await inSimpleAlertPilot(async () => {
    const input = { persistResult: false, dryRun: false, confirmRun: true, mode: "preview", reviewPolicy: "focused_v1",
      maximumPromptBytes: 60_000, maxCostUsd: policy.AI_COMMITTEE_REVIEW_MAX_COST_USD, allowedModels: policy.COMMITTEE_ALLOWED_MODELS };
    const baseline = committee(oldModule);
    const before = await baseline.runAiCommittee({ ...input, [baseline.TRUSTED_IN_MEMORY_EVIDENCE]: pack });
    assert.equal(before.agentResults[0].error, "prompt_too_large");
    assert.equal(transport.length, 0);
    assert.equal(fetchCalls, 0, "Intrinsic overflow precedes compatibility reads and model requests");
    assert.equal(before.committeeOutput.modelUsageSummary.actualOpenAiUsage.responsesWithUsage, 0);
    const beforeRequest = captured[0], beforePayload = JSON.parse(beforeRequest.messages[1].content);
    assert.equal(bytes(beforeRequest), 64_017, "Fixture must retain its measured pre-fix overflow");
    captured = []; transport = [];
    const compact = committee(textModule);
    const after = await compact.runAiCommittee({ ...input, [compact.TRUSTED_IN_MEMORY_EVIDENCE]: pack });
    assert.equal(after.ok, true);
    assert.deepEqual(after.plannedAgents, ["analyst_agent", "industry_agent", "accountant_agent", "skeptic_agent", "final_judge"]);
    assert.equal(transport.length, 5);
    assert.deepEqual(transport.map(request => request.model), ["gpt-6.1-sol", "gpt-6.1-sol", "gpt-6.1-sol", "gpt-6.1-sol", "gpt-6-astra"]);
    assert.equal(after.committeeOutput.overallRecommendation, "needs_more_data");
    assert.equal(after.compatibility.publishes, false);
    assert.equal(after.compatibility.sendsTelegram, false);
    assert.deepEqual(captured[0].responseSchema, beforeRequest.responseSchema);
    assert.equal(transport[0].response_format.type, "json_schema");
    assert.equal(transport[0].response_format.json_schema.strict, true);
    assert.equal(captured[0].messages[0].content.replace(` ${textModule.SHARED_EVIDENCE_TEXT_PARTS_INSTRUCTIONS}`, ""), beforeRequest.messages[0].content);
    const sizes = captured.map(bytes);
    for (const [index, request] of captured.entries()) {
      const payload = JSON.parse(request.messages[1].content);
      const restored = restore(payload.evidencePack, payload.sharedEvidenceTexts);
      assert.equal(JSON.stringify(restored), JSON.stringify(restore(beforePayload.evidencePack, beforePayload.sharedEvidenceTexts)),
        "Every role receives byte-identical reconstructed evidence, including facts, dates, units, sources, flags and literals");
      assert.deepEqual(restored.evidenceSections.fundamentals.items, pack.fundamentalsEvidence.items);
      assert.deepEqual(restored.financialDiligence, pack.financialDiligence);
      const previous = after.agentResults.slice(0, index).map(result => Object.fromEntries(Object.entries(result).filter(([key]) => key !== "tokenUsage")));
      assert.equal(JSON.stringify(payload.previousResults), JSON.stringify(previous), "All substantive prior-role outputs stay unchanged");
      assert.ok(sizes[index] <= 60_000);
    }
    // Deliberately engineered boundary test, NOT the missing 71,331-byte live
    // packet. Extra unique bytes test the same overflow magnitude with every
    // role and its accumulated outputs under the unchanged reservation.
    const boundaryPack = structuredClone(pack);
    boundaryPack.financialDiligence.syntheticBoundaryTest = "";
    const framing = Buffer.byteLength(JSON.stringify(boundaryPack)) - Buffer.byteLength(JSON.stringify(pack));
    boundaryPack.financialDiligence.syntheticBoundaryTest = "Synthetic boundary padding only. ".padEnd(71_331 - 64_017 - framing, "z");
    captured = []; transport = [];
    const boundaryBefore = await baseline.runAiCommittee({ ...input, [baseline.TRUSTED_IN_MEMORY_EVIDENCE]: boundaryPack });
    assert.equal(boundaryBefore.agentResults[0].error, "prompt_too_large");
    assert.equal(bytes(captured[0]), 71_331);
    assert.equal(transport.length, 0);
    const boundaryEvidence = restore(JSON.parse(captured[0].messages[1].content).evidencePack,
      JSON.parse(captured[0].messages[1].content).sharedEvidenceTexts);
    captured = []; transport = [];
    const boundaryAfter = await compact.runAiCommittee({ ...input, [compact.TRUSTED_IN_MEMORY_EVIDENCE]: boundaryPack });
    assert.equal(boundaryAfter.ok, true);
    assert.equal(transport.length, 5);
    assert.equal(boundaryAfter.committeeOutput.overallRecommendation, "needs_more_data");
    const boundarySizes = captured.map(bytes);
    for (const request of captured) {
      const payload = JSON.parse(request.messages[1].content);
      assert.equal(JSON.stringify(restore(payload.evidencePack, payload.sharedEvidenceTexts)), JSON.stringify(boundaryEvidence));
      assert.ok(bytes(request) <= 60_000);
    }
    captured = []; transport = [];
    const unique = { ...pack, whatHappened: "Unique evidence with no complete shared receipt. ".repeat(2000) };
    const blocked = await compact.runAiCommittee({ ...input, [compact.TRUSTED_IN_MEMORY_EVIDENCE]: unique });
    assert.equal(blocked.agentResults[0].error, "prompt_too_large");
    assert.equal(transport.length, 0, "Truly unique oversized content still fails before transport");
    assert.equal(blocked.committeeOutput.overallRecommendation, "needs_more_data");
    assert.equal(policy.AI_COMMITTEE_REVIEW_MAX_PROMPT_BYTES, 60_000);
    assert.equal(policy.AI_COMMITTEE_REVIEW_MAX_COST_USD, 2.7538);
    assert.deepEqual(pack, original, "No mutation of gate or evidence inputs");
    console.log(JSON.stringify({ historicalReplay: false, reconstructedPublicSecInputs: true, actualOrchestratorCapture: true,
      networkModelCalls: 0, before: bytes(beforeRequest), after: sizes,
      engineeredBoundaryNotHistorical: { before: 71_331, after: boundarySizes }, exactEvidenceRoundTrip: true,
      priorRoleOutputsPreserved: true, strictJsonSchemaUnchanged: true, uniqueOversizeBlocked: true }));
  });
} finally {
  globalThis.fetch = oldFetch; console.info = oldInfo;
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
}
