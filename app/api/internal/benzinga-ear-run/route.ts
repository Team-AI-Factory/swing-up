import { NextRequest, NextResponse } from "next/server";
import { runBenzingaEar } from "@/lib/benzinga-ear";
import { withRedactionMetadata } from "@/lib/redact-secrets";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const result = await runBenzingaEar(body).catch((error: unknown) => ({
    ok: false,
    safeErrorCategory: "unknown",
    safeErrorMessage: error instanceof Error ? error.message.slice(0, 160) : "Unknown error",
    noOpenAI: true,
    noPublish: true,
    noTelegram: true,
    secretsRedacted: true,
  }));
  return NextResponse.json(withRedactionMetadata(result));
}
