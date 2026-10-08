import assert from "node:assert/strict";
import { restoreCommitteeEvidence as restore } from "./helpers/restore-committee-evidence.mjs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { inSimpleAlertPilot } from "./helpers/simple-alert-pilot-fixture.mjs";

// Synthetic source rows exercise the real collector, audit and role prompts.
// They are not a replay of a live packet or evidence for an investment decision.
const now = new Date("2026-10-06T12:00:00Z");
const fields = [
  ["RevenueFromContractWithCustomerExcludingAssessedTax", "USD"], ["NetIncomeLoss", "USD"],
  ["OperatingIncomeLoss", "USD"], ["CashAndCashEquivalentsAtCarryingValue", "USD"],
  ["Assets", "USD"], ["Liabilities", "USD"], ["StockholdersEquity", "USD"],
  ["CommonStockSharesOutstanding", "shares"], ["EarningsPerShareDiluted", "USD/shares"],
  ["NetCashProvidedByUsedInOperatingActivities", "USD"], ["PaymentsToAcquirePropertyPlantAndEquipment", "USD"],
  ["LongTermDebtNoncurrent", "USD"], ["LongTermDebtCurrent", "USD"], ["GrossProfit", "USD"],
];
const row = (start, end, value) => ({ start, end, val: value, filed: "2026-08-07", form: "10-Q", accn: "0000000001-26-000001" });
const facts = Object.fromEntries(fields.map(([concept, unit], index) => [concept, { units: { [unit]: [
  row("2026-01-01", "2026-06-30", 100 + index), row("2025-01-01", "2025-12-31", 90 + index),
  row("2025-01-01", "2025-06-30", 80 + index),
] } }]));
const { enrichCandidateFundamentals } = loadTsModule("@/lib/equity-signal/fundamentals");
const collected = await enrichCandidateFundamentals({ cik: "0000000001", eventFamily: "valuation_gap" },
  async () => Response.json({ cik: 1, facts: { "us-gaap": facts } }), now);
const financialFacts = collected.candidate.fundamentals.items;
assert.equal(financialFacts.length, 42, "Exercise the current collector's maximum three rows per metric");
const { valuationEvidenceAudit } = loadTsModule("@/lib/equity-signal/financial-evidence", {
  "@/lib/r2-warehouse": {}, "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => key },
});
const analysis = { observedAt: now.toISOString(), currency: "USD", fundamentals: { dilutedEpsTtm: 108, freeCashFlow: 2 }, fairValue: { methods: [
  { method: "earnings_power", value: 1080, assumption: "10x earnings" },
  { method: "owner_earnings_fcf", value: 200, assumption: "5% yield" },
] } };
const section = { available: true, strength: "strong", summary: "Synthetic fixture", items: [] };
const context = [{ source: "pr262_stored_company_analysis", ...analysis },
  { source: "verified_company_profile", business: "Synthetic test products", customers: "Synthetic customers" }];
const pack = {
  assetClass: "public_equity", candidateAlertId: "synthetic-financial-facts", rawSignalIds: [], ticker: "TEST",
  company: "Synthetic Test", analysisKind: "valuation", actionLabel: "Research", eventHeadline: "Valuation",
  whatHappened: "Synthetic regression only", sourceNames: [], sourceLinks: [], sourceFreshness: [], sourceHealth: [],
  filingEvidence: section, newsEvidence: section, priceVolumeEvidence: section,
  fundamentalsEvidence: { ...section, items: [...context, ...financialFacts] }, macroEvidence: section,
  fdaRegulatoryEvidence: section, cryptoFxEvidence: section, finraShortPressureEvidence: section,
  wikidataRippleRelationships: section, historicalPatternMatch: section, previousSimilarOutcomes: section,
  score: {}, currentRiskLabels: [], missingEvidence: [], dataFreshnessWarnings: [],
  financialDiligence: { documents: null, valuationAudit: valuationEvidenceAudit(analysis, collected.candidate.fundamentals, 50, now) },
};
const provider = loadTsModule("@/lib/ai-committee/provider");
const promptInput = loadTsModule("@/lib/ai-committee/prompt-input");
const records = loadTsModule("@/lib/ai-committee/evidence-record-references");
const texts = loadTsModule("@/lib/ai-committee/evidence-text-references");
const policy = loadTsModule("@/lib/ai-committee/model-policy");

