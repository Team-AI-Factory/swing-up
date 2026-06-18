import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { buildPatternMatchPreview, getMockPatternCandidate, type PatternCandidateSignal } from "@/lib/pattern-matcher";

const EVENT_LIMIT = 200;

async function loadHistoricalEvents() {
  if (!process.env.DATABASE_URL) return [];
  return prisma.historicalEvent.findMany({
    orderBy: [{ eventDate: "desc" }, { createdAt: "desc" }],
    take: EVENT_LIMIT,
  });
}

export async function GET(request: NextRequest) {
  const mock = request.nextUrl.searchParams.get("mock") === "true";
  if (!mock) {
    return NextResponse.json({ ok: false, error: "Use ?mock=true for a safe pattern-match preview, or POST a candidate payload." }, { status: 400 });
  }

  try {
    const candidate = getMockPatternCandidate();
    const events = await loadHistoricalEvents();
    return NextResponse.json(buildPatternMatchPreview(candidate, events));
  } catch {
    return NextResponse.json({ ok: false, error: "Unable to build pattern match preview." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let candidate: PatternCandidateSignal;
  try {
    candidate = (await request.json()) as PatternCandidateSignal;
  } catch {
    return NextResponse.json({ ok: false, error: "Request body must be valid JSON." }, { status: 400 });
  }

  try {
    const events = await loadHistoricalEvents();
    return NextResponse.json(buildPatternMatchPreview(candidate, events));
  } catch {
    return NextResponse.json({ ok: false, error: "Unable to build pattern match preview." }, { status: 500 });
  }
}
