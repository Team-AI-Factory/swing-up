#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";

const path = "lib/equity-signal/runner.ts";
let source = await readFile(path, "utf8");

function replaceOnce(label, before, after) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}_expected_once_found_${count}`);
  source = source.replace(before, after);
}

if (!source.includes('from "@/lib/equity-signal/pilot-serious-signal-policy"')) {
  replaceOnce(
    "pilot_import",
    'import { fetchMacroContext } from "@/lib/equity-signal/macro";\n',
    'import { fetchMacroContext } from "@/lib/equity-signal/macro";\nimport { evaluateFiveCasePilotGate } from "@/lib/equity-signal/pilot-serious-signal-policy";\n',
  );
}

source = source.replace(
  "historicalComparisonRequiredForSeriousSignal: false,",
  "historicalComparisonRequiredForSeriousSignal: true,",
);
source = source.replace(
  "actionableBuySellRequiresCalibratedHistory: false,",
  "actionableBuySellRequiresCalibratedHistory: true,",
);
source = source.replace(
  "historical_comparison_required:false",
  "historical_comparison_required:true",
);

if (!source.includes("const pilotGate = evaluateFiveCasePilotGate(best);")) {
  replaceOnce(
    "pilot_gate",
    '    const recommendation = committee.committeeOutput?.overallRecommendation ?? "needs_more_data";\n    const seriousSignalFound = committee.ok === true && completed === 14 && failed === 0 && recommendation === "approve" && finalJudge?.verdict === "positive" && (finalJudge.confidence ?? 0) >= 80 && best.gatePassed && Boolean(best.quote);\n',
    '    const recommendation = committee.committeeOutput?.overallRecommendation ?? "needs_more_data";\n    const pilotGate = evaluateFiveCasePilotGate(best);\n    const seriousSignalFound = committee.ok === true\n      && completed === 14\n      && failed === 0\n      && recommendation === "approve"\n      && finalJudge?.verdict === "positive"\n      && (finalJudge.confidence ?? 0) >= 80\n      && best.gatePassed\n      && Boolean(best.quote)\n      && pilotGate.passed;\n',
  );
}

replaceOnce(
  "final_return",
  '    return { ...common, status: seriousSignalFound ? `serious_${alertType}` : "candidate_needs_more_data", seriousSignalFound, actionableSignalFound, alertType, openAiCalled: true, candidateFingerprint: fingerprint, selectedCandidate, qualityScore: Math.round((best.score * 0.45 + (committee.committeeOutput?.evidenceConfidenceScore ?? 0) * 0.25 + (finalJudge?.confidence ?? 0) * 0.3) * 100) / 100, committee: { ok: committee.ok, status: committee.status, agentsPlanned: committee.plannedAgents?.length ?? 0, agentsCompleted: completed, agentsFailed: failed, finalJudge: finalJudge ? { verdict: finalJudge.verdict, confidence: finalJudge.confidence, concerns: finalJudge.concerns, missingData: finalJudge.missingData, followUpChecks: finalJudge.followUpChecks } : null, output: committee.committeeOutput, writesDatabase: committee.compatibility?.writesDatabase ?? false }, blockers: seriousSignalFound ? [] : [...new Set([...(committee.committeeOutput?.missingEvidence ?? []), ...(finalJudge?.missingData ?? []), ...(finalJudge?.concerns ?? [])])].slice(0, 12), technicalFailureFingerprint: committee.ok ? null : `committee_${committee.status}`, failureScope: committee.ok ? "none" : "external_provider", repairEligible: false };\n',
  '    return { ...common, status: seriousSignalFound ? `serious_${alertType}` : "candidate_needs_more_data", seriousSignalFound, actionableSignalFound, alertType, openAiCalled: true, candidateFingerprint: fingerprint, selectedCandidate, historicalPilot: pilotGate, qualityScore: Math.round((best.score * 0.45 + (committee.committeeOutput?.evidenceConfidenceScore ?? 0) * 0.25 + (finalJudge?.confidence ?? 0) * 0.3) * 100) / 100, committee: { ok: committee.ok, status: committee.status, agentsPlanned: committee.plannedAgents?.length ?? 0, agentsCompleted: completed, agentsFailed: failed, finalJudge: finalJudge ? { verdict: finalJudge.verdict, confidence: finalJudge.confidence, concerns: finalJudge.concerns, missingData: finalJudge.missingData, followUpChecks: finalJudge.followUpChecks } : null, output: committee.committeeOutput, writesDatabase: committee.compatibility?.writesDatabase ?? false }, blockers: seriousSignalFound ? [] : [...new Set([...pilotGate.blockers, ...(committee.committeeOutput?.missingEvidence ?? []), ...(finalJudge?.missingData ?? []), ...(finalJudge?.concerns ?? [])])].slice(0, 12), technicalFailureFingerprint: committee.ok ? null : `committee_${committee.status}`, failureScope: committee.ok ? "none" : "external_provider", repairEligible: false };\n',
);

if (!source.includes("historicalComparisonRequiredForSeriousSignal: true")) {
  throw new Error("historical_comparison_policy_not_restored");
}
if (!source.includes("actionableBuySellRequiresCalibratedHistory: true")) {
  throw new Error("actionable_history_policy_not_restored");
}
if (!source.includes("&& pilotGate.passed;")) {
  throw new Error("pilot_gate_not_bound_to_serious_signal");
}

await writeFile(path, source, "utf8");
console.log("Restored mandatory PR #262 event Pilot 5 guard.");
