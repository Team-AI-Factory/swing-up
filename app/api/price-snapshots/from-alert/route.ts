import { NextRequest, NextResponse } from "next/server";
import { createSnapshotFromAlert } from "@/lib/ledger-outcome-worker";

export async function POST(request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { ok: false, result: "needs_more_data", error: "DATABASE_URL is not configured; no price snapshot was created.", warnings: ["Live database is unavailable in this environment."] },
      { status: 503 },
    );
  }

  let payload: { alertId?: unknown; price?: unknown; latestPrice?: unknown; capturedAt?: unknown };
  try {
    payload = (await request.json()) as { alertId?: unknown; price?: unknown; latestPrice?: unknown; capturedAt?: unknown };
  } catch {
    return NextResponse.json({ ok: false, result: "needs_more_data", error: "Request body must be valid JSON with an alertId.", warnings: [] }, { status: 400 });
  }

  const result = await createSnapshotFromAlert({ alertId: payload.alertId, price: payload.price ?? payload.latestPrice, capturedAt: payload.capturedAt });
  const status = result.ok && result.result !== "needs_more_data" ? 200 : result.ok ? 202 : 400;
  return NextResponse.json(result, { status });
}
