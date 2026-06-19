import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

const reviewActions = ["approve", "reject", "needs_more_data", "publish"] as const;
const safeActionLabels = ["Buy Candidate", "Speculative Buy Candidate", "Watch", "Sell Review", "Avoid", "No Action"] as const;
const publishReadyStatuses = new Set(["approved"]);
const actionAllowedFromStatus: Record<ReviewAction, Set<string>> = {
  approve: new Set(["candidate"]),
  reject: new Set(["candidate"]),
  needs_more_data: new Set(["candidate"]),
  publish: new Set(["approved"]),
};
const bannedWording = [/buy\s+now/i, /guaranteed/i, /risk[-\s]?free/i, /strong\s+buy/i, /ai\s+knows\s+the\s+next\s+move/i];

type ReviewAction = (typeof reviewActions)[number];
type SafeActionLabel = (typeof safeActionLabels)[number];

type ReviewPayload = {
  alertId?: unknown;
  action?: unknown;
  reviewerNote?: unknown;
  finalSafeActionLabel?: unknown;
};

function isReviewAction(value: string): value is ReviewAction {
  return reviewActions.includes(value as ReviewAction);
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

function needsMoreData(message: string, missingFields: string[] = [], status = 409) {
  return NextResponse.json({ ok: false, result: "needs_more_data", status: "needs_more_data", error: message, missingFields }, { status });
}

async function logAdminAction(params: {
  action: ReviewAction;
  alertId: string;
  reviewerNote: string;
  finalSafeActionLabel: SafeActionLabel;
  result: string;
  missingFields?: string[];
}) {
  try {
    await prisma.adminAction.create({
      data: {
        action: `candidate_alert_${params.action}`,
        subjectType: "alert",
        subjectId: params.alertId,
        metadata: {
          reviewerNote: params.reviewerNote,
          finalSafeActionLabel: params.finalSafeActionLabel,
          result: params.result,
          missingFields: params.missingFields ?? [],
          route: "/api/candidate-alerts/review-action",
        } satisfies Prisma.InputJsonObject,
      },
    });
  } catch {
    // AdminAction logging is best-effort so the review route does not bypass the main safety response.
  }
}

export async function POST(request: NextRequest) {
  let payload: ReviewPayload;
  try {
    payload = (await request.json()) as ReviewPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "Request body must be valid JSON." }, { status: 400 });
  }

  const alertId = typeof payload.alertId === "string" ? payload.alertId.trim() : "";
  const action = typeof payload.action === "string" ? payload.action.trim() : "";
  const reviewerNote = typeof payload.reviewerNote === "string" ? payload.reviewerNote.trim() : "";
  const finalSafeActionLabel = typeof payload.finalSafeActionLabel === "string" ? payload.finalSafeActionLabel.trim() : "";

  if (!alertId) return NextResponse.json({ ok: false, error: "candidate alert id is required as alertId." }, { status: 400 });
  if (!isReviewAction(action)) return NextResponse.json({ ok: false, error: `action must be one of: ${reviewActions.join(", ")}.` }, { status: 400 });
  if (!reviewerNote) return NextResponse.json({ ok: false, error: "reviewerNote is required." }, { status: 400 });
  if (!isSafeActionLabel(finalSafeActionLabel)) return NextResponse.json({ ok: false, error: `finalSafeActionLabel must be one of: ${safeActionLabels.join(", ")}.` }, { status: 400 });

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ ok: false, result: "needs_more_data", error: "DATABASE_URL is not configured; no candidate alert was changed." }, { status: 503 });
  }

  const alert = await prisma.alert.findUnique({
    where: { id: alertId },
    include: { scores: { orderBy: { createdAt: "desc" }, take: 1 }, sources: true },
  });
  if (!alert) return NextResponse.json({ ok: false, result: "needs_more_data", error: "Candidate alert was not found." }, { status: 404 });

  const currentStatus = alert.status.toLowerCase();
  if (!actionAllowedFromStatus[action].has(currentStatus)) {
    await logAdminAction({ action, alertId, reviewerNote, finalSafeActionLabel, result: "blocked_unsafe_transition" });
    return NextResponse.json({ ok: false, error: `Unsafe transition blocked from ${alert.status} with action ${action}.` }, { status: 409 });
  }

  if (unsafeWordingFound(alert.action, alert.event, reviewerNote, finalSafeActionLabel)) {
    await logAdminAction({ action, alertId, reviewerNote, finalSafeActionLabel, result: "blocked_unsafe_wording" });
    return needsMoreData("Unsafe or hype wording was found. Candidate requires more data and safer wording.", ["safe_wording"]);
  }

  if (action === "reject") {
    const updated = await prisma.alert.update({ where: { id: alertId }, data: { status: "rejected", action: finalSafeActionLabel } });
    await logAdminAction({ action, alertId, reviewerNote, finalSafeActionLabel, result: "rejected" });
    return NextResponse.json({ ok: true, result: "rejected", alertId: updated.id, status: updated.status });
  }

  if (action === "needs_more_data") {
    const updated = await prisma.alert.update({ where: { id: alertId }, data: { status: "needs_more_data", action: finalSafeActionLabel } });
    await logAdminAction({ action, alertId, reviewerNote, finalSafeActionLabel, result: "needs_more_data" });
    return NextResponse.json({ ok: true, result: "needs_more_data", alertId: updated.id, status: updated.status });
  }

  const score = alert.scores[0];
  const missingFields: string[] = [];
  if (alert.sources.length === 0) missingFields.push("receipts");
  if (!score?.riskLevel) missingFields.push("risk_level");
  if (typeof score?.profitPotential !== "number") missingFields.push("profit_potential_score");
  if (typeof score?.evidenceConfidence !== "number") missingFields.push("evidence_confidence_score");
  if (!finalSafeActionLabel) missingFields.push("safe_action_label");
  if (!hasDisclaimerSafeWording(alert.event, reviewerNote)) missingFields.push("disclaimer_safe_wording");

  if (action === "approve") {
    if (missingFields.length > 0) {
      await logAdminAction({ action, alertId, reviewerNote, finalSafeActionLabel, result: "blocked_missing_review_checks", missingFields });
      return needsMoreData("Candidate cannot be approved until all final review checks pass.", missingFields);
    }

    const updated = await prisma.alert.update({ where: { id: alertId }, data: { status: "approved", action: finalSafeActionLabel } });
    await logAdminAction({ action, alertId, reviewerNote, finalSafeActionLabel, result: "approved" });
    return NextResponse.json({ ok: true, result: "approved", alertId: updated.id, status: updated.status, finalSafeActionLabel });
  }

  if (!publishReadyStatuses.has(alert.status.toLowerCase())) missingFields.push("approved_status");

  if (missingFields.length > 0) {
    await prisma.alert.update({ where: { id: alertId }, data: { status: "needs_more_data", action: finalSafeActionLabel } });
    await logAdminAction({ action, alertId, reviewerNote, finalSafeActionLabel, result: "needs_more_data", missingFields });
    return needsMoreData("Candidate cannot be published until all final review checks pass.", missingFields);
  }

  const updated = await prisma.alert.update({ where: { id: alertId }, data: { status: "published", action: finalSafeActionLabel, publishedAt: new Date() } });
  await logAdminAction({ action, alertId, reviewerNote, finalSafeActionLabel, result: "published" });
  return NextResponse.json({ ok: true, result: "published", alertId: updated.id, status: updated.status, publishedAt: updated.publishedAt, finalSafeActionLabel });
}
