import { NextRequest, NextResponse } from "next/server";
import { smartPull } from "@/lib/source-coverage";
import { withRedactionMetadata } from "@/lib/redact-secrets";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  try {
    return NextResponse.json(withRedactionMetadata(await smartPull(body)));
  } catch (e) {
    return NextResponse.json(
      withRedactionMetadata({
        ok: false,
        safeErrorCategory: "smart_source_pull_failed_safe",
        safeErrorMessage:
          e instanceof Error ? e.message.slice(0, 160) : "Unknown error",
        noOpenAI: true,
        noPublish: true,
        noTelegram: true,
      }),
      { status: 200 },
    );
  }
}
export async function GET() {
  return NextResponse.json({
    ok: false,
    methodRequired: "POST",
    exampleBody: {
      dryRun: true,
      confirmRun: false,
      mode: "balanced",
      symbols: ["NVDA", "AMD", "MSFT", "GOOGL"],
      keywords: [
        "product launch",
        "guidance",
        "FDA approval",
        "contract award",
        "lawsuit",
        "investigation",
      ],
      maxProviders: 10,
      maxEndpoints: 50,
      maxCallsTotal: 100,
    },
  });
}
