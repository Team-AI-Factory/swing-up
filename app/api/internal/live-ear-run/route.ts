import { NextRequest, NextResponse } from "next/server";
import { runLiveEarRun } from "@/lib/live-ear-runner";
import { withRedactionMetadata } from "@/lib/redact-secrets";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  try {
    const result = await runLiveEarRun(body);
    return NextResponse.json(withRedactionMetadata(result));
  } catch (error) {
    return NextResponse.json(withRedactionMetadata({ ok: false, error: "live_ear_run_failed_safely", safeErrorMessage: error instanceof Error ? error.message.slice(0, 160) : "Unknown error", noOpenAI: true, noPublish: true, noTelegram: true }), { status: 200 });
  }
}
