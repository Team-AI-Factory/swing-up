import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { AI_COMMITTEE_AGENTS } from "@/lib/ai-committee/agents";
import { buildAiCommitteeEvidencePack, type AiCommitteeEvidencePack } from "@/lib/ai-committee/evidence-pack";

export type FinalJudgeDecision = "approve" | "reject" | "needs_more_data";

export type FinalJudgeInput = {
  candidateAlertId?: unknown;
  alertId?: unknown;
  committeeRunId?: unknown;
  dryRun?: unknown;
  confirmJudge?: unknown;
};

type AgentRow = {
  agentId: string;
  status: string;
  verdict: string | null;
  confidence: number | null;
  missingData: Prisma.JsonValue;
  keyFindings: Prisma.JsonValue;
  concerns: Prisma.JsonValue;
  suggestedActionLabel: string | null;
  output: Prisma.JsonValue;
  error: string | null;
};

const REQUIRED_AGENT_IDS = AI_COMMITTEE_AGENTS.filter((agent) => agent.required && agent.id !== "final_judge").map((agent) => agent.id);
const ALLOWED_ACTION_LABELS = new Set(["WATCH", "REVIEW", "MONITOR", "HOLD", "BUY", "SELL", "AVOID", "WAIT", "INTERNAL REVIEW ONLY", "WATCHLIST ONLY", "NEEDS MORE DATA"]);
const UNSAFE_WORDS = ["guaranteed", "risk-free", "can't lose", "cannot lose", "sure thing", "buy now", "get rich", "double your money", "100%", "certain profit"];

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function bool(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function strings(value: unknown): string[] {
  return array(value).filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

function outputRecord(row: AgentRow | undefined) {
  return row?.output && typeof row.output === "object" && !Array.isArray(row.output) ? (row.output as Record<string, unknown>) : {};
}

function hasAnyText(values: unknown[]) {
  return values.some((value) => typeof value === "string" && value.trim().length > 0);
}

function containsUnsafe(value: unknown) {
  const haystack = JSON.stringify(value ?? {}).toLowerCase();
  return UNSAFE_WORDS.filter((word) => haystack.includes(word));
}

function actionAllowed(label: string | null) {
  if (!label) return false;
  const normalized = label.trim().toUpperCase();
  return ALLOWED_ACTION_LABELS.has(normalized) || normalized.includes("REVIEW") || normalized.includes("WATCH");
}

function scoreNumber(score: Record<string, unknown> | null, key: string) {
  const value = score?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function hasProof(pack: AiCommitteeEvidencePack) {
  const summary = pack.proofBundleSummary as Record<string, unknown> | null;
  const count = typeof summary?.proofCount === "number" ? summary.proofCount : 0;
  return count > 0 || pack.filingEvidence.available || pack.newsEvidence.available || pack.priceVolumeEvidence.available || pack.fundamentalsEvidence.available;
}

function finalDecision(blockers: string[], fixes: string[], warnings: string[]): FinalJudgeDecision {
  if (blockers.length) return "reject";
  if (fixes.length || warnings.length) return "needs_more_data";
  return "approve";
}

export async function runFinalJudge(input: FinalJudgeInput) {
  const dryRun = bool(input.dryRun, true);
  const candidateAlertId = text(input.candidateAlertId ?? input.alertId);
  const committeeRunId = text(input.committeeRunId);
  if (!candidateAlertId && !committeeRunId) {
    return { ok: false, dryRun, finalDecision: "needs_more_data" as FinalJudgeDecision, reason: "candidateAlertId or alertId is required unless committeeRunId is supplied.", requiredFixes: ["Send candidateAlertId/alertId or committeeRunId."], publishAllowed: false };
  }
  if (!dryRun && !bool(input.confirmJudge, false)) {
    return { ok: false, dryRun, finalDecision: "needs_more_data" as FinalJudgeDecision, reason: "confirmJudge is required when dryRun=false.", requiredFixes: ["Retry with confirmJudge=true."], publishAllowed: false };
  }

  const run = await prisma.aiCommitteeRun.findFirst({
    where: committeeRunId ? { id: committeeRunId } : { OR: [{ candidateAlertId }, { alertId: candidateAlertId }] },
    orderBy: { createdAt: "desc" },
    include: { agentResults: true },
  }).catch(() => null);
  const effectiveCandidateId = candidateAlertId || run?.candidateAlertId || run?.alertId || "";
  const evidence = effectiveCandidateId ? await buildAiCommitteeEvidencePack(effectiveCandidateId).catch(() => null) : null;
  const pack = evidence?.evidencePack ?? null;

  const blockers: string[] = [];
  const requiredFixes: string[] = [];
  const warnings: string[] = [];
  const duplicateSafetyNotes = ["Final judge does not publish alerts.", "Final judge does not send Telegram notifications.", "Final judge does not fabricate missing proof."];

  if (!pack) blockers.push("Evidence pack is missing or candidate alert was not found.");
  if (evidence?.missingRequiredEvidence?.length) requiredFixes.push(`Complete missing required evidence: ${evidence.missingRequiredEvidence.join(", ")}.`);
  if (!run) requiredFixes.push("Run the AI committee before requesting final judge approval.");

  const agentRows = (run?.agentResults ?? []) as AgentRow[];
  const rowById = new Map(agentRows.map((row) => [row.agentId, row]));
  const missingRequiredAgents = REQUIRED_AGENT_IDS.filter((id) => !rowById.has(id));
  if (missingRequiredAgents.length) requiredFixes.push(`Required agents did not run or were not logged as safely skipped: ${missingRequiredAgents.join(", ")}.`);
  const failedRequired = REQUIRED_AGENT_IDS.filter((id) => ["failed", "blocked"].includes(text(rowById.get(id)?.status).toLowerCase()));
  if (failedRequired.length) requiredFixes.push(`Required agents failed or were blocked: ${failedRequired.join(", ")}.`);

  const compliance = rowById.get("compliance_agent");
  const complianceWarnings = strings(run?.complianceWarnings).concat(strings(outputRecord(compliance).concerns), strings(compliance?.concerns));
  if (!compliance) requiredFixes.push("Compliance Agent result is missing.");
  if (compliance && (text(compliance.verdict).toLowerCase() === "negative" || compliance.status !== "completed" || complianceWarnings.length > 0)) blockers.push("Compliance Agent did not cleanly pass.");

  const risk = rowById.get("risk_agent");
  if (!risk || (!strings(risk.concerns).length && !strings(outputRecord(risk).riskNotes).length && !strings(outputRecord(risk).concerns).length)) requiredFixes.push("Risk Agent must produce explicit risks.");
  const skeptic = rowById.get("skeptic_agent");
  if (!skeptic || (!strings(skeptic.concerns).length && !strings(outputRecord(skeptic).concerns).length)) requiredFixes.push("Skeptic Agent must produce concerns.");
  const explainer = rowById.get("explainer_agent");
  if (!explainer || !hasAnyText([...(strings(explainer.keyFindings)), text(outputRecord(explainer).summary), text(outputRecord(explainer).promptSummary), text(outputRecord(explainer).explanationDraft)])) requiredFixes.push("Explainer Agent must produce a simple explanation.");

  const actionLabel = text(run?.selectedActionLabel) || pack?.actionLabel || null;
  if (!actionAllowed(actionLabel)) blockers.push("Action label is missing or not in the allowed safe-label set.");
  if (!pack?.score) requiredFixes.push("Persisted scores are missing.");
  if (pack?.score && (scoreNumber(pack.score, "profitPotential") === null || scoreNumber(pack.score, "evidenceConfidence") === null)) requiredFixes.push("Profit potential and evidence confidence scores must both exist.");
  const riskLevel = text(run?.riskLevel) || text(pack?.score?.riskLevel);
  if (!riskLevel || riskLevel === "unknown") requiredFixes.push("Risk level is missing.");
  if (pack && !hasProof(pack)) blockers.push("Proof is missing; final judge will not fake proof.");
  if (pack && !pack.historicalPatternMatch.available) warnings.push("Historical pattern is missing and must remain clearly disclosed.");
  if (pack && !pack.wikidataRippleRelationships.available) warnings.push("Ripple effects are not proven; treat as watchlist-only rather than verified ripple proof.");
  const unsafe = containsUnsafe({ run, evidence });
  if (unsafe.length) blockers.push(`Unsafe wording or performance promise detected: ${unsafe.join(", ")}.`);
  if (pack && pack.sourceLinks.length === 0) blockers.push("No source links are available; public tracking cannot be created honestly.");
  if (pack && JSON.stringify(pack).toLowerCase().includes("mock")) blockers.push("Possible mock/fake data marker detected in evidence pack.");

  const decision = finalDecision(blockers, requiredFixes, warnings);
  const publishAllowed = decision === "approve" && !dryRun && bool(input.confirmJudge, false) && blockers.length === 0;
  return {
    ok: true,
    dryRun,
    candidateAlertId: effectiveCandidateId || null,
    committeeRunId: run?.id ?? null,
    finalDecision: decision,
    reason: blockers[0] ?? requiredFixes[0] ?? warnings[0] ?? "Final judge checks passed; publishing may proceed only through the separate approval/publish flow.",
    requiredFixes: [...blockers, ...requiredFixes, ...warnings],
    approvedActionLabel: decision === "approve" ? actionLabel : null,
    finalProfitPotentialScore: pack?.score ? scoreNumber(pack.score, "profitPotential") : null,
    finalEvidenceConfidenceScore: pack?.score ? scoreNumber(pack.score, "evidenceConfidence") : null,
    finalRiskLevel: riskLevel || null,
    finalSwingUpView: decision === "approve" ? "Approved for separate publish gate review; not investment advice and not a performance promise." : "Do not publish until required fixes are complete.",
    publishAllowed,
    checks: { evidencePackExists: Boolean(pack), requiredAgents: REQUIRED_AGENT_IDS, missingRequiredAgents, failedRequired, compliancePassed: Boolean(compliance) && blockers.every((item) => !item.includes("Compliance")), riskAgentProducedRisks: !requiredFixes.some((item) => item.includes("Risk Agent")), skepticProducedConcerns: !requiredFixes.some((item) => item.includes("Skeptic Agent")), explainerProducedSimpleExplanation: !requiredFixes.some((item) => item.includes("Explainer Agent")), actionLabelAllowed: actionAllowed(actionLabel), scoresExist: Boolean(pack?.score), proofExists: Boolean(pack && hasProof(pack)), historicalPatternStatus: pack?.historicalPatternMatch.available ? "present" : "missing_disclosed", rippleEffectStatus: pack?.wikidataRippleRelationships.available ? "proven" : "watchlist_only", safeWording: unsafe.length === 0, noFakeData: !blockers.some((item) => item.includes("fake")), noUnsafePerformancePromise: unsafe.length === 0, publicTrackingCanBeCreated: Boolean(pack?.sourceLinks.length) },
    safetyNotes: duplicateSafetyNotes,
  };
}
