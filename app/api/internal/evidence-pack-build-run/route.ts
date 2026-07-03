import { NextRequest, NextResponse } from "next/server";
import { runEvidencePackBuild } from "@/lib/evidence-pack-builder";
import { withRedactionMetadata } from "@/lib/redact-secrets";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  try { return NextResponse.json(withRedactionMetadata(await runEvidencePackBuild(body))); }
  catch (error) { return NextResponse.json(withRedactionMetadata({ ok:false, evidencePackBuilderSummary:{ ok:false, safeErrorCategory:"evidence_pack_builder_failed_safely", safeErrorMessage:error instanceof Error ? error.message.slice(0,160) : "Unknown error" }, evidencePacksCreated:0, topEvidencePacks:[], aiReviewReadyEvidencePacks:[], missingProofRouterSummary:[], noOpenAI:true, noPublish:true, noTelegram:true, secretsRedacted:true }), { status: 200 }); }
}
