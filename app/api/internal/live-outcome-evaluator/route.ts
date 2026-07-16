import { NextRequest, NextResponse } from "next/server";
import { runLiveOutcomeEvaluator } from "@/lib/live-outcome-evaluator";

function authorized(request: NextRequest) {
  const expected = process.env.SWING_UP_AUTOMATION_TOKEN?.trim() || process.env.EAR_RUN_TOKEN?.trim();
  if (!expected) return process.env.NODE_ENV !== "production";
  const supplied = request.headers.get("x-swing-up-automation-token")?.trim()
    || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  return supplied === expected;
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    provider: "coingecko",
    realPricesOnly: true,
    supportedWindows: ["1D", "3D", "7D", "30D", "90D"],
    writesRequire: ["dryRun=false", "confirmUpdate=true", "automation token in production"],
    mockFallback: false,
  });
}

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => ({})) as Record<string, unknown>;
  const dryRun = payload.dryRun !== false;
  if (!dryRun && !authorized(request)) return NextResponse.json({ ok: false, dryRun, error: "unauthorized_live_outcome_write" }, { status: 401 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ ok: dryRun, dryRun, checked: 0, updated: 0, provider: "coingecko", realPricesOnly: true, results: [], error: "database_not_configured" }, { status: dryRun ? 200 : 503 });
  const result = await runLiveOutcomeEvaluator(payload);
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
