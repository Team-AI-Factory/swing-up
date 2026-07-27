import { NextRequest, NextResponse } from "next/server";
import { runAiCommittee, type RunAiCommitteeInput } from "@/lib/ai-committee/orchestrator";

export async function POST(request: NextRequest) {
  let payload: RunAiCommitteeInput;
  try {
    payload = (await request.json()) as RunAiCommitteeInput;
  } catch {
    return NextResponse.json({ ok: false, error: "Request body must be valid JSON." }, { status: 400 });
  }

  // Public callers must opt in explicitly to any paid committee execution.
  // The isolated branch worker invokes the orchestrator directly, so keeping
  // this route dry-run by default does not disable the supervised scanner.
  const result = await runAiCommittee({ ...payload, dryRun: payload.dryRun ?? true });
  const status = result.ok ? 200 : result.status === "not_configured" || result.status === "disabled" || result.status === "confirmation_required" ? 403 : result.status === "missing_candidate_alert_id" ? 400 : 422;
  return NextResponse.json(result, { status });
}
