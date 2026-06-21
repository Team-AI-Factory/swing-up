import { NextRequest, NextResponse } from "next/server";
import { runFinalJudge, type FinalJudgeInput } from "@/lib/ai-committee/final-judge";

export async function POST(request: NextRequest) {
  let payload: FinalJudgeInput;
  try {
    payload = (await request.json()) as FinalJudgeInput;
  } catch {
    return NextResponse.json({ ok: false, dryRun: true, finalDecision: "needs_more_data", reason: "Request body must be valid JSON.", requiredFixes: ["Send valid JSON with candidateAlertId or alertId."], publishAllowed: false }, { status: 400 });
  }

  const result = await runFinalJudge({ ...payload, dryRun: payload.dryRun ?? true });
  const status = result.ok ? 200 : 400;
  return NextResponse.json(result, { status });
}
