import { NextRequest, NextResponse } from "next/server";
import { runCoverageTest } from "@/lib/source-coverage";
import { withRedactionMetadata } from "@/lib/redact-secrets";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  try {
    return NextResponse.json(
      withRedactionMetadata(await runCoverageTest(body)),
    );
  } catch (e) {
    return NextResponse.json(
      withRedactionMetadata({
        ok: false,
        safeErrorCategory: "source_coverage_test_failed_safe",
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
      providers: [
        "FMP",
        "Marketaux",
        "Benzinga",
        "SEC",
        "Fed",
        "FederalRegister",
        "openFDA",
        "USAspending",
        "SAM",
      ],
      symbols: ["NVDA", "AMD", "MSFT", "GOOGL"],
      keywords: [
        "product launch",
        "guidance",
        "FDA approval",
        "contract award",
        "lawsuit",
        "investigation",
      ],
      maxEndpointsPerProvider: 30,
      maxItemsPerEndpoint: 5,
    },
  });
}
