import { NextResponse } from "next/server";
import { withRedactionMetadata } from "@/lib/redact-secrets";
import { getEngineStartReadiness } from "@/lib/engine-start-readiness";

export async function GET() {
  const payload = await getEngineStartReadiness();
  return NextResponse.json(withRedactionMetadata(payload), { status: payload.ok ? 200 : 503 });
}