const bytes = options => promptInput.committeePromptInputBytes(options.messages.map(message => ({ ...message,
  role: message.role === "system" ? "developer" : message.role })), options.responseSchema
  ? { type: "json_schema", json_schema: { ...options.responseSchema, strict: true } } : undefined);
const rowEvidence = { facts: financialFacts, audit: financialFacts.map(item => ({ ...item, verifiedNumericSource: true,
  qualifier: "Estimate only; not a completed payment. ภาษาไทย 🧪", zero: 0, absent: null, negative: false })) };
const recordEncoding = records.referenceFinancialEvidenceRecords(rowEvidence);
assert.ok(recordEncoding.records > 0);
assert.equal(JSON.stringify(restore(recordEncoding.evidencePack, recordEncoding)), JSON.stringify(rowEvidence));
assert.ok(Buffer.byteLength(JSON.stringify(recordEncoding.evidencePack)) + Buffer.byteLength(JSON.stringify(recordEncoding.sharedEvidenceKeys))
  + Buffer.byteLength(records.SHARED_EVIDENCE_RECORD_INSTRUCTIONS) < Buffer.byteLength(JSON.stringify(rowEvidence)));
for (const key of ["verbatimRecord", "verbatimRecordList", "sharedEvidenceKeys", "verbatimValueRef", "sharedEvidenceValues"]) {
  const collision = { ...rowEvidence, source: { [key]: "untrusted source-authored marker" } };
  const encoded = records.referenceFinancialEvidenceRecords(collision);
  assert.equal(encoded.records, 0);
  assert.deepEqual(encoded.evidencePack, collision);
}
assert.equal(records.referenceFinancialEvidenceRecords({ one: financialFacts[0] }).records, 0);
const reordered = { facts: [financialFacts[0], ...financialFacts.slice(1).map(item => Object.fromEntries(Object.entries(item).reverse()))] };
assert.equal(JSON.stringify(restore(records.referenceFinancialEvidenceRecords(reordered).evidencePack,
  records.referenceFinancialEvidenceRecords(reordered))), JSON.stringify(reordered));
// Array wrappers distinguish original context objects from literal row arrays.
for (const evidence of [
  { facts: [{ context: { nested: financialFacts } }, ...financialFacts] },
  { facts: [financialFacts[0], ["original array", 0, null], ...financialFacts.slice(1)], empty: [] },
  { facts: financialFacts.map((fact, index) => index % 2 ? { ...fact, verifiedNumericSource: false } : fact) },
  { facts: JSON.parse(JSON.stringify(financialFacts).replaceAll('"metric":', '"__proto__":"literal source key","metric":')) },
]) {
  const originalJson = JSON.stringify(evidence), encoded = records.referenceFinancialEvidenceRecords(evidence);
  assert.equal(JSON.stringify(restore(encoded.evidencePack, encoded)), originalJson);
  assert.equal(JSON.stringify(evidence), originalJson);
}
assert.ok(recordEncoding.valueReferences > 0);
assert.ok(Object.values(recordEncoding.sharedEvidenceValues).includes(financialFacts[0].sourceUrl),
  "Full financial source URLs remain readable in the same prompt dictionary");
