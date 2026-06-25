import { NextRequest, NextResponse } from "next/server";
import { runStoryClusterRun } from "@/lib/story-clustering";
import { withRedactionMetadata } from "@/lib/redact-secrets";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  try { return NextResponse.json(withRedactionMetadata(await runStoryClusterRun(body))); }
  catch (error) { return NextResponse.json(withRedactionMetadata({ ok:false, storyClusterSummary:{ ok:false, safeErrorCategory:"story_cluster_run_failed_safely", safeErrorMessage:error instanceof Error ? error.message.slice(0,160) : "Unknown error" }, noOpenAI:true, noPublish:true, noTelegram:true, secretsRedacted:true }), { status: 200 }); }
}
