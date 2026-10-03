import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";

const textModule = loadTsModule("@/lib/ai-committee/evidence-text-references");
const { referenceRepeatedEvidenceText: encode, SHARED_EVIDENCE_TEXT_INSTRUCTIONS: instructions } = textModule;
const bytes = value => Buffer.byteLength(JSON.stringify(value));
function restore(value, dictionary) {
  if (Array.isArray(value)) return value.map(item => restore(item, dictionary));
  if (value && typeof value === "object") {
    if (Object.keys(value).length === 1 && typeof value.verbatimTextRef === "string") {
      assert.ok(Object.hasOwn(dictionary, value.verbatimTextRef), "Every reference must resolve inside the same prompt");
      return dictionary[value.verbatimTextRef];
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, restore(item, dictionary)]));
  }
  return value;
}
const exact = "Synthetic quoted source: \"condition remains unmet\".\nภาษาไทย 🧪 ".repeat(100);
const original = { filing: { summary: exact, url: "https://example.invalid/filing", form: "8-K" },
  news: { summary: exact, url: "https://example.invalid/news", contradiction: true },
  array: [exact, "", null, false, 0], unique: exact + "A unique and material condition." };
const unchanged = structuredClone(original);
const encoded = encode(original);
assert.equal(encoded.references, 3);
assert.deepEqual(restore(encoded.evidencePack, encoded.sharedEvidenceTexts), original);
assert.deepEqual(original, unchanged, "Encoding cannot mutate evidence used by approval gates");
assert.equal(encoded.evidencePack.unique, original.unique, "Near duplicates and unique conditions cannot be merged");
assert.ok(bytes(encoded.evidencePack) + bytes(encoded.sharedEvidenceTexts) + bytes(instructions) < bytes(original));
assert.equal(encode({ first: "short", second: "short" }).references, 0);
assert.equal(encode({ unique: exact }).references, 0);
const longUrl = `https://example.invalid/${"source-path/".repeat(100)}`;
assert.equal(encode({ sourceUrl: longUrl, repeatedSourceUrl: longUrl }).references, 0, "Source links remain directly visible");
const collision = { ...original, sourceObject: { verbatimTextRef: "verbatim_1" } };
assert.equal(encode(collision).references, 0, "Existing source keys cannot be confused with generated references");
assert.deepEqual(encode(collision).evidencePack, collision);
const prototypeKey = JSON.parse(`{"__proto__":{"summary":${JSON.stringify(exact)}},"other":${JSON.stringify(exact)}}`);
assert.deepEqual(restore(encode(prototypeKey).evidencePack, encode(prototypeKey).sharedEvidenceTexts), prototypeKey);
assert.equal({}.summary, undefined);

const section = { available: true, strength: "strong", summary: "Synthetic fixture", items: [] };
const pack = { assetClass: "public_equity", candidateAlertId: "synthetic-dedup-proof", rawSignalIds: [], ticker: "TEST", company: "Synthetic Test Corp",
  actionLabel: "Research", eventHeadline: "Earnings guidance lowered", whatHappened: "Synthetic source-backed change, not a live alert.",
  sourceNames: ["Synthetic primary source"], sourceLinks: ["https://example.invalid/test"], sourceFreshness: [], sourceHealth: [],
  filingEvidence: section, newsEvidence: section, priceVolumeEvidence: section, fundamentalsEvidence: section, macroEvidence: section,
  fdaRegulatoryEvidence: section, cryptoFxEvidence: section, finraShortPressureEvidence: section, wikidataRippleRelationships: section,
  historicalPatternMatch: section, previousSimilarOutcomes: section, score: {}, currentRiskLabels: [], missingEvidence: [], dataFreshnessWarnings: [] };