const restoreValuesOnly = (value, dictionary) => {
  if (Array.isArray(value)) return value.map(item => restoreValuesOnly(item, dictionary));
  if (!value || typeof value !== "object") return value;
  if (Object.keys(value).length === 1 && Object.hasOwn(value, "verbatimValueRef")) return dictionary[value.verbatimValueRef];
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, restoreValuesOnly(item, dictionary)]));
};
const valuesOnlyBytes = encoding => Buffer.byteLength(JSON.stringify({ evidencePack: encoding.evidencePack,
  sharedEvidenceKeys: encoding.sharedEvidenceKeys, sharedEvidenceValues: encoding.sharedEvidenceValues }))
  + Buffer.byteLength(records.SHARED_EVIDENCE_VALUE_INSTRUCTIONS);
const recordOnlyBytes = encoding => Buffer.byteLength(JSON.stringify({
  evidencePack: restoreValuesOnly(encoding.evidencePack, encoding.sharedEvidenceValues), sharedEvidenceKeys: encoding.sharedEvidenceKeys }));
const valueDictionarySavings = recordOnlyBytes(recordEncoding) - valuesOnlyBytes(recordEncoding);
assert.ok(valueDictionarySavings >= 1_500, "Value sharing provides material net savings after its full dictionary/instructions");
for (const modifier of [
  (fact, index) => ({ ...fact, sourceUrl: `https://example.invalid/ภาษาไทย/🧪?quote="&line=\n`,
    qualifier: 'Same exact qualifier with \"quoted\" and newline\nconditions 🧪'.repeat(3), tag: `literal-value_${index}` }),
  (fact, index) => ({ ...fact, metric: `Unique metric ${index}:` + "a".repeat(40),
    sourceUrl: `https://example.invalid/unique-source/${index}`, qualifier: `Unique qualifier ${index}` }),
]) {
  const valueFixture = { facts: financialFacts.map(modifier),
    sourceContext: { verbatimMarkerAsLiteral: "verbatimValueRef", arbitraryString: "value_1" } };
  const originalJson = JSON.stringify(valueFixture), encoded = records.referenceFinancialEvidenceRecords(valueFixture);
  assert.equal(JSON.stringify(restore(encoded.evidencePack, encoded)), originalJson);
  assert.equal(JSON.stringify(valueFixture), originalJson);
}
const uniqueScalars = { facts: Array.from({ length: 30 }, (_, index) => ({ metric: `metric_${index}`, value: index,
  unit: "USD", periodEnd: "2026-06-30", sourceUrl: `https://example.invalid/${index}` })) };
const uniqueEncoded = records.referenceFinancialEvidenceRecords(uniqueScalars);
assert.equal(uniqueEncoded.valueReferences, 0, "No profitable complete repeated scalar means no value dictionary");
assert.equal(JSON.stringify(restore(uniqueEncoded.evidencePack, uniqueEncoded)), JSON.stringify(uniqueScalars));
const marginalValues = { facts: financialFacts.map((fact, index) => ({ ...fact, sourceUrl: "short", concept: "short",
  qualifier: index < 2 ? "q".repeat(100) : `Unique qualifier ${index}` })) };
const marginalEncoded = records.referenceFinancialEvidenceRecords(marginalValues);
assert.ok(marginalEncoded.records > 0);
assert.equal(marginalEncoded.valueReferences, 0, "Discard a dictionary whose decoding instruction erases its savings");
assert.equal(JSON.stringify(restore(marginalEncoded.evidencePack, marginalEncoded)), JSON.stringify(marginalValues));
assert.equal({}.metric, undefined);
const exactText = "A complete source field, with unchanged dates and qualifiers. ภาษาไทย 🧪 ".repeat(100);
const wrapperEvidence = { sourceText: exactText, whatHappened: `Source prefix. ${exactText} Unique unmet condition.`,
  sourceUrl: `https://example.invalid/${exactText}` };
const wrapped = texts.referenceRepeatedEvidenceText(wrapperEvidence);
assert.equal(wrapped.references, 2, "One full field plus one wrapped copy must qualify");
assert.equal(wrapped.embeddedReferences, 1);
assert.equal(JSON.stringify(restore(wrapped.evidencePack, wrapped)), JSON.stringify(wrapperEvidence));
assert.equal(wrapped.evidencePack.sourceUrl, wrapperEvidence.sourceUrl);
assert.equal(texts.referenceRepeatedEvidenceText({ a: `One ${exactText}`, b: `Two ${exactText}` }).references, 0,
  "Do not discover arbitrary common fragments when no full field is present");
