import { NextRequest, NextResponse } from "next/server";
import { runLiveOutcomeEvaluator } from "@/lib/live-outcome-evaluator";

export async function POST(request: NextRequest) {
  let payload: { dryRun?: unknown; ledgerId?: unknown; limit?: unknown; confirmUpdate?: unknown } = { dryRun: true };
  try {
    payload = await request.json() as typeof payload;
  } catch {
    payload = { dryRun: true };
  }

  const dryRun = typeof payload.dryRun === "boolean" ? payload.dryRun : payload.dryRun === "false" ? false : true;
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ ok: dryRun, dryRun, ledgerRowsChecked: 0, ledgerRowsUpdated: 0, skipped: [], missingPriceData: [{ reason: "DATABASE_URL is not configured; no live ledger rows or price snapshots could be checked." }], calculatedResults: [], warnings: ["DATABASE_URL is not configured; ledger outcome scheduler did not query or update live rows."], nextRecommendedAction: "Configure DATABASE_URL, then rerun this route in dryRun mode." }, { status: dryRun ? 200 : 503 });
  }

  const result = await runLiveOutcomeEvaluator(payload);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
