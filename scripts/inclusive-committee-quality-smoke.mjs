import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
function load(path, dependencies = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const m = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (name === "node:crypto") return crypto;
    if (name in dependencies) return dependencies[name];
    throw new Error(`Unexpected dependency: ${name}`);
  }, m, m.exports);
  return m.exports;
}
const policy = load("lib/branch-signal-lab-policy.ts");
const analysis = load("lib/equity-signal/analysis.ts", {
  "@/lib/branch-signal-lab-policy": policy,
  "@/lib/equity-signal/historical-analogs": load("lib/equity-signal/historical-analogs.ts"),
});
const fundamentals = load("lib/equity-signal/fundamentals.ts", { "@/lib/equity-signal/analysis": analysis });
const now = new Date("2026-09-16T12:00:00Z");
const fact = (val, end, filed, start) => ({ val, end, filed, start, form: start ? "10-K" : "10-Q" });
const facts = {
  Revenues: { units: { USD: [fact(100, "2024-12-31", "2025-02-20", "2024-01-01")] } },
  RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: [
    fact(180, "2025-12-31", "2026-02-20", "2025-01-01"),
    fact(50, "2026-06-30", "2026-08-10", "2026-04-01"),
    fact(999, "2026-12-31", "2027-02-20", "2026-01-01"),
  ] } },
};
assert.equal(fundamentals.latestFact(facts, ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax"], ["USD"], now).value, 50);
assert.equal(fundamentals.latestFact(facts, ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax"], ["USD"], now, true).value, 180,
  "Annual denominators must never accidentally use a quarter");
const receipt = { id: "contract", title: "Example Corp wins $100 million contract", summary: "Example Corp signed a committed $100 million contract for one year of services.", url: "https://issuer.example/contract", publisher: "Example Corp", publishedAt: now.toISOString(), channel: "direct_issuer_feed", official: true, primarySource: true, scheduled: false, symbolHints: ["EXM"], companyHints: ["Example Corp"], rawEventType: null };
const universe = { entries: [{ ticker: "EXM", name: "Example Corp", aliases: ["Example Corp"], cik: "0000000001", exchange: "NASDAQ", securityType: "common_stock" }] };
const macro = { regime: [] };
const candidate = analysis.buildImpactCandidates([receipt], universe, macro, now, [], true).candidates[0];
assert.ok(candidate);
assert.equal(candidate.gatePassed, false, "A raw contract amount alone cannot establish company scale");
const body = { cik: 1, facts: { "us-gaap": {
  Revenues: { units: { USD: [fact(1_000_000_000, "2025-12-31", "2026-02-20", "2025-01-01")] } },
  Assets: { units: { USD: [fact(2_000_000_000, "2026-06-30", "2026-08-10")] } },
  NetIncomeLoss: { units: { USD: [fact(100_000_000, "2025-12-31", "2026-02-20", "2025-01-01")] } },
} } };
const enriched = await fundamentals.enrichCandidateFundamentals(candidate, async () => Response.json(body), now);
assert.equal(enriched.candidate.eventMagnitude.relativeToCompany.ratioPercent, 10);
assert.equal(enriched.candidate.eventMagnitude.relativeToCompany.companyPeriodEnd, "2025-12-31");
assert.equal(enriched.candidate.eventMagnitude.relativeToCompany.eventMetricSourceReceiptId, "contract");
assert.equal(enriched.candidate.gatePassed, true, "Real scale evidence must repair the earlier magnitude gap");
const mismatch = await fundamentals.enrichCandidateFundamentals(structuredClone(candidate), async () => Response.json({ ...body, cik: 2 }), now);
assert.equal(mismatch.candidate.fundamentals.available, false);
assert.equal(mismatch.candidate.fundamentals.error, "sec_company_facts_issuer_mismatch");

const agents = load("lib/ai-committee/agents.ts");
let calls = 0;
const committee = load("lib/ai-committee/orchestrator.ts", {
  "@/lib/ai-committee/agents": agents,
  "@/lib/ai-committee/evidence-pack": { buildAiCommitteeEvidencePack: async () => { throw new Error("Unexpected database read"); } },
  "@/lib/ai-committee/run-persistence": { persistAiCommitteeRun: async () => { throw new Error("Unexpected database write"); } },
  "@/lib/ai-committee/provider": {
    getAiCommitteeProviderStatus: () => ({ configured: true, enabled: true, dryRunDefault: false }),
    runOpenAiCommitteeProvider: async (input) => {
      calls++;
      assert.match(input.messages[0].content, /research review with explicitly incomplete evidence/);
      const request = JSON.parse(input.messages[1].content);
      assert.ok(request.evidencePack.researchReview.gaps.includes("full_source_evidence_incomplete"));
      return { ok: true, model: "gpt-4.1-mini", content: JSON.stringify({ agentId: request.agent.id, verdict: "positive", confidence: 95, keyFindings: [], supportingEvidence: [], concerns: [], missingData: [], suggestedActionLabel: "Research", riskNotes: [], followUpChecks: [] }) };
    },
  },
});
const section = { available: false, strength: "missing", summary: null, items: [] };
const pack = {
  assetClass: "public_equity", candidateAlertId: "test-research", rawSignalIds: [], ticker: "EXM", company: "Example Corp",
  actionLabel: "Research", eventHeadline: "Earnings review", whatHappened: "Financial impact uncertain", sourceNames: ["SEC"], sourceLinks: [receipt.url], sourceFreshness: [], sourceHealth: [],
  filingEvidence: section, newsEvidence: { ...section, available: true, items: [{ primarySource: true, summary: receipt.summary }] },
  priceVolumeEvidence: section, fundamentalsEvidence: section, macroEvidence: section, fdaRegulatoryEvidence: section,
  cryptoFxEvidence: section, finraShortPressureEvidence: section, wikidataRippleRelationships: section, historicalPatternMatch: section, previousSimilarOutcomes: section,
  score: {}, currentRiskLabels: [], missingEvidence: ["full_source_evidence_incomplete", "fundamentalsEvidence"], dataFreshnessWarnings: [],
  researchReview: { enabled: true, gaps: ["full_source_evidence_incomplete", "fundamentalsEvidence"] },
};
const input = { [committee.TRUSTED_IN_MEMORY_EVIDENCE]: pack, persistResult: false, mode: "preview", dryRun: false, confirmRun: true, maxAgents: 13, maxCostUsd: 0.75 };
const reviewed = await committee.runAiCommittee(input);
assert.equal(calls, 14, "The real orchestrator must run all roles despite admitted research gaps");
assert.equal(reviewed.committeeOutput.overallRecommendation, "needs_more_data", "Even unanimous positive mock agents cannot override missing hard evidence");
const normalPack = structuredClone(pack); delete normalPack.researchReview;
const blocked = await committee.runAiCommittee({ ...input, [committee.TRUSTED_IN_MEMORY_EVIDENCE]: normalPack });
assert.equal(blocked.status, "evidence_pack_incomplete");
assert.equal(calls, 14);
console.log("Inclusive Committee: all 14 roles review incomplete cases; publication and cost gates preserved; financial aliases, dates, issuer and annual scale verified.");
