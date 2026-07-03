import { NextRequest, NextResponse } from "next/server";
import { runSeriousSignalBrain } from "@/lib/serious-signal-brain";
import { withRedactionMetadata } from "@/lib/redact-secrets";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  try { return NextResponse.json(withRedactionMetadata(await runSeriousSignalBrain(body))); }
  catch (error) { return NextResponse.json(withRedactionMetadata({ ok:false, seriousSignalBrainSummary:{ ok:false, safeErrorCategory:"serious_signal_brain_failed_safely", safeErrorMessage:error instanceof Error ? error.message.slice(0,160) : "Unknown error" }, clustersInspected:0, officialProofNeededCount:0, officialProofAvailableCount:0, rippleCandidatesCreated:0, contradictionsDetectedCount:0, actionQueueCreatedCount:0, topSeriousSignalActions:[], nextBestProofCalls:[], noOpenAI:true, noPublish:true, noTelegram:true, secretsRedacted:true }), { status: 200 }); }
}
