import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

function safeLimit(value: string | null) {
  const parsed = Number.parseInt(value ?? "25", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 25;
  return Math.min(parsed, 100);
}

export async function GET(request: NextRequest) {
  try {
    const limit = safeLimit(request.nextUrl.searchParams.get("limit"));
    const matches = await prisma.patternMatch.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        rawSignal: { select: { title: true, source: true, ticker: true } },
        historicalEvent: { select: { title: true, ticker: true, eventType: true } },
      },
    });

    return NextResponse.json({
      ok: true,
      limit,
      matches: matches.map((match) => ({
        id: match.id,
        raw_signal_id: match.rawSignalId,
        historical_event_id: match.historicalEventId,
        ticker: match.ticker,
        match_score: match.matchScore?.toString() ?? match.similarity.toString(),
        match_reason: match.matchReason,
        matched_features: match.matchedFeatures,
        confidence_label: match.confidenceLabel,
        created_at: match.createdAt.toISOString(),
        raw_signal: match.rawSignal,
        historical_event: match.historicalEvent,
      })),
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Unable to load pattern matches." }, { status: 500 });
  }
}
