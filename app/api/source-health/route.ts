import { NextResponse } from "next/server";

import { getSourceHealth } from "@/lib/source-health";

export async function GET() {
  const payload = await getSourceHealth();

  return NextResponse.json(payload, { status: payload.ok ? 200 : 503 });
}
