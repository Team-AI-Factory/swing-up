import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

const candidateAlertStates = ["candidate", "needs_more_data", "rejected", "approved", "published"] as const;
const safeActionLabels = ["Buy Candidate", "Speculative Buy Candidate", "Watch", "Sell Review", "Avoid", "No Action"] as const;
const bannedWording = [/buy\s+now/i, /guaranteed/i, /risk[-\s]?free/i, /strong\s+buy/i, /ai\s+knows\s+the\s+next\s+move/i, /sure\s+thing/i, /can'?t\s+miss/i];
const allowedTransitions: Record<CandidateAlertState, CandidateAlertState[]> = {
  candidate: ["needs_more_data", "rejected", "approved"],
  needs_more_data: ["candidate"],
  rejected: [],
  approved: ["published"],
  published: [],
};

type CandidateAlertState = (typeof candidateAlertStates)[number];
type SafeActionLabel = (typeof safeActionLabels)[number];

type StateTransitionPayload = {
  alertId?: unknown;
  candidateAlertId?: unknown;
  toState?: unknown;
  targetState?: unknown;
  reviewerNote?: unknown;
  finalSafeActionLabel?: unknown;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isCandidateAlertState(value: string): value is CandidateAlertState {
  return candidateAlertStates.includes(value as CandidateAlertState);
}

function isSafeActionLabel(value: string): value is SafeActionLabel {
  return safeActionLabels.includes(value as SafeActionLabel);
}

function unsafeWordingFound(...values: Array<string | null | undefined>) {
  const joined = values.filter(Boolean).join(" \n ");
  return bannedWording.some((pattern) => pattern.test(joined));
}

function hasDisclaimerSafeWording(...values: Array<string | null | undefined>) {
  const joined = values.filter(Boolean).join(" \n ").toLowerCase();
  return joined.includes("not financial advice") || joined.includes("research") || joined.includes("not investment advice");
}

function requiredReviewChecks(alert: { action: string; event: string; sources: unknown[]; scores: Array<{ riskLevel: string | null; profitPotential: number | null; evidenceConfidence: number | null }> }, finalSafeActionLabel: string, reviewerNote: string) {
  const score = alert.scores[0];
  const missingFields: string[] = [];
  if (!isSafeActionLabel(finalSafeActionLabel)) missingFields.push("safe_action_label");
  if (!score?.riskLevel) missingFields.push("risk_level");
  if (typeof score?.evidenceConfidence !== "number") missingFields.push("evidence_confidence_score");
  if (typeof score?.profitPotential !== "number") missingFields.push("profit_potential_score");
  if (alert.sources.length === 0) missingFields.push("proof_or_source");
  if (!hasDisclaimerSafeWording(alert.event, reviewerNote)) missingFields.push("disclaimer_safe_wording");
  if (unsafeWordingFound(alert.action, alert.event, reviewerNote, finalSafeActionLabel)) missingFields.push("safe_wording_no_hype");
  return missingFields;
}

async function logAdminAction(params: { alertId: string; fromState: string; toState: string; reviewerNote: string; finalSafeActionLabel: string; result: string; missingFields?: string[] }) {
  try {
    await prisma.adminAction.create({
      data: {
        action: "candidate_alert_state_transition",
        subjectType: "alert",
        subjectId: params.alertId,
        metadata: {
          fromState: params.fromState,
          toState: params.toState,
          reviewerNote: params.reviewerNote,
          finalSafeActionLabel: params.finalSafeActionLabel,
          result: params.result,
          missingFields: params.missingFields ?? [],
          route: "/api/candidate-alerts/state-transition",
        } satisfies Prisma.InputJsonObject,
      },
    });
  } catch {
    // AdminAction logging is best-effort; never turn a safe transition response into an unsafe side effect.
  }
}

export async function POST(request: NextRequest) {
  let payload: StateTransitionPayload;
  try {
    payload = (await request.json()) as StateTransitionPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "Request body must be valid JSON." }, { status: 400 });
  }

  const alertId = text(payload.alertId) || text(payload.candidateAlertId);
  const toState = text(payload.toState ?? payload.targetState).toLowerCase();
  const reviewerNote = text(payload.reviewerNote);
  const finalSafeActionLabel = text(payload.finalSafeActionLabel);

  if (!alertId) return NextResponse.json({ ok: false, error: "alertId or candidateAlertId is required." }, { status: 400 });
  if (!isCandidateAlertState(toState)) return NextResponse.json({ ok: false, error: `toState must be one of: ${candidateAlertStates.join(", ")}.` }, { status: 400 });
  if (!reviewerNote) return NextResponse.json({ ok: false, error: "reviewerNote is required." }, { status: 400 });

  if (!process.env.DATABASE_URL) return NextResponse.json({ ok: false, error: "DATABASE_URL is not configured; no candidate alert was changed." }, { status: 503 });

  const alert = await prisma.alert.findUnique({ where: { id: alertId }, include: { scores: { orderBy: { createdAt: "desc" }, take: 1 }, sources: true } });
  if (!alert) return NextResponse.json({ ok: false, error: "Candidate alert was not found." }, { status: 404 });

  const fromState = alert.status.toLowerCase();
  if (!isCandidateAlertState(fromState)) return NextResponse.json({ ok: false, error: `Alert status '${alert.status}' is not managed by the candidate alert review state machine.` }, { status: 409 });
  if (!allowedTransitions[fromState].includes(toState)) {
    await logAdminAction({ alertId, fromState, toState, reviewerNote, finalSafeActionLabel, result: "blocked_unsafe_transition" });
    return NextResponse.json({ ok: false, error: `Unsafe transition blocked: ${fromState} → ${toState}.`, allowedTransitions: allowedTransitions[fromState] }, { status: 409 });
  }

  const needsFinalChecks = toState === "approved" || toState === "published";
  const missingFields = needsFinalChecks ? requiredReviewChecks(alert, finalSafeActionLabel, reviewerNote) : [];
  if (missingFields.length > 0) {
    await logAdminAction({ alertId, fromState, toState, reviewerNote, finalSafeActionLabel, result: "blocked_missing_review_checks", missingFields });
    return NextResponse.json({ ok: false, error: `Candidate cannot move to ${toState} until all review checks pass.`, missingFields }, { status: 409 });
  }

  const data: Prisma.AlertUpdateInput = { status: toState };
  if (finalSafeActionLabel) data.action = finalSafeActionLabel;
  if (toState === "published") data.publishedAt = new Date();

  const updated = await prisma.alert.update({ where: { id: alertId }, data });
  await logAdminAction({ alertId, fromState, toState, reviewerNote, finalSafeActionLabel, result: toState });

  return NextResponse.json({ ok: true, alertId: updated.id, fromState, toState: updated.status, publishedAt: updated.publishedAt, finalSafeActionLabel: finalSafeActionLabel || updated.action });
}
