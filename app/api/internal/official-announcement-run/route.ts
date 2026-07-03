import { NextRequest, NextResponse } from "next/server";
import { runOfficialAnnouncementRun } from "@/lib/official-announcements";
import { withRedactionMetadata } from "@/lib/redact-secrets";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const result = await runOfficialAnnouncementRun(body);
  return NextResponse.json(withRedactionMetadata(result));
}
