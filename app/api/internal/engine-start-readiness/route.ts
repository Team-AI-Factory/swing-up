import { NextResponse } from "next/server";
import { getEngineStartReadiness } from "@/lib/engine-start-readiness";

export async function GET() {
  const payload = await getEngineStartReadiness();
  return NextResponse.json(payload, { status: payload.ok ? 200 : 503 });
}
