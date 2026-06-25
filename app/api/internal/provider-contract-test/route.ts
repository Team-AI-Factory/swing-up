import { NextRequest, NextResponse } from "next/server";
import { runFmpProviderContractTest } from "@/lib/fmp-provider-contract";
import { withRedactionMetadata } from "@/lib/redact-secrets";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const result = await runFmpProviderContractTest(body);
  return NextResponse.json(withRedactionMetadata(result));
}
