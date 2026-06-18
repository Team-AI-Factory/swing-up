import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { compareSignalToHistoricalEvent } from "@/lib/pattern-matcher";

const SIGNAL_LIMIT = 50;
const EVENT_LIMIT = 200;

function emptySummary() {
  return { ok: true, signalsChecked: 0, matchesCreated: 0, strong: 0, moderate: 0, weak: 0 };
}

export async function POST() {
  try {
    const signals = await prisma.rawSignal.findMany({
      where: { processedStatus: { in: ["promoted", "queued"] } },
      orderBy: { receivedAt: "desc" },
      take: SIGNAL_LIMIT,
    });
    const events = await prisma.historicalEvent.findMany({
      orderBy: [{ eventDate: "desc" }, { createdAt: "desc" }],
      take: EVENT_LIMIT,
    });
    const summary = emptySummary();
    summary.signalsChecked = signals.length;

    for (const signal of signals) {
      let best: { eventId: string; result: ReturnType<typeof compareSignalToHistoricalEvent> } | null = null;
      for (const event of events) {
        const result = compareSignalToHistoricalEvent(signal, event);
        if (!best || result.matchScore > best.result.matchScore) best = { eventId: event.id, result };
      }
      if (!best || best.result.confidenceLabel === "none") continue;

      const existing = await prisma.patternMatch.findFirst({
        where: { rawSignalId: signal.id, historicalEventId: best.eventId },
        select: { id: true },
      });
      if (existing) continue;

      await prisma.patternMatch.create({
        data: {
          rawSignalId: signal.id,
          historicalEventId: best.eventId,
          ticker: signal.ticker,
          similarity: new Prisma.Decimal(best.result.matchScore),
          matchScore: new Prisma.Decimal(best.result.matchScore),
          confidenceLabel: best.result.confidenceLabel,
          matchReason: best.result.matchReason,
          matchedFeatures: best.result.matchedFeatures,
          notes: "Historical Pattern Match v1 rule-based match.",
        },
      });
      summary.matchesCreated += 1;
      if (best.result.confidenceLabel === "strong") summary.strong += 1;
      if (best.result.confidenceLabel === "moderate") summary.moderate += 1;
      if (best.result.confidenceLabel === "weak") summary.weak += 1;
    }

    return NextResponse.json(summary);
  } catch {
    return NextResponse.json({ ok: false, error: "Unable to run pattern matching." }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, message: "POST to this route to compare promoted or queued raw signals with historical events." });
}
