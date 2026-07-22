import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../lib/ai-committee/orchestrator.ts", import.meta.url), "utf8");
const evidencePackSource = await readFile(new URL("../lib/ai-committee/evidence-pack.ts", import.meta.url), "utf8");
const requiredContracts = [
  ["public-equity classification", "assetClass: \"public_equity\""],
  ["event-first public-equity judgment", "This is an event-first public-equity prediction."],
  ["issuer mapping is primary", "exact issuer mapping"],
  ["no prior price move prerequisite", "A prior 2% move or 1% post-event move is neither required nor proof."],
  ["optional omissions are moved to follow-ups", "isNonBlockingMissingItem"],
  ["only blocking pack omissions affect approval", "policy.blockingMissingEvidence"],
  ["what happened reaches the committee", "whatHappened: pack.whatHappened"],
  ["aligned catalyst evidence is prioritized", "alignedCatalystReceipts"],
  ["contradictions are prioritized", "contradictoryCatalystReceipts"],
  ["final judge has an 80 confidence floor", "finalJudgeConfidence >= 80"],
  ["positive votes have a 70 confidence floor", "result.confidence >= 70"],
  ["positive consensus has a 60 percent floor", "Math.ceil(applicableCompleted.length * 0.6)"],
  ["positive consensus has a minimum of six", "Math.max(6"],
];

const missing = requiredContracts.filter(([, marker]) => !source.includes(marker)).map(([label]) => label);
if (missing.length) throw new Error(`AI Committee public-equity policy contract missing: ${missing.join(", ")}`);
if (!evidencePackSource.includes('assetClass: "public_equity"')) throw new Error("Evidence packs are not explicitly classified as public equity.");
if (source.includes("failures.length || evidencePack.missingEvidence.length")) throw new Error("Raw optional evidence omissions still block committee approval.");
const publicEquityPromptStart = source.indexOf("This is an event-first public-equity prediction.");
const publicEquityPromptEnd = source.indexOf(': "Apply the supplied company/asset evidence', publicEquityPromptStart);
const publicEquityPrompt = source.slice(publicEquityPromptStart, publicEquityPromptEnd);
if (/token market structure|circulating\/max supply|dilution\/FDV|stablecoin/i.test(publicEquityPrompt)) throw new Error("Public-equity instructions contain irrelevant crypto assumptions.");
if (source.indexOf('if (pack.assetClass === "public_equity")') > source.indexOf("if (!isDigitalAssetEvidence(pack))")) throw new Error("Explicit public-equity classification is not evaluated before legacy asset inference.");

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

const nonFinalAgentIds = ["filing_agent", "accountant_agent", "valuation_dcf_agent", "market_agent", "news_agent", "macro_agent", "industry_agent", "knock_on_ripple_agent", "risk_agent", "compliance_agent"];
const allMixed = committeeConsensusDecision([
  ...nonFinalAgentIds.map((agentId) => result(agentId, "mixed", 0)),
  result("final_judge", "mixed", 0),
]);
if (allMixed.overallRecommendation === "approve") throw new Error("Mixed, zero-confidence outputs incorrectly approved.");

const exactThresholdVotes = nonFinalAgentIds.map((agentId, index) => result(agentId, index < 6 ? "positive" : "mixed", index < 6 ? 70 : 65));
const exactThresholdConsensus = committeeConsensusDecision([...exactThresholdVotes, result("final_judge", "positive", 80)]);
if (exactThresholdConsensus.overallRecommendation !== "approve") throw new Error(`Exact threshold consensus did not approve: ${exactThresholdConsensus.reasons.join(", ")}`);

const lowFinalJudge = committeeConsensusDecision([...exactThresholdVotes, result("final_judge", "positive", 79)]);
if (lowFinalJudge.overallRecommendation === "approve") throw new Error("A final judge below 80 confidence incorrectly approved.");

const lowConfidenceVotes = nonFinalAgentIds.map((agentId, index) => result(agentId, index < 6 ? "positive" : "mixed", index < 6 ? 69 : 65));
const lowConfidenceConsensus = committeeConsensusDecision([...lowConfidenceVotes, result("final_judge", "positive", 90)]);
if (lowConfidenceConsensus.overallRecommendation === "approve") throw new Error("Positive votes below 70 confidence incorrectly counted toward approval.");

const onlyFiveApplicable = committeeConsensusDecision([
  ...nonFinalAgentIds.slice(0, 5).map((agentId) => result(agentId, "positive", 95)),
  result("final_judge", "positive", 95),
]);
if (onlyFiveApplicable.overallRecommendation === "approve") throw new Error("Fewer than six applicable positive votes incorrectly approved.");

const elevenAgentIds = [...nonFinalAgentIds, "explainer_agent"];
const belowSixtyPercent = committeeConsensusDecision([
  ...elevenAgentIds.map((agentId, index) => result(agentId, index < 6 ? "positive" : "mixed", index < 6 ? 90 : 65)),
  result("final_judge", "positive", 90),
]);
if (belowSixtyPercent.overallRecommendation === "approve") throw new Error("Six of eleven positive votes incorrectly passed the 60 percent consensus requirement.");

const actualNegative = committeeConsensusDecision([...exactThresholdVotes, result("skeptic_agent", "negative", 88, { concerns: ["A supplied receipt directly contradicts the proposed direction."] }), result("final_judge", "positive", 84)]);
if (actualNegative.overallRecommendation !== "reject") throw new Error("An actual negative committee finding did not reject.");

const failedAgent = committeeConsensusDecision([...exactThresholdVotes, result("news_agent_failure", "mixed", 0, { status: "failed", error: "provider_error" }), result("final_judge", "positive", 84)]);
if (failedAgent.overallRecommendation === "approve") throw new Error("A failed agent did not veto approval.");

console.log(JSON.stringify({
  ok: true,
  publicEquityEventFirst: true,
  noPriceMovePrerequisite: true,
  noIrrelevantCryptoAssumptions: true,
  optionalFollowUpsNonBlocking: true,
  mixedZeroConfidenceBlocked: allMixed.overallRecommendation,
  actualNegativeFindingsReject: actualNegative.overallRecommendation === "reject",
  exactThresholdConsensusApproves: exactThresholdConsensus.overallRecommendation === "approve",
  finalJudgeFloorEnforced: lowFinalJudge.overallRecommendation !== "approve",
  positiveVoteFloorEnforced: lowConfidenceConsensus.overallRecommendation !== "approve",
  minimumSixEnforced: onlyFiveApplicable.overallRecommendation !== "approve",
  sixtyPercentConsensusEnforced: belowSixtyPercent.overallRecommendation !== "approve",
  failedAgentBlocksApproval: failedAgent.overallRecommendation !== "approve",
  exactThresholdConsensus: {
    positive: exactThresholdConsensus.positiveConsensusCount,
    applicable: exactThresholdConsensus.applicableCompletedCount,
    required: exactThresholdConsensus.requiredPositiveCount,
    finalJudgeConfidence: exactThresholdConsensus.finalJudgeConfidence,
  },
}, null, 2));
