import { NextResponse } from "next/server";
import { withRedactionMetadata } from "@/lib/redact-secrets";

import { getSourceHealth } from "@/lib/source-health";

export async function GET() {
  const payload = await getSourceHealth();

  return NextResponse.json(withRedactionMetadata(payload), { status: payload.ok ? 200 : 503 });
}