let gateInputs = [], captured = [], fetches = 0, responseExtension = "", replyBytes = [];
function committee(compact) {
  return loadTsModule("@/lib/ai-committee/orchestrator", {
    "@/lib/ai-committee/evidence-record-references": compact ? records : { ...records,
      referenceFinancialEvidenceRecords: evidencePack => ({ evidencePack, records: 0, sharedEvidenceKeys: {} }) },
    "@/lib/ai-committee/prompt-input": { ...promptInput, committeePromptPreflight: options => {
      gateInputs.push(structuredClone(options)); return promptInput.committeePromptPreflight(options);
    } },
    "@/lib/ai-committee/provider": { ...provider, runOpenAiCommitteeProvider: async options => {
      captured.push(structuredClone(options)); return provider.runOpenAiCommitteeProvider(options);
    } },
    "@/lib/ai-committee/evidence-pack": { buildAiCommitteeEvidencePack() { throw Error("unexpected_read"); } },
    "@/lib/ai-committee/run-persistence": { persistAiCommitteeRun() { throw Error("unexpected_write"); } },
  });
}
const documents = Array.from({ length: 2 }, (_, documentIndex) => ({
  url: `https://www.sec.gov/Archives/edgar/data/1/00000000012600000${documentIndex}/synthetic.htm`,
  form: documentIndex ? "10-Q" : "10-K", filedAt: "2026-08-07", reportingPeriod: "2026-06-30",
  accession: `0000000001-26-00000${documentIndex}`, collectedAt: now.toISOString(), readComplete: documentIndex === 0,
  digest: `synthetic-${documentIndex}`, excerpts: Array.from({ length: 8 }, (_, excerptIndex) => ({
    topic: ["segments", "customers", "margins", "cash_and_debt"][Math.floor(excerptIndex / 2)],
    text: `Unique synthetic document ${documentIndex} excerpt ${excerptIndex}: `.padEnd(1600, "x"),
  })),
}));
const fullPack = { ...pack, financialDiligence: { ...pack.financialDiligence,
  documents: { cik: "0000000001", documents, failures: [], checkedAt: now.toISOString() }, syntheticBoundaryPadding: "" } };
