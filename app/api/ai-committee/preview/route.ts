import { NextRequest, NextResponse } from "next/server";
import { buildCommitteeQueue, buildCommitteeQueueItem, mockCommitteeCandidate, type AiCommitteeCandidateInput } from "@/lib/ai-committee-queue";

export async function GET(request: NextRequest) {
  const mock = request.nextUrl.searchParams.get("mock") === "true";
  if (!mock) {
    return NextResponse.json({ ok: false, error: "Use ?mock=true for a safe AI Committee preview, or POST a candidate payload." }, { status: 400 });
  }

  return NextResponse.json(buildCommitteeQueue([mockCommitteeCandidate()], 1));
}

export async function POST(request: NextRequest) {
  let payload: AiCommitteeCandidateInput;
  try {
    payload = (await request.json()) as AiCommitteeCandidateInput;
  } catch {
    return NextResponse.json({ ok: false, error: "Request body must be valid JSON." }, { status: 400 });
  }

  return NextResponse.json({ ok: true, queueItems: [buildCommitteeQueueItem(payload)] });
}