const provider = loadTsModule("@/lib/ai-committee/provider");
let capture = [];
function committee(compact) {
  return loadTsModule("@/lib/ai-committee/orchestrator", {
    "@/lib/ai-committee/evidence-text-references": compact ? textModule : { ...textModule,
      referenceRepeatedEvidenceText: evidencePack => ({ evidencePack, sharedEvidenceTexts: {}, references: 0 }) },
    "@/lib/ai-committee/provider": { ...provider, runOpenAiCommitteeProvider: async options => {
      capture.push(structuredClone(options.messages));
      assert.equal(options.maximumPromptBytes, 60_000);
      assert.ok(options.maxTokens <= 1_000);
      return provider.runOpenAiCommitteeProvider(options);
    } },
    "@/lib/ai-committee/evidence-pack": { buildAiCommitteeEvidencePack() { throw new Error("unexpected_read"); } },
    "@/lib/ai-committee/run-persistence": { persistAiCommitteeRun() { throw new Error("unexpected_write"); } },
  });
}
const savedEnvironment = { ...process.env }, originalFetch = globalThis.fetch, originalInfo = console.info;
let calls = 0;
try {
  Object.assign(process.env, { OPENAI_API_KEY: "synthetic-no-network", OPENAI_MODEL: "gpt-4.1-mini", AI_COMMITTEE_ENABLED: "true", AI_COMMITTEE_DRY_RUN_DEFAULT: "false" });
  for (const key of ["AI_COMMITTEE_MODEL_ALLOWLIST", "AI_COMMITTEE_FINAL_MODEL", "AI_COMMITTEE_DEEP_MODEL", "AI_COMMITTEE_FAST_MODEL"]) delete process.env[key];
  console.info = () => {};
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/chat/completions");
    const request = JSON.parse(options.body);
    assert.ok(bytes(request.messages) <= 60_000);
    calls++;
    return Response.json({ choices: [{ message: { content: JSON.stringify({ verdict: "needs_more_data", confidence: 75,
      keyFindings: ["Synthetic finding: conditions remain unresolved."], supportingEvidence: ["Synthetic source"],
      concerns: ["Synthetic timing limitation."], missingData: ["Synthetic required final terms."], riskNotes: ["Synthetic downside risk."],
      followUpChecks: ["Synthetic updated filing."], suggestedActionLabel: "Research only" }) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } });
  };
  // Representative current runner topology: identical SEC summary in two
  // differently shaped receipt wrappers. This is not a historical live replay.
  const summary = "Synthetic unverified example for regression only. ".repeat(1000).slice(0, 26_100);
  const evidence = { ...pack,
    filingEvidence: { ...section, items: [{ title: "Synthetic earnings guidance", summary, url: "https://example.invalid/test", form: "8-K" }] },
    newsEvidence: { ...section, items: [{ title: "Synthetic earnings guidance", summary, url: "https://example.invalid/test", primarySource: true, official: true, channel: "sec_current_filings" }] },
  };
  const input = { persistResult: false, mode: "preview", dryRun: false, confirmRun: true, reviewPolicy: "focused_v1",
    maximumPromptBytes: 60_000, maxCostUsd: 0.156, allowedModels: ["gpt-4.1-mini", "gpt-4.1-mini-2025-04-14"] };
  const baselineCommittee = committee(false);
  const baseline = await baselineCommittee.runAiCommittee({ ...input, [baselineCommittee.TRUSTED_IN_MEMORY_EVIDENCE]: evidence });
  assert.equal(calls, 3);
  assert.equal(baseline.ok, false);
  assert.equal(baseline.agentResults.at(-1).agentId, "final_judge");
  assert.equal(baseline.agentResults.at(-1).error, "prompt_too_large");
  assert.ok(baseline.agentResults.at(-1).providerFailure.promptBytes > 60_000);
  const baselineMessages = capture;
  capture = []; calls = 0;
  const compactCommittee = committee(true);
  const compact = await compactCommittee.runAiCommittee({ ...input, [compactCommittee.TRUSTED_IN_MEMORY_EVIDENCE]: evidence });
  assert.equal(calls, 4);
  assert.equal(compact.ok, true);
  assert.equal(compact.committeeOutput.overallRecommendation, "needs_more_data", "Removing duplicates cannot supply missing facts or an approval");
  assert.equal(compact.compatibility.publishes, false);
  assert.equal(compact.compatibility.sendsTelegram, false);
  assert.equal(compact.committeeOutput.modelUsageSummary.actualOpenAiUsage.responsesWithUsage, 4);
  assert.equal(baseline.committeeOutput.modelUsageSummary.actualOpenAiUsage.responsesWithUsage, 3, "Known partial usage remains accounted for");
  for (let index = 0; index < capture.length; index++) {
    const before = JSON.parse(baselineMessages[index][1].content), after = JSON.parse(capture[index][1].content);
    const reconstructed = { ...after, evidencePack: restore(after.evidencePack, after.sharedEvidenceTexts) };
    delete reconstructed.sharedEvidenceTexts;
    assert.deepEqual(reconstructed, before, "Every field, role context, source link and previous reviewer result must survive exactly");
    assert.equal(capture[index][0].content, `${baselineMessages[index][0].content} ${instructions}`);
    assert.ok(bytes(capture[index]) < bytes(baselineMessages[index]));
  }
  const finalBefore = bytes(baselineMessages.at(-1)), finalAfter = bytes(capture.at(-1));
  capture = []; calls = 0;
  const uniqueOversized = await compactCommittee.runAiCommittee({ ...input, [compactCommittee.TRUSTED_IN_MEMORY_EVIDENCE]: { ...pack, whatHappened: "Unique synthetic evidence. ".repeat(4000) } });
  assert.equal(calls, 0, "Unique oversized evidence must still fail before the network");
  assert.equal(uniqueOversized.ok, false);
  assert.equal(uniqueOversized.agentResults[0].error, "prompt_too_large");
  assert.equal(uniqueOversized.committeeOutput.overallRecommendation, "needs_more_data");
  console.log(JSON.stringify({ syntheticOnly: true, exactHistoricalReplay: false, finalBefore, finalAfter,
    exactRoundTrip: true, unchangedSixtyKilobyteGate: true, approvalsNotRelaxed: true }));
} finally {
  globalThis.fetch = originalFetch; console.info = originalInfo;
  for (const key of Object.keys(process.env)) if (!(key in savedEnvironment)) delete process.env[key];
  Object.assign(process.env, savedEnvironment);
}
