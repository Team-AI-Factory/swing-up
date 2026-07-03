import { NextResponse } from "next/server";
import { pullPlan } from "@/lib/source-coverage";
import { withRedactionMetadata } from "@/lib/redact-secrets";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return NextResponse.json(withRedactionMetadata(await pullPlan()));
  } catch (e) {
    return NextResponse.json(
      withRedactionMetadata({
        ok: false,
        safeErrorCategory: "source_pull_plan_failed_safe",
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
