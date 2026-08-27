import { NextRequest, NextResponse } from "next/server";
import { internalApiScopeAuthorized } from "@/lib/internal-api-auth";
import {
  runPr262AnalysisOnlyCycle,
  runPr262CronCycle,
} from "@/lib/opportunity-engine/pr262-cron-orchestrator";

export const dynamic = "force-dynamic";

function authorized(request: NextRequest) {
  return internalApiScopeAuthorized(request.headers, "cron_runtime");
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const result = body.mode === "analysis_only"
      ? await runPr262AnalysisOnlyCycle()
      : await runPr262CronCycle();
    return NextResponse.json(result, { status: result.ok ? 200 : 503 });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      mode: "pr262_five_minute_cron_v3",
      checkedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 500) : "pr262_cron_cycle_failed",
      safety: { publishing: false, notifications: false, trades: false, databaseWrites: false },
    }, { status: 500 });
  }
}
