import { NextResponse } from "next/server";
import { getQuotaAndBatchingStatus } from "@/lib/source-quota-batching";
import { withRedactionMetadata } from "@/lib/redact-secrets";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return NextResponse.json(withRedactionMetadata(await getQuotaAndBatchingStatus())); }
  catch (e) { return NextResponse.json(withRedactionMetadata({ ok:false, safeErrorCategory:"source_quota_batching_status_failed_safe", safeErrorMessage:e instanceof Error?e.message.slice(0,160):"Unknown error", noOpenAI:true, noPublish:true, noTelegram:true }), {status:200}); }
}
