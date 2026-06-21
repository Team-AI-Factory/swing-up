import { NextRequest, NextResponse } from "next/server";
import { runApprovalGate } from "@/lib/approval-gate/approval-gate";

export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, dryRun: true, candidateAlertId: null, approvalRecommendation: "needs_more_data", passedChecks: [], failedChecks: [{ key: "valid_json", label: "Valid JSON", required: true, passed: false, detail: "Request body must be valid JSON." }], warnings: [], safeWordingResult: { passed: true, blockedTerms: [] }, finalJudgeStatus: null, nextRecommendedAction: "Send valid JSON with candidateAlertId or alertId." }, { status: 400 });
  }

  const result = await runApprovalGate({ ...(payload && typeof payload === "object" ? payload : {}), dryRun: (payload && typeof payload === "object" && "dryRun" in payload ? (payload as { dryRun?: unknown }).dryRun : undefined) ?? true });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