const saved = { ...process.env }, oldFetch = globalThis.fetch, oldInfo = console.info;
try {
  Object.assign(process.env, { OPENAI_API_KEY: "synthetic-no-network", AI_COMMITTEE_ENABLED: "true", AI_COMMITTEE_DRY_RUN_DEFAULT: "false",
    AI_COMMITTEE_DEEP_MODEL: "gpt-6.1-sol", AI_COMMITTEE_FINAL_MODEL: "gpt-6-astra", AI_COMMITTEE_FAST_MODEL: "gpt-6-luna",
    AI_COMMITTEE_MODEL_ALLOWLIST: "gpt-6.1-sol,gpt-6-astra,gpt-6-luna" });
  console.info = () => {};
  globalThis.fetch = async (url, init) => {
    fetches++;
    if (url.endsWith("/models")) return Response.json({ data: [{ id: "gpt-6.1-sol" }, { id: "gpt-6-astra" }] });
    assert.equal(url, "https://api.openai.com/v1/chat/completions");
    const request = JSON.parse(init.body);
    assert.ok(provider.committeePromptInputBytes(request.messages, request.response_format.type === "json_schema" ? request.response_format : undefined) <= 60_000);
    const riskText = typeof responseExtension === "function" ? responseExtension(JSON.parse(request.messages[1].content).agent.id) : responseExtension;
    const content = JSON.stringify({ verdict: "needs_more_data", confidence: 60,
      keyFindings: ["Company: Synthetic issuer sells test products.", "What happened: This is a synthetic valuation review.",
        "Why it matters: The model requires reconciliation.", "Possible outcome: The value remains uncertain.",
        "Risks: Synthetic loan and debt adjustments remain unresolved."], supportingEvidence: [], concerns: [],
      missingData: ["Synthetic loan-normalized cash-flow and debt reconciliation are still required."],
      riskNotes: riskText ? [riskText] : [], followUpChecks: [], suggestedActionLabel: "Research only" });
    replyBytes.push(Buffer.byteLength(content));
    return Response.json({ model: request.model, service_tier: "default", choices: [{ message: { content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200,
        prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } } });
  };
  await inSimpleAlertPilot(async () => {
    const input = { persistResult: false, mode: "preview", dryRun: false, confirmRun: true, reviewPolicy: "focused_v1",
      maximumPromptBytes: 60_000, maxCostUsd: policy.AI_COMMITTEE_REVIEW_MAX_COST_USD, allowedModels: policy.COMMITTEE_ALLOWED_MODELS };
    const baseline = committee(false), compact = committee(true);
    const roomyPack = structuredClone(fullPack);
    for (const document of roomyPack.financialDiligence.documents.documents) {
      for (const excerpt of document.excerpts) excerpt.text = excerpt.text.slice(0, 400);
    }
    const roomyOriginal = structuredClone(roomyPack);
    const roomy = await compact.runAiCommittee({ ...input, [compact.TRUSTED_IN_MEMORY_EVIDENCE]: roomyPack });
    assert.equal(roomy.ok, true);
    assert.deepEqual(captured.map(request => JSON.parse(request.messages[1].content).agent.id),
      ["analyst_agent", "valuation_dcf_agent", "skeptic_agent", "final_judge"]);
    const roomyPromptBytes = captured.map(bytes);
    const roomyPromptPack = restore(JSON.parse(captured[0].messages[1].content).evidencePack,
      JSON.parse(captured[0].messages[1].content));
    for (const [index, request] of captured.entries()) {
      const payload = JSON.parse(request.messages[1].content);
      const restored = restore(payload.evidencePack, payload);
      assert.equal(JSON.stringify(restored), JSON.stringify(roomyPromptPack));
      assert.deepEqual(restored.evidenceSections.fundamentals.items, roomyPack.fundamentalsEvidence.items);
      assert.deepEqual(restored.financialDiligence, roomyPack.financialDiligence);
      assert.equal(JSON.stringify(payload.previousResults), JSON.stringify(roomy.agentResults.slice(0, index)
        .map(result => Object.fromEntries(Object.entries(result).filter(([key]) => key !== "tokenUsage")))));
      assert.ok(roomyPromptBytes[index] <= 60_000);
      if (payload.sharedEvidenceKeys) assert.ok(request.messages[0].content.includes(records.SHARED_EVIDENCE_RECORD_INSTRUCTIONS));
      for (const fact of financialFacts) {
        assert.ok(request.messages[1].content.includes(fact.sourceUrl));
        assert.ok(request.messages[1].content.includes(fact.filedAt));
      }
    }
    assert.deepEqual(roomyPack, roomyOriginal, "Never change fingerprinted evidence, audit storage or consensus input");
    assert.ok(gateInputs.some(options => (options.reservedPromptBytes ?? 0) > 0),
      "Whole-review admission must reserve prior-role growth for later prompts");
    assert.ok(gateInputs.every(options => !promptInput.committeePromptPreflight(options)));
    assert.equal(roomy.committeeOutput.overallRecommendation, "needs_more_data");
    assert.equal(roomy.compatibility.publishes, false);
    assert.equal(roomy.compatibility.sendsTelegram, false);
    assert.equal(policy.AI_COMMITTEE_REVIEW_MAX_PROMPT_BYTES, 60_000);
    assert.equal(policy.AI_COMMITTEE_REVIEW_MAX_COST_USD, 2.7538);
    assert.ok(captured[0].responseSchema.schema.additionalProperties === false);

    // Match reported live totals only; these are synthetic, not historical packets.
    // Every unreserved raw role fits. In v3 that exact condition bypassed record
    // factoring, so the no-record control reproduces its reserve-only rejection.
    gateInputs = []; captured = []; fetches = 0;
    await baseline.runAiCommittee({ ...input, [baseline.TRUSTED_IN_MEMORY_EVIDENCE]: roomyPack });
    const rawPlanningPeak = Math.max(...gateInputs.map(options => bytes(options) + (options.reservedPromptBytes ?? 0)));
    const reservedBoundaryMeasurements = [];
    let highCapacityPack;
    for (const target of [61_958, 63_340]) {
      const boundary = structuredClone(roomyPack);
      boundary.financialDiligence.syntheticBoundaryPadding = "z".repeat(target - rawPlanningPeak);
      gateInputs = []; captured = []; fetches = 0;
      const held = await baseline.runAiCommittee({ ...input, [baseline.TRUSTED_IN_MEMORY_EVIDENCE]: boundary });
      assert.equal(held.ok, false);
      assert.equal(fetches, 0);
      assert.equal(captured.length, 0);
      assert.ok(gateInputs.every(options => bytes(options) <= 60_000), "v3 bypasses factoring for every raw role");
      assert.equal(Math.max(...gateInputs.map(options => bytes(options) + (options.reservedPromptBytes ?? 0))), target);
      const rawEvidence = JSON.parse(gateInputs[0].messages[1].content).evidencePack;
      const beforeReserved = gateInputs.map(options => bytes(options) + (options.reservedPromptBytes ?? 0));
      gateInputs = []; captured = []; fetches = 0;
      const admitted = await compact.runAiCommittee({ ...input, [compact.TRUSTED_IN_MEMORY_EVIDENCE]: boundary });
      assert.equal(admitted.ok, true);
      assert.equal(fetches, 4);
      assert.equal(captured.length, 4);
      const afterReserved = gateInputs.map(options => bytes(options) + (options.reservedPromptBytes ?? 0));
      assert.ok(Math.max(...afterReserved) <= 57_000, `At least 3 KB planning headroom: ${afterReserved}`);
      for (const [index, request] of captured.entries()) {
        const payload = JSON.parse(request.messages[1].content);
        assert.ok(Object.keys(payload.sharedEvidenceValues).length > 0);
        assert.ok(request.messages[0].content.includes(records.SHARED_EVIDENCE_VALUE_INSTRUCTIONS));
        assert.equal(JSON.stringify(restore(payload.evidencePack, payload)), JSON.stringify(rawEvidence));
        assert.equal(JSON.stringify(payload.previousResults), JSON.stringify(admitted.agentResults.slice(0, index)
          .map(result => Object.fromEntries(Object.entries(result).filter(([key]) => key !== "tokenUsage")))));
      }
      reservedBoundaryMeasurements.push({ syntheticTarget: target, beforeReserved, afterReserved,
        actualRoleBytes: captured.map(bytes), planningHeadroom: 60_000 - Math.max(...afterReserved) });
      highCapacityPack = boundary;
    }

    gateInputs = []; captured = []; fetches = 0;
    await baseline.runAiCommittee({ ...input, [baseline.TRUSTED_IN_MEMORY_EVIDENCE]: fullPack });
    // Engineered equality of size only. This fixture is NOT the missing INOD
    // packet, and contains synthetic source rows and explicit boundary padding.
    fullPack.financialDiligence.syntheticBoundaryPadding = "z".repeat(63_587 - bytes(gateInputs[0]));
    gateInputs = []; captured = []; fetches = 0;
    const before = await baseline.runAiCommittee({ ...input, [baseline.TRUSTED_IN_MEMORY_EVIDENCE]: fullPack });
    assert.equal(bytes(gateInputs[0]), 63_587);
    assert.equal(before.agentResults[0].error, "prompt_too_large");
    assert.equal(before.committeeOutput.modelUsageSummary.actualOpenAiUsage.responsesWithUsage, 0);
    assert.equal(captured.length, 0, "Whole-review preflight must precede every provider invocation");
    assert.equal(fetches, 0, "No compatibility request or completion may reach even the fetch stub");
    const unchanged = structuredClone(fullPack);
    gateInputs = []; captured = []; fetches = 0;
    const after = await compact.runAiCommittee({ ...input, [compact.TRUSTED_IN_MEMORY_EVIDENCE]: fullPack });
    assert.equal(after.ok, false);
    assert.equal(captured.length, 0, "Reserved later-role growth must block before the first paid request");
    assert.equal(fetches, 0);
    assert.equal(after.committeeOutput.modelUsageSummary.actualOpenAiUsage.responsesWithUsage, 0);
    const reservedFailure = after.agentResults.find(result => result.status === "failed").providerFailure;
    assert.equal(reservedFailure.category, "input_limit");
    assert.equal(reservedFailure.maximumPromptBytes, 60_000);
    assert.ok(reservedFailure.promptSectionBytes.reservedPriorResults > 0);
    assert.deepEqual(fullPack, unchanged, "Never change fingerprinted evidence, audit storage or consensus input");
    assert.equal(after.compatibility.publishes, false);
    assert.equal(after.compatibility.sendsTelegram, false);

    // Keep a realistic counterexample: this SEC-derived reconstruction has
    // only 12 financial facts and cannot recover the five-role planning reserve.
    // It is not the historical live packet and must not make any provider call.
    const servPack = JSON.parse(readFileSync(new URL("./fixtures/committee-serv-reconstructed-2026-10-07/evidence-pack.json", import.meta.url), "utf8"));
    gateInputs = []; captured = []; fetches = 0;
    const servHeld = await compact.runAiCommittee({ ...input, [compact.TRUSTED_IN_MEMORY_EVIDENCE]: servPack });
    assert.equal(servHeld.ok, false);
    assert.equal(captured.length, 0);
    assert.equal(fetches, 0);
    const servFailure = servHeld.agentResults.find(result => result.status === "failed");
    assert.equal(servFailure.agentId, "final_judge");
    assert.equal(servFailure.providerFailure.promptBytes, 63_729);
    assert.equal(servFailure.providerFailure.promptSectionBytes.reservedPriorResults, 14_248);
    assert.equal(servHeld.committeeOutput.modelUsageSummary.actualOpenAiUsage.responsesWithUsage, 0);
    for (const request of gateInputs) {
      const payload = JSON.parse(request.messages[1].content), restored = restore(payload.evidencePack, payload);
      assert.deepEqual(restored.financialDiligence, servPack.financialDiligence);
      assert.deepEqual(restored.evidenceSections.fundamentals.items, servPack.fundamentalsEvidence.items);
    }

    // Unique evidence remains too large after every lossless encoding attempt.
    captured = []; fetches = 0;
    const blocked = await compact.runAiCommittee({ ...input, [compact.TRUSTED_IN_MEMORY_EVIDENCE]: { ...fullPack,
      whatHappened: "Unique synthetic evidence. ".repeat(4000) } });
    assert.equal(blocked.ok, false);
    assert.equal(captured.length, 0); assert.equal(fetches, 0);
    assert.equal(blocked.committeeOutput.modelUsageSummary.actualOpenAiUsage.responsesWithUsage, 0);
    const uniqueFailure = blocked.agentResults.find(result => result.status === "failed").providerFailure;
    assert.equal(uniqueFailure.category, "input_limit");
    assert.equal(uniqueFailure.maximumPromptBytes, 60_000);
    assert.ok(uniqueFailure.promptSectionBytes.financialDiligence > 0);
    assert.ok(Object.values(uniqueFailure.promptSectionBytes).every(value => Number.isInteger(value) && value >= 0));
    assert.ok(!JSON.stringify(uniqueFailure).includes("Unique synthetic evidence"));

    // Modest individually bounded mock outputs can cumulatively exceed the
    // planning heuristic too. Every response has distinct ASCII findings and
    // under 8,192 serialized bytes; no tokenizer-bound claim is inferred here.
    captured = []; fetches = 0; replyBytes = [];
    responseExtension = role => Array.from({ length: 80 }, (_, index) => `${index}:${createHash("sha256")
      .update(`${role}-distinct-finding-${index}`).digest("hex")}`).join("\n");
    const cumulative = await compact.runAiCommittee({ ...input, [compact.TRUSTED_IN_MEMORY_EVIDENCE]: highCapacityPack });
    assert.equal(cumulative.ok, false);
    assert.deepEqual(cumulative.agentResults.slice(0, 3).map(role => role.status), ["completed", "completed", "completed"]);
    assert.equal(cumulative.agentResults[3].error, "prompt_too_large");
    assert.equal(cumulative.committeeOutput.modelUsageSummary.actualOpenAiUsage.responsesWithUsage, 3);
    assert.equal(fetches, 3);
    assert.ok(replyBytes.every(size => size < 8_192));
    assert.equal(new Set(cumulative.agentResults.slice(0, 3).map(role => role.riskNotes[0])).size, 3);
    assert.equal(JSON.stringify(JSON.parse(captured[3].messages[1].content).previousResults),
      JSON.stringify(cumulative.agentResults.slice(0, 3).map(role => Object.fromEntries(Object.entries(role).filter(([key]) => key !== "tokenUsage")))));
    const cumulativeReplyBytes = [...replyBytes];

    // An unexpected long provider answer can still overflow the next prompt.
    // It must preserve the first usage receipt while stopping subsequent calls.
    captured = []; fetches = 0;
    responseExtension = Array.from({ length: 1024 }, (_, index) => `${index}:${createHash("sha256")
      .update(`unique-reviewer-finding-${index}`).digest("hex")}\t"ภาษาไทย🧪"`).join("\n");
    const dynamic = await compact.runAiCommittee({ ...input, [compact.TRUSTED_IN_MEMORY_EVIDENCE]: highCapacityPack });
    assert.equal(dynamic.ok, false);
    assert.equal(dynamic.agentResults[0].status, "completed");
    assert.equal(dynamic.agentResults[1].error, "prompt_too_large");
    assert.equal(dynamic.committeeOutput.modelUsageSummary.actualOpenAiUsage.responsesWithUsage, 1);
    assert.equal(fetches, 1);
    assert.ok(dynamic.agentResults[1].providerFailure.promptSectionBytes.previousResults > 60_000);
    const blockedPayload = JSON.parse(captured[1].messages[1].content);
    assert.equal(blockedPayload.previousResults[0].riskNotes[0], responseExtension);
    assert.ok(dynamic.agentResults[1].providerFailure.promptSectionBytes.sharedEvidenceValues > 0);
    assert.ok(!JSON.stringify(dynamic.agentResults[1].providerFailure).includes(responseExtension.slice(0, 30)));
    console.log(JSON.stringify({ syntheticOnly: true, exactHistoricalReplay: false, actualOrchestratorCapture: true,
      before: 63_587, servReconstructionStillHeldAt: servFailure.providerFailure.promptBytes, valueDictionarySavings, reservedBoundaryMeasurements, roomyAfter: roomyPromptBytes, exactEvidenceRoundTrip: true, allPriorOutputsPreserved: true,
      reservedWholeReviewPreflight: true, zeroNetworkForIntrinsicOverflow: true,
      laterDynamicOverflowRetainsKnownUsage: true, cumulativeUniqueReplyBytes: cumulativeReplyBytes, numericOnlyDiagnostics: true,
      sourceDatesAndUrlsRemainLiteral: true, unchangedHardCap: 60_000, unchangedMaximumReservation: 2.7538 }));
  });
} finally {
  globalThis.fetch = oldFetch; console.info = oldInfo;
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
}
