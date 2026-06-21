import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { buildAiCommitteeEvidencePack, type AiCommitteeEvidencePack } from "@/lib/ai-committee/evidence-pack";
import { runFinalJudge } from "@/lib/ai-committee/final-judge";

export type ApprovalRecommendation = "approve" | "reject" | "needs_more_data";

type ApprovalGateInput = {
  candidateAlertId?: unknown;
  alertId?: unknown;
  committeeRunId?: unknown;
  dryRun?: unknown;
  reviewerNote?: unknown;
};

type Check = { key: string; label: string; required: boolean; passed: boolean; detail: string };

const REVIEWABLE_STATUSES = new Set(["candidate", "needs_more_data"]);
const ALLOWED_ACTION_LABELS = new Set(["buy candidate", "speculative buy candidate", "watch", "sell review", "avoid", "no action", "review", "monitor", "hold", "wait", "internal review only", "watchlist only", "needs more data"]);
const UNSAFE_WORDING = ["guaranteed profit", "risk-free", "buy now", "strong buy", "will definitely go up", "certain winner", "no downside", "guaranteed real-time"];

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function bool(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function normalized(value: unknown) {
  return text(value).toLowerCase();
}

function hasText(value: unknown) {
  return text(value).length > 0;
}

function scoreNumber(score: Record<string, unknown> | null, key: string) {
  const value = score?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function proofCount(pack: AiCommitteeEvidencePack | null) {
  const summary = pack?.proofBundleSummary;
  const count = typeof summary?.proofCount === "number" ? summary.proofCount : 0;
  return count;
}

function proofExists(pack: AiCommitteeEvidencePack | null) {
  return Boolean(pack && (proofCount(pack) > 0 || pack.filingEvidence.available || pack.newsEvidence.available || pack.priceVolumeEvidence.available || pack.fundamentalsEvidence.available));
}

function sourceHealthResult(pack: AiCommitteeEvidencePack | null) {
  if (!pack) return { passed: false, warning: "Evidence pack is missing, so source health could not be checked." };
  if (!pack.sourceHealth.length) return { passed: true, warning: "Source health is missing; approval may continue only with this warning shown." };
  const unhealthy = pack.sourceHealth.filter((source) => source.problem || !/ok|healthy|connected|available/i.test(source.status));
  return unhealthy.length ? { passed: true, warning: `Source health warning shown for: ${unhealthy.map((source) => source.source).join(", ")}.` } : { passed: true, warning: null };
}

function unsafeWordingResult(values: unknown[]) {
  const haystack = values.map((value) => (typeof value === "string" ? value : JSON.stringify(value ?? ""))).join("\n").toLowerCase();
  const blockedTerms = UNSAFE_WORDING.filter((term) => haystack.includes(term));
  return { passed: blockedTerms.length === 0, blockedTerms };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function finalJudgePassed(status: string | null) {
  return !status || status === "approve" || status === "passed";
}

function recommendation(failedRequired: Check[], _warnings: string[], finalJudgeStatus: string | null): ApprovalRecommendation {
  if (failedRequired.some((check) => ["alert_exists", "status_reviewable", "action_label_allowed", "proof_exists", "safe_wording"].includes(check.key))) return "reject";
  if (finalJudgeStatus && !finalJudgePassed(finalJudgeStatus)) return finalJudgeStatus === "reject" ? "reject" : "needs_more_data";
  if (failedRequired.length) return "needs_more_data";
  return "approve";
}

async function logApprovalGate(params: { alertId: string; dryRun: boolean; reviewerNote: string; recommendation: ApprovalRecommendation; failedChecks: Check[]; warnings: string[] }) {
  try {
    await prisma.adminAction.create({
      data: {
        action: "candidate_alert_approval_gate",
        subjectType: "alert",
        subjectId: params.alertId,
        metadata: { dryRun: params.dryRun, reviewerNote: params.reviewerNote, recommendation: params.recommendation, failedChecks: params.failedChecks.map((check) => check.key), warnings: params.warnings, route: "/api/internal/approval-gate" } satisfies Prisma.InputJsonObject,
      },
    });
  } catch {
    // Approval gate logging is best-effort and must not create an approval side effect failure.
  }
}

export async function runApprovalGate(input: ApprovalGateInput) {
  const dryRun = bool(input.dryRun, true);
  const candidateAlertId = text(input.candidateAlertId ?? input.alertId);
  const committeeRunId = text(input.committeeRunId);
  const reviewerNote = text(input.reviewerNote);
  const checks: Check[] = [];
  const warnings: string[] = [];

  if (!candidateAlertId) {
    const failed = [{ key: "alert_exists", label: "Alert exists", required: true, passed: false, detail: "candidateAlertId or alertId is required." }];
    return { ok: false, dryRun, candidateAlertId: null, approvalRecommendation: "needs_more_data" as ApprovalRecommendation, passedChecks: [], failedChecks: failed, warnings, safeWordingResult: { passed: true, blockedTerms: [] }, finalJudgeStatus: null, nextRecommendedAction: "Send candidateAlertId or alertId." };
  }

  const alert = await prisma.alert.findUnique({ where: { id: candidateAlertId }, include: { publicLedger: { take: 1 }, scores: { orderBy: { createdAt: "desc" }, take: 1 }, sources: true } });
  checks.push({ key: "alert_exists", label: "Alert exists", required: true, passed: Boolean(alert), detail: alert ? "Candidate alert found." : "Candidate alert was not found." });

  const evidence = alert ? await buildAiCommitteeEvidencePack(candidateAlertId).catch(() => null) : null;
  const pack = evidence?.evidencePack ?? null;
  const latestScore = pack?.score ?? null;
  const committeeRun = await prisma.aiCommitteeRun.findFirst({ where: committeeRunId ? { id: committeeRunId } : { OR: [{ candidateAlertId }, { alertId: candidateAlertId }] }, orderBy: { createdAt: "desc" } }).catch(() => null);
  const finalJudge = committeeRun || committeeRunId ? await runFinalJudge({ candidateAlertId, committeeRunId: committeeRun?.id ?? committeeRunId, dryRun: true }).catch(() => null) : null;
  const finalJudgeStatus = text(finalJudge && "finalDecision" in finalJudge ? finalJudge.finalDecision : null) || null;
  const output = objectValue(committeeRun?.output);

  const sourceHealth = sourceHealthResult(pack);
  if (sourceHealth.warning) warnings.push(sourceHealth.warning);
  if (pack && !pack.historicalPatternMatch.available) warnings.push("Historical pattern match is missing and must be clearly marked missing.");
  if (pack && !latestScore?.pricedInCheck) warnings.push("Priced-in check is missing and must be clearly marked missing.");
  if (pack && !pack.wikidataRippleRelationships.available) warnings.push("Ripple effects are not proven; label them watchlist only.");
  if (!committeeRun) warnings.push("AI Committee final judge is not available; gate evaluated deterministic checks only.");

  checks.push(
    { key: "status_reviewable", label: "Status is candidate or reviewable", required: true, passed: Boolean(alert && REVIEWABLE_STATUSES.has(normalized(alert.status))), detail: alert ? `Current status is ${alert.status}.` : "No alert status available." },
    { key: "action_label_allowed", label: "Action label is allowed", required: true, passed: Boolean(alert && ALLOWED_ACTION_LABELS.has(normalized(alert.action))), detail: alert ? `Action label: ${alert.action}.` : "No action label available." },
    { key: "ticker_company_exists", label: "Ticker/company exists", required: true, passed: Boolean(alert && hasText(alert.ticker) && hasText(alert.company)), detail: "Ticker and company must both be present." },
    { key: "event_headline_exists", label: "Event headline exists", required: true, passed: hasText(pack?.eventHeadline ?? alert?.event), detail: "Event headline must be present." },
    { key: "what_happened_exists", label: "What happened exists", required: true, passed: hasText(pack?.whatHappened ?? alert?.event), detail: "What happened must be present." },
    { key: "why_it_matters_exists", label: "Why it matters exists", required: true, passed: hasText(output.whyItMatters) || hasText(output.why_it_matters) || hasText(output.whyItMattersDraft) || hasText(alert?.event), detail: "Why it matters must be present in committee output or alert explanation." },
    { key: "proof_exists", label: "Proof exists", required: true, passed: proofExists(pack), detail: `${proofCount(pack)} proof item(s) found.` },
    { key: "source_health", label: "Source health acceptable or warning shown", required: true, passed: sourceHealth.passed, detail: sourceHealth.warning ?? "Source health is acceptable." },
    { key: "profit_potential_score", label: "Profit potential score exists", required: true, passed: scoreNumber(latestScore, "profitPotential") !== null, detail: "Persisted profit potential score required." },
    { key: "evidence_confidence_score", label: "Evidence confidence score exists", required: true, passed: scoreNumber(latestScore, "evidenceConfidence") !== null, detail: "Persisted evidence confidence score required." },
    { key: "risk_level", label: "Risk level exists", required: true, passed: hasText(latestScore?.riskLevel) || hasText(committeeRun?.riskLevel), detail: "Risk level required from score or committee run." },
    { key: "historical_pattern", label: "Historical pattern present or marked missing", required: true, passed: Boolean(pack && (pack.historicalPatternMatch.available || pack.historicalPatternMatch.summary?.toLowerCase().includes("not available"))), detail: pack?.historicalPatternMatch.summary ?? "Historical pattern status unavailable." },
    { key: "priced_in_check", label: "Priced-in check present or marked missing", required: true, passed: Boolean(latestScore && (hasText(latestScore.pricedInCheck) || latestScore.persisted)), detail: hasText(latestScore?.pricedInCheck) ? `Priced-in check: ${latestScore?.pricedInCheck}.` : "Priced-in check missing; warning shown." },
    { key: "ripple_effects", label: "Ripple effects proven or watchlist only", required: true, passed: Boolean(pack && (pack.wikidataRippleRelationships.available || pack.wikidataRippleRelationships.summary?.toLowerCase().includes("not available"))), detail: pack?.wikidataRippleRelationships.available ? "Ripple relationship evidence is available." : "Ripple effects must be labelled watchlist only." },
    { key: "what_could_go_wrong", label: "What could go wrong exists", required: true, passed: hasText(output.whatCouldGoWrong) || hasText(output.what_could_go_wrong) || hasText(output.risks) || Boolean(finalJudge?.requiredFixes?.length), detail: "Risk/downside explanation required." },
    { key: "swing_up_view", label: "Swing Up view exists", required: true, passed: hasText(output.swingUpView) || hasText(output.swing_up_view) || hasText(finalJudge?.finalSwingUpView), detail: "Swing Up view required." },
    { key: "view_change", label: "What would change the view exists", required: true, passed: hasText(output.whatWouldChangeTheView) || hasText(output.what_would_change_the_view) || hasText(output.requiredFixes) || Boolean(finalJudge?.requiredFixes?.length), detail: "View-change conditions required." },
    { key: "public_tracking", label: "Public tracking can be created", required: true, passed: Boolean(pack?.sourceLinks.length || alert?.sources.length || alert?.publicLedger.length), detail: "Requires source links or existing tracking context; no ledger row is created here." },
    { key: "final_judge", label: "AI Committee final judge passed if available", required: true, passed: finalJudgePassed(finalJudgeStatus), detail: finalJudgeStatus ? `Final judge status: ${finalJudgeStatus}.` : "Final judge not available; warning shown." },
  );

  const safe = unsafeWordingResult([alert, pack, committeeRun, reviewerNote]);
  checks.push({ key: "safe_wording", label: "No unsafe/hype wording appears", required: true, passed: safe.passed, detail: safe.passed ? "No blocked wording found." : `Blocked wording found: ${safe.blockedTerms.join(", ")}.` });

  const failedChecks = checks.filter((check) => check.required && !check.passed);
  const passedChecks = checks.filter((check) => check.passed);
  const approvalRecommendation = recommendation(failedChecks, warnings, finalJudgeStatus);

  if (!dryRun && approvalRecommendation === "approve" && !reviewerNote) {
    failedChecks.push({ key: "reviewer_note", label: "Reviewer note provided", required: true, passed: false, detail: "reviewerNote is required for non-dry-run approval through this gate." });
  }

  const finalRecommendation = failedChecks.length ? recommendation(failedChecks, warnings, finalJudgeStatus) : approvalRecommendation;
  if (!dryRun && finalRecommendation === "approve" && alert) {
    await prisma.alert.update({ where: { id: alert.id }, data: { status: "approved" } });
  }
  if (alert) await logApprovalGate({ alertId: alert.id, dryRun, reviewerNote, recommendation: finalRecommendation, failedChecks, warnings });

  return { ok: true, dryRun, candidateAlertId, approvalRecommendation: finalRecommendation, passedChecks, failedChecks, warnings, safeWordingResult: safe, finalJudgeStatus, nextRecommendedAction: finalRecommendation === "approve" ? (dryRun ? "Run again with dryRun=false and reviewerNote to mark approved; publishing remains separate." : "Candidate marked approved. Publish/ledger/notification flows remain separate.") : finalRecommendation === "reject" ? "Reject or rewrite the candidate before requesting approval." : "Fill failed checks and warnings, then rerun the approval gate." };
}
