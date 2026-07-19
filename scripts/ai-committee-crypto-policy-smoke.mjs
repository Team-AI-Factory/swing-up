import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../lib/ai-committee/orchestrator.ts", import.meta.url), "utf8");
const requiredContracts = [
  ["digital-asset classification", "assetClass: \"digital_asset\""],
  ["token market structure is primary", "token market structure"],
  ["irrelevant specialist agents are N/A", "n/a_unless_event_specific"],
  ["optional omissions are moved to follow-ups", "isNonBlockingMissingItem"],
  ["only blocking pack omissions affect approval", "policy.blockingMissingEvidence"],
  ["what happened reaches the committee", "whatHappened: pack.whatHappened"],
  ["aligned catalyst evidence is prioritized", "alignedCatalystReceipts"],
  ["contradictions are prioritized", "contradictoryCatalystReceipts"],
  ["single optional provider gap has an evidence quorum", "oneOptionalProviderGapCanBeNonBlocking"],
  ["final judge has a confidence floor", "finalJudgeConfidence >= 70"],
  ["positive votes have a confidence floor", "result.confidence >= 60"],
  ["positive consensus has a proportional floor", "Math.ceil(applicableCompleted.length * 0.4)"],
];

const missing = requiredContracts.filter(([, marker]) => !source.includes(marker)).map(([label]) => label);
if (missing.length) throw new Error(`AI Committee crypto policy contract missing: ${missing.join(", ")}`);
if (source.includes("failures.length || evidencePack.missingEvidence.length")) throw new Error("Raw optional evidence omissions still block committee approval.");

const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  fileName: "orchestrator.ts",
});
const loadedModule = { exports: {} };
const importStubs = {
  "@/lib/ai-committee/agents": { AI_COMMITTEE_AGENTS: [] },
  "@/lib/ai-committee/evidence-pack": { buildAiCommitteeEvidencePack: async () => ({ ok: false }) },
  "@/lib/ai-committee/provider": { getAiCommitteeProviderStatus: () => ({ configured: false, enabled: false, dryRunDefault: true }), runOpenAiCommitteeProvider: async () => ({ ok: false, status: "disabled" }) },
  "@/lib/ai-committee/run-persistence": { persistAiCommitteeRun: async () => null },
};
const localRequire = (specifier) => {
  if (specifier in importStubs) return importStubs[specifier];
  throw new Error(`Unexpected import while loading committee decision: ${specifier}`);
};
new Function("require", "module", "exports", transpiled.outputText)(localRequire, loadedModule, loadedModule.exports);
const { committeeConsensusDecision } = loadedModule.exports;
if (typeof committeeConsensusDecision !== "function") throw new Error("committeeConsensusDecision was not exported.");

function result(agentId, verdict, confidence, overrides = {}) {
  return {
    agentId,
    status: "completed",
    verdict,
    confidence,
    keyFindings: [],
    supportingEvidence: [],
    concerns: [],
    missingData: [],
    suggestedActionLabel: "Internal review only",
    riskNotes: [],
    followUpChecks: [],
    ...overrides,
  };
}

const nonFinalAgentIds = ["filing_agent", "accountant_agent", "valuation_dcf_agent", "market_agent", "news_agent", "macro_agent", "whale_flow_agent", "industry_agent", "knock_on_ripple_agent", "risk_agent", "skeptic_agent", "compliance_agent", "explainer_agent"];
const allMixed = committeeConsensusDecision([
  ...nonFinalAgentIds.map((agentId) => result(agentId, "mixed", 0)),
  result("final_judge", "mixed", 0),
]);
if (allMixed.overallRecommendation === "approve") throw new Error("Fourteen mixed, zero-confidence outputs incorrectly approved.");

const strongNonFinal = nonFinalAgentIds.slice(0, 10).map((agentId, index) => result(agentId, index < 5 ? "positive" : "mixed", index < 5 ? 78 : 65));
const strongConsensus = committeeConsensusDecision([...strongNonFinal, result("final_judge", "positive", 84)]);
if (strongConsensus.overallRecommendation !== "approve") throw new Error(`Strong positive consensus did not approve: ${strongConsensus.reasons.join(", ")}`);

const actualNegative = committeeConsensusDecision([...strongNonFinal, result("skeptic_agent", "negative", 88, { concerns: ["A supplied receipt directly contradicts the proposed direction."] }), result("final_judge", "positive", 84)]);
if (actualNegative.overallRecommendation !== "reject") throw new Error("An actual negative committee finding did not reject.");

const failedAgent = committeeConsensusDecision([...strongNonFinal, result("news_agent", "mixed", 0, { status: "failed", error: "provider_error" }), result("final_judge", "positive", 84)]);
if (failedAgent.overallRecommendation === "approve") throw new Error("A failed agent did not veto approval.");

console.log(JSON.stringify({
  ok: true,
  digitalAssetAware: true,
  optionalFollowUpsNonBlocking: true,
  mixedZeroConfidenceBlocked: allMixed.overallRecommendation,
  actualNegativeFindingsReject: actualNegative.overallRecommendation === "reject",
  strongConsensusApproves: strongConsensus.overallRecommendation === "approve",
  failedAgentBlocksApproval: failedAgent.overallRecommendation !== "approve",
  strongConsensus: {
    positive: strongConsensus.positiveConsensusCount,
    applicable: strongConsensus.applicableCompletedCount,
    required: strongConsensus.requiredPositiveCount,
    finalJudgeConfidence: strongConsensus.finalJudgeConfidence,
  },
}, null, 2));
