import { NextRequest, NextResponse } from "next/server";
import { runSec8k } from "@/lib/proof-ears";
import { withRedactionMetadata } from "@/lib/redact-secrets";

export const dynamic = "force-dynamic";

function safeError(error: unknown) {
  return error instanceof Error ? error.message.replace(/[A-Za-z0-9_\-]{20,}/g, "[redacted]").slice(0, 180) : "request_failed";
}

function safety() {
  return { callsOpenAI: false, publishesAlerts: false, sendsTelegram: false };
}

export async function GET() {
  try {
    const result = await runSec8k({ maxFilingsToCheck: 10, maxMaterialEvents: 5 });
    return NextResponse.json(withRedactionMetadata({ ok: true, ...result, dryRun: true, confirmRun: false, safety: safety() }));
  } catch (error) {
    return NextResponse.json(withRedactionMetadata({ ok: false, enabled: false, dryRun: true, confirmRun: false, error: safeError(error), safety: safety(), secretsRedacted: true }), { status: 200 });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  try {
    const result = await runSec8k(body);
    return NextResponse.json(withRedactionMetadata({ ok: true, ...result, dryRun: body.dryRun !== false, confirmRun: body.confirmRun === true, safety: safety() }));
  } catch (error) {
    return NextResponse.json(withRedactionMetadata({ ok: false, enabled: false, dryRun: body.dryRun !== false, confirmRun: body.confirmRun === true, error: safeError(error), safety: safety(), secretsRedacted: true }), { status: 200 });
  }
}
