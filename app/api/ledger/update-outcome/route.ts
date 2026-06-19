import { NextRequest, NextResponse } from "next/server";
import { updateLedgerOutcome } from "@/lib/ledger-outcome-worker";

export async function POST(request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { ok: false, result: "needs_more_data", error: "DATABASE_URL is not configured; no ledger outcome was updated.", warnings: ["Live database is unavailable in this environment."] },
      { status: 503 },
    );
  }

  let payload: { ledgerId?: unknown; alertId?: unknown };
  try {
    payload = (await request.json()) as { ledgerId?: unknown; alertId?: unknown };
  } catch {
    return NextResponse.json({ ok: false, result: "needs_more_data", error: "Request body must be valid JSON with a ledgerId or alertId.", warnings: [] }, { status: 400 });
  }

  const result = await updateLedgerOutcome(payload);
  const status = result.ok ? 200 : 400;
  return NextResponse.json(result, { status });
}
