import { NextRequest, NextResponse } from "next/server";
import { buildCommitteeQueue, mockCommitteeCandidate } from "@/lib/ai-committee-queue";

export async function GET(request: NextRequest) {
  const limitParam = Number(request.nextUrl.searchParams.get("limit") ?? 20);
  return NextResponse.json(buildCommitteeQueue([mockCommitteeCandidate()], limitParam));
}
