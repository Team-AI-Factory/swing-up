import { NextResponse } from "next/server";

import { getSourceHealthDedupeReport } from "@/lib/source-health";

export async function GET() {
  try {
    const payload = await getSourceHealthDedupeReport();
    return NextResponse.json(payload, { status: payload.ok ? 200 : 503 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to build source-health dedupe report.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
