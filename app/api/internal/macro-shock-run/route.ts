import { NextRequest, NextResponse } from "next/server";
import { runMacroShockScan } from "@/lib/macro-shock";
import { withRedactionMetadata } from "@/lib/redact-secrets";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const result = await runMacroShockScan({
    dryRun: body.dryRun !== false,
    confirmRun: body.confirmRun === true,
    maxSignals: Number(body.maxSignals ?? 30),
  });
  return NextResponse.json(withRedactionMetadata(result));
}
