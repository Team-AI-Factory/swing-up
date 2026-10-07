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
const committee = loadTsModule("@/lib/ai-committee/orchestrator", {
  "@/lib/ai-committee/provider": provider,
  "@/lib/ai-committee/evidence-pack": { buildAiCommitteeEvidencePack() { throw new Error("unexpected_read"); } },
  "@/lib/ai-committee/run-persistence": { persistAiCommitteeRun() { throw new Error("unexpected_write"); } },
});
const savedEnvironment = { ...process.env }, originalFetch = globalThis.fetch, originalInfo = console.info;
let captured = [], transport = [];
try {
  Object.assign(process.env, { OPENAI_API_KEY: "synthetic-no-network", OPENAI_MODEL: "gpt-4.1-mini",
    AI_COMMITTEE_ENABLED: "true", AI_COMMITTEE_DRY_RUN_DEFAULT: "false", SWING_UP_SIMPLE_PILOT_ENABLED: "false" });
  for (const key of ["AI_COMMITTEE_MODEL_ALLOWLIST", "AI_COMMITTEE_FINAL_MODEL", "AI_COMMITTEE_DEEP_MODEL", "AI_COMMITTEE_FAST_MODEL"]) delete process.env[key];
  console.info = () => {};
  globalThis.fetch = async (url, options) => {
    if (url === "https://api.openai.com/v1/models") return Response.json({ data: [{ id: "gpt-6.1-sol" }, { id: "gpt-6-astra" }] });
    assert.equal(url, "https://api.openai.com/v1/chat/completions");
    const request = JSON.parse(options.body);
    const promptBytes = provider.committeePromptInputBytes(request.messages, request.response_format?.type === "json_schema" ? request.response_format : undefined);
    assert.ok(promptBytes <= 60_000);
    captured.push(JSON.parse(request.messages[1].content));
    transport.push({ role: captured.at(-1).agent.id, model: request.model, promptBytes });
    return Response.json({ model: request.model, service_tier: "default", choices: [{ message: { content: JSON.stringify({ verdict: "needs_more_data", confidence: 60,
      keyFindings: ["Company: Synthetic issuer sells test products.", "What happened: This is a synthetic valuation review.",
        "Why it matters: The model requires reconciliation.", "Possible outcome: The value remains uncertain.",
        "Risks: Synthetic loan and debt adjustments remain unresolved."], supportingEvidence: [], concerns: [],
      missingData: ["Synthetic loan-normalized cash-flow and debt reconciliation are still required."],
      riskNotes: [], followUpChecks: [], suggestedActionLabel: "Research only" }) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } });
  };
  const input = { persistResult: false, mode: "preview", dryRun: false, confirmRun: true, reviewPolicy: "focused_v1",
    maximumPromptBytes: 60_000, maxCostUsd: 0.156, allowedModels: ["gpt-4.1-mini", "gpt-4.1-mini-2025-04-14"] };
  const original = structuredClone(pack);
  const reviewed = await committee.runAiCommittee({ ...input, [committee.TRUSTED_IN_MEMORY_EVIDENCE]: pack });
  assert.deepEqual(captured.map(prompt => prompt.agent.id), ["analyst_agent", "valuation_dcf_agent", "skeptic_agent", "final_judge"]);
  for (const prompt of captured) {
    assert.deepEqual(prompt.evidencePack.evidenceSections.fundamentals.items, pack.fundamentalsEvidence.items,
      "Every context and collected fact, including period, unit, concept, accession and source, reaches every role unchanged");
    assert.deepEqual(prompt.evidencePack.financialDiligence, pack.financialDiligence);
    assert.ok(prompt.evidencePack.evidenceSections.fundamentals.items.some(item => item.metric === "diluted_eps_prior_year"));
    assert.ok(prompt.evidencePack.evidenceSections.fundamentals.items.some(item => item.metric === "operating_cash_flow_prior_year"));
  }
  assert.deepEqual(pack, original, "Prompt preparation cannot change source evidence or approval inputs");
  assert.equal(reviewed.committeeOutput.overallRecommendation, "needs_more_data", "Complete transport does not resolve substantive diligence gaps");
  assert.equal(reviewed.compatibility.publishes, false);
  assert.equal(reviewed.compatibility.sendsTelegram, false);

  captured = [];
  const missingComparisons = { ...pack, fundamentalsEvidence: { ...section, items: [...context,
    ...financialFacts.filter(item => !item.metric.endsWith("_prior_year"))] } };
  await committee.runAiCommittee({ ...input, [committee.TRUSTED_IN_MEMORY_EVIDENCE]: missingComparisons });
  assert.equal(captured.length, 4);
  assert.ok(captured.every(prompt => !JSON.stringify(prompt).includes('"metric":"diluted_eps_prior_year"')),
    "Missing comparison facts cannot be invented from dates, a model or current-period facts");

  captured = [];
  const oversized = { ...pack, fundamentalsEvidence: { ...pack.fundamentalsEvidence,
    items: [...pack.fundamentalsEvidence.items, { source: "synthetic_unique_evidence", text: "Unique synthetic financial evidence. ".repeat(2500) }] } };
  const blocked = await committee.runAiCommittee({ ...input, [committee.TRUSTED_IN_MEMORY_EVIDENCE]: oversized });
  assert.equal(captured.length, 0, "Oversized evidence still fails at the unchanged byte cap before any transport call");
  assert.equal(blocked.agentResults[0].error, "prompt_too_large");
  assert.equal(blocked.committeeOutput.overallRecommendation, "needs_more_data");

  // The real collector can attach two filings with eight distinct 1,600-character
  // excerpts each. Exercise that content plus full facts, audit and accumulated
  // prior-role results through the current Sol/Astra routing, without a network.
  const documents = Array.from({ length: 2 }, (_, documentIndex) => ({
    url: `https://www.sec.gov/Archives/edgar/data/1/00000000012600000${documentIndex}/synthetic.htm`,
    form: documentIndex ? "10-Q" : "10-K", filedAt: "2026-08-07", reportingPeriod: "2026-06-30",
    accession: `0000000001-26-00000${documentIndex}`, collectedAt: now.toISOString(), readComplete: true,
    digest: `synthetic-${documentIndex}`, excerpts: Array.from({ length: 8 }, (_, excerptIndex) => ({
      topic: ["segments", "customers", "margins", "cash_and_debt"][Math.floor(excerptIndex / 2)],
      text: `Unique synthetic document ${documentIndex} excerpt ${excerptIndex}: `.padEnd(1600, "x"),
    })),
  }));
  captured = []; transport = [];
  await inSimpleAlertPilot(async () => {
    Object.assign(process.env, { AI_COMMITTEE_DEEP_MODEL: "gpt-6.1-sol", AI_COMMITTEE_FINAL_MODEL: "gpt-6-astra",
      AI_COMMITTEE_FAST_MODEL: "gpt-6-luna", AI_COMMITTEE_MODEL_ALLOWLIST: "gpt-6.1-sol,gpt-6-astra,gpt-6-luna" });
    const policy = loadTsModule("@/lib/ai-committee/model-policy");
    const fullPack = { ...pack, financialDiligence: { ...pack.financialDiligence,
      documents: { cik: "0000000001", documents, failures: [], checkedAt: now.toISOString() } } };
    const fullOriginal = structuredClone(fullPack);
    const result = await committee.runAiCommittee({ ...input, maxCostUsd: policy.AI_COMMITTEE_REVIEW_MAX_COST_USD,
      allowedModels: policy.COMMITTEE_ALLOWED_MODELS, [committee.TRUSTED_IN_MEMORY_EVIDENCE]: fullPack });
    assert.equal(result.ok, false, "A packet without room for later reviewer JSON must stop before paid transport");
    assert.equal(transport.length, 0);
    assert.equal(captured.length, 0);
    assert.equal(result.committeeOutput.modelUsageSummary.actualOpenAiUsage.responsesWithUsage, 0);
    const failure = result.agentResults.find(role => role.status === "failed").providerFailure;
    assert.equal(failure.category, "input_limit");
    assert.ok(failure.promptSectionBytes.reservedPriorResults > 0);
    assert.deepEqual(fullPack, fullOriginal);
    assert.equal(result.committeeOutput.overallRecommendation, "needs_more_data");
  });
  console.log(JSON.stringify({ syntheticOnly: true, historicalReplay: false, factsPreservedPerRole: financialFacts.length,
    roleCount: 4, missingFactsNotInvented: true, oversizedBlockedBeforeNetwork: true, hardLimitBytes: 60_000,
    fullDocumentsReservedBeforeNetwork: true }));
} finally {
  globalThis.fetch = originalFetch; console.info = originalInfo;
  for (const key of Object.keys(process.env)) if (!(key in savedEnvironment)) delete process.env[key];
  Object.assign(process.env, savedEnvironment);
}
