import assert from "node:assert/strict";
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
function restore(item, payload) {
  if (Array.isArray(item)) return item.map(value => restore(value, payload));
  if (!item || typeof item !== "object") return item;
  if (Object.keys(item).length === 1 && Object.hasOwn(item, "verbatimRecordList")) {
    const { fields, items } = item.verbatimRecordList;
    assert.ok(Object.hasOwn(payload.sharedEvidenceKeys, fields));
    const keys = payload.sharedEvidenceKeys[fields];
    return items.map(row => {
      if (!Array.isArray(row)) return restore(row, payload);
      assert.equal(keys.length, row.length);
      return Object.fromEntries(keys.map((key, index) => [key, row[index]]));
    });
  }
  if (Object.keys(item).length === 1 && Object.hasOwn(item, "verbatimRecord")) {
    const [id, ...values] = item.verbatimRecord;
    assert.ok(Object.hasOwn(payload.sharedEvidenceKeys, id));
    const keys = payload.sharedEvidenceKeys[id];
    assert.equal(keys.length, values.length);
    return Object.fromEntries(keys.map((key, index) => [key, values[index]]));
  }
  if (Object.keys(item).length === 1 && Object.hasOwn(item, "verbatimTextRef")) {
    assert.ok(Object.hasOwn(payload.sharedEvidenceTexts, item.verbatimTextRef));
    return payload.sharedEvidenceTexts[item.verbatimTextRef];
  }
  if (Object.keys(item).length === 1 && Object.hasOwn(item, "verbatimTextParts")) return item.verbatimTextParts.map(part => restore(part, payload)).join("");
  return Object.fromEntries(Object.entries(item).map(([key, value]) => [key, restore(value, payload)]));
}
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
for (const key of ["verbatimRecord", "verbatimRecordList", "sharedEvidenceKeys"]) {
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
let gateInputs = [], captured = [], fetches = 0, responseExtension = "";
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
    return Response.json({ model: request.model, service_tier: "default", choices: [{ message: { content: JSON.stringify({ verdict: "needs_more_data", confidence: 60,
      keyFindings: ["Company: Synthetic issuer sells test products.", "What happened: This is a synthetic valuation review.",
        "Why it matters: The model requires reconciliation.", "Possible outcome: The value remains uncertain.",
        "Risks: Synthetic loan and debt adjustments remain unresolved."], supportingEvidence: [], concerns: [],
      missingData: ["Synthetic loan-normalized cash-flow and debt reconciliation are still required."],
      riskNotes: responseExtension ? [responseExtension] : [], followUpChecks: [], suggestedActionLabel: "Research only" }) }, finish_reason: "stop" }],
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
      if (payload.sharedEvidenceKeys) assert.ok(request.messages[0].content.endsWith(records.SHARED_EVIDENCE_RECORD_INSTRUCTIONS));
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

    gateInputs = []; captured = []; fetches = 0;
    await baseline.runAiCommittee({ ...input, [baseline.TRUSTED_IN_MEMORY_EVIDENCE]: fullPack });
    // Engineered equality of size only. This fixture is NOT the missing INOD
    // packet, and contains synthetic source rows and explicit boundary padding.
    fullPack.financialDiligence.syntheticBoundaryPadding = "z".repeat(63_587 - bytes(gateInputs[0]));
    gateInputs = []; captured = []; fetches = 0;
    const before = await baseline.runAiCommittee({ ...input, [baseline.TRUSTED_IN_MEMORY_EVIDENCE]: fullPack });
    assert.equal(bytes(gateInputs[0]), 63_587);
    const originalPayload = JSON.parse(gateInputs[0].messages[1].content);
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

    // An unexpected long provider answer can still overflow the next prompt.
    // It must preserve the first usage receipt while stopping subsequent calls.
    captured = []; fetches = 0; responseExtension = "Synthetic long reviewer uncertainty. ".repeat(3000);
    const dynamic = await compact.runAiCommittee({ ...input, [compact.TRUSTED_IN_MEMORY_EVIDENCE]: roomyPack });
    assert.equal(dynamic.ok, false);
    assert.equal(dynamic.agentResults[0].status, "completed");
    assert.equal(dynamic.agentResults[1].error, "prompt_too_large");
    assert.equal(dynamic.committeeOutput.modelUsageSummary.actualOpenAiUsage.responsesWithUsage, 1);
    assert.equal(fetches, 1);
    assert.ok(dynamic.agentResults[1].providerFailure.promptSectionBytes.previousResults > 60_000);
    console.log(JSON.stringify({ syntheticOnly: true, exactHistoricalReplay: false, actualOrchestratorCapture: true,
      before: 63_587, roomyAfter: roomyPromptBytes, exactEvidenceRoundTrip: true, allPriorOutputsPreserved: true,
      reservedWholeReviewPreflight: true, zeroNetworkForIntrinsicOverflow: true,
      laterDynamicOverflowRetainsKnownUsage: true, numericOnlyDiagnostics: true,
      sourceDatesAndUrlsRemainLiteral: true, unchangedHardCap: 60_000, unchangedMaximumReservation: 2.7538 }));
  });
} finally {
  globalThis.fetch = oldFetch; console.info = oldInfo;
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
}
