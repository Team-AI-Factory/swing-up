import { NextRequest, NextResponse } from "next/server";
import { runGenericNewsTriage } from "@/lib/generic-news-triage";
import { withRedactionMetadata } from "@/lib/redact-secrets";

export const dynamic = "force-dynamic";

function bool(value: unknown, fallback: boolean) { return typeof value === "boolean" ? value : fallback; }
function int(value: unknown, fallback: number) { const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN; return Number.isFinite(parsed) ? Math.floor(parsed) : fallback; }

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const dryRun = bool(body.dryRun, true);
  const confirmRun = bool(body.confirmRun, false);
  const result = await runGenericNewsTriage({
    maxGenericItemsToScan: int(body.maxGenericItemsToScan, 50),
    maxRippleCandidates: int(body.maxRippleCandidates, 10),
    maxDeepChecks: confirmRun ? int(body.maxDeepChecks, 5) : 0,
    confirmRun,
  });
  return NextResponse.json(withRedactionMetadata({ ok: true, dryRun, confirmRun, ...result, message: confirmRun ? "Generic news triage completed; only mapped serious candidates have planned deep checks." : "Generic news triage completed without OpenAI, publish, Telegram, or expensive deep checks." }));
}
