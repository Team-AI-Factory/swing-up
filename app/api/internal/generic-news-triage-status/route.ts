import { NextResponse } from "next/server";
import { runGenericNewsTriage } from "@/lib/generic-news-triage";
import { withRedactionMetadata } from "@/lib/redact-secrets";

export const dynamic = "force-dynamic";

export async function GET() {
  const triage = await runGenericNewsTriage({ maxGenericItemsToScan: 50, maxRippleCandidates: 10, maxDeepChecks: 0, confirmRun: false });
  return NextResponse.json(withRedactionMetadata({ ok: true, ...triage, deepChecksTriggeredByGenericNews: [], nextRecommendedFix: triage.nextRecommendedFix }));
}
